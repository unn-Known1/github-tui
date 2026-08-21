// Mouse support — parse terminal mouse events and dispatch to handlers.

import { appState, tabState, setTab, render, TABS, toggleCollapse, showMessage, upsertEntity } from './state.mjs';
import { getScreen, HEADER_HEIGHT, TAB_CONTENT_Y, getStatCardLayout } from './render.mjs';
import { setTheme } from './theme.mjs';
import { openUrl, copyToClipboard, getClipboardTempFilePath, getLastClipboardMethod, wrapTextWithMap, sliceByDisplayColumns } from './utils.mjs';
import { dismissConfirm } from './state.mjs';
import * as analyze from './tabs/analyze.mjs';
import * as detail from './tabs/detail.mjs';
import * as repos from './tabs/repos.mjs';
import * as dashboard from './tabs/dashboard.mjs';
import * as settings from './tabs/settings.mjs';
import * as inbox from './tabs/inbox.mjs';
import { focusDashboardZone } from './focus.mjs';

// ── Text-selection helpers for README / file viewer ──

const TEXT_SEL_PANE_Y = TAB_CONTENT_Y[2] + 3; // pane-tabs row (9)
const TEXT_SEL_CONTENT_Y = TEXT_SEL_PANE_Y + 1; // first content row (10) — sy is 0-based (col-1, row-1)

// Map a screen coordinate (sx, sy) to a visual-row/col inside the active
// text-selection pane (readme or file), or null if the click is outside.
// scroll is compensated so clicking on a scrolled-down line lands on the
// correct visual row rather than an offset one.
function mapTextSelCoords(sx, sy) {
  const t = tabState.current;
  if (t !== 2 || appState.analyzeView !== 'details') return null;

  const screen = getScreen();
  if (!screen) return null;
  const W = screen.width;

  if (appState.detailsPane === 'readme') {
    if (sy < TEXT_SEL_CONTENT_Y) return null;
    const row = (sy - TEXT_SEL_CONTENT_Y) + (appState.detailsScroll || 0);
    const col = Math.max(0, sx - 2);
    return { mode: 'readme', row, col };
  }

  if (appState.detailsPane === 'files' && appState.fileViewing) {
    if (sy < TEXT_SEL_CONTENT_Y) return null;
    const row = (sy - TEXT_SEL_CONTENT_Y) + (appState.fileScroll || 0);
    // File viewer: col offset = 4 (left pad) + lineNumW + 1 (gutter) + 3 (after │).
    const logicalLines = (appState.fileText || '').split(/\r?\n/);
    const lineNumW = String(logicalLines.length).length;
    const col = Math.max(0, sx - (4 + lineNumW + 3));
    return { mode: 'file', row, col };
  }

  return null;
}

function applyTextSel(mode, row, col, isClick = false) {
  appState.textSelectionMode = mode;
  // On a fresh click (not a drag extension), always reset the start point so
  // the user can start a new selection from anywhere without dragging backwards.
  if (isClick || !appState.textSelectStart) {
    appState.textSelectStart = { row, col };
  }
  appState.textSelectEnd = { row, col };
  render();
}

function clearTextSel() {
  appState.textSelectionMode = 'none';
  appState.textSelectStart = null;
  appState.textSelectEnd = null;
  render();
}

// Extract the selected text region from mode-specific state and return it as a
// single string. Returns null if there is no valid selection.
export function getSelectedText() {
  const mode = appState.textSelectionMode;
  const selStart = appState.textSelectStart;
  const selEnd = appState.textSelectEnd;
  if (!selStart || !selEnd || mode === 'none') return null;

  // Normalise so (sr,sc) <= (er,ec).
  let sr = selStart.row, sc = selStart.col;
  let er = selEnd.row,   ec = selEnd.col;
  if (er < sr || (er === sr && ec < sc)) { [sr, er] = [er, sr]; [sc, ec] = [ec, sc]; }

  const screen = getScreen();
  if (!screen) return null;
  const W = screen.width;

  if (mode === 'readme') {
    const innerW = Math.max(20, W - 6);
    const raw = appState._readmeText || '';
    const { lines } = wrapTextWithMap(raw, innerW);
    let out = '';
    for (let r = sr; r <= er; r++) {
      if (r < 0 || r >= lines.length) continue;
      const ln = lines[r];
      if (r === sr && r === er) {
        out += sliceByDisplayColumns(ln, sc, ec);
      } else if (r === sr) {
        out += sliceByDisplayColumns(ln, sc) + '\n';
      } else if (r === er) {
        out += sliceByDisplayColumns(ln, 0, ec);
      } else {
        out += ln + '\n';
      }
    }
    return out || null;
  }

  if (mode === 'file') {
    const text = appState.fileText || '';
    const logicalLines = text.split(/\r?\n/);
    const { lines: visualLines, visualToLogical } = wrapTextWithMap(text, Math.max(10, W - 8 - String(logicalLines.length).length));
    let out = '';
    for (let vr = sr; vr <= er; vr++) {
      if (vr < 0 || vr >= visualLines.length) continue;
      const ln = visualLines[vr];
      if (vr === sr && vr === er) {
        out += sliceByDisplayColumns(ln, sc, ec);
      } else if (vr === sr) {
        out += sliceByDisplayColumns(ln, sc) + '\n';
      } else if (vr === er) {
        out += sliceByDisplayColumns(ln, 0, ec);
      } else {
        out += ln + '\n';
      }
    }
    return out || null;
  }

  return null;
}

export async function copySelectedText() {
  const text = getSelectedText();
  if (!text) {
    showMessage('No text selected', 'warning');
    return false;
  }
  if (copyToClipboard(text)) {
    const method = getLastClipboardMethod();
    const tmpFile = getClipboardTempFilePath();
    if (method === 'tmux') {
      showMessage('Copied ' + text.length + ' chars — tmux buffer (Ctrl+B [ to view)', 'success');
    } else if (tmpFile) {
      showMessage('Saved ' + text.length + ' chars to ' + tmpFile, 'info');
    } else {
      showMessage('Copied ' + text.length + ' chars to clipboard', 'success');
    }
  } else {
    showMessage('Copy failed', 'error');
  }
  return true;
}

