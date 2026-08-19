// Single source of truth for the entire app. Every other module imports from
// here. ESM live bindings mean mutations are visible everywhere immediately.

// We export a function `getRender()` (rather than importing render directly)
// to avoid an import cycle: state → render → state.

let renderFn = () => {};
export function bindRender(fn) { renderFn = fn; }

// Debounced render — batches rapid state mutations into a single render.
let _renderScheduled = false;
export function render() {
  if (_renderScheduled) return;
  _renderScheduled = true;
  queueMicrotask(() => {
    _renderScheduled = false;
    renderFn();
  });
}

// Async generation guard — every long-running operation grabs a generation
// number from an EXPLICIT scope string. When a newer call for the same scope
// begins, the previous request's AbortController (if any) is fired and the
// caller is told via isStale() to drop the stale result.

// Migration: callers now pass an explicit scope. The old auto-inferred 'global'
// scope still exists as a fallback if anyone forgets the argument, but new
// code should never rely on it.

const asyncGenerations = { _global: 0 };
const asyncControllers = {};  // { [scope]: AbortController }

function _bumpScope(scope) {
  if (!asyncGenerations[scope]) asyncGenerations[scope] = 0;
  return ++asyncGenerations[scope];
}

/**
 * Start (or restart) an async operation for the given scope.
 * Returns a handle containing the generation, abort signal, AND the scope itself.
 * The scope is propagated so helper functions (passed the handle) can call
 * isStale() without an explicit scope argument.
 *
 * If a previous in-flight call exists for this scope, its AbortController
 * is fired, which cancels any in-flight HTTPS requests that honor it.
 *
 * USAGE — there are two idioms, both well-supported by isStale():
 *   1) Explicit (preferred for top-level async fns):
 *       const gen = startAsync('dashboard-widgets');
 *       if (isStale(gen, 'dashboard-widgets')) return;
 *   2) Helper-pattern (when an inner fn receives the handle):
 *       async function runCompares(..., gen) {
 *         if (isStale(gen)) return;  // auto-extracts scope from handle
 *         ...
 *       }
 * Both forms work — pick what's clearest at the call site.
 */
export function startAsync(scope) {
  if (!scope) throw new Error(
    'startAsync() requires an explicit scope string. ' +
    'Pass a unique identifier like "repos-load", "dashboard-widgets", etc.'
  );
  // Cancel any previous in-flight controller for this scope.
  const prev = asyncControllers[scope];
  if (prev && typeof prev.abort === 'function') {
    try { prev.abort(); } catch { /* ignore */ }
  }
  const ctl = new AbortController();
  asyncControllers[scope] = ctl;
  return { gen: _bumpScope(scope), controller: ctl, signal: ctl.signal, scope };
}

/**
 * Check whether a previously-started async operation is still the most recent.
 * Accepts either a handle (preferred — has the scope attached) OR a raw gen
 * number with an optional explicit scope.
 */
export function isStale(handle, scope) {
  let gen, s;
  if (handle && typeof handle === 'object') {
    gen = handle.gen;
    // Auto-extract scope from the handle if it was attached — this is what
    // makes helper functions that take a `gen` parameter Just Work.
    s = handle.scope || scope;
  } else {
    gen = handle;
    s = scope;
  }
  if (!s) s = '_global';
  return gen !== (asyncGenerations[s] || 0);
}

// NOTE: getSignal() was removed — callers should use `handle.signal` directly
// which is guaranteed to be the same controller that the handle's isStale()
// will check. Reading the current controller via a scope string races with
// bumps and produces the wrong signal after the first re-fetch.

// SECURITY_SUB_PANES — canonical order for keystroke (1-6) dispatch into
// the Analyze Security sub-pane (dependabot / secret / codescan / advisories
// / branch / deps). Keys.mjs imports this rather than redeclaring the array
// so adding/removing a sub-pane only requires editing state.mjs.
export const SECURITY_SUB_PANES = ['dependabot', 'secret', 'codescan', 'advisories', 'branch', 'deps'];

