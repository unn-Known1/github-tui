#!/usr/bin/env node

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, chmodSync } from 'fs';
import {
  getAuthenticatedUser,
  searchRepositories,
  getRepositoryDetails,
  getUserRepositories,
  getRepositoryForks,
  getCompare,
  getRepositoryIssues,
  getRepositoryPullRequests,
  getRepositoryContributors,
  getRepositoryLanguages,
  getRepositoryReleases,
  getNotifications,
  lastRateLimit,
} from './tui/github.mjs';
import { Screen } from './tui/screen.mjs';

const CONFIG_DIR = join(homedir(), '.github-tui');
const TOKEN_FILE = join(CONFIG_DIR, 'token');

const TABS = [
  { key: '1', label: 'Dashboard' },
  { key: '2', label: 'Repos' },
  { key: '3', label: 'Analyze' },
  { key: '4', label: 'Settings' },
  { key: '5', label: 'Inbox' },
];

const REPO_SORT_OPTIONS = [
  { field: 'name', label: 'Name', key: 'n' },
  { field: 'stars', label: '★ Stars', key: 's' },
  { field: 'forks', label: '⑂ Forks', key: 'f' },
  { field: 'issues', label: 'Issues', key: 'i' },
  { field: 'updated', label: 'Updated', key: 'u' },
];

const FORK_SORT_OPTIONS = [
  { field: 'pushed', label: 'Last Push', key: 'p' },
  { field: 'stars', label: '★ Stars', key: 's' },
  { field: 'name', label: 'Name', key: 'n' },
];

let currentTab = 0;
let screen = null;
let asyncGeneration = 0;

let appState = {
  token: null,
  user: null,
  repos: [],
  reposPage: 1,
  reposHasMore: true,
  repoSort: { field: 'updated', asc: false },
  searchQuery: '',
  searchResults: [],
  searchPage: 1,
  searchHasMore: true,
  selectedRepo: 0,
  repoDetails: null,
  analyzeView: 'search',
  forks: [],
  forkSort: { field: 'pushed', asc: false },
  selectedFork: 0,
  forkScroll: 0,
  loading: false,
  message: null,
  messageTimer: null,
  inputMode: null,
  inputBuffer: '',
  inputPrompt: '',
  inputContext: null,
  inputMask: false,
  settingsCursor: 0,
  repoScroll: 0,
  searchScroll: 0,
  // Phase B additions — extra repo data for the details view.
  repoLanguages: null,      // { JavaScript: 12345, CSS: 678, ... } bytes per lang
  repoContributors: [],     // top contributors
  repoReleases: [],         // recent releases
  repoIssues: [],           // open issues (excluding PRs)
  repoPullRequests: [],     // open PRs
  // Phase C additions — Inbox tab + rate limit display.
  notifications: [],
  inboxScroll: 0,
  selectedNotification: 0,
  rateLimit: { remaining: null, limit: null, reset: null },
  // Phase D additions — help overlay.
  showHelp: false,
};

function loadToken() {
  if (existsSync(TOKEN_FILE)) {
    return readFileSync(TOKEN_FILE, 'utf-8').trim();
  }
  return null;
}

function saveToken(token) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, token);
  // Lock down permissions so other users on a shared machine can't read the PAT.
  // chmod is a no-op on Windows but harmless.
  try {
    chmodSync(CONFIG_DIR, 0o700);
    chmodSync(TOKEN_FILE, 0o600);
  } catch {
    // Best-effort; ignore on platforms that don't support POSIX modes.
  }
}

function removeToken() {
  if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE);
}

function showMessage(text, type = 'info') {
  appState.message = { text, type };
  if (appState.messageTimer) clearTimeout(appState.messageTimer);
  appState.messageTimer = setTimeout(() => {
    appState.message = null;
    render();
  }, 3000);
}

function startAsync() {
  asyncGeneration++;
  return asyncGeneration;
}

function isStale(gen) {
  return gen !== asyncGeneration;
}

function startInput(prompt, context, mask = false) {
  appState.inputMode = 'input';
  appState.inputBuffer = '';
  appState.inputPrompt = prompt;
  appState.inputContext = context;
  appState.inputMask = mask;
  render();
}

function cancelInput() {
  const wasActive = appState.inputMode === 'input';
  appState.inputMode = null;
  appState.inputBuffer = '';
  appState.inputPrompt = '';
  appState.inputContext = null;
  appState.inputMask = false;
  if (wasActive) showMessage('Cancelled', 'info');
  render();
}

function sortRepos(repos, sort) {
  const sorted = [...repos];
  sorted.sort((a, b) => {
    let va, vb;
    switch (sort.field) {
      case 'name': va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase(); break;
      case 'stars': va = a.stargazers_count || 0; vb = b.stargazers_count || 0; break;
      case 'forks': va = a.forks_count || 0; vb = b.forks_count || 0; break;
      case 'issues': va = a.open_issues_count || 0; vb = b.open_issues_count || 0; break;
      case 'updated': va = new Date(a.updated_at).getTime(); vb = new Date(b.updated_at).getTime(); break;
      default: va = 0; vb = 0;
    }
    if (va < vb) return sort.asc ? -1 : 1;
    if (va > vb) return sort.asc ? 1 : -1;
    return 0;
  });
  return sorted;
}

function sortForks(forks, sort) {
  const sorted = [...forks];
  sorted.sort((a, b) => {
    let va, vb;
    switch (sort.field) {
      case 'pushed': va = new Date(a.pushed_at).getTime(); vb = new Date(b.pushed_at).getTime(); break;
      case 'stars': va = a.stargazers_count || 0; vb = b.stargazers_count || 0; break;
      case 'name': va = (a.full_name || '').toLowerCase(); vb = (b.full_name || '').toLowerCase(); break;
      default: va = 0; vb = 0;
    }
    if (va < vb) return sort.asc ? -1 : 1;
    if (va > vb) return sort.asc ? 1 : -1;
    return 0;
  });
  return sorted;
}

function toggleRepoSort(field) {
  if (appState.repoSort.field === field) {
    appState.repoSort.asc = !appState.repoSort.asc;
  } else {
    appState.repoSort.field = field;
    appState.repoSort.asc = field === 'name';
  }
  appState.repoScroll = 0;
  render();
}