export async function selectAllAndCopy() {
  const mode = appState.textSelectionMode;
  if (mode === 'none') return false;
  const screen = getScreen();
  if (!screen) return false;
  const W = screen.width;
  let text = '';
  let totalRows = 0;
  let maxCol = W;

  if (mode === 'readme') {
    const innerW = Math.max(20, W - 6);
    const raw = appState._readmeText || '';
    try {
      const { wrapTextWithMap } = await import('./utils.mjs');
      const wrapped = wrapTextWithMap(raw, innerW);
      text = wrapped.lines.join('\n');
      totalRows = wrapped.lines.length;
      maxCol = innerW;
    } catch {
      text = raw;
      totalRows = raw.split(/\r?\n/).length;
      maxCol = innerW;
    }
  } else if (mode === 'file') {
    text = appState.fileText || '';
    const logicalLines = text.split(/\r?\n/);
    totalRows = logicalLines.length;
    const lineNumW = String(logicalLines.length).length;
    maxCol = Math.max(10, W - 8 - lineNumW);
  }

  // Select entire text: (0, 0) to (lastRow, maxCol).
  appState.textSelectStart = { row: 0, col: 0 };
  appState.textSelectEnd = { row: Math.max(0, totalRows - 1), col: maxCol };
  render();

  // Auto-copy the full text.
  if (text && copyToClipboard(text)) {
    const method = getLastClipboardMethod();
    const tmpFile = getClipboardTempFilePath();
    if (method === 'tmux') {
      showMessage('Copied all text — tmux buffer (Ctrl+B [ to view)', 'success');
    } else if (tmpFile) {
      showMessage('Saved all text to ' + tmpFile, 'info');
    } else {
      showMessage('Copied all text to clipboard', 'success');
    }
  } else {
    showMessage('Copy failed — text may be too large', 'warning');
  }
  return true;
}

export function enableMouse() {
  process.stdout.write('\x1b[?1000h');
  process.stdout.write('\x1b[?1002h');
  process.stdout.write('\x1b[?1006h');
}

export function disableMouse() {
  process.stdout.write('\x1b[?1006l');
  process.stdout.write('\x1b[?1002l');
  process.stdout.write('\x1b[?1000l');
}

