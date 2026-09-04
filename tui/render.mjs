// Top-level render() — owns the chrome (header, tab strip, status bar,
// message line, rate-limit indicator) and dispatches to whichever tab is
// active. Tab modules only render inside their content box.

import { appState, TABS, tabState, bindRender, checkLoadingWatchdog, getUnreadCount } from './state.mjs';
import { Screen } from './screen.mjs';
import { lastRateLimit, offlineState, getCacheStats } from './github.mjs';
import { color, isAccessible as _isA11y } from './theme.mjs';
import { truncate, truncateToWidth, displayWidth } from './utils.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VERSION = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version;

// Per-tab icon glyphs — a color-coded dashboard-nav signature. Each icon is
// painted in its own theme hue (see iconHues in renderTabStrip); the glyphs
// stay fixed so custom themes change colors, never meaning.
const TAB_ICONS = ['◈', '▦', '◎', '▶', '✉', '⚙'];
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

// Recover scroll positions and selection indices after terminal resize.
// Ensures the selected item stays visible.
export function recoverScrollPositions() {
  if (!screen) return;
  const H = screen.height;
  const contentH = H - HEADER_HEIGHT - FOOTER_HEIGHT - 2;
  if (contentH <= 0) return;

  // Repos tab
  const reposMaxVisible = Math.max(1, contentH - (appState.reposView === 'starred' ? 3 : 6));
  if (appState.repoSelected >= appState.repos.length) {
    appState.repoSelected = Math.max(0, appState.repos.length - 1);
  }
  if (appState.repoScroll > appState.repoSelected) {
    appState.repoScroll = appState.repoSelected;
  } else if (appState.repoScroll + reposMaxVisible <= appState.repoSelected) {
    appState.repoScroll = Math.max(0, appState.repoSelected - reposMaxVisible + 1);
  }

  // Starred repos
  if (appState.starredSelected >= appState.starred.length) {
    appState.starredSelected = Math.max(0, appState.starred.length - 1);
  }
  if (appState.starredScroll > appState.starredSelected) {
    appState.starredScroll = appState.starredSelected;
  } else if (appState.starredScroll + reposMaxVisible <= appState.starredSelected) {
    appState.starredScroll = Math.max(0, appState.starredSelected - reposMaxVisible + 1);
  }

  // Analyze tab
  const analyzeMaxVisible = Math.max(1, Math.min(8, contentH - 4));
  if (appState.selectedRepo >= appState.searchResults.length) {
    appState.selectedRepo = Math.max(0, appState.searchResults.length - 1);
  }
  if (appState.searchScroll > appState.selectedRepo) {
    appState.searchScroll = appState.selectedRepo;
  } else if (appState.searchScroll + analyzeMaxVisible <= appState.selectedRepo) {
    appState.searchScroll = Math.max(0, appState.selectedRepo - analyzeMaxVisible + 1);
  }

  // Actions tab
  const actionsMaxVisible = Math.max(1, contentH - 2);
  if (appState.actionsView === 'repos') {
    if (appState.actionsRepoSelected >= appState.actionsRepos.length) {
      appState.actionsRepoSelected = Math.max(0, appState.actionsRepos.length - 1);
    }
    if (appState.actionsRepoScroll > appState.actionsRepoSelected) {
      appState.actionsRepoScroll = appState.actionsRepoSelected;
    } else if (appState.actionsRepoScroll + actionsMaxVisible <= appState.actionsRepoSelected) {
      appState.actionsRepoScroll = Math.max(0, appState.actionsRepoSelected - actionsMaxVisible + 1);
    }
  } else {
    if (appState.actionsSelected >= appState.actionsRuns.length) {
      appState.actionsSelected = Math.max(0, appState.actionsRuns.length - 1);
    }
    if (appState.actionsScroll > appState.actionsSelected) {
      appState.actionsScroll = appState.actionsSelected;
    } else if (appState.actionsScroll + actionsMaxVisible <= appState.actionsSelected) {
      appState.actionsScroll = Math.max(0, appState.actionsSelected - actionsMaxVisible + 1);
    }
  }

  // Inbox tab
  if (appState.selectedNotification >= appState.notifications.length) {
    appState.selectedNotification = Math.max(0, appState.notifications.length - 1);
  }
  if (appState.inboxScroll > appState.selectedNotification) {
    appState.inboxScroll = appState.selectedNotification;
  } else if (appState.inboxScroll + contentH <= appState.selectedNotification) {
    appState.inboxScroll = Math.max(0, appState.selectedNotification - contentH + 1);
  }

  // Dashboard trending. The list fills the remaining right-column height
  // (renderDashboard re-clamps with the exact per-frame window), so this
  // pre-pass only needs a generous estimate to avoid over-scrolling.
  const trendingMaxVisible = Math.max(1, H - 18);
  if (appState.trendingSelected >= appState.trending.length) {
    appState.trendingSelected = Math.max(0, appState.trending.length - 1);
  }
  if (appState.trendingScroll > appState.trendingSelected) {
    appState.trendingScroll = appState.trendingSelected;
  } else if (appState.trendingScroll + trendingMaxVisible <= appState.trendingSelected) {
    appState.trendingScroll = Math.max(0, appState.trendingSelected - trendingMaxVisible + 1);
  }

  // Settings
  if (appState.settingsCursor > appState._maxSettingsCursor) {
    appState.settingsCursor = appState._maxSettingsCursor;
  }

  render();
}

