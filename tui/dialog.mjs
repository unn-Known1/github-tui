// Unified Stack-Based Dialog Management System
// Provides a centralized way to manage overlays/dialogs with stacking support.

import { appState, render as appRender } from './state.mjs';
import { saveFocus, restoreFocus } from './focus.mjs';

// Dialog stack - each entry has: { id, render, handleKey, onClose, focusToken }
const dialogStack = [];

// Known dialog types and their state flags
const DIALOG_TYPES = {
  palette:    { stateKey: 'showPalette',    priority: 10 },
  help:       { stateKey: 'showHelp',       priority: 20 },
  bookmarks:  { stateKey: 'showBookmarks',  priority: 30 },
  quickSettings: { stateKey: '_quickSettingsOpen', priority: 40 },
  detail:     { stateKey: 'showDetail',     priority: 50 },
  confirm:    { stateKey: 'confirmAction',  priority: 60 },
  input:      { stateKey: 'inputMode',      priority: 70 },
  onboarding: { stateKey: 'showOnboarding', priority: 80 },
  welcome:    { stateKey: 'showWelcome',    priority: 90 },
};

/**
 * Push a dialog onto the stack.
 * @param {Object} dialog
 * @param {string} dialog.id - Unique dialog identifier
 * @param {function} dialog.render - Render function: (screen) => void
 * @param {function} [dialog.handleKey] - Key handler: (key) => boolean
 * @param {function} [dialog.onClose] - Cleanup callback
 */
export function pushDialog(dialog) {
  if (!dialog || !dialog.id) return;

  // Save focus state
  const focusToken = saveFocus();

  dialogStack.push({
    ...dialog,
    focusToken,
    openedAt: Date.now(),
  });

  // Sync with legacy state flags
  syncLegacyState();
  appRender();
}

/**
 * Pop the top dialog from the stack.
 * @returns {Object|null} The removed dialog, or null if stack was empty
 */
export function popDialog() {
  if (dialogStack.length === 0) return null;

  const dialog = dialogStack.pop();

  // Restore focus
  if (dialog.focusToken) {
    restoreFocus(dialog.focusToken);
  }

  // Call cleanup callback
  if (dialog.onClose) {
    dialog.onClose();
  }

  // Sync with legacy state flags
  syncLegacyState();
  appRender();

  return dialog;
}

/**
 * Replace the top dialog with a new one.
 * @param {Object} dialog - New dialog to push
 */
export function replaceDialog(dialog) {
  popDialog();
  pushDialog(dialog);
}

/**
 * Clear all dialogs from the stack.
 */
export function clearDialogs() {
  while (dialogStack.length > 0) {
    const dialog = dialogStack.pop();
    if (dialog.focusToken) {
      restoreFocus(dialog.focusToken);
    }
    if (dialog.onClose) {
      dialog.onClose();
    }
  }

  // Reset legacy state
  resetLegacyState();
  appRender();
}

/**
 * Get the current dialog stack.
 */
export function getDialogStack() {
  return [...dialogStack];
}

/**
 * Get the top dialog (most recently pushed).
 */
export function getTopDialog() {
  return dialogStack[dialogStack.length - 1] || null;
}

/**
 * Check if a specific dialog type is open.
 */
export function isDialogOpen(id) {
  return dialogStack.some(d => d.id === id);
}

/**
 * Get dialog count.
 */
export function getDialogCount() {
  return dialogStack.length;
}

/**
 * Handle key press for the top dialog.
 * @param {string} key - The key pressed
 * @returns {boolean} True if the key was handled
 */
export function handleDialogKey(key) {
  if (dialogStack.length === 0) return false;

  const topDialog = dialogStack[dialogStack.length - 1];
  if (topDialog.handleKey) {
    return topDialog.handleKey(key);
  }

  return false;
}

/**
 * Render all dialogs in the stack (bottom to top).
 * @param {Object} screen - Screen object
 */
export function renderDialogs(screen) {
  // Render from bottom to top
  for (const dialog of dialogStack) {
    if (dialog.render) {
      dialog.render(screen);
    }
  }
}

/**
 * Sync dialog stack with legacy appState flags.
 * This maintains backward compatibility while we transition to the new system.
 */
function syncLegacyState() {
  // Clear all legacy flags first
  appState.showPalette = false;
  appState.showHelp = false;
  appState.showBookmarks = false;
  appState._quickSettingsOpen = false;
  // Note: showDetail, confirmAction, inputMode, showOnboarding, showWelcome
  // are handled by their respective modules

  // Set flags for dialogs in the stack
  for (const dialog of dialogStack) {
    const type = DIALOG_TYPES[dialog.id];
    if (type && type.stateKey) {
      if (type.stateKey === 'confirmAction') {
        appState[type.stateKey] = dialog._confirmAction || true;
      } else if (type.stateKey === 'inputMode') {
        appState[type.stateKey] = 'input';
      } else {
        appState[type.stateKey] = true;
      }
    }
  }
}

/**
 * Reset all legacy state flags.
 */
function resetLegacyState() {
  appState.showPalette = false;
  appState.showHelp = false;
  appState.showBookmarks = false;
  appState._quickSettingsOpen = false;
}

// ── Convenience functions for common dialogs ──

/**
 * Open the command palette.
 */
export function openPalette() {
  if (isDialogOpen('palette')) return;

  import('./palette.mjs').then(palette => {
    palette.open(false);
    pushDialog({
      id: 'palette',
      render: (screen) => palette.renderPalette(screen),
      handleKey: (key) => {
        const handled = palette.handleKey(key);
        if (!appState.showPalette && isDialogOpen('palette')) popDialog();
        return handled;
      },
      onClose: () => palette.close(),
    });
  });
}

/**
 * Open the help overlay.
 */
export function openHelp() {
  if (isDialogOpen('help')) return;

  import('./tabs/help.mjs').then(help => {
    appState.showHelp = true;
    appState.helpQuery = '';
    appState.helpCursor = 0;
    pushDialog({
      id: 'help',
      render: (screen) => help.render(screen),
      handleKey: (key) => {
        if (key === 'q') {
          popDialog();
          return true;
        }
        // The existing global help handler owns search and scrolling. Return
        // false so keys.mjs can continue into that handler.
        return false;
      },
      onClose: () => { appState.showHelp = false; },
    });
  });
}

/**
 * Open bookmarks overlay.
 */
export function openBookmarks() {
  if (isDialogOpen('bookmarks')) return;

  import('./bookmarks.mjs').then(bookmarks => {
    bookmarks.openBookmarks(false);
    pushDialog({
      id: 'bookmarks',
      render: (screen) => bookmarks.renderBookmarksOverlay(screen),
      handleKey: (key) => {
        const handled = bookmarks.handleKey(key);
        if (!appState.showBookmarks && isDialogOpen('bookmarks')) popDialog();
        return handled;
      },
      onClose: () => { appState.showBookmarks = false; },
    });
  });
}

/**
 * Open quick settings.
 */
export function openQuickSettings() {
  if (isDialogOpen('quickSettings')) return;

  import('./quick-settings.mjs').then(qs => {
    qs.open(false);
    pushDialog({
      id: 'quickSettings',
      render: (screen) => qs.renderQuickSettings(screen),
      handleKey: (key) => {
        const handled = qs.handleKey(key);
        if (!qs.isOpen() && isDialogOpen('quickSettings')) popDialog();
        return handled;
      },
      onClose: () => { appState._quickSettingsOpen = false; },
    });
  });
}
