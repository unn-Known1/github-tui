#!/usr/bin/env node
// GitHub TUI — entrypoint.
// All real logic lives in tui/*.mjs. This file just wires lifecycle events.

// IMPORTANT: do NOT import `render` from state.mjs — render.mjs also exports
// `render` (the actual screen-painter). Importing both with the same local
// name triggers a SyntaxError. `render` is already imported from render.mjs
// at line ~11.
import {
  appState, tabState, TABS, showMessage,
  loadCollapsed, loadSession, registerShutdownCallback, runShutdownCallbacks,
  invalidateAccountAsync, shutdownSessionTimer, shutdownConfirmPoller,
} from './tui/state.mjs';
import { enableMouse, disableMouse } from './tui/mouse.mjs';
import { requestTerminalSize } from './tui/screen.mjs';
import { enableBracketedPaste, disableBracketedPaste } from './tui/input.mjs';
import { loadToken } from './tui/config.mjs';
import { loadTheme, setAccessible } from './tui/theme.mjs';
import { shutdownToasts } from './tui/toast.mjs';
import { shutdownWhichKey } from './tui/which-key.mjs';
import { initScreen, render } from './tui/render.mjs';
import { handleKey, registerCoreActions } from './tui/keys.mjs';
import { loadUserData } from './tui/tabs/repos.mjs';
import { loadBookmarks, loadSavedSearches, loadPins, loadInboxFilters, loadRepoPrefs, saveRepoPrefs } from './tui/store.mjs';
import { getRateLimit, resyncRateLimit, resetRateLimit, getUserRepositories, getNotifications, getWorkflowRuns, shutdownGithubCache } from './tui/github.mjs';
import { exportPortableConfig, importPortableConfig } from './tui/portability.mjs';

