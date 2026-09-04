// Focus management system — tracks which widget has keyboard focus
// and supports Tab/Shift+Tab navigation between focusable elements.

import { appState, render, isDashboardHidden } from './state.mjs';

function localRepoName() {
  return appState.localRepo && appState.localRepoFilter
    ? appState.localRepo.owner + '/' + appState.localRepo.repo
    : null;
}

function itemRepoName(item) {
  if (!item) return '';
  if (item.repo?.name) return item.repo.name;
  if (item.full_name) return item.full_name;
  if (item.repository?.full_name) return item.repository.full_name;
  if (item.repository_url) return item.repository_url.split('/').slice(-2).join('/');
  const parts = String(item.html_url || '').split('/');
  return parts[2] === 'github.com' && parts[3] && parts[4]
    ? parts[3] + '/' + parts[4]
    : '';

}

function hasDashboardItems(items) {
  const local = localRepoName();
  return Array.isArray(items) && items.some(item => !local || itemRepoName(item) === local);
}

// Focus zones per tab — ordered list of focusable regions.
// Each zone has: id, label, and optional canFocus() guard.
const FOCUS_ZONES = {
  0: [ // Dashboard
    // Tab order mirrors top-to-bottom reading of the dashboard:
    //   cards (top full-width row)
    // → attention → activity → issues → prs → stale → custom → trending
    //   (right column, top to bottom — matches render order in dashboard.mjs:
    //   NEEDS ATTENTION, RECENT ACTIVITY, RECENT ISSUES, RECENT PRs,
    //   STALE REPOS, custom sections, TRENDING last)
    // → topRepos → contributions (left column, top to bottom — Tab reaches
    //   them after the right column; previously they sat between attention
    //   and activity, breaking the right-column flow, and contributions sat
    //   above topRepos though it renders below it).
    { id: 'cards', label: 'Stat Cards', canFocus: () => true },
    { id: 'attention', label: 'Needs Attention', canFocus: () => appState.dashboardAttentionItems?.length > 0 },
    { id: 'activity', label: 'Recent Activity', canFocus: () => hasDashboardItems(appState.events) },
    { id: 'issues', label: 'Recent Issues', canFocus: () => hasDashboardItems(appState.dashboardRecentIssues) },
    { id: 'prs', label: 'Recent PRs', canFocus: () => hasDashboardItems(appState.dashboardRecentPRs) },
    { id: 'stale', label: 'Stale Repos', canFocus: () => (appState.dashboardStaleCount||0) > 0 },
    { id: 'custom', label: 'Custom Sections', canFocus: () => appState.customSections?.some(s => s.items?.length > 0) },
    { id: 'trending', label: 'Trending', canFocus: () => hasDashboardItems(appState.trending) },
    { id: 'topRepos', label: 'Top Repos', canFocus: () => (appState.repos||[]).length > 0 },
    { id: 'contributions', label: 'Contributions', canFocus: () => !isDashboardHidden('contributions') && !!appState.dashboardContributions },
  ],
  1: [ // Repos
    { id: 'list', label: 'Repo List', canFocus: () => appState.repos?.length > 0 },
  ],
  2: [ // Explore
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
// Dashboard starts unfocused so its first Tab focuses the stat cards instead
// of unexpectedly skipping straight to the activity list.
let _focusState = { tab: 0, zoneIndex: -1 };

function syncDashboardFocus() {
  if (_focusState.tab !== 0) return;
  const zone = getFocusZone();
  appState.dashboardCardsFocus = zone?.id === 'cards';
  if (zone?.id) appState.dashboardFocusZone = zone.id;
}

export function focusDashboardZone(zoneId) {
  if (_focusState.tab !== 0) return false;
  const zones = FOCUS_ZONES[0] || [];
  const index = zones.findIndex(z => z.id === zoneId);
  if (index < 0 || !zones[index].canFocus()) return false;
  _focusState.zoneIndex = index;
  syncDashboardFocus();
  render();
  return true;
}

export function getFocusZone() {
  const zones = FOCUS_ZONES[_focusState.tab] || [];
  return zones[_focusState.zoneIndex] || null;
}

export function getFocusState() {
  return { ..._focusState };
}

export function focusNext() {
  const zones = FOCUS_ZONES[_focusState.tab] || [];
  if (zones.length === 0) return;

  let next = _focusState.zoneIndex + 1;
  for (let i = 0; i < zones.length; i++) {
    const idx = (next + i) % zones.length;
    if (zones[idx].canFocus()) {
      _focusState.zoneIndex = idx;
      syncDashboardFocus();
      render();
      return;
    }
  }
}

export function focusPrev() {
  const zones = FOCUS_ZONES[_focusState.tab] || [];
  if (zones.length === 0) return;

  let prev = _focusState.zoneIndex - 1;
  for (let i = 0; i < zones.length; i++) {
    const idx = (prev - i + zones.length) % zones.length;
    if (zones[idx].canFocus()) {
      _focusState.zoneIndex = idx;
      syncDashboardFocus();
      render();
      return;
    }
  }
}

export function resetFocus(tabIndex) {
  _focusState.tab = tabIndex;
  _focusState.zoneIndex = tabIndex === 0 ? -1 : 0;
  if (tabIndex === 0) {
    appState.dashboardCardsFocus = false;
    appState.dashboardFocusZone = 'trending';
  }
}

export function isFocused(tabIndex, zoneId) {
  return _focusState.tab === tabIndex && getFocusZone()?.id === zoneId;
}

export function getFocusedSelection() {
  const zone = getFocusZone();
  if (!zone) return null;

  const t = _focusState.tab;
  if (t === 0) {
    if (zone.id === 'cards') return { type: 'card', index: appState.dashboardSelectedCard };
    if (zone.id === 'trending') return { type: 'list', index: appState.trendingSelected, scroll: appState.trendingScroll };
    if (zone.id === 'attention') return { type: 'list', index: appState.dashboardAttentionSelected, scroll: appState.dashboardAttentionScroll };
    if (zone.id === 'contributions') {
      let idx = appState.dashboardContribSelected;
      if (!Number.isFinite(idx)) {
        const now = new Date();
        const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        idx = 14 * 7 + new Date(todayMs).getUTCDay();
      }
      return { type: 'contrib', index: idx, filter: appState.dashboardContribDayFilter || null };
    }
    if (zone.id === 'activity') return { type: 'list', index: appState.dashboardActivitySelected, scroll: appState.dashboardActivityScroll };
    if (zone.id === 'issues') return { type: 'list', index: appState.dashboardIssueSelected, scroll: appState.dashboardIssueScroll };
    if (zone.id === 'prs') return { type: 'list', index: appState.dashboardPRSelected, scroll: appState.dashboardPRScroll };
    if (zone.id === 'topRepos') return { type: 'list', index: appState.dashboardTopSelected || 0, scroll: appState.dashboardTopScroll || 0 };
    if (zone.id === 'stale') return { type: 'list', index: appState.dashboardStaleSelected || 0, scroll: appState.dashboardStaleScroll || 0 };
    if (zone.id === 'custom') return { type: 'custom', section: appState.dashboardCustomSectionSelected, index: appState.dashboardCustomItemSelected };
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
