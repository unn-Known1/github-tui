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

// Animated spinner frames.
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinnerIdx = 0;

// Minimum terminal dimensions.
const MIN_W = 60;
const MIN_H = 20;

// Layout constants.
export const HEADER_HEIGHT = 7;
export const FOOTER_HEIGHT = 3;
export const CONTENT_PADDING = 4;

// Draw a centered empty-state card: icon + title + message + optional hint.
export function emptyState(screen, y, h, { icon, title, message, hint }) {
  const W = screen.width;
  const lines = [];
  if (icon)   lines.push({ text: icon,    style: color('accent'), yOff: 0 });
  if (title)  lines.push({ text: title,   style: color('title'),  yOff: 1 });
  if (message) lines.push({ text: message, style: color('dim'),   yOff: 2 });
  if (hint)   lines.push({ text: hint,    style: color('dim'),    yOff: 3 });

  if (lines.length === 0) return;
  const totalH = lines[lines.length - 1].yOff + 1;
  const startY = y + Math.max(0, Math.floor((h - totalH) / 2));

  for (const line of lines) {
    const row = startY + line.yOff;
    if (row >= y + h) break;
    const cx = Math.max(CONTENT_PADDING, Math.floor((W - line.text.length) / 2));
    screen.writeStr(cx, row, line.text, line.style);
  }
}

// Draw skeleton placeholder bars during loading.
export function skeletonBars(screen, y, h, count = 5, barWidth = 0.4) {
  const W = screen.width;
  const bw = Math.floor(W * barWidth);
  for (let i = 0; i < count && y + i * 2 < y + h; i++) {
    const row = y + i * 2;
    screen.writeStr(CONTENT_PADDING, row, '░'.repeat(bw), color('dim'));
  }
}

function doRender() {
  if (!screen) return;
  const W = screen.width;
  const H = screen.height;
  screen.clear();

  // ── Minimum terminal size check ──
  if (W < MIN_W || H < MIN_H) {
    const msg = 'Terminal too small';
    const detail = 'Need ' + MIN_W + 'x' + MIN_H + ', have ' + W + 'x' + H;
    const cx = Math.max(0, Math.floor((W - msg.length) / 2));
    const cy = Math.floor(H / 2) - 1;
    screen.writeStr(cx, cy, msg, { fg: 'red', bold: true });
    screen.writeStr(Math.max(0, Math.floor((W - detail.length) / 2)), cy + 1, detail, color('dim'));
    screen.render();
    return;
  }

  // ── Header ──
  screen.box(0, 0, W, 3, 'GitHub TUI');

  if (appState.user) {
    const greeting = 'Welcome, ' + appState.user.login;
    screen.writeStr(2, 1, greeting, color('title'));
  } else {
    screen.writeStr(2, 1, 'Not authenticated', color('dim'));
  }

  // Rate-limit indicator, top-right with color coding.
  if (lastRateLimit.remaining !== null && lastRateLimit.limit !== null) {
    const r = lastRateLimit.remaining, lim = lastRateLimit.limit;
    const pct = lim > 0 ? r / lim : 0;
    const txt = 'API ' + r + '/' + lim;
    const style = r === 0
      ? { fg: 'red', bold: true }
      : pct < 0.1
        ? { fg: 'yellow', bold: true }
        : color('dim');
    screen.writeStr(Math.max(2, W - txt.length - 2), 1, txt, style);
  }

  screen.hline(3, '─');

  // ── Tab strip ──
  const tabWidth = Math.floor((W - 2) / TABS.length);
  TABS.forEach((tab, i) => {
    const isActive = i === tabState.current;
    const bx = 1 + i * tabWidth;
    const label = '[' + tab.key + '] ' + tab.label;
    const pad = Math.floor((tabWidth - label.length) / 2);
    const tx = bx + Math.max(0, pad);

    if (isActive) {
      // Active tab: background fill + bright text.
      const selStyle = color('chipActive');
      for (let xx = bx; xx < bx + tabWidth && xx < W; xx++) {
        screen.styleBuf[5][xx] = selStyle;
      }
      screen.writeStr(tx, 5, label, selStyle);
    } else {
      screen.writeStr(tx, 5, label, color('tabBar'));
    }
  });
  screen.hline(6, '─');

  const contentY = HEADER_HEIGHT;
  const contentH = H - HEADER_HEIGHT - FOOTER_HEIGHT;

  // ── Loading skeleton ──
  if (appState.loading && !appState.showHelp && !appState.showPalette) {
    skeletonBars(screen, contentY, contentH, 6, 0.35);
  }

  switch (tabState.current) {
    case 0: renderDashboard(screen, contentY, contentH); break;
    case 1: renderRepos(screen, contentY, contentH); break;
    case 2: renderAnalyze(screen, contentY, contentH); break;
    case 3: renderSettings(screen, contentY, contentH); break;
    case 4: renderInbox(screen, contentY, contentH); break;
  }

  // ── Status bar (full-row background) ──
  const statusStyle = color('statusBar');
  screen.fillRow(H - 2, ' ', statusStyle);

  if (appState.inputMode === 'input') {
    const shown = appState.inputMask
      ? '•'.repeat(appState.inputBuffer.length) : appState.inputBuffer;
    const line = appState.inputPrompt + shown + '█';
    screen.writeStr(1, H - 2, line.substring(0, W - 2), color('inputBox'));
  } else if (appState.message) {
    const msgColors = {
      info: { fg: 'cyan', bold: true },
      success: { fg: 'green', bold: true },
      error: { fg: 'red', bold: true },
      warning: { fg: 'yellow', bold: true },
    };
    screen.writeStr(1, H - 2,
      appState.message.text.substring(0, W - 2), msgColors[appState.message.type] || statusStyle);
  } else {
    let statusLeft = statusLine();
    screen.writeStr(1, H - 2, statusLeft.substring(0, W - 2), statusStyle);
  }

  // Loading spinner in header.
  if (appState.loading) {
    spinnerIdx = (spinnerIdx + 1) % SPINNER.length;
    screen.writeStr(W - 14, 1, SPINNER[spinnerIdx] + ' Loading...', color('accent'));
  }

  // ── Confirmation dialog overlay ──
  if (appState.confirmAction) {
    renderConfirmDialog(screen);
  }

  // ── Overlays (rendered last, on top) ──
  if (appState.showHelp) help.render(screen);
  if (appState.showPalette) renderPalette(screen);

  screen.render();
}