import { readFileSync, appendFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

let rateLimitInterval = null;
let autoRefreshInterval = null;

// ── Structured debug logger — writes to $GITHUB_TUI_HOME/debug.log ──
const DEBUG = !!process.env.DEBUG || !!process.env.GITHUB_TUI_DEBUG;
const MAX_DEBUG_BYTES = 2 * 1024 * 1024;
function _debugLogPath() {
  return join(process.env.GITHUB_TUI_HOME || join(homedir(), '.github-tui'), 'debug.log');
}
function _rotateDebugLog(path) {
  try {
    let size = 0;
    try { size = statSync(path).size; } catch { return; }
    if (size < MAX_DEBUG_BYTES) return;
    const raw = readFileSync(path, 'utf8');
    const half = raw.slice(Math.floor(raw.length / 2));
    const nl = half.indexOf('\n');
    writeFileSync(path, nl >= 0 ? half.slice(nl + 1) : half);
  } catch {}
}
function debug(...args) {
  if (!DEBUG) return;
  // Use async append to avoid blocking the event loop in debug mode.
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  try {
    // Ensure the config dir exists (fresh machine / CI) — a logging failure
    // must never propagate out of a crash handler.
    const p = _debugLogPath();
    mkdirSync(dirname(p), { recursive: true });
    _rotateDebugLog(p);
    appendFileSync(p, line); // kept sync for crash handlers (safe — debug only)
  } catch {}
}
function crashLog(...args) {
  // Always written, even when DEBUG is off — default crashes were traceless.
  const line = `[${new Date().toISOString()}] [CRASH] ${args.join(' ')}\n`;
  try {
    const p = _debugLogPath();
    mkdirSync(dirname(p), { recursive: true });
    _rotateDebugLog(p);
    appendFileSync(p, line);
  } catch {}
}
// Non-blocking debug for hot paths — fire-and-forget writeStream.
function debugAsync(...args) {
  if (!DEBUG) return;
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  const p = _debugLogPath();
  import('fs').then(({ appendFile, mkdir }) => mkdir(dirname(p), { recursive: true }, () => appendFile(p, line, () => {}))).catch(() => {});
}

// ── Terminal environment detection ──
const TERM_ENV = process.env.TERM || '';
const TERM_IS_TMUX = !!process.env.TMUX;
const TERM_IS_SSH = !!(process.env.SSH_CLIENT || process.env.SSH_TTY);
const TERM_IS_SCREEN = !!process.env.STY;
// WSL detection previously used WSLENV, which git-bash on native
// Windows can also set. Use WSL_DISTRO_NAME (only set inside actual WSL).
const TERM_IS_WSL = !!process.env.WSL_DISTRO_NAME || /microsoft/i.test(process.env.WSL_INTEROP || '');

// TABS / showMessage / render / registerShutdownCallback are imported at the
// top alongside appState. (Consolidated to a single state.mjs import.)

function startAutoRefresh() {
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  if (!appState.autoRefreshEnabled) return;
  autoRefreshInterval = setInterval(async () => {
    if (!appState.token || appState.loading) return;
    const t = tabState.current;
    // dispatch via TABS[t].refresh instead of `if (t === N) …`.
    // Adding a new tab in state.mjs with `refresh:` is automatically picked up.
    const fn = TABS[t] && TABS[t].refresh;
    if (!fn) return;
    try {
      await fn();
    } catch (e) { debugAsync('auto-refresh error:', e.message); }
  }, Math.max(1000, appState.autoRefreshIntervalMs || 300000));
}

// Export for settings to restart after interval change.
globalThis._startAutoRefresh = startAutoRefresh;

// Poll the core budget every 60s as a backstop (per-request headers in
// github.mjs keep the counter live between polls).
let _ratePollEpoch = 0;
export function bumpRatePollEpoch() { _ratePollEpoch++; }
async function refreshRateLimit() {
  if (!appState.token) return;
  // Epoch guard: a slow poll started before logout/login must never resync
  // the NEW account's mirror with the OLD account's /rate_limit body.
  const tokenAtStart = appState.token;
  const epochAtStart = _ratePollEpoch;
  const ctl = new AbortController();
  const timeout = setTimeout(() => { try { ctl.abort(); } catch {} }, 15000);
  if (timeout.unref) timeout.unref();
  try {
    const { getAccountEpoch } = await import('./tui/state.mjs');
    const acctAtStart = getAccountEpoch();
    const data = await getRateLimit(tokenAtStart, ctl.signal);
    clearTimeout(timeout);
    // Drop late results from a previous account session.
    if (appState.token !== tokenAtStart) return;
    if (epochAtStart !== _ratePollEpoch) return;
    try {
      const { getAccountEpoch: getEpochNow } = await import('./tui/state.mjs');
      if (getEpochNow() !== acctAtStart) return;
    } catch {}
    const core = data?.resources?.core || data?.rate || null;
    // Window-guarded resync: corrects drift inside the current window, in
    // both directions. A poll from a different window than the live header
    // mirror is ignored (live headers own cross-window movement).
    // Per-request headers between polls stay monotonic (see updateRateLimit()).
    if (core) {
      resyncRateLimit(core.limit, core.remaining, core.reset);
      render();
    }
  } catch (e) {
    try { clearTimeout(timeout); } catch {}
    if (e && /aborted|abandoned/i.test(e.message || '')) return;
    // An expired/revoked token surfaces here first when the user is idle
    // (no repo open). Mirror the repos/explore 401 flow: wipe auth state
    // and counter so the header doesn't keep showing a stale budget.
    if (e && (e.status === 401 || /401|Bad credentials|Unauthorized/i.test(e.message || ''))) {
      // Ignore if the account already changed under us.
      if (appState.token !== tokenAtStart || epochAtStart !== _ratePollEpoch) return;
      try {
        const { resetAccountState, showMessage, getAccountEpoch } = await import('./tui/state.mjs');
        const { removeToken } = await import('./tui/config.mjs');
        const { clearAccountCache } = await import('./tui/github.mjs');
        try { clearAccountCache(tokenAtStart); } catch {}
        resetAccountState();
        bumpRatePollEpoch();
        try { void getAccountEpoch; } catch {}
        resetRateLimit();
        removeToken();
        showMessage('Token expired or invalid — please log in again in Settings', 'error', 8000);
        render();
      } catch {}
    } else {
      debugAsync('rate-limit refresh error:', e.message);
    }
  }
}

async function runCliCommand(args) {
  const command = args[0];
  if (!['repos', 'inbox', 'actions', 'export', 'import'].includes(command)) return false;
  const json = args.includes('--json');
  if (command === 'export') {
    const formatIndex = args.indexOf('--format');
    const format = formatIndex >= 0 ? String(args[formatIndex + 1] || 'json').toLowerCase() : 'json';
    const pathArg = args.find((arg, index) => index > 0 && !arg.startsWith('-') && args[index - 1] !== '--format');
    const path = pathArg || (format === 'markdown' ? 'github-tui-config.md' : 'github-tui-config.json');
    if (format === 'markdown') {
      const bundle = (await import('./tui/portability.mjs')).buildPortableConfig();
      const lines = ['# GitHub TUI configuration', '', '- Schema: ' + bundle.schemaVersion, '- App version: ' + bundle.appVersion, '- Exported: ' + bundle.exportedAt, '', '## Counts', '', '- Bookmarks: ' + (bundle.bookmarks?.length ?? 0), '- Saved searches: ' + (bundle.savedSearches?.length ?? 0), '- Pins: ' + (bundle.pins?.length ?? 0), '- Custom sections: ' + (bundle.sections?.length ?? 0), '',
        '> Note: markdown export is human-readable only and cannot be re-imported.',
        '> Use `--format json` (default) for a portable bundle that `github-tui import` accepts.', '',
        '## Full bundle (JSON)', '', '```json', JSON.stringify(bundle, null, 2), '```', ''];
      writeFileSync(path, lines.join('\n'));
      console.log(path);
    } else console.log(exportPortableConfig(path));
    return true;
  }
  if (command === 'import') {
    const path = args[1] && !args[1].startsWith('-') ? args[1] : args.find(a => !a.startsWith('-') && a !== 'import');
    if (!path) throw new Error('Usage: github-tui import <config.json> [--replace|--no-merge]');
    // Replace mode was previously unreachable from the CLI (merge always true).
    const merge = !(args.includes('--replace') || args.includes('--no-merge') || args.includes('--merge=false'));
    importPortableConfig(path, { merge });
    console.log('Imported configuration from ' + path + (merge ? ' (merged)' : ' (replaced)'));
    return true;
  }
  const token = loadToken();
  if (!token) throw new Error('Not authenticated. Log in from Settings first.');
  let rows = [];
  let truncatedNote = '';
  if (command === 'repos') {
    // Paginate (up to 5×100) instead of silently truncating past 100.
    rows = [];
    for (let page = 1; page <= 5; page++) {
      const batch = await getUserRepositories(token, page, 100);
      if (!Array.isArray(batch) || batch.length === 0) break;
      rows.push(...batch);
      if (batch.length < 100) break;
    }
    if (rows.length >= 500) truncatedNote = '(truncated at 500 — use the TUI for full pagination)';
  } else if (command === 'inbox') {
    // --unread filters client-side, so page until we have enough unread or
    // run out (up to 5×100) instead of hiding unread beyond the first 100.
    const wantUnread = args.includes('--unread');
    const acc = [];
    for (let page = 1; page <= 5; page++) {
      const batch = await getNotifications(token, page, 100);
      if (!Array.isArray(batch) || batch.length === 0) break;
      acc.push(...batch);
      if (wantUnread) {
        const unreadSoFar = acc.filter(n => n.unread);
        if (unreadSoFar.length >= 100 || batch.length < 100) { rows = unreadSoFar; break; }
        continue;
      }
      rows = acc;
      if (batch.length < 100) break;
    }
    if (wantUnread && (!rows || rows.length === 0)) rows = acc.filter(n => n.unread);
    if (acc.length >= 500) truncatedNote = '(scanned first 500 — use the TUI for full pagination)';
  } else if (command === 'actions') {
    // Scan up to 50 repos (paginated) instead of first 20; per-repo failures
    // are counted and reported instead of silently treated as clean.
    const allRepos = [];
    for (let page = 1; page <= 3; page++) {
      const batch = await getUserRepositories(token, page, 30);
      if (!Array.isArray(batch) || batch.length === 0) break;
      allRepos.push(...batch);
      if (batch.length < 30 || allRepos.length >= 50) break;
    }
    const repos = allRepos.slice(0, 50);
    const groups = [];
    let failedRepos = 0;
    for (const repo of repos) {
      const [owner, name] = String(repo.full_name || '').split('/');
      if (!owner || !name) continue;
      try {
        const result = await getWorkflowRuns(token, owner, name, 1, 10);
        const runs = result?.workflow_runs || [];
        groups.push(...runs.filter(r => !args.includes('--failed') || ['failure', 'timed_out', 'startup_failure', 'action_required'].includes(r.conclusion))
          .map(r => ({ ...r, repository: repo.full_name })));
      } catch { failedRepos++; }
    }
    rows = groups;
    if (failedRepos > 0) truncatedNote = '(' + failedRepos + ' repos failed to scan — partial results)';
    else if (allRepos.length >= 50) truncatedNote = '(scanned first 50 repos)';
  }
  if (truncatedNote && !json) console.error(truncatedNote);
  if (json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  } else if (command === 'repos') {
    for (const r of rows) console.log((r.full_name || '?') + '\t★' + (r.stargazers_count || 0) + '\t' + (r.language || ''));
  } else if (command === 'inbox') {
    for (const n of rows) console.log((n.unread ? '*' : ' ') + '\t' + (n.repository?.full_name || '?') + '\t' + (n.subject?.title || ''));
  } else {
    for (const r of rows) console.log('✗\t' + (r.repository || '?') + '\t' + (r.name || '?') + '\t#' + (r.run_number || r.id || '?'));
  }
  return true;
}

async function main() {
  if (process.argv.includes('--version') || process.argv.includes('-v')) {
    console.log('github-tui ' + pkg.version);
    process.exit(0);
  }
  // --accessible flag — turn on a11y mode for screen readers / high-
  // contrast safe rendering. Color is disabled, unicode glyphs replaced
  // with bracketed ASCII labels.
  if (process.argv.includes('--accessible') || process.argv.includes('--a11y') || process.argv.includes('--accessible=linear')) {
    appState.accessible = true;
    setAccessible(true);
    appState.linearAccessibility = process.argv.includes('--accessible=linear');
  }
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('github-tui ' + pkg.version);
    console.log('A fast, zero-dependency terminal user interface for GitHub.');
    console.log('');
    console.log('Usage: github-tui');
    console.log('');
    console.log('Options:');
    console.log('  -h, --help       Show this help message');
    console.log('  -v, --version    Show version number');
    console.log('      --accessible Enable screen-reader friendly mode (text-only glyphs, no color)');
    console.log('      --accessible=linear  Use a linear screen-reader layout');
    console.log('      --no-mouse  Disable terminal mouse capture for screen readers and copy-mode');
    console.log('');
    console.log('Environment:');
    console.log('  GITHUB_TUI_ROWS / GITHUB_TUI_COLS');
    console.log('      Override the detected terminal size (when the pty reports a wrong size,');
    console.log('      e.g. footer cut off: set ROWS to the rows you actually see).');
    process.exit(0);
  }

  const cliHandled = await runCliCommand(process.argv.slice(2));
  if (cliHandled) return;

  if (!process.stdin.isTTY) {
    console.log('GitHub TUI requires an interactive terminal.');
    console.log('Usage: node app.mjs');
    process.exit(1);
  }

  // register shutdown-side message-timer cleanup so shutdown()
  // doesn't call an undefined global. Node timers are objects, not numbers —
  // check truthiness (the old typeof === 'number' check never fired).
  registerShutdownCallback(() => {
    try {
      if (appState.messageTimer) {
        clearTimeout(appState.messageTimer);
        appState.messageTimer = null;
      }
    } catch {}
  });
  // Async registrations (ESM-safe, no require in ESM scope).
  registerShutdownCallback(() => { try { shutdownToasts(); } catch {} });
  registerShutdownCallback(() => { try { shutdownWhichKey(); } catch {} });
  registerShutdownCallback(() => {
    try { shutdownGithubCache(); } catch {}
    try { invalidateAccountAsync(); } catch {}
  });
  registerShutdownCallback(() => { try { shutdownSessionTimer(); } catch {} });
  registerShutdownCallback(() => { try { shutdownConfirmPoller(); } catch {} });

  process.stdout.write('\x1b[?25l');
  if (!process.argv.includes('--no-mouse')) enableMouse();
  enableBracketedPaste();

  // Load persisted state.
  loadTheme();
  appState.token = loadToken();
  appState.bookmarks = loadBookmarks();
  appState.savedSearches = loadSavedSearches();
  appState.repoPins = loadPins();
  appState.inboxSavedFilters = loadInboxFilters();
  loadCollapsed();
  loadSession();
  try {
    const { resetFocus } = await import('./tui/focus.mjs');
    resetFocus(tabState.current);
  } catch {}

  const repoPrefs = loadRepoPrefs();
  if (repoPrefs.repoSort) appState.repoSort = repoPrefs.repoSort;
  if (repoPrefs.repoTypeFilter) appState.repoTypeFilter = repoPrefs.repoTypeFilter;
  if (repoPrefs.reposLangFilter) appState.reposLangFilter = repoPrefs.reposLangFilter;
  if (repoPrefs.repoStaleOnly != null) appState.repoStaleOnly = repoPrefs.repoStaleOnly;
  if (repoPrefs.repoDensity) appState.repoDensity = repoPrefs.repoDensity;

  const screen = initScreen();
  registerCoreActions();

  // Wire stdin → key router.
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', handleKey);
// Graceful shutdown on stdin close (SSH drop, tmux detach).
process.stdin.on('error', (err) => {
  debug('stdin error:', err.message);
  shutdown();
  // also exit so process doesn't linger after stdin closes
  // (SIGINT/SIGTERM handlers are not invoked on stdin close).
  setImmediate(() => process.exit(0));
});
process.stdin.on('end', () => {
  debug('stdin closed');
  shutdown();
  setImmediate(() => process.exit(0));
});

  // Resize listener — debounced to avoid render thrashing.
// wrap the callback in try/catch + always null the timer ref so a
// throw inside updateSize() doesn't leave a stale timer reference that
// blocks future resizes.
  let resizeTimer = null;
  process.stdout.on('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      try {
        screen.updateSize();
        // The pty size can be stale (nested multiplexers, lost SIGWINCH);
        // ask the terminal itself too — its reply corrects us via handleKey.
        requestTerminalSize();
        render();
      } catch (e) {
        debug('resize handler threw:', e && e.message);
      }
    }, 50);
  });
  screen.updateSize();

  // Save repo prefs on exit.
  function saveCurrentRepoPrefs() {
    saveRepoPrefs({
      repoSort: appState.repoSort,
      repoTypeFilter: appState.repoTypeFilter,
      reposLangFilter: appState.reposLangFilter,
      repoStaleOnly: appState.repoStaleOnly,
      repoDensity: appState.repoDensity,
    });
  }

