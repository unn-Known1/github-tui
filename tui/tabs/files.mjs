// File explorer — file tree + viewer + save/clone/zipball.
// New in W1. Rendered as a sub-pane of Analyze details when detailsPane === 'files'.
//
// State (lives on appState):
//   filesPath     : current dir path inside the repo (empty = root)
//   filesRef      : current branch / ref (default = repo.default_branch)
//   filesEntries  : array of { name, type:'dir'|'file', size, path }
//   filesSelected : index in filesEntries
//   filesScroll   : top of viewport
//   fileText      : raw text content when viewing a file
//   fileViewing   : path of the file being viewed, or null when on the tree
//   fileScroll    : scroll inside file viewer
//   filesBranches : list of branches (lazily loaded)
//   filesBranchPicker : boolean — branch picker overlay open?
//   filesBranchCursor : index inside branches

import { appState, render, startAsync, isStale, showMessage } from '../state.mjs';
import {
  getRepoContents, getRepoFile, getBranches, getZipballUrl,
  getFileCommits, downloadToFile,
} from '../github.mjs';
import {
  formatBytes, relTime, writeFileSafe, safeCwdJoin, runCommand,
  ghCloneUrl, copyToClipboard, dirExists,
} from '../utils.mjs';
import { color } from '../theme.mjs';
import { join } from 'path';
import { writeFileSync, existsSync, mkdirSync } from 'fs';

// Limit how big a single file we'll fetch into memory (the API caps at 1MB).
const MAX_VIEW_BYTES = 1_000_000;
const MAX_BULK_FILES = 500;

function repoOwnerName() {
  const r = appState.repoDetails;
  if (!r) return [null, null];
  return r.full_name.split('/');
}

export async function openFilesPane() {
  if (!appState.repoDetails) {
    showMessage('Open a repo on Analyze first', 'warning');
    return;
  }
  appState.detailsPane = 'files';
  appState.detailsScroll = 0;
  appState.filesPath = '';
  appState.filesRef = appState.repoDetails.default_branch || 'main';
  appState.filesSelected = 0;
  appState.filesScroll = 0;
  appState.fileViewing = null;
  appState.fileText = '';
  appState.fileScroll = 0;
  appState.filesBranches = [];
  appState.filesBranchPicker = false;
  appState.filesBranchCursor = 0;
  await loadTree();
}