function renderConfirmDialog(screen) {
  const W = screen.width, H = screen.height;
  const msg = appState.confirmMessage || 'Are you sure?';

  // Dim backdrop.
  const backdropStyle = color('modalBackdrop');
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) screen.styleBuf[yy][xx] = backdropStyle;
  }

  const boxW = Math.min(50, W - 4);
  const boxH = 7;
  const x = Math.floor((W - boxW) / 2);
  const y = Math.floor((H - boxH) / 2);

  for (let yy = y; yy < y + boxH; yy++) {
    for (let xx = x; xx < x + boxW; xx++) screen.setCell(xx, yy, ' ', null);
  }
  screen.box(x, y, boxW, boxH, 'Confirm');

  const cx = Math.max(x + 2, Math.floor((W - msg.length) / 2));
  screen.writeStr(cx, y + 2, msg.substring(0, boxW - 4));

  const hint = '[y] Yes   [n] Cancel';
  screen.writeStr(Math.max(x + 2, Math.floor((W - hint.length) / 2)), y + 4, hint, color('accent'));
}

function statusLine() {
  if (appState.inputMode) return '[ESC] Cancel  [Enter] Confirm';
  if (appState.confirmAction) return '[y] Confirm  [n] Cancel';
  const sep = ' | ';
  switch (tabState.current) {
    case 0: return 'Tabs: [1-5]' + sep + '[r] Refresh' + sep + '[Ctrl-P] Palette' + sep + '[?] Help';
    case 1: return 'Sort: [n/S/f/i/u]' + sep + '[/] Filter' + sep + '[t] Type' + sep + '[D] Density';
    case 2: {
      const v = appState.analyzeView;
      if (v === 'search')  return '[Enter/i] Search' + sep + '[Ctrl-P] Palette' + sep + '[?] Help';
      if (v === 'results') return '[↑↓jk] Nav' + sep + '[Enter] View' + sep + '[Space] More' + sep + '[Esc] Back';
      if (v === 'details') return '[Enter] Forks' + sep + '[i] Issues' + sep + '[P] PRs' + sep + '[R] README' + sep + '[F] Files';
      if (v === 'forks')   return '[↑↓jk] Nav' + sep + '[Space] More' + sep + '[p/s/n] Sort' + sep + '[Esc] Back';
      return '';
    }
    case 3: return '[↑↓] Nav' + sep + '[Enter] Select' + sep + '[Ctrl-P] Palette' + sep + '[?] Help';
    case 4: return '[↑↓jk] Nav' + sep + '[Enter/o] Open' + sep + '[m] Read' + sep + '[M] All' + sep + '[f] Filter';
  }
  return '';
}

bindRender(doRender);
export { doRender as render };
