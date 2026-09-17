// Tests for tui/input.mjs — cursor movement, word navigation, edit operations.
//
// The word-motion helpers are EXPORTED from input.mjs as pure functions
// (inputWordBack / inputWordForward / inputDeleteWordBefore) and the real
// key handlers use them — so these tests exercise the live implementation
// directly. (Previously the algorithms were replicated inline here; the
// copies could drift from the source and the tests would still pass.)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  inputWordBack as wordBack,
  inputWordForward as wordForward,
  inputDeleteWordBefore as deleteWordBefore,
} from '../tui/input.mjs';

describe('input word-back navigation', () => {
  it('moves back across one word', () => {
    const buf = Array.from('hello world');
    assert.equal(wordBack(buf, 11), 6); // end → start of "world"
  });
  it('skips leading spaces', () => {
    const buf = Array.from('hello   world');
    assert.equal(wordBack(buf, 13), 8); // end → start of "world"
  });
  it('stops at start', () => {
    const buf = Array.from('hello');
    assert.equal(wordBack(buf, 0), 0);
  });
  it('from middle of word', () => {
    const buf = Array.from('hello world');
    assert.equal(wordBack(buf, 8), 6); // mid-"world" → start of "world"
  });
});

describe('input word-forward navigation', () => {
  it('moves forward across one word', () => {
    const buf = Array.from('hello world');
    assert.equal(wordForward(buf, 0), 6); // start → after "hello "
  });
  it('stops at end', () => {
    const buf = Array.from('hello');
    assert.equal(wordForward(buf, 5), 5);
  });
  it('skips trailing spaces', () => {
    const buf = Array.from('hello   world');
    assert.equal(wordForward(buf, 0), 8); // "hello" → start of "world"
  });
  it('from mid-word goes to next word start', () => {
    const buf = Array.from('hello world');
    assert.equal(wordForward(buf, 2), 6); // mid-"hello" → start of "world"
  });
});

describe('input Ctrl-W delete word before cursor', () => {
  it('deletes last word', () => {
    const buf = Array.from('hello world');
    const { buf: result, cur } = deleteWordBefore(buf, 11);
    assert.equal(result.join(''), 'hello ');
    assert.equal(cur, 6);
  });
  it('deletes only word when single word', () => {
    const buf = Array.from('hello');
    const { buf: result, cur } = deleteWordBefore(buf, 5);
    assert.equal(result.join(''), '');
    assert.equal(cur, 0);
  });
  it('handles cursor in middle of word', () => {
    const buf = Array.from('hello world');
    const { buf: result, cur } = deleteWordBefore(buf, 8); // mid-"world"
    assert.equal(result.join(''), 'hello rld');
    assert.equal(cur, 6);
  });
  it('is no-op at start', () => {
    const buf = Array.from('hello');
    const { buf: result, cur } = deleteWordBefore(buf, 0);
    assert.equal(result.join(''), 'hello');
    assert.equal(cur, 0);
  });
  it('does not mutate the input array', () => {
    const buf = Array.from('hello world');
    const snapshot = [...buf];
    deleteWordBefore(buf, 11);
    assert.deepEqual(buf, snapshot);
  });
});