// ── Atomic shutdown — single function, no double-calls ──
let _shuttingDown = false;function shutdown() {
  if (_shuttingDown) return;
  _shuttingDown = true;
  // each cleanup step wrapped in try/catch so one failure doesn't
  // strand other cleanup (multiple modules register their own exit hooks).
  try { if (rateLimitInterval) { clearInterval(rateLimitInterval); rateLimitInterval = null; } } catch (e) { debug('shutdown rate-limit interval clear failed:', e.message); }
  try { if (autoRefreshInterval) { clearInterval(autoRefreshInterval); autoRefreshInterval = null; } } catch (e) { debug('shutdown auto-refresh interval clear failed:', e.message); }
  try { saveCurrentRepoPrefs(); } catch (e) { debug('shutdown saveRepoPrefs failed:', e.message); }
  // Abort in-flight account requests so sockets don't linger past exit.
  try { invalidateAccountAsync(); bumpRatePollEpoch(); } catch {}
  try { shutdownGithubCache(); } catch {}
  try { shutdownToasts(); } catch {}
  try { shutdownWhichKey(); } catch {}
  try { shutdownSessionTimer(); } catch {}
  try { shutdownConfirmPoller(); } catch {}
  // Run callbacks registered by state and other modules.
  runShutdownCallbacks();
  try { process.stdin.setRawMode(false); } catch {}
  try {  if (!process.argv.includes('--no-mouse')) disableMouse(); } catch (e) { debug('disableMouse failed:', e.message); }
  try { disableBracketedPaste(); } catch (e) { debug('disableBracketedPaste failed:', e.message); }
  try { process.stdout.write('\x1b[?25h\x1b[2J\x1b[H'); } catch {}
}
process.on('exit', shutdown);
process.on('SIGINT',  () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });
process.on('SIGHUP',  () => { shutdown(); process.exit(0); });
// handle Windows Ctrl+Break (SIGBREAK) the same way as SIGINT.
if (process.platform === 'win32') {
  process.on('SIGBREAK', () => { shutdown(); process.exit(0); });
}

  // Load onboarding helpers before either startup branch so the upgrade
  // welcome check works for authenticated and logged-out users alike.
  const onboarding = await import('./tui/tabs/onboarding.mjs');

  // Detect local git worktree OUTSIDE the auth gate: the Local tab works
  // offline and logged-out. GitHub-remote mapping (localRepo) stays
  // optional — local-only / GitLab / Bitbucket checkouts are first-class.
  try {
    const { detectLocalRepo, getLocalGitMeta } = await import('./tui/git-context.mjs');
    const meta = getLocalGitMeta();
    if (meta && meta.isRepo) {
      appState.localIsRepo = true;
      appState.localRoot = meta.root || '';
      appState.localGitDir = meta.gitDir || '';
      appState.localBranch = meta.branch || '';
      appState.localUpstream = meta.upstream || null;
    }
    const local = detectLocalRepo();
    if (local) {
      // Detect context for the optional Dashboard local-repo filter, but
      // keep account-wide totals as the default view. Users can press [l]
      // when they explicitly want to scope Dashboard data to this repo.
      appState.localRepo = local;
      appState.localRepoFilter = false;
    }
  } catch {}
  // Start the Local tab poller (it no-ops when not in a repo or disabled).
  // Shutdown cleanup rides the state callback registry (already imported).
  try {
    const { ensureLocalPoll, stopLocalPoll, refreshLocal } = await import('./tui/tabs/local.mjs');
    ensureLocalPoll();
    registerShutdownCallback(stopLocalPoll);
    // Seed ahead/behind/opState on boot: the hoist above only sets
    // root/branch/upstream — without a first refresh the header shows stale
    // zeros until the user visits the tab. Fire-and-forget quiet refresh.
    try { if (appState.localIsRepo) refreshLocal().catch(() => {}); } catch {}
  } catch {}

  if (appState.token) {
    await loadUserData();
    refreshRateLimit();

    rateLimitInterval = setInterval(refreshRateLimit, 60000);

    // Auto-refresh: silently refetch data at a configurable interval.
    startAutoRefresh();
  } else {
    // First-time users get a friendly welcome overlay.
    if (onboarding.isFirstRun()) {
      onboarding.startOnboarding();
    }
  }

  // Show release notes for returning users as well as first-time users.
  // This must run after session restoration and outside the no-token branch;
  // authenticated users are the primary upgrade path.
  if (!appState.showOnboarding && onboarding.shouldAutoLaunchWelcome()) {
    onboarding.startWelcome();
  }
  render();
  // One-shot live size probe: if the pty dimensions are stale the terminal's
  // own answer corrects the grid (and the footer) within milliseconds.
  // Terminals that don't answer XTWINOPS change nothing.
  requestTerminalSize();
}

