// Top-level render() — owns the chrome (header, tab strip, status bar,
// message line, rate-limit indicator) and dispatches to whichever tab is
// active. Tab modules only render inside their content box.

import { appState, TABS, tabState, bindRender } from './state.mjs';
import { Screen } from './screen.mjs';
import { lastRateLimit, offlineState, getCacheStats } from './github.mjs';
import { color } from './theme.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VERSION = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version;
import { renderDashboard } from './tabs/dashboard.mjs';
import { renderRepos } from './tabs/repos.mjs';
import { renderAnalyze } from './tabs/analyze.mjs';
import { renderSettings } from './tabs/settings.mjs';
import { renderInbox } from './tabs/inbox.mjs';
import { renderActions } from './tabs/actions.mjs';
import * as help from './tabs/help.mjs';
import { renderPalette } from './palette.mjs';
import { renderDetail } from './tabs/detail.mjs';
import { renderOnboarding } from './tabs/onboarding.mjs';

let screen;

export function getScreen() { return screen; }
export function initScreen() { screen = new Screen(); return screen; }

// Animated spinner frames.
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinnerIdx = 0;

export function getSpinner() {
  spinnerIdx = (spinnerIdx + 1) % SPINNER.length;
  return SPINNER[spinnerIdx];
}

export function loadingIndicator(screen, x, y, label = 'loading', style) {
  const s = style || { fg: 'cyan' };
  screen.writeStr(x, y, getSpinner() + ' ' + label, s);
}

// Minimum terminal dimensions.
const MIN_W = 60;
const MIN_H = 20;

// Layout constants — single source of truth for the chrome heights.
export const HEADER_HEIGHT = 4;     // 3-row header + 1 separator
export const FOOTER_HEIGHT = 2;     // 1-row status + 1 separator above
export const CONTENT_PADDING = 2;

// Build the current breadcrumb trail based on tab + sub-view.
export function buildBreadcrumb() {
  const segments = [];
  switch (tabState.current) {
    case 0: segments.push('Dashboard'); break;
    case 1:
      segments.push('Repos');
      if (appState.reposView === 'starred') segments.push('Starred');
      break;
    case 2:
      segments.push('Analyze');
      if (appState.analyzeView === 'search') segments.push('Search');
      else if (appState.analyzeView === 'results') {
        segments.push('Results');
        if (appState.searchQuery) segments.push(appState.searchQuery);
      } else if (appState.analyzeView === 'details') {
        if (appState.repoDetails) segments.push(appState.repoDetails.full_name);
        if (appState.detailsPane === 'issues') segments.push('Issues');
        else if (appState.detailsPane === 'prs') segments.push('PRs');
        else if (appState.detailsPane === 'readme') segments.push('README');
        else if (appState.detailsPane === 'files') {
          segments.push('Files');
          if (appState.filesPath) segments.push(appState.filesPath);
        }
      } else if (appState.analyzeView === 'forks') {
        if (appState.repoDetails) segments.push(appState.repoDetails.full_name);
        segments.push('Forks');
      }
      break;
    case 3:
      segments.push('Actions');
      if (appState.actionsView === 'runs' && appState.actionsRepos[appState.actionsRepoSelected]) {
        segments.push(appState.actionsRepos[appState.actionsRepoSelected].full_name);
      }
      break;
    case 4:
      segments.push('Inbox');
      if (appState.inboxFilter !== 'all') segments.push(appState.inboxFilter);
      break;
    case 5: segments.push('Settings'); break;
  }
  return segments;
}

// Draw a centered empty-state card: icon + title + message + optional hint.
export function emptyState(screen, y, h, { icon, title, message, hint, keyHint }) {
  const W = screen.width;
  const lines = [];
  if (icon)   lines.push({ text: icon,    style: { fg: 'cyan' },  yOff: 0 });
  if (title)  lines.push({ text: title,   style: color('title'),  yOff: 2 });
  if (message) lines.push({ text: message, style: color('dim'),   yOff: 4 });
  if (hint)   lines.push({ text: hint,    style: color('dim'),    yOff: 5 });
  if (keyHint) lines.push({ text: keyHint, style: { fg: 'cyan' }, yOff: 7 });

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

// Draw a centered error-state card: icon + message + retry hint.
export function errorState(screen, y, h, { message, detail }) {
  const W = screen.width;
  const lines = [];
  lines.push({ text: '⚠',    style: { fg: 'red', bold: true },  yOff: 0 });
  lines.push({ text: 'Error', style: { fg: 'red', bold: true },  yOff: 2 });
  if (message) lines.push({ text: message, style: color('dim'),   yOff: 4 });
  if (detail)  lines.push({ text: detail,  style: color('dim'),   yOff: 5 });
  lines.push({ text: 'Press [r] to retry', style: { fg: 'red' }, yOff: 7 });

  const totalH = lines[lines.length - 1].yOff + 1;
  const startY = y + Math.max(0, Math.floor((h - totalH) / 2));

  for (const line of lines) {
    const row = startY + line.yOff;
    if (row >= y + h) break;
    const cx = Math.max(CONTENT_PADDING, Math.floor((W - line.text.length) / 2));
    screen.writeStr(cx, row, line.text, line.style);
  }
}

// Draw scroll indicators at the top and/or bottom of a scrollable list.
// Shows "↑" when there's content above, "↓" when there's content below.
export function scrollIndicators(screen, topY, botY, scroll, total, pageSize) {
  if (total <= 1) return;
  const W = screen.width;
  const hasAbove = scroll > 0;
  const effectivePageSize = pageSize ?? (botY - topY + 1);
  const hasBelow = scroll + effectivePageSize < total;
  if (!hasAbove && !hasBelow) return;
  if (topY === botY) {
    screen.writeStr(W - 2, topY, hasAbove && hasBelow ? '↕' : hasAbove ? '↑' : '↓', { dim: true });
  } else {
    if (hasAbove) screen.writeStr(W - 2, topY, '↑', { dim: true });
    if (hasBelow) screen.writeStr(W - 2, botY, '↓', { dim: true });
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

// ── Collapsible section header ──
import { isCollapsed } from './state.mjs';

export function collapsibleHeader(screen, x, y, section, label, hint) {
  const collapsed = isCollapsed(section);
  const arrow = collapsed ? '▸' : '▾';
  const W = screen.width;
  const text = arrow + ' ' + label;
  screen.writeStr(x, y, text, { fg: 'cyan', bold: true });
  // Underline decoration after the label
  const lineStart = x + text.length + 1;
  const lineEnd = hint ? Math.min(W - hint.length - 4, W - 4) : W - 4;
  if (lineStart < lineEnd) {
    screen.writeStr(lineStart, y, '─'.repeat(lineEnd - lineStart), { fg: 'cyan', dim: true });
  }
  if (hint) {
    const hx = W - hint.length - 2;
    if (hx > lineEnd + 1) screen.writeStr(hx, y, hint, { dim: true });
  }
  // Record position for mouse click detection. Include full text width so the
  // click target covers the entire header (arrow + space + label).
  appState._sectionHeaders[section] = { x, y, w: text.length };
  return !collapsed;
}

// Render the top header (3 rows + separator).
function renderHeader(W) {
  const titleStyle = color('title') || { fg: 'white', bold: true };
  const subtitleStyle = { dim: true };

  // Row 0: app title + version (left)  |  user (right)
  screen.writeStr(2, 0, '◈', { fg: 'cyan', bold: true });
  screen.writeStr(4, 0, 'GitHub TUI', titleStyle);
  const version = 'v' + VERSION;
  screen.writeStr(15, 0, version, { fg: 'gray', dim: true });

  // Offline banner — shows when offline.
  if (offlineState.isOffline) {
    const banner = '⚠ OFFLINE';
    screen.writeStr(22, 0, banner, { fg: 'yellow', bold: true });
  }

  // User greeting on the right of the top line.
  if (appState.user) {
    const login = '@' + appState.user.login;
    const x = Math.max(2, W - login.length - 2);
    screen.writeStr(x, 0, login, { fg: 'cyan', bold: true });
  }

  // Row 1: tagline (left)  |  rate-limit + cache stats (right)
  screen.writeStr(2, 1, 'A zero-dependency terminal client for GitHub', subtitleStyle);

  // Cache stats on the right (small, dim).
  const cacheStats = getCacheStats();
  if (cacheStats.entries > 0) {
    const cacheTxt = '[' + cacheStats.totalKB + 'KB]';
    const cx = Math.max(2, W - cacheTxt.length - 2);
    screen.writeStr(cx, 1, cacheTxt, { dim: true });
  }

  if (lastRateLimit.remaining !== null && lastRateLimit.limit !== null) {
    const r = lastRateLimit.remaining, lim = lastRateLimit.limit;
    const pct = lim > 0 ? r / lim : 0;
    const barWidth = 10;
    const filled = Math.round(pct * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
    const style = r === 0 ? { fg: 'red', bold: true }
      : pct < 0.1 ? { fg: 'yellow', bold: true }
      : pct < 0.3 ? { fg: 'yellow' }
      : { fg: 'green' };
    const txt = 'API ' + bar + ' ' + r + '/' + lim;
    // Position before cache stats if both shown.
    const cacheW = cacheStats.entries > 0 ? cacheStats.totalKB.toString().length + 8 : 0;
    const x = Math.max(2, W - txt.length - cacheW - 3);
    screen.writeStr(x, 1, txt, style);
  } else if (!appState.user) {
    const x = Math.max(2, W - 18);
    screen.writeStr(x, 1, '⚠  not signed in', { fg: 'yellow', bold: true });
  }

  // Row 2: breadcrumb + quick hint (left)  |  loading (right)
  const crumb = buildBreadcrumb();
  if (crumb.length > 0) {
    screen.breadcrumb(2, 2, crumb, Math.floor(W * 0.6));
  }
  if (appState.loading) {
    const txt = getSpinner() + ' loading';
    const x = Math.max(2, W - txt.length - 2);
    screen.writeStr(x, 2, txt, { fg: 'cyan' });
  } else {
    // Show recent repo hint if any.
    if (appState.recentRepos.length > 0 && tabState.current === 0) {
      const last = appState.recentRepos[0];
      const tip = 'Last visited: ' + last.full_name;
      const x = Math.max(2, W - tip.length - 2);
      screen.writeStr(x, 2, tip, { dim: true });
    }
  }

  // Row 3: separator
  screen.hline(3, '─', { dim: true });
}

// Render the tab strip (2 rows: tab row + separator).
function renderTabStrip(y, W) {
  const tabRowY = y;
  const sepY = y + 1;
  // Count unread inbox for badge.
  const unreadCount = appState.notifications.filter(n => n.unread).length;

  // Pre-compute each tab's width (proportional to label, but min-width).
  const tabW = Math.max(8, Math.floor((W - 2) / TABS.length));
  const tabXs = [];
  let cx = 1;
  for (let i = 0; i < TABS.length; i++) {
    tabXs.push(cx);
    cx += tabW;
  }

  TABS.forEach((tab, i) => {
    const isActive = i === tabState.current;
    const bx = tabXs[i];
    const label = tab.label;
    const key = tab.key;

    // Background: active gets a chip-like colored bg.
    if (isActive) {
      for (let xx = bx; xx < bx + tabW && xx < W - 1; xx++) {
        screen.styleBuf[tabRowY][xx] = { bg: 'cyan', fg: 'white', bold: true };
      }
    } else {
      // Subtle dimmed style for inactive tabs.
      for (let xx = bx; xx < bx + tabW && xx < W - 1; xx++) {
        screen.styleBuf[tabRowY][xx] = { dim: true };
      }
    }

    // Tab text: "[1] Dash"
    const text = '[' + key + '] ' + label;
    const tx = bx + 1;
    screen.writeStr(tx, tabRowY, text, isActive ? { bg: 'cyan', fg: 'white', bold: true } : { fg: 'gray', dim: true });

    // Badge for inbox with unread items.
    if (i === 4 && unreadCount > 0) {
      const badgeText = ' ' + (unreadCount > 99 ? '99+' : String(unreadCount)) + ' ';
      const bx2 = bx + tabW - badgeText.length - 1;
      if (bx2 > tx + text.length + 1) {
        for (let xx = bx2; xx < bx2 + badgeText.length && xx < W - 1; xx++) {
          screen.styleBuf[tabRowY][xx] = color('tabBadge');
        }
        screen.writeStr(bx2, tabRowY, badgeText, { fg: 'darkGray', bold: true });
      }
    }
  });

  // Separator under tab strip — highlight under active tab.
  screen.hline(sepY, '─', { dim: true });
  const activeTab = TABS[tabState.current];
  if (activeTab) {
    const ax = tabXs[tabState.current];
    for (let xx = ax; xx < ax + tabW && xx < W - 1; xx++) {
      screen.setCell(xx, sepY, '━', { fg: 'cyan', bold: true });
    }
  }
}

// Render the bottom status bar (1 row + separator above).
function renderFooter(W, H) {
  const sepY = H - FOOTER_HEIGHT;
  const statusY = sepY + 1;
  // Separator
  screen.hline(sepY, '─', { dim: true });

  const statusStyle = color('statusBar');
  screen.fillRow(statusY, ' ', statusStyle);

  if (appState.inputMode === 'input') {
    const buf = appState.inputBuffer;
    const cursor = appState.inputCursor || buf.length;
    const shown = appState.inputMask
      ? '•'.repeat(buf.length) : buf;
    // Insert cursor character at the correct position.
    const before = shown.slice(0, cursor);
    const after = shown.slice(cursor);
    const line = appState.inputPrompt + before + '█' + after;
    screen.writeStr(1, statusY, line.substring(0, W - 2), color('inputBox'));
    return;
  }

  // Toast message — prominent with icon.
  if (appState.message) {
    const icon = appState.message.icon || 'ⓘ';
    const typeStyles = {
      info:    color('toastInfo'),
      success: color('toastSuccess'),
      error:   color('toastError'),
      warning: color('toastWarning'),
    };
    const style = typeStyles[appState.message.type] || statusStyle;
    const txt = ' ' + icon + '  ' + appState.message.text;
    screen.writeStr(1, statusY, txt.substring(0, W - 2), style);
    return;
  }

  // Default: context-aware key hint line.
  const hint = statusLine();
  if (hint) {
    const tabLabel = TABS[tabState.current]?.label || '';
    screen.writeStr(2, statusY, tabLabel, { fg: 'cyan', bold: true });
    screen.writeStr(2 + tabLabel.length + 1, statusY, '│', { dim: true });
    screen.writeStr(2 + tabLabel.length + 3, statusY, hint.substring(0, W - tabLabel.length - 8), color('repoName') || { fg: 'white' });
  }

  // Rate limit badge on the right when remaining is available and low.
  const rl = lastRateLimit;
  if (rl.remaining !== null && rl.limit !== null && rl.limit > 0) {
    const pct = rl.remaining / rl.limit;
    if (pct < 0.3) {
      const badgeStyle = pct < 0.1 ? color('rateCrit') : color('rateWarn');
      const badgeText = ' API ' + rl.remaining + '/' + rl.limit + ' ';
      const bx = W - badgeText.length - 2;
      if (bx > 4) {
        for (let xx = bx; xx < bx + badgeText.length; xx++) {
          screen.styleBuf[statusY][xx] = badgeStyle;
        }
        screen.writeStr(bx, statusY, badgeText, badgeStyle);
      }
    }
  }
}

// Status-line composer — context aware.
function statusLine() {
  if (appState.confirmAction) return ' [y] Confirm    [n] Cancel';
  if (appState.showDetail) {
    return ' [Esc] Close   [↑↓] Scroll   [c] Comment   [r] React   [x] Close/Reopen   [y] Copy URL   [M] Merge';
  }
  if (appState.showOnboarding) return ' [Enter] Get started   [Esc] Skip';
  if (appState.showWelcome) return ' [Esc] Close   [?] Help   [g] Take tour';
  const sep = '   ';
  switch (tabState.current) {
    case 0: {
      const cardNav = appState.dashboardCardsFocus ? '   [Enter] Open' : '';
      return ' [1-6] Tabs' + sep + '[r] Refresh' + sep + '[?] Help' + sep + '[Ctrl-P] Palette' + cardNav;
    }
    case 1: {
      if (appState.reposView === 'starred') {
        return ' [Esc] Back   [↑↓jk] Nav   [Enter] Analyze   [V] Own repos   [?] Help';
      }
      return ' [/] Filter' + sep + '[t] Type' + sep + '[L] Language' + sep + '[x] Stale' + sep + '[D] Density' + sep + '[P] Pin' + sep + '[V] Starred' + sep + '[c] Clear';
    }
    case 2: {
      const v = appState.analyzeView;
      if (v === 'search')  return ' [i] Search public repo' + sep + '[?] Help' + sep + '[Ctrl-P] Palette';
      if (v === 'results') return ' [↑↓jk] Nav' + sep + '[Enter] View' + sep + '[Space] More' + sep + '[Esc] Back';
      if (v === 'details') return ' [O]v [i]ssues [P]Rs [R]eadme [F]iles [A] Packages [T]raffic [M]iles [L]abels [K]hecks [S]ecurity';
      if (v === 'forks')   return ' [↑↓jk] Nav' + sep + '[Space] More' + sep + '[p/s/n] Sort' + sep + '[Esc] Back';
      return '';
    }
    case 3: {
      if (appState.actionsView === 'runs') {
        return ' [Enter] Open in browser' + sep + '[r] Re-run' + sep + '[x] Cancel' + sep + '[Esc] Back' + sep + '[?] Help';
      }
      return ' [↑↓jk] Nav' + sep + '[Enter] View runs' + sep + '[?] Help';
    }
    case 4: return ' [↑↓jk] Nav' + sep + '[Enter] Open' + sep + '[m] Read' + sep + '[M] All' + sep + '[f] Filter' + sep + '[u] Unsubscribe';
    case 5: return ' [↑↓] Nav' + sep + '[Enter] Select' + sep + '[s] Star repo' + sep + '[?] Help';
  }
  return '';
}

function doRender() {
  if (!screen) return;
  const W = screen.width;
  const H = screen.height;
  // Buffer is already clear from the previous render's swap — no clear() needed.
  appState._sectionHeaders = {};

  // ── Minimum terminal size check ──
  if (W < MIN_W || H < MIN_H) {
    const msg = 'Terminal too small';
    const detail = 'Need ' + MIN_W + '×' + MIN_H + ', have ' + W + '×' + H;
    const cx = Math.max(0, Math.floor((W - msg.length) / 2));
    const cy = Math.floor(H / 2) - 1;
    screen.writeStr(cx, cy, msg, { fg: 'red', bold: true });
    screen.writeStr(Math.max(0, Math.floor((W - detail.length) / 2)), cy + 1, detail, color('dim'));
    screen.render();
    return;
  }

  // ── Header (3 rows + separator) ──
  renderHeader(W);

  // ── Tab strip (1 row + separator) ──
  const tabStripY = HEADER_HEIGHT;
  renderTabStrip(tabStripY, W);

  // ── Tab content ──
  const contentY = HEADER_HEIGHT + 2;
  const contentH = H - HEADER_HEIGHT - FOOTER_HEIGHT - 2;

  // Loading skeleton
  if (appState.loading && !appState.showHelp && !appState.showPalette
      && !appState.showOnboarding && !appState.showWelcome) {
    skeletonBars(screen, contentY, contentH, 6, 0.35);
  }

  switch (tabState.current) {
    case 0: renderDashboard(screen, contentY, contentH); break;
    case 1: renderRepos(screen, contentY, contentH); break;
    case 2: renderAnalyze(screen, contentY, contentH); break;
    case 3: renderActions(screen, contentY, contentH); break;
    case 4: renderInbox(screen, contentY, contentH); break;
    case 5: renderSettings(screen, contentY, contentH); break;
  }

  // ── Footer ──
  renderFooter(W, H);

  // ── Overlays (rendered last, on top) ──
  if (appState.confirmAction) renderConfirmDialog(screen);
  if (appState.showOnboarding) renderOnboarding(screen);
  if (appState.showWelcome) renderOnboarding(screen, { welcomeMode: true });
  if (appState.showHelp) help.render(screen);
  if (appState.showDetail) renderDetail(screen);
  if (appState.showPalette) renderPalette(screen);
  if (appState.showBookmarks) renderBookmarksOverlay(screen);

  screen.render();
}

function renderConfirmDialog(screen) {
  const W = screen.width, H = screen.height;
  const msg = appState.confirmMessage || 'Are you sure?';
  const title = appState.confirmTitle || 'Confirm';

  // Dim backdrop.
  const backdropStyle = color('modalBackdrop');
  if (backdropStyle) {
    for (let yy = 0; yy < H; yy++) {
      for (let xx = 0; xx < W; xx++) screen.styleBuf[yy][xx] = backdropStyle;
    }
  }

  const boxW = Math.min(60, W - 4);
  const boxH = 8;
  const x = Math.floor((W - boxW) / 2);
  const y = Math.floor((H - boxH) / 2);

  // Body background: clear (no fill)
  for (let yy = y; yy < y + boxH; yy++) {
    for (let xx = x; xx < x + boxW; xx++) screen.setCell(xx, yy, ' ', null);
  }
  screen.box(x, y, boxW, boxH, title, color('modalBorder'));

  // Centered message with word-wrap.
  const words = msg.split(/\s+/);
  const innerW = boxW - 6;
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > innerW) {
      if (line) lines.push(line);
      line = w;
    } else {
      line = line ? line + ' ' + w : w;
    }
  }
  if (line) lines.push(line);
  const msgY = y + 2;
  for (let i = 0; i < lines.length && i < 3; i++) {
    const cx = Math.max(x + 2, Math.floor((W - lines[i].length) / 2));
    screen.writeStr(cx, msgY + i, lines[i]);
  }

  // Hint: [y] Yes  [n] No — pinned to bottom.
  const hint = '[y] Yes   [n] Cancel';
  const hy = y + boxH - 2;
  const hx = Math.max(x + 2, Math.floor((W - hint.length) / 2));
  screen.writeStr(hx, hy, hint, color('accent'));
}

function renderBookmarksOverlay(screen) {
  const W = screen.width, H = screen.height;
  const bm = appState.bookmarks;
  const backdropStyle = color('modalBackdrop');
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) screen.styleBuf[yy][xx] = backdropStyle;
  }
  const boxW = Math.min(72, W - 4);
  const boxH = Math.min(bm.length + 6, H - 4);
  const x = Math.floor((W - boxW) / 2);
  const y = Math.floor((H - boxH) / 2);
  for (let yy = y; yy < y + boxH; yy++) {
    for (let xx = x; xx < x + boxW; xx++) screen.setCell(xx, yy, ' ', null);
  }
  screen.box(x, y, boxW, boxH, 'Bookmarks (' + bm.length + ')');

  // Empty state
  if (bm.length === 0) {
    screen.writeStr(x + 2, y + 2, '★', { fg: 'cyan' });
    screen.writeStr(x + 2, y + 3, 'No bookmarks yet', color('emptyTitle') || { fg: 'white', bold: true });
    screen.writeStr(x + 2, y + 4, 'Press [b] on any repo to add one.', color('dim'));
    screen.writeStr(x + 2, y + 5, 'Then use this overlay to browse, open, or delete them.', color('dim'));
    return;
  }

  // Column headers
  screen.writeStr(x + 2, y + 1, 'REPO', color('header'));
  if (boxW > 50) screen.writeStr(x + boxW - 28, y + 1, 'TAGS / URL', color('header'));

  const maxVisible = boxH - 5;
  const start = appState.bookmarksScroll;
  for (let i = 0; i < maxVisible && start + i < bm.length; i++) {
    const idx = start + i;
    if (idx >= bm.length) break;
    const b = bm[idx];
    const sel = idx === appState.bookmarksCursor;
    const row = y + 2 + i;
    if (sel) {
      for (let xx = x + 1; xx < x + boxW - 1; xx++) screen.styleBuf[row][xx] = color('selection');
    }
    const prefix = sel ? '▶ ' : '  ';
    const name = truncate(b.full_name || '?', boxW - 16);
    screen.writeStr(x + 1, row, prefix, sel ? color('selection') : null);
    screen.writeStr(x + 3, row, name, sel ? color('selection') : (color('repoName') || { fg: 'white' }));

    // Stars
      const stars = b.stars ? '★ ' + b.stars : '';
    if (stars) {
      screen.writeStr(x + 3 + name.length + 1, row, stars, sel ? color('selection') : { fg: 'yellow', dim: true });
    }

    // Tags or URL snippet on the right
    if (boxW > 50) {
      const tagsStr = (b.tags && b.tags.length > 0) ? b.tags.slice(0, 2).join(',') : '';
      const urlSnippet = b.url ? b.url.replace(/^https?:\/\//, '').substring(0, 24) : '';
      const rightText = tagsStr ? '{' + truncate(tagsStr, 20) + '}' : truncate(urlSnippet, 24);
      screen.writeStr(x + boxW - rightText.length - 3, row,
        rightText, sel ? color('selection') : color('dim'));
    }
  }

  // Scroll indicator
  scrollIndicators(screen, y + 2, y + 2 + Math.min(maxVisible, bm.length) - 1,
    appState.bookmarksScroll, bm.length);

  // Footer with count & hints
  const footY = y + boxH - 2;
  const range = (start + 1) + '-' + Math.min(start + maxVisible, bm.length) + ' of ' + bm.length;
  screen.writeStr(x + 2, footY, range, color('dim'));

  const hint = '[Enter] Open  [d] Delete  [y] URL  [Esc] Close';
  screen.writeStr(x + boxW - hint.length - 3, footY, hint, color('dim'));
}

bindRender(doRender);
export { doRender as render };