// Current tab index. 0-based. Drives the top tab strip and render dispatch.

// each TABS entry carries its auto-refresh function so app.mjs
// no longer magic-numbers tabs as `if (t === 0) ... else if (t === 1) ...`.
// Adding a new tab means writing one entry here with its own refresh fn.
// `refresh` is async — failure is logged, never thrown.

// LAZY dynamic imports: tab modules re-import state.mjs for appState/render,
// so static imports here would create a circular dependency. Each refresh is
// resolved only when invoked, after both module records have fully evaluated.
export const TABS = [
  { key: '1', label: 'Dash',
    // Dashboard refresh must refresh repository metadata first so aggregate
    // cards, stale counts, and language totals share one freshness boundary.
    refresh: () => import('./tabs/dashboard.mjs').then(m => m.refreshDashboard()) },
  { key: '2', label: 'Repos',
    refresh: () => import('./tabs/repos.mjs').then(m => m.loadUserData()) },
  { key: '3', label: 'Explore',
    // Explore is user-driven (search/drill-in). Skip refresh to avoid
    // clobbering in-progress loads. Users can press 'r'.
    refresh: null },
  { key: '4', label: 'Actions',
    refresh: () => appState.actionsView === 'runs' && appState.actionsRepos.length > 0
      ? import('./tabs/actions.mjs').then(m => m.loadWorkflowRuns())
      : import('./tabs/actions.mjs').then(m => m.loadActionsRepos()) },
  { key: '5', label: 'Inbox',
    refresh: () => import('./tabs/inbox.mjs').then(m => m.loadNotifications()) },
  { key: '6', label: 'Settings',
    // Settings has nothing to auto-refresh.
    refresh: null },
];
export const tabState = { current: 0 };

export function setTab(i) {
  if (i < 0 || i >= TABS.length) return;
  tabState.current = i;
  scheduleSessionSave();
  render();
}

// Big shared state bag. Grouped by concern in comments for navigation.

