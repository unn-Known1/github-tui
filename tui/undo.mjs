// Undo/Redo system for destructive actions.
// Supports bookmark deletes, notification unsubscribes, issue/PR closes, and star/unstar.

import { appState, render, showMessage } from './state.mjs';
import { addBookmark, removeBookmark } from './store.mjs';
import { starRepo, unstarRepo, setSubscription, deleteSubscription, closeIssue, reopenIssue } from './github.mjs';

// Undo stack: [{ type, data, undo, redo }]
const undoStack = [];
const redoStack = [];
const MAX_UNDO = 20;

// Register an undoable action.
export function pushUndo(entry) {
  // entry: { type, label, data, undo: async fn, redo: async fn }
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0; // clear redo on new action
}

// Undo the last action.
export async function undo() {
  if (undoStack.length === 0) {
    showMessage('Nothing to undo', 'info');
    return false;
  }
  const entry = undoStack.pop();
  try {
    await entry.undo();
    redoStack.push(entry);
    showMessage('Undone: ' + entry.label, 'success');
    render();
    return true;
  } catch (e) {
    showMessage('Undo failed: ' + (e.message || 'unknown'), 'error');
    // Push it back since undo failed
    undoStack.push(entry);
    return false;
  }
}

// Redo the last undone action.
export async function redo() {
  if (redoStack.length === 0) {
    showMessage('Nothing to redo', 'info');
    return false;
  }
  const entry = redoStack.pop();
  try {
    await entry.redo();
    undoStack.push(entry);
    showMessage('Redone: ' + entry.label, 'success');
    render();
    return true;
  } catch (e) {
    showMessage('Redo failed: ' + (e.message || 'unknown'), 'error');
    redoStack.push(entry);
    return false;
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

// Bookmark removal with undo.
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

// Star removal with undo.
export async function undoableUnstar(token, owner, name, repoData) {
  try {
    await unstarRepo(token, owner, name);
    if (repoData) repoData.stargazers_count = Math.max(0, (repoData.stargazers_count || 0) - 1);
    pushUndo({
      type: 'star-remove',
      label: 'Unstar: ' + owner + '/' + name,
      data: { owner, name, repoData },
      undo: async () => {
        await starRepo(token, owner, name);
        if (repoData) repoData.stargazers_count = (repoData.stargazers_count || 0) + 1;
      },
      redo: async () => {
        await unstarRepo(token, owner, name);
        if (repoData) repoData.stargazers_count = Math.max(0, (repoData.stargazers_count || 0) - 1);
      },
    });
  } catch (e) {
    showMessage('Failed to unstar: ' + (e.message || 'unknown'), 'error');
  }
}

// Unsubscribe with undo.
export async function undoableUnsubscribe(token, owner, name) {
  try {
    await deleteSubscription(token, owner, name);
    pushUndo({
      type: 'unsubscribe',
      label: 'Unsubscribe: ' + owner + '/' + name,
      data: { owner, name },
      undo: async () => {
        await setSubscription(token, owner, name, true);
      },
      redo: async () => {
        await deleteSubscription(token, owner, name);
      },
    });
  } catch (e) {
    showMessage('Failed to unsubscribe: ' + (e.message || 'unknown'), 'error');
  }
}

// Issue/PR close with undo.
export async function undoableCloseIssue(token, owner, name, issueNumber, type = 'issues') {
  try {
    await closeIssue(token, owner, name, issueNumber, type);
    pushUndo({
      type: 'issue-close',
      label: 'Close #' + issueNumber,
      data: { owner, name, issueNumber, type },
      undo: async () => {
        await reopenIssue(token, owner, name, issueNumber, type);
      },
      redo: async () => {
        await closeIssue(token, owner, name, issueNumber, type);
      },
    });
  } catch (e) {
    showMessage('Failed to close issue: ' + (e.message || 'unknown'), 'error');
  }
}
