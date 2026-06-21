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
  render();
}

export function cancelInput() {
  const wasActive = appState.inputMode === 'input';
  appState.inputMode = null;
  appState.inputBuffer = '';
  appState.inputPrompt = '';
  appState.inputContext = null;
  appState.inputMask = false;
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
    if (fn) fn(value);
    else render();
    return true;
  }

  if (key === '\x1b') { cancelInput(); return true; }

  if (key === '\x7f' || key === '\b') {
    appState.inputBuffer = Array.from(appState.inputBuffer).slice(0, -1).join('');
    render();
    return true;
  }

  // Allow Ctrl-C to quit even in input mode.
  if (key === '\x03') { appState.inputMode = null; appState.inputBuffer = ''; appState.inputPrompt = ''; appState.inputContext = null; appState.inputMask = false; return false; }

  // Printable ASCII + above. We accept multi-byte UTF-8 too.
  if (key.length >= 1 && (key.charCodeAt(0) >= 32 || key.charCodeAt(0) > 127)) {
    appState.inputBuffer += key;
    render();
    return true;
  }
  return true; // swallow other control chars while in input mode
}
