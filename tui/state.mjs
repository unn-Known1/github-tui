// Single source of truth for the entire app. Every other module imports from
// here. ESM live bindings mean mutations are visible everywhere immediately.
//
// We export a function `getRender()` (rather than importing render directly)
// to avoid an import cycle: state → render → state.

let renderFn = () => {};
export function bindRender(fn) { renderFn = fn; }
export function render() { renderFn(); }

// ────────────────────────────────────────────────────────────────────────────
// Async generation guard — every long-running operation grabs a generation
// number. If the user navigates away (or kicks off something newer) the
// generation increments and the stale operation's results are discarded.
// ────────────────────────────────────────────────────────────────────────────
let asyncGeneration = 0;
export function startAsync() { return ++asyncGeneration; }
export function isStale(gen) { return gen !== asyncGeneration; }

// ────────────────────────────────────────────────────────────────────────────
// Current tab index. 0-based. Drives the top tab strip and render dispatch.
// ────────────────────────────────────────────────────────────────────────────
export const TABS = [
  { key: '1', label: 'Dashboard' },
  { key: '2', label: 'Repos' },
  { key: '3', label: 'Analyze' },
  { key: '4', label: 'Actions' },
  { key: '5', label: 'Inbox' },
  { key: '6', label: 'Settings' },
];
export const tabState = { current: 0 };

export function setTab(i) {
  if (i < 0 || i >= TABS.length) return;
  tabState.current = i;
  render();
}

// ────────────────────────────────────────────────────────────────────────────
// Big shared state bag. Grouped by concern in comments for navigation.
// ────────────────────────────────────────────────────────────────────────────
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
  reposLangFilter: null,            // null = no language filter

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
  searchType: 'repos',    // 'repos' | 'users' | 'code'
  analyzeView: 'search',  // 'search' | 'results' | 'details' | 'forks'
  userSearchResults: [],   // user search results
  codeSearchResults: [],   // code search results
  codeSearchPage: 1,
  codeSearchHasMore: true,
  userSearchPage: 1,
  userSearchHasMore: true,
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
  dashboardFilter: '',
  starred: [],
  starredPage: 1,
  starredHasMore: false,
  dashboardLoaded: false,
  dashboardContributions: null,  // { weeks: [[day, day, ...], ...] } heatmap data
  dashboardRecentIssues: [],     // recently opened/updated issues across repos
  dashboardRecentPRs: [],        // recently opened/updated PRs across repos
  dashboardStaleCount: 0,        // repos with no push in 60+ days
  dashboardStaleRepos: [],       // stale repo names for display
  dashboardStarHistory: [],      // daily star counts for sparkline
  dashboardSelectedCard: 0,      // 0..4 stat-card focus for keyboard nav
  dashboardCardsFocus: false,    // true when keyboard focus is on a stat card

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

  // ── Inbox ──
  notifications: [],
  inboxScroll: 0,
  selectedNotification: 0,
  inboxFilter: 'all',    // 'all' | 'unread' | 'mentions' | 'review'
  inboxTextFilter: '',
  inboxPage: 1,
  inboxHasMore: true,

  // ── Settings ──
  settingsCursor: 0,
  _maxSettingsCursor: 5,

  // ── Global UI state ──
  loading: false,
  message: null,         // { text, type, icon? } | null
  messageTimer: null,
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

  // ── Rate-limit mirror (also lives in github.mjs but mirrored for render)
  rateLimit: { remaining: null, limit: null, reset: null },

  // ── Collapsible sections (persisted to disk) ──
  collapsed: {},  // { 'dashboard:profile': true, 'repos:pinned': false, ... }

  // Section header positions (populated by collapsibleHeader during render, consumed by mouse).
  _sectionHeaders: {},  // { 'dashboard:profile': { x: 2, y: 7 }, ... }

  // ── Mouse cursor position (0-based screen coords) ──
  _mouseSx: -1,
  _mouseSy: -1,
};

// ────────────────────────────────────────────────────────────────────────────
// Toast / status bar message bus.
// ────────────────────────────────────────────────────────────────────────────
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
    appState.message = null;
    render();
  }, durationMs);
  render();
}

export function clearMessage() {
  appState.message = null;
  if (appState.messageTimer) { clearTimeout(appState.messageTimer); appState.messageTimer = null; }
}

// ────────────────────────────────────────────────────────────────────────────
// Confirmation dialog for destructive actions.
// ────────────────────────────────────────────────────────────────────────────
export function confirm(message, action, title = 'Confirm') {
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

// ────────────────────────────────────────────────────────────────────────────
// Recently viewed repos — used for breadcrumbs and quick re-open.
// ────────────────────────────────────────────────────────────────────────────
export function pushRecentRepo(repo) {
  if (!repo || !repo.full_name) return;
  // Move-to-front, dedupe, cap.
  appState.recentRepos = [
    { full_name: repo.full_name, url: repo.html_url, description: repo.description, language: repo.language, stars: repo.stargazers_count, visitedAt: Date.now() },
    ...appState.recentRepos.filter(r => r.full_name !== repo.full_name),
  ].slice(0, appState.MAX_RECENT);
}

// ────────────────────────────────────────────────────────────────────────────
// Collapsible sections — toggle, collapse all, expand all.
// Key: z (toggle), Z (collapse all), X (expand all).
// ────────────────────────────────────────────────────────────────────────────
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
    if (s.analyzeView) appState.analyzeView = s.analyzeView;
    if (s.searchQuery) appState.searchQuery = s.searchQuery;
    if (s.searchType) appState.searchType = s.searchType;
    if (s.reposView) appState.reposView = s.reposView;
  } catch {}
}

// Auto-save on normal exit.
process.on('exit', saveSession);
process.on('SIGINT', () => { saveSession(); });
process.on('SIGTERM', () => { saveSession(); });
