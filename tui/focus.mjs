// Focus management system — tracks which widget has keyboard focus
// and supports Tab/Shift+Tab navigation between focusable elements.

import { appState, render } from './state.mjs';

// Focus zones per tab — ordered list of focusable regions.
// Each zone has: id, label, and optional canFocus() guard.
const FOCUS_ZONES = {
  0: [ // Dashboard
    { id: 'cards', label: 'Stat Cards', canFocus: () => true },
    { id: 'trending', label: 'Trending', canFocus: () => appState.trending?.length > 0 },
    { id: 'issues', label: 'Recent Issues', canFocus: () => appState.dashboardRecentIssues?.length > 0 },
    { id: 'prs', label: 'Recent PRs', canFocus: () => appState.dashboardRecentPRs?.length > 0 },
  ],
  1: [ // Repos
    { id: 'list', label: 'Repo List', canFocus: () => appState.repos?.length > 0 },
  ],
  2: [ // Analyze
    { id: 'results', label: 'Search Results', canFocus: () => appState.searchResults?.length > 0 || appState.userSearchResults?.length > 0 },
    { id: 'panes', label: 'Detail Panes', canFocus: () => appState.analyzeView === 'details' },
  ],
  3: [ // Actions
    { id: 'repos', label: 'Actions Repos', canFocus: () => appState.actionsRepos?.length > 0 },
    { id: 'runs', label: 'Workflow Runs', canFocus: () => appState.actionsRuns?.length > 0 },
  ],
  4: [ // Inbox
    { id: 'list', label: 'Notifications', canFocus: () => appState.notifications?.length > 0 },
  ],
  5: [ // Settings
    { id: 'menu', label: 'Settings Menu', canFocus: () => true },
  ],
};

// Current focus state: { tab, zoneIndex }
let _focusState = { tab: 0, zoneIndex: 0 };

export function getFocusZone() {
  const zones = FOCUS_ZONES[_focusState.tab] || [];
  return zones[_focusState.zoneIndex] || null;
}

export function getFocusState() {
  return { ..._focusState };
}

// Move focus to next zone (Tab).
export function focusNext() {
  const zones = FOCUS_ZONES[_focusState.tab] || [];
  if (zones.length === 0) return;

  // Find next focusable zone
  let next = _focusState.zoneIndex + 1;
  for (let i = 0; i < zones.length; i++) {
    const idx = (next + i) % zones.length;
    if (zones[idx].canFocus()) {
      _focusState.zoneIndex = idx;
      render();
      return;
    }
  }
}

// Move focus to previous zone (Shift+Tab).
export function focusPrev() {
  const zones = FOCUS_ZONES[_focusState.tab] || [];
  if (zones.length === 0) return;

  // Find previous focusable zone
  let prev = _focusState.zoneIndex - 1;
  for (let i = 0; i < zones.length; i++) {
    const idx = (prev - i + zones.length) % zones.length;
    if (zones[idx].canFocus()) {
      _focusState.zoneIndex = idx;
      render();
      return;
    }
  }
}

// Reset focus when switching tabs.
export function resetFocus(tabIndex) {
  _focusState.tab = tabIndex;
  _focusState.zoneIndex = 0;
}

// Check if a specific zone is currently focused.
export function isFocused(tabIndex, zoneId) {
  return _focusState.tab === tabIndex && getFocusZone()?.id === zoneId;
}

// Get the selection state for the focused zone.
export function getFocusedSelection() {
  const zone = getFocusZone();
  if (!zone) return null;

  const t = _focusState.tab;
  if (t === 0) {
    if (zone.id === 'cards') return { type: 'card', index: appState.dashboardSelectedCard };
    if (zone.id === 'trending') return { type: 'list', index: appState.trendingSelected, scroll: appState.trendingScroll };
    if (zone.id === 'issues') return { type: 'list', index: appState.dashboardIssueSelected, scroll: appState.dashboardIssueScroll };
    if (zone.id === 'prs') return { type: 'list', index: appState.dashboardPRSelected, scroll: appState.dashboardPRScroll };
  }
  if (t === 1) {
    if (zone.id === 'list') {
      if (appState.reposView === 'starred') return { type: 'list', index: appState.starredSelected, scroll: appState.starredScroll };
      return { type: 'list', index: appState.repoSelected, scroll: appState.repoScroll };
    }
  }
  if (t === 3) {
    if (zone.id === 'repos') return { type: 'list', index: appState.actionsRepoSelected, scroll: appState.actionsRepoScroll };
    if (zone.id === 'runs') return { type: 'list', index: appState.actionsSelected, scroll: appState.actionsScroll };
  }
  if (t === 4) {
    if (zone.id === 'list') return { type: 'list', index: appState.selectedNotification, scroll: appState.inboxScroll };
  }
  return null;
}