// Check if a focus zone is currently active for rendering highlight.
// Uses lazy import to avoid circular dependencies.
let _focusModule = null;
import('./focus.mjs').then(m => { _focusModule = m; }).catch(() => {});
export function isFocusActive(tabIndex, zoneId) {
  if (!_focusModule) return false;
  return _focusModule.isFocused(tabIndex, zoneId);
}

// Animated spinner frames.
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinnerIdx = 0;

export function getSpinner() {
  const a11y = typeof _isA11y === 'function' ? _isA11y() : !!appState.accessible;
  if (a11y) return '[..]';
  spinnerIdx = (spinnerIdx + 1) % SPINNER.length;
  return SPINNER[spinnerIdx];
}

export function loadingIndicator(screen, x, y, label = 'loading', style) {
  const s = style || { fg: 'cyan' };
  const a11y = typeof _isA11y === 'function' ? _isA11y() : !!appState.accessible;
  screen.writeStr(x, y, (a11y ? '[..] ' : getSpinner() + ' ') + label, s);
}

// Minimum terminal dimensions.
const MIN_W = 60;
const MIN_H = 20;

// --accessible mode flag. When set, color() returns null and any
// unicode glyphs are replaced with bracketed ASCII labels so screen
// readers and high-contrast displays get a clear text-only picture.
// Settable via appState.accessible (set by app.mjs from --accessible arg).
// P0-2 a11y heatmap char set: 5 buckets (none/light/medium/heavy/full)
// vs the unicode ░▒▓█ + space. Falls back to bracketed labels.
export function a11yHeatChar(level, accessible) {
  if (accessible) {
    return ['[ ]', '[.]', '[o]', '[O]', '[#]'][Math.max(0, Math.min(4, level))];
  }
  return [' ', '░', '▒', '▓', '█'][Math.max(0, Math.min(4, level))];
}

// Layout constants — single source of truth for the chrome heights.
export const HEADER_HEIGHT = 4;     // 3-row header + 1 separator
export const FOOTER_HEIGHT = 2;     // 1-row status + 1 separator above
export const CONTENT_PADDING = 2;

// Content area start positions per tab (used by mouse handlers).
// These are the y-offsets where the scrollable content begins, relative to row 0.
export const TAB_CONTENT_Y = {
  0: HEADER_HEIGHT + 2,  // Dashboard
  1: HEADER_HEIGHT + 2,  // Repos
  2: HEADER_HEIGHT + 2,  // Analyze
  3: HEADER_HEIGHT + 2,  // Actions
  4: HEADER_HEIGHT + 2,  // Inbox
  5: HEADER_HEIGHT + 2,  // Settings
};

// Responsive layout helpers (re-exported from layout.mjs).
export { getBreakpoint, calculateColumns, splitLayout, getResponsiveConfig, getStatCardLayout, getDetailPopupLayout } from './layout.mjs';

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
      segments.push('Explore');
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