export const appState = {
  // ── Auth ──
  token: null,
  user: null,

  // ── Repos tab ──
  repos: [],
  reposPage: 1,
  reposHasMore: true,
  repoSort: { field: 'updated', asc: false },
  repoScroll: 0,
  repoSelected: 0,                  // highlighted row (different from scroll!)
  repoFilter: '',
  repoTypeFilter: 'all',            // all|sources|forks|archived|private|public|templates
  repoDensity: 'compact',           // compact|comfortable (description on 2nd line)
  repoStaleOnly: false,             // hide repos pushed within last 6 months
  reposView: 'own',                 // 'own' | 'starred'
  starredSelected: 0,
  starredScroll: 0,
  repoPins: [],                     // [full_name] — sticky at top of list
  reposShowLangFacet: false,        // toggle the language facet sidebar
  reposLangFacetSelected: 0,
  reposLangFilter: null,            // null = no language filter

  // entityCache — single source of truth for repo entities.
  // Keyed by full_name. Each value carries { repo, isStarred, isBookmarked,
  // isPinned, isOwner, starredAt }. Derived views (appState.starred,
  // appState.repos) continue to work; mutations to starred membership
  // should call upsertEntity() so the cache and visible lists agree.
  entityCache: {},

  // ── File explorer (analyze details → Files pane) ──
  filesPath: '',
  filesRef: 'main',
  filesEntries: [],
  filesSelected: 0,
  filesScroll: 0,
  fileViewing: null,
  fileText: '',
  fileScroll: 0,
  filesBranches: [],
  filesBranchPicker: false,
  filesBranchCursor: 0,

  // ── Analyze tab ──
  searchQuery: '',
  searchResults: [],
  searchPage: 1,
  searchHasMore: true,
  selectedRepo: 0,
  searchScroll: 0,
  searchType: 'repos',    // 'repos' | 'users' | 'code' | 'user-repos'
  analyzeView: 'search',  // 'search' | 'results' | 'details' | 'forks'
  userSearchResults: [],   // user search results
  codeSearchResults: [],   // code search results
  codeSearchPage: 1,
  codeSearchHasMore: true,
  userSearchPage: 1,
  userSearchHasMore: true,
  userSelectedRepo: 0,
  userSearchScroll: 0,
  codeSelectedRepo: 0,
  codeSearchScroll: 0,
  // Repos of a user opened from user-search results (searchType 'user-repos').
  selectedUser: null,      // user profile being browsed
  userRepos: [],
  userReposPage: 1,
  userReposHasMore: true,
  userReposSelected: 0,
  userReposScroll: 0,
  userReposSort: { field: 'updated', asc: false },  // 'stars' | 'updated' | 'name'
  detailsPane: 'overview', // 'overview' | 'issues' | 'prs' | 'readme' | 'files'
  detailsScroll: 0,
  repoDetails: null,
  repoLanguages: null,
  repoContributors: [],
  repoReleases: [],
  repoReleaseAssets: [],
  selectedAsset: 0,
  repoIssues: [],
  repoPullRequests: [],
  issueStateFilter: 'open', // 'open' | 'closed' | 'all' — used by Issues/PRs panes
  repoTraffic: null,
  repoTrafficClones: null,
  repoTrafficPopularPaths: [],
  repoTrafficPopularReferrers: [],
  repoMilestones: [],
  repoLabels: [],
  repoCheckRuns: [],
  repoCheckSuites: [],
  userFollowers: [],
  userFollowing: [],
  repoDependabotAlerts: [],
  securitySubPane: 'dependabot',  // 'dependabot' | 'secret' | 'codescan' | 'advisories' | 'branch' | 'deps'
  securityFilter: 'all',          // severity filter: 'all' | 'critical' | 'high' | 'medium' | 'low'
  securityStateFilter: 'open',    // state filter: 'open' | 'dismissed' | 'fixed' | 'all'
  securityAlertCursor: 0,
  securityAlertScroll: 0,
  securityAlertDetail: null,      // full alert detail when viewing a single alert
  secretScanningAlerts: [],
  codeScanningAlerts: [],
  securityAdvisories: [],
  branchProtection: null,
  dependencyManifests: [],
  _readmeText: null,

  // ── Text selection (README / file viewer) ──
  textSelectionMode: 'none', // 'none' | 'readme' | 'file'
  textSelectStart: null,     // { row, col } in visual-row coords
  textSelectEnd: null,       // { row, col } in visual-row coords

  // ── Forks sub-view ──
  forks: [],
  forksPage: 1,
  forksHasMore: false,
  forkSort: { field: 'pushed', asc: false },
  selectedFork: 0,
  forkScroll: 0,

  // ── Dashboard widgets ──
  events: [],
  trending: [],
  trendingPage: 1,
  trendingHasMore: true,
  trendingSelected: 0,
  trendingScroll: 0,
  trendingPeriod: 7,  // 1 = today, 7 = this week, 30 = this month
  dashboardFilter: '',
  starred: [],
  starredPage: 1,
  starredHasMore: false,
  dashboardLoaded: false,
  dashboardLastFetched: null,    // ms timestamp — drives the "Updated Xm ago" badge in the greeting row
  dashboardWidgetErrorCount: 0,  // count of widgets that failed on the most recent loadDashboardWidgets — used to render a non-modal "N widgets failed" banner so silent Promise.allSettled rejections become visible
  dashboardLoadingWidgets: {},  // { [widgetName]: boolean } — per-widget loading state
  dashboardContributions: null,  // { weeks: [[day, day, ...], ...] } heatmap data
  dashboardRecentIssues: [],     // recently opened/updated issues across repos
  dashboardRecentPRs: [],        // recently opened/updated PRs across repos
  dashboardAttentionItems: [],   // compact actionable summary rows
  dashboardStaleCount: 0,        // repos with no push in STALE_DAYS+ (set by repos-logic)
  dashboardStaleRepos: [],       // stale repo names for display
  dashboardStarHistory: [],      // daily star counts for sparkline
  dashboardSelectedCard: 0,      // 0..4 stat-card focus for keyboard nav
  dashboardCardsFocus: false,    // true when keyboard focus is on a stat card
  dashboardFocusZone: 'trending', // 'cards' | 'activity' | 'issues' | 'prs' | 'trending'
  dashboardScroll: 0,             // page-level body scroll offset
  dashboardMaxScroll: 0,          // computed maximum body scroll offset
  dashboardIssueSelected: 0,
  dashboardIssueScroll: 0,
  dashboardAttentionSelected: 0,
  dashboardAttentionScroll: 0,
  dashboardActivitySelected: 0,    // keyboard selection index inside Recent Activity list
  dashboardActivityScroll: 0,      // scroll offset when activity list exceeds viewport
  dashboardPRSelected: 0,
  dashboardPRScroll: 0,
  dashboardCustomSectionSelected: 0,
  dashboardCustomItemSelected: 0,

  // ── Auto-refresh ──
  autoRefreshEnabled: false,
  autoRefreshIntervalMs: 300000,  // 5 minutes default

  // ── Local repo context ──
  localRepo: null,           // { owner, repo } | null — detected from cwd git remote
  localRepoFilter: false,    // when true, dashboard/inbox filter to this repo

  // ── Custom sections ──
  customSections: [],        // [{ title, type, query, items: [], selected: 0, scroll: 0 }]
  customSectionsLoaded: false,

  // ── Actions / CI ──
  actionsView: 'repos',     // 'repos' | 'runs'
  actionsRepos: [],         // repos with workflow runs loaded
  actionsRuns: [],          // workflow runs for selected repo
  actionsSelected: 0,
  actionsScroll: 0,
  actionsRepoSelected: 0,
  actionsRepoScroll: 0,
  actionsLoading: false,
  actionsFilter: '',
  actionsExpandedRun: null,   // run id when expanded to show jobs
  actionsJobs: {},            // { [runId]: jobs[] }
  actionsJobSteps: {},        // { [jobId]: steps[] }

  // ── Inbox ──
  notifications: [],
  inboxScroll: 0,
  selectedNotification: 0,
  inboxFilter: 'all',    // 'all' | 'unread' | 'mentions' | 'review'
  inboxTextFilter: '',
  inboxPage: 1,
  inboxHasMore: false,

  // ── Settings ──
  settingsCursor: 0,
  _maxSettingsCursor: 5,

  // ── Global UI state ──
  loading: false,
  message: null,         // { text, type, icon? } | null
  messageTimer: null,
  // ── P0-6: retry handler. Set by error-recovery.mjs after a failed op;
  // the footer renders "[r] to retry" while this is live, and pressing
  // `r` invokes it. Auto-expires after `durationMs` so a stale retry
  // doesn't survive into a later session. ──
  _retryFn: null,
  _retryExpiresAt: 0,
  // ── P0-1: persisted lastSeenVersion (in session.json) used to gate the
  // "what's new" overlay so users see release notes when they upgrade,
  // not just on first install. ──
  lastSeenVersion: null,
  showHelp: false,
  helpQuery: '',         // search filter inside help overlay
  helpCursor: 0,
  showPalette: false,
  paletteQuery: '',
  paletteCursor: 0,
  showOnboarding: false, // first-time welcome splash
  showWelcome: false,    // togglable "what's new" screen
  dismissedOnboarding: false,

  // ── Recently viewed repos (capped list) ──
  recentRepos: [],       // [{ full_name, url, visitedAt }]
  MAX_RECENT: 12,

  // ── Confirmation dialog ──
  confirmAction: null,   // function to call on 'y'
  confirmMessage: '',    // message to display
  confirmTitle: 'Confirm', // dialog title

  // ── Input modal ──
  inputMode: null,       // null | 'input'
  inputBuffer: '',
  inputPrompt: '',
  inputContext: null,    // 'login' | 'search' | 'filter' | 'palette' | 'comment' | ...
  inputMask: false,
  inputCursor: 0,

  // ── Issue/PR detail popup ──
  showDetail: false,
  detailType: null,      // 'issue' | 'pull_request'
  detailOwner: '',
  detailRepo: '',
  detailNumber: 0,
  detailData: null,
  detailComments: [],
  detailReviews: [],
  detailFiles: [],
  detailScroll: 0,
  detailTab: 'body',     // 'body' | 'comments' | 'files'
  detailFileCursor: 0,
  detailLoading: false,
  detailReactionPicker: false,
  detailReactionCursor: 0,
  detailDiffView: false,   // true when viewing a file diff
  detailDiffFile: null,    // the file object being diffed
  detailDiffContent: '',   // the raw diff content
  detailDiffScroll: 0,
  detailDiffVisibleH: 0,   // visible height for diff scrolling

  // ── Theme & bookmarks (v0.3+) ──
  themeName: 'default',
  bookmarks: [],         // [{ id, full_name, url, tags, addedAt }]
  showBookmarks: false,  // bookmarks browser overlay
  bookmarksCursor: 0,
  bookmarksScroll: 0,
  savedSearches: [],     // [{ id, label, query }]

  // ── Explore base-view landing (search mode) ──
  exploreSel: 0,               // cursor over the merged trending/saved/recent list
  _exploreTrendingLoaded: false, // one-shot guard for lazy trending fetch
  _exploreBounds: null,        // { trending:{y,x,count,startIdx}, saved:{...}, recent:{...} }

  // ── Rate-limit mirror (also lives in github.mjs but mirrored for render)
  rateLimit: { remaining: null, limit: null, reset: null },

  // ── Collapsible sections (persisted to disk) ──
  collapsed: {},  // { 'dashboard:profile': true, 'repos:pinned': false, ... }

  // Section header positions (populated by collapsibleHeader during render, consumed by mouse).
  _sectionHeaders: {},  // { 'dashboard:profile': { x: 2, y: 7 }, ... }

};

