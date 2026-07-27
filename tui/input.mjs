// Modal text-input subsystem. Used by login, search, filter, and the
// upcoming command palette. Decoupled from any specific tab so adding new
// input contexts is a one-line change.

import { appState, render, showMessage } from './state.mjs';

// Bracketed paste mode — enables proper paste handling.
export function enableBracketedPaste() {
  process.stdout.write('\x1b[?2004h');
}

export function disableBracketedPaste() {
  process.stdout.write('\x1b[?2004l');
}

// Paste state tracking.
let _pasting = false;
let _pasteBuffer = '';

export function isPasting() { return _pasting; }

// Registry of input contexts. Each handler receives the trimmed buffer and
// is responsible for actually consuming it / dispatching follow-up actions.
const handlers = Object.create(null);

export function registerInputHandler(context, fn) {
  handlers[context] = fn;
}

export function startInput(prompt, context, mask = false) {
  appState.inputMode = 'input';
  appState.inputBuffer = '';
  appState.inputPrompt = prompt;
  appState.inputContext = context;
  appState.inputMask = mask;
  appState.inputCursor = 0;
  // Reset paste state so a half-finished paste from a previous modal
  // can't leak into the new one.
  _pasting = false;
  _pasteBuffer = '';
  render();
}

export function cancelInput() {
  const wasActive = appState.inputMode === 'input';
  appState.inputMode = null;
  appState.inputBuffer = '';
  appState.inputPrompt = '';
  appState.inputContext = null;
  appState.inputMask = false;
  appState.inputCursor = 0;
  // Clear paste state so a cancelled paste can't bleed into the next modal.
  _pasting = false;
  _pasteBuffer = '';
  if (wasActive) showMessage('Cancelled', 'info');
  else render();
}

// Returns true if the key was consumed by the input subsystem.
export function handleInputKey(key) {
  if (appState.inputMode !== 'input') return false;

  // Handle bracketed paste mode.
  //
  // The start/end sequences can arrive ANYWHERE in a `data` chunk — modern
  // terminals (xterm ≥370, iTerm2, kitty, wezterm, modern GNOME Terminal)
  // deliver a paste as ONE big chunk \x1b[200~<content>\x1b[201~. Older
  // terminals split each piece across `data` events. The previous exact-
  // equality test (`key === '\x1b[200~'`) silently dropped combined chunks.
  // Parse for the sequences anywhere in the chunk, recursively process any
  // prefix (key that came BEFORE the paste) and any suffix (key that came
  // AFTER the paste).
  const PASTE_START = '\x1b[200~';
  const PASTE_END   = '\x1b[201~';

  // ── Shared helpers for the paste paths ──
  //
  // Strip control bytes (<32) and DEL (127) from a string and return the
  // remaining codepoints as an array (codepoint-array form keeps the
  // splice call correct for surrogate pairs and combining marks).
  function filterPrintableChars(str) {
    let out = '';
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c >= 32 && c !== 127) out += str[i];
    }
    return Array.from(out);
  }

  // Splice an array of codepoints into the input buffer at the cursor,
  // advance the cursor by the inserted count, and re-render. Used by both
  // the bracketed-paste flush and the bulk-raw-paste fallback.
  function insertCharsAtCursor(chars) {
    if (chars.length === 0) return;
    const buf = Array.from(appState.inputBuffer);
    const cur = appState.inputCursor != null ? appState.inputCursor : buf.length;
    buf.splice(cur, 0, ...chars);
    appState.inputBuffer = buf.join('');
    appState.inputCursor = cur + chars.length;
    render();
  }

  // Flush the in-flight bracketed paste into the input buffer, clearing
  // module-local paste state.
  const flushPasteIntoInput = () => {
    _pasting = false;
    insertCharsAtCursor(filterPrintableChars(_pasteBuffer));
    _pasteBuffer = '';
  };

  // 1) Already mid-paste: keep buffering until we see the END sequence,
  //    even if the same chunk also contains trailing key bytes.
  if (_pasting) {
    const endIdx = key.indexOf(PASTE_END);
    if (endIdx === -1) {
      _pasteBuffer += key;
      return true;
    }
    _pasteBuffer += key.slice(0, endIdx);
    flushPasteIntoInput();
    const remainder = key.slice(endIdx + PASTE_END.length);
    if (remainder.length > 0) return handleInputKey(remainder);
    return true;
  }

  // 2) Paste START anywhere in chunk: recursively handle any prefix as a
  //    normal key first, then arm the paste state and recursively process
  //    the suffix (which may contain the END sequence and any trailing key).
  const startIdx = key.indexOf(PASTE_START);
  if (startIdx !== -1) {
    const before = key.slice(0, startIdx);
    if (before.length > 0) handleInputKey(before);
    _pasting = true;
    _pasteBuffer = '';
    const after = key.slice(startIdx + PASTE_START.length);
    if (after.length > 0) handleInputKey(after);
    return true;
  }

  // 3) Bulk-raw-paste fallback for terminals that IGNORE bracketed paste
  //    mode (\x1b[?2004h). In that case the paste arrives as raw printable
  //    chars (often with stray \n / \r / \t inserted by the host). The
  //    previous behavior would submit on the very first \n and lose most
  //    of the paste. Instead: if a chunk has both printable AND control
  //    bytes (≥3 chars total, no escape sequences at all), bulk-insert
  //    the printable chars and drop the control chars. Single-character
  //    chunks and all-printable chunks fall through to the normal
  //    per-key branches below.
  if (key.length >= 3 && !key.includes('\x1b')) {
    let hasControl = false;
    for (let i = 0; i < key.length; i++) {
      const c = key.charCodeAt(i);
      if (c < 32 || c === 127) { hasControl = true; break; }
    }
    if (hasControl) {
      insertCharsAtCursor(filterPrintableChars(key));
      return true;
    }
  }

  if (key === '\r' || key === '\n') {
    const ctx = appState.inputContext;
    const value = appState.inputBuffer;
    const fn = handlers[ctx];
    // Clear modal state BEFORE invoking the handler so the handler can open
    // a new modal (e.g. palette → action that opens another input) without
    // race conditions.
    appState.inputMode = null;
    appState.inputBuffer = '';
    appState.inputPrompt = '';
    appState.inputContext = null;
    appState.inputMask = false;
    appState.inputCursor = 0;
    if (fn) fn(value);
    else render();
    return true;
  }

  if (key === '\x1b') { cancelInput(); return true; }

  // Backspace — delete char before cursor.
  if (key === '\x7f' || key === '\b') {
    const buf = Array.from(appState.inputBuffer);
    const cur = appState.inputCursor != null ? appState.inputCursor : buf.length;
    if (cur > 0) {
      buf.splice(cur - 1, 1);
      appState.inputBuffer = buf.join('');
      appState.inputCursor = cur - 1;
    }
    render();
    return true;
  }

  // Allow Ctrl-C to quit even in input mode.
  if (key === '\x03') { appState.inputMode = null; appState.inputBuffer = ''; appState.inputPrompt = ''; appState.inputContext = null; appState.inputMask = false; appState.inputCursor = 0; return false; }

  // Ctrl-A — move cursor to start.
  if (key === '\x01') {
    appState.inputCursor = 0;
    render();
    return true;
  }

  // Ctrl-E — move cursor to end.
  if (key === '\x05') {
    appState.inputCursor = appState.inputBuffer.length;
    render();
    return true;
  }

  // Ctrl-U — clear line.
  if (key === '\x15') {
    appState.inputBuffer = '';
    appState.inputCursor = 0;
    render();
    return true;
  }

  // Ctrl-W — delete word before cursor.
  if (key === '\x17') {
    const buf = Array.from(appState.inputBuffer);
    const cur = appState.inputCursor != null ? appState.inputCursor : buf.length;
    if (cur === 0) { render(); return true; }
    let i = cur - 1;
    while (i > 0 && buf[i - 1] === ' ') i--;
    while (i > 0 && buf[i - 1] !== ' ') i--;
    buf.splice(i, cur - i);
    appState.inputBuffer = buf.join('');
    appState.inputCursor = i;
    render();
    return true;
  }

  // Left arrow.
  if (key === '\x1b[D') {
    const cur = appState.inputCursor || 0;
    appState.inputCursor = Math.max(0, cur - 1);
    render();
    return true;
  }

  // Right arrow.
  if (key === '\x1b[C') {
    const cur = appState.inputCursor || 0;
    appState.inputCursor = Math.min(appState.inputBuffer.length, cur + 1);
    render();
    return true;
  }

  // Ctrl-Left (word back) — \x1b[1;5D or \x1bb (Alt-b).
  if (key === '\x1b[1;5D' || key === '\x1b[5D' || key === '\x1bb') {
    const buf = Array.from(appState.inputBuffer);
    let cur = appState.inputCursor != null ? appState.inputCursor : buf.length;
    // Skip trailing spaces, then skip word chars
    while (cur > 0 && buf[cur - 1] === ' ') cur--;
    while (cur > 0 && buf[cur - 1] !== ' ') cur--;
    appState.inputCursor = cur;
    render();
    return true;
  }

  // Ctrl-Right (word forward) — \x1b[1;5C or \x1bf (Alt-f).
  if (key === '\x1b[1;5C' || key === '\x1b[5C' || key === '\x1bf') {
    const buf = Array.from(appState.inputBuffer);
    let cur = appState.inputCursor != null ? appState.inputCursor : buf.length;
    // Skip current word chars, then skip spaces
    while (cur < buf.length && buf[cur] !== ' ') cur++;
    while (cur < buf.length && buf[cur] === ' ') cur++;
    appState.inputCursor = cur;
    render();
    return true;
  }

  // Home.
  if (key === '\x1b[H' || key === '\x1bOH') {
    appState.inputCursor = 0;
    render();
    return true;
  }

  // End.
  if (key === '\x1b[F' || key === '\x1bOF') {
    appState.inputCursor = appState.inputBuffer.length;
    render();
    return true;
  }

  // Printable ASCII + above. We accept multi-byte UTF-8 too.
  if (key.length >= 1 && key.charCodeAt(0) >= 32) {
    const buf = Array.from(appState.inputBuffer);
    const cur = appState.inputCursor != null ? appState.inputCursor : buf.length;
    buf.splice(cur, 0, ...Array.from(key));
    appState.inputBuffer = buf.join('');
    appState.inputCursor = cur + Array.from(key).length;
    render();
    return true;
  }
  return true; // swallow other control chars while in input mode
}