// Draw scroll indicators at the top and/or bottom of a scrollable list.
// Shows "↑" when there's content above, "↓" when there's content below.
export function scrollIndicators(screen, topY, botY, scroll, total, pageSize) {
  if (total <= 1) return;
  const W = screen.width;
  const hasAbove = scroll > 0;
  const effectivePageSize = pageSize ?? (botY - topY + 1);
  const hasBelow = scroll + effectivePageSize < total;
  if (!hasAbove && !hasBelow) return;
  const a11y = typeof _isA11y === 'function' ? _isA11y() : !!appState.accessible;
  const up = a11y ? '^' : '↑';
  const down = a11y ? 'v' : '↓';
  const both = a11y ? '!' : '↕';
  if (topY === botY) {
    screen.writeStr(W - 2, topY, hasAbove && hasBelow ? both : hasAbove ? up : down, { dim: true });
  } else {
    if (hasAbove) screen.writeStr(W - 2, topY, up, { dim: true });
    if (hasBelow) screen.writeStr(W - 2, botY, down, { dim: true });
  }
}

// Draw skeleton placeholder bars during loading.
export function skeletonBars(screen, y, h, count = 5, barWidth = 0.4) {
  const W = screen.width;
  const bw = Math.floor(W * barWidth);
  // skeleton placeholder bars use a plain `=` stripe in
  // accessible mode (linear, no shadow look).
  const fillChar = appState.accessible ? '=' : '░';
  for (let i = 0; i < count && y + i * 2 < y + h; i++) {
    const row = y + i * 2;
    screen.writeStr(CONTENT_PADDING, row, fillChar.repeat(bw), color('dim'));
  }
}

// ── Collapsible section header ──
import { isCollapsed } from './state.mjs';

export function collapsibleHeader(screen, x, y, section, label, hint) {
  const collapsed = isCollapsed(section);
  const a11y = typeof _isA11y === 'function' ? _isA11y() : !!appState.accessible;
  const arrow = a11y ? (collapsed ? '>' : 'v') : (collapsed ? '▸' : '▾');
  const W = screen.width;
  const text = arrow + ' ' + label;
  screen.writeStr(x, y, text, { fg: 'cyan', bold: true });
  // Underline decoration after the label — cell-based so custom section
  // titles with CJK/emoji don't get overdrawn by the rule.
  const lineStart = x + displayWidth(text) + 1;
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
  const renderedY = typeof screen.mapViewportY === 'function' ? screen.mapViewportY(y) : y;
  if (renderedY >= 0) appState._sectionHeaders[section] = { x, y: renderedY, w: text.length };
  return !collapsed;
}