// Toast / status bar message bus.

const TOAST_ICONS = {
  info:    'ⓘ',
  success: '✓',
  error:   '✗',
  warning: '!',
};

export function showMessage(text, type = 'info', durationMs = 3000) {
  appState.message = { text, type, icon: TOAST_ICONS[type] || 'ⓘ' };
  if (appState.messageTimer) clearTimeout(appState.messageTimer);
  appState.messageTimer = setTimeout(() => {
    // only null the message if it hasn't been replaced by a newer one.
    if (appState.message && appState.message.text === text) {
      appState.message = null;
      appState.messageTimer = null;
      render();
    }
  }, durationMs);
  render();
}

export function clearMessage() {
  appState.message = null;
  if (appState.messageTimer) { clearTimeout(appState.messageTimer); appState.messageTimer = null; }
  render();
}

// Confirmation dialog for destructive actions.

// ── Retry handler API (P0-6). Set by error-recovery.mjs after a failed
// async op. `consumeRetryHandler()` is called by `keys.mjs` on `r` (before
// falling through to the per-tab refresh / Actions rerun). The footer reads
// appState._retryFn / _retryExpiresAt to render the "[r] to retry" hint.
// Calling setRetryHandler twice replaces the prior handler (no stacking).
// Calling clearRetryHandler drops any pending retry so a fresh error toast
// without a retry doesn't allow re-running an old operation. ──
export function setRetryHandler(fn, durationMs = 8000) {
  appState._retryFn = typeof fn === 'function' ? fn : null;
  appState._retryExpiresAt = Date.now() + Math.max(0, durationMs | 0);
  render();
}

