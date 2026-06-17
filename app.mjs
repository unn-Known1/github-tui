#!/usr/bin/env node

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import {
  getAuthenticatedUser,
  searchRepositories,
  getRepositoryDetails,
  getUserRepositories,
  getRepositoryForks,
  getCompare,
} from './tui/github.mjs';
import { Screen } from './tui/screen.mjs';

const CONFIG_DIR = join(homedir(), '.github-tui');
const TOKEN_FILE = join(CONFIG_DIR, 'token');

const TABS = [
  { key: '1', label: 'Dashboard' },
  { key: '2', label: 'Repos' },
  { key: '3', label: 'Analyze' },
  { key: '4', label: 'Settings' },
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
  settingsCursor: 0,
  repoScroll: 0,
  searchScroll: 0,
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

function startInput(prompt, context) {
  appState.inputMode = 'input';
  appState.inputBuffer = '';
  appState.inputPrompt = prompt;
  appState.inputContext = context;
  render();
}

function cancelInput() {
  appState.inputMode = null;
  appState.inputBuffer = '';
  appState.inputPrompt = '';
  appState.inputContext = null;
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
    if (!isStale(gen)) showMessage('Failed to load user data', 'error');
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
  render();
  try {
    const details = await getRepositoryDetails(appState.token, owner, name);
    if (isStale(gen)) return;
    appState.repoDetails = details;
    appState.analyzeView = 'details';
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
    for (let i = 0; i < forks.length; i++) {
      if (isStale(gen)) return;
      const forkOwner = forks[i].owner?.login;
      if (!forkOwner) continue;
      try {
        const compare = await getCompare(appState.token, owner, name, defaultBranch, `${forkOwner}:${defaultBranch}`);
        if (isStale(gen)) return;
        if (compare) {
          appState.forks[i]._aheadBehind = { ahead: compare.ahead_by || 0, behind: compare.behind_by || 0 };
        }
      } catch {
        appState.forks[i]._aheadBehind = { ahead: 0, behind: 0 };
      }
    }
    if (!isStale(gen)) showMessage(`Loaded ${forks.length} forks`, 'success');
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Failed to load forks', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
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
    if (appState.user.plan) {
      screen.writeStr(W - 15, 1, `Plan: ${appState.user.plan.name}`, 'dim');
    }
  } else {
    screen.writeStr(2, 1, 'Not authenticated', 'dim');
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
  }

  screen.hline(H - 3, '─');

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
    } else {
      statusLeft = `[1-4] Tabs  [↑↓jk] Nav  [Enter] Select  [q] Quit`;
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
      screen.writeStr(12, y + 2, `${appState.inputPrompt}${appState.inputBuffer}█`.substring(0, W - 16));
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

  const details = [
    ['Description:', repo.description || 'N/A'],
    ['Language:', repo.language || 'N/A'],
    ['Stars:', String(repo.stargazers_count || 0)],
    ['Forks:', String(repo.forks_count || 0)],
    ['Open Issues:', String(repo.open_issues_count || 0)],
    ['Watchers:', String(repo.watchers_count || 0)],
    ['Size:', `${Math.round((repo.size || 0) / 1024)} MB`],
    ['License:', repo.license?.name || 'N/A'],
    ['Created:', new Date(repo.created_at).toLocaleDateString()],
    ['Updated:', new Date(repo.updated_at).toLocaleDateString()],
    ['URL:', repo.html_url],
  ];

  const rows = Math.min(details.length, maxH - 3);
  for (let i = 0; i < rows; i++) {
    const [key, val] = details[i];
    screen.writeStr(4, y + 2 + i, key, 'bright');
    screen.writeStr(18, y + 2 + i, String(val).substring(0, W - 22));
  }

  const forkRow = y + 2 + rows + 1;
  if (forkRow < y + maxH) {
    screen.writeStr(4, forkRow, '▶ [Enter] View Forks', 'cyan');
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

function handleKey(key) {
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
    case '1': case '2': case '3': case '4':
      currentTab = parseInt(key) - 1;
      render();
      break;

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
      else if (currentTab === 3 && !appState.token) startInput('PAT token: ', 'login');
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
        startInput('PAT token: ', 'login');
      } else if (appState.settingsCursor === 1 && isLoggedIn) {
        handleLogout();
      }
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
  }
}

function handleDown() {
  switch (currentTab) {
    case 1: {
      const maxRows = Math.min(appState.repos.length, screen.height - 12);
      const maxScroll = Math.max(0, appState.repos.length - maxRows);
      appState.repoScroll = Math.min(maxScroll, appState.repoScroll + 1);
      render();
      break;
    }
    case 2: {
      if (appState.analyzeView === 'results') {
        const maxVisible = Math.min(6, screen.height - 16);
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
        const maxVisible = Math.min(6, screen.height - 16);
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
      appState.settingsCursor = Math.min(2, appState.settingsCursor + 1);
      render();
      break;
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
