// Tests for the bracketed-paste handling in tui/input.mjs.
//
// Modern terminals (xterm ≥370, iTerm2, kitty, wezterm, GNOME Terminal)
// deliver a paste as ONE big chunk: "\x1b[200~<content>\x1b[201~". Older
// terminals split each piece across separate `data` events. Some terminals
// ignore bracketed paste mode entirely and deliver the paste as raw
// printable chars with stray \n / \r inserted by the host.
//
// handleInputKey must handle ALL of these forms without dropping or
// submitting mid-paste.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { handleInputKey, startInput, cancelInput, isPasting } from '../tui/input.mjs';
import { appState, render } from '../tui/state.mjs';

// Minimal stub: input.mjs / state.mjs import surface is satisfied by the
// real modules (state.mjs's render is a debounced no-op when no renderFn is
// bound). We don't initialize a screen here — every assertion only inspects
// appState.inputBuffer, appState.inputCursor, appState.inputMode, and the
// module-local _pasting / _pasteBuffer (via isPasting()).

describe('input paste handling — state resets', () => {
  beforeEach(() => {
    startInput('Paste here:', 'login', true);
  });

  it('startInput() resets isPasting() to false', () => {
    // Half-finished paste from a previous modal would otherwise leak.
    handleInputKey('\x1b[200~partial');
    assert.equal(isPasting(), true);
    startInput('Fresh:', 'login', true);
    assert.equal(isPasting(), false);
    assert.equal(appState.inputBuffer, '');
  });

  it('cancelInput() resets isPasting() to false', () => {
    handleInputKey('\x1b[200~half');
    assert.equal(isPasting(), true);
    cancelInput();
    assert.equal(isPasting(), false);
  });
});

describe('input paste handling — bracketed combined chunk', () => {
  beforeEach(() => {
    startInput('PAT:', 'login', true);
  });

  it('combined one-chunk paste inserts atomically', () => {
    handleInputKey('\x1b[200~ghp_abc123\x1b[201~');
    assert.equal(appState.inputBuffer, 'ghp_abc123');
    // 'ghp_abc123' is 10 codepoints, cursor advances by 10.
    assert.equal(appState.inputCursor, 10);
    assert.equal(isPasting(), false);
    // Critical: must still be in input mode (no submit happened).
    assert.equal(appState.inputMode, 'input');
  });

  it('combined chunk pastes into existing buffer at cursor', () => {
    handleInputKey('pre');
    // Cursor sits after "pre" (length 3).
    handleInputKey('\x1b[200~paste\x1b[201~');
    assert.equal(appState.inputBuffer, 'prepaste');
    assert.equal(appState.inputCursor, 8);
  });

  it('combined chunk pastes after cursor-mid prefix', () => {
    handleInputKey('hello world');
    // Move cursor to position 5 (between "hello" and " world").
    appState.inputCursor = 5;
    handleInputKey('\x1b[200~_MID_\x1b[201~');
    assert.equal(appState.inputBuffer, 'hello_MID_ world');
    assert.equal(appState.inputCursor, 10);
  });

  it('strips stray control chars inside the paste body', () => {
    // Some terminals embed \r or \t inside the bracketed body; they must not
    // break the buffer or trigger submit.
    handleInputKey('\x1b[200~a\r\nb\x1b[201~');
    assert.equal(appState.inputBuffer, 'ab');
    assert.equal(appState.inputMode, 'input');
  });
});