export function clearRetryHandler() {
  appState._retryFn = null;
  appState._retryExpiresAt = 0;
  render();
}

// Atomically returns the current retry handler (if any) and clears it.
export function consumeRetryHandler() {
  if (!appState._retryFn || typeof appState._retryFn !== 'function') return null;
  if (Date.now() >= appState._retryExpiresAt) {
    appState._retryFn = null;
    appState._retryExpiresAt = 0;
    return null;
  }
  const fn = appState._retryFn;
  appState._retryFn = null;
  appState._retryExpiresAt = 0;
  return fn;
}

// insert/update an entity in the entityCache. Side-effect: keeps
// derived starred list membership in sync so viewers see the change
// without waiting for a server round-trip.
export function upsertEntity(repo, opts = {}) {
  if (!repo || !repo.full_name) return;
  const full = repo.full_name;
  const cur = appState.entityCache[full] || {};
  const next = {
    repo: { ...cur.repo, ...repo },
    isStarred: opts.isStarred !== undefined ? !!opts.isStarred : (cur.isStarred || false),
    isBookmarked: opts.isBookmarked !== undefined ? !!opts.isBookmarked : (cur.isBookmarked || false),
    isPinned: opts.isPinned !== undefined ? !!opts.isPinned : (cur.isPinned || false),
    isOwner: opts.isOwner !== undefined ? !!opts.isOwner : (cur.isOwner || false),
    starredAt: opts.starredAt || cur.starredAt || null,
  };
  appState.entityCache[full] = next;
  // Keep appState.starred synced.
  if (Array.isArray(appState.starred)) {
    const idx = appState.starred.findIndex(s => s.full_name === full);
    if (next.isStarred && idx === -1) {
      appState.starred.unshift({ ...next.repo, starred_at: next.starredAt || new Date().toISOString() });
    } else if (!next.isStarred && idx !== -1) {
      appState.starred.splice(idx, 1);
    } else if (idx !== -1) {
      appState.starred[idx] = { ...appState.starred[idx], ...next.repo, starred_at: next.starredAt || appState.starred[idx].starred_at };
    }
  }
}