// Parse a mouse event from raw input data.
// Returns { button, col, row, pressed } or null if not a mouse event.
// NOTE: col/row are 1-based terminal coordinates.
export function parseMouseEvent(data) {
  if (!data) return null;

  // SGR format: \x1b[<button;col;rowM (press) / m (release)
  const sgr = data.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
  if (sgr) {
    return {
      button: parseInt(sgr[1], 10),
      col: parseInt(sgr[2], 10),
      row: parseInt(sgr[3], 10),
      pressed: sgr[4] === 'M',
    };
  }

  // Legacy X10 format: \x1b[M<b+32><c+32><r+32>
  const x10 = data.match(/\x1b\[M(.{3})/s);
  if (x10) {
    return {
      button: x10[1].charCodeAt(0) - 32,
      col: x10[1].charCodeAt(1) - 32,
      row: x10[1].charCodeAt(2) - 32,
      pressed: true,
    };
  }

  return null;
}

export function handleMouseEvent(event) {
  if (!event) return;

  const { button, col, row, pressed } = event;

  // Motion (button 32–63) — live hover selection on lists + text selection drag.
  if (button >= 32 && button < 64) {
    const sx = col - 1;
    const sy = row - 1;
    const t = tabState.current;

    // Text selection drag in README / file viewer.
    if (t === 2 && appState.analyzeView === 'details' &&
        (appState.detailsPane === 'readme' || (appState.detailsPane === 'files' && appState.fileViewing))) {
      const coords = mapTextSelCoords(sx, sy);
      if (coords) {
        applyTextSel(coords.mode, coords.row, coords.col, false);
        return;
      }
      // Clicked outside the text area while dragging — clear selection.
      if (appState.textSelectionMode !== 'none') {
        clearTextSel();
        return;
      }
    }

    // Dashboard trending list.
    if (t === 0 && inTrendingSection(sx, sy)) {
      const th = appState._sectionHeaders['dashboard:trending'];
      if (th && th.y > 0 && sy > th.y) {
        const listIdx = sy - th.y - 1;
        const absIdx = listIdx + appState.trendingScroll;
        if (absIdx >= 0 && absIdx < appState.trending.length && absIdx !== appState.trendingSelected) {
          appState.trendingSelected = absIdx;
          render();
        }
      }
    }

    // Repos tab list.
    if (t === 1) {
      const rowOff = appState.reposView === 'starred' ? TAB_CONTENT_Y[1] + 3 : TAB_CONTENT_Y[1] + 6;
      if (sy >= rowOff) {
        const listIdx = sy - rowOff;
        const scroll = appState.reposView === 'starred' ? appState.starredScroll : appState.repoScroll;
        const absIdx = listIdx + scroll;
        const maxLen = appState.reposView === 'starred' ? appState.starred.length : (appState._filteredReposCount || appState.repos.length);
        if (absIdx >= 0 && absIdx < maxLen) {
          if (appState.reposView === 'starred') {
            if (absIdx !== appState.starredSelected) { appState.starredSelected = absIdx; render(); }
          } else {
            if (absIdx !== appState.repoSelected) { appState.repoSelected = absIdx; render(); }
          }
        }
      }
    }

    // Inbox tab list. Use the exact geometry published by renderInbox.
    if (t === 4) {
      const bounds = appState._inboxListBounds;
      if (bounds && sy >= bounds.rowStart && sy < bounds.rowStart + bounds.maxRows) {
        const absIdx = sy - bounds.rowStart + appState.inboxScroll;
        const filteredLen = inbox.getFilteredNotifications().length;
        if (absIdx >= 0 && absIdx < filteredLen && absIdx !== appState.selectedNotification) {
          appState.selectedNotification = absIdx;
          inbox.normalizeInboxCursor();
          render();
        }
      }
    }

    // Actions tab list. Renderers publish separate origins because the repo
    // list and workflow-run list have different headers/offsets.
    if (t === 3) {
      const bounds = appState._actionsListBounds;
      if (bounds && sy >= bounds.rowStart && sy < bounds.rowStart + bounds.maxRows) {
        const absIdx = sy - bounds.rowStart + bounds.scroll;
        if (appState.actionsView === 'repos') {
          const reposList = appState.actionsFilter
            ? appState.actionsRepos.filter(r => (r.full_name || '').toLowerCase().includes(appState.actionsFilter.toLowerCase()))
            : appState.actionsRepos;
          if (absIdx >= 0 && absIdx < reposList.length && absIdx !== appState.actionsRepoSelected) {
            appState.actionsRepoSelected = absIdx;
            render();
          }
        } else if (absIdx >= 0 && absIdx < appState.actionsRuns.length && absIdx !== appState.actionsSelected) {
          appState.actionsSelected = absIdx;
          render();
        }
      }
    }

    return;
  }

  // Scroll wheel — pass position so handlers can scope by section.
  if (button === 64) { scrollUp(col - 1, row - 1); return; }
  if (button === 65) { scrollDown(col - 1, row - 1); return; }

  // Click — only left button presses.
  if (button === 0 && pressed) {
    const sx = col - 1;
    const sy = row - 1;
    // Text selection click: start a fresh selection (reset both endpoints)
    // when clicking inside README or file-viewer areas.
    const t = tabState.current;
    if (t === 2 && appState.analyzeView === 'details' &&
        (appState.detailsPane === 'readme' || (appState.detailsPane === 'files' && appState.fileViewing))) {
      const coords = mapTextSelCoords(sx, sy);
      if (coords) {
        applyTextSel(coords.mode, coords.row, coords.col, true);
        return;
      }
    }
    handleClick(col, row);
  }
}

// route clicks to the active overlay before they fall through to
// the underlying tab handler. Clicks outside any open overlay → handleClick's
// normal dispatch. Clicks inside an overlay → consumed (or worse, leak
// through to the tab rendering underneath — a real bug pre-fix).
function _dispatchOverlayClick(sx, sy) {
  if (appState.showPalette)   { _clickPalette(sx, sy);   return true; }
  if (appState.showHelp)      { _clickHelp(sx, sy);      return true; }
  if (appState.showBookmarks) { _clickBookmarks(sx, sy); return true; }
  if (appState.confirmAction) { _clickConfirm(sx, sy);   return true; }
  if (appState.showOnboarding || appState.showWelcome) { return true; } // swallow
  return false;
}

function _clickPalette(sx, sy) {
  // Click on a row → select + exec. Click outside the box → close.
  const W = getScreen() ? getScreen().width : 80;
  const H = getScreen() ? getScreen().height : 24;
  const boxW = Math.min(80, W - 4);
  const boxH = Math.min(18, H - 4);
  const x0 = Math.floor((W - boxW) / 2);
  const y0 = Math.floor((H - boxH) / 2);
  const inside = sx >= x0 && sx < x0 + boxW && sy >= y0 && sy < y0 + boxH;
  if (!inside) {
    import('./palette.mjs').then(m => m.close()).catch(() => {});
    return;
  }
  // Compute the row index from sy. Items list starts at y0+3; first row
  // has scroll offset 0. Picking the row matching sy aligns the click
  // with what the user actually clicked rather than the cursor row.
  const itemY = sy - (y0 + 3);
  const maxVisible = boxH - 5;
  let scrollOff = 0;
  if (typeof appState.paletteCursor === 'number' && appState.paletteCursor >= maxVisible) {
    scrollOff = appState.paletteCursor - maxVisible + 1;
  }
  const rowIdx = itemY + scrollOff;
  if (itemY >= 0 && itemY < maxVisible) {
    appState.paletteCursor = rowIdx;
    render();
  }
  import('./palette.mjs').then(m => m.execSelected()).catch(() => {});
}

function _clickHelp(sx, sy) {
  const W = getScreen() ? getScreen().width : 80;
  const H = getScreen() ? getScreen().height : 24;
  const boxW = Math.min(78, W - 4);
  const boxH = Math.min(H - 4, 28);
  const x0 = Math.floor((W - boxW) / 2);
  const y0 = Math.floor((H - boxH) / 2);
  const inside = sx >= x0 && sx < x0 + boxW && sy >= y0 && sy < y0 + boxH;
  if (!inside) {
    appState.showHelp = false;
    render();
  }
}

function _clickBookmarks(sx, sy) {
  const W = getScreen() ? getScreen().width : 80;
  const H = getScreen() ? getScreen().height : 24;
  const boxW = Math.min(72, W - 4);
  const boxH = Math.min(20, H - 4);
  const x0 = Math.floor((W - boxW) / 2);
  const y0 = Math.floor((H - boxH) / 2);
  const inside = sx >= x0 && sx < x0 + boxW && sy >= y0 && sy < y0 + boxH;
  if (!inside) {
    import('./bookmarks.mjs').then(m => m.closeBookmarks()).catch(() => {});
  }
}

function _clickConfirm(sx, sy) {
  // Confirm has only y/n — clicks anywhere dismiss.
  // (Esc-outside / click-outside dismissal is the user-friendly default.)
  if (typeof dismissConfirm === 'function') dismissConfirm();
}

// ── Coordinate conversion ────────────────────────────────────
// Terminal sends 1-based col/row.  Convert to 0-based screen
// coordinates (sx, sy) at the top of handleClick, then every
// downstream function works in screen coords.

function handleClick(col, row) {
  const sx = col - 1;
  const sy = row - 1;

  // route clicks to active overlays FIRST so they don't leak through
  // to the underlying tab handler.
  if (_dispatchOverlayClick(sx, sy)) return;

  // Detail popup is open — handle interactive elements or close on outside click.
  if (appState.showDetail) {
    const screen = getScreen();
    if (!screen) return;
    const W = screen.width;
    const H = screen.height;
    const boxW = Math.min(100, W - 4);
    const boxH = H - 4;
    const bx = Math.floor((W - boxW) / 2);
    const by = 2;
    const inside = sx >= bx && sx < bx + boxW && sy >= by && sy < by + boxH;
    if (!inside) {
      detail.closeDetail();
      return;
    }
    // Click inside — handle interactive elements, then swallow.
    if (!appState.detailLoading && appState.detailData) {
      const innerX = bx + 2;
      const tabY = by + 3;

      // ── Action buttons (right-aligned) on the tab/action row ──
      if (sy === tabY) {
        const data = appState.detailData;
        const actions = ['c Comment', 'r React'];
        if (appState.detailType === 'pull_request' && data.mergeable) actions.push('M Merge');
        if (data.state === 'open') actions.push('x Close');
        else actions.push('x Reopen');
        let ax = bx + boxW - 2;
        for (let i = actions.length - 1; i >= 0; i--) {
          ax -= actions[i].length + 1;
          if (sx >= ax && sx < ax + actions[i].length) {
            if (actions[i] === 'c Comment') detail.openCommentInput();
            else if (actions[i] === 'r React') detail.toggleReactionPicker();
            else if (actions[i] === 'M Merge') detail.mergePR();
            else detail.closeOrReopen();
            return;
          }
        }

        // ── Detail pane tabs (left-aligned) on the same row ──
        const tabs = [['body', 'Body'], ['comments', 'Comments (' + appState.detailComments.length + ')']];
        if (appState.detailType === 'pull_request') {
          tabs.push(['reviews', 'Reviews (' + appState.detailReviews.length + ')']);
          tabs.push(['files', 'Files (' + appState.detailFiles.length + ')']);
        }
        let tx = innerX;
        for (const [id, label] of tabs) {
          const isActive = appState.detailTab === id;
          const text = isActive ? ' [' + label + '] ' : '  ' + label + '  ';
          if (sx >= tx && sx < tx + text.length) {
            if (!isActive) {
              appState.detailTab = id;
              appState.detailScroll = 0;
              appState.detailFileCursor = 0;
              render();
            }
            return;
          }
          tx += text.length;
        }
      }

      // ── File list item click (select file) ──
      if (appState.detailTab === 'files' && !appState.detailDiffView) {
        const contentY = tabY + 2;
        const files = appState.detailFiles;
        if (files.length > 0 && sy >= contentY) {
          const idx = sy - contentY + appState.detailScroll;
          if (idx >= 0 && idx < files.length) {
            appState.detailFileCursor = idx;
            render();
            return;
          }
        }
      }
    }
    return; // Swallow all inside-popup clicks
  }

  // Tab bar at screen row HEADER_HEIGHT (4).
  if (sy === HEADER_HEIGHT) {
    handleTabClick(sx);
    return;
  }

  // Pane tabs at screen row HEADER_HEIGHT + 5 (9), analyze only.
  if (sy === TAB_CONTENT_Y[2] + 3 && tabState.current === 2) {
    handlePaneTabClick(sx);
    return;
  }

  // Security sub-pane tabs — dynamic Y stored during render.
  if (tabState.current === 2 && appState.analyzeView === 'details' && appState.detailsPane === 'security') {
    const subTab = appState._securitySubTabBounds;
    if (subTab && sy === subTab.y) {
      for (const b of subTab.bounds) {
        if (sx >= b.x1 && sx < b.x2) {
          appState.securitySubPane = b.pane;
          appState.securityAlertCursor = 0;
          appState.securityAlertScroll = 0;
          analyze.loadSecurity();
          render();
          return;
        }
      }
    }
  }

  // Collapsible section headers — check exact arrow position.
  if (handleCollapsibleClick(sx, sy)) return;

  // Log click for double-click detection on dashboard trending.
  if (tabState.current === 0 && appState._lastClickTime) {
    const now = Date.now();
    if (now - appState._lastClickTime < 400 && appState._lastClickX === sx && appState._lastClickY === sy) {
      // Double click — open trending repo or stat card
      if (handleDblClick(sx, sy)) { appState._lastClickTime = 0; return; }
    }
    appState._lastClickTime = now;
    appState._lastClickX = sx;
    appState._lastClickY = sy;
  } else {
    appState._lastClickTime = Date.now();
    appState._lastClickX = sx;
    appState._lastClickY = sy;
  }

  // Content-area click (list items, stat cards, etc.).
  handleContentClick(sx, sy);
}

function handleDblClick(sx, sy) {
  const screen = getScreen();
  if (!screen) return false;
  const W = screen.width, H = screen.height;
  const y = TAB_CONTENT_Y[0];
  const h = H - HEADER_HEIGHT - 2 - 2;
  const cardLayout = getStatCardLayout(W, 5);
  const cardW = cardLayout.cardWidth;
  const gap = cardLayout.gap;
  const cardsPerRow = cardLayout.cardsPerRow;
  const cardY = y + 3;
  const cardRows = Math.ceil(5 / cardsPerRow);
  const cardH = 4;
  const bodyY = cardY + cardRows * (cardH + 1) + 1;
  const splitX = Math.floor(W / 2);
  const rightX = splitX + 2;

  // Double-click stat card → drill in
  if (sy >= cardY && sy < cardY + cardRows * (cardH + 1)) {
    const row = Math.floor((sy - cardY) / (cardH + 1));
    const col = Math.floor((sx - cardLayout.startX) / (cardW + gap));
    const cardIndex = row * cardsPerRow + col;
    if (cardIndex === 4) {
      // Stale → repos with stale filter
      setTab(1);
      appState.reposView = 'own';
      appState.repoStaleOnly = true;
      appState.repoScroll = 0;
      appState.repoSelected = 0;
      showMessage('Showing stale repos', 'info');
      render();
      return true;
    }
    if (cardIndex === 0 || cardIndex === 1) {
      setTab(1);
      render();
      return true;
    }
    return false;
  }

  // Double-click trending repo → open in Analyze
  if (sx >= rightX && sy >= bodyY) {
    const th = appState._sectionHeaders['dashboard:trending'];
    if (th && th.y > 0 && sy > th.y) {
      const listIdx = sy - th.y - 1;
      const filtered = dashboard.getFilteredTrending();
      const absIdx = listIdx + appState.trendingScroll;
      if (absIdx >= 0 && absIdx < filtered.length) {
        const r = filtered[absIdx];
        if (r && r.full_name) {
          const [owner, name] = r.full_name.split('/');
          setTab(2);
          analyze.loadRepoDetails(owner, name);
          return true;
        }
      }
    }
  }

  // Double-clicking a Dashboard list item opens the same destination as
  // keyboard Enter. Coordinate lookup uses rendered section headers so it
  // remains correct while the Dashboard body is scrolled.
  if (sx >= rightX && sy >= bodyY) {
    const bodyRows = Math.max(1, H - 17);
    const lists = [
      { key: 'attention', zone: 'attention', items: dashboard.getNeedsAttention(), scroll: appState.dashboardAttentionScroll, max: 4, selected: 'dashboardAttentionSelected' },
      { key: 'recentActivity', zone: 'activity', items: dashboard.getDashboardEvents(), scroll: appState.dashboardActivityScroll, max: Math.min(7, Math.max(1, Math.floor(bodyRows * 0.30))), selected: 'dashboardActivitySelected' },
      { key: 'issues', zone: 'issues', items: dashboard.getDashboardIssues(), scroll: appState.dashboardIssueScroll, max: Math.min(4, Math.max(1, Math.floor(bodyRows * 0.20))), selected: 'dashboardIssueSelected' },
      { key: 'prs', zone: 'prs', items: dashboard.getDashboardPRs(), scroll: appState.dashboardPRScroll, max: Math.min(4, Math.max(1, Math.floor(bodyRows * 0.20))), selected: 'dashboardPRSelected' },
    ];
    for (const list of lists) {
      const header = appState._sectionHeaders['dashboard:' + list.key];
      if (!header || sy <= header.y) continue;
      const row = sy - header.y - 1;
      const index = row + list.scroll;
      if (row >= 0 && row < list.max && index < list.items.length) {
        appState[list.selected] = index;
        if (!focusDashboardZone(list.zone)) return false;
        dashboard.openDashboardItem();
        return true;
      }
    }
  }
  return false;
}

// ── Tab bar ───────────────────────────────────────────────────

function handleTabClick(sx) {
  const screen = getScreen();
  const W = screen ? screen.width : 80;
  const tabW = Math.max(8, Math.floor((W - 2) / TABS.length));

  let x = 1;
  for (let i = 0; i < TABS.length; i++) {
    if (sx >= x && sx < x + tabW) {
      setTab(i);
      return;
    }
    x += tabW;
  }
}

// ── Pane tabs (analyze detail view) ───────────────────────────

const PANES = [
  { id: 'overview',   label: 'Overview',   key: 'O' },
  { id: 'issues',     label: 'Issues',     key: 'i' },
  { id: 'prs',        label: 'PRs',        key: 'P' },
  { id: 'readme',     label: 'README',     key: 'R' },
  { id: 'files',      label: 'Files',      key: 'F' },
  { id: 'packages',   label: 'Packages',   key: 'A' },
  { id: 'traffic',    label: 'Traffic',    key: 'T' },
  { id: 'milestones', label: 'Milestones', key: 'M' },
  { id: 'labels',     label: 'Labels',     key: 'L' },
  { id: 'checks',     label: 'Checks',     key: 'K' },
  { id: 'security',   label: 'Security',   key: 'S' },
];

function handlePaneTabClick(sx) {
  let px = 2;
  for (const p of PANES) {
    let label = p.label;
    if (p.id === 'issues') label = 'Issues (' + appState.repoIssues.length + ')';
    else if (p.id === 'prs') label = 'PRs (' + appState.repoPullRequests.length + ')';
    const text = '[' + p.key + '] ' + label;
    const pW = text.length + 2;
    if (sx >= px && sx < px + pW) {
      appState.detailsPane = p.id;
      appState.detailsScroll = 0;
      loadPane(p.id);
      render();
      return;
    }
    px += pW;
  }
}

function loadPane(paneId) {
  if (paneId === 'readme') {
    analyze.viewReadme();
  } else if (paneId === 'files') {
    import('./tabs/files.mjs').then(f => f.openFilesPane()).catch(() => {});
  } else if (paneId === 'packages') {
    appState.selectedAsset = 0;
    analyze.loadReleaseAssets();
  } else if (paneId === 'traffic') {
    analyze.loadTraffic();
  } else if (paneId === 'milestones') {
    analyze.loadMilestones();
  } else if (paneId === 'labels') {
    analyze.loadLabels();
  } else if (paneId === 'checks') {
    analyze.loadChecks();
  } else if (paneId === 'security') {
    analyze.loadSecurity();
  } else {
    // 'overview', 'issues', 'prs' — pure state switches, no fetch needed.
  }
}

// ── Collapsible section headers ──────────────────────────────
// Only collapse/expand when clicking near the ▸/▾ arrow
// (within 3 columns of the stored X position).

function handleCollapsibleClick(sx, sy) {
  const t = tabState.current;
  const prefix = ['dashboard', 'repos', 'analyze', 'actions', 'inbox', 'settings'][t] || '';
  const headers = appState._sectionHeaders;
  if (!headers) return false;
  for (const section of Object.keys(headers)) {
    if (!section.startsWith(prefix)) continue;
    const { x, y, w } = headers[section];
    if (y === sy && sx >= x && sx < x + (w || 10)) {
      toggleCollapse(section);
      render();
      return true;
    }
  }
  return false;
}

// ── Content-area clicks ──────────────────────────────────────
// Dispatch based on the active tab and the click position.

function handleContentClick(sx, sy) {
  switch (tabState.current) {
    case 0: dispatchDashboardClick(sx, sy); break;
    case 1: dispatchReposClick(sx, sy); break;
    case 2: dispatchAnalyzeClick(sx, sy); break;
    case 3:
      dispatchActionsClick(sx, sy);
      break;
    case 4: dispatchInboxClick(sy); break;
    case 5: dispatchSettingsClick(sx, sy); break;
    default: render();
  }
}

// ── Dashboard ─────────────────────────────────────────────────
// The dashboard has stat cards on top, then a 2-column body.
// Body Y starts at bodyY = cardY + cardH + 2.
// We approximate column boundaries from the render code.

function dispatchDashboardClick(sx, sy) {
  const screen = getScreen();
  if (!screen) { render(); return; }
  const W = screen.width, H = screen.height;
  const y = TAB_CONTENT_Y[0];
  const h = H - HEADER_HEIGHT - 2 - 2;
  const cardLayout = getStatCardLayout(W, 5);
  const cardW = cardLayout.cardWidth;
  const gap = cardLayout.gap;
  const cardsPerRow = cardLayout.cardsPerRow;
  const startX = cardLayout.startX;
  const cardY = y + 3;
  const cardH = 4;
  const cardRows = Math.ceil(5 / cardsPerRow);
  const bodyY = cardY + cardRows * (cardH + 1) + 1;
  const splitX = Math.floor(W / 2);
  const rightX = splitX + 2;

  // Check if click is in the stat-card area.
  if (sy >= cardY && sy < cardY + cardRows * (cardH + 1)) {
    const row = Math.floor((sy - cardY) / (cardH + 1));
    const col = Math.floor((sx - startX) / (cardW + gap));
    const i = row * cardsPerRow + col;
    if (i >= 0 && i < 5) {
      appState.dashboardSelectedCard = i;
      appState.dashboardCardsFocus = true;
      render();
      return;
    }
  }

  // Right column — selectable Dashboard lists. Mouse selection uses the
  // same filtered arrays and viewport calculations as keyboard navigation.
  if (sx >= rightX && sy >= bodyY) {
    const bodyRows = Math.max(1, H - 17);
    const maxEvents = Math.min(7, Math.max(1, Math.floor(bodyRows * 0.30)));
    const maxIssues = Math.min(4, Math.max(1, Math.floor(bodyRows * 0.20)));
    const maxPRs = maxIssues;
    const lists = [
      { key: 'attention', zone: 'attention', length: dashboard.getNeedsAttention().length, scroll: appState.dashboardAttentionScroll, max: 4, selected: 'dashboardAttentionSelected' },
      { key: 'recentActivity', zone: 'activity', length: dashboard.getDashboardEvents().length, scroll: appState.dashboardActivityScroll, max: maxEvents, selected: 'dashboardActivitySelected' },
      { key: 'issues', zone: 'issues', length: dashboard.getDashboardIssues().length, scroll: appState.dashboardIssueScroll, max: maxIssues, selected: 'dashboardIssueSelected' },
      { key: 'prs', zone: 'prs', length: dashboard.getDashboardPRs().length, scroll: appState.dashboardPRScroll, max: maxPRs, selected: 'dashboardPRSelected' },
    ];
    for (const list of lists) {
      const header = appState._sectionHeaders['dashboard:' + list.key];
      if (!header || sy <= header.y) continue;
      const row = sy - header.y - 1;
      if (row >= 0 && row < list.max && row + list.scroll < list.length) {
        appState[list.selected] = row + list.scroll;
        focusDashboardZone(list.zone);
        return;
      }
    }

    // Custom sections use the same bounded issue/PR rows as keyboard focus.
    // Keep the raw section index so empty definitions do not shift selection.
    for (let si = 0; si < (appState.customSections || []).length; si++) {
      const section = appState.customSections[si];
      const header = appState._sectionHeaders['dashboard:custom-' + si];
      if (!header || !section?.items?.length || sy <= header.y) continue;
      const row = sy - header.y - 1;
      if (row >= 0 && row < Math.min(4, section.items.length)) {
        appState.dashboardCustomSectionSelected = si;
        appState.dashboardCustomItemSelected = row;
        focusDashboardZone('custom');
        return;
      }
    }

    const staleHeader = appState._sectionHeaders['dashboard:stale'];
    if (staleHeader && sy > staleHeader.y) {
      const row = sy - staleHeader.y - 1;
      const name = appState.dashboardStaleRepos[row];
      const repo = dashboard.getDashboardRepos().find(r => r.name === name);
      if (repo) {
        const [owner, repoName] = repo.full_name.split('/');
        setTab(2);
        analyze.loadRepoDetails(owner, repoName);
        return;
      }
    }

    // Check trending repo click.
    // Find the "TRENDING THIS WEEK" header position.
    const th = appState._sectionHeaders['dashboard:trending'];
    if (th && th.y > 0 && sy > th.y) {
      const listIdx = sy - th.y - 1;  // items start after header
      const filtered = dashboard.getFilteredTrending();
      const absIdx = listIdx + appState.trendingScroll;
      if (absIdx >= 0 && absIdx < filtered.length) {
        appState.trendingSelected = absIdx;
        focusDashboardZone('trending');
        return;
      }

    }
  }

  // Left column — check top-repo click.
  if (sx < splitX && sy >= bodyY) {
    const th = appState._sectionHeaders['dashboard:topRepos'];
    if (th && th.y > 0 && sy > th.y) {
      const listIdx = sy - th.y - 1;
      if (listIdx >= 0 && listIdx < 5) {
        const reposList = [...dashboard.getDashboardRepos()]
          .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0));
        if (listIdx < reposList.length) {
          const r = reposList[listIdx];
          if (r && r.full_name) {
            const [owner, name] = r.full_name.split('/');
            setTab(2);
            analyze.loadRepoDetails(owner, name);
          }
        }
        return;
      }
    }
  }

  render();
}