// on startup crash, also disable mouse + paste mode and clear
// pending toast timer so the terminal isn't left in a weird state.
main().catch(err => {
  debug('Fatal:', err.message, err.stack);
  crashLog('Fatal:', err.message, err.stack);
  // Delegate to shutdown() so timers are cleared, mouse/paste modes are
  // disabled, and prefs are persisted — same cleanup as a normal exit.
  try { shutdown(); } catch {}
  try {
    process.stdout.write('\x1b[?25h');
    process.stdout.write('\x1b[2J\x1b[H');
    console.error('Fatal error:', err.message);
    console.error(err.stack);
  } catch {}
  process.exit(1);
});

// ── Catch async errors that escape main() ──
process.on('unhandledRejection', (reason) => {
  debug('Unhandled rejection:', String(reason));
  crashLog('Unhandled rejection:', String(reason && reason.stack || reason));
});
process.on('uncaughtException', (err) => {
  debug('Uncaught exception:', err.message, err.stack);
  crashLog('Uncaught exception:', err.message, err.stack);
  // Restore the terminal via shutdown() — otherwise raw mode, mouse capture
  // and bracketed paste are left on and the shell is unusable.
  try { shutdown(); } catch {}
  try {
    process.stdout.write('\x1b[?25h');
    try { disableMouse(); } catch {}
    try { disableBracketedPaste(); } catch {}
    try { process.stdin.setRawMode(false); } catch {}
    process.stdout.write('\x1b[2J\x1b[H');
    console.error('Uncaught exception:', err.message);
  } catch {}
  process.exit(1);
});
