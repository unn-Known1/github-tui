// Undo/Redo system for destructive actions.
// Supports bookmark deletes, notification unsubscribes, issue/PR closes, and star/unstar.

import { appState, render, showMessage } from './state.mjs';
import { addBookmark, removeBookmark } from './store.mjs';
import { starRepo, unstarRepo, getSubscription, setSubscription, deleteSubscription, closeIssue, reopenIssue } from './github.mjs';

// Tokens are resolved lazily via appState at execution time so undo/redo
// closures (up to MAX_UNDO long-lived entries) never extend the lifetime
// of a PAT string in memory beyond the API call itself.
const liveToken = () => appState.token;

// Undo stack: [{ type, data, undo, redo }]
const undoStack = [];
const redoStack = [];
const MAX_UNDO = 20;

export function pushUndo(entry) {
  // entry: { type, label, data, undo: async fn, redo: async fn }
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0; // clear redo on new action
}

// In-flight guard: undo()/redo() are async; a double keypress would pop two
// entries and race on push, losing entries or corrupting the stacks.
let _undoBusy = false;

export async function undo() {
  if (_undoBusy) return false;
  if (undoStack.length === 0) {
    showMessage('Nothing to undo', 'info');
    return false;
  }
  _undoBusy = true;
  const entry = undoStack.pop();
  try {
    await entry.undo();
    redoStack.push(entry);
    showMessage('Undone: ' + entry.label, 'success');
    render();
    return true;
  } catch (e) {
    showMessage('Undo failed: ' + (e.message || 'unknown'), 'error');
    // Drop the entry: the callback may have partially mutated state, so
    // re-queueing it would retry a broken op against diverged state.
    return false;
  } finally {
    _undoBusy = false;
  }
}

export async function redo() {
  if (_undoBusy) return false;
  if (redoStack.length === 0) {
    showMessage('Nothing to redo', 'info');
    return false;
  }
  _undoBusy = true;
  const entry = redoStack.pop();
  try {
    await entry.redo();
    undoStack.push(entry);
    showMessage('Redone: ' + entry.label, 'success');
    render();
    return true;
  } catch (e) {
    showMessage('Redo failed: ' + (e.message || 'unknown'), 'error');
    // Drop the entry for the same partial-mutation reason as undo().
    return false;
  } finally {
    _undoBusy = false;
  }
}

// Get undo/redo stack info for status display.
export function getUndoInfo() {
  return {
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoCount: undoStack.length,
    redoCount: redoStack.length,
    lastUndo: undoStack.length > 0 ? undoStack[undoStack.length - 1].label : null,
    lastRedo: redoStack.length > 0 ? redoStack[redoStack.length - 1].label : null,
  };
}

// ── Convenience functions for common destructive actions ──

export async function undoableRemoveBookmark(fullName, bookmarkData) {
  try {
    removeBookmark(fullName);
    pushUndo({
      type: 'bookmark-remove',
      label: 'Remove bookmark: ' + fullName,
      data: { fullName, bookmarkData },
      undo: async () => {
        addBookmark(bookmarkData);
      },
      redo: async () => {
        removeBookmark(fullName);
      },
    });
  } catch (e) {
    showMessage('Failed to remove bookmark: ' + (e.message || 'unknown'), 'error');
  }
}

export async function undoableUnstar(token, owner, name, repoData) {
  void token; // legacy param — token is resolved lazily via liveToken()
  try {
    await unstarRepo(liveToken(), owner, name);
    // Local ±1 keeps the UI responsive; reconciled with server on next fetch.
    if (repoData) repoData.stargazers_count = Math.max(0, (repoData.stargazers_count || 0) - 1);
    pushUndo({
      type: 'star-remove',
      label: 'Unstar: ' + owner + '/' + name,
      data: { owner, name },
      undo: async () => {
        await starRepo(liveToken(), owner, name);
        if (repoData) repoData.stargazers_count = (repoData.stargazers_count || 0) + 1;
      },
      redo: async () => {
        await unstarRepo(liveToken(), owner, name);
        if (repoData) repoData.stargazers_count = Math.max(0, (repoData.stargazers_count || 0) - 1);
      },
    });
  } catch (e) {
    showMessage('Failed to unstar: ' + (e.message || 'unknown'), 'error');
  }
}

export async function undoableUnsubscribe(token, owner, name) {
  void token; // legacy param — token is resolved lazily via liveToken()
  let previousSubscription = null;
  try { previousSubscription = await getSubscription(liveToken(), owner, name); } catch {}
  try {
    await deleteSubscription(liveToken(), owner, name);
    pushUndo({
      type: 'unsubscribe',
      label: 'Unsubscribe: ' + owner + '/' + name,
      data: { owner, name },
      undo: async () => {
        // Restore the exact prior watch state (releases-only / ignore / …),
        // not a hardcoded 'all notifications' default.
        if (previousSubscription) await setSubscription(liveToken(), owner, name, previousSubscription);
        else await setSubscription(liveToken(), owner, name, true);
      },
      redo: async () => {
        await deleteSubscription(liveToken(), owner, name);
      },
    });
  } catch (e) {
    showMessage('Failed to unsubscribe: ' + (e.message || 'unknown'), 'error');
  }
}

export async function undoableCloseIssue(token, owner, name, issueNumber, type = 'issues') {
  void token; // legacy param — token is resolved lazily via liveToken()
  try {
    await closeIssue(liveToken(), owner, name, issueNumber, type);
    pushUndo({
      type: 'issue-close',
      label: 'Close #' + issueNumber,
      data: { owner, name, issueNumber, type },
      undo: async () => {
        await reopenIssue(liveToken(), owner, name, issueNumber, type);
      },
      redo: async () => {
        await closeIssue(liveToken(), owner, name, issueNumber, type);
      },
    });
  } catch (e) {
    showMessage('Failed to close issue: ' + (e.message || 'unknown'), 'error');
  }
}