// Starred-repo → entity-cache seeding moved to tui/tabs/repos.mjs
// (`_seedStarredCache()`). It's called right after every assignment to
// `appState.starred`, so the cache actually reflects what's currently
// starred instead of running once at module load with an empty list.

function dispatchReposClick(sx, sy) {
  if (repos.tryDismissChipAt(sx, sy)) { render(); return; }

  if (appState.reposView === 'starred') {
    const list = appState.starred;
    const scroll = appState.starredScroll;
    const rowOff = HEADER_HEIGHT + 5;
    const itemIdx = sy - rowOff + scroll;
    if (itemIdx >= 0 && itemIdx < list.length) {
      appState.starredScroll = Math.max(0, itemIdx - 5);
      appState.starredSelected = itemIdx;
      render();
    }
    return;
  }

  // Own repos: need to account for PINNED headers and comfortable density.
  const reposList = repos.floatPinsToTop(repos.applyAllFilters(repos.sortRepos(appState.repos, appState.repoSort)));
  const scroll = appState.repoScroll;
  const compact = appState.repoDensity === 'compact';
  const rowH = compact ? 1 : 2;
  const rowOff = HEADER_HEIGHT + 8;

  // Determine which items have a "★ PINNED" header before them.
  const isPinnedArr = new Array(reposList.length).fill(false);
  const isSectionStart = new Array(reposList.length).fill(false);
  for (let i = 0; i < reposList.length; i++) {
    isPinnedArr[i] = repos.isPinnedLocal(reposList[i].full_name);
    if (isPinnedArr[i] && (i === 0 || !isPinnedArr[i - 1])) isSectionStart[i] = true;
  }

  // Simulate the render loop to find which item was clicked.
  let curY = rowOff;
  for (let i = scroll; i < reposList.length; i++) {
    if (isSectionStart[i]) curY++;
    if (sy >= curY && sy < curY + rowH) {
      appState.repoScroll = Math.max(0, i - 5);
      appState.repoSelected = i;
      render();
      return;
    }
    curY += rowH;
  }
}

