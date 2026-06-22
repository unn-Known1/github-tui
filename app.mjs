#!/usr/bin/env node
// GitHub TUI — entrypoint.
// All real logic lives in tui/*.mjs. This file just wires lifecycle events.

import { appState, tabState, showMessage, loadCollapsed, loadSession } from './tui/state.mjs';
import { enableMouse, disableMouse } from './tui/mouse.mjs';
import { loadToken } from './tui/config.mjs';
import { loadTheme } from './tui/theme.mjs';
import { initScreen, getScreen, render } from './tui/render.mjs';
import { handleKey, registerCoreActions } from './tui/keys.mjs';
import { loadUserData } from './tui/tabs/repos.mjs';
import { loadBookmarks, loadSavedSearches, loadPins, loadRepoPrefs, saveRepoPrefs } from './tui/store.mjs';
import { getRateLimit } from './tui/github.mjs';

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
function debug(...args) {
  if (!DEBUG) return;
  try {
    const logPath = join(homedir(), '.github-tui', 'debug.log');
    appendFileSync(logPath, `[${new Date().toISOString()}] ${args.join(' ')}\n`);
  } catch {}
}

// ── Terminal environment detection ──
const TERM_ENV = process.env.TERM || '';
const TERM_IS_TMUX = !!process.env.TMUX;
const TERM_IS_SSH = !!(process.env.SSH_CLIENT || process.env.SSH_TTY);
const TERM_IS_SCREEN = !!process.env.STY;
const TERM_IS_WSL = !!process.env.WSLENV;

function startAutoRefresh() {
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  if (!appState.autoRefreshEnabled) return;
  autoRefreshInterval = setInterval(async () => {
    if (!appState.token || appState.loading) return;
    const { tabState } = await import('./tui/state.mjs');
    const t = tabState.current;
    try {
      if (t === 0) {
        const { loadDashboardWidgets } = await import('./tui/tabs/dashboard.mjs');
        await loadDashboardWidgets(true);
      } else if (t === 4) {
        const { loadNotifications } = await import('./tui/tabs/inbox.mjs');
        await loadNotifications();
      } else if (t === 3) {
        const actions = await import('./tui/tabs/actions.mjs');
        if (appState.actionsView === 'runs') await actions.loadWorkflowRuns();
      }
    } catch (e) { debug('auto-refresh error:', e.message); }
  }, appState.autoRefreshIntervalMs);
}

// Export for settings to restart after interval change.
globalThis._startAutoRefresh = startAutoRefresh;

async function refreshRateLimit() {
  if (!appState.token) return;
  try {
    const data = await getRateLimit(appState.token);
    if (data && data.resources && data.resources.core) {
      const core = data.resources.core;
      const { lastRateLimit } = await import('./tui/github.mjs');
      lastRateLimit.remaining = core.remaining;
      lastRateLimit.limit = core.limit;
      lastRateLimit.reset = core.reset;
      render();
    }
  } catch (e) { debug('rate-limit refresh error:', e.message); }
}

async function main() {
  // CLI flags.
  if (process.argv.includes('--version') || process.argv.includes('-v')) {
    console.log('github-tui ' + pkg.version);
    process.exit(0);
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
    process.exit(0);
  }

  if (!process.stdin.isTTY) {
    console.log('GitHub TUI requires an interactive terminal.');
    console.log('Usage: node app.mjs');
    process.exit(1);
  }

  // Hide cursor; enable mouse.
  process.stdout.write('\x1b[?25l');
  enableMouse();

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

  // Resize listener — debounced to avoid render thrashing.
  let resizeTimer = null;
  process.stdout.on('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      screen.updateSize();
      render();
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
  function shutdown() {
    if (_shuttingDown) return;
    _shuttingDown = true;
    if (rateLimitInterval) clearInterval(rateLimitInterval);
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    saveCurrentRepoPrefs();
    try { process.stdin.setRawMode(false); } catch {}
    disableMouse();
    process.stdout.write('\x1b[?25h\x1b[2J\x1b[H');
  }
  process.on('exit', shutdown);
  process.on('SIGINT',  () => { shutdown(); process.exit(0); });
  process.on('SIGTERM', () => { shutdown(); process.exit(0); });
  process.on('SIGHUP',  () => { shutdown(); process.exit(0); });

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
  }
  render();
}

main().catch(err => {
  debug('Fatal:', err.message, err.stack);
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
