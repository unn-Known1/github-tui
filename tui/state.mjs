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
  { key: '4', label: 'Settings' },
  { key: '5', label: 'Inbox' },
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
  repoFilter: '',

  // ── Analyze tab ──
  searchQuery: '',
  searchResults: [],
  searchPage: 1,
  searchHasMore: true,
  selectedRepo: 0,
  searchScroll: 0,
  analyzeView: 'search',  // 'search' | 'results' | 'details' | 'forks'
  detailsPane: 'overview', // 'overview' | 'issues' | 'prs'
  detailsScroll: 0,
  repoDetails: null,
  repoLanguages: null,
  repoContributors: [],
  repoReleases: [],
  repoIssues: [],
  repoPullRequests: [],

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
  starred: [],
  dashboardLoaded: false,

  // ── Inbox ──
  notifications: [],
  inboxScroll: 0,
  selectedNotification: 0,
  inboxFilter: 'all',    // 'all' | 'unread' | 'mentions' | 'review'

  // ── Settings ──
  settingsCursor: 0,
  _maxSettingsCursor: 5,

  // ── Global UI state ──
  loading: false,
  message: null,         // { text, type } | null
  messageTimer: null,
  showHelp: false,
  showPalette: false,
  paletteQuery: '',
  paletteCursor: 0,

  // ── Input modal ──
  inputMode: null,       // null | 'input'
  inputBuffer: '',
  inputPrompt: '',
  inputContext: null,    // 'login' | 'search' | 'filter' | 'palette' | ...
  inputMask: false,

  // ── Theme & bookmarks (v0.3+) ──
  themeName: 'default',
  bookmarks: [],         // [{ id, full_name, url, tags, addedAt }]
  savedSearches: [],     // [{ id, label, query }]

  // ── Rate-limit mirror (also lives in github.mjs but mirrored for render)
  rateLimit: { remaining: null, limit: null, reset: null },
};

// ────────────────────────────────────────────────────────────────────────────
// Toast / status bar message bus.
// ────────────────────────────────────────────────────────────────────────────
export function showMessage(text, type = 'info', durationMs = 3000) {
  appState.message = { text, type };
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
