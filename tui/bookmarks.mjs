// Bookmarks overlay — browse, open, delete, and export bookmarks.
// Extracted from keys.mjs for maintainability.

import { appState, render, showMessage } from './state.mjs';
import { loadBookmarks, removeBookmark } from './store.mjs';
import { openUrl, copyToClipboard } from './utils.mjs';

export function openBookmarks() {
  appState.bookmarks = loadBookmarks();
  appState.showBookmarks = true;
  appState.bookmarksCursor = 0;
  appState.bookmarksScroll = 0;
  render();
}

export function closeBookmarks() {
  appState.showBookmarks = false;
  render();
}

export function up() {
  appState.bookmarksCursor = Math.max(0, appState.bookmarksCursor - 1);
  render();
}

export function down() {
  const max = appState.bookmarks.length - 1;
  appState.bookmarksCursor = Math.min(max, appState.bookmarksCursor + 1);
  render();
}

export function enter() {
  const bm = appState.bookmarks[appState.bookmarksCursor];
  if (bm && bm.url) {
    openUrl(bm.url).then(res => {
      if (res.ok) showMessage('Opened ' + bm.full_name, 'success');
      else showMessage(res.error || 'Open failed', 'error');
    });
  }
  appState.showBookmarks = false;
  render();
}

export function deleteCurrent() {
  const bm = appState.bookmarks[appState.bookmarksCursor];
  if (bm) {
    removeBookmark(bm.id || bm.full_name);
    appState.bookmarks = loadBookmarks();
    appState.bookmarksCursor = Math.min(appState.bookmarksCursor, Math.max(0, appState.bookmarks.length - 1));
    showMessage('Removed bookmark: ' + bm.full_name, 'info');
  }
  render();
}

export function copyUrl() {
  const bm = appState.bookmarks[appState.bookmarksCursor];
  if (bm && bm.url && copyToClipboard(bm.url)) showMessage('Copied URL', 'success');
  else showMessage('Clipboard copy failed', 'error');
  render();
}

export function exportMarkdown() {
  const bm = appState.bookmarks;
  if (bm.length === 0) { showMessage('No bookmarks to export', 'warning'); return; }
  const md = '# Bookmarks\n\n' + bm.map(b => `- [${b.full_name}](${b.url})`).join('\n');
  if (copyToClipboard(md)) showMessage('Copied bookmarks as Markdown', 'success');
  else showMessage('Clipboard copy failed', 'error');
}

export function handleKey(key) {
  if (!appState.showBookmarks) return false;
  if (key === '\x1b' || key === 'q' || key === 'b') { closeBookmarks(); return true; }
  if (key === '\x1b[A' || key === 'k') { up(); return true; }
  if (key === '\x1b[B' || key === 'j') { down(); return true; }
  if (key === '\r' || key === '\n') { enter(); return true; }
  if (key === 'd' || key === 'D') { deleteCurrent(); return true; }
  if (key === 'y') { copyUrl(); return true; }
  return false;
}