// ── Analyze tab ───────────────────────────────────────────────

function dispatchAnalyzeClick(sx, sy) {
  // ── Search view: input box + two-column landing (trending / saved / recent) ──
  if (appState.analyzeView === 'search') {
    const screen = getScreen();
    const W = screen ? screen.width : 80;
    const inputY = HEADER_HEIGHT + 5;  // contentY + 3
    const inputW = Math.min(50, W - 12);

    // Click on search input box → start typing.
    if (sy >= inputY && sy <= inputY + 2 && sx >= 2 && sx < 2 + inputW + 2) {
      analyze.startSearchInputFor(appState.searchType || 'repos');
      return;
    }

    // Click on a landing row (trending / saved search / recent repo).
    const b = appState._exploreBounds;
    if (b?.list) {
      const sec = b.list;
      if (sy >= sec.y && sy < sec.y + sec.count && sx >= sec.x) {
        appState.exploreSel = sec.startIdx + sy - sec.y;
        render();
        analyze.exploreEnter();
        return;
      }
    }
    return;
  }

  // ── Results view: search result rows (repos / users / code / user-repos) ──
  if (appState.analyzeView === 'results') {
    const type = appState.searchType || 'repos';
    const results = analyze.getResultList();
    const screen = getScreen();
    const maxVisible = analyze.maxVisibleResults((screen ? screen.height : 24) - 8);
    const rowOff = HEADER_HEIGHT + 2 + 4 + 2;  // contentY + listY offset + 2 rows
    const scroll = type === 'users' ? appState.userSearchScroll
      : type === 'code' ? appState.codeSearchScroll
      : type === 'user-repos' ? appState.userReposScroll
      : appState.searchScroll;
    const idx = sy - rowOff + scroll;
    if (idx >= 0 && idx < results.length) {
      // Scroll so the clicked item becomes the last visible row, clamped to
      // the valid scroll range (mirrors the previous fixed-width behavior).
      const newScroll = Math.max(0, Math.min(idx - (maxVisible - 1), Math.max(0, results.length - maxVisible)));
      if (type === 'users') {
        appState.userSelectedRepo = idx;
        appState.userSearchScroll = newScroll;
      } else if (type === 'code') {
        appState.codeSelectedRepo = idx;
        appState.codeSearchScroll = newScroll;
      } else if (type === 'user-repos') {
        appState.userReposSelected = idx;
        appState.userReposScroll = newScroll;
      } else {
        appState.selectedRepo = idx;
        appState.searchScroll = newScroll;
      }
      render();
    }
    return;
  }

  // ── Detail view: overview pane (click on release assets) ──
  if (appState.detailsPane === 'overview') {
    const assetBounds = appState._overviewAssetBounds;
    if (assetBounds) {
      for (const b of assetBounds) {
        if (sy === b.y && sx >= b.x) {
          const asset = appState.repoReleaseAssets[b.idx];
          if (asset) {
            appState.selectedAsset = b.idx;
            if (analyze.downloadAsset) analyze.downloadAsset(asset);
          }
          return;
        }
      }
    }
    return;
  }

  // ── Detail view: issues / PRs / packages list ──
  const scroll = appState.detailsScroll;

  // Click on filter indicator row → cycle filter state.
  if ((appState.detailsPane === 'issues' || appState.detailsPane === 'prs') &&
      (sy === HEADER_HEIGHT + 7 || sy === HEADER_HEIGHT + 8)) {
    if (analyze.cycleIssueStateFilter) analyze.cycleIssueStateFilter();
    return;
  }

  let listLen = 0;
  if (appState.detailsPane === 'issues')   listLen = appState.repoIssues.length;
  else if (appState.detailsPane === 'prs') listLen = appState.repoPullRequests.length;
  else if (appState.detailsPane === 'packages') listLen = appState.repoReleaseAssets.length;

  const contentStartY = HEADER_HEIGHT + 9;
  const itemIdx = sy - contentStartY + scroll;
  if (itemIdx >= 0 && itemIdx < listLen) {
    appState.detailsScroll = itemIdx;
    if (appState.detailsPane === 'packages') {
      appState.selectedAsset = itemIdx;
    } else if ((appState.detailsPane === 'issues' || appState.detailsPane === 'prs') && appState.repoDetails) {
      const [owner, name] = appState.repoDetails.full_name.split('/');
      if (appState.detailsPane === 'issues') {
        const issue = appState.repoIssues[itemIdx];
        if (issue && analyze.openDetail) analyze.openDetail('issue', owner, name, issue.number);
      } else {
        const pr = appState.repoPullRequests[itemIdx];
        if (pr && analyze.openDetail) analyze.openDetail('pull_request', owner, name, pr.number);
      }
      return;
    }
    render();
  }
}