// Render the top header (3 rows + separator).
function renderHeader(W) {
  const titleStyle = color('title') || { fg: 'white', bold: true };
  const subtitleStyle = { dim: true };

  // check the loading watchdog BEFORE rendering the spinner so a
  // stuck operation collapses into a banner toast before painting.
  checkLoadingWatchdog();

  // P0-2 a11y swap: replace unicode glyphs with bracketed ASCII labels.
  const a11y = typeof _isA11y === 'function' ? _isA11y() : !!appState.accessible;
  const titleBullet = a11y ? '*' : '◈';
  const offlineBanner = a11y ? '[OFFLINE]' : '⚠ OFFLINE';
  const starBanner = a11y ? '[NOT SIGNED IN]' : '⚠  not signed in';

  // U4: reserve right-side widths BEFORE drawing left content.
  // Priority (high→low): offline > login > rate > cache > tip.
  // Under 80 cols hide cache stats; under 70 cols the rate bar collapses
  // to compact `API n/n` text. Identical to before at >=120 cols.
  const cacheStats = getCacheStats();
  const showCache = cacheStats.entries > 0 && W >= 80;
  const hasRate = lastRateLimit.remaining !== null && lastRateLimit.limit !== null;
  const showRateFull = hasRate && W >= 70;

  // Row 0 right item first: login.
  const login = appState.token
    ? (appState.user ? '@' + appState.user.login : (a11y ? '[loading]' : 'loading…'))
    : null;
  const loginW = login ? displayWidth(login) : 0;
  const loginX = login ? Math.max(2, W - loginW - 2) : W - 2;
  const rightReserved0 = login ? loginW + 2 : 0;

  // Row 0: app title + version (left)  |  user (right)
  screen.writeStr(2, 0, titleBullet, { fg: 'cyan', bold: true });
  screen.writeStr(4, 0, 'GitHub TUI', titleStyle);
  const version = 'v' + VERSION;
  screen.writeStr(15, 0, version, { fg: 'gray', dim: true });

  // Offline banner — shows when offline, truncated before the login reserve.
  if (offlineState.isOffline) {
    const maxOff = (login ? loginX : W - 2) - 22 - 1;
    if (maxOff > 0) {
      screen.writeStr(22, 0, truncateToWidth(offlineBanner, maxOff, ''), { fg: 'yellow', bold: true });
    }
  }

  // User greeting on the right of the top line.
  // Token is loaded synchronously in main(), so we can render synchronously:
  //   - appState.user present      → "@login"             (cyan/bold)
  //   - appState.token only        → "loading…" marker   (dim/substituted)
  //   - neither                    → no greeting          (signed-out)
  // This avoids a blank header window during the seconds-long
  // getAuthenticatedUser() roundtrip on cold boot.
  if (login) {
    const style = appState.user ? { fg: 'cyan', bold: true } : { dim: true };
    screen.writeStr(loginX, 0, login, style);
  }

  // Row 1: pre-compute right-hand texts before drawing left content.
  let cacheTxt = null;
  if (showCache) cacheTxt = '[' + cacheStats.totalKB + 'KB]';
  let rateTxt = null, rateStyle = null;
  if (hasRate) {
    const r = lastRateLimit.remaining, lim = lastRateLimit.limit;
    const remainPct = lim > 0 ? r / lim : 0;
    // Bar visualizes *consumed* quota (used = 1 - remaining), so a fresh
    // token (e.g. 4925/5000) renders nearly empty `░░░░░░░░░░` instead of a
    // misleadingly full `██████████`. Colors still key off remaining budget:
    // empty + green = healthy, full + red = exhausted.
    const usedPct = lim > 0 ? Math.min(1, Math.max(0, 1 - r / lim)) : 0;
    rateStyle = r === 0 ? { fg: 'red', bold: true }
      : remainPct < 0.1 ? { fg: 'yellow', bold: true }
      : remainPct < 0.3 ? { fg: 'yellow' }
      : { fg: 'green' };
    if (showRateFull) {
      const barWidth = 10;
      // rate-limit bar uses unicode block chars by default;
      // in --accessible mode it's a plain `[######....]` bracketed bar.
      let bar;
      if (a11y) {
        const filled = Math.round(usedPct * barWidth);
        bar = '[' + '#'.repeat(filled) + '.'.repeat(barWidth - filled) + ']';
      } else {
        const filled = Math.round(usedPct * barWidth);
        bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
      }
      rateTxt = 'API ' + bar + ' ' + r + '/' + lim;
    } else {
      rateTxt = 'API ' + r + '/' + lim;
    }
  }
  const showStar = !hasRate && !appState.token;
  // Track rightReserved so the left tagline never overlaps right badges.
  const rightReserved1 = (cacheTxt ? displayWidth(cacheTxt) + 2 : 0)
    + (rateTxt ? displayWidth(rateTxt) + 3 : 0)
    + (showStar ? displayWidth(starBanner) + 2 : 0);
  // Row 1: tagline (left, truncated to fit)  |  rate-limit + cache stats (right)
  const tagline = 'A zero-dependency terminal client for GitHub';
  const tagAvail = Math.max(0, W - 2 - rightReserved1 - 1);
  screen.writeStr(2, 1, truncateToWidth(tagline, tagAvail, ''), subtitleStyle);

  // Cache stats on the right (small, dim).
  if (cacheTxt) {
    const cx = Math.max(2, W - displayWidth(cacheTxt) - 2);
    screen.writeStr(cx, 1, cacheTxt, { dim: true });
  }

  if (rateTxt) {
    // Position before cache stats if both shown.
    const cacheW = showCache ? cacheStats.totalKB.toString().length + 8 : 0;
    const x = Math.max(2, W - displayWidth(rateTxt) - cacheW - 3);
    screen.writeStr(x, 1, rateTxt, rateStyle);
  } else if (showStar) {
    // Show "not signed in" only when the token itself is absent.
    // Previously gated on !appState.user, which is null until
    // getAuthenticatedUser() resolves — leaving a visible race where
    // authenticated users saw the warning until the API call landed.
    // Token presence is the source of truth (Settings also gates on it).
    const x = Math.max(2, W - displayWidth(starBanner) - 2);
    screen.writeStr(x, 1, starBanner, { fg: 'yellow', bold: true });
  }

  // Row 2: breadcrumb + quick hint (left)  |  loading (right)
  // Compute the right-hand width first so the breadcrumb cap never overlaps it.
  let rightW2 = 0, loadingTxt = null, tipTxt = null;
  if (appState.loading) {
    loadingTxt = getSpinner() + ' loading';
    rightW2 = displayWidth(loadingTxt) + 2;
  } else if (appState.recentRepos.length > 0 && tabState.current === 0) {
    tipTxt = 'Last visited: ' + appState.recentRepos[0].full_name;
    rightW2 = displayWidth(tipTxt) + 2;
  }
  const crumb = buildBreadcrumb();
  if (crumb.length > 0) {
    const cap = Math.max(0, Math.min(Math.floor(W * 0.6), W - 2 - rightW2 - 2));
    screen.breadcrumb(2, 2, crumb, cap);
  }
  if (loadingTxt) {
    const x = Math.max(2, W - displayWidth(loadingTxt) - 2);
    screen.writeStr(x, 2, loadingTxt, { fg: 'cyan' });
  } else if (tipTxt) {
    // Truncate the tip so it never overpaints the breadcrumb.
    const maxTip = Math.max(0, W - 2 - Math.min(Math.floor(W * 0.6), W - 4) - 3);
    const shown = maxTip > 0 ? truncateToWidth(tipTxt, Math.min(displayWidth(tipTxt), Math.max(maxTip, Math.min(displayWidth(tipTxt), W - 4))), '') : tipTxt;
    const x = Math.max(2, W - displayWidth(shown) - 2);
    screen.writeStr(x, 2, shown, { dim: true });
  }

  // Row 3: separator
  screen.hline(3, '─', { dim: true });
}

