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

import { appState, render, startAsync, isStale, showMessage, confirm, beginLoading, finishLoading } from '../state.mjs';
import {
  getRepoContents, getRepoFile, getBranches, getZipballUrl,
  getFileCommits, downloadToFile, encodeRepoPath, getGitHubHosts,
} from '../github.mjs';
import {
  formatBytes, relTime, writeFileSafe, safeCwdJoin, runCommand, runCommandCapture,
  ghCloneUrl, copyToClipboard, getClipboardTempFilePath, dirExists, wrapTextWithMap, wrapText, truncateToWidth, displayWidth,
  openUrl,
} from '../utils.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import { color } from '../theme.mjs';
import { join, resolve } from 'path';
import { detectLanguage, tokenizeLine, parseBlamePorcelain } from '../recommended-features.mjs';

// Limit how big a single file we'll fetch into memory (the API caps at 1MB).
const MAX_VIEW_BYTES = 1_000_000;
const MAX_BULK_FILES = 500;

// ─── Tree sort / filter / meta (pure helpers — exported for tests) ───

export const FILES_SORTS = [
  { id: 'name', label: 'Name' },
  { id: 'size', label: 'Size' },
  { id: 'ext',  label: 'Type' },
];

function extOf(name) {
  const base = String(name || '').toLowerCase();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1) : '';
}

// Sort a contents-list without mutating the input. `sort` is one of
// 'name' (dirs-first, alpha), 'size' (dirs alpha, files largest-first),
// 'ext' (dirs alpha, files by extension then name).
export function sortFilesEntries(entries, sort) {
  const list = Array.isArray(entries) ? entries.slice() : [];
  const mode = sort || 'name';
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
  if (mode === 'size') {
    list.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      if (a.type === 'dir') return byName(a, b);
      const sa = a.size || 0, sb = b.size || 0;
      if (sa !== sb) return sb - sa;
      return byName(a, b);
    });
    return list;
  }
  if (mode === 'ext') {
    list.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      if (a.type === 'dir') return byName(a, b);
      const ea = extOf(a.name), eb = extOf(b.name);
      if (ea !== eb) return ea.localeCompare(eb);
      return byName(a, b);
    });
    return list;
  }
  // Default: directories first, alpha within each group.
  list.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return byName(a, b);
  });
  return list;
}

// Case-insensitive substring filter on entry name. Empty query returns
// the input unchanged (same reference) so callers can skip re-render work.
export function filterFilesEntries(entries, query) {
  if (!Array.isArray(entries)) return [];
  const q = String(query || '').trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(e => String(e.name || '').toLowerCase().includes(q));
}

// Heuristic binary guard — GitHub serves raw bytes as UTF-8 text, so a NUL
// byte in the head of the payload is the reliable binary signal.
export function isProbablyBinary(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  return text.slice(0, 8000).includes('\0');
}

// Viewer meta line: byte size, logical line count, detected language.
export function getFileMeta(path, text) {
  const str = typeof text === 'string' ? text : String(text || '');
  let bytes = 0;
  try { bytes = Buffer.byteLength(str); } catch { bytes = str.length; }
  const lines = str.length === 0 ? 0 : str.split(/\r?\n/).length;
  return { bytes, lines, language: detectLanguage(path || '') };
}

// Browser URLs for the current tree / file / commit. webHost override keeps
// GitHub Enterprise setups working (hosts come from getGitHubHosts()).
export function buildBlobUrl(owner, name, ref, path, webHost) {
  const host = String(webHost || getGitHubHosts().webHost || 'github.com').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const r = ref || 'main';
  if (!path) return 'https://' + host + '/' + owner + '/' + name + '/tree/' + encodeRepoPath(r);
  return 'https://' + host + '/' + owner + '/' + name + '/blob/' + encodeRepoPath(r) + '/' + encodeRepoPath(path);
}

export function buildTreeUrl(owner, name, ref, dirPath, webHost) {
  const host = String(webHost || getGitHubHosts().webHost || 'github.com').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const r = ref || 'main';
  if (!dirPath) return 'https://' + host + '/' + owner + '/' + name + '/tree/' + encodeRepoPath(r);
  return 'https://' + host + '/' + owner + '/' + name + '/tree/' + encodeRepoPath(r) + '/' + encodeRepoPath(dirPath);
}

export function buildCommitUrl(owner, name, sha, webHost) {
  const host = String(webHost || getGitHubHosts().webHost || 'github.com').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return 'https://' + host + '/' + owner + '/' + name + '/commit/' + encodeURIComponent(sha || '');
}

