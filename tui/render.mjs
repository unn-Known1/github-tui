// Top-level render() — owns the chrome (header, tab strip, status bar,
// message line, rate-limit indicator) and dispatches to whichever tab is
// active. Tab modules only render inside their content box.

import { appState, TABS, tabState, bindRender } from './state.mjs';
import { Screen } from './screen.mjs';
import { lastRateLimit } from './github.mjs';
import { color } from './theme.mjs';
import { renderDashboard } from './tabs/dashboard.mjs';
import { renderRepos } from './tabs/repos.mjs';
import { renderAnalyze } from './tabs/analyze.mjs';
import { renderSettings } from './tabs/settings.mjs';
import { renderInbox } from './tabs/inbox.mjs';
import * as help from './tabs/help.mjs';
import { renderPalette } from './palette.mjs';

let screen;

export function getScreen() { return screen; }
export function initScreen() { screen = new Screen(); return screen; }

function doRender() {
  if (!screen) return;
  const W = screen.width;
  const H = screen.height;
  screen.clear();

  // Header.
  screen.box(0, 0, W, 3, 'GitHub TUI');
  if (appState.user) screen.writeStr(2, 1, 'Welcome, ' + appState.user.login);
  else screen.writeStr(2, 1, 'Not authenticated', 'dim');

  // Rate-limit indicator, top-right.
  if (lastRateLimit.remaining !== null && lastRateLimit.limit !== null) {
    const r = lastRateLimit.remaining, lim = lastRateLimit.limit;
    const txt = 'API ' + r + '/' + lim;
    const c = r === 0 ? 'red' : (r < lim * 0.1 ? 'yellow' : 'dim');
    screen.writeStr(Math.max(2, W - txt.length - 2), 1, txt, c);
  }

  screen.hline(3, '─');

  // Tab strip.
  const tabWidth = Math.floor((W - 2) / TABS.length);
  TABS.forEach((tab, i) => {
    const isActive = i === tabState.current;
    const bx = 1 + i * tabWidth;
    const label = '[' + tab.key + '] ' + tab.label;
    const pad = Math.floor((tabWidth - label.length) / 2);
    const tx = bx + Math.max(0, pad);
    screen.writeStr(tx, 5, label, isActive ? 'bright' : 'dim');
  });
  screen.hline(6, '─');

  const contentY = 7;
  const contentH = H - 10;

  switch (tabState.current) {
    case 0: renderDashboard(screen, contentY, contentH); break;
    case 1: renderRepos(screen, contentY, contentH); break;
    case 2: renderAnalyze(screen, contentY, contentH); break;
    case 3: renderSettings(screen, contentY, contentH); break;
    case 4: renderInbox(screen, contentY, contentH); break;
  }

  screen.hline(H - 3, '─');

  // Global input overlay — shown above status bar regardless of tab.
  if (appState.inputMode === 'input') {
    const shown = appState.inputMask
      ? '•'.repeat(appState.inputBuffer.length) : appState.inputBuffer;
    const line = appState.inputPrompt + shown + '█';
    screen.writeStr(1, H - 4, line.substring(0, W - 2), color('accent'));
  }

  // Message bar or status bar.
  if (appState.message) {
    const colors = { info: 'cyan', success: 'green', error: 'red', warning: 'yellow' };
    screen.writeStr(1, H - 2,
      appState.message.text.substring(0, W - 2), colors[appState.message.type]);
  } else {
    let statusLeft = statusLine();
    screen.writeStr(1, H - 2, statusLeft.substring(0, W - 2), 'dim');
  }

  if (appState.loading) screen.writeStr(W - 14, 1, '⟳ Loading...', color('accent'));

  // Overlays last.
  if (appState.showHelp) help.render(screen);
  if (appState.showPalette) renderPalette(screen);

  screen.render();
}

function statusLine() {
  if (appState.inputMode) return '[ESC] Cancel  [Enter] Confirm';
  switch (tabState.current) {
    case 0: return '[1-5] Tabs  [r] Refresh  [Ctrl-P] Palette  [?] Help  [q] Quit';
    case 1: return '[n/s/f/i/u] Sort  [/] Filter  [Space] More  [Ctrl-P] Palette  [?] Help  [q] Quit';
    case 2: {
      const v = appState.analyzeView;
      if (v === 'search')  return '[Enter/i] Search  [Ctrl-P] Palette  [?] Help  [q] Quit';
      if (v === 'results') return '[↑↓jk] Nav  [Enter] View  [Space] More  [o] Browser  [Esc] Back';
      if (v === 'details') return '[Enter] Forks  [i] Issues  [P] PRs  [R] README  [s] Star  [b] Bookmark';
      if (v === 'forks')   return '[↑↓jk] Nav  [Space] More  [p/s/n] Sort  [o] Browser  [Esc] Back';
      return '';
    }
    case 3: return '[↑↓] Nav  [Enter] Select  [Ctrl-P] Palette  [?] Help  [q] Quit';
    case 4: return '[↑↓jk] Nav  [Enter/o] Open  [m] Read  [M] All  [u] Unsub  [f] Filter  [r] Refresh';
  }
  return '';
}

bindRender(doRender);
export { doRender as render };
