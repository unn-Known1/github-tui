// Mouse support — parse terminal mouse events and dispatch to handlers.

import { appState, tabState, setTab, render, TABS, toggleCollapse, showMessage } from './state.mjs';
import { getScreen, HEADER_HEIGHT } from './render.mjs';
import { setTheme } from './theme.mjs';

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

  // Motion (button 32–63) — live hover selection on trending list.
  if (button >= 32 && button < 64) {
    const sx = col - 1;
    const sy = row - 1;
    if (tabState.current === 0 && inTrendingSection(sx, sy)) {
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

// ── Coordinate conversion ────────────────────────────────────
// Terminal sends 1-based col/row.  Convert to 0-based screen
// coordinates (sx, sy) at the top of handleClick, then every
// downstream function works in screen coords.

function handleClick(col, row) {
  const sx = col - 1;
  const sy = row - 1;

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
      import('./tabs/detail.mjs').then(m => m.closeDetail()).catch(() => {});
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
            import('./tabs/detail.mjs').then(m => {
              if (actions[i] === 'c Comment') m.openCommentInput();
              else if (actions[i] === 'r React') m.toggleReactionPicker();
              else if (actions[i] === 'M Merge') m.mergePR();
              else m.closeOrReopen();
            }).catch(() => {});
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
  if (sy === HEADER_HEIGHT + 5 && tabState.current === 2) {
    handlePaneTabClick(sx);
    return;
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
  const y = HEADER_HEIGHT + 2;
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
          import('./tabs/analyze.mjs').then(a => a.loadRepoDetails(owner, name));
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
    import('./tabs/analyze.mjs').then(a => a.viewReadme()).catch(() => {});
  } else if (paneId === 'files') {
    import('./tabs/files.mjs').then(f => f.openFilesPane()).catch(() => {});
  } else if (paneId === 'packages') {
    appState.selectedAsset = 0;
    import('./tabs/analyze.mjs').then(a => a.loadReleaseAssets()).catch(() => {});
  } else if (paneId === 'traffic' || paneId === 'milestones' || paneId === 'labels' || paneId === 'checks' || paneId === 'security') {
    import('./tabs/analyze.mjs').then(a => {
      if (paneId === 'traffic') a.loadTraffic();
      else if (paneId === 'milestones') a.loadMilestones();
      else if (paneId === 'labels') a.loadLabels();
      else if (paneId === 'checks') a.loadChecks();
      else if (paneId === 'security') a.loadSecurity();
    }).catch(() => {});
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
    case 2: dispatchAnalyzeClick(sy); break;
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
  const y = HEADER_HEIGHT + 2;  // contentY
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
        const repos = [...appState.repos]
          .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0));
        if (listIdx < repos.length) {
          const r = repos[listIdx];
          if (r && r.full_name) {
            const [owner, name] = r.full_name.split('/');
            setTab(2);
            import('./tabs/analyze.mjs').then(a => a.loadRepoDetails(owner, name));
          }
        }
        return;
      }
    }
  }

  render();
}

// ── Repos tab ─────────────────────────────────────────────────

function dispatchReposClick(sx, sy) {
  import('./tabs/repos.mjs').then(repos => {
    if (repos.tryDismissChipAt(sx, sy)) { render(); return; }

    const list = appState.reposView === 'starred' ? appState.starred : appState.repos;
    const scroll = appState.reposView === 'starred' ? appState.starredScroll : appState.repoScroll;

    // Approximate row mapping: for own view, data starts at HEADER_HEIGHT+8
    // (contentY+title+hline+chips+header+hline); for starred at HEADER_HEIGHT+5.
    // NOTE: does not account for PINNED section headers or comfortable 2-row items.
    const rowOff = appState.reposView === 'starred' ? (HEADER_HEIGHT + 5) : (HEADER_HEIGHT + 8);
    const itemIdx = sy - rowOff + scroll;
    if (itemIdx >= 0 && itemIdx < list.length) {
      if (appState.reposView === 'starred') {
        appState.starredScroll = Math.max(0, itemIdx - 5);
        appState.starredSelected = itemIdx;
      } else {
        appState.repoScroll = Math.max(0, itemIdx - 5);
        appState.repoSelected = itemIdx;
      }
      render();
    }
  }).catch(() => {});
}

// ── Analyze tab ───────────────────────────────────────────────

function dispatchAnalyzeClick(sy) {
  import('./tabs/analyze.mjs').then(mod => {
    const scroll = appState.detailsScroll;

    // First data row for issues/PRs/packages starts at HEADER_HEIGHT + 9.
    const contentStartY = HEADER_HEIGHT + 9;
    const itemIdx = sy - contentStartY + scroll;
    let listLen = 0;
    if (appState.detailsPane === 'issues')   listLen = appState.repoIssues.length;
    else if (appState.detailsPane === 'prs') listLen = appState.repoPullRequests.length;
    else if (appState.detailsPane === 'packages') listLen = appState.repoReleaseAssets.length;

    // Click on filter indicator row → cycle filter state.
    if ((appState.detailsPane === 'issues' || appState.detailsPane === 'prs') &&
        (sy === HEADER_HEIGHT + 7 || sy === HEADER_HEIGHT + 8)) {
      if (mod && mod.cycleIssueStateFilter) mod.cycleIssueStateFilter();
      return;
    }

    if (itemIdx >= 0 && itemIdx < listLen) {
      appState.detailsScroll = itemIdx;
      if (appState.detailsPane === 'packages') {
        appState.selectedAsset = itemIdx;
      } else if ((appState.detailsPane === 'issues' || appState.detailsPane === 'prs') && appState.repoDetails) {
        // Open detail popup on click.
        const [owner, name] = appState.repoDetails.full_name.split('/');
        if (appState.detailsPane === 'issues') {
          const issue = appState.repoIssues[itemIdx];
          if (issue && mod && mod.openDetail) mod.openDetail('issue', owner, name, issue.number);
        } else {
          const pr = appState.repoPullRequests[itemIdx];
          if (pr && mod && mod.openDetail) mod.openDetail('pull_request', owner, name, pr.number);
        }
        return;
      }
      render();
    }
  }).catch(() => {});
}

// ── Inbox tab ─────────────────────────────────────────────────

function dispatchInboxClick(sy) {
  const scroll = appState.inboxScroll;
  const itemIdx = sy - HEADER_HEIGHT - 2 + scroll;
  if (itemIdx >= 0 && itemIdx < appState.notifications.length) {
    appState.inboxScroll = Math.max(0, itemIdx - 5);
    appState.selectedNotification = itemIdx;
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
      if (appState.repoScroll + maxV < appState.repos.length) { appState.repoScroll++; render(); }
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
    if (appState.inboxScroll + maxV < appState.notifications.length) { appState.inboxScroll++; render(); }
  }
}

// ── Settings tab ─────────────────────────────────────────────
function dispatchSettingsClick(sx, sy) {
  const chips = appState._themeChips;
  if (!chips) { render(); return; }
  for (const chip of chips) {
    if (sx >= chip.x1 && sx < chip.x2 && sy === chip.y) {
      if (setTheme(chip.theme)) {
        showMessage('Theme: ' + chip.theme, 'success');
      }
      render();
      return;
    }
  }
  render();
}
