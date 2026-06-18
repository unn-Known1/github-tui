// Mouse support — parse terminal mouse events and dispatch to handlers.

import { appState, tabState, setTab, render, TABS, toggleCollapse } from './state.mjs';
import { getScreen, HEADER_HEIGHT } from './render.mjs';

export function enableMouse() {
  process.stdout.write('\x1b[?1000h');
  process.stdout.write('\x1b[?1002h');
  process.stdout.write('\x1b[?1003h');
  process.stdout.write('\x1b[?1006h');
}

export function disableMouse() {
  process.stdout.write('\x1b[?1006l');
  process.stdout.write('\x1b[?1003l');
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

  // Motion (button 32–63) — just store cursor position; no re-render.
  if (button >= 32 && button < 64) {
    appState._mouseSx = col - 1;
    appState._mouseSy = row - 1;
    return;
  }

  // Scroll wheel.
  if (button === 64) { scrollUp(); return; }
  if (button === 65) { scrollDown(); return; }

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

  // Content-area click (list items, stat cards, etc.).
  handleContentClick(sx, sy);
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
    const text = '[' + p.key + '] ' + p.label;
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
  import('./tabs/analyze.mjs').then(a => {
    if (paneId === 'traffic') a.loadTraffic();
    else if (paneId === 'milestones') a.loadMilestones();
    else if (paneId === 'labels') a.loadLabels();
    else if (paneId === 'checks') a.loadChecks();
    else if (paneId === 'security') a.loadSecurity();
  }).catch(() => {});
}

// ── Collapsible section headers ──────────────────────────────
// Only collapse/expand when clicking near the ▸/▾ arrow
// (within 3 columns of the stored X position).

function handleCollapsibleClick(sx, sy) {
  const t = tabState.current;
  const prefix = ['dashboard', 'repos', 'analyze', 'settings', 'inbox'][t] || '';
  const headers = appState._sectionHeaders;
  if (!headers) return false;
  for (const section of Object.keys(headers)) {
    if (!section.startsWith(prefix)) continue;
    const { x, y } = headers[section];
    if (y === sy && Math.abs(sx - x) <= 3) {
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
      if (listIdx >= 0 && listIdx < appState.trending.length) {
        appState.trendingSelected = listIdx;
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

    // Content area starts at CONTENT_Y (HEADER_HEIGHT + 2).  Skip title rows.
    const itemIdx = sy - (HEADER_HEIGHT + 4) + scroll;
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
  import('./tabs/analyze.mjs').then(() => {
    const contentStartY = HEADER_HEIGHT + 7;
    const scroll = appState.detailsScroll;
    const itemIdx = sy - contentStartY + scroll;
    let listLen = 0;
    if (appState.detailsPane === 'issues')   listLen = appState.repoIssues.length;
    else if (appState.detailsPane === 'prs') listLen = appState.repoPullRequests.length;
    else if (appState.detailsPane === 'packages') listLen = appState.repoReleaseAssets.length;
    if (itemIdx >= 0 && itemIdx < listLen) {
      appState.detailsScroll = itemIdx;
      if (appState.detailsPane === 'packages') appState.selectedAsset = itemIdx;
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
    appState.inboxCursor = itemIdx;
    render();
  }
}

// ── Scroll wheel ──────────────────────────────────────────────

function scrollUp() {
  const t = tabState.current;
  if (t === 1) {
    if (appState.reposView === 'starred') {
      if (appState.starredScroll > 0) { appState.starredScroll--; render(); }
    } else {
      if (appState.repoScroll > 0) { appState.repoScroll--; render(); }
    }
  } else if (t === 2) {
    if (appState.detailsScroll > 0) { appState.detailsScroll--; render(); }
  } else if (t === 4) {
    if (appState.inboxScroll > 0) { appState.inboxScroll--; render(); }
  }
}

function scrollDown() {
  const t = tabState.current;
  const screen = getScreen();
  if (!screen) return;

  if (t === 1) {
    const maxV = Math.max(1, Math.min(15, screen.height - 12));
    if (appState.reposView === 'starred') {
      if (appState.starredScroll + maxV < appState.starred.length) { appState.starredScroll++; render(); }
    } else {
      if (appState.repoScroll + maxV < appState.repos.length) { appState.repoScroll++; render(); }
    }
  } else if (t === 2) {
    appState.detailsScroll++;
    render();
  } else if (t === 4) {
    const maxV = Math.max(1, screen.height - 12);
    if (appState.inboxScroll + maxV < appState.notifications.length) { appState.inboxScroll++; render(); }
  }
}