// derived starred list — returns entities flagged isStarred, sorted
// by starredAt desc. Falls back to appState.starred when cache is empty.
export function getStarredList() {
  const cache = appState.entityCache;
  const fromCache = Object.keys(cache)
    .filter(k => cache[k] && cache[k].isStarred)
    .map(k => ({ ...cache[k].repo, starred_at: cache[k].starredAt }));
  if (fromCache.length > 0) {
    return fromCache.sort((a, b) => (b.starred_at || '').localeCompare(a.starred_at || ''));
  }
  return Array.isArray(appState.starred) ? appState.starred.slice() : [];
}

// derived unread count. Pure helper — bind to render() once per state
// mutation so callers don't need to recompute on every render call.
export function getUnreadCount() {
  const list = appState.notifications;
  if (!Array.isArray(list)) return 0;
  let n = 0;
  for (let i = 0; i < list.length; i++) if (list[i] && list[i].unread) n++;
  return n;
}

// watchdog timestamp — tracked via an Object.defineProperty setter
// on appState.loading so EVERY direct write (160+ sites) arms the
// watchdog for free, no manual sweep needed. checkLoadingWatchdog() is
// called from the render prologue and force-clears + surfaces a toast
// when an operation has been loading for >30s.
let _loadingStartedAt = 0;
export function setLoading(flag) {
  appState.loading = !!flag;
}
export function checkLoadingWatchdog(now = Date.now()) {
  if (!appState.loading || _loadingStartedAt === 0) return;
  // 30s stuck — force-clear and toast the user.
  if (now - _loadingStartedAt > 30000) {
    appState.loading = false;
    _loadingStartedAt = 0;
    // Abort every in-flight controller registered by startAsync() so the
    // late-arriving response doesn't silently clobber the cleared state.
    // Loop is idempotent — controllers that already completed are no-ops.
    for (const scope of Object.keys(asyncControllers)) {
      const ctl = asyncControllers[scope];
      if (ctl && typeof ctl.abort === 'function') {
        try { ctl.abort(); } catch { /* ignore */ }
      }
    }
    showMessage('Loading was taking too long — automatically cancelled. Press [r] to retry.', 'warning', 6000);
  }
}