// ─── Last-modified enrichment (pure cache helpers exported for tests) ───
// The /contents API returns no timestamps, so the newest commit touching
// each path is fetched lazily (per_page=1) and cached per branch+path with
// a TTL — the same scroll-idle pattern repos.mjs uses for issue counts.

const LASTMOD_TTL = 5 * 60 * 1000;  // 5 min
const LASTMOD_CAP = 30;             // entries enriched per directory view
const LASTMOD_CONCURRENCY = 3;

export function lastModKey(ref, path) {
  return String(ref || '') + '\n' + String(path || '');
}

export function getLastMod(ref, path) {
  const cache = appState.filesLastMod || {};
  return cache[lastModKey(ref, path)] || null;
}

export function setLastMod(ref, path, val) {
  if (!appState.filesLastMod) appState.filesLastMod = {};
  appState.filesLastMod[lastModKey(ref, path)] = val;
}

// Display text for a cache entry: '…' while the fetch is pending (no entry
// yet), '—' when the lookup failed, otherwise a short relative time.
export function lastModText(entry) {
  if (!entry) return '…';
  if (entry.failed || !entry.date) return '—';
  return relTime(entry.date) || '—';
}

function pickLastModCommit(commits) {
  const c = Array.isArray(commits) ? commits[0] : null;
  if (!c) return null;
  return {
    sha: c.sha || '',
    date: c.commit?.author?.date || c.commit?.committer?.date || null,
    author: c.author?.login || c.commit?.author?.name || c.commit?.committer?.name || '?',
    subject: String(c.commit?.message || '').split(/\r?\n/)[0] || '(no message)',
  };
}

// Enrich the visible directory rows with their newest commit. Never throws
// and never clobbers newer navigation — stale or aborted results are dropped.
export async function enrichLastModified() {
  const [owner, name] = repoOwnerName();
  if (!owner || appState.fileViewing) return;
  const ref = appState.filesRef;
  const now = Date.now();
  const targets = getFilteredEntries().slice(0, LASTMOD_CAP).filter(e => {
    if (!e || !e.path || e.type === 'up') return false;
    const c = getLastMod(ref, e.path);
    return !c || (now - c.ts > LASTMOD_TTL);
  });
  if (targets.length === 0) return;
  const gen = startAsync('files-lastmod');
  try {
    const queue = targets.slice();
    const worker = async () => {
      while (queue.length > 0) {
        if (isStale(gen) || gen.signal.aborted) return;
        const e = queue.shift();
        if (!e || !e.path) continue;
        try {
          const commits = await getFileCommits(appState.token, owner, name, e.path, 1, gen.signal);
          if (isStale(gen) || gen.signal.aborted) return;
          const picked = pickLastModCommit(commits);
          setLastMod(ref, e.path, picked ? { ...picked, ts: Date.now() } : { failed: true, ts: Date.now() });
        } catch {
          if (isStale(gen)) return;
          setLastMod(ref, e.path, { failed: true, ts: Date.now() });
        }
      }
    };
    const workers = Array.from({ length: Math.min(LASTMOD_CONCURRENCY, Math.max(1, queue.length)) }, worker);
    await Promise.all(workers);
  } catch { /* enrichment is best-effort — the tree stays usable without it */ }
  if (!isStale(gen)) render();
}

// Single-path variant for the file viewer footer (no cap, no tree needed).
export async function ensureFileLastMod(path) {
  const [owner, name] = repoOwnerName();
  if (!owner || !path) return;
  const ref = appState.filesRef;
  const c = getLastMod(ref, path);
  if (c && Date.now() - c.ts <= LASTMOD_TTL) return;
  const gen = startAsync('files-lastmod-file');
  try {
    const commits = await getFileCommits(appState.token, owner, name, path, 1, gen.signal);
    if (isStale(gen) || gen.signal.aborted) return;
    const picked = pickLastModCommit(commits);
    setLastMod(ref, path, picked ? { ...picked, ts: Date.now() } : { failed: true, ts: Date.now() });
  } catch {
    if (!isStale(gen)) setLastMod(ref, path, { failed: true, ts: Date.now() });
    return;
  }
  if (!isStale(gen)) render();
}

// One-line viewer summary: 'Last change 3d ago · abc1234 by author — subject'.
export function lastChangeLine(ref, path, maxW) {
  const lm = getLastMod(ref, path);
  if (!lm || lm.failed || !lm.date) return null;
  const sha = String(lm.sha || '').slice(0, 7);
  const line = 'Last change ' + (relTime(lm.date) || '?') + ' ago · ' + sha +
    ' by ' + (lm.author || '?') + ' — ' + (lm.subject || '');
  return truncateToWidth(line, Math.max(10, maxW || 60), '');
}

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

export function getFilesSort() {
  const s = appState.filesSort;
  return FILES_SORTS.some(o => o.id === s) ? s : 'name';
}

export function getFilesFilter() {
  return typeof appState.filesFilter === 'string' ? appState.filesFilter : '';
}

// Visible (filter-applied, sort-applied) tree entries. Sort is applied at
// load / cycle time to appState.filesEntries; the filter is applied lazily
// here so typing never refetches.
export function getFilteredEntries() {
  return filterFilesEntries(appState.filesEntries || [], getFilesFilter());
}

// Full row list including the synthetic '..' row when off-root. All tree
// navigation (selection, up/down, drill-in) goes through this so filtered
// views stay consistent.
export function getVisibleRows() {
  const rows = [];
  if (appState.filesPath) rows.push({ name: '..', type: 'up' });
  for (const e of getFilteredEntries()) rows.push(e);
  return rows;
}

export function getSelectedEntry() {
  const rows = getVisibleRows();
  return rows[appState.filesSelected] || null;
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
  appState.fileBinary = false;
  appState.fileHistoryMode = false;
  appState.fileBlameMode = false;
  appState.fileHistory = [];
  appState.fileBlame = [];
  appState.filesBranches = [];
  appState.filesBranchPicker = false;
  appState.filesBranchCursor = 0;
  appState.filesFilter = '';
  if (!FILES_SORTS.some(o => o.id === appState.filesSort)) appState.filesSort = 'name';
  appState.filesLastMod = {};
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
  beginLoading(gen);
  render();
  try {
    const list = await getRepoContents(
      appState.token, owner, name, appState.filesPath, appState.filesRef, gen.signal);
    if (isStale(gen)) return;
    const arr = Array.isArray(list) ? list : [list];
    appState.filesEntries = sortFilesEntries(arr, getFilesSort());
    // Clamp selection into the (possibly filtered) visible rows instead of
    // resetting to 0, so refreshes keep the user's place.
    const rows = getVisibleRows().length;
    appState.filesSelected = Math.max(0, Math.min(appState.filesSelected || 0, Math.max(0, rows - 1)));
    appState.filesScroll = 0;
    appState.fileViewing = null;
    appState.fileBinary = false;
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to load: ' + e.message, 'error');
    appState.filesEntries = [];
  } finally {
    // always clear loading flag regardless of how we exit the try.
    finishLoading(gen);
  }
  if (isStale(gen)) return;
  render();
  // Lazily fill the MODIFIED column (best-effort, never blocks the tree).
  enrichLastModified().catch(() => {});
}

function resetTreeCursor() {
  appState.filesSelected = 0;
  appState.filesScroll = 0;
  appState.filesFilter = '';
}

export async function drillInto() {
  const ent = getSelectedEntry();
  if (!ent) return;
  if (ent.type === 'up') {
    await goUp();
  } else if (ent.type === 'dir') {
    appState.filesPath = ent.path;
    resetTreeCursor();
    await loadTree();
  } else if (ent.type === 'file') {
    await viewFile(ent);
  }
}

export async function openFileHistory() {
  const [owner, name] = repoOwnerName();
  const selected = getSelectedEntry();
  const path = appState.fileViewing || (selected && selected.type === 'file' ? selected.path : null);
  if (!owner || !path) { showMessage('Select or open a file first', 'warning'); return; }
  const gen = startAsync('files-history');
  beginLoading(gen);
  render();
  try {
    const commits = await getFileCommits(appState.token, owner, name, path, 50, gen.signal);
    if (isStale(gen)) return;
    appState.fileHistory = Array.isArray(commits) ? commits : [];
    appState.fileBlameMode = false;
    appState.fileHistoryPath = path;
    appState.fileHistorySelected = 0;
    appState.fileHistoryMode = true;
  } catch (e) {
    if (!isStale(gen)) showMessage('History: ' + e.message, 'error');
  } finally { finishLoading(gen); }
  if (!isStale(gen)) render();
}

export async function openFileBlame() {
  const [owner, name] = repoOwnerName();
  const path = appState.fileViewing || (getSelectedEntry()?.type === 'file' ? getSelectedEntry().path : null);
  if (!owner || !path) { showMessage('Select or open a file first', 'warning'); return; }
  const local = appState.localRepo;
  if (!local || (local.owner + '/' + local.repo).toLowerCase() !== owner + '/' + name.toLowerCase()) {
    showMessage('Blame requires the matching repository in the current directory', 'warning');
    return;
  }
  const gen = startAsync('files-blame');
  beginLoading(gen);
  render();
  try {
    const result = await runCommandCapture('git', ['blame', '--line-porcelain', '--', path], { cwd: process.cwd() });
    if (isStale(gen)) return;
    if (result.code !== 0) throw new Error(result.stderr || 'git blame failed');
    appState.fileBlame = parseBlamePorcelain(result.stdout);
    appState.fileHistoryMode = false;
    appState.fileHistoryPath = path;
    appState.fileHistorySelected = 0;
    appState.fileBlameMode = true;
  } catch (e) {
    if (!isStale(gen)) showMessage('Blame: ' + e.message, 'error');
  } finally { finishLoading(gen); }
  if (!isStale(gen)) render();
}

export function closeFileHistory() {
  appState.fileHistoryMode = false;
  appState.fileBlameMode = false;
  appState.fileHistory = [];
  appState.fileBlame = [];
  appState.fileHistoryPath = '';
  appState.fileHistorySelected = 0;
  render();
}

export async function goUp() {
  if (appState.fileHistoryMode || appState.fileBlameMode) { closeFileHistory(); return true; }
  if (getFilesFilter()) { clearFilesFilter(); return true; }
  if (appState.fileViewing) {
    // Leaving file viewer back to tree.
    appState.fileViewing = null;
    appState.fileText = '';
    appState.fileScroll = 0;
    appState.fileBinary = false;
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
  resetTreeCursor();
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
  beginLoading(gen);
  render();
  try {
    const text = await getRepoFile(
      appState.token, owner, name, targetPath, appState.filesRef, gen.signal);
    if (isStale(gen)) return;
    appState.fileViewing = targetPath;
    appState.fileText = typeof text === 'string' ? text : String(text);
    appState.fileScroll = 0;
    appState.fileBinary = isProbablyBinary(appState.fileText);
    if (appState.fileBinary) {
      showMessage('Binary file — preview hidden. Use [s] to save it instead.', 'warning');
    }
    // Prime the viewer's "last change" footer line.
    ensureFileLastMod(targetPath).catch(() => {});
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to view: ' + e.message, 'error');
  } finally {
    finishLoading(gen);
  }
  if (!isStale(gen)) render();
}

export async function openFilePath(path) {
  try {
    if (!path || typeof path !== 'string' || !path.trim()) { showMessage('Invalid file path', 'warning'); return; }
    const clean = path.trim().replace(/^\.\/+/, '').replace(/^\/+/, '');
    if (!clean) { showMessage('Invalid file path', 'warning'); return; }
    const parts = clean.split('/').filter(Boolean);
    const base = parts.pop();
    const dir = parts.join('/');
    if (!base) { showMessage('Invalid file path: ' + path, 'warning'); return; }
    appState.detailsPane = 'files';
    appState.filesPath = dir;
    appState.fileViewing = null;
    appState.fileBinary = false;
    appState.filesFilter = '';
    await loadTree();
    const entries = getFilteredEntries();
    const idx = entries.findIndex(e => e.name === base);
    if (idx < 0) { showMessage('File not found: ' + clean, 'warning'); return; }
    appState.filesSelected = (appState.filesPath ? 1 : 0) + idx;
    // Reuse the same opener Enter uses.
    await drillInto();
  } catch (e) {
    showMessage((e && e.message) || 'Failed to open file path', 'warning');
  }
}

export async function openBranchPicker() {
  const [owner, name] = repoOwnerName();
  if (!owner) return;
  if (appState.filesBranches.length === 0) {
    const gen = startAsync('files-branches');
    beginLoading(gen);
    render();
    try {
      const list = await getBranches(appState.token, owner, name, 50, gen.signal);
      if (isStale(gen)) return;
      appState.filesBranches = Array.isArray(list) ? list : [];
    } catch (e) {
      if (!isStale(gen)) showMessage('Branches: ' + e.message, 'error');
      appState.filesBranches = [];
    } finally {
      finishLoading(gen);  // always clear
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
  appState.fileBinary = false;
  appState.filesLastMod = {};
  resetTreeCursor();
  await loadTree();
  showMessage('Switched to branch ' + b.name, 'success');
}

// ─── Tree filter / sort ───────────────────────────────────────────

export function promptFilesFilter() {
  if (appState.fileViewing || appState.fileHistoryMode || appState.fileBlameMode) {
    showMessage('Close the file viewer first to filter the tree', 'warning');
    return;
  }
  startInput('Filter files: ', 'files-filter', false, getFilesFilter());
}

export function clearFilesFilter(silent) {
  if (!getFilesFilter()) { if (!silent) render(); return; }
  appState.filesFilter = '';
  appState.filesSelected = 0;
  appState.filesScroll = 0;
  if (!silent) {
    showMessage('Filter cleared', 'info');
    render();
  } else render();
}

export function applyFilesSort() {
  appState.filesEntries = sortFilesEntries(appState.filesEntries || [], getFilesSort());
  const rows = getVisibleRows().length;
  appState.filesSelected = Math.max(0, Math.min(appState.filesSelected || 0, Math.max(0, rows - 1)));
  appState.filesScroll = 0;
}

export function cycleFilesSort() {
  if (appState.fileViewing) { showMessage('Close the file viewer first to re-sort', 'warning'); return; }
  const ids = FILES_SORTS.map(o => o.id);
  const cur = ids.indexOf(getFilesSort());
  appState.filesSort = ids[(cur + 1) % ids.length];
  applyFilesSort();
  const label = FILES_SORTS.find(o => o.id === appState.filesSort).label;
  showMessage('Sort: ' + label, 'info');
  render();
}

// ─── Go to path ───────────────────────────────────────────────────

export function promptGoToPath() {
  const initial = appState.fileViewing || appState.filesPath || '';
  startInput('Open path: ', 'files-goto', false, initial);
}

// ─── Refresh (preserves pane, filter, and selection) ──────────────

export async function refreshFiles() {
  const [owner, name] = repoOwnerName();
  if (!owner) { showMessage('Open a repo on Explore first', 'warning'); return; }
  if (appState.fileViewing) {
    const target = appState.fileViewing;
    const keepScroll = appState.fileScroll || 0;
    const gen = startAsync('files-view');
    beginLoading(gen);
    render();
    try {
      const text = await getRepoFile(appState.token, owner, name, target, appState.filesRef, gen.signal);
      if (isStale(gen)) return;
      appState.fileText = typeof text === 'string' ? text : String(text);
      appState.fileBinary = isProbablyBinary(appState.fileText);
      appState.fileScroll = Math.max(0, keepScroll);
      showMessage('File refreshed', 'success');
      ensureFileLastMod(target).catch(() => {});
    } catch (e) {
      if (!isStale(gen)) showMessage('Refresh failed: ' + e.message, 'error');
    } finally { finishLoading(gen); }
    if (!isStale(gen)) render();
    return;
  }
  const keepSelected = getSelectedEntry();
  const keepName = keepSelected && keepSelected.type !== 'up' ? keepSelected.name : null;
  await loadTree();
  if (keepName) {
    const rows = getVisibleRows();
    const idx = rows.findIndex(r => r.name === keepName);
    if (idx >= 0) appState.filesSelected = idx;
    render();
  }
  showMessage('Files refreshed', 'success');
}

// ─── Clipboard / browser ──────────────────────────────────────────

function currentPathForShare() {
  if (appState.fileViewing) return { path: appState.fileViewing, kind: 'file' };
  const ent = getSelectedEntry();
  if (!ent || ent.type === 'up') return null;
  return { path: ent.path, kind: ent.type };
}

// Copy the repo-relative path (e.g. `src/index.mjs`) of the viewed or
// highlighted file / directory.
export function copyFilePath() {
  const cur = currentPathForShare();
  const fallbackDir = !cur && appState.filesPath ? appState.filesPath : null;
  const path = cur ? cur.path : fallbackDir;
  if (!path) { showMessage('Select a file first', 'warning'); return; }
  if (copyToClipboard(path)) {
    const tmpFile = getClipboardTempFilePath();
    showMessage(tmpFile ? 'Path copied (saved to ' + tmpFile + ')' : 'Path copied: ' + path, 'success');
  } else showMessage('Clipboard copy failed', 'error');
}

// Open the viewed/selected file (blob), the current directory (tree), or —
// in history mode — the selected commit in the browser.
export async function openFileInBrowser() {
  const [owner, name] = repoOwnerName();
  if (!owner) return;
  if (appState.fileHistoryMode) { openHistoryCommitInBrowser(); return; }
  let url;
  if (appState.fileViewing) {
    url = buildBlobUrl(owner, name, appState.filesRef, appState.fileViewing);
  } else {
    const ent = getSelectedEntry();
    if (ent && ent.type === 'file') url = buildBlobUrl(owner, name, appState.filesRef, ent.path);
    else if (ent && ent.type === 'dir') url = buildTreeUrl(owner, name, appState.filesRef, ent.path);
    else url = buildTreeUrl(owner, name, appState.filesRef, appState.filesPath);
  }
  const res = await openUrl(url);
  if (res.ok) showMessage('Opened in browser', 'success');
  else showMessage(res.error || 'Open failed', 'error');
}

export async function openHistoryCommitInBrowser() {
  const [owner, name] = repoOwnerName();
  const commit = (appState.fileHistory || [])[appState.fileHistorySelected];
  if (!owner || !commit || !commit.sha) { showMessage('Select a commit first', 'warning'); return; }
  const res = await openUrl(buildCommitUrl(owner, name, commit.sha));
  if (res.ok) showMessage('Opened commit in browser', 'success');
  else showMessage(res.error || 'Open failed', 'error');
}

registerInputHandler('files-filter', (value) => {
  appState.filesFilter = (value || '').trim();
  appState.filesSelected = 0;
  appState.filesScroll = 0;
  const matches = Math.max(0, getVisibleRows().length - (appState.filesPath ? 1 : 0));
  showMessage(appState.filesFilter
    ? 'Filter: "' + appState.filesFilter + '" (' + matches + ' match' + (matches === 1 ? '' : 'es') + ')'
    : 'Filter cleared', 'info');
  render();
});

registerInputHandler('files-goto', (value) => {
  const v = (value || '').trim();
  if (!v) { render(); return; }
  openFilePath(v);
});

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
  beginLoading(gen);   // set up-front so finally can clear it
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
    finishLoading(gen);   // always clear
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
  const url = rawFileUrl(owner, name, appState.filesRef, path);
  if (copyToClipboard(url)) showMessage('Copied raw URL', 'success');
  else showMessage('Clipboard copy failed', 'error');
}

export function rawFileUrl(owner, name, ref, path) {
  const hosts = getGitHubHosts();
  const host = hosts.webHost === 'github.com' ? 'raw.githubusercontent.com' : hosts.webHost;
  const prefix = hosts.webHost === 'github.com' ? '/' : '/' + encodeURIComponent(owner) + '/' + encodeURIComponent(name) + '/raw/';
  return 'https://' + host + prefix + (hosts.webHost === 'github.com' ? encodeURIComponent(owner) + '/' + encodeURIComponent(name) + '/' : '') + encodeRepoPath(ref || 'main') + '/' + encodeRepoPath(path);
}

// ─── Render ───────────────────────────────────────────────────────

function renderBreadcrumb(screen, y, owner, name) {
  const W = screen.width;
  const parts = [owner + '/' + name + '@' + appState.filesRef];
  if (appState.filesPath) {
    for (const p of appState.filesPath.split('/')) parts.push(p);
  }
  const crumb = parts.join(' > ');
  screen.writeStr(4, y, truncateToWidth(crumb, W - 6, ''), color('accent'));
}

export function renderFilesPane(screen, y, maxH) {
  const W = screen.width;
  const [owner, name] = repoOwnerName();
  if (!owner) return;  if (appState.fileHistoryMode || appState.fileBlameMode) {
    renderFileHistory(screen, y, maxH);
    return;
  }
  if (appState.fileViewing) {
    renderFileViewer(screen, y, maxH); return;
  }

  renderBreadcrumb(screen, y, owner, name);
  screen.hline(y + 1, '─');

  const allEntries = getVisibleRows();
  const totalEntries = appState.filesEntries || [];
  const headerY = y + 2;
  const filter = getFilesFilter();
  const sortLabel = (FILES_SORTS.find(o => o.id === getFilesSort()) || FILES_SORTS[0]).label;
  if (filter) {
    const matchCount = allEntries.filter(e => e.type !== 'up').length;
    screen.writeStr(4, headerY, ' Filter "' + truncateToWidth(filter, 24, '') + '" · ' + matchCount + ' match' + (matchCount === 1 ? '' : 'es') + ' · [c] clear', color('accent'));
  } else {
    screen.writeStr(4, headerY, ' Name', color('header'));
  }
  const dirs = totalEntries.filter(e => e.type === 'dir').length;
  const files = totalEntries.filter(e => e.type === 'file').length;
  if (W > 40) screen.writeStr(W - 30, headerY, dirs + ' dir(s)  ' + files + ' file(s)', color('dim'));
  const showMod = W > 70;
  if (showMod) screen.writeStr(W - 34, headerY, 'Modified', color('header'));
  if (W > 52) screen.writeStr(W - 18, headerY, 'Size', color('header'));

  const rows = Math.max(1, maxH - 6);
  const start = appState.filesScroll || 0;

  if (allEntries.length === 0) {
    screen.writeStr(4, headerY + 1, filter ? 'No matches for "' + truncateToWidth(filter, W - 24, '') + '"' : 'Empty directory', color('dim'));
    screen.writeStr(4, headerY + 2, filter ? '[c] Clear filter   [Esc] Back' : '[Esc] Back', color('dim'));
    if (appState.filesBranchPicker) renderBranchPicker(screen);
    return;
  }

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
    screen.writeStr(7, row, truncateToWidth(ent.name, showMod ? W - 48 : W - 36, ''), nameStyle);

    if (showMod && ent.type !== 'up') {
      screen.writeStr(W - 34, row, lastModText(getLastMod(appState.filesRef, ent.path)), color('dim'));
    }
    if (ent.type === 'file') {
      screen.writeStr(W - 22, row, formatBytes(ent.size || 0), color('dim'));
    } else if (ent.type === 'dir') {
      screen.writeStr(W - 22, row, '<dir>', color('dim'));
    }
  }

  // Footer hint (grouped by category).
  const footerY = headerY + 1 + Math.min(rows, allEntries.length) + 1;
  if (footerY < y + maxH) {
    const hints = '[Enter] Open  [/] Filter  [t] Sort:' + sortLabel + '  [e] Go to  [o] Browser  [p/y/Y] Copy';
    screen.writeStr(4, footerY, truncateToWidth(hints, W - 6, ''), color('dim'));
  }
  const footerY2 = footerY + 1;
  if (footerY2 < y + maxH) {
    const hints2 = 'Save: [s/S]  Get: [Z/C/G]  [B] Branch  [H/b] History  [r] Refresh  [Esc] Back';
    screen.writeStr(4, footerY2, truncateToWidth(hints2, W - 6, ''), color('dim'));
  }

  if (appState.filesBranchPicker) renderBranchPicker(screen);
}

function renderFileViewer(screen, y, maxH) {
  const W = screen.width;
  screen.writeStr(4, y, truncateToWidth(appState.fileViewing || '', Math.max(10, W - 34), ''), color('title'));
  const meta = getFileMeta(appState.fileViewing, appState.fileText);
  const metaText = '[' + formatBytes(meta.bytes) + ' · ' + meta.lines + ' ln · ' + meta.language + ']';
  screen.writeStr(Math.max(6, W - metaText.length - 2), y, metaText, color('dim'));
  screen.hline(y + 1, '─', color('dim'));

  if (appState.fileBinary) {
    screen.writeStr(4, y + 3, 'Binary file — preview hidden (' + formatBytes(meta.bytes) + ')', color('warning'));
    const binChange = lastChangeLine(appState.filesRef, appState.fileViewing, W - 6);
    if (binChange) screen.writeStr(4, y + 4, binChange, color('dim'));
    screen.writeStr(4, y + (binChange ? 5 : 4), '[s] Save to disk   [y] Copy raw URL   [o] Open in browser   [Esc] Back', color('dim'));
    return;
  }

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
    writeHighlightedLine(screen, 4 + lineNumW + 3, row, visualLines[start + i], appState.fileViewing, lineStyle);
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
    screen.writeStr(4, footerY, truncateToWidth(hints, W - 6, ''), color('dim'));
    const changeLine = lastChangeLine(appState.filesRef, appState.fileViewing, W - 6);
    if (changeLine && footerY + 1 < y + maxH) {
      screen.writeStr(4, footerY + 1, changeLine, color('dim'));
    }
  }
}

function writeHighlightedLine(screen, x, y, text, path, fallbackStyle) {
  const language = detectLanguage(path);
  const spans = tokenizeLine(text, language);
  let cx = x;
  for (const span of spans) {
    const style = span.kind === 'keyword' ? color('accent')
      : span.kind === 'string' ? { fg: 'green' }
      : span.kind === 'number' ? { fg: 'yellow' }
      : span.kind === 'comment' ? color('dim') : fallbackStyle;
    screen.writeStr(cx, y, span.text, style);
    cx += displayWidth(span.text);
  }
}

function renderFileHistory(screen, y, maxH) {
  const W = screen.width;
  if (appState.fileBlameMode) {
    renderFileBlame(screen, y, maxH);
    return;
  }
  screen.writeStr(2, y, 'FILE HISTORY', color('title'));
  screen.writeStr(Math.max(2, W - 34), y, truncateToWidth(appState.fileHistoryPath || '', 32, ''), color('dim'));
  screen.hline(y + 1, '─', color('dim'));
  const history = appState.fileHistory || [];
  if (history.length === 0) {
    screen.writeStr(2, y + 3, 'No commits found for this file', color('dim'));
    return;
  }
  const rows = Math.max(1, maxH - 4);
  const selected = Math.max(0, Math.min(appState.fileHistorySelected, history.length - 1));
  appState.fileHistorySelected = selected;
  for (let i = 0; i < rows && i < history.length; i++) {
    const c = history[i];
    const row = y + 2 + i;
    const sel = i === selected;
    if (sel) for (let xx = 0; xx < W; xx++) screen.styleBuf[row][xx] = color('selection');
    const sha = String(c.sha || '').slice(0, 8);
    const author = c.author?.name || c.commit?.author?.name || c.committer?.login || '?';
    const date = c.commit?.author?.date || c.commit?.committer?.date;
    const subject = c.commit?.message?.split(/\\r?\\n/)[0] || '(no message)';
    screen.writeStr(2, row, (sel ? '▶ ' : '  ') + sha, sel ? color('selection') : color('accent'));
    screen.writeStr(14, row, truncateToWidth(author, 18, ''), sel ? color('selection') : null);
    screen.writeStr(34, row, truncateToWidth(subject, Math.max(10, W - 50), ''), sel ? color('selection') : null);
    screen.writeStr(Math.max(36, W - 12), row, relTime(date), sel ? color('selection') : color('dim'));
  }
  screen.writeStr(2, y + 2 + Math.min(rows, history.length), '[Enter] copy URL   [o] browser   [Esc] back', color('dim'));
}

function renderFileBlame(screen, y, maxH) {
  const W = screen.width;
  const rows = Math.max(1, maxH - 4);
  const blame = appState.fileBlame || [];
  screen.writeStr(2, y, 'LOCAL BLAME', color('title'));
  screen.writeStr(Math.max(2, W - 34), y, truncateToWidth(appState.fileHistoryPath || '', 32, ''), color('dim'));
  screen.hline(y + 1, '─', color('dim'));
  if (!blame.length) { screen.writeStr(2, y + 3, 'No blame lines found', color('dim')); return; }
  const start = Math.max(0, Math.min(appState.fileHistorySelected, Math.max(0, blame.length - rows)));
  appState.fileHistorySelected = start;
  for (let i = 0; i < rows && start + i < blame.length; i++) {
    const item = blame[start + i];
    const row = y + 2 + i;
    const selected = start + i === appState.fileHistorySelected;
    if (selected) for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    const meta = String(item.sha || '').slice(0, 8) + ' ' + truncateToWidth(item.author || '?', 14, '');
    screen.writeStr(2, row, meta, selected ? color('selection') : color('accent'));
    screen.writeStr(28, row, String(item.line || '').padStart(5), selected ? color('selection') : color('dim'));
    screen.writeStr(35, row, truncateToWidth(item.text || '', W - 37, ''), selected ? color('selection') : null);
  }
  screen.writeStr(2, y + 2 + Math.min(rows, blame.length), '[Esc] back   local git blame   lines ' + (start + 1) + '-' + Math.min(start + rows, blame.length), color('dim'));
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
      truncateToWidth(label, boxW - 5, ''), sel ? color('selection') : null);
  }
}

// ─── Key handlers (consumed by analyze.mjs when detailsPane === 'files') ──

export function up() {
  if (appState.fileHistoryMode || appState.fileBlameMode) { appState.fileHistorySelected = Math.max(0, appState.fileHistorySelected - 1); render(); return; }
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
  if (appState.fileHistoryMode || appState.fileBlameMode) { const max = appState.fileBlameMode ? appState.fileBlame.length - 1 : appState.fileHistory.length - 1; appState.fileHistorySelected = Math.min(Math.max(0, max), appState.fileHistorySelected + 1); render(); return; }
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
  const len = getVisibleRows().length;
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
    const len = getVisibleRows().length;
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
  if (appState.fileHistoryMode) {
    const commit = appState.fileHistory[appState.fileHistorySelected];
    if (commit?.html_url) showMessage('Commit ' + String(commit.sha || '').slice(0, 8) + ': ' + commit.html_url, 'info', 5000);
    return;
  }
  if (appState.filesBranchPicker) { pickBranch(); return; }
  drillInto();
}

let _backInProgress = false;
export async function backOrLeave() {
  if (_backInProgress) return true;
  if (appState.fileHistoryMode || appState.fileBlameMode) { closeFileHistory(); return true; }
  if (appState.filesBranchPicker) { appState.filesBranchPicker = false; render(); return true; }
  if (getFilesFilter()) { clearFilesFilter(); return true; }
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
  'H': () => openFileHistory(),
  'b': () => openFileBlame(),
  'S': () => saveCurrentFolder(),
  'Z': () => downloadZipball(),
  'C': () => cloneIntoCwd(),
  'G': () => ghCloneIntoCwd(),
  'B': () => openBranchPicker(),
  '/': () => promptFilesFilter(),
  't': () => cycleFilesSort(),
  'e': () => promptGoToPath(),
  'p': () => copyFilePath(),
  'y': () => copyRawUrl(),
  'o': () => openFileInBrowser(),
  'c': () => clearFilesFilter(),
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
