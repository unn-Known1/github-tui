// Mouse support — parse terminal mouse events and dispatch to handlers.
// Supports: click, scroll wheel, hover.

import { appState, tabState, setTab, render } from './state.mjs';

// Enable mouse tracking on startup.
export function enableMouse() {
  process.stdout.write('\x1b[?1000h');  // Basic mouse tracking
  process.stdout.write('\x1b[?1002h');  // Button-event tracking
  process.stdout.write('\x1b[?1003h');  // Any-event tracking (motion)
}

// Disable mouse tracking on exit.
export function disableMouse() {
  process.stdout.write('\x1b[?1000l');
  process.stdout.write('\x1b[?1002l');
  process.stdout.write('\x1b[?1003l');
}

// Parse a mouse event from raw input data.
// Returns { button, col, row, pressed } or null if not a mouse event.
export function parseMouseEvent(data) {
  // Mouse events start with \x1b[< 
  if (!data.startsWith('\x1b[<')) return null;
  
  // Extract the parameters: \x1b[<button;col;rowM or \x1b[<button;col;rowm
  const match = data.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
  if (!match) return null;
  
  const button = parseInt(match[1], 10);
  const col = parseInt(match[2], 10);
  const row = parseInt(match[3], 10);
  const pressed = match[4] === 'M';  // M = press, m = release
  
  return { button, col, row, pressed };
}

// Handle a mouse event by dispatching to the appropriate handler.
export function handleMouseEvent(event) {
  if (!event || !event.pressed) return;  // Only handle presses
  
  const { button, col, row } = event;
  
  // Scroll wheel (buttons 64/65)
  if (button === 64) { scrollUp(); return; }
  if (button === 65) { scrollDown(); return; }
  
  // Left click (button 0)
  if (button === 0) {
    handleClick(col, row);
  }
}

// Handle a left click at the given position.
function handleClick(col, row) {
  // Row 0: Tab bar
  if (row === 1) {
    handleTabClick(col);
    return;
  }
  
  // Row 1: Pane tabs (analyze tab only)
  if (row === 2 && tabState.current === 2) {
    handlePaneTabClick(col);
    return;
  }
  
  // Collapsible section headers
  if (handleCollapsibleClick(col, row)) return;
  
  // List items (repos, issues, PRs, etc.)
  handleListItemClick(col, row);
}

// Handle click on the tab bar (row 1).
function handleTabClick(col) {
  const tabs = ['Dashboard', 'Repos', 'Analyze', 'Settings', 'Inbox'];
  const tabWidth = 12;
  const startX = 2;
  
  for (let i = 0; i < tabs.length; i++) {
    const tabStart = startX + i * tabWidth;
    const tabEnd = tabStart + tabs[i].length + 4;
    if (col >= tabStart && col <= tabEnd) {
      setTab(i);
      return;
    }
  }
}

// Handle click on pane tabs (row 2, analyze tab).
function handlePaneTabClick(col) {
  const panes = [
    { id: 'overview', label: '[O] Overview' },
    { id: 'issues', label: '[i] Issues' },
    { id: 'prs', label: '[P] PRs' },
    { id: 'readme', label: '[R] README' },
    { id: 'files', label: '[F] Files' },
    { id: 'packages', label: '[A] Packages' },
    { id: 'traffic', label: '[T] Traffic' },
    { id: 'milestones', label: '[M] Milestones' },
    { id: 'labels', label: '[L] Labels' },
  ];
  
  let px = 2;
  for (const pane of panes) {
    const paneWidth = pane.label.length + 2;
    if (col >= px && col <= px + paneWidth) {
      appState.detailsPane = pane.id;
      appState.detailsScroll = 0;
      // Trigger load for the selected pane
      loadPane(pane.id);
      render();
      return;
    }
    px += paneWidth;
  }
}

// Load data for a specific pane.
function loadPane(paneId) {
  // Dynamic import to avoid circular dependencies
  import('./tabs/analyze.mjs').then(analyze => {
    if (paneId === 'traffic') analyze.loadTraffic();
    else if (paneId === 'milestones') analyze.loadMilestones();
    else if (paneId === 'labels') analyze.loadLabels();
  }).catch(() => {});
}

// Handle click on collapsible section headers.
function handleCollapsibleClick(col, row) {
  // Check if click is on a ▸ or ▾ character
  // This is a simplified check - in a real implementation,
  // we'd need to track the exact positions of section headers
  return false;
}

// Handle click on list items.
function handleListItemClick(col, row) {
  // This would need to be implemented per-tab
  // For now, just render to show the click was processed
  render();
}

// Scroll up (mouse wheel up).
function scrollUp() {
  const t = tabState.current;
  if (t === 1) {
    if (appState.reposView === 'starred') {
      if (appState.starredScroll > 0) {
        appState.starredScroll--;
        render();
      }
    } else {
      if (appState.repoScroll > 0) {
        appState.repoScroll--;
        render();
      }
    }
  } else if (t === 2) {
    if (appState.detailsScroll > 0) {
      appState.detailsScroll--;
      render();
    }
  } else if (t === 4) {
    if (appState.inboxScroll > 0) {
      appState.inboxScroll--;
      render();
    }
  }
}

// Scroll down (mouse wheel down).
function scrollDown() {
  const t = tabState.current;
  const screen = global.screen;
  if (!screen) return;
  
  if (t === 1) {
    if (appState.reposView === 'starred') {
      const maxVisible = Math.max(1, Math.min(15, screen.height - 12));
      if (appState.starredScroll + maxVisible < appState.starred.length) {
        appState.starredScroll++;
        render();
      }
    } else {
      const maxVisible = Math.max(1, Math.min(15, screen.height - 12));
      if (appState.repoScroll + maxVisible < appState.repos.length) {
        appState.repoScroll++;
        render();
      }
    }
  } else if (t === 2) {
    appState.detailsScroll++;
    render();
  } else if (t === 4) {
    const maxVisible = Math.max(1, screen.height - 12);
    if (appState.inboxScroll + maxVisible < appState.notifications.length) {
      appState.inboxScroll++;
      render();
    }
  }
}