// ── Inbox tab ─────────────────────────────────────────────────

function dispatchInboxClick(sy) {
  const bounds = appState._inboxListBounds;
  const filteredLen = inbox.getFilteredNotifications().length;
  if (!bounds || sy < bounds.rowStart || sy >= bounds.rowStart + bounds.maxRows) return;
  const itemIdx = sy - bounds.rowStart + appState.inboxScroll;
  if (itemIdx >= 0 && itemIdx < filteredLen) {
    appState.selectedNotification = itemIdx;
    inbox.normalizeInboxCursor();
    render();
  }
}

function dispatchActionsClick(sx, sy) {
  const bounds = appState._actionsListBounds;
  if (!bounds || sy < bounds.rowStart || sy >= bounds.rowStart + bounds.maxRows) return;
  const itemIdx = sy - bounds.rowStart + bounds.scroll;
  if (appState.actionsView === 'repos') {
    const q = (appState.actionsFilter || '').trim().toLowerCase();
    const list = q ? appState.actionsRepos.filter(r => (r.full_name || '').toLowerCase().includes(q)) : appState.actionsRepos;
    if (itemIdx >= 0 && itemIdx < list.length) {
      appState.actionsRepoSelected = itemIdx;
      // A second click on the selected row has the same effect as Enter.
      if (appState._actionsClickedIndex === itemIdx) {
        appState._actionsClickedIndex = null;
        import('./tabs/actions.mjs').then(m => m.enter()).catch(() => {});
      } else {
        appState._actionsClickedIndex = itemIdx;
        render();
      }
    }
  } else if (itemIdx >= 0 && itemIdx < appState.actionsRuns.length) {
    appState.actionsSelected = itemIdx;
    if (appState._actionsClickedIndex === itemIdx) {
      appState._actionsClickedIndex = null;
      import('./tabs/actions.mjs').then(m => m.enter()).catch(() => {});
    } else {
      appState._actionsClickedIndex = itemIdx;
      render();
    }
  }
}

