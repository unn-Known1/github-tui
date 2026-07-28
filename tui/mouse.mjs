// Mouse support — parse terminal mouse events and dispatch to handlers.

import { appState, tabState, setTab, render, TABS, toggleCollapse, showMessage } from './state.mjs';
import { getScreen, HEADER_HEIGHT, TAB_CONTENT_Y } from './render.mjs';
import { setTheme } from './theme.mjs';
import { startInput } from './input.mjs';
import { openUrl } from './utils.mjs';
import { dismissConfirm } from './state.mjs';
import * as analyze from './tabs/analyze.mjs';
import * as detail from './tabs/detail.mjs';
import * as repos from './tabs/repos.mjs';
import * as dashboard from './tabs/dashboard.mjs';
import * as settings from './tabs/settings.mjs';

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

  // Motion (button 32–63) — live hover selection on lists.
  if (button >= 32 && button < 64) {
    const sx = col - 1;
    const sy = row - 1;
    const t = tabState.current;

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

    // Inbox tab list.
    if (t === 4) {
      const rowOff = TAB_CONTENT_Y[4];
      if (sy >= rowOff) {
        const listIdx = sy - rowOff;
        const absIdx = listIdx + appState.inboxScroll;
        const filteredLen = appState.notifications.filter(n => {
          if (appState.inboxFilter === 'unread') return n.unread;
          if (appState.inboxFilter === 'mentions') return n.reason === 'mention';
          if (appState.inboxFilter === 'review') return n.reason === 'review_requested';
          if (appState.inboxTextFilter) {
            const q = appState.inboxTextFilter.toLowerCase();
            const title = (n.subject && n.subject.title || '').toLowerCase();
            const repo = (n.repository && n.repository.full_name || '').toLowerCase();
            return title.includes(q) || repo.includes(q);
          }
          return true;
        }).length;
        if (absIdx >= 0 && absIdx < filteredLen && absIdx !== appState.selectedNotification) {
          appState.selectedNotification = absIdx;
          render();
        }
      }
    }

    // Actions tab list.
    if (t === 3) {
      const rowOff = TAB_CONTENT_Y[3];
      if (sy >= rowOff) {
        const listIdx = sy - rowOff;
        if (appState.actionsView === 'repos') {
          const absIdx = listIdx + appState.actionsRepoScroll;
          if (absIdx >= 0 && absIdx < appState.actionsRepos.length && absIdx !== appState.actionsRepoSelected) {
            appState.actionsRepoSelected = absIdx;
            render();
          }
        } else {
          const absIdx = listIdx + appState.actionsScroll;
          if (absIdx >= 0 && absIdx < appState.actionsRuns.length && absIdx !== appState.actionsSelected) {
            appState.actionsSelected = absIdx;
            render();
          }
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
    handleClick(col, row);
  }
}

// P0-4: route clicks to the active overlay before they fall through to
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

  // P0-4: route clicks to active overlays FIRST so they don't leak through
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
  const cardW = Math.min(16, Math.max(10, Math.floor((W - 2) / 5) - 2));
  const gap = 2;
  const cardY = y + 1;
  const cardH = 4;
  const bodyY = cardY + cardH + 2;
  const splitX = Math.floor(W / 2);
  const rightX = splitX + 2;

  // Double-click stat card → drill in
  if (sy >= cardY && sy < cardY + cardH) {
    const col = Math.floor((sx - 1) / (cardW + gap));
    if (col === 4) {
      // Stale → repos with stale filter
      setTab(1);
      appState.repoStaleOnly = true;
      appState.repoScroll = 0;
      appState.repoSelected = 0;
      showMessage('Showing stale repos', 'info');
      render();
      return true;
    }
    if (col === 0 || col === 1) {
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
      const absIdx = listIdx + appState.trendingScroll;
      if (absIdx >= 0 && absIdx < appState.trending.length) {
        const r = appState.trending[absIdx];
        if (r && r.full_name) {
          const [owner, name] = r.full_name.split('/');
          setTab(2);
          analyze.loadRepoDetails(owner, name);
          return true;
        }
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
    case 3: render(); break;
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
  const cardW = Math.min(16, Math.max(10, Math.floor((W - 2) / 5) - 2));
  const gap = 2;
  const cardY = y + 1;
  const cardH = 4;
  const bodyY = cardY + cardH + 2;
  const splitX = Math.floor(W / 2);
  const rightX = splitX + 2;

  // Check if click is in the stat-card area.
  if (sy >= cardY && sy < cardY + cardH) {
    const col = Math.floor((sx - 1) / (cardW + gap));
    if (col >= 0 && col < 5) {
      appState.dashboardSelectedCard = col;
      appState.dashboardCardsFocus = true;
      render();
      return;
    }
  }

  // Right column — check trending repo click.
  if (sx >= rightX && sy >= bodyY) {
    // Find the "TRENDING THIS WEEK" header position.
    const th = appState._sectionHeaders['dashboard:trending'];
    if (th && th.y > 0 && sy > th.y) {
      const listIdx = sy - th.y - 1;  // items start after header
      const absIdx = listIdx + appState.trendingScroll;
      if (absIdx >= 0 && absIdx < appState.trending.length) {
        appState.trendingSelected = absIdx;
        render();
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
        const reposList = [...appState.repos]
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
}  // ── Repos tab ─────────────────────────────────────────────────
  // P1-8: also seed the entityCache when loadStarred assigns to
  // appState.starred so cross-tab viewers see updates.
  if (typeof upsertEntity === 'function') {
    for (const r of list) {
      upsertEntity(r, { isStarred: true, starredAt: r.starred_at, isOwner: false });
    }
  }

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
  // ── Search view: input box + recent repos ──
  if (appState.analyzeView === 'search') {
    const screen = getScreen();
    const W = screen ? screen.width : 80;
    const inputY = HEADER_HEIGHT + 5;  // contentY + 3
    const inputW = Math.min(50, W - 12);

    // Click on search input box → start typing.
    if (sy >= inputY && sy <= inputY + 2 && sx >= 2 && sx < 2 + inputW + 2) {
      startInput('Search repos: ', 'search');
      render();
      return;
    }

    // Click on a recent repo row → open it.
    const recent = appState._recentReposBounds;
    if (recent && sy > recent.y && sy <= recent.y + recent.count) {
      const idx = sy - recent.y - 1;
      const r = appState.recentRepos[idx];
      if (r && r.full_name) {
        const [owner, name] = r.full_name.split('/');
        analyze.loadRepoDetails(owner, name);
      }
      return;
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
  // inboxScroll and selectedNotification both index into the filtered list.
  const filteredLen = appState.notifications.filter(n => {
    if (appState.inboxFilter === 'unread') return n.unread;
    if (appState.inboxFilter === 'mentions') return n.reason === 'mention';
    if (appState.inboxFilter === 'review') return n.reason === 'review_requested';
    if (appState.inboxTextFilter) {
      const q = appState.inboxTextFilter.toLowerCase();
      const title = (n.subject && n.subject.title || '').toLowerCase();
      const repo = (n.repository && n.repository.full_name || '').toLowerCase();
      return title.includes(q) || repo.includes(q);
    }
    return true;
  }).length;
  const screen = getScreen();
  const maxVisible = screen ? Math.max(1, screen.height - 15) : 20;
  const scroll = appState.inboxScroll;
  const itemIdx = sy - HEADER_HEIGHT - 2 + scroll;
  if (itemIdx >= 0 && itemIdx < filteredLen) {
    appState.selectedNotification = itemIdx;
    // Only scroll if the item is outside the current viewport.
    if (itemIdx < scroll) {
      appState.inboxScroll = itemIdx;
    } else if (itemIdx >= scroll + maxVisible) {
      appState.inboxScroll = itemIdx - maxVisible + 1;
    }
    render();
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
    const inboxCount = appState.notifications.filter(n => {
      if (appState.inboxFilter === 'unread') return n.unread;
      if (appState.inboxFilter === 'mentions') return n.reason === 'mention';
      if (appState.inboxFilter === 'review') return n.reason === 'review_requested';
      if (appState.inboxTextFilter) {
        const q = appState.inboxTextFilter.toLowerCase();
        const title = (n.subject && n.subject.title || '').toLowerCase();
        const repo = (n.repository && n.repository.full_name || '').toLowerCase();
        return title.includes(q) || repo.includes(q);
      }
      return true;
    }).length;
    if (appState.inboxScroll + maxV < inboxCount) { appState.inboxScroll++; render(); }
  }
}

// ── Settings tab ─────────────────────────────────────────────
function dispatchSettingsClick(sx, sy) {
  // Click on URL link → open in browser.
  const urlBounds = appState._settingsUrlBounds;
  if (urlBounds && sx >= urlBounds.x && sx < urlBounds.x + urlBounds.w && sy === urlBounds.y) {
    import('../utils.mjs').then(m => m.openUrl(urlBounds.url));
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
    appState.settingsCursor = 7;
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