export async function loadTree() {
  const [owner, name] = repoOwnerName();
  if (!owner) return;
  const gen = startAsync();
  appState.loading = true;
  render();
  try {
    const list = await getRepoContents(
      appState.token, owner, name, appState.filesPath, appState.filesRef);
    if (isStale(gen)) return;
    const arr = Array.isArray(list) ? list : [list];
    // Sort: directories first, then files; alpha within each group.
    arr.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    appState.filesEntries = arr;
    appState.filesSelected = 0;
    appState.filesScroll = 0;
    appState.fileViewing = null;
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to load: ' + e.message, 'error');
    appState.filesEntries = [];
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

export async function drillInto() {
  const ent = appState.filesEntries && appState.filesEntries[appState.filesSelected];
  if (!ent) return;
  if (ent.type === 'dir') {
    appState.filesPath = ent.path;
    await loadTree();
  } else if (ent.type === 'file') {
    await viewFile(ent);
  }
}

export async function goUp() {
  if (appState.fileViewing) {
    // Leaving file viewer back to tree.
    appState.fileViewing = null;
    appState.fileText = '';
    appState.fileScroll = 0;
    render();
    return;
  }
  if (!appState.filesPath) return false; // tell caller we're already at root
  const parts = appState.filesPath.split('/');
  parts.pop();
  appState.filesPath = parts.join('/');
  await loadTree();
  return true;
}

export async function viewFile(ent) {
  const [owner, name] = repoOwnerName();
  if (!owner) return;
  if (ent.size != null && ent.size > MAX_VIEW_BYTES) {
    showMessage('File too large to view (' + formatBytes(ent.size) +
      '). Use [s] to save instead.', 'warning');
    return;
  }
  const gen = startAsync();
  appState.loading = true;
  render();
  try {
    const text = await getRepoFile(
      appState.token, owner, name, ent.path, appState.filesRef);
    if (isStale(gen)) return;
    appState.fileViewing = ent.path;
    appState.fileText = typeof text === 'string' ? text : String(text);
    appState.fileScroll = 0;
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to view: ' + e.message, 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

export async function openBranchPicker() {
  const [owner, name] = repoOwnerName();
  if (!owner) return;
  if (appState.filesBranches.length === 0) {
    const gen = startAsync();
    appState.loading = true;
    render();
    try {
      const list = await getBranches(appState.token, owner, name, 50);
      if (isStale(gen)) return;
      appState.filesBranches = Array.isArray(list) ? list : [];
    } catch (e) {
      if (!isStale(gen)) showMessage('Branches: ' + e.message, 'error');
      appState.filesBranches = [];
    }
    appState.loading = false;
  }
  appState.filesBranchPicker = true;
  appState.filesBranchCursor = Math.max(0,
    appState.filesBranches.findIndex(b => b.name === appState.filesRef));
  render();
}

export async function pickBranch() {
  const b = appState.filesBranches[appState.filesBranchCursor];
  if (!b) { appState.filesBranchPicker = false; render(); return; }
  appState.filesRef = b.name;
  appState.filesBranchPicker = false;
  appState.filesPath = '';
  appState.fileViewing = null;
  await loadTree();
  showMessage('Switched to branch ' + b.name, 'success');
}

// ─── Disk actions ─────────────────────────────────────────────────

// Save the currently-viewed file (or the highlighted file in the tree)
// into CWD, preserving its name. Refuses to overwrite without confirmation.
export async function saveCurrentFile() {
  let path, content;
  if (appState.fileViewing) {
    path = appState.fileViewing;
    content = appState.fileText;
  } else {
    const ent = appState.filesEntries && appState.filesEntries[appState.filesSelected];
    if (!ent || ent.type !== 'file') {
      showMessage('Select a file to save', 'warning');
      return;
    }
    const [owner, name] = repoOwnerName();
    try {
      content = await getRepoFile(
        appState.token, owner, name, ent.path, appState.filesRef);
    } catch (e) { showMessage('Save: ' + e.message, 'error'); return; }
    path = ent.path;
  }
  try {
    const base = path.split('/').pop();
    const target = writeFileSafe(base, content);
    showMessage('Saved → ' + target, 'success');
  } catch (e) { showMessage('Save failed: ' + e.message, 'error'); }
}

// Save current directory (and everything in it, recursively) into CWD.
// Walks tree with a small concurrency cap so we don't hammer the API.
export async function saveCurrentFolder() {
  const [owner, name] = repoOwnerName();
  if (!owner) return;
  const root = appState.filesPath || '';
  const repoName = name + (root ? '-' + root.replace(/\//g, '_') : '');
  showMessage('Walking tree…', 'info');
  let count = 0;
  let bytes = 0;
  const stack = [root];
  const gen = startAsync();
  const seenFiles = [];
  try {
    // BFS to enumerate files.
    while (stack.length) {
      if (isStale(gen)) return;
      const cur = stack.shift();
      const list = await getRepoContents(
        appState.token, owner, name, cur, appState.filesRef);
      const arr = Array.isArray(list) ? list : [list];
      for (const e of arr) {
        if (e.type === 'dir') stack.push(e.path);
        else if (e.type === 'file') {
          seenFiles.push(e);
          if (seenFiles.length > MAX_BULK_FILES) {
            showMessage('Aborting — folder has >' + MAX_BULK_FILES +
              ' files. Use zipball [Z] instead.', 'warning');
            return;
          }
        }
      }
    }
    showMessage('Downloading ' + seenFiles.length + ' files…', 'info');
    render();
    // Concurrency cap 4 — fetch + write each.
    let cursor = 0;
    const worker = async () => {
      while (cursor < seenFiles.length) {
        if (isStale(gen)) return;
        const e = seenFiles[cursor++];
        try {
          const txt = await getRepoFile(
            appState.token, owner, name, e.path, appState.filesRef);
          const rel = repoName + '/' + e.path.replace(
            new RegExp('^' + root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/?'), '');
          writeFileSafe(rel, txt);
          count++;
          bytes += (typeof txt === 'string' ? Buffer.byteLength(txt) : txt.length || 0);
          if (count % 5 === 0) {
            showMessage('Saved ' + count + '/' + seenFiles.length + '…', 'info');
            render();
          }
        } catch (e2) { /* skip files we can't fetch */ }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (!isStale(gen))
      showMessage('Saved ' + count + ' files (' + formatBytes(bytes) +
        ') → ./' + repoName + '/', 'success');
  } catch (e) {
    if (!isStale(gen)) showMessage('Folder save failed: ' + e.message, 'error');
  }
}

// Download repo zipball into CWD via streaming https.
export async function downloadZipball() {
  const [owner, name] = repoOwnerName();
  if (!owner) return;
  const ref = appState.filesRef || 'main';
  const url = getZipballUrl(owner, name, ref);
  const dest = safeCwdJoin(name + '-' + ref + '.zip');
  showMessage('Downloading zipball…', 'info');
  render();
  try {
    const res = await downloadToFile(url, dest, appState.token);
    showMessage('Zip → ' + dest + ' (' + formatBytes(res.bytes) + ')', 'success');
  } catch (e) {
    showMessage('Zipball failed: ' + e.message, 'error');
  }
}

// git clone into CWD. Shells out to the user's `git` binary so history,
// hooks, submodules etc. all behave correctly.
export async function cloneIntoCwd(opts = {}) {
  const [owner, name] = repoOwnerName();
  if (!owner) return;
  const dest = safeCwdJoin(name);
  if (dirExists(dest)) {
    showMessage('Directory ./' + name + ' already exists — refusing to clone', 'warning');
    return;
  }
  const url = ghCloneUrl(owner, name);
  const args = ['clone'];
  if (opts.shallow) args.push('--depth', '1');
  args.push(url, name);
  showMessage('git ' + args.join(' ') + ' …', 'info');
  render();
  try {
    const code = await runCommand('git', args);
    if (code === 0) showMessage('Cloned into ./' + name, 'success');
    else showMessage('git exited ' + code, 'error');
  } catch (e) { showMessage('Clone failed: ' + e.message, 'error'); }
}

// gh CLI variant for private repos (auth handled by gh).
export async function ghCloneIntoCwd() {
  const [owner, name] = repoOwnerName();
  if (!owner) return;
  const dest = safeCwdJoin(name);
  if (dirExists(dest)) {
    showMessage('Directory ./' + name + ' already exists — refusing to clone', 'warning');
    return;
  }
  showMessage('gh repo clone ' + owner + '/' + name + ' …', 'info');
  render();
  try {
    const code = await runCommand('gh', ['repo', 'clone', owner + '/' + name]);
    if (code === 0) showMessage('Cloned via gh into ./' + name, 'success');
    else showMessage('gh exited ' + code + ' (is gh installed & authed?)', 'error');
  } catch (e) { showMessage('gh clone failed: ' + e.message, 'error'); }
}

// Copy raw github URL to clipboard for the current file.
export function copyRawUrl() {
  const [owner, name] = repoOwnerName();
  if (!owner) return;
  const path = appState.fileViewing ||
    (appState.filesEntries[appState.filesSelected] || {}).path;
  if (!path) return;
  const url = 'https://raw.githubusercontent.com/' + owner + '/' + name +
    '/' + appState.filesRef + '/' + path;
  if (copyToClipboard(url)) showMessage('Copied raw URL', 'success');
  else showMessage('Clipboard copy failed', 'error');
}

// ─── Render ───────────────────────────────────────────────────────

function renderBreadcrumb(screen, y, owner, name) {
  const W = screen.width;
  const parts = ['🌳 ' + owner + '/' + name + '@' + appState.filesRef];
  if (appState.filesPath) {
    for (const p of appState.filesPath.split('/')) parts.push(p);
  }
  const crumb = parts.join(' › ');
  screen.writeStr(4, y, crumb.substring(0, W - 6), color('accent'));
}

export function renderFilesPane(screen, y, maxH) {
  const W = screen.width;
  const [owner, name] = repoOwnerName();
  if (!owner) return;

  if (appState.fileViewing) { renderFileViewer(screen, y, maxH); return; }

  renderBreadcrumb(screen, y, owner, name);
  screen.hline(y + 1, '─');

  const entries = appState.filesEntries || [];
  const headerY = y + 2;
  screen.writeStr(4, headerY, ' Type', 'bright');
  screen.writeStr(11, headerY, 'Name', 'bright');
  screen.writeStr(W - 22, headerY, 'Size', 'bright');
  screen.writeStr(W - 10, headerY, 'Action', 'bright');

  const rows = Math.max(1, maxH - 5);
  const start = appState.filesScroll || 0;
  // include a synthetic ".." entry when not at root
  const upRow = appState.filesPath ? [{ name: '..', type: 'up' }] : [];
  const allEntries = [...upRow, ...entries];

  for (let i = 0; i < rows && start + i < allEntries.length; i++) {
    const ent = allEntries[start + i];
    const row = headerY + 1 + i;
    const sel = start + i === appState.filesSelected;
    screen.writeStr(2, row, sel ? '▶' : ' ', sel ? 'bright' : null);

    let icon, c;
    if (ent.type === 'up')         { icon = '↩'; c = 'dim'; }
    else if (ent.type === 'dir')   { icon = '📁'; c = color('accent'); }
    else if (ent.type === 'file')  { icon = '📄'; c = null; }
    else                            { icon = '?';  c = 'dim'; }
    screen.writeStr(4, row, icon, c);

    screen.writeStr(11, row, ent.name.substring(0, W - 36), sel ? 'bright' : null);

    if (ent.type === 'file') {
      screen.writeStr(W - 22, row, formatBytes(ent.size || 0), 'dim');
    } else if (ent.type === 'dir') {
      screen.writeStr(W - 22, row, '<dir>', 'dim');
    }
  }

  // Footer hint.
  const footerY = headerY + 1 + Math.min(rows, allEntries.length) + 1;
  if (footerY < y + maxH) {
    screen.writeStr(4, footerY,
      '[Enter] Open  [s] Save file  [S] Save folder  [Z] Zipball  [C] git clone  [G] gh clone  [B] Branch  [y] Copy raw URL  [Esc] Back',
      'dim');
  }

  if (appState.filesBranchPicker) renderBranchPicker(screen);
}

function renderFileViewer(screen, y, maxH) {
  const W = screen.width;
  screen.writeStr(4, y, '📄 ' + appState.fileViewing,
    color('accent'));
  screen.writeStr(W - 12, y, '[' +
    formatBytes(Buffer.byteLength(appState.fileText || '')) + ']', 'dim');
  screen.hline(y + 1, '─');

  const lines = (appState.fileText || '').split(/\r?\n/);
  const rows = Math.max(1, maxH - 4);
  const start = appState.fileScroll || 0;
  const lineNumW = String(lines.length).length;
  for (let i = 0; i < rows && start + i < lines.length; i++) {
    const row = y + 2 + i;
    const lnNum = String(start + i + 1).padStart(lineNumW, ' ');
    screen.writeStr(4, row, lnNum, 'dim');
    screen.writeStr(4 + lineNumW + 1, row, '│', 'dim');
    let ln = lines[start + i] || '';
    const lineStyle = decorateLine(ln, appState.fileViewing);
    screen.writeStr(4 + lineNumW + 3, row,
      ln.substring(0, W - 8 - lineNumW), lineStyle);
  }

  const footerY = y + 2 + Math.min(rows, lines.length) + 1;
  if (footerY < y + maxH) {
    screen.writeStr(4, footerY,
      'Line ' + (start + 1) + '-' + Math.min(start + rows, lines.length) +
      ' of ' + lines.length +
      '  [↑↓] scroll  [s] Save  [y] Copy URL  [Y] Copy contents  [Esc] Back',
      'dim');
  }
}

function decorateLine(ln, path) {
  if (!path) return null;
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (/^\s*(#|\/\/)/.test(ln)) return 'dim';
  if (/^\s*```/.test(ln)) return 'dim';
  if (ext === 'md') {
    if (/^#{1,6}\s/.test(ln)) return 'bright';
    if (/^\s*[-*+]\s/.test(ln)) return color('accent');
  }
  if (['js','mjs','ts','tsx','jsx','py','go','rs','java','c','cpp','h'].includes(ext)) {
    if (/^\s*(import|export|from|require|use|package|class|function|def|const|let|var|fn|impl|trait|pub|module|namespace)\b/.test(ln))
      return color('accent');
  }
  return null;
}

function renderBranchPicker(screen) {
  const W = screen.width, H = screen.height;
  const boxW = Math.min(50, W - 4);
  const boxH = Math.min(appState.filesBranches.length + 4, H - 4);
  const x0 = Math.floor((W - boxW) / 2);
  const y0 = Math.floor((H - boxH) / 2);
  for (let yy = y0; yy < y0 + boxH; yy++) {
    for (let xx = x0; xx < x0 + boxW; xx++) screen.setCell(xx, yy, ' ', null);
  }
  screen.box(x0, y0, boxW, boxH, 'Pick Branch');
  for (let i = 0; i < appState.filesBranches.length && i < boxH - 3; i++) {
    const b = appState.filesBranches[i];
    const sel = i === appState.filesBranchCursor;
    screen.writeStr(x0 + 1, y0 + 1 + i, sel ? '▶' : ' ', sel ? 'bright' : null);
    screen.writeStr(x0 + 3, y0 + 1 + i,
      (b.name + (b.name === appState.filesRef ? ' (current)' : '')).substring(0, boxW - 5),
      sel ? 'bright' : null);
  }
}

// ─── Key handlers (consumed by analyze.mjs when detailsPane === 'files') ──

export function up() {
  if (appState.filesBranchPicker) {
    appState.filesBranchCursor = Math.max(0, appState.filesBranchCursor - 1);
    render(); return;
  }
  if (appState.fileViewing) {
    appState.fileScroll = Math.max(0, appState.fileScroll - 1); render(); return;
  }
  appState.filesSelected = Math.max(0, appState.filesSelected - 1);
  if (appState.filesSelected < appState.filesScroll) appState.filesScroll = appState.filesSelected;
  render();
}

export function down(screen) {
  if (appState.filesBranchPicker) {
    appState.filesBranchCursor = Math.min(
      appState.filesBranches.length - 1, appState.filesBranchCursor + 1);
    render(); return;
  }
  if (appState.fileViewing) {
    const lines = (appState.fileText || '').split(/\r?\n/).length;
    appState.fileScroll = Math.min(
      Math.max(0, lines - 1), appState.fileScroll + 1);
    render(); return;
  }
  const len = (appState.filesEntries || []).length + (appState.filesPath ? 1 : 0);
  appState.filesSelected = Math.min(len - 1, appState.filesSelected + 1);
  const visible = Math.max(1, (screen ? screen.height : 24) - 12);
  if (appState.filesSelected >= appState.filesScroll + visible)
    appState.filesScroll = appState.filesSelected - visible + 1;
  render();
}

// 'g' top, 'G' bottom.
export function jumpTop() {
  if (appState.fileViewing) appState.fileScroll = 0;
  else { appState.filesSelected = 0; appState.filesScroll = 0; }
  render();
}
export function jumpBottom() {
  if (appState.fileViewing) {
    const lines = (appState.fileText || '').split(/\r?\n/).length;
    appState.fileScroll = Math.max(0, lines - 1);
  } else {
    const len = (appState.filesEntries || []).length + (appState.filesPath ? 1 : 0);
    appState.filesSelected = Math.max(0, len - 1);
  }
  render();
}

export function pgDown(screen) {
  const step = Math.max(5, (screen ? screen.height : 24) - 14);
  for (let i = 0; i < step; i++) down(screen);
}
export function pgUp(screen) {
  const step = Math.max(5, (screen ? screen.height : 24) - 14);
  for (let i = 0; i < step; i++) up();
}

export function enter() {
  if (appState.filesBranchPicker) { pickBranch(); return; }
  drillInto();
}

export async function backOrLeave() {
  if (appState.filesBranchPicker) { appState.filesBranchPicker = false; render(); return true; }
  if (appState.fileViewing) { await goUp(); return true; }
  if (appState.filesPath) { await goUp(); return true; }
  return false; // let analyze.handleBack take over
}

export const keys = {
  's': () => saveCurrentFile(),
  'S': () => saveCurrentFolder(),
  'Z': () => downloadZipball(),
  'C': () => cloneIntoCwd(),
  'G': () => ghCloneIntoCwd(),
  'B': () => openBranchPicker(),
  'Y': () => {
    if (appState.fileViewing) {
      if (copyToClipboard(appState.fileText)) showMessage('File contents copied', 'success');
      else showMessage('Too big for OSC-52 — use [s] save instead', 'warning');
    }
  },
  'g': jumpTop,
  // capital 'G' is used by clone — bottom-jump uses end of file viewer's scroll keys.
};

// Capital-G already maps to gh-clone above. Provide a 'bottom' action via the
// palette only (or via 'end' key if your terminal sends '\x1b[F').
export { jumpBottom as bottom };

// (no extra exports needed — analyze.mjs imports directly from utils.mjs)