// ── Scroll wheel ──────────────────────────────────────────────

function inTrendingSection(sx, sy) {
  const screen = getScreen();
  if (!screen) return false;
  const W = screen.width;
  const splitX = Math.floor(W / 2);
  const rightX = splitX + 2;
  const th = appState._sectionHeaders['dashboard:trending'];
  return sx >= rightX && th && th.y > 0 && sy > th.y;
}

function scrollUp(sx, sy) {
  const t = tabState.current;
  if (t === 0) {
    if (inTrendingSection(sx, sy)) {
      import('./tabs/dashboard.mjs').then(m => m.trendingUp()).catch(() => {});
    } else if (appState.dashboardScroll > 0) {
      appState.dashboardScroll--;
      render();
    }
  } else if (t === 1) {
    if (appState.reposView === 'starred') {
      if (appState.starredScroll > 0) { appState.starredScroll--; render(); }
    } else {
      if (appState.repoScroll > 0) { appState.repoScroll--; render(); }
    }
  } else if (t === 2) {
    if (appState.detailsScroll > 0) { appState.detailsScroll--; render(); }
  } else if (t === 3) {
    if (appState.actionsView === 'repos') {
      if (appState.actionsRepoScroll > 0) { appState.actionsRepoScroll--; render(); }
    } else {
      if (appState.actionsScroll > 0) { appState.actionsScroll--; render(); }
    }
  } else if (t === 4) {
    if (appState.inboxScroll > 0) { appState.inboxScroll--; render(); }
  }
}

