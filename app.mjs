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
import { loadBookmarks, loadSavedSearches, loadPins } from './tui/store.mjs';
import { getRateLimit } from './tui/github.mjs';

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
  } catch {}
}

async function main() {
  if (!process.stdin.isTTY) {
    console.log('GitHub TUI requires an interactive terminal.');
    console.log('Usage: node app.mjs');
    process.exit(1);
  }

  // Hide cursor; enable mouse; clear on exit.
  process.stdout.write('\x1b[?25l');
  enableMouse();
  const cleanup = () => {
    disableMouse();
    process.stdout.write('\x1b[?25h\x1b[2J\x1b[H');
  };
  process.on('exit', cleanup);
  process.on('SIGINT',  () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  // Load persisted state.
  loadTheme();
  appState.token = loadToken();
  appState.bookmarks = loadBookmarks();
  appState.savedSearches = loadSavedSearches();
  appState.repoPins = loadPins();
  loadCollapsed();
  loadSession();

  // Initialize screen + register palette actions.
  const screen = initScreen();
  registerCoreActions();

  // Wire stdin → key router.
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', handleKey);

  // Resize listener.
  process.stdout.on('resize', () => {
    screen.updateSize();
    render();
  });
  screen.updateSize();

  // Auto-load if we already have a saved token.
  if (appState.token) {
    await loadUserData();
    refreshRateLimit();
    // Refresh rate limit every 60 seconds.
    setInterval(refreshRateLimit, 60000);
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
  console.error('Fatal:', err);
  process.exit(1);
});