function toggleForkSort(field) {
  if (appState.forkSort.field === field) {
    appState.forkSort.asc = !appState.forkSort.asc;
  } else {
    appState.forkSort.field = field;
    appState.forkSort.asc = field === 'name';
  }
  appState.forkScroll = 0;
  render();
}

const REPOS_PER_PAGE = 30;
const SEARCH_PER_PAGE = 15;

// Visible-row helpers — single source of truth so renderers and key handlers
// can't drift apart (which previously caused scroll-past-end bugs).
function reposVisibleRows() {
  // renderRepos uses (h - 8) where h = H - 10 → H - 18
  return Math.max(1, screen.height - 18);
}
function analyzeListVisibleRows() {
  // renderAnalyze caps at 6 rows by design.
  return Math.max(1, Math.min(6, screen.height - 16));
}

async function loadUserData() {
  if (!appState.token) return;
  const gen = startAsync();
  appState.loading = true;
  render();
  try {
    appState.user = await getAuthenticatedUser(appState.token);
    if (isStale(gen)) return;
    if (appState.user) {
      appState.repos = await getUserRepositories(appState.token, 1, REPOS_PER_PAGE);
      appState.reposPage = 1;
      appState.reposHasMore = appState.repos.length >= REPOS_PER_PAGE;
      if (isStale(gen)) return;
    }
  } catch (e) {
    if (!isStale(gen)) {
      const msg = (e && e.message) || '';
      // Auto-clear stored token on auth failure so user isn't stuck
      if (/401|Bad credentials|Unauthorized/i.test(msg)) {
        removeToken();
        appState.token = null;
        appState.user = null;
        appState.repos = [];
        currentTab = 3; // Jump to Settings so user can re-login
        showMessage('Stored token rejected by GitHub — please log in again', 'error');
      } else {
        showMessage(`Failed to load user data: ${msg || 'unknown error'}`, 'error');
      }
    }
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

async function loadMoreRepos() {
  if (!appState.token || !appState.reposHasMore) return;
  const gen = startAsync();
  appState.loading = true;
  render();
  try {
    const page = appState.reposPage + 1;
    const more = await getUserRepositories(appState.token, page, REPOS_PER_PAGE);
    if (isStale(gen)) return;
    appState.repos = [...appState.repos, ...more];
    appState.reposPage = page;
    appState.reposHasMore = more.length >= REPOS_PER_PAGE;
    showMessage(`Loaded ${appState.repos.length} repos total`, 'info');
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to load more repos', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

async function submitSearch() {
  const query = appState.inputBuffer.trim();
  if (!query) { cancelInput(); return; }

  const gen = startAsync();
  appState.loading = true;
  appState.searchQuery = query;
  appState.inputMode = null;
  appState.inputBuffer = '';
  appState.inputPrompt = '';
  appState.inputContext = null;
  appState.repoDetails = null;
  appState.forks = [];
  appState.selectedRepo = 0;
  appState.searchScroll = 0;
  appState.searchPage = 1;
  appState.analyzeView = 'results';
  render();

  try {
    const results = await searchRepositories(appState.token, query, 1, SEARCH_PER_PAGE);
    if (isStale(gen)) return;
    appState.searchResults = results;
    appState.searchHasMore = results.length >= SEARCH_PER_PAGE;
    if (results.length === 0) showMessage('No repositories found', 'warning');
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Search failed', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

async function loadMoreSearchResults() {
  if (!appState.searchHasMore) return;
  const gen = startAsync();
  appState.loading = true;
  render();
  try {
    const page = appState.searchPage + 1;
    const more = await searchRepositories(appState.token, appState.searchQuery, page, SEARCH_PER_PAGE);
    if (isStale(gen)) return;
    appState.searchResults = [...appState.searchResults, ...more];
    appState.searchPage = page;
    appState.searchHasMore = more.length >= SEARCH_PER_PAGE;
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Failed to load more', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

async function submitLogin() {
  const token = appState.inputBuffer.trim();
  appState.inputMode = null;
  appState.inputBuffer = '';

  if (!token) {
    showMessage('Token cannot be empty', 'error');
    render();
    return;
  }

  const gen = startAsync();
  appState.loading = true;
  render();

  try {
    const user = await getAuthenticatedUser(token);
    if (isStale(gen)) return;
    if (user) {
      saveToken(token);
      appState.token = token;
      appState.user = user;
      appState.repos = await getUserRepositories(token, 1, REPOS_PER_PAGE);
      appState.reposPage = 1;
      appState.reposHasMore = appState.repos.length >= REPOS_PER_PAGE;
      showMessage(`Logged in as ${user.login}`, 'success');
    } else {
      showMessage('Invalid token', 'error');
    }
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Login failed', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

async function loadRepoDetails(owner, name) {
  const gen = startAsync();
  appState.loading = true;
  // Reset any stale enriched data from a previous repo so old contributors
  // don't briefly render under a new repo's name.
  appState.repoLanguages = null;
  appState.repoContributors = [];
  appState.repoReleases = [];
  appState.repoIssues = [];
  appState.repoPullRequests = [];
  render();
  try {
    const details = await getRepositoryDetails(appState.token, owner, name);
    if (isStale(gen)) return;
    appState.repoDetails = details;
    appState.analyzeView = 'details';
    render();

    // Fan-out the enrichment calls in parallel. Each one is best-effort — a
    // single 404 (e.g. disabled issues) must not blow up the details view.
    const safe = (p) => p.catch(() => null);
    const [langs, contribs, releases, issues, prs] = await Promise.all([
      safe(getRepositoryLanguages(appState.token, owner, name)),
      safe(getRepositoryContributors(appState.token, owner, name, 1, 10)),
      safe(getRepositoryReleases(appState.token, owner, name, 1, 5)),
      safe(getRepositoryIssues(appState.token, owner, name, 1, 10)),
      safe(getRepositoryPullRequests(appState.token, owner, name, 1, 10)),
    ]);
    if (isStale(gen)) return;

    appState.repoLanguages = langs || null;
    appState.repoContributors = Array.isArray(contribs) ? contribs : [];
    appState.repoReleases = Array.isArray(releases) ? releases : [];
    // The /issues endpoint returns PRs too; filter them out so the counts are honest.
    appState.repoIssues = Array.isArray(issues) ? issues.filter(i => !i.pull_request) : [];
    appState.repoPullRequests = Array.isArray(prs) ? prs : [];

    showMessage(`Loaded ${owner}/${name}`, 'success');
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Failed to load repository', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

async function loadForks() {
  const repo = appState.repoDetails;
  if (!repo) return;

  const gen = startAsync();
  appState.loading = true;
  appState.analyzeView = 'forks';
  appState.forks = [];
  appState.selectedFork = 0;
  appState.forkScroll = 0;
  render();

  try {
    const [owner, name] = repo.full_name.split('/');
    const forks = await getRepositoryForks(appState.token, owner, name, 1, 30);
    if (isStale(gen)) return;
    appState.forks = forks;

    const defaultBranch = repo.default_branch || 'main';

    // Run compares in parallel with a small concurrency cap so we don't
    // hammer the API (and don't get throttled). Previously this loop was
    // serial: 30 forks → 30 round-trips back-to-back.
    const CONCURRENCY = 5;
    let cursor = 0;
    let completed = 0;
    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= forks.length) return;
        if (isStale(gen)) return;
        const forkOwner = forks[i].owner?.login;
        if (!forkOwner) { completed++; continue; }
        try {
          const compare = await getCompare(
            appState.token, owner, name, defaultBranch, `${forkOwner}:${defaultBranch}`
          );
          if (isStale(gen)) return;
          appState.forks[i]._aheadBehind = compare
            ? { ahead: compare.ahead_by || 0, behind: compare.behind_by || 0 }
            : { ahead: 0, behind: 0 };
        } catch {
          appState.forks[i]._aheadBehind = { ahead: 0, behind: 0 };
        }
        completed++;
        // Progressive render every few completions for a live progress feel.
        if (completed % 5 === 0 && !isStale(gen)) render();
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (!isStale(gen)) showMessage(`Loaded ${forks.length} forks`, 'success');
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Failed to load forks', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

async function loadNotifications() {
  if (!appState.token) {
    showMessage('Login required to view notifications', 'warning');
    return;
  }
  const gen = startAsync();
  appState.loading = true;
  render();
  try {
    const notes = await getNotifications(appState.token);
    if (isStale(gen)) return;
    appState.notifications = Array.isArray(notes) ? notes : [];
    appState.inboxScroll = 0;
    appState.selectedNotification = 0;
    showMessage(`Loaded ${appState.notifications.length} notifications`, 'success');
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Failed to load notifications', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

// Cross-platform browser open. Uses spawn instead of exec so a URL containing
// shell metacharacters can't trigger a command injection.
async function openInBrowser(url) {
  if (!url) { showMessage('No URL to open', 'warning'); return; }
  try {
    const { spawn } = await import('child_process');
    const platform = process.platform;
    let cmd, args;
    if (platform === 'darwin')      { cmd = 'open';     args = [url]; }
    else if (platform === 'win32')  { cmd = 'cmd';      args = ['/c', 'start', '""', url]; }
    else                            { cmd = 'xdg-open'; args = [url]; }
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => showMessage('Could not open browser', 'error'));
    child.unref();
    showMessage(`Opened ${url}`, 'success');
  } catch (e) {
    showMessage(`Open failed: ${e.message}`, 'error');
  }
}

async function handleLogout() {
  appState.token = null;
  appState.user = null;
  appState.repos = [];
  appState.reposPage = 1;
  appState.reposHasMore = true;
  removeToken();
  showMessage('Logged out', 'success');
  render();
}

function render() {
  if (!screen) return;
  const W = screen.width;
  const H = screen.height;
  screen.clear();

  screen.box(0, 0, W, 3, 'GitHub TUI');
  if (appState.user) {
    screen.writeStr(2, 1, `Welcome, ${appState.user.login}`);
  } else {
    screen.writeStr(2, 1, 'Not authenticated', 'dim');
  }

  // Rate-limit indicator, top-right. Colored by severity so the user sees
  // problems before they hit them.
  if (lastRateLimit.remaining !== null && lastRateLimit.limit !== null) {
    const r = lastRateLimit.remaining;
    const lim = lastRateLimit.limit;
    const txt = `API ${r}/${lim}`;
    const color = r === 0 ? 'red' : (r < lim * 0.1 ? 'yellow' : 'dim');
    screen.writeStr(Math.max(2, W - txt.length - 2), 1, txt, color);
  }

  screen.hline(3, '─');

  const tabWidth = Math.floor((W - 2) / TABS.length);
  TABS.forEach((tab, i) => {
    const isActive = i === currentTab;
    const bx = 1 + i * tabWidth;
    const label = `[${tab.key}] ${tab.label}`;
    const pad = Math.floor((tabWidth - label.length) / 2);
    const tx = bx + Math.max(0, pad);
    screen.writeStr(tx, 5, label, isActive ? 'bright' : 'dim');
  });

  screen.hline(6, '─');

  const contentY = 7;
  const contentH = H - 10;

  switch (currentTab) {
    case 0: renderDashboard(contentY, contentH); break;
    case 1: renderRepos(contentY, contentH); break;
    case 2: renderAnalyze(contentY, contentH); break;
    case 3: renderSettings(contentY, contentH); break;
    case 4: renderInbox(contentY, contentH); break;
  }

  // Help overlay sits on top of everything so it's always reachable.
  if (appState.showHelp) renderHelp();

  screen.hline(H - 3, '─');

  // Global input overlay — shown above the status bar regardless of active tab.
  // Without this, login input (which lives on the Settings tab) was invisible.
  if (appState.inputMode === 'input') {
    const shown = appState.inputMask ? '•'.repeat(appState.inputBuffer.length) : appState.inputBuffer;
    const line = `${appState.inputPrompt}${shown}█`;
    screen.writeStr(1, H - 4, line.substring(0, W - 2), 'cyan');
  }

  if (appState.message) {
    const colors = { info: 'cyan', success: 'green', error: 'red', warning: 'yellow' };
    screen.writeStr(1, H - 2, appState.message.text.substring(0, W - 2), colors[appState.message.type]);
  } else {
    let statusLeft;
    if (appState.inputMode) {
      statusLeft = `[ESC] Cancel  [Enter] Confirm`;
    } else if (currentTab === 1) {
      statusLeft = `[n/s/f/i/u] Sort  [↑↓jk] Nav  [Space] Load more  [q] Quit`;
    } else if (currentTab === 2) {
      const v = appState.analyzeView;
      if (v === 'search') statusLeft = `[Enter/i] Search  [1-4] Tabs  [q] Quit`;
      else if (v === 'results') statusLeft = `[↑↓jk] Nav  [Enter] View  [Space] More  [Esc/i] Back  [q] Quit`;
      else if (v === 'details') statusLeft = `[Enter] Forks  [Esc/h] Back  [1-4] Tabs  [q] Quit`;
      else if (v === 'forks') statusLeft = `[↑↓jk] Nav  [p/s/n] Sort  [Esc/h] Back  [q] Quit`;
    } else if (currentTab === 4) {
      statusLeft = `[↑↓jk] Nav  [Enter] Open  [r] Refresh  [o] Browser  [?] Help  [q] Quit`;
    } else {
      statusLeft = `[1-5] Tabs  [↑↓jk] Nav  [Enter] Select  [?] Help  [q] Quit`;
    }
    screen.writeStr(1, H - 2, statusLeft.substring(0, W - 2), 'dim');
  }

  if (appState.loading) {
    screen.writeStr(W - 14, 1, '⟳ Loading...', 'cyan');
  }

  screen.render();
}

function renderDashboard(y, h) {
  const W = screen.width;
  const user = appState.user;

  if (!user) {
    screen.writeStr(4, y + 2, 'Not authenticated. Go to Settings [4] to login.', 'dim');
    return;
  }

  screen.writeStr(4, y, 'Account Information', 'bright');
  screen.hline(y + 1, '─');

  const info = [
    ['Login:', user.login],
    ['Name:', user.name || 'N/A'],
    ['Email:', user.email || 'N/A'],
    ['Bio:', user.bio || 'N/A'],
    ['Public Repos:', String(user.public_repos || 0)],
    ['Private Repos:', String(user.total_private_repos || 0)],
    ['Followers:', String(user.followers || 0)],
    ['Following:', String(user.following || 0)],
  ];

  info.forEach(([key, val], i) => {
    if (y + 2 + i >= y + h) return;
    screen.writeStr(4, y + 2 + i, key, 'bright');
    screen.writeStr(18, y + 2 + i, String(val).substring(0, W - 22));
  });

  const repoY = y + 12;
  if (repoY + 1 >= y + h) return;

  screen.writeStr(4, repoY, 'Recent Repositories', 'bright');
  screen.hline(repoY + 1, '─');

  const repos = appState.repos.slice(0, Math.min(5, h - 16));
  repos.forEach((repo, i) => {
    if (repoY + 2 + i >= y + h) return;
    screen.writeStr(4, repoY + 2 + i, `● ${repo.name}`);
    screen.writeStr(32, repoY + 2 + i, `★${repo.stargazers_count} ⑂${repo.forks_count}`, 'dim');
  });
}

function renderRepos(y, h) {
  const W = screen.width;
  const repos = sortRepos(appState.repos, appState.repoSort);

  if (!repos || repos.length === 0) {
    screen.writeStr(4, y + 2, 'No repositories found', 'dim');
    return;
  }

  screen.writeStr(4, y, 'Your Repositories', 'bright');
  screen.hline(y + 1, '─');

  const sortInfo = REPO_SORT_OPTIONS.find(o => o.field === appState.repoSort.field);
  const sortDir = appState.repoSort.asc ? '↑' : '↓';
  screen.writeStr(4, y + 2, `Sort: ${sortInfo.label} ${sortDir}`, 'cyan');

  const sortKeys = REPO_SORT_OPTIONS.map(o => `[${o.key}]${o.label}`).join('  ');
  screen.writeStr(4, y + 3, sortKeys, 'dim');

  const headerY = y + 4;
  screen.writeStr(4, headerY, 'Name', 'bright');
  screen.writeStr(28, headerY, '★ Stars', 'bright');
  screen.writeStr(38, headerY, '⑂ Forks', 'bright');
  screen.writeStr(48, headerY, 'Issues', 'bright');
  screen.writeStr(58, headerY, 'Updated', 'bright');

  const maxRows = Math.min(repos.length, h - 8);
  const start = appState.repoScroll;

  for (let i = 0; i < maxRows && start + i < repos.length; i++) {
    const repo = repos[start + i];
    const row = headerY + 1 + i;
    screen.writeStr(4, row, (repo.name || 'N/A').substring(0, 23));
    screen.writeStr(28, row, String(repo.stargazers_count || 0));
    screen.writeStr(38, row, String(repo.forks_count || 0));
    screen.writeStr(48, row, String(repo.open_issues_count || 0));
    screen.writeStr(58, row, new Date(repo.updated_at).toLocaleDateString());
  }

  const infoY = headerY + 1 + maxRows + 1;
  if (infoY < y + h) {
    const range = `${start + 1}-${Math.min(start + maxRows, repos.length)} of ${repos.length}`;
    const more = appState.reposHasMore ? '  [Space] Load more' : '';
    screen.writeStr(4, infoY, range + more, 'dim');
  }
}

function renderAnalyze(y, h) {
  const W = screen.width;
  const view = appState.analyzeView;

  screen.writeStr(4, y, 'Analyze Public Repository', 'bright');
  screen.hline(y + 1, '─');

  if (view === 'search') {
    screen.writeStr(4, y + 2, 'Search:', 'bright');
    if (appState.inputMode) {
      const shown = appState.inputMask ? '•'.repeat(appState.inputBuffer.length) : appState.inputBuffer;
      screen.writeStr(12, y + 2, `${appState.inputPrompt}${shown}█`.substring(0, W - 16));
    } else {
      screen.writeStr(12, y + 2, '(press Enter or i to search)', 'dim');
    }
    screen.writeStr(4, y + 4, 'Search for any public GitHub repository to analyze.', 'dim');
    screen.writeStr(4, y + 5, 'Type owner/repo or keywords, then press Enter.', 'dim');
    return;
  }

  screen.writeStr(4, y + 2, 'Search:', 'bright');
  screen.writeStr(12, y + 2, appState.searchQuery || '');

  const listY = y + 4;
  const maxVisible = Math.min(6, h - 10);

  if (view !== 'forks' && appState.searchResults.length > 0) {
    screen.writeStr(4, listY, `Results: ↑↓ navigate  Enter view details  Esc back`, 'dim');
    screen.hline(listY + 1, '─');

    const start = appState.searchScroll;
    for (let i = 0; i < maxVisible && start + i < appState.searchResults.length; i++) {
      const repo = appState.searchResults[start + i];
      const row = listY + 2 + i;
      const sel = start + i === appState.selectedRepo;

      screen.writeStr(4, row, sel ? ' ▶' : '  ');
      screen.writeStr(7, row, repo.full_name.substring(0, 28), sel ? 'bright' : null);
      screen.writeStr(36, row, `★${repo.stargazers_count} ⑂${repo.forks_count} ⚡${repo.open_issues_count}`, 'dim');
    }

    const countY = listY + 2 + maxVisible;
    if (countY < y + h) {
      const total = appState.searchResults.length;
      const more = appState.searchHasMore ? '  [Space] More' : '';
      screen.writeStr(4, countY, `${total} results` + more, 'dim');
    }
  }

  if (view === 'details' && appState.repoDetails) {
    renderRepoDetails(listY, h - 6);
  }

  if (view === 'forks') {
    renderForks(listY, h - 6);
  }
}

function renderRepoDetails(y, maxH) {
  const repo = appState.repoDetails;
  if (!repo) return;
  const W = screen.width;

  screen.writeStr(4, y, `▸ ${repo.full_name}`, 'bright');
  screen.hline(y + 1, '─');

  // Left column: factual metadata.
  const leftWidth = Math.min(48, Math.floor(W / 2));
  const details = [
    ['Description:', repo.description || 'N/A'],
    ['Language:', repo.language || 'N/A'],
    ['Stars:', String(repo.stargazers_count || 0)],
    ['Forks:', String(repo.forks_count || 0)],
    ['Open Issues:', String(appState.repoIssues.length || repo.open_issues_count || 0)],
    ['Open PRs:', String(appState.repoPullRequests.length || 0)],
    ['Watchers:', String(repo.watchers_count || 0)],
    ['Size:', `${Math.round((repo.size || 0) / 1024)} MB`],
    ['License:', repo.license?.name || 'N/A'],
    ['Default:', repo.default_branch || 'main'],
    ['Created:', new Date(repo.created_at).toLocaleDateString()],
    ['Updated:', new Date(repo.updated_at).toLocaleDateString()],
    ['URL:', repo.html_url],
  ];

  const rows = Math.min(details.length, maxH - 3);
  for (let i = 0; i < rows; i++) {
    const [key, val] = details[i];
    screen.writeStr(4, y + 2 + i, key, 'bright');
    screen.writeStr(18, y + 2 + i, String(val).substring(0, leftWidth - 14));
  }

  // Right column: enriched data (languages bar, top contributors, latest releases).
  const rightX = leftWidth + 6;
  if (rightX + 20 < W) {
    let ry = y + 2;

    // --- Languages bar ---
    if (appState.repoLanguages && Object.keys(appState.repoLanguages).length > 0) {
      screen.writeStr(rightX, ry++, 'Languages', 'bright');
      const total = Object.values(appState.repoLanguages).reduce((a, b) => a + b, 0);
      const sorted = Object.entries(appState.repoLanguages).sort((a, b) => b[1] - a[1]);
      const barWidth = Math.min(30, W - rightX - 18);
      for (const [lang, bytes] of sorted.slice(0, 5)) {
        if (ry >= y + maxH - 1) break;
        const pct = total ? bytes / total : 0;
        const filled = Math.max(1, Math.round(pct * barWidth));
        const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, barWidth - filled));
        screen.writeStr(rightX, ry, lang.substring(0, 12).padEnd(13), null);
        screen.writeStr(rightX + 13, ry, bar, 'cyan');
        screen.writeStr(rightX + 14 + barWidth, ry, `${(pct * 100).toFixed(1)}%`, 'dim');
        ry++;
      }
      ry++;
    }

    // --- Top contributors ---
    if (appState.repoContributors.length > 0 && ry < y + maxH - 2) {
      screen.writeStr(rightX, ry++, 'Top Contributors', 'bright');
      for (const c of appState.repoContributors.slice(0, 5)) {
        if (ry >= y + maxH - 1) break;
        screen.writeStr(rightX, ry, `● ${c.login || '?'}`.substring(0, 24));
        screen.writeStr(rightX + 26, ry, `${c.contributions || 0} commits`, 'dim');
        ry++;
      }
      ry++;
    }

    // --- Latest releases ---
    if (appState.repoReleases.length > 0 && ry < y + maxH - 2) {
      screen.writeStr(rightX, ry++, 'Latest Releases', 'bright');
      for (const rel of appState.repoReleases.slice(0, 3)) {
        if (ry >= y + maxH - 1) break;
        const tag = (rel.tag_name || rel.name || '?').substring(0, 18);
        const when = rel.published_at ? new Date(rel.published_at).toLocaleDateString() : '';
        screen.writeStr(rightX, ry, `▸ ${tag}`);
        screen.writeStr(rightX + 22, ry, when, 'dim');
        ry++;
      }
    }
  }

  const forkRow = y + 2 + rows + 1;
  if (forkRow < y + maxH) {
    screen.writeStr(4, forkRow, '▶ [Enter] View Forks  [o] Open in browser  [r] Refresh', 'cyan');
  }
}

function renderForks(y, maxH) {
  const W = screen.width;
  const forks = sortForks(appState.forks, appState.forkSort);

  screen.writeStr(4, y, `Forks of ${appState.repoDetails?.full_name || 'repo'}`, 'bright');
  screen.hline(y + 1, '─');

  const sortInfo = FORK_SORT_OPTIONS.find(o => o.field === appState.forkSort.field);
  const sortDir = appState.forkSort.asc ? '↑' : '↓';
  screen.writeStr(4, y + 2, `Sort: ${sortInfo.label} ${sortDir}`, 'cyan');

  const sortKeys = FORK_SORT_OPTIONS.map(o => `[${o.key}]${o.label}`).join('  ');
  screen.writeStr(4, y + 3, sortKeys, 'dim');

  const headerY = y + 4;
  screen.writeStr(4, headerY, 'Fork Owner', 'bright');
  screen.writeStr(28, headerY, '★ Stars', 'bright');
  screen.writeStr(38, headerY, '⑂ Forks', 'bright');
  screen.writeStr(48, headerY, 'Last Push', 'bright');
  screen.writeStr(62, headerY, 'Ahead', 'bright');

  if (forks.length === 0 && !appState.loading) {
    screen.writeStr(4, headerY + 1, 'No forks found', 'dim');
    return;
  }

  const maxRows = Math.min(forks.length, maxH - 7);
  const start = appState.forkScroll;

  for (let i = 0; i < maxRows && start + i < forks.length; i++) {
    const fork = forks[start + i];
    const row = headerY + 1 + i;
    const sel = start + i === appState.selectedFork;

    screen.writeStr(4, row, sel ? ' ▶' : '  ');
    screen.writeStr(7, row, (fork.owner?.login || fork.full_name.split('/')[0]).substring(0, 20), sel ? 'bright' : null);
    screen.writeStr(28, row, String(fork.stargazers_count || 0));
    screen.writeStr(38, row, String(fork.forks_count || 0));
    screen.writeStr(48, row, new Date(fork.pushed_at).toLocaleDateString(), 'dim');

    if (fork._aheadBehind) {
      screen.writeStr(62, row, `+${fork._aheadBehind.ahead}`, 'green');
      if (fork._aheadBehind.behind > 0) {
        screen.writeStr(68, row, `-${fork._aheadBehind.behind}`, 'red');
      }
    }
  }

  const infoY = headerY + 1 + maxRows + 1;
  if (infoY < y + maxH) {
    screen.writeStr(4, infoY, `Esc back  [p/s/n] Sort`, 'dim');
  }
}

function renderSettings(y, h) {
  const W = screen.width;
  const isLoggedIn = !!appState.token;

  screen.writeStr(4, y, 'Settings', 'bright');
  screen.hline(y + 1, '─');

  const items = [
    { label: 'Login', desc: isLoggedIn ? 'Already logged in' : 'Press Enter to login', enabled: !isLoggedIn },
    { label: 'Logout', desc: isLoggedIn ? 'Press Enter to logout' : 'Not logged in', enabled: isLoggedIn },
    { label: 'Token', desc: isLoggedIn ? '••••••••••••' : 'Not set', enabled: false },
  ];

  items.forEach((item, i) => {
    const row = y + 2 + i;
    const sel = appState.settingsCursor === i;
    screen.writeStr(4, row, sel ? ' ▶ ' : '   ');
    screen.writeStr(7, row, item.label, sel ? 'bright' : null);
    screen.writeStr(24, row, item.desc, item.enabled ? 'dim' : 'dim');
  });

  const helpY = y + 7;
  if (helpY + 3 < y + h) {
    screen.writeStr(4, helpY, 'Keys:', 'bright');
    screen.writeStr(4, helpY + 1, '  ↑/↓ or j/k  Navigate', 'dim');
    screen.writeStr(4, helpY + 2, '  Enter        Select', 'dim');
  }

  if (isLoggedIn && appState.user) {
    const infoY = helpY + 5;
    if (infoY + 2 < y + h) {
      screen.writeStr(4, infoY, `Logged in as: ${appState.user.login}`, 'cyan');
      screen.writeStr(4, infoY + 1, `Repos: ${appState.repos.length}`, 'dim');
    }
  }
}

function renderInbox(y, h) {
  const W = screen.width;
  screen.writeStr(4, y, 'Notifications', 'bright');
  screen.hline(y + 1, '─');

  if (!appState.token) {
    screen.writeStr(4, y + 2, 'Login required. Go to Settings [4].', 'dim');
    return;
  }

  if (appState.notifications.length === 0) {
    screen.writeStr(4, y + 2, appState.loading
      ? 'Loading…'
      : 'Press [r] to refresh — your inbox may simply be empty.', 'dim');
    return;
  }

  const headerY = y + 2;
  screen.writeStr(4, headerY, 'Repo', 'bright');
  screen.writeStr(36, headerY, 'Type', 'bright');
  screen.writeStr(48, headerY, 'Reason', 'bright');
  screen.writeStr(64, headerY, 'When', 'bright');

  const maxRows = Math.max(1, h - 5);
  const start = appState.inboxScroll;
  const list = appState.notifications;

  for (let i = 0; i < maxRows && start + i < list.length; i++) {
    const n = list[start + i];
    const row = headerY + 1 + i;
    const sel = start + i === appState.selectedNotification;
    const unread = n.unread;

    screen.writeStr(2, row, sel ? '▶' : ' ');
    screen.writeStr(4, row, (n.repository?.full_name || '?').substring(0, 30),
      sel ? 'bright' : (unread ? null : 'dim'));
    screen.writeStr(36, row, (n.subject?.type || '?').substring(0, 10), 'dim');
    screen.writeStr(48, row, (n.reason || '?').substring(0, 14), 'dim');
    const when = n.updated_at ? new Date(n.updated_at).toLocaleDateString() : '';
    screen.writeStr(64, row, when, 'dim');
  }

  const infoY = headerY + 1 + Math.min(maxRows, list.length) + 1;
  if (infoY < y + h) {
    screen.writeStr(4, infoY,
      `${list.length} total  [r] Refresh  [↑↓jk] Nav  [Enter] Open`, 'dim');
  }
}

function renderHelp() {
  const W = screen.width;
  const H = screen.height;
  const lines = [
    'Keyboard Shortcuts',
    '',
    '  1-5 / Tab       Switch tabs',
    '  ↑↓ or j/k       Navigate lists',
    '  Enter           Select / drill in',
    '  Esc / h         Back',
    '  Space           Load more',
    '  /               Filter repos (Repos tab)',
    '  o               Open in browser',
    '  r               Refresh current view',
    '  ?               Toggle this help',
    '  q / Ctrl-C      Quit',
    '',
    '  Repos sort:  n=name s=stars f=forks i=issues u=updated',
    '  Forks sort:  p=pushed s=stars n=name',
    '',
    'Press any key to close',
  ];
  // Centered modal box.
  const boxW = Math.min(60, W - 4);
  const boxH = Math.min(lines.length + 4, H - 4);
  const x0 = Math.floor((W - boxW) / 2);
  const y0 = Math.floor((H - boxH) / 2);

  // Clear the area behind the modal so it actually looks like an overlay.
  for (let yy = y0; yy < y0 + boxH; yy++) {
    for (let xx = x0; xx < x0 + boxW; xx++) {
      screen.setCell(xx, yy, ' ', null);
    }
  }
  screen.box(x0, y0, boxW, boxH, 'Help');
  for (let i = 0; i < lines.length && i < boxH - 3; i++) {
    const style = i === 0 ? 'bright' : (lines[i].startsWith('  ') ? null : 'cyan');
    screen.writeStr(x0 + 2, y0 + 1 + i, lines[i].substring(0, boxW - 4), style);
  }
}

function handleKey(key) {
  // Help overlay swallows the next key, whatever it is.
  if (appState.showHelp) {
    appState.showHelp = false;
    render();
    return;
  }

  if (appState.inputMode === 'input') {
    if (key === '\r' || key === '\n') {
      const ctx = appState.inputContext;
      if (ctx === 'search') submitSearch();
      else if (ctx === 'login') submitLogin();
    } else if (key === '\x1b') {
      cancelInput();
    } else if (key === '\x7f' || key === '\b') {
      appState.inputBuffer = appState.inputBuffer.slice(0, -1);
      render();
    } else if (key.length === 1 && key.charCodeAt(0) >= 32) {
      appState.inputBuffer += key;
      render();
    }
    return;
  }

  switch (key) {
    case '1': case '2': case '3': case '4': case '5':
      currentTab = parseInt(key) - 1;
      // Auto-load notifications the first time the user lands on Inbox.
      if (currentTab === 4 && appState.notifications.length === 0 && appState.token) {
        loadNotifications();
      }
      render();
      break;

    case '?':
      appState.showHelp = true;
      render();
      break;

    case 'r':
      // Context-sensitive refresh.
      if (currentTab === 0 || currentTab === 1) loadUserData();
      else if (currentTab === 4) loadNotifications();
      else if (currentTab === 2 && appState.analyzeView === 'details' && appState.repoDetails) {
        const [o, n] = appState.repoDetails.full_name.split('/');
        loadRepoDetails(o, n);
      }
      break;

    case 'o': {
      // Open whatever the cursor points at in the browser.
      let url = null;
      if (currentTab === 2) {
        const v = appState.analyzeView;
        if (v === 'results' && appState.searchResults[appState.selectedRepo]) {
          url = appState.searchResults[appState.selectedRepo].html_url;
        } else if (v === 'details' && appState.repoDetails) {
          url = appState.repoDetails.html_url;
        } else if (v === 'forks' && appState.forks[appState.selectedFork]) {
          url = appState.forks[appState.selectedFork].html_url;
        }
      } else if (currentTab === 4 && appState.notifications[appState.selectedNotification]) {
        const n = appState.notifications[appState.selectedNotification];
        // The API gives an api.github.com URL; convert to a browseable one.
        const apiUrl = n.subject?.url || '';
        url = apiUrl
          .replace('api.github.com/repos', 'github.com')
          .replace('/pulls/', '/pull/');
      }
      openInBrowser(url);
      break;
    }

    case 'q': case '\x03':
      process.stdout.write('\x1b[2J\x1b[H');
      process.exit(0);
      break;

    case '\t':
      currentTab = (currentTab + 1) % TABS.length;
      render();
      break;

    case '\x1b[Z':
      currentTab = (currentTab - 1 + TABS.length) % TABS.length;
      render();
      break;

    case '\r': case '\n':
      handleEnter();
      break;

    case '\x1b[A': case 'k':
      handleUp();
      break;

    case '\x1b[B': case 'j':
      handleDown();
      break;

    case '\x1b[D': case 'h': case '\x7f':
      if (currentTab === 2) handleBack();
      break;

    case ' ':
      handleSpace();
      break;

    case 'n':
      if (currentTab === 1) toggleRepoSort('name');
      else if (currentTab === 2 && appState.analyzeView === 'forks') toggleForkSort('name');
      break;
    case 's':
      if (currentTab === 1) toggleRepoSort('stars');
      else if (currentTab === 2 && appState.analyzeView === 'forks') toggleForkSort('stars');
      break;
    case 'f':
      if (currentTab === 1) toggleRepoSort('forks');
      break;
    case 'i':
      if (currentTab === 1) toggleRepoSort('issues');
      else if (currentTab === 2) handleAnalyzeKey('i');
      else if (currentTab === 3 && !appState.token) startInput('PAT token: ', 'login', true);
      break;
    case 'u':
      if (currentTab === 1) toggleRepoSort('updated');
      break;
    case 'p':
      if (currentTab === 2 && appState.analyzeView === 'forks') toggleForkSort('pushed');
      break;
  }
}

function handleAnalyzeKey(key) {
  const v = appState.analyzeView;
  if (key === 'i') {
    if (v === 'details') {
      appState.repoDetails = null;
      appState.analyzeView = 'results';
      render();
    } else {
      appState.repoDetails = null;
      appState.forks = [];
      appState.searchResults = [];
      appState.searchQuery = '';
      appState.analyzeView = 'search';
      startInput('Search repos: ', 'search');
    }
  }
}

function handleSpace() {
  if (currentTab === 1) {
    loadMoreRepos();
  } else if (currentTab === 2 && appState.analyzeView === 'results') {
    loadMoreSearchResults();
  }
}

function handleEnter() {
  switch (currentTab) {
    case 2: {
      const v = appState.analyzeView;
      if (v === 'results' && appState.searchResults.length > 0) {
        const repo = appState.searchResults[appState.selectedRepo];
        if (repo) {
          const [owner, name] = repo.full_name.split('/');
          loadRepoDetails(owner, name);
        }
      } else if (v === 'details' && appState.repoDetails) {
        loadForks();
      } else if (v === 'search') {
        startInput('Search repos: ', 'search');
      }
      break;
    }
    case 3: {
      const isLoggedIn = !!appState.token;
      if (appState.settingsCursor === 0 && !isLoggedIn) {
        startInput('PAT token: ', 'login', true);
      } else if (appState.settingsCursor === 1 && isLoggedIn) {
        handleLogout();
      }
      break;
    }
    case 4: {
      const n = appState.notifications[appState.selectedNotification];
      if (!n) break;
      const apiUrl = n.subject?.url || '';
      const url = apiUrl
        .replace('api.github.com/repos', 'github.com')
        .replace('/pulls/', '/pull/');
      openInBrowser(url);
      break;
    }
  }
}

function handleBack() {
  const v = appState.analyzeView;
  if (v === 'forks') {
    appState.forks = [];
    appState.selectedFork = 0;
    appState.forkScroll = 0;
    appState.analyzeView = 'details';
    render();
  } else if (v === 'details') {
    appState.repoDetails = null;
    appState.analyzeView = 'results';
    render();
  } else if (v === 'results') {
    appState.repoDetails = null;
    appState.forks = [];
    appState.searchResults = [];
    appState.searchQuery = '';
    appState.analyzeView = 'search';
    render();
  }
}

function handleUp() {
  switch (currentTab) {
    case 1: {
      appState.repoScroll = Math.max(0, appState.repoScroll - 1);
      render();
      break;
    }
    case 2: {
      if (appState.analyzeView === 'results' && appState.searchResults.length > 0) {
        if (appState.selectedRepo > appState.searchScroll) {
          appState.selectedRepo--;
        } else if (appState.searchScroll > 0) {
          appState.searchScroll--;
          appState.selectedRepo--;
        }
        render();
      } else if (appState.analyzeView === 'forks' && appState.forks.length > 0) {
        if (appState.selectedFork > appState.forkScroll) {
          appState.selectedFork--;
        } else if (appState.forkScroll > 0) {
          appState.forkScroll--;
          appState.selectedFork--;
        }
        render();
      }
      break;
    }
    case 3:
      appState.settingsCursor = Math.max(0, appState.settingsCursor - 1);
      render();
      break;
    case 4: {
      if (appState.notifications.length === 0) break;
      if (appState.selectedNotification > appState.inboxScroll) {
        appState.selectedNotification--;
      } else if (appState.inboxScroll > 0) {
        appState.inboxScroll--;
        appState.selectedNotification--;
      }
      render();
      break;
    }
  }
}

function handleDown() {
  switch (currentTab) {
    case 1: {
      const maxRows = Math.min(appState.repos.length, reposVisibleRows());
      const maxScroll = Math.max(0, appState.repos.length - maxRows);
      appState.repoScroll = Math.min(maxScroll, appState.repoScroll + 1);
      render();
      break;
    }
    case 2: {
      if (appState.analyzeView === 'results') {
        const maxVisible = analyzeListVisibleRows();
        if (appState.searchResults.length > 0) {
          if (appState.selectedRepo < appState.searchScroll + maxVisible - 1) {
            appState.selectedRepo = Math.min(appState.searchResults.length - 1, appState.selectedRepo + 1);
          } else if (appState.searchScroll + maxVisible < appState.searchResults.length) {
            appState.searchScroll++;
            appState.selectedRepo = Math.min(appState.searchResults.length - 1, appState.selectedRepo + 1);
          }
          render();
        }
      } else if (appState.analyzeView === 'forks') {
        const maxVisible = analyzeListVisibleRows();
        if (appState.forks.length > 0) {
          if (appState.selectedFork < appState.forkScroll + maxVisible - 1) {
            appState.selectedFork = Math.min(appState.forks.length - 1, appState.selectedFork + 1);
          } else if (appState.forkScroll + maxVisible < appState.forks.length) {
            appState.forkScroll++;
            appState.selectedFork = Math.min(appState.forks.length - 1, appState.selectedFork + 1);
          }
          render();
        }
      }
      break;
    }
    case 3:
      // 3 settings rows today (Login / Logout / Token). Kept explicit so we
      // don't depend on global state, but easy to bump when adding new rows.
      appState.settingsCursor = Math.min(2, appState.settingsCursor + 1);
      render();
      break;
    case 4: {
      if (appState.notifications.length === 0) break;
      const maxVisible = Math.max(1, screen.height - 15);
      if (appState.selectedNotification < appState.inboxScroll + maxVisible - 1) {
        appState.selectedNotification = Math.min(
          appState.notifications.length - 1, appState.selectedNotification + 1);
      } else if (appState.inboxScroll + maxVisible < appState.notifications.length) {
        appState.inboxScroll++;
        appState.selectedNotification = Math.min(
          appState.notifications.length - 1, appState.selectedNotification + 1);
      }
      render();
      break;
    }
  }
}

async function init() {
  if (!process.stdin.isTTY) {
    console.log('GitHub TUI requires an interactive terminal.');
    console.log('Usage: node app.mjs');
    process.exit(1);
  }

  process.stdout.write('\x1b[?25l');

  screen = new Screen();
  appState.token = loadToken();

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', handleKey);

  process.stdout.on('resize', () => {
    screen.updateSize();
    render();
  });

  screen.updateSize();

  const cleanup = () => {
    process.stdout.write('\x1b[?25h\x1b[2J\x1b[H');
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  if (appState.token) {
    await loadUserData();
  }

  render();
}

init().catch(e => {
  console.error(e);
  process.exit(1);
});
