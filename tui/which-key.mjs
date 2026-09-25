// Which-Key Plugin — shows pending key sequences when a prefix key is pressed.
// Inspired by vim's which-key plugin.

import { appState, render as appRender } from './state.mjs';
import { color } from './theme.mjs';
import { truncate } from './utils.mjs';
import { saveFocus, restoreFocus } from './focus.mjs';

// Key binding groups.
// v0.8: only groups with FUNCTIONAL bindings may live here. Every stub
// group (all bindings `run: () => null`) was deleted: a stub prefix eats
// the single press on EVERY tab before global/per-tab dispatch ever runs,
// which silently killed Repos `c` (clear filters), Inbox `f` (filter
// cycle), collapse `z`, bookmark `b`, and would have killed Local `c`/`f`.
// 'g' stays: its bindings re-inject real keys (run returns 'g'/'G') so the
// two-press `g g` / `g G` sequences still work. 'r' stays unregistered (see
// note below) for the same single-press reason.
const KEY_GROUPS = {
  'g': {
    label: 'Go',
    bindings: [
      { key: 'g', desc: 'Go to top', run: () => 'g' },
      { key: 'G', desc: 'Go to bottom', run: () => 'G' },
    ],
  },
  // NOTE: 'r' is intentionally NOT a prefix key. It is the global
  // single-press "Refresh current view" hotkey (see keys.mjs `case 'r'`).
  // Registering it here made the first press only open this overlay and
  // the second press re-open it (handleKey returns false -> isPrefixKey
  // re-triggers), so refresh never fired.
};

let _active = false;
let _prefix = '';
let _focusToken = null;
let _timeout = null;

export function isOpen() {
  return _active;
}

export function getPrefix() {
  return _prefix;
}

/**
 * Start a which-key sequence.
 * @param {string} prefix - The prefix key pressed
 */
export function startSequence(prefix) {
  // Guard against re-entry while the overlay is already open: saving focus
  // again would overwrite _focusToken and the prior focus context would
  // never be restored (leak).
  if (_active) {
    _prefix = prefix;
    return;
  }
  _active = true;
  _prefix = prefix;
  _focusToken = saveFocus();
  
  // Auto-close after 2 seconds of inactivity. The callback nulls the handle
  // via close() itself; re-checking _active here is belt-and-braces against
  // a close() that raced this timer firing.
  if (_timeout) clearTimeout(_timeout);
  _timeout = setTimeout(() => {
    _timeout = null;
    if (_active) close();
  }, 2000);
  if (_timeout.unref) _timeout.unref();
  
  appRender();
}

export function shutdownWhichKey() {
  try { if (_timeout) { clearTimeout(_timeout); _timeout = null; } } catch {}
  _active = false;
  _prefix = '';
  _focusToken = null;
}

/**
 * Close the which-key overlay.
 */
export function close() {
  if (!_active) return;
  _active = false;
  _prefix = '';
  if (_timeout) {
    clearTimeout(_timeout);
    _timeout = null;
  }
  restoreFocus(_focusToken);
  _focusToken = null;
  appRender();
}

/**
 * Handle key press in which-key mode.
 * @param {string} key - The key pressed
 * @returns {boolean} True if the key was handled
 */
export function handleKey(key) {
  if (!_active) return false;

  // Escape closes
  if (key === '\x1b') {
    close();
    return true;
  }

  // Check if the key completes a sequence
  const group = KEY_GROUPS[_prefix];
  if (group) {
    const binding = group.bindings.find(b => b.key === key);
    if (binding) {
      close();
      // Execute the binding's run function
      const result = binding.run();
      if (result) {
        // Return the key to be handled by the main key handler
        return false;
      }
      return true;
    }
  }

  // Unknown key — dismiss the overlay but EAT the key. Letting it propagate
  // meant a fat-fingered press both closed the overlay AND fired whatever
  // action that key performs (e.g. 'q' quitting the app) — never intended.
  close();
  return true;
}

/**
 * Get the bindings for the current prefix.
 * @returns {Array} Array of binding objects
 */
export function getBindings() {
  if (!_prefix) return [];
  const group = KEY_GROUPS[_prefix];
  return group ? group.bindings : [];
}

/**
 * Render the which-key overlay.
 * @param {Object} screen - Screen object
 */
export function render(screen) {
  if (!_active) return;

  const W = screen.width;
  const H = screen.height;
  const bindings = getBindings();
  
  if (bindings.length === 0) return;

  // Calculate dimensions
  const boxW = Math.min(40, W - 4);
  const boxH = bindings.length + 4;  // title + bindings + footer
  const x = 2;
  const y = H - boxH - 2;  // Bottom-left corner

  // Backdrop
  const backdropStyle = color('modalBackdrop');
  for (let yy = y; yy < y + boxH && yy < H; yy++) {
    for (let xx = x; xx < x + boxW && xx < W; xx++) {
      screen.styleBuf[yy][xx] = backdropStyle;
    }
  }

  // Clear box area
  for (let yy = y; yy < y + boxH && yy < H; yy++) {
    for (let xx = x; xx < x + boxW && xx < W; xx++) {
      screen.setCell(xx, yy, ' ', null);
    }
  }

  // Draw box
  const group = KEY_GROUPS[_prefix];
  const title = group ? group.label : 'Pending...';
  screen.box(x, y, boxW, boxH, title, color('modalBorder'));

  // Render bindings
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i];
    const row = y + 2 + i;
    
    // Key
    screen.writeStr(x + 2, row, binding.key, { fg: 'cyan', bold: true });
    
    // Description
    screen.writeStr(x + 6, row, truncate(binding.desc, boxW - 10), null);
  }

  // Footer
  const footY = y + boxH - 2;
  const hint = 'Press key or Esc to cancel';
  screen.writeStr(x + 2, footY, hint, color('dim'));
}

/**
 * Check if a key is a prefix key.
 * @param {string} key - The key to check
 * @returns {boolean} True if the key is a prefix
 */
export function isPrefixKey(key) {
  return key in KEY_GROUPS;
}