// Render the tab strip (2 rows: tab row + separator).
function renderTabStrip(y, W) {
  const tabRowY = y;
  const sepY = y + 1;
  // derived unread count via helper (still computed here for the
  // tab badge — keep the same call site so other code paths update too).
  const unreadCount = getUnreadCount();

  // Pre-compute each tab's width (proportional to label, but min-width).
  const    // render a small ⟳ chip on row 2 (right-aligned) when
    // auto-refresh is on. Replaces a stale white "loading" blink when the
    // interval is silent, giving the user a passive "data is fresh" cue.
    // (The loading text itself is already rendered from appState.loading.)
    tabW = Math.max(8, Math.floor((W - 2) / TABS.length));
  const tabXs = [];
  let cx = 1;
  for (let i = 0; i < TABS.length; i++) {
    tabXs.push(cx);
    cx += tabW;
  }

  // Per-tab hue palette (theme tokens): Dash/blue, Repos/green,
  // Explore/purple, Actions/yellow, Inbox/orange, Settings/teal.
  const iconHues = [
    color('accent'), color('success'), color('trending'),
    color('warning'), color('unread'), color('fork'),
  ];

  TABS.forEach((tab, i) => {
    const isActive = i === tabState.current;
    const bx = tabXs[i];
    const label = tab.label;
    const key = tab.key;

    // Active tab gets the full-band selection chip; inactive tabs keep a
    // transparent band and emphasize the number instead. All colors come
    // from the theme (tabActive / tabInactive / accent / breadcrumbSep),
    // so custom themes drive the nav too.
    if (isActive) {
      for (let xx = bx; xx < bx + tabW && xx < W - 1; xx++) {
        screen.styleBuf[tabRowY][xx] = color('tabActive');
      }
    } else {
      for (let xx = bx; xx < bx + tabW && xx < W - 1; xx++) {
        screen.styleBuf[tabRowY][xx] = { dim: true };
      }
    }

    // Tab text: colored icon chip + dim label; the active tab renders on
    // the selection chip with a leading ▸ pointer. On narrow terminals the
    // icon is dropped per-tab so labels never clip into the divider.
    // In --accessible mode icons are always skipped (same narrow path).
    const tx = bx + 1;
    const a11y = typeof _isA11y === 'function' ? _isA11y() : !!appState.accessible;
    const kt = '[' + key + ']' + (tabW >= 14 && !a11y ? ' ' + TAB_ICONS[i] : '');
    const lt = ' ' + label;
    const text = isActive ? '▸ ' + kt + lt : kt + lt;
    if (isActive) {
      screen.writeStr(tx, tabRowY, text, color('tabActive'));
    } else {
      screen.writeStr(tx, tabRowY, kt, { ...iconHues[i], bold: true });
      screen.writeStr(tx + kt.length, tabRowY, lt, color('tabInactive'));
    }

    // Badge for inbox with unread items.
    if (i === 4 && unreadCount > 0) {
      const badgeText = ' ' + (unreadCount > 99 ? '99+' : String(unreadCount)) + ' ';
      const bx2 = bx + tabW - badgeText.length - 1;
      if (bx2 >= tx + text.length + 1) {
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
      screen.setCell(xx, sepY, '━', { ...color('accent'), bold: true });
    }
  }
}

// Render the bottom status bar (1 row + separator above).
//
// Draw the modal-input prompt line (footer). Also re-invoked after the
// overlay pass so the prompt stays legible on top of the issue/PR detail
// popup's full-screen backdrop.
function renderFooterInput(screen, statusY, W) {
  screen.fillRow(statusY, ' ', color('statusBar'));
  const buf = Array.from(appState.inputBuffer);
  const cursor = appState.inputCursor != null ? appState.inputCursor : buf.length;
  const shown = appState.inputMask
    ? Array.from('•'.repeat(buf.length)) : buf;
  // Insert cursor character at the correct code-point position.
  const before = shown.slice(0, cursor).join('');
  const after = shown.slice(cursor).join('');
  // input cursor uses a plain '_' in --accessible mode.
  const cursorChar = appState.accessible ? '_' : '█';
  const line = appState.inputPrompt + before + cursorChar + after;
  screen.writeStr(1, statusY, truncateToWidth(line, W - 2, ''), color('inputBox'));
}

function renderFooter(W, H) {
  const sepY = H - FOOTER_HEIGHT;
  const statusY = sepY + 1;
  // Separator
  screen.hline(sepY, '─', { dim: true });

  const statusStyle = color('statusBar');
  screen.fillRow(statusY, ' ', statusStyle);

  if (appState.inputMode === 'input') {
    renderFooterInput(screen, statusY, W);
    return;
  }

  // Toast message — prominent with icon.
  if (appState.message) {
    const a11y = !!appState.accessible;
    const icon = a11y ? {
      info: '[i]', success: '[OK]', error: '[ERR]', warning: '[!]',
    }[appState.message.type] || '[i]' : (appState.message.icon || 'ⓘ');
    const typeStyles = {
      info:    color('toastInfo'),
      success: color('toastSuccess'),
      error:   color('toastError'),
      warning: color('toastWarning'),
    };
    const style = typeStyles[appState.message.type] || statusStyle;
    let txt = ' ' + icon + '  ' + appState.message.text;
    // reserve the trailing "[r] to retry" affordance BEFORE truncating
    // the message body, so the keyboard hint is never visually clipped at
    // narrow terminal widths. Without this, W-2 truncation shortens the
    // message text instead of dropping the affordance — defeating discoverability.
    const hasRetry = appState._retryFn && typeof appState._retryFn === 'function'
        && Date.now() < appState._retryExpiresAt;
    const retrySuffix = hasRetry ? '   [r] to retry' : '';
    const reserve = retrySuffix.length;
    screen.writeStr(1, statusY,
      truncateToWidth(txt, Math.max(0, W - 2 - reserve), '') + retrySuffix, style);
    return;
  }

  // Default: context-aware key hint line.
  const hint = statusLine();
  if (hint) {
    const tabLabel = TABS[tabState.current]?.label || '';
    screen.writeStr(2, statusY, tabLabel, { fg: 'cyan', bold: true });
    screen.writeStr(2 + displayWidth(tabLabel) + 1, statusY, '│', { dim: true });
    screen.writeStr(2 + displayWidth(tabLabel) + 3, statusY, truncateToWidth(hint, W - displayWidth(tabLabel) - 8, ''), color('repoName') || { fg: 'white' });
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
      const cardsHint = appState.dashboardCardsFocus ? sep + '[←→] Cards' : '';
      return ' [Tab] Widgets' + sep + '[Enter] Open' + sep + '[t] Trend' + sep + '[/] Filter' + sep + '[l] Local' + sep + '[r] Refresh' + sep + '[?] Help' + cardsHint;
    }
    case 1: {
      if (appState.reposView === 'starred') {
        return ' [Esc] Back   [↑↓jk] Nav   [Enter] Explore   [V] Own repos   [?] Help';
      }
      return ' [/] Filter' + sep + '[t] Type' + sep + '[L] Language' + sep + '[x] Stale' + sep + '[D] Density' + sep + '[P] Pin' + sep + '[V] Starred' + sep + '[c] Clear';
    }
    case 2: {
      const v = appState.analyzeView;
      if (v === 'search')  return ' [i] Search public repo' + sep + '[?] Help' + sep + '[Ctrl-P] Palette';
      if (v === 'results') return ' [↑↓jk] Nav' + sep + '[Enter] View' + sep + '[Space] More' + sep + '[Esc] Back';
      if (v === 'details') {
        if (appState.detailsPane === 'security') return ' [1-6] Security panes' + sep + '[s] severity' + sep + '[f] state' + sep + '[Enter] Open' + sep + '[Esc] Back';
        return ' [O]v [i]ssues [P]Rs [R]eadme [F]iles [A] Packages [T]raffic [K]hecks [S]ecurity [D]iff';
      }
      if (v === 'forks')   return ' [↑↓jk] Nav' + sep + '[Space] More' + sep + '[p/s/n] Sort' + sep + '[Esc] Back';
      return '';
    }
    case 3: {
      if (appState.actionsView === 'runs') {
        return ' [Enter] Expand' + sep + '[o] Browser' + sep + '[r] Re-run' + sep + '[x] Cancel' + sep + '[l] Log' + sep + '[d] Dispatch' + sep + '[Esc] Back' + sep + '[?] Help';
      }
      return ' [↑↓jk] Nav' + sep + '[Enter] View runs' + sep + '[/] Filter' + sep + '[F] Failures' + sep + '[R] Rescan' + sep + '[?] Help';
    }
    case 4: return ' [↑↓jk] Nav' + sep + '[Enter] Open' + sep + '[m] Read' + sep + '[M] All' + sep + '[f] Filter' + sep + '[H] Hide processed' + sep + '[u] Unsubscribe';
    case 5: return ' [↑↓] Nav' + sep + '[Enter] Select' + sep + '[s] Star repo' + sep + '[c] Clear account cache' + sep + '[?] Help';
  }
  return '';
}

function renderCompact(W, H) {
  const labels = ['Dash', 'Repos', 'Explore', 'Actions', 'Inbox', 'Settings'];
  screen.writeStr(1, 0, 'GitHub TUI', { fg: 'cyan', bold: true });
  const tabs = labels.map((label, i) => (i === tabState.current ? '[' + (i + 1) + ']' : String(i + 1)) + label[0]).join(' ');
  screen.writeStr(1, 1, truncate(tabs, W - 2), { fg: 'white', bold: true });
  screen.hline(2, '─', { dim: true });
  const title = labels[tabState.current] || 'View';
  screen.writeStr(1, 4, title + (appState.loading ? ' …' : ''), { fg: 'cyan', bold: true });
  const context = appState.repoDetails?.full_name || appState.user?.login ||
    (appState.message && appState.message.text) || 'Use number keys to switch tabs';
  screen.writeStr(1, 6, truncate(context, W - 2), { dim: true });
  screen.writeStr(1, H - 2, '[1-6] tabs  [q] quit  [?] help', { dim: true });
  screen.hline(H - 1, '─', { dim: true });
}

function renderLinear(W, H) {
  const labels = ['Dashboard', 'Repositories', 'Explore', 'Actions', 'Inbox', 'Settings'];
  const title = labels[tabState.current] || 'View';
  screen.writeStr(0, 0, 'GitHub TUI — ' + title, { bold: true });
  screen.writeStr(0, 1, 'Breadcrumb: ' + buildBreadcrumb().join(' > '), { dim: true });
  screen.writeStr(0, 2, appState.loading ? 'Status: loading' : appState.message ? 'Status: ' + appState.message.text : 'Status: ready', { dim: true });
  const lines = [];
  if (!appState.token) lines.push('Not signed in. Open Settings and choose Login.');
  else if (tabState.current === 0) {
    lines.push('User: @' + (appState.user?.login || 'unknown'));
    lines.push('Repositories: ' + appState.repos.length);
    lines.push('Unread notifications: ' + getUnreadCount());
    for (const item of (appState.dashboardAttentionItems || [])) lines.push('Attention: ' + item.label + ' (' + item.count + ')');
  } else if (tabState.current === 1) {
    for (const repo of appState.repos.slice(0, Math.max(1, H - 7))) lines.push((repo.full_name || '?') + ' — ' + (repo.description || ''));
  } else if (tabState.current === 2) {
    lines.push('Search: ' + (appState.searchQuery || '(none)'));
    for (const repo of (appState.searchResults || []).slice(0, Math.max(1, H - 7))) lines.push((repo.full_name || '?') + ' — ' + (repo.description || ''));
  } else if (tabState.current === 3) {
    for (const run of (appState.actionsRuns || []).slice(0, Math.max(1, H - 7))) lines.push((run.name || '?') + ' #' + (run.run_number || run.id || '?') + ' ' + (run.conclusion || run.status || ''));
  } else if (tabState.current === 4) {
    for (const note of (appState.notifications || []).slice(0, Math.max(1, H - 7))) lines.push((note.unread ? '[unread] ' : '') + (note.repository?.full_name || '?') + ' — ' + (note.subject?.title || ''));
  } else lines.push('Settings menu. Use arrow keys and Enter.');
  for (let i = 0; i < Math.min(lines.length, H - 5); i++) screen.writeStr(0, 4 + i, truncateToWidth(lines[i], W, ''), null);
  screen.writeStr(0, H - 2, '[↑↓] navigate  [Enter] select  [1-6] tabs  [q] quit  [?] help', { dim: true });
  screen.hline(H - 1, '─', { dim: true });
}

function doRender() {
  if (!screen) return;
  const W = screen.width;
  const H = screen.height;
  // Buffer is already clear from the previous render's swap — no clear() needed.
  appState._sectionHeaders = {};

  if (appState.linearAccessibility && W >= 40 && H >= 10) {
    renderLinear(W, H);
    screen.render();
    return;
  }

  // ── Compact terminal mode ──
  if (W >= 40 && H >= 12 && (W < MIN_W || H < MIN_H)) {
    renderCompact(W, H);
    screen.render();
    return;
  }

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
      && !appState.showOnboarding && !appState.showWelcome && tabState.current !== 0) {
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

  // ── Overlays (rendered last, on top; later = on top) ──
  if (appState.showDetail) renderDetail(screen);
  if (appState.showOnboarding) renderOnboarding(screen);
  if (appState.showWelcome) renderOnboarding(screen, { welcomeMode: true });
  if (appState.showHelp) help.render(screen);
  // Confirm + typed input sit ABOVE the detail popup: detail actions
  // (c/r/x/M/...) open them while showDetail stays true, and renderDetail
  // paints a full-screen backdrop that would otherwise hide them.
  if (appState.confirmAction) renderConfirmDialog(screen);
  if (appState.showPalette) renderPalette(screen);
  if (appState.showBookmarks) renderBookmarksOverlay(screen);
  // Redraw the input prompt on top of the detail popup's backdrop.
  if (appState.inputMode === 'input') {
    renderFooterInput(screen, H - FOOTER_HEIGHT + 1, W);
  }

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
      const urlSnippet = b.url ? truncate(b.url.replace(/^https?:\/\//, ''), 24) : '';
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