describe('input paste handling — split chunks (older terminals)', () => {
  beforeEach(() => {
    startInput('PAT:', 'login', true);
  });

  it('start / content / end as 3 separate calls', () => {
    handleInputKey('\x1b[200~');
    assert.equal(isPasting(), true);
    handleInputKey('hello_token');
    assert.equal(isPasting(), true);
    handleInputKey('\x1b[201~');
    assert.equal(isPasting(), false);
    assert.equal(appState.inputBuffer, 'hello_token');
  });

  it('mid-content split — start + half + half + end', () => {
    handleInputKey('\x1b[200~chu');
    handleInputKey('nkA');
    handleInputKey('123\x1b[201~');
    assert.equal(appState.inputBuffer, 'chunkA123');
    assert.equal(appState.inputCursor, 9);
  });

  it('end sequence arrives in the middle of a chunk with trailing keys', () => {
    handleInputKey('\x1b[200~ab');
    handleInputKey('cd\x1b[201~e');  // end + trailing 'e'
    assert.equal(appState.inputBuffer, 'abcde');
    assert.equal(appState.inputCursor, 5);
  });

  it('empty body paste still terminates cleanly', () => {
    handleInputKey('\x1b[200~');
    handleInputKey('\x1b[201~');
    assert.equal(appState.inputBuffer, '');
    assert.equal(isPasting(), false);
    assert.equal(appState.inputMode, 'input');
  });
});

describe('input paste handling — bundling with adjacent keys', () => {
  beforeEach(() => {
    startInput('PAT:', 'login', true);
  });

  it('key-then-paste bundled in one chunk', () => {
    // User typed "a" and then pasted "bc" with start+end bundled.
    handleInputKey('a\x1b[200~bc\x1b[201~');
    assert.equal(appState.inputBuffer, 'abc');
    assert.equal(appState.inputCursor, 3);
  });

  it('paste-then-key bundled in one chunk', () => {
    handleInputKey('\x1b[200~ab\x1b[201~c');
    assert.equal(appState.inputBuffer, 'abc');
    assert.equal(appState.inputCursor, 3);
  });

  it('prefix-then-start-only-then-end-then-suffix across chunks', () => {
    handleInputKey('xy\x1b[200~');
    handleInputKey('zz\x1b[201~q');
    assert.equal(appState.inputBuffer, 'xyzzq');
    assert.equal(appState.inputCursor, 5);
  });
});

describe('input paste handling — bulk-raw fallback (terminals without \x1b[?2004h)', () => {
  beforeEach(() => {
    startInput('PAT:', 'login', true);
  });

  it('long all-printable chunk is bulk-inserted atomically', () => {
    handleInputKey('ghp_abcdefghij1234567890');
    assert.equal(appState.inputBuffer, 'ghp_abcdefghij1234567890');
    assert.equal(appState.inputCursor, 24);
    assert.equal(appState.inputMode, 'input');
  });

  it('long chunk with stray \\\\n does NOT submit — strips the \\\\n', () => {
    // The classic case: host inserts \n at end of pasted line and the old
    // behavior would submit on the \n. The fallback must bulk-insert
    // printable chars and discard the control bytes.
    handleInputKey('token_part\n');
    assert.equal(appState.inputBuffer, 'token_part');
    assert.equal(appState.inputMode, 'input');
  });

  it('long chunk with \\\\r, \\\\t, and DEL (0x7f) is filtered', () => {
    // \x7f is the DEL byte (charCode 127) — terminals sometimes embed it.
    handleInputKey('tok\r\t\x7fen\r\n');
    assert.equal(appState.inputBuffer, 'token');
    assert.equal(appState.inputMode, 'input');
  });

  it('short 2-char chunk is NOT treated as a paste (still inserts normally)', () => {
    handleInputKey('hi');
    assert.equal(appState.inputBuffer, 'hi');
  });
});

describe('input paste handling — submit / cancel still work mid-modal', () => {
  beforeEach(() => {
    startInput('PAT:', 'login', true);
  });

  it('\\\\r alone still submits and clears the buffer', () => {
    handleInputKey('foo');
    handleInputKey('\r');
    assert.equal(appState.inputMode, null);
  });

  it('Esc alone still cancels and clears the buffer', () => {
    handleInputKey('foo');
    handleInputKey('\x1b');
    assert.equal(appState.inputMode, null);
    assert.equal(appState.inputBuffer, '');
  });

  it('typing a char after a successful paste works (no stuck _pasting flag)', () => {
    handleInputKey('\x1b[200~pasted\x1b[201~');
    handleInputKey('!');  // single printable char
    assert.equal(appState.inputBuffer, 'pasted!');
    assert.equal(appState.inputCursor, 7);
    assert.equal(isPasting(), false);
  });
});