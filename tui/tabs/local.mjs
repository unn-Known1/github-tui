// Local tab — working-tree status, commit history, and diff preview.
// v0.8 Phase 0/1: READ-ONLY. Write flows (stage/discard/commit/fetch/pull/
// push/branch) land in Phase 2/3; their keys show an honest "coming soon"
// toast so no shortcut is ever dead or hijacked (see §6.8 ownership rule).
//
// State lives on flat appState.local* keys (tui/state.mjs). All git runs go
// through runGit() (argv-array, GIT_TERMINAL_PROMPT=0, timeout, abortable)
// with startAsync/isStale guards so polls never clobber manual refreshes.

import {
  appState, tabState, render, startAsync, isStale, showMessage,
  beginLoading, finishLoading, confirm, confirmDanger,
} from '../state.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import {
  runGit, relTime, truncateToWidth, stripAnsi, copyToClipboard,
  getClipboardTempFilePath, openUrl,
} from '../utils.mjs';
import {
  parsePorcelainV1Z, parseLog, parseBranches, statusArgs, logArgs, diffArgs, showArgs,
} from '../git-local.mjs';
import { getLocalGitMeta } from '../git-context.mjs';
import { color } from '../theme.mjs';
import {
  emptyState, collapsibleHeader, loadingIndicator, scrollIndicators,
} from '../render.mjs';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, resolve, sep } from 'path';

const HISTORY_PAGE_SIZE = 50;
const MAX_STATUS_ROWS = 200;
const MAX_DIFF_PREVIEW_CHARS = 12000;
const MAX_VIEW_BYTES = 1_000_000;

// Diff-viewer scroll is view-local (module scope): it dies with navigation,
// which is correct — moving selection closes the diff (see up/down/enter).
let _diffScroll = 0;
// Last-rendered visible row counts per column (for scroll-follow in nav).
let _statusVisible = 10;
let _historyVisible = 10;
// Hit geometry for the mouse layer, rebuilt on every renderLocal frame:
// rows = [{ y, kind: 'status'|'history'|'branch', index }], regions bound
// the wheel/click zones, splitX < 0 in stacked (narrow) layout.
let _rowMap = [];
let _regions = { colY0: 0, colY1: 0, splitX: -1, diffY0: -1, diffY1: -1 };

// Scroll the diff preview (mouse wheel support).
export function scrollDiff(d) {
  _diffScroll = Math.max(0, _diffScroll + d);
  render();
}
// One-shot first-paint kick per repo root (render side-effect, guarded).
let _kickedRoot = null;
// Poll timer (unref'd so tests and CLI one-shots exit cleanly).
let _pollTimer = null;
let _pollTick = 0;

// ─── Derived selectors (pure over appState — exported for tests/mouse) ──

// Unified status rows: conflicted first, then staged, unstaged, untracked.
export function getStatusList() {
  const rows = [];
  for (const e of (appState.localConflicted || [])) rows.push({ section: 'conflicted', path: e.path, code: e.code });
  for (const e of (appState.localStaged || [])) rows.push({ section: 'staged', path: e.path, code: e.code });
  for (const e of (appState.localUnstaged || [])) rows.push({ section: 'unstaged', path: e.path, code: e.code });
  for (const e of (appState.localUntracked || [])) rows.push({ section: 'untracked', path: e.path, code: '??' });
  return rows;
}

export function getSelectedStatusRow() {
  const rows = getStatusList();
  if (rows.length === 0) return null;
  const i = Math.max(0, Math.min(appState.localStatusSelected || 0, rows.length - 1));
  return rows[i];
}

export function getSelectedCommit() {
  const h = appState.localHistory || [];
  if (h.length === 0) return null;
  const i = Math.max(0, Math.min(appState.localHistorySelected || 0, h.length - 1));
  return h[i];
}

function clampList(arr, selKey, scrollKey) {
  const n = Array.isArray(arr) ? arr.length : 0;
  if (n === 0) { appState[selKey] = 0; appState[scrollKey] = 0; return; }
  if (appState[selKey] >= n) appState[selKey] = n - 1;
  if (appState[selKey] < 0) appState[selKey] = 0;
  if (appState[scrollKey] >= n) appState[scrollKey] = n - 1;
  if (appState[scrollKey] < 0) appState[scrollKey] = 0;
}

function detectOpState(gitDir) {
  if (!gitDir) return null;
  try {
    if (existsSync(join(gitDir, 'MERGE_HEAD'))) return 'merge';
    if (existsSync(join(gitDir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick';
    if (existsSync(join(gitDir, 'REVERT_HEAD'))) return 'revert';
    if (existsSync(join(gitDir, 'REBASE_HEAD')) ||
        existsSync(join(gitDir, 'rebase-merge')) ||
        existsSync(join(gitDir, 'rebase-apply'))) return 'rebase';
  } catch { /* absent git dir → no op state */ }
  return null;
}

// ─── Loads ──────────────────────────────────────────────────────

export async function loadLocalStatus(opts = {}) {
  const quiet = !!opts.quiet;
  const meta = getLocalGitMeta();
  if (!meta.isRepo) {
    appState.localIsRepo = false;
    appState.localStatusError = null;
    if (!quiet) render();
    return;
  }
  appState.localIsRepo = true;
  appState.localRoot = meta.root || '';
  appState.localGitDir = meta.gitDir || '';
  appState.localBranch = meta.branch || '';
  appState.localUpstream = meta.upstream || null;
  appState.localOpState = detectOpState(appState.localGitDir);
  const root = appState.localRoot;
  const gen = startAsync('local-status');
  if (!quiet) { beginLoading(gen); render(); }
  try {
    const r = await runGit(statusArgs(), { cwd: root, signal: gen.signal, timeoutMs: 30000 });
    if (isStale(gen)) return;
    if (r.code !== 0) {
      appState.localStatusError = (r.stderr || 'git status failed').trim().split(/\r?\n/)[0];
    } else {
      const p = parsePorcelainV1Z(r.stdout);
      appState.localBranch = p.branch || appState.localBranch;
      // Header carries upstream + ahead/behind when known; never blank a
      // boot-time upstream with an empty parse (older git, odd states).
      if (p.upstream) appState.localUpstream = p.upstream;
      appState.localAhead = p.ahead || 0;
      appState.localBehind = p.behind || 0;
      appState.localStaged = p.staged;
      appState.localUnstaged = p.unstaged;
      appState.localUntracked = p.untracked;
      appState.localConflicted = p.conflicted;
      appState.localStatusError = null;
      appState.localLastFetched = Date.now();
    }
    clampList(getStatusList(), 'localStatusSelected', 'localStatusScroll');
  } catch (e) {
    // Abort/timeout on a superseded poll is silence; real errors surface.
    if (!isStale(gen) && e && e.code !== 'EABORTED') {
      appState.localStatusError = String((e && e.message) || e).split(/\r?\n/)[0];
    }
  } finally {
    if (!quiet) finishLoading(gen);
  }
  if (!isStale(gen)) render();
}

export async function loadLocalHistory(opts = {}) {
  if (!appState.localIsRepo || !appState.localRoot) return;
  const append = !!opts.append;
  const page = append ? (appState.localHistoryPage || 1) + 1 : 1;
  const skip = (page - 1) * HISTORY_PAGE_SIZE;
  const gen = startAsync('local-history');
  beginLoading(gen);
  render();
  try {
    const r = await runGit(logArgs(HISTORY_PAGE_SIZE, skip),
      { cwd: appState.localRoot, signal: gen.signal, timeoutMs: 30000 });
    if (isStale(gen)) return;
    if (r.code !== 0) {
      // Empty repo (no commits yet) exits 128 — honest empty, not an error.
      if (!append) {
        appState.localHistory = [];
        appState.localHistoryHasMore = false;
        appState.localHistoryPage = 1;
      } else {
        appState.localHistoryHasMore = false;
      }
    } else {
      const items = parseLog(r.stdout);
      appState.localHistory = append ? [...appState.localHistory, ...items] : items;
      appState.localHistoryPage = page;
      appState.localHistoryHasMore = items.length >= HISTORY_PAGE_SIZE;
    }
    clampList(appState.localHistory, 'localHistorySelected', 'localHistoryScroll');
  } catch (e) {
    if (!isStale(gen) && e && e.code !== 'EABORTED') {
      showMessage('History: ' + ((e && e.message) || 'failed').split(/\r?\n/)[0], 'error');
    }
  } finally {
    finishLoading(gen);
  }
  if (!isStale(gen)) render();
}

// Read an untracked file from disk for the diff preview. Containment is
// checked against the repo ROOT (not process.cwd()) with binary + size caps.
function readUntrackedFile(root, rel) {
  const target = resolve(root, rel);
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (target !== root && !target.startsWith(prefix)) {
    throw new Error('Path escapes repo: ' + rel);
  }
  const size = statSync(target).size;
  if (!Number.isFinite(size) || size > MAX_VIEW_BYTES) {
    throw new Error('File too large to preview (' + rel + ').');
  }
  const text = readFileSync(target, 'utf-8');
  if (text.slice(0, 8000).includes('\0')) throw new Error('Binary file — preview hidden.');
  return text;
}

export async function loadLocalDiff() {
  if (!appState.localIsRepo || !appState.localRoot) return;
  // Toggle: Enter on the open item closes the preview.
  if (appState.localDiff) {
    appState.localDiff = null;
    _diffScroll = 0;
    render();
    return;
  }
  const gen = startAsync('local-diff');
  beginLoading(gen);
  render();
  try {
    let text = '';
    let label = '';
    let staged = false;
    if (appState.localFocus === 'history') {
      const c = getSelectedCommit();
      if (!c) { showMessage('No commit selected', 'warning'); return; }
      label = c.sha.slice(0, 8) + ' ' + c.subject;
      const r = await runGit(showArgs(c.sha), { cwd: appState.localRoot, signal: gen.signal, timeoutMs: 30000 });
      if (isStale(gen)) return;
      if (r.code !== 0) throw new Error((r.stderr || 'git show failed').trim().split(/\r?\n/)[0]);
      text = r.stdout;
    } else {
      const row = getSelectedStatusRow();
      if (!row) { showMessage('Nothing to diff — working tree clean', 'info'); return; }
      label = (row.section === 'staged' ? 'staged · ' : '') + row.path;
      if (row.section === 'untracked') {
        text = readUntrackedFile(appState.localRoot, row.path);
      } else {
        staged = row.section === 'staged';
        const r = await runGit(diffArgs({ staged, path: row.path }),
          { cwd: appState.localRoot, signal: gen.signal, timeoutMs: 30000 });
        if (isStale(gen)) return;
        if (r.code !== 0) throw new Error((r.stderr || 'git diff failed').trim().split(/\r?\n/)[0]);
        text = r.stdout || (staged ? '(staged, no textual diff)' : '(no unstaged changes)');
      }
    }
    appState.localDiff = {
      path: label,
      staged,
      text: stripAnsi(text).slice(0, MAX_DIFF_PREVIEW_CHARS),
    };
    _diffScroll = 0;
  } catch (e) {
    if (!isStale(gen)) showMessage('Diff: ' + ((e && e.message) || 'failed').split(/\r?\n/)[0], 'error');
  } finally {
    finishLoading(gen);
  }
  if (!isStale(gen)) render();
}

export async function refreshLocal() {
  if (!appState.localIsRepo && !getLocalGitMeta().isRepo) {
    appState.localIsRepo = false;
    render();
    return;
  }
  await loadLocalStatus();
  await loadLocalHistory();
  if (_branchPicker) await loadBranches();
}

// ─── Poller (poll-only in v0.8.0 — no fs.watch) ─────────────────
// 1.5s tick; skips when manual/auto conditions fail; background tabs only
// refresh status every ~4th tick (≈6s). History is on-demand (refreshLocal,
// Space append) — commits change it far less often than the worktree.
export function ensureLocalPoll() {
  if (_pollTimer) return;
  _pollTimer = setInterval(async () => {
    try {
      if (!appState.localAutoPoll || !appState.localIsRepo || appState.loading) return;
      if (appState.inputMode || appState.confirmAction) return;
      _pollTick++;
      if (tabState.current !== 5 && (_pollTick % 4) !== 0) return;
      await loadLocalStatus({ quiet: true });
    } catch { /* poller never throws into the interval */ }
  }, 1500);
  if (_pollTimer.unref) _pollTimer.unref();
}

export function stopLocalPoll() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

// ─── Navigation (up/down/enter/space/page/top/bottom) ───────────

function closeDiff() {
  if (appState.localDiff) {
    appState.localDiff = null;
    _diffScroll = 0;
  }
}

// Mouse seam: close the diff preview without touching selection.
export function closeDiffView() {
  closeDiff();
  render();
}

export function up() {
  if (_branchPicker) { pickerMove(-1); return; }
  if (appState.localDiff) {
    if (_diffScroll > 0) _diffScroll--;
    render();
    return;
  }
  if (appState.localFocus === 'history') {
    if (appState.localHistorySelected > 0) appState.localHistorySelected--;
    if (appState.localHistorySelected < appState.localHistoryScroll) {
      appState.localHistoryScroll = appState.localHistorySelected;
    }
  } else {
    if (appState.localStatusSelected > 0) appState.localStatusSelected--;
    if (appState.localStatusSelected < appState.localStatusScroll) {
      appState.localStatusScroll = appState.localStatusSelected;
    }
  }
  closeDiff();
  render();
}

function followScrollDown() {
  if (appState.localFocus === 'history') {
    const vis = Math.max(1, _historyVisible);
    if (appState.localHistorySelected >= (appState.localHistoryScroll || 0) + vis) {
      appState.localHistoryScroll = appState.localHistorySelected - vis + 1;
    }
  } else {
    const vis = Math.max(1, _statusVisible);
    if (appState.localStatusSelected >= (appState.localStatusScroll || 0) + vis) {
      appState.localStatusScroll = appState.localStatusSelected - vis + 1;
    }
  }
}

export function down() {
  if (_branchPicker) { pickerMove(1); return; }
  if (appState.localDiff) {
    _diffScroll++;
    render();
    return;
  }
  if (appState.localFocus === 'history') {
    const n = (appState.localHistory || []).length;
    if (n > 0 && appState.localHistorySelected < n - 1) appState.localHistorySelected++;
  } else {
    const n = getStatusList().length;
    if (n > 0 && appState.localStatusSelected < n - 1) appState.localStatusSelected++;
  }
  followScrollDown();
  closeDiff();
  render();
}

export function enter() {
  if (_branchPicker) {
    checkoutSelectedBranch();
    return;
  }
  loadLocalDiff().catch(e => showMessage((e && e.message) || 'Diff failed', 'error'));
}

export function space() {
  // The picker owns its rows — never page history underneath it.
  if (_branchPicker) return;
  // Space always pages history (append model, like dashboard trending).
  if (!appState.localHistoryHasMore) { showMessage('No more commits', 'info'); return; }
  loadLocalHistory({ append: true }).catch(e => showMessage((e && e.message) || 'Failed', 'error'));
}

export function pageUp() {
  if (appState.localDiff) { _diffScroll = Math.max(0, _diffScroll - 10); render(); return; }
  for (let i = 0; i < 10; i++) {
    if (appState.localFocus === 'history') {
      if (appState.localHistorySelected <= 0) break;
      appState.localHistorySelected--;
    } else {
      if (appState.localStatusSelected <= 0) break;
      appState.localStatusSelected--;
    }
  }
  if (appState.localFocus === 'history') {
    if (appState.localHistorySelected < appState.localHistoryScroll) {
      appState.localHistoryScroll = appState.localHistorySelected;
    }
  } else if (appState.localStatusSelected < appState.localStatusScroll) {
    appState.localStatusScroll = appState.localStatusSelected;
  }
  closeDiff();
  render();
}

export function pageDown() {
  if (appState.localDiff) { _diffScroll += 10; render(); return; }
  for (let i = 0; i < 10; i++) {
    if (appState.localFocus === 'history') {
      if (appState.localHistorySelected >= (appState.localHistory || []).length - 1) break;
      appState.localHistorySelected++;
    } else {
      if (appState.localStatusSelected >= getStatusList().length - 1) break;
      appState.localStatusSelected++;
    }
  }
  followScrollDown();
  closeDiff();
  render();
}

export function top() {
  if (appState.localDiff) { _diffScroll = 0; render(); return; }
  closeDiff();
  if (appState.localFocus === 'history') {
    appState.localHistorySelected = 0;
    appState.localHistoryScroll = 0;
  } else {
    appState.localStatusSelected = 0;
    appState.localStatusScroll = 0;
  }
  render();
}

export function bottom() {
  if (appState.localDiff) { _diffScroll = 999999; render(); return; }
  closeDiff();
  if (appState.localFocus === 'history') {
    appState.localHistorySelected = Math.max(0, (appState.localHistory || []).length - 1);
  } else {
    appState.localStatusSelected = Math.max(0, getStatusList().length - 1);
  }
  render();
}

export function switchFocus() {
  if (_branchPicker) { closeBranchPicker(); return; }
  appState.localFocus = appState.localFocus === 'history' ? 'status' : 'history';
  closeDiff();
  render();
}

// ─── Sync flows (Phase 3) ───────────────────────────────────────
// fetch is read-only (direct, no confirm). Pull/push guard on op-state,
// detached HEAD, and missing upstream; lease-only force, never bare --force.

// Pure classifiers (unit-tested) so network/auth failures surface hints.
export function isAuthError(stderr) {
  return /permission denied|authentication failed|\b401\b|\b403\b|credential|could not read username|terminal prompts disabled/i
    .test(String(stderr || ''));
}

export function isRejectionError(stderr) {
  return /non-fast-forward|fetch first|failed to push|behind.*tip|updates were rejected/i
    .test(String(stderr || ''));
}

export function gitAuthHint() {
  return 'git auth ≠ TUI login — run git pull/push once in a shell to cache credentials';
}

function syncBlocked() {
  if (!needRepo()) return 'Not a git repository';
  if (appState.localOpState) {
    return { merge: 'Merge in progress — resolve conflicts, then commit',
      rebase: 'Rebase in progress — continue or abort in a shell first',
      'cherry-pick': 'Cherry-pick in progress — resolve, then commit',
      revert: 'Revert in progress — resolve, then commit' }[appState.localOpState]
      || 'Operation in progress — finish it first';
  }
  if (String(appState.localBranch || '').startsWith('HEAD (detached')) {
    return 'Detached HEAD — checkout a branch first (B)';
  }
  return null;
}

export async function fetchFlow() {
  if (!needRepo()) return;
  const gen = startAsync('local-fetch');
  beginLoading(gen);
  showMessage('Fetching…', 'info');
  render();
  try {
    const r = await runGit(['fetch', '--prune'], { cwd: appState.localRoot, signal: gen.signal, timeoutMs: 120000 });
    if (isStale(gen)) return;
    if (r.code !== 0) {
      if (isAuthError(r.stderr)) { showMessage(gitAuthHint(), 'error', 8000); return; }
      gitFailed('Fetch', r);
      return;
    }
    showMessage('Fetched', 'success');
    await loadLocalStatus({ quiet: true });
  } catch (e) {
    if (!isStale(gen) && e && e.code !== 'EABORTED') showMessage('Fetch: ' + String(e.message || e).slice(0, 120), 'error');
  } finally {
    finishLoading(gen);
  }
  if (!isStale(gen)) render();
}

export function pullFlow() {
  if (!needRepo()) return;
  const blocked = syncBlocked();
  if (blocked) { showMessage(blocked, blocked === 'Not a git repository' ? 'warning' : 'error'); return; }
  if (!appState.localUpstream) {
    showMessage('No upstream — push with -u first (P), or set it in a shell', 'warning');
    return;
  }
  const dirty = (appState.localStaged || []).length + (appState.localUnstaged || []).length +
    (appState.localUntracked || []).length;
  const msg = 'Pull --rebase — ' + (appState.localUpstream || '?') +
    '\n\n`git pull --rebase --autostash`' +
    '\n\nLocal commits will be rebased.' +
    (dirty > 0 ? '\n\n' + dirty + ' uncommitted file(s) — autostash will stash and pop them.' : '') +
    (appState.localBehind > 0 ? '\n\nBehind by ' + appState.localBehind + '.' : '');
  // Clean worktree pulls straight through; dirty worktrees confirm (autostash note).
  if (dirty > 0) confirm(msg, () => _pullImpl(), 'Pull --rebase');
  else _pullImpl();
}

async function _pullImpl() {
  const gen = startAsync('local-pull');
  beginLoading(gen);
  showMessage('Pulling…', 'info');
  render();
  try {
    const r = await runGit(['pull', '--rebase', '--autostash'],
      { cwd: appState.localRoot, signal: gen.signal, timeoutMs: 120000 });
    if (isStale(gen)) return;
    if (r.code !== 0) {
      const err = String(r.stderr || '');
      if (/conflict|could not apply|failed to merge|needs merge/i.test(err)) {
        showMessage('Pull stopped on conflicts — resolve them, then continue in a shell', 'warning', 8000);
        await refreshLocal();
        return;
      }
      if (isAuthError(err)) { showMessage(gitAuthHint(), 'error', 8000); return; }
      gitFailed('Pull', r);
      return;
    }
    showMessage('Pulled', 'success');
    await refreshLocal();
  } catch (e) {
    if (!isStale(gen) && e && e.code !== 'EABORTED') showMessage('Pull: ' + String(e.message || e).slice(0, 120), 'error');
  } finally {
    finishLoading(gen);
  }
  if (!isStale(gen)) render();
}

export function pushFlow() {
  if (!needRepo()) return;
  const blocked = syncBlocked();
  if (blocked) { showMessage(blocked, blocked === 'Not a git repository' ? 'warning' : 'error'); return; }
  const branch = appState.localBranch || '';
  if (!appState.localUpstream) {
    confirm('Push & set upstream — ' + branch +
      '\n\n`git push -u origin ' + branch + '`' +
      '\n\nCreates the remote branch and tracks it.',
      () => _pushImpl(['push', '-u', 'origin', branch], 'push -u'),
      'Push & set upstream');
    return;
  }
  if ((appState.localBehind || 0) > 0) {
    confirm('Push anyway? — behind by ' + appState.localBehind +
      '\n\nPull first is recommended. A normal push will likely be rejected' +
      ' (non-fast-forward), after which you can force-with-lease.' +
      '\n\n`git push`',
      () => _pushImpl(['push'], 'push'),
      'Push');
    return;
  }
  // Fast-forward fast path: routine, deliberate (owned key), direct.
  _pushImpl(['push'], 'push');
}

async function _pushImpl(args, label) {
  const gen = startAsync('local-push');
  beginLoading(gen);
  showMessage('Pushing…', 'info');
  render();
  try {
    const r = await runGit(args, { cwd: appState.localRoot, signal: gen.signal, timeoutMs: 120000 });
    if (isStale(gen)) return;
    if (r.code !== 0) {
      const err = String(r.stderr || '');
      if (isRejectionError(err)) {
        confirmDanger('Push rejected — non-fast-forward' +
          '\n\nThe remote moved. Pull + rebase first, or force with a lease.' +
          '\n\n`git push --force-with-lease`' +
          '\n\n⚠ IRREVERSIBLE RISK — rewrites remote history (lease-guarded). Never bare --force.' +
          '\n\nPress y to review the lease push, n to stop.',
          () => confirmDanger('Force with lease — confirm' +
            '\n\n`git push --force-with-lease`' +
            '\n\n⚠ IRREVERSIBLE — remote commits outside the lease are lost.' +
            '\n\nPress y to push, n to keep the remote as-is.',
            () => _pushImpl(['push', '--force-with-lease'], 'force-push'),
            'Force with lease'),
          'Push rejected');
        return;
      }
      if (isAuthError(err)) { showMessage(gitAuthHint(), 'error', 8000); return; }
      gitFailed('Push', r);
      return;
    }
    showMessage(label === 'force-push' ? 'Force-pushed (lease)' : 'Pushed', 'success');
    await loadLocalStatus({ quiet: true });
  } catch (e) {
    if (!isStale(gen) && e && e.code !== 'EABORTED') showMessage('Push: ' + String(e.message || e).slice(0, 120), 'error');
  } finally {
    finishLoading(gen);
  }
  if (!isStale(gen)) render();
}

// ─── Write flows (Phase 2) ─────────────────────────────────────
// Every flow re-reads selection at fire time (never trusts a stale row),
// runs argv-only git, then reloads status (+history for commits).

function needRepo() {
  if (!appState.localIsRepo || !appState.localRoot) {
    showMessage('Not a git repository', 'warning');
    return false;
  }
  return true;
}

function gitFailed(action, r) {
  const first = String(r.stderr || r.stdout || 'failed').trim().split(/\r?\n/)[0];
  showMessage(action + ': ' + first.slice(0, 120), 'error');
}

// `git restore` needs git ≥2.23 — fall back to the classic spelling when
// the binary reports an unknown option (covers old git without probing).
function isUnknownOption(r) {
  return r && r.code !== 0 && /unknown option/i.test(String(r.stderr || ''));
}

export async function toggleStage() {
  if (!needRepo()) return;
  const row = getSelectedStatusRow();
  if (!row) { showMessage('Nothing to stage', 'warning'); return; }
  if (row.section === 'staged') {
    await _unstagePath(row.path);
    return;
  }
  // untracked + unstaged (+conflicted: `add` marks resolved) stage via add.
  const gen = startAsync('local-stage');
  beginLoading(gen);
  try {
    const r = await runGit(['add', '--', row.path], { cwd: appState.localRoot, signal: gen.signal, timeoutMs: 30000 });
    if (isStale(gen)) return;
    if (r.code !== 0) { gitFailed('Stage', r); return; }
    showMessage('Staged ' + row.path, 'success');
    await loadLocalStatus({ quiet: true });
  } catch (e) {
    if (!isStale(gen) && e && e.code !== 'EABORTED') showMessage('Stage: ' + String(e.message || e).slice(0, 120), 'error');
  } finally {
    finishLoading(gen);
  }
  if (!isStale(gen)) render();
}

async function _unstagePath(path) {
  const gen = startAsync('local-stage');
  beginLoading(gen);
  try {
    let r = await runGit(['restore', '--staged', '--', path],
      { cwd: appState.localRoot, signal: gen.signal, timeoutMs: 30000 });
    if (isUnknownOption(r)) {
      r = await runGit(['reset', 'HEAD', '--', path],
        { cwd: appState.localRoot, signal: gen.signal, timeoutMs: 30000 });
    }
    if (isStale(gen)) return;
    if (r.code !== 0) { gitFailed('Unstage', r); return; }
    showMessage('Unstaged ' + path, 'success');
    await loadLocalStatus({ quiet: true });
  } catch (e) {
    if (!isStale(gen) && e && e.code !== 'EABORTED') showMessage('Unstage: ' + String(e.message || e).slice(0, 120), 'error');
  } finally {
    finishLoading(gen);
  }
  if (!isStale(gen)) render();
}

export function stageAll() {
  if (!needRepo()) return;
  const n = (appState.localUnstaged || []).length + (appState.localUntracked || []).length;
  if (n === 0) { showMessage('Nothing to stage — working tree matches the index', 'info'); return; }
  const sample = [...appState.localUnstaged, ...appState.localUntracked]
    .slice(0, 5).map(e => '  ' + e.path).join('\n');
  confirm(
    'Stage all — ' + n + ' file' + (n === 1 ? '' : 's') + '\n\n' + sample +
    (n > 5 ? '\n  … +' + (n - 5) + ' more' : '') +
    '\n\n`git add -A`\n\nUndo with unstage.',
    () => _stageAllImpl(),
    'Stage all');
}

async function _stageAllImpl() {
  const gen = startAsync('local-stage');
  beginLoading(gen);
  render();
  try {
    const r = await runGit(['add', '-A'], { cwd: appState.localRoot, signal: gen.signal, timeoutMs: 60000 });
    if (isStale(gen)) return;
    if (r.code !== 0) { gitFailed('Stage all', r); return; }
    showMessage('Staged all', 'success');
    await loadLocalStatus({ quiet: true });
  } catch (e) {
    if (!isStale(gen) && e && e.code !== 'EABORTED') showMessage('Stage all: ' + String(e.message || e).slice(0, 120), 'error');
  } finally {
    finishLoading(gen);
  }
  if (!isStale(gen)) render();
}

// ─── Discard (double danger confirm — irreversible) ────────────

export function discardFlow() {
  if (!needRepo()) return;
  const row = getSelectedStatusRow();
  if (!row) { showMessage('Nothing to discard', 'warning'); return; }
  if (row.section === 'staged') {
    showMessage('Unstage first (`a`), then discard — staged work is protected', 'warning');
    return;
  }
  const untracked = row.section === 'untracked';
  const cmd = untracked
    ? 'git clean -f -- ' + row.path
    : 'git restore --source=HEAD --staged --worktree -- ' + row.path;
  const what = untracked ? 'delete the untracked file' : 'throw away unstaged edits to';
  confirmDanger(
    'Discard changes — ' + row.path + '\n\nThis will ' + what + ':\n  ' + row.path +
    '\n\n`' + cmd + '`',
    () => confirmDanger(
      'Confirm discard — IRREVERSIBLE\n\n' + row.path +
      '\n\n⚠ IRREVERSIBLE — the content above is lost. There is no undo.' +
      '\n\nPress y to destroy, n to keep.',
      () => _discardImpl(row.path, untracked),
      'Confirm discard'),
    'Discard changes');
}

async function _discardImpl(path, untracked) {
  const gen = startAsync('local-discard');
  beginLoading(gen);
  render();
  try {
    let r;
    if (untracked) {
      r = await runGit(['clean', '-f', '--', path],
        { cwd: appState.localRoot, signal: gen.signal, timeoutMs: 30000 });
    } else {
      r = await runGit(['restore', '--source=HEAD', '--staged', '--worktree', '--', path],
        { cwd: appState.localRoot, signal: gen.signal, timeoutMs: 30000 });
      if (isUnknownOption(r)) {
        r = await runGit(['checkout', 'HEAD', '--', path],
          { cwd: appState.localRoot, signal: gen.signal, timeoutMs: 30000 });
      }
    }
    if (isStale(gen)) return;
    if (r.code !== 0) { gitFailed('Discard', r); return; }
    showMessage('Discarded ' + path, 'success');
    closeDiff();
    await loadLocalStatus({ quiet: true });
  } catch (e) {
    if (!isStale(gen) && e && e.code !== 'EABORTED') showMessage('Discard: ' + String(e.message || e).slice(0, 120), 'error');
  } finally {
    finishLoading(gen);
  }
  if (!isStale(gen)) render();
}

// ─── Branch picker (Phase 3) ───────────────────────────────────
// View-local state (module scope, like _diffScroll): the list is cheap to
// reload and never needs session persistence.
let _branches = [];
let _branchPicker = false;
let _branchCursor = 0;
let _branchScroll = 0;

export function isBranchPickerOpen() { return _branchPicker; }
// Test seam: read-only copy + cursor setter (no other way to drive the
// picker deterministically without a screen).
export function getPickerBranches() { return _branches.map(b => ({ ...b })); }
export function setBranchCursor(i) {
  _branchCursor = Math.max(0, Math.min(i | 0, Math.max(0, _branches.length - 1)));
  render();
}

export async function loadBranches() {
  if (!appState.localIsRepo || !appState.localRoot) return;
  const gen = startAsync('local-branches');
  beginLoading(gen);
  try {
    const r = await runGit(['branch', '-a', '--no-color'],
      { cwd: appState.localRoot, signal: gen.signal, timeoutMs: 15000 });
    if (isStale(gen)) return;
    if (r.code !== 0) {
      _branches = [];
      if (!isStale(gen)) showMessage('Branches: ' + String(r.stderr || 'failed').trim().split(/\r?\n/)[0].slice(0, 100), 'error');
      return;
    }
    _branches = parseBranches(r.stdout);
    const cur = _branches.findIndex(b => b.current);
    if (cur >= 0 && !_branchPicker) _branchCursor = cur;
  } catch (e) {
    if (!isStale(gen) && e && e.code !== 'EABORTED') showMessage('Branches: ' + String(e.message || e).slice(0, 100), 'error');
  } finally {
    finishLoading(gen);
  }
  if (!isStale(gen)) render();
}

export async function openBranchPicker() {
  if (!needRepo()) return;
  await loadBranches();
  _branchPicker = true;
  const cur = _branches.findIndex(b => b.current);
  _branchCursor = cur >= 0 ? cur : 0;
  _branchScroll = 0;
  render();
}

export function closeBranchPicker() {
  if (!_branchPicker) return;
  _branchPicker = false;
  render();
}

function pickerMove(d) {
  if (_branches.length === 0) return;
  _branchCursor = Math.max(0, Math.min(_branches.length - 1, _branchCursor + d));
  render();
}

function shortBranchName(name) {
  const m = String(name || '').match(/^remotes\/[^/]+\/(.+)$/);
  return m ? m[1] : String(name || '');
}

export function checkoutSelectedBranch() {
  const b = _branches[_branchCursor];
  if (!b) return;
  if (b.detached) { showMessage('Detached HEAD entry — checkout a branch instead', 'warning'); return; }
  const target = shortBranchName(b.name);
  if (!b.remote && target === appState.localBranch) {
    showMessage('Already on ' + target, 'info');
    closeBranchPicker();
    return;
  }
  if ((appState.localConflicted || []).length > 0) {
    showMessage('Resolve conflicts first — switching branches now risks them', 'error');
    return;
  }
  const dirty = (appState.localStaged || []).length + (appState.localUnstaged || []).length +
    (appState.localUntracked || []).length;
  const run = () => _checkoutImpl(target);
  if (dirty > 0) {
    confirm('Switch to ' + target + '?' +
      '\n\n' + dirty + ' uncommitted file(s) will be carried over.' +
      '\n\n`git checkout ' + target + '`',
      run, 'Switch branch');
  } else run();
}

async function _checkoutImpl(target) {
  const gen = startAsync('local-branch');
  beginLoading(gen);
  render();
  try {
    const r = await runGit(['checkout', target],
      { cwd: appState.localRoot, signal: gen.signal, timeoutMs: 30000 });
    if (isStale(gen)) return;
    if (r.code !== 0) {
      showMessage('Checkout: ' + String(r.stderr || 'failed').trim().split(/\r?\n/)[0].slice(0, 140), 'error', 8000);
      return;
    }
    showMessage('Switched to ' + target, 'success');
    closeDiff();
    _branchPicker = false;
    await loadLocalStatus({ quiet: true });
    await loadLocalHistory();
  } catch (e) {
    if (!isStale(gen) && e && e.code !== 'EABORTED') showMessage('Checkout: ' + String(e.message || e).slice(0, 120), 'error');
  } finally {
    finishLoading(gen);
  }
  if (!isStale(gen)) render();
}

export function createBranchFlow() {
  if (!needRepo()) return;
  if (!_branchPicker) { showMessage('Open the branch picker first (B)', 'warning'); return; }
  startInput('New branch: ', 'local-new-branch');
}

function submitNewBranch(name) {
  if (!name) { showMessage('Empty name — cancelled', 'warning'); render(); return Promise.resolve(); }
  if (name.length > 200) { showMessage('Branch name too long — cancelled', 'warning'); render(); return Promise.resolve(); }
  return (async () => {
    if (!needRepo()) return;
    // NOTE: no `--` separator — check-ref-format rejects it with exit 129.
    // Names starting with `-` are invalid per git rules anyway.
    const v = await runGit(['check-ref-format', '--branch', name],
      { cwd: appState.localRoot, timeoutMs: 8000 });
    if (v.code !== 0) { showMessage('Invalid branch name: ' + name, 'error'); render(); return; }
    confirm('Create branch — ' + name +
      '\n\n`git checkout -b ' + name + '`' +
      '\n\nSwitches to the new branch.',
      () => _createImpl(name), 'Create branch');
  })().catch(e => showMessage('Create branch: ' + String((e && e.message) || e).slice(0, 120), 'error'));
}

registerInputHandler('local-new-branch', (value) => {
  submitNewBranch(String(value || '').trim());
});

async function _createImpl(name) {
  const gen = startAsync('local-branch');
  beginLoading(gen);
  render();
  try {
    const r = await runGit(['checkout', '-b', name],
      { cwd: appState.localRoot, signal: gen.signal, timeoutMs: 30000 });
    if (isStale(gen)) return;
    if (r.code !== 0) {
      showMessage('Create branch: ' + String(r.stderr || 'failed').trim().split(/\r?\n/)[0].slice(0, 140), 'error');
      return;
    }
    showMessage('Created and switched to ' + name, 'success');
    closeDiff();
    _branchPicker = false;
    await loadLocalStatus({ quiet: true });
    await loadLocalHistory();
  } catch (e) {
    if (!isStale(gen) && e && e.code !== 'EABORTED') showMessage('Create branch: ' + String(e.message || e).slice(0, 120), 'error');
  } finally {
    finishLoading(gen);
  }
  if (!isStale(gen)) render();
}

export function deleteBranchFlow() {
  if (!needRepo()) return;
  if (!_branchPicker) { showMessage('Open the branch picker first (B)', 'warning'); return; }
  const b = _branches[_branchCursor];
  if (!b) return;
  if (b.remote) { showMessage('Remote branches: delete from a shell (destructive)', 'warning'); return; }
  if (b.detached) return;
  if (b.name === appState.localBranch) {
    showMessage('Checkout another branch first — cannot delete the current one', 'warning');
    return;
  }
  confirm('Delete branch — ' + b.name + '?' +
    '\n\n`git branch -d ' + b.name + '`' +
    '\n\nUsually recoverable via reflog for ~30 days.',
    () => _deleteImpl(b.name, false), 'Delete branch');
}

async function _deleteImpl(name, force) {
  const gen = startAsync('local-branch');
  beginLoading(gen);
  render();
  try {
    const r = await runGit(['branch', force ? '-D' : '-d', name],
      { cwd: appState.localRoot, signal: gen.signal, timeoutMs: 30000 });
    if (isStale(gen)) return;
    if (r.code !== 0) {
      if (!force && /not fully merged/i.test(String(r.stderr || ''))) {
        confirmDanger('Force-delete unmerged branch?' +
          '\n\n' + name + ' is NOT fully merged.' +
          '\n\n`git branch -D ' + name + '`' +
          '\n\n⚠ IRREVERSIBLE — unmerged commits may be lost.' +
          '\n\nPress y to destroy, n to keep.',
          () => _deleteImpl(name, true), 'Force delete');
        return;
      }
      gitFailed('Delete branch', r);
      return;
    }
    showMessage('Deleted ' + name, 'success');
    await loadBranches();
    await loadLocalStatus({ quiet: true });
  } catch (e) {
    if (!isStale(gen) && e && e.code !== 'EABORTED') showMessage('Delete branch: ' + String(e.message || e).slice(0, 120), 'error');
  } finally {
    finishLoading(gen);
  }
  if (!isStale(gen)) render();
}

// ─── Commit (two-prompt subject + optional body — decided §15) ──

const MAX_SUBJECT = 500;
const MAX_BODY = 4000;

let _pendingSubject = '';
let _pendingBodyPrefill = '';

// Classify commit failures into actionable hints (pure — unit-tested).
export function classifyCommitError(stderr) {
  const s = String(stderr || '');
  if (/unable to auto-detect|user\.name|user\.email|identity unknown|empty ident/i.test(s)) {
    return 'No git identity — run: git config user.name "You" && git config user.email "you@x"';
  }
  if (/gpgsign|gpg failed|signing failed|pinentry/i.test(s)) {
    return 'GPG signing failed — unlock your key or unset commit.gpgsign for this repo';
  }
  if (/nothing to commit|no changes added/i.test(s)) {
    return 'Nothing to commit — stage changes first (`a`)';
  }
  if (/empty commit message|aborting commit due to empty/i.test(s)) {
    return 'Empty commit message — aborted';
  }
  return null;
}

export function commitFlow() {
  if (!needRepo()) return;
  const n = (appState.localStaged || []).length;
  if (n === 0) { showMessage('Nothing staged — press `a` on a file first', 'warning'); return; }
  _pendingBodyPrefill = '';
  startInput('Commit subject: ', 'local-commit-subject');
}

export async function amendFlow() {
  if (!needRepo()) return;
  if ((appState.localHistory || []).length === 0) {
    // History may simply not be loaded yet — try once before giving up.
    await loadLocalHistory();
    if ((appState.localHistory || []).length === 0) { showMessage('No commits to amend', 'warning'); return; }
  }
  const head = appState.localHistory[0];
  _pendingBodyPrefill = head.body || '';
  startInput('Amend subject: ', 'local-amend-subject', false, head.subject || '');
}

function commitConfirmBody(kind, subject, body, stagedList) {
  const files = stagedList.slice(0, 5).map(e => '  ' + e.path).join('\n');
  const more = stagedList.length > 5 ? '\n  … +' + (stagedList.length - 5) + ' more' : '';
  const cmd = kind === 'amend'
    ? '`git commit --amend -m "' + subject.slice(0, 60) + '"' + (body ? ' -m …' : '') + '`'
    : '`git commit -m "' + subject.slice(0, 60) + '"' + (body ? ' -m …' : '') + '`';
  return (kind === 'amend' ? 'Amend HEAD' : 'Commit') + ' on ' + (appState.localBranch || '?') +
    '\n\nSubject: ' + subject +
    (body ? '\nBody:\n' + body.split(/\r?\n/).slice(0, 3).join('\n') : '') +
    '\n\nStaged (' + stagedList.length + '):\n' + files + more +
    '\n\n' + cmd +
    (kind === 'amend'
      ? '\n\nRewrites the last commit (SHA changes).'
      : '\n\nCreates a local commit on ' + (appState.localBranch || '?') + '.');
}

registerInputHandler('local-commit-subject', (value) => {
  const subject = String(value || '').trim();
  if (!subject) { showMessage('Empty subject — commit cancelled', 'warning'); render(); return; }
  if (subject.length > MAX_SUBJECT) {
    showMessage('Subject too long (' + subject.length + '/' + MAX_SUBJECT + ') — commit cancelled', 'warning');
    render();
    return;
  }
  _pendingSubject = subject;
  startInput('Body (optional — Enter to skip): ', 'local-commit-body');
});

registerInputHandler('local-commit-body', (value) => {
  const body = String(value || '').trim().slice(0, MAX_BODY);
  const subject = _pendingSubject;
  _pendingSubject = '';
  if (!subject) { showMessage('Commit cancelled', 'warning'); render(); return; }
  const staged = [...(appState.localStaged || [])];
  if (staged.length === 0) { showMessage('Nothing staged — stage changes first (`a`)', 'warning'); render(); return; }
  confirm(commitConfirmBody('commit', subject, body, staged),
    () => _commitImpl(subject, body, false),
    'Commit');
});

registerInputHandler('local-amend-subject', (value) => {
  const subject = String(value || '').trim();
  if (!subject) { showMessage('Empty subject — amend cancelled', 'warning'); render(); return; }
  if (subject.length > MAX_SUBJECT) {
    showMessage('Subject too long (' + subject.length + '/' + MAX_SUBJECT + ') — amend cancelled', 'warning');
    render();
    return;
  }
  _pendingSubject = subject;
  startInput('Amend body (optional — Enter to keep): ', 'local-amend-body', false, _pendingBodyPrefill);
  _pendingBodyPrefill = '';
});

registerInputHandler('local-amend-body', (value) => {
  // Untouched Enter keeps the prefilled HEAD body; clear-all + Enter drops it.
  const body = String(value || '').trim().slice(0, MAX_BODY);
  _pendingBodyPrefill = '';
  const subject = _pendingSubject;
  _pendingSubject = '';
  if (!subject) { showMessage('Amend cancelled', 'warning'); render(); return; }
  const staged = [...(appState.localStaged || [])];
  confirm(commitConfirmBody('amend', subject, body, staged),
    () => _commitImpl(subject, body, true),
    'Amend HEAD');
});

async function _commitImpl(subject, body, amend) {
  const gen = startAsync('local-commit');
  beginLoading(gen);
  render();
  try {
    const args = amend ? ['commit', '--amend', '-m', subject] : ['commit', '-m', subject];
    if (body) args.push('-m', body);
    const r = await runGit(args, { cwd: appState.localRoot, signal: gen.signal, timeoutMs: 60000 });
    if (isStale(gen)) return;
    if (r.code !== 0) {
      const hint = classifyCommitError(r.stderr);
      const first = String(r.stderr || 'commit failed').trim().split(/\r?\n/).slice(0, 3).join(' / ');
      showMessage(hint || ((amend ? 'Amend' : 'Commit') + ': ' + first.slice(0, 160)), 'error', 8000);
      return;
    }
    showMessage(amend ? 'Amended HEAD' : 'Committed', 'success');
    closeDiff();
    await loadLocalStatus({ quiet: true });
    await loadLocalHistory();
  } catch (e) {
    if (!isStale(gen) && e && e.code !== 'EABORTED') showMessage('Commit: ' + String(e.message || e).slice(0, 120), 'error');
  } finally {
    finishLoading(gen);
  }
  if (!isStale(gen)) render();
}

export function copyCurrent() {
  if (appState.localFocus === 'history') {
    const c = getSelectedCommit();
    if (!c) { showMessage('No commit selected', 'warning'); return; }
    if (copyToClipboard(c.sha)) {
      const tmp = getClipboardTempFilePath();
      showMessage(tmp ? 'SHA saved to ' + tmp : 'Copied ' + c.sha.slice(0, 8), 'success');
    } else showMessage('Clipboard copy failed', 'error');
    return;
  }
  const row = getSelectedStatusRow();
  if (!row) { showMessage('Nothing to copy', 'warning'); return; }
  if (copyToClipboard(row.path)) showMessage('Copied path: ' + row.path, 'success');
  else showMessage('Clipboard copy failed', 'error');
}

export async function openCurrent() {
  const c = appState.localFocus === 'history' ? getSelectedCommit() : null;
  if (!c) {
    // Status rows have no GitHub URL — open the repo root when known.
    if (!appState.localRepo) { showMessage('No GitHub remote — local only', 'warning'); return; }
    const url = 'https://github.com/' + appState.localRepo.owner + '/' + appState.localRepo.repo;
    const res = await openUrl(url);
    if (res.ok) showMessage('Opened ' + url, 'success');
    else showMessage(res.error || 'Open failed', 'error');
    return;
  }
  if (!appState.localRepo) { showMessage('No GitHub remote — local only', 'warning'); return; }
  const url = 'https://github.com/' + appState.localRepo.owner + '/' + appState.localRepo.repo + '/commit/' + c.sha;
  const res = await openUrl(url);
  if (res.ok) showMessage('Opened commit in browser', 'success');
  else showMessage(res.error || 'Open failed', 'error');
}

export const keys = {
  '\r': () => enter(),
  '\n': () => enter(),
  'a': () => toggleStage(),
  'A': () => stageAll(),
  'X': () => discardFlow(),
  'c': () => commitFlow(),
  'C': () => amendFlow(),
  'f': () => fetchFlow(),
  'p': () => pullFlow(),
  'P': () => pushFlow(),
  'B': () => openBranchPicker(),
  'b': () => openBranchPicker(),
  'n': () => createBranchFlow(),
  'd': () => deleteBranchFlow(),
  '[': () => switchFocus(),
  ']': () => switchFocus(),
  'y': () => copyCurrent(),
  'o': () => openCurrent(),
  'r': () => refreshLocal().catch(e => showMessage((e && e.message) || 'Refresh failed', 'error')),
  'g': () => top(),
  'G': () => bottom(),
  ' ': () => space(),
  // NOTE: no 'z'/'Z' entries — collapse stays on the global path via
  // getCurrentSection()/getSections() below (Phase 1 keeps all three).
};

export function getSections() {
  return ['local:conflicted', 'local:staged', 'local:unstaged', 'local:untracked', 'local:commits'];
}

export function getCurrentSection() {
  if (appState.localFocus === 'history') return 'local:commits';
  const row = getSelectedStatusRow();
  if (!row) return 'local:staged';
  return 'local:' + row.section;
}

// Back handler for Esc/h: close picker, then diff; return false when there
// is nothing local to dismiss so keys.mjs falls through to setTab(0).
export function back() {
  if (_branchPicker) {
    _branchPicker = false;
    render();
    return true;
  }
  if (appState.localDiff) {
    appState.localDiff = null;
    _diffScroll = 0;
    render();
    return true;
  }
  return false;
}

// ─── Render ─────────────────────────────────────────────────────

function ageLabel() {
  if (!appState.localLastFetched) return 'never';
  const ms = Math.max(0, Date.now() - appState.localLastFetched);
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return Math.floor(ms / 60_000) + 'm ago';
  return Math.floor(ms / 3_600_000) + 'h ago';
}

const SECTION_META = [
  { id: 'local:conflicted', title: 'CONFLICTED', list: () => appState.localConflicted || [], kind: 'conflicted' },
  { id: 'local:staged', title: 'STAGED', list: () => appState.localStaged || [], kind: 'staged' },
  { id: 'local:unstaged', title: 'UNSTAGED', list: () => appState.localUnstaged || [], kind: 'unstaged' },
  { id: 'local:untracked', title: 'UNTRACKED', list: () => appState.localUntracked || [], kind: 'untracked' },
];

function statusIcon(kind) {
  if (appState.accessible) {
    return kind === 'conflicted' ? '[!]' : kind === 'staged' ? '[S]' : kind === 'untracked' ? '[?]' : '[M]';
  }
  return kind === 'conflicted' ? '!' : kind === 'staged' ? '●' : kind === 'untracked' ? '?' : '●';
}

function statusStyle(kind, selected) {
  if (selected) return color('selection');
  if (kind === 'conflicted') return color('gitConflicted') || { fg: 'red', bold: true };
  if (kind === 'staged') return color('gitStaged') || { fg: 'green' };
  if (kind === 'untracked') return color('gitUntracked') || { dim: true };
  return color('gitUnstaged') || { fg: 'yellow' };
}

export function renderLocal(screen, y, h) {
  const W = screen.width;
  if (!appState.localIsRepo) {
    appState._localBounds = null;
    emptyState(screen, y, h, {
      icon: '⋄ LOCAL GIT',
      title: 'Not a git repository',
      message: 'Run inside a git checkout to see status, history, and diffs.',
      hint: '',
      keyHint: 'Press [0-6] to switch tabs   [?] Help',
    });
    return;
  }
  // One-shot first-paint kick: entering the tab must not sit empty until
  // the next poll tick. Guarded per root so polls/refreshes never loop.
  if (!appState.localLastFetched && _kickedRoot !== appState.localRoot) {
    _kickedRoot = appState.localRoot || '__none__';
    refreshLocal().catch(() => {});
  }
  if (appState.localStatusError && getStatusList().length === 0 && (appState.localHistory || []).length === 0) {
    appState._localBounds = null;
    emptyState(screen, y, h, {
      icon: '! LOCAL GIT',
      title: 'git failed',
      message: String(appState.localStatusError).slice(0, 80),
      hint: 'Install git or check the repo — [r] retries.',
      keyHint: '',
    });
    return;
  }

  let cy = y;
  const endY = y + h;
  // ── Header status card ──
  const branchLabel = '⑂ ' + (appState.localBranch || '?');
  screen.writeStr(2, cy, branchLabel, color('gitBranch') || color('accent') || { bold: true });
  let hx = 2 + branchLabel.length + 1;
  if (appState.localUpstream) {
    const up = '→ ' + appState.localUpstream;
    screen.writeStr(hx, cy, up, color('gitUpstream') || { dim: true });
    hx += up.length + 1;
  } else {
    screen.writeStr(hx, cy, '(no upstream)', { dim: true });
    hx += 14;
  }
  const ahead = appState.localAhead || 0;
  const behind = appState.localBehind || 0;
  if (ahead > 0 || behind > 0) {
    const pills = '↑' + ahead + ' ↓' + behind;
    screen.writeStr(hx, cy, pills, behind > 0 ? (color('gitBehind') || { fg: 'yellow' }) : (color('gitAhead') || { fg: 'green' }));
    hx += pills.length + 1;
  }
  if (appState.localRepo) {
    const rn = '· ' + appState.localRepo.owner + '/' + appState.localRepo.repo;
    screen.writeStr(hx, cy, truncateToWidth(rn, Math.max(0, W - hx - 24), ''), { dim: true });
  } else {
    screen.writeStr(hx, cy, '· local only', { dim: true });
  }
  const autoBadge = appState.localAutoPoll ? '● auto' : '○ manual';
  const ageBadge = 'Updated ' + ageLabel();
  const rightTxt = autoBadge + ' · ' + ageBadge;
  screen.writeStr(Math.max(2, W - rightTxt.length - 2), cy, rightTxt, { dim: true });
  cy++;
  screen.hline(cy, '─', { dim: true });
  cy++;

  // ── Op-state banner ──
  if (appState.localOpState) {
    const label = { merge: 'Merge in progress — resolve conflicts, then commit',
      rebase: 'Rebase in progress — resolve, then continue in a shell',
      'cherry-pick': 'Cherry-pick in progress — resolve, then commit',
      revert: 'Revert in progress — resolve, then commit' }[appState.localOpState] || 'Operation in progress';
    screen.writeStr(2, cy, '! ' + truncateToWidth(label, W - 6, ''), color('gitConflicted') || { fg: 'red', bold: true });
    cy++;
  }

  const isNarrow = W < 80;
  const focusStatus = appState.localFocus !== 'history';
  _rowMap = [];
  _regions = { colY0: cy, colY1: cy, splitX: -1, diffY0: -1, diffY1: -1 };
  if (isNarrow) {
    cy = renderStatusColumn(screen, 2, cy, endY, W, focusStatus, W - 4);
    if (cy < endY) cy = renderHistoryInner(screen, 2, cy, endY, W - 4, !focusStatus);
  } else {
    const splitX = Math.floor(W * 0.45);
    const leftW = splitX - 4;
    const rightX = splitX + 1;
    const rightW = W - rightX - 2;
    const leftEnd = renderStatusColumn(screen, 2, cy, endY, W, focusStatus, leftW);
    const rightEnd = renderHistoryInner(screen, rightX, cy, endY, rightW, !focusStatus);
    cy = Math.max(leftEnd, rightEnd);
    _regions.splitX = splitX;
  }
  _regions.colY1 = cy;
  if (appState.localDiff && cy < endY) {
    _regions.diffY0 = cy;
    cy = renderDiffBox(screen, cy, endY, W);
    _regions.diffY1 = cy;
  }
  // Hit geometry for the mouse layer (click/hover/wheel/dblclick).
  appState._localBounds = {
    focus: appState.localFocus,
    rows: _rowMap,
    colY0: _regions.colY0,
    colY1: _regions.colY1,
    splitX: _regions.splitX,
    diffY0: _regions.diffY0,
    diffY1: _regions.diffY1,
    statusCount: getStatusList().length,
    historyCount: (appState.localHistory || []).length,
    hasDiff: !!appState.localDiff,
  };
  if (_branchPicker) renderBranchPickerOverlay(screen);
}

function renderBranchPickerOverlay(screen) {
  const W = screen.width, H = screen.height;
  const boxW = Math.min(56, W - 4);
  const maxRows = Math.max(1, Math.min(_branches.length, H - 10));
  if (_branchCursor < _branchScroll) _branchScroll = _branchCursor;
  if (_branchCursor >= _branchScroll + maxRows) _branchScroll = _branchCursor - maxRows + 1;
  const boxH = Math.min(H - 2, maxRows + 5);
  const x = Math.floor((W - boxW) / 2);
  const y = Math.floor((H - boxH) / 2);
  for (let yy = y; yy < y + boxH; yy++) {
    for (let xx = x; xx < x + boxW; xx++) screen.setCell(xx, yy, ' ', null);
  }
  screen.box(x, y, boxW, boxH, 'Branches (' + _branches.length + ')', color('modalBorder'));
  const end = Math.min(_branches.length, _branchScroll + maxRows);
  for (let i = _branchScroll; i < end; i++) {
    const b = _branches[i];
    const row = y + 2 + (i - _branchScroll);
    if (row >= y + boxH - 2) break;
    const selected = i === _branchCursor;
    if (selected) {
      for (let xx = x + 1; xx < x + boxW - 1; xx++) {
        try { screen.styleBuf[row][xx] = color('selection'); } catch { break; }
      }
    }
    const marker = b.current ? '*' : ' ';
    const name = b.detached ? '(detached HEAD)' : b.name;
    screen.writeStr(x + 2, row, (selected ? '▶' : ' ') + marker + ' ' +
      truncateToWidth(name, boxW - 10, ''), selected ? color('selection')
      : b.remote ? { dim: true } : null);
    _rowMap.push({ y: row, kind: 'branch', index: i });
  }
  const footY = y + boxH - 2;
  if (footY > y + 2) {
    screen.writeStr(x + 2, footY, truncateToWidth('[Enter] checkout  [n] new  [d] delete  [Esc] close', boxW - 4, ''), { dim: true });
  }
}

// Render the CHANGES column at x — returns the next free row.
function renderStatusColumn(screen, x, y, endY, W, focused, colW) {
  let cy = y;
  const scroll = Math.max(0, appState.localStatusScroll || 0);
  let ri = 0; // running row index across sections (for scroll windowing)
  for (const sec of SECTION_META) {
    if (cy >= endY) break;
    const list = sec.list();
    const open = collapsibleHeader(screen, x, cy,
      sec.id, sec.title + ' (' + list.length + ')',
      focused && list.length > 0 ? '[a] stage' : null);
    cy++;
    if (!open) continue;
    if (list.length === 0) continue;
    const rows = getStatusList();
    for (const entry of list) {
      if (ri < scroll) { ri++; continue; }
      if (cy >= endY) break;
      const idx = rows.findIndex(r => r.section === sec.kind && r.path === entry.path);
      const selected = focused && idx === (appState.localStatusSelected || 0);
      if (selected) {
        for (let xx = x; xx < Math.min(W - 1, x + colW + 6); xx++) {
          try { screen.styleBuf[cy][xx] = color('selection'); } catch { break; }
        }
      }
      const icon = statusIcon(sec.kind);
      const code = entry.code && entry.code !== '??' ? entry.code + ' ' : '';
      screen.writeStr(x, cy, (selected ? '▶ ' : '  ') + icon + ' ' + code, statusStyle(sec.kind, selected));
      const nameX = x + 2 + icon.length + 1 + code.length;
      screen.writeStr(nameX, cy, truncateToWidth(entry.path, Math.max(4, x + colW - nameX + 2), ''),
        selected ? color('selection') : null);
      if (idx >= 0) _rowMap.push({ y: cy, kind: 'status', index: idx });
      cy++;
      ri++;
    }
  }
  if (cy < endY && getStatusList().length === 0 && !appState.localStatusError) {
    screen.writeStr(x, cy, 'Clean — nothing to commit ✓', { fg: 'green' });
    cy++;
  }
  if (cy < endY) {
    scrollIndicators(screen, y, Math.min(endY - 1, cy), appState.localStatusScroll || 0,
      getStatusList().length, Math.max(1, cy - y));
  }
  _statusVisible = Math.max(1, cy - y);
  return cy;
}

// Render the HISTORY column at rx — returns the next free row.
function renderHistoryInner(screen, rx, y, endY, rw, focused) {
  let cy = y;
  const history = appState.localHistory || [];
  const open = collapsibleHeader(screen, rx, cy, 'local:commits',
    'COMMITS' + (appState.localBranch ? ' · ' + appState.localBranch : '') + ' (' + history.length + ')',
    focused ? '[Enter] diff' : null);
  cy++;
  if (open) {
    if (history.length === 0) {
      if (cy < endY) { screen.writeStr(rx, cy, 'No commits yet', { dim: true }); cy++; }
    } else {
      const rows = Math.max(0, endY - cy - (appState.localDiff ? 0 : 1));
      const start = Math.min(appState.localHistoryScroll || 0, Math.max(0, history.length - 1));
      const visible = history.slice(start, start + Math.max(1, rows));
      for (let i = 0; i < visible.length && cy < endY; i++) {
        const c = visible[i];
        const absIdx = start + i;
        const selected = focused && absIdx === (appState.localHistorySelected || 0);
        if (selected) {
          for (let xx = rx; xx < Math.min(screen.width - 1, rx + rw + 2); xx++) {
            try { screen.styleBuf[cy][xx] = color('selection'); } catch { break; }
          }
        }
        const sha = String(c.sha || '').slice(0, 8);
        const when = c.date ? (relTime(c.date) || '') : '';
        const left = (selected ? '▶ ' : '  ') + '* ' + sha + ' ';
        screen.writeStr(rx, cy, left, selected ? color('selection') : (color('accent') || null));
        const subjW = Math.max(8, rw - left.length - (when ? when.length + 1 : 0));
        screen.writeStr(rx + left.length, cy, truncateToWidth(c.subject || '', subjW, ''),
          selected ? color('selection') : null);
        if (when) screen.writeStr(Math.max(rx, rx + rw - when.length), cy, when,
          selected ? color('selection') : { dim: true });
        _rowMap.push({ y: cy, kind: 'history', index: absIdx });
        cy++;
      }
      if (appState.localHistoryHasMore && cy < endY) {
        screen.writeStr(rx, cy, '[Space] more commits…', { dim: true });
        cy++;
      }
      if (cy < endY) {
        scrollIndicators(screen, y + 1, Math.min(endY - 1, cy), start, history.length, Math.max(1, visible.length));
      }
      _historyVisible = Math.max(1, visible.length);
    }
  }
  return cy;
}

function renderDiffBox(screen, y, endY, W) {
  let cy = y;
  const d = appState.localDiff;
  if (!d) return cy;
  if (cy < endY) {
    screen.writeStr(2, cy, 'DIFF · ' + truncateToWidth(d.path || '', Math.max(10, W - 12), ''),
      color('title') || { bold: true });
    cy++;
  }
  if (cy < endY) { screen.hline(cy, '─', { dim: true }); cy++; }
  const lines = String(d.text || '').split(/\r?\n/);
  _diffScroll = Math.max(0, Math.min(_diffScroll, Math.max(0, lines.length - 1)));
  for (let i = _diffScroll; i < lines.length && cy < endY; i++) {
    const ln = lines[i];
    let style = null;
    if (ln.startsWith('+') && !ln.startsWith('+++')) style = color('gitDiffAdd') || { fg: 'green' };
    else if (ln.startsWith('-') && !ln.startsWith('---')) style = color('gitDiffDel') || { fg: 'red' };
    else if (ln.startsWith('@@')) style = color('gitDiffHunk') || { dim: true };
    screen.writeStr(2, cy, truncateToWidth(ln, Math.max(10, W - 4), ''), style);
    cy++;
  }
  if (cy < endY) {
    screen.writeStr(2, cy, '[Enter] close   [↑↓] scroll', { dim: true });
    cy++;
  }
  return cy;
}
