// Modal text-input subsystem. Used by login, search, filter, and the
// upcoming command palette. Decoupled from any specific tab so adding new
// input contexts is a one-line change.

import { appState, render, showMessage } from './state.mjs';

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
  if (wasActive) showMessage('Cancelled', 'info');
  else render();
}

// Returns true if the key was consumed by the input subsystem.
export function handleInputKey(key) {
  if (appState.inputMode !== 'input') return false;

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
    const cur = appState.inputCursor || buf.length;
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
    const cur = appState.inputCursor || buf.length;
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
  if (key.length >= 1 && (key.charCodeAt(0) >= 32 || key.charCodeAt(0) > 127)) {
    const buf = Array.from(appState.inputBuffer);
    const cur = appState.inputCursor || buf.length;
    buf.splice(cur, 0, key);
    appState.inputBuffer = buf.join('');
    appState.inputCursor = cur + key.length;
    render();
    return true;
  }
  return true; // swallow other control chars while in input mode
}