function scrollDown(sx, sy) {
  const t = tabState.current;
  const screen = getScreen();
  if (!screen) return;

  if (t === 0) {
    if (inTrendingSection(sx, sy)) {
      import('./tabs/dashboard.mjs').then(m => m.trendingDown()).catch(() => {});
    } else if (appState.dashboardScroll < (appState.dashboardMaxScroll || 0)) {
      appState.dashboardScroll++;
      render();
    }
  } else if (t === 1) {
    const maxV = Math.max(1, Math.min(15, screen.height - 12));
    if (appState.reposView === 'starred') {
      if (appState.starredScroll + maxV < appState.starred.length) { appState.starredScroll++; render(); }
    } else {
      const repoCount = appState._filteredReposCount || appState.repos.length;
      if (appState.repoScroll + maxV < repoCount) { appState.repoScroll++; render(); }
    }
  } else if (t === 2) {
    appState.detailsScroll++;
    render();
  } else if (t === 3) {
    if (appState.actionsView === 'repos') {
      const maxV = Math.max(1, screen.height - 12);
      if (appState.actionsRepoScroll + maxV < appState.actionsRepos.length) { appState.actionsRepoScroll++; render(); }
    } else {
      appState.actionsScroll++;
      render();
    }
  } else if (t === 4) {
    const maxV = Math.max(1, screen.height - 12);
    const inboxCount = inbox.getFilteredNotifications().length;
    if (appState.inboxScroll + maxV < inboxCount) { appState.inboxScroll++; render(); }
  }
}

// ── Settings tab ─────────────────────────────────────────────
function dispatchSettingsClick(sx, sy) {
  // Click on URL link → open in browser.
  const urlBounds = appState._settingsUrlBounds;
  if (urlBounds && sx >= urlBounds.x && sx < urlBounds.x + urlBounds.w && sy === urlBounds.y) {
    import('../utils.mjs').then(m => m.openUrl(urlBounds.url)).then(r => {
      if (r.ok) showMessage('Opened project page', 'success');
      else showMessage(r.error || 'Open failed', 'error');
    });
    render();
    return;
  }

  // Click on theme chip → apply theme.
  const chips = appState._themeChips;
  if (chips) {
    for (const chip of chips) {
      if (sx >= chip.x1 && sx < chip.x2 && sy === chip.y) {
        if (setTheme(chip.theme)) {
          showMessage('Theme: ' + chip.theme, 'success');
        }
        render();
        return;
      }
    }
  }

  // Click on the star row → trigger starRepo() directly with full feedback.
  const starBounds = appState._starRowBounds;
  if (starBounds && sy === starBounds.y && sx >= starBounds.x1 && sx < starBounds.x2) {
    appState.settingsCursor = 8;
    import('./tabs/settings.mjs').then(m => m.starRepo());
    render();
    return;
  }

  // Click on settings menu row → select and activate.
  const rowBounds = appState._settingsRowBounds;
  if (rowBounds) {
    for (const rb of rowBounds) {
      if (sy === rb.y) {
        appState.settingsCursor = rb.cursor;
        // Star row (cursor 7) is handled above via _starRowBounds for wider hit area,
        // but also handle it here in case it falls through.
        if (rb.cursor === 7) {
          import('./tabs/settings.mjs').then(m => m.starRepo());
        } else {
          import('./tabs/settings.mjs').then(m => m.enter());
        }
        render();
        return;
      }
    }
  }

  render();
}
