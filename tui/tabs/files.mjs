// File explorer — file tree + viewer + save/clone/zipball.
// New in W1. Rendered as a sub-pane of Explore details when detailsPane === 'files'.

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

import { appState, render, startAsync, isStale, showMessage, confirm } from '../state.mjs';
import {
  getRepoContents, getRepoFile, getBranches, getZipballUrl,
  getFileCommits, downloadToFile,
} from '../github.mjs';
import {
  formatBytes, relTime, writeFileSafe, safeCwdJoin, runCommand,
  ghCloneUrl, copyToClipboard, dirExists, wrapTextWithMap, wrapText,
} from '../utils.mjs';
import { color } from '../theme.mjs';
import { join, resolve } from 'path';

// Limit how big a single file we'll fetch into memory (the API caps at 1MB).
const MAX_VIEW_BYTES = 1_000_000;
const MAX_BULK_FILES = 500;

// wrap a destructive I/O op behind state.confirm() so pressing `Z`,
// `G`, `C`, or `S` in the files pane never dumps a zipball / clones over
// an existing directory / walks a 500-file folder without an explicit
// yes. Re-entry is naturally rejected by confirm() ("a confirmation is
// already pending" toast) so a stray double-press is harmless.
function runWithConfirm(message, op, title) {
  confirm(message, () => {
    Promise.resolve().then(op).catch(e => {
      showMessage((e && e.message) || 'Operation failed', 'error');
    });
  }, title || 'Confirm destructive operation');
}

function repoOwnerName() {
  const r = appState.repoDetails;
  if (!r) return [null, null];
  return r.full_name.split('/');
}

export function getSelectedEntry() {
  const entries = appState.filesEntries || [];
  const hasUp = !!appState.filesPath;
  if (hasUp) {
    if (appState.filesSelected === 0) {
      return { name: '..', type: 'up' };
    }
    return entries[appState.filesSelected - 1];
  }
  return entries[appState.filesSelected];
}