// Install the setter shim AFTER setLoading is defined so re-entrant
// callers (setLoading itself) don't double-render and don't recurse.
// We replace the field-level `loading: false` with an accessor that
// stores to a hidden `_loading` while updating the watchdog timestamp.
// This preserves all existing direct-write call sites unchanged
// (assignments via `appState.loading = X` continue to work).
// Initialize `_loading` so the first read returns the original `false`
// value rather than undefined (which would still be falsy in conditions
// but is brittle under `=== false` strict comparisons).
appState._loading = false;
Object.defineProperty(appState, 'loading', {
  configurable: true,
  enumerable: true,
  get() { return this._loading === true; },
  set(v) {
    if (this._loading === !!v) return; // no-op when value didn't change
    this._loading = !!v;
    _loadingStartedAt = v ? Date.now() : 0;
  },
});

export function confirm(message, action, title = 'Confirm') {
  // instead of silently dropping, surface a warning so the user
  // understands why their clicked action didn't fire.
  if (appState.confirmAction) {
    showMessage('A confirmation is already pending — press y or n', 'warning');
    return;
  }
  appState.confirmMessage = message;
  appState.confirmAction = action;
  appState.confirmTitle = title;
  render();
}

export function dismissConfirm() {
  appState.confirmAction = null;
  appState.confirmMessage = '';
  appState.confirmTitle = 'Confirm';
  render();
}

// Recently viewed repos — used for breadcrumbs and quick re-open.

export function pushRecentRepo(repo) {
  if (!repo || !repo.full_name) return;
  // Move-to-front, dedupe, cap.
  appState.recentRepos = [
    { full_name: repo.full_name, url: repo.html_url, description: repo.description, language: repo.language, stars: repo.stargazers_count, visitedAt: Date.now() },
    ...appState.recentRepos.filter(r => r.full_name !== repo.full_name),
  ].slice(0, appState.MAX_RECENT);
  scheduleSessionSave();
}

// Collapsible sections — toggle, collapse all, expand all.
// Key: z (toggle), Z (collapse all), X (expand all).

export function isCollapsed(section) {
  return appState.collapsed[section] === true;
}

export function toggleCollapse(section) {
  appState.collapsed[section] = !appState.collapsed[section];
  saveCollapsed();
  render();
}

export function collapseAll(sections) {
  for (const s of sections) appState.collapsed[s] = true;
  saveCollapsed();
  render();
}

export function expandAll(sections) {
  for (const s of sections) appState.collapsed[s] = false;
  saveCollapsed();
  render();
}

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { APP_VERSION } from './config.mjs';

// ── Pure semver-like comparison. Exported for tests + onboarding version gate.
// Parses "0.6.6", "v1.0.0", "0.6.6-beta" etc. Returns -1 / 0 / 1.
// Pre-release tags sort BEFORE the matching released version ("1.0.0-rc1" < "1.0.0").
export function compareVersions(a, b) {
  function parse(v) {
    if (typeof v !== 'string') return { parts: [0, 0, 0], pre: '' };
    const cleaned = v.trim().replace(/^v/i, '');
    const [main, pre = ''] = cleaned.split('-');
    const parts = main.split('.').map(p => {
      const n = parseInt(p, 10);
      return isNaN(n) ? 0 : n;
    });
    while (parts.length < 3) parts.push(0);
    return { parts, pre };
  }
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.parts.length, pb.parts.length);
  for (let i = 0; i < len; i++) {
    const av = pa.parts[i] || 0;
    const bv = pb.parts[i] || 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre < pb.pre) return -1;
  if (pa.pre > pb.pre) return 1;
  return 0;
}

