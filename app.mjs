#!/usr/bin/env node
// GitHub TUI — entrypoint.
// All real logic lives in tui/*.mjs. This file just wires lifecycle events.

// IMPORTANT: do NOT import `render` from state.mjs — render.mjs also exports
// `render` (the actual screen-painter). Importing both with the same local
// name triggers a SyntaxError. `render` is already imported from render.mjs
// at line ~11.
import {
  appState, tabState, TABS, showMessage,
  loadCollapsed, loadSession, registerShutdownCallback,
} from './tui/state.mjs';
import { enableMouse, disableMouse } from './tui/mouse.mjs';
import { checkLoadingWatchdog } from './tui/state.mjs';
import { enableBracketedPaste, disableBracketedPaste } from './tui/input.mjs';
import { loadToken } from './tui/config.mjs';
import { loadTheme } from './tui/theme.mjs';
import { initScreen, getScreen, render } from './tui/render.mjs';
import { handleKey, registerCoreActions } from './tui/keys.mjs';
import { registerInputHandler } from './tui/input.mjs';
import { loadUserData } from './tui/tabs/repos.mjs';
import { loadBookmarks, loadSavedSearches, loadPins, loadRepoPrefs, saveRepoPrefs } from './tui/store.mjs';
import { getRateLimit, lastRateLimit } from './tui/github.mjs';

import { readFileSync, appendFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

let rateLimitInterval = null;
let autoRefreshInterval = null;

// ── Structured debug logger — writes to ~/.github-tui/debug.log ──
const DEBUG = !!process.env.DEBUG || !!process.env.GITHUB_TUI_DEBUG;
const _debugLogPath = join(homedir(), '.github-tui', 'debug.log');
function debug(...args) {
  if (!DEBUG) return;
  // Use async append to avoid blocking the event loop in debug mode.
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  appendFileSync(_debugLogPath, line); // kept sync for crash handlers (safe — debug only)
}
// Non-blocking debug for hot paths — fire-and-forget writeStream.
function debugAsync(...args) {
  if (!DEBUG) return;
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  import('fs').then(({ appendFile }) => appendFile(_debugLogPath, line, () => {})).catch(() => {});
}

// ── Terminal environment detection ──
const TERM_ENV = process.env.TERM || '';
const TERM_IS_TMUX = !!process.env.TMUX;
const TERM_IS_SSH = !!(process.env.SSH_CLIENT || process.env.SSH_TTY);
const TERM_IS_SCREEN = !!process.env.STY;
// F011 fix: WSL detection previously used WSLENV, which git-bash on native
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
    // F001 fix: dispatch via TABS[t].refresh instead of `if (t === N) …`.
    // Adding a new tab in state.mjs with `refresh:` is automatically picked up.
    const fn = TABS[t] && TABS[t].refresh;
    if (!fn) return;
    try {
      await fn();
    } catch (e) { debugAsync('auto-refresh error:', e.message); }
  }, appState.autoRefreshIntervalMs);
}

// Export for settings to restart after interval change.
globalThis._startAutoRefresh = startAutoRefresh;

// F012 fix: import lastRateLimit once at module load instead of doing a
// dynamic import on every 60s poll.
async function refreshRateLimit() {
  if (!appState.token) return;
  try {
    const data = await getRateLimit(appState.token);
    if (data && data.resources && data.resources.core) {
      const core = data.resources.core;
      lastRateLimit.remaining = core.remaining;
      lastRateLimit.limit = core.limit;
      lastRateLimit.reset = core.reset;
      render();
    }
  } catch (e) { debugAsync('rate-limit refresh error:', e.message); }
}

async function main() {
  // CLI flags.
  if (process.argv.includes('--version') || process.argv.includes('-v')) {
    console.log('github-tui ' + pkg.version);
    process.exit(0);
  }
  // P0-2: --accessible flag — turn on a11y mode for screen readers / high-
  // contrast safe rendering. Color is disabled, unicode glyphs replaced
  // with bracketed ASCII labels.
  if (process.argv.includes('--accessible') || process.argv.includes('--a11y')) {
    appState.accessible = true;
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
    process.exit(0);
  }

  if (!process.stdin.isTTY) {
    console.log('GitHub TUI requires an interactive terminal.');
    console.log('Usage: node app.mjs');
    process.exit(1);
  }

  // L001/L005: register shutdown-side message-timer cleanup so shutdown()
  // doesn't call an undefined global. Also register uncaughtException path.
  registerShutdownCallback(() => {
    if (typeof appState.messageTimer === 'number') {
      clearTimeout(appState.messageTimer);
      appState.messageTimer = null;
    }
  });

  // Hide cursor; enable mouse; enable bracketed paste.
  process.stdout.write('\x1b[?25l');
  enableMouse();
  enableBracketedPaste();

  // F009: wire the issue-create input modal contexts. Without this, pressing
  // Enter on the title/body modal does nothing.
  const issueCreate = await import('./tui/tabs/issue-create.mjs');
  registerInputHandler('create-issue-title', (s) => issueCreate.submitTitle(s));
  registerInputHandler('create-issue-body',  (s) => issueCreate.submitBody(s));

  // Load persisted state.
  loadTheme();
  appState.token = loadToken();
  appState.bookmarks = loadBookmarks();
  appState.savedSearches = loadSavedSearches();
  appState.repoPins = loadPins();
  loadCollapsed();
  loadSession();

  // Restore repo preferences.
  const repoPrefs = loadRepoPrefs();
  if (repoPrefs.repoSort) appState.repoSort = repoPrefs.repoSort;
  if (repoPrefs.repoTypeFilter) appState.repoTypeFilter = repoPrefs.repoTypeFilter;
  if (repoPrefs.reposLangFilter) appState.reposLangFilter = repoPrefs.reposLangFilter;
  if (repoPrefs.repoStaleOnly != null) appState.repoStaleOnly = repoPrefs.repoStaleOnly;
  if (repoPrefs.repoDensity) appState.repoDensity = repoPrefs.repoDensity;

  // Initialize screen + register palette actions.
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
  // F-LIFECYCLE: also exit so process doesn't linger after stdin closes
  // (SIGINT/SIGTERM handlers are not invoked on stdin close).
  setImmediate(() => process.exit(0));
});
process.stdin.on('end', () => {
  debug('stdin closed');
  shutdown();
  setImmediate(() => process.exit(0));
});

  // Resize listener — debounced to avoid render thrashing.