export async function openFilesPane() {
  if (!appState.repoDetails) {
    showMessage('Open a repo on Explore first', 'warning');
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
  // Clear any stale text selection from a previous pane.
  appState.textSelectionMode = 'none';
  appState.textSelectStart = null;
  appState.textSelectEnd = null;
  await loadTree();
}

export async function loadTree() {
  const [owner, name] = repoOwnerName();
  if (!owner) return;
  const gen = startAsync('files-tree');
  appState.loading = true;
  render();
  try {
    const list = await getRepoContents(
      appState.token, owner, name, appState.filesPath, appState.filesRef, gen.signal);
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
  } finally {
    // always clear loading flag regardless of how we exit the try.
    appState.loading = false;
  }
  if (!isStale(gen)) render();
}

export async function drillInto() {
  const ent = getSelectedEntry();
  if (!ent) return;
  if (ent.type === 'up') {
    await goUp();
  } else if (ent.type === 'dir') {
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
    // Clear text selection when leaving the file viewer.
    appState.textSelectionMode = 'none';
    appState.textSelectStart = null;
    appState.textSelectEnd = null;
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
  if (!ent || !ent.path) return;
  if (ent.size != null && ent.size > MAX_VIEW_BYTES) {
    showMessage('File too large to view (' + formatBytes(ent.size) +
      '). Use [s] to save instead.', 'warning');
    return;
  }
  // capture path/size BEFORE await so a stale-result return can't
  // overwrite fileViewing with the wrong path if the user navigated and the
  // selection refilled with a different entry.
  const targetPath = ent.path;
  const gen = startAsync('files-view');
  appState.loading = true;
  render();
  try {
    const text = await getRepoFile(
      appState.token, owner, name, targetPath, appState.filesRef, gen.signal);
    if (isStale(gen)) return;
    appState.fileViewing = targetPath;
    appState.fileText = typeof text === 'string' ? text : String(text);
    appState.fileScroll = 0;
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to view: ' + e.message, 'error');
  } finally {
    appState.loading = false;
  }
  if (!isStale(gen)) render();
}

export async function openBranchPicker() {
  const [owner, name] = repoOwnerName();
  if (!owner) return;
  if (appState.filesBranches.length === 0) {
    const gen = startAsync('files-branches');
    appState.loading = true;
    render();
    try {
      const list = await getBranches(appState.token, owner, name, 50, gen.signal);
      if (isStale(gen)) return;
      appState.filesBranches = Array.isArray(list) ? list : [];
    } catch (e) {
      if (!isStale(gen)) showMessage('Branches: ' + e.message, 'error');
      appState.filesBranches = [];
    } finally {
      appState.loading = false;  // always clear
    }
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
    const ent = getSelectedEntry();
    if (!ent || ent.type !== 'file') {
      showMessage('Select a file to save', 'warning');
      return;
    }
    const [owner, name] = repoOwnerName();
    try {
      content = await getRepoFile(
        appState.token, owner, name, ent.path, appState.filesRef, undefined);
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
export function saveCurrentFolder() {
  const [owner, name] = repoOwnerName();
  if (!owner) return;
  const root = appState.filesPath || '';
  const repoName = name + (root ? '-' + root.replace(/\//g, '_') : '');
  runWithConfirm(
    'Save folder recursively into ./' + repoName + '/? (up to ' +
      MAX_BULK_FILES + ' files)',
    _saveCurrentFolderImpl,
    'Save Folder'
  );
}

async function _saveCurrentFolderImpl() {
  const [owner, name] = repoOwnerName();
  if (!owner) return;
  const root = appState.filesPath || '';
  const repoName = name + (root ? '-' + root.replace(/\//g, '_') : '');
  showMessage('Walking tree…', 'info');
  let count = 0;
  let bytes = 0;
  let abortedAt = 0;
  const stack = [root];
  const gen = startAsync('files-bulk');
  const seenFiles = [];
  appState.loading = true;   // set up-front so finally can clear it
  try {
    // BFS to enumerate files.
    while (stack.length) {
      if (isStale(gen) || gen.signal.aborted) return;
      const cur = stack.shift();
      const list = await getRepoContents(
        appState.token, owner, name, cur, appState.filesRef, gen.signal);
      if (isStale(gen) || gen.signal.aborted) return;
      const arr = Array.isArray(list) ? list : [list];
      for (const e of arr) {
        if (e.type === 'dir') stack.push(e.path);
        else if (e.type === 'file') {
          seenFiles.push(e);
          if (seenFiles.length > MAX_BULK_FILES) {
            abortedAt = seenFiles.length;
            break;
          }
        }
      }
      if (abortedAt > 0) break;
    }
    if (abortedAt > 0) {
      showMessage(
        'Folder has >' + MAX_BULK_FILES + ' files (found ' + abortedAt + '). ' +
        'Saving first ' + seenFiles.length + ' — use zipball [Z] for the rest.',
        'warning'
      );
      render();
    }
    if (seenFiles.length > 0) {
      showMessage('Downloading ' + seenFiles.length + ' files…', 'info');
      render();
      let cursor = 0;
      const nextFile = () => {
        if (cursor >= seenFiles.length) return null;
        return seenFiles[cursor++];
      };
      const worker = async () => {
        while (true) {
          if (isStale(gen) || gen.signal.aborted) return;
          const e = nextFile();
          if (!e) break;
          try {
            const txt = await getRepoFile(
              appState.token, owner, name, e.path, appState.filesRef, gen.signal);
            const rel = repoName + '/' + e.path.replace(
              new RegExp('^' + root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/?'), '');
            writeFileSafe(rel, txt);
            count++;
            bytes += (typeof txt === 'string' ? Buffer.byteLength(txt) : (txt.length || 0));
            if (count % 5 === 0) {
              if (isStale(gen)) return;
              showMessage('Saved ' + count + '/' + seenFiles.length + '…', 'info');
              render();
            }
          } catch (e2) { /* skip files we can't fetch */ }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      if (!isStale(gen)) {
        const truncatedNote = abortedAt > 0
          ? ' (truncated — folder had ' + abortedAt + ' files)'
          : '';
        showMessage('Saved ' + count + ' files (' + formatBytes(bytes) +
          ') → ./' + repoName + '/' + truncatedNote, abortedAt > 0 ? 'warning' : 'success');
      }
    }
  } catch (e) {
    if (!isStale(gen)) showMessage('Folder save failed: ' + e.message, 'error');
  } finally {
    appState.loading = false;   // always clear
    if (!isStale(gen)) render();
  }
}

// Download repo zipball into CWD via streaming https.
export function downloadZipball() {
  const [owner, name] = repoOwnerName();
  if (!owner) return;
  const ref = appState.filesRef || 'main';
  runWithConfirm(
    'Download ' + name + '-' + ref + '.zip into CWD?',
    _downloadZipballImpl,
    'Download Zipball'
  );
}

async function _downloadZipballImpl() {
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

// git clone into CWD. Shells out to the user's `git` binary so
// history, hooks, submodules etc. all behave correctly.
export function cloneIntoCwd(opts = {}) {
  const [owner, name] = repoOwnerName();
  if (!owner) return;
  const isShallow = !!opts.shallow;
  runWithConfirm(
    'git clone ' + owner + '/' + name + ' into ./' + name +
      (isShallow ? ' (shallow)?' : '?'),
    () => _cloneIntoCwdImpl(opts),
    'Clone Repo'
  );
}

async function _cloneIntoCwdImpl(opts = {}) {
  const [owner, name] = repoOwnerName();
  if (!owner) return;
  const dest = join(process.cwd(), name);
  if (dirExists(dest)) {
    showMessage('Directory ' + name + ' already exists — refusing to clone', 'warning');
    return;
  }
  const url = ghCloneUrl(owner, name);
  const args = ['clone'];
  if (opts.shallow) args.push('--depth', '1');
  args.push(url, name);
  showMessage('git ' + args.join(' ') + ' …', 'info');
  render();
  try {
    const code = await runCommand('git', args, { cwd: process.cwd() });
    if (code === 0) showMessage('Cloned into ./' + name, 'success');
    else showMessage('git exited ' + code, 'error');
  } catch (e) { showMessage('Clone failed: ' + e.message, 'error'); }
}

// gh CLI variant for private repos (auth handled by gh).
export function ghCloneIntoCwd() {
  const [owner, name] = repoOwnerName();
  if (!owner) return;
  runWithConfirm(
    'gh repo clone ' + owner + '/' + name + ' into ./' + name + '?',
    _ghCloneIntoCwdImpl,
    'Clone via gh'
  );
}

async function _ghCloneIntoCwdImpl() {
  const [owner, name] = repoOwnerName();
  if (!owner) return;
  const dest = join(process.cwd(), name);
  if (dirExists(dest)) {
    showMessage('Directory ' + name + ' already exists — refusing to clone', 'warning');
    return;
  }
  showMessage('gh repo clone ' + owner + '/' + name + ' …', 'info');
  render();
  try {
    const code = await runCommand('gh', ['repo', 'clone', owner + '/' + name], { cwd: process.cwd() });
    if (code === 0) showMessage('Cloned via gh into ./' + name, 'success');
    else showMessage('gh exited ' + code + ' (is gh installed & authed?)', 'error');
  } catch (e) { showMessage('gh clone failed: ' + e.message, 'error'); }
}

// Copy raw github URL to clipboard for the current file.
export function copyRawUrl() {
  const [owner, name] = repoOwnerName();
  if (!owner) return;
  let path = appState.fileViewing;
  if (!path) {
    const ent = getSelectedEntry();
    if (ent && ent.type === 'file') {
      path = ent.path;
    }
  }
  if (!path) return;
  const url = 'https://raw.githubusercontent.com/' + owner + '/' + name +
    '/' + appState.filesRef + '/' + path;
  if (copyToClipboard(url)) showMessage('Copied raw URL', 'success');
  else showMessage('Clipboard copy failed', 'error');
}

// ─── Render ───────────────────────────────────────────────────────

function renderBreadcrumb(screen, y, owner, name) {
  const W = screen.width;
  const parts = [owner + '/' + name + '@' + appState.filesRef];
  if (appState.filesPath) {
    for (const p of appState.filesPath.split('/')) parts.push(p);
  }
  const crumb = parts.join(' > ');
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
  screen.writeStr(4, headerY, ' Name', color('header'));
  const dirs = entries.filter(e => e.type === 'dir').length;
  const files = entries.filter(e => e.type === 'file').length;
  if (W > 40) screen.writeStr(W - 30, headerY, dirs + ' dir(s)  ' + files + ' file(s)', color('dim'));
  if (W > 40) screen.writeStr(W - 18, headerY, 'Size', color('header'));

  const rows = Math.max(1, maxH - 5);
  const start = appState.filesScroll || 0;
  // include a synthetic ".." entry when not at root
  const upRow = appState.filesPath ? [{ name: '..', type: 'up' }] : [];
  const allEntries = [...upRow, ...entries];

  for (let i = 0; i < rows && start + i < allEntries.length; i++) {
    const ent = allEntries[start + i];
    const row = headerY + 1 + i;
    const sel = start + i === appState.filesSelected;

    // Selection highlight.
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }

    screen.writeStr(2, row, sel ? '▶' : ' ', sel ? color('selection') : null);

    let icon, c;
    if (ent.type === 'up')         { icon = '..'; c = color('dim'); }
    else if (ent.type === 'dir')   { icon = '▸ '; c = color('accent'); }
    else if (ent.type === 'file')  { icon = '• '; c = null; }
    else                            { icon = '? '; c = color('dim'); }
    screen.writeStr(4, row, icon, c);

    const nameStyle = sel ? color('selection') : null;
    screen.writeStr(7, row, ent.name.substring(0, W - 36), nameStyle);

    if (ent.type === 'file') {
      screen.writeStr(W - 22, row, formatBytes(ent.size || 0), color('dim'));
    } else if (ent.type === 'dir') {
      screen.writeStr(W - 22, row, '<dir>', color('dim'));
    }
  }

  // Footer hint (grouped by category).
  const footerY = headerY + 1 + Math.min(rows, allEntries.length) + 1;
  if (footerY < y + maxH) {
    const hints = '[Enter] Open  Save: [s/S]  Download: [Z/C/G]  [B] Branch  [y] URL  [Esc] Back';
    screen.writeStr(4, footerY, hints, color('dim'));
  }

  if (appState.filesBranchPicker) renderBranchPicker(screen);
}

function renderFileViewer(screen, y, maxH) {
  const W = screen.width;
  screen.writeStr(4, y, appState.fileViewing, color('title'));
  screen.writeStr(W - 12, y, '[' +
    formatBytes(Buffer.byteLength(appState.fileText || '')) + ']', color('dim'));
  screen.hline(y + 1, '─', color('dim'));

  const text = appState.fileText || '';
  const logicalLines = text.split(/\r?\n/);
  const lineNumW = String(logicalLines.length).length;
  // Inner width: total pane width minus the gutter (4 left + lineNumW + '│ '
  // + 4 right padding) so long source lines reflow instead of being hidden
  // past the right edge.
  const innerW = Math.max(10, W - 8 - lineNumW);

  // Wrap so each visual row fits within innerW. visualToLogical maps each
  // visual row back to its source line so we can show the right line number
  // and apply the correct syntax-style on continuations.
  const { lines: visualLines, visualToLogical } = wrapTextWithMap(text, innerW);
  const rows = Math.max(1, maxH - 4);
  const start = appState.fileScroll || 0;

  // Determine selection state for this pane.
  const inSel = appState.textSelectionMode === 'file';
  let selStart = inSel ? appState.textSelectStart : null;
  let selEnd = inSel ? appState.textSelectEnd : null;
  if (selStart && selEnd) {
    if (selEnd.row < selStart.row || (selEnd.row === selStart.row && selEnd.col < selStart.col)) {
      [selStart, selEnd] = [selEnd, selStart];
    }
  }

  for (let i = 0; i < rows && start + i < visualLines.length; i++) {
    const row = y + 2 + i;
    const logicalIdx = visualToLogical[start + i];
    const sourceLn = logicalLines[logicalIdx] || '';

    // Line-number gutter: show the source line number on the FIRST visual
    // row of that source line; blank the gutter on continuations.
    const isFirst = (start + i) === 0
      || visualToLogical[start + i - 1] !== logicalIdx;
    const lnNumStr = isFirst
      ? String(logicalIdx + 1).padStart(lineNumW, ' ')
      : ' '.repeat(lineNumW);
    screen.writeStr(4, row, lnNumStr, color('dim'));
    screen.writeStr(4 + lineNumW + 1, row, '│', color('dim'));

    // Apply syntax style based on the SOURCE line so wrapped keyword/
    // string/etc. highlighting is preserved on continuations.
    const lineStyle = decorateLine(sourceLn, appState.fileViewing);
    screen.writeStr(4 + lineNumW + 3, row, visualLines[start + i], lineStyle);
  }

  // Second pass: overlay selection background via styleBuf. Column-aware so
  // partial-row selections don't leak into unselected cells.
  if (selStart && selEnd) {
    for (let i = 0; i < rows && start + i < visualLines.length; i++) {
      const visRow = start + i;
      if (visRow < selStart.row || visRow > selEnd.row) continue;
      const row = y + 2 + i;
      const selColStart = visRow === selStart.row ? (selStart.col ?? 0) : 0;
      const selColEnd = visRow === selEnd.row ? (selEnd.col ?? innerW) : innerW;
      const clampedStart = Math.max(0, selColStart);
      const clampedEnd = Math.min(innerW, selColEnd);
      if (clampedEnd <= clampedStart) continue;
      for (let x = clampedStart; x < clampedEnd; x++) {
        screen.styleBuf[row][4 + lineNumW + 3 + x] = color('selection');
      }
    }
  }

  const footerY = y + 2 + Math.min(rows, visualLines.length) + 1;
  if (footerY < y + maxH) {
    const hintParts = [];
    hintParts.push('Line ' + (start + 1) + '-' + Math.min(start + rows, visualLines.length) +
      ' of ' + visualLines.length);
    hintParts.push('[↑↓] scroll');
    hintParts.push('[s] Save');
    hintParts.push('[y] URL');
    if (inSel) {
      hintParts.push('[Esc] clear selection');
      hintParts.push('[Ctrl+A] select all → copy');
    } else {
      hintParts.push('[Ctrl+A] select all → copy');
    }
    hintParts.push('[Esc] Back');
    const hints = hintParts.join('  ');
    screen.writeStr(4, footerY, hints, color('dim'));
  }
}

function decorateLine(ln, path) {
  if (!path) return null;
  const ext = (path.split('.').pop() || '').toLowerCase();

  // Comments
  if (/^\s*(#|\/\/|\/\*|\*\/|\*)/.test(ln)) return color('dim');
  if (/^\s*```/.test(ln)) return color('dim');

  // Markdown
  if (ext === 'md' || ext === 'mdx') {
    if (/^#{1,6}\s/.test(ln)) return { bold: true };
    if (/^\s*[-*+]\s/.test(ln)) return color('accent');
    if (/^\s*>\s/.test(ln)) return color('dim');
    if (/^\s*\d+\.\s/.test(ln)) return color('accent');
    return null;
  }

  // JSON / YAML / TOML
  if (ext === 'json') {
    if (/^\s*[\}"']/.test(ln)) return color('accent');
    return null;
  }
  if (ext === 'yaml' || ext === 'yml' || ext === 'toml') {
    if (/^\s*[\w-]+\s*:/.test(ln)) return color('accent');
    if (/^\s*#/.test(ln)) return color('dim');
    return null;
  }

  // Shell scripts
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh') {
    if (/^\s*#/.test(ln)) return color('dim');
    if (/^\s*(if|then|else|elif|fi|for|do|done|while|case|esac|function|return|export|source|alias)\b/.test(ln))
      return color('accent');
    if (/^\s*(echo|cd|ls|mkdir|rm|cp|mv|chmod|chown|git|npm|node|python|curl|wget)\b/.test(ln))
      return { fg: 'yellow' };
    return null;
  }

  // Config / Dockerfiles
  if (ext === 'dockerfile' || path.toLowerCase().includes('dockerfile')) {
    if (/^\s*(FROM|RUN|COPY|ADD|CMD|ENTRYPOINT|ENV|ARG|EXPOSE|WORKDIR|USER|LABEL|HEALTHCHECK|SHELL)\b/.test(ln))
      return color('accent');
    if (/^\s*#/.test(ln)) return color('dim');
    return null;
  }
  if (ext === 'env') {
    if (/^\s*#/.test(ln)) return color('dim');
    if (/^\s*\w+=/.test(ln)) return color('accent');
    return null;
  }

  // CSS / SCSS / Less
  if (['css', 'scss', 'less', 'sass'].includes(ext)) {
    if (/^\s*\/[/*]/.test(ln)) return color('dim');
    if (/^\s*[\.#][\w-]+/.test(ln)) return color('accent');
    if (/^\s*[\w-]+\s*:/.test(ln)) return { fg: 'cyan' };
    return null;
  }

  // HTML / XML / JSX
  if (['html', 'htm', 'xml', 'svg', 'jsx', 'tsx'].includes(ext)) {
    if (/^\s*<!--/.test(ln)) return color('dim');
    if (/^\s*<\//.test(ln)) return color('accent');
    if (/^\s*</.test(ln)) return color('accent');
    return null;
  }

  // SQL
  if (ext === 'sql') {
    if (/^\s*(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|JOIN|ON|AND|OR|GROUP|ORDER|BY|HAVING|LIMIT|UNION|AS)\b/i.test(ln))
      return color('accent');
    if (/^\s*--/.test(ln)) return color('dim');
    return null;
  }

  // Programming languages
  const CODE_EXTS = ['js','mjs','ts','tsx','jsx','py','go','rs','java','c','cpp','h','hpp','rb','php','cs','swift','kt','scala','lua','r','pl','ex','exs','erl','hs','ml','clj','dart','zig','nim','v','cr'];
  if (CODE_EXTS.includes(ext)) {
    // Keywords
    if (/^\s*(import|export|from|require|use|package|class|function|def|const|let|var|fn|impl|trait|pub|module|namespace|interface|type|struct|enum|async|await|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|this|self|super|static|final|abstract|extends|implements|override|virtual|yield|static)\b/.test(ln))
      return color('accent');
    // Strings
    if (/^\s*["'`]/.test(ln) && /["'`]\s*[;:,=)]?\s*$/.test(ln.trim()))
      return { fg: 'green' };
    // Numbers
    if (/^\s*\d+[\d.]*\b/.test(ln) && ln.trim().length < 20)
      return { fg: 'yellow' };
    // Decorators / annotations
    if (/^\s*[@#]/.test(ln))
      return { fg: 'magenta' };
  }

  // Makefiles
  if (ext === 'mk' || path.toLowerCase() === 'makefile') {
    if (/^\s*[\w-]+\s*[:+?]?=/.test(ln)) return color('accent');
    if (/^\t/.test(ln)) return { fg: 'yellow' };
    if (/^\s*#/.test(ln)) return color('dim');
    return null;
  }

  // Gitignore / gitattributes
  if (ext === 'gitignore' || ext === 'gitattributes') {
    if (/^\s*#/.test(ln)) return color('dim');
    if (/^\s*!/.test(ln)) return { fg: 'green' };
    return null;
  }

  // License files
  if (ext === 'license' || ext === 'licence') {
    if (/^\s*(MIT|Apache|BSD|GPL|LGPL|MPL|ISC|CC|UNLICENSE)/i.test(ln)) return { bold: true };
    return null;
  }

  // Fallback: detect common patterns
  if (/^\s*(TODO|FIXME|HACK|XXX|NOTE|BUG)\b/.test(ln)) return { fg: 'yellow', bold: true };
  if (/^\s*console\.(log|error|warn)\b/.test(ln)) return { fg: 'yellow' };

  return null;
}

function renderBranchPicker(screen) {
  const W = screen.width, H = screen.height;

  // Modal backdrop.
  const backdropStyle = color('modalBackdrop');
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) screen.styleBuf[yy][xx] = backdropStyle;
  }

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

    if (sel) {
      for (let xx = x0 + 1; xx < x0 + boxW - 1; xx++) {
        screen.styleBuf[y0 + 1 + i][xx] = color('selection');
      }
    }

    const label = b.name + (b.name === appState.filesRef ? ' (current)' : '');
    screen.writeStr(x0 + 1, y0 + 1 + i, sel ? '>' : ' ', sel ? color('selection') : null);
    screen.writeStr(x0 + 3, y0 + 1 + i,
      label.substring(0, boxW - 5), sel ? color('selection') : null);
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
    // fileScroll now indexes VISUAL rows (one logical line can wrap to many),
    // so clamp using wrapText's row count rather than the logical-line count.
    const W = screen ? screen.width : (process.stdout.columns || 80);
    const logicalLines = (appState.fileText || '').split(/\r?\n/);
    const innerW = Math.max(10, W - 8 - String(logicalLines.length).length);
    const visualRows = wrapText(appState.fileText || '', innerW).length;
    appState.fileScroll = Math.min(
      Math.max(0, visualRows - 1), appState.fileScroll + 1);
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
    // Visual-row clamp so a wrapped file lands at the LAST visual row,
    // not at logical-line count - 1 (which would leave the bottom of the
    // wrapped file unreachable).
    const W = process.stdout.columns || 80;
    const logicalLines = (appState.fileText || '').split(/\r?\n/);
    const innerW = Math.max(10, W - 8 - String(logicalLines.length).length);
    const visualRows = wrapText(appState.fileText || '', innerW).length;
    appState.fileScroll = Math.max(0, visualRows - 1);
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

let _backInProgress = false;
export async function backOrLeave() {
  if (_backInProgress) return true;
  if (appState.filesBranchPicker) { appState.filesBranchPicker = false; render(); return true; }
  if (appState.fileViewing) {
    _backInProgress = true;
    try { await goUp(); } finally { _backInProgress = false; }
    return true;
  }
  if (appState.filesPath && appState.filesPath !== '' && appState.filesPath !== '/') {
    _backInProgress = true;
    try { await goUp(); } finally { _backInProgress = false; }
    return true;
  }
  return false; // at files root — let analyze.handleBack take over
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
      if (copyToClipboard(appState.fileText)) {
        const tmpFile = getClipboardTempFilePath();
        if (tmpFile) showMessage('File contents copied (saved to ' + tmpFile + ')', 'success');
        else showMessage('File contents copied', 'success');
      } else {
        showMessage('Copy failed — use [s] save instead', 'warning');
      }
    } else {
      showMessage('Open a file first with [Enter] to copy its contents', 'info');
    }
  },
  'g': jumpTop,
  // capital 'G' is used by clone — bottom-jump uses end of file viewer's scroll keys.
};

// Capital-G already maps to gh-clone above. Provide a 'bottom' action via the
// palette only (or via 'end' key if your terminal sends '\x1b[F').
export { jumpBottom as bottom };

// (no extra exports needed — analyze.mjs imports directly from utils.mjs)