// shutdown-callback registry. app.mjs attaches a callback to
// clear the pending toast timer; modules can register their own cleanup steps.
// Idempotent registration (same fn twice is deduped).
const _shutdownCallbacks = [];
export function registerShutdownCallback(fn) {
  if (typeof fn !== 'function') return;
  if (_shutdownCallbacks.indexOf(fn) === -1) _shutdownCallbacks.push(fn);
}
export function runShutdownCallbacks() {
  for (const cb of _shutdownCallbacks) {
    try { cb(); } catch { /* swallow errors here — caller already handles */ }
  }
}

const COLLAPSED_PATH = join(homedir(), '.github-tui', 'collapsed.json');

function saveCollapsed() {
  try {
    const dir = join(homedir(), '.github-tui');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(COLLAPSED_PATH, JSON.stringify(appState.collapsed, null, 2));
  } catch {}
}

export function loadCollapsed() {
  try {
    if (existsSync(COLLAPSED_PATH)) {
      appState.collapsed = JSON.parse(readFileSync(COLLAPSED_PATH, 'utf8'));
    }
  } catch {}
}

// ── Per-widget loading state for dashboard ──
export function setWidgetLoading(widget, loading) {
  appState.dashboardLoadingWidgets[widget] = loading;
}

export function isWidgetLoading(widget) {
  return appState.dashboardLoadingWidgets[widget] === true;
}

// ── Session persistence — save/restore navigation state across restarts ──

const SESSION_PATH = join(homedir(), '.github-tui', 'session.json');

export function saveSession() {
  try {
    const session = {
      tab: tabState.current,
      recentRepos: appState.recentRepos,
      analyzeView: appState.analyzeView,
      searchQuery: appState.searchQuery,
      searchType: appState.searchType,
      reposView: appState.reposView,
      // Persist filter text too (Fix #9): without this the user comes back
      // and silently sees filtered results with no visual chip indicator.
      inboxTextFilter: appState.inboxTextFilter,
      // persist `lastSeenVersion` so the "what's new" overlay can be
      // auto-launched on upgrades (not just on first install). Falls back
      // to APP_VERSION when not set — this means an existing user whose
      // session.json predates the field will see "what's new" exactly once
      // on the next launch (currentVersion === APP_VERSION → not triggered).
      lastSeenVersion: appState.lastSeenVersion || null,
    };
    const dir = join(homedir(), '.github-tui');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2));
  } catch {}
}

export function loadSession() {
  try {
    if (!existsSync(SESSION_PATH)) return;
    const raw = readFileSync(SESSION_PATH, 'utf-8');
    const s = JSON.parse(raw);
    if (s.tab != null && s.tab >= 0 && s.tab < TABS.length) tabState.current = s.tab;
    if (s.recentRepos) appState.recentRepos = s.recentRepos;
    // Only restore analyzeView to 'search' — details/results data isn't persisted,
    // so restoring those views would show a blank page.
    if (s.analyzeView === 'search') appState.analyzeView = 'search';
    if (s.searchQuery) appState.searchQuery = s.searchQuery;
    if (s.searchType) appState.searchType = s.searchType;
    if (s.reposView) appState.reposView = s.reposView;
    if (typeof s.inboxTextFilter === 'string') appState.inboxTextFilter = s.inboxTextFilter;
    if (typeof s.lastSeenVersion === 'string') appState.lastSeenVersion = s.lastSeenVersion;
  } catch {}
}

// Auto-save on normal exit.
process.on('exit', saveSession);

// Debounced session save — called during normal operation so crashes lose less state.
let _sessionSaveTimer = null;
export function scheduleSessionSave() {
  if (_sessionSaveTimer) clearTimeout(_sessionSaveTimer);
  _sessionSaveTimer = setTimeout(saveSession, 2000);
}