// L003 fix: wrap the callback in try/catch + always null the timer ref so a
// throw inside updateSize() doesn't leave a stale timer reference that
// blocks future resizes.
  let resizeTimer = null;
  process.stdout.on('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      try {
        screen.updateSize();
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
let _shuttingDown = false;
// Registered shutdown callbacks (state.mjs attaches the message-timer clear).
const _shutdownCallbacks = [];
function shutdown() {
  if (_shuttingDown) return;
  _shuttingDown = true;
  // L001: each cleanup step wrapped in try/catch so one failure doesn't
  // strand other cleanup (multiple modules register their own exit hooks).
  try { if (rateLimitInterval) clearInterval(rateLimitInterval); } catch (e) { debug('shutdown rate-limit interval clear failed:', e.message); }
  try { if (autoRefreshInterval) clearInterval(autoRefreshInterval); } catch (e) { debug('shutdown auto-refresh interval clear failed:', e.message); }
  try { saveCurrentRepoPrefs(); } catch (e) { debug('shutdown saveRepoPrefs failed:', e.message); }
  // L001/L002: run registered shutdown callbacks (clears pending toast timer,
  // any other cleanup registered later). No reliance on an undefined global.
  for (const cb of _shutdownCallbacks) {
    try { cb(); } catch (e) { debug('shutdown callback failed:', e.message); }
  }
  try { process.stdin.setRawMode(false); } catch {}
  try { disableMouse(); } catch (e) { debug('disableMouse failed:', e.message); }
  try { disableBracketedPaste(); } catch (e) { debug('disableBracketedPaste failed:', e.message); }
  try { process.stdout.write('\x1b[?25h\x1b[2J\x1b[H'); } catch {}
}
process.on('exit', shutdown);
process.on('SIGINT',  () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });
process.on('SIGHUP',  () => { shutdown(); process.exit(0); });
// L004 fix: handle Windows Ctrl+Break (SIGBREAK) the same way as SIGINT.
if (process.platform === 'win32') {
  process.on('SIGBREAK', () => { shutdown(); process.exit(0); });
}

  // Auto-load if we already have a saved token.
  if (appState.token) {
    await loadUserData();
    refreshRateLimit();

    // Detect local git repo context for smart filtering.
    try {
      const { detectLocalRepo } = await import('./tui/git-context.mjs');
      const local = detectLocalRepo();
      if (local) {
        appState.localRepo = local;
        appState.localRepoFilter = true;
      }
    } catch {}

    // Refresh rate limit every 60 seconds.
    rateLimitInterval = setInterval(refreshRateLimit, 60000);

    // Auto-refresh: silently refetch data at a configurable interval.
    startAutoRefresh();
  } else {
    // First-time users get a friendly welcome overlay.
    const onboarding = await import('./tui/tabs/onboarding.mjs');
    if (onboarding.isFirstRun()) {
      onboarding.startOnboarding();
    }
    // P0-1: auto-launch "what's new" overlay on version upgrade. Reuses the
    // dynamic-imported `onboarding` handle above (the second `import` would
    // be wasted work). Only runs if there's a token AND we've previously
    // completed first-run onboarding (`lastSeenVersion` is set).
    if (appState.lastSeenVersion) {
      const { shouldAutoLaunchWelcome, startWelcome } = onboarding;
      if (shouldAutoLaunchWelcome()) startWelcome();
    }
  }
  render();
}

// L005 fix: on startup crash, also disable mouse + paste mode and clear
// pending toast timer so the terminal isn't left in a weird state.
main().catch(err => {
  debug('Fatal:', err.message, err.stack);
  try {
    for (const cb of _shutdownCallbacks) { cb(); }
  } catch {}
  try { disableMouse(); } catch {}
  try { disableBracketedPaste(); } catch {}
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
});
process.on('uncaughtException', (err) => {
  debug('Uncaught exception:', err.message, err.stack);
  try {
    process.stdout.write('\x1b[?25h');
    process.stdout.write('\x1b[2J\x1b[H');
    console.error('Uncaught exception:', err.message);
  } catch {}
  process.exit(1);
});
