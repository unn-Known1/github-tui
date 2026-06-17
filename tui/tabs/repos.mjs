// Repos tab — your personal repositories with sort, filter, and pagination.

import { appState, render, startAsync, isStale, showMessage } from '../state.mjs';
import { getAuthenticatedUser, getUserRepositories } from '../github.mjs';
import { removeToken } from '../config.mjs';
import { setTab } from '../state.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import { shortNum } from '../utils.mjs';
import { color } from '../theme.mjs';
import { loadDashboardWidgets } from './dashboard.mjs';

const REPOS_PER_PAGE = 30;

export const REPO_SORT_OPTIONS = [
  { field: 'name',    label: 'Name',    key: 'n' },
  { field: 'stars',   label: '★ Stars', key: 's' },
  { field: 'forks',   label: '⑂ Forks', key: 'f' },
  { field: 'issues',  label: 'Issues',  key: 'i' },
  { field: 'updated', label: 'Updated', key: 'u' },
];

export function sortRepos(repos, sort) {
  const sorted = [...repos];
  sorted.sort((a, b) => {
    let va, vb;
    switch (sort.field) {
      case 'name': va = (a.name||'').toLowerCase(); vb = (b.name||'').toLowerCase(); break;
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

export function toggleRepoSort(field) {
  if (appState.repoSort.field === field) appState.repoSort.asc = !appState.repoSort.asc;
  else { appState.repoSort.field = field; appState.repoSort.asc = field === 'name'; }
  appState.repoScroll = 0;
  render();
}

export async function loadUserData() {
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
      loadDashboardWidgets().catch(() => {});
    }
  } catch (e) {
    if (!isStale(gen)) {
      const msg = (e && e.message) || '';
      if (/401|Bad credentials|Unauthorized/i.test(msg)) {
        removeToken();
        appState.token = null;
        appState.user = null;
        appState.repos = [];
        setTab(3);
        showMessage('Stored token rejected — please log in again', 'error');
      } else {
        showMessage('Failed to load user data: ' + (msg || 'unknown'), 'error');
      }
    }
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

export async function loadMoreRepos() {
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
    showMessage('Loaded ' + appState.repos.length + ' repos total', 'info');
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to load more repos', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

// Register the filter input handler so Enter on '/' modal applies the filter.
registerInputHandler('filter', (value) => {
  appState.repoFilter = (value || '').trim();
  appState.repoScroll = 0;
  showMessage(appState.repoFilter
    ? 'Filtering: "' + appState.repoFilter + '"'
    : 'Filter cleared', 'info');
});

export function visibleRows(screen) {
  return Math.max(1, screen.height - 18);
}

export function renderRepos(screen, y, h) {
  const W = screen.width;
  let repos = sortRepos(appState.repos, appState.repoSort);

  if (appState.repoFilter) {
    const q = appState.repoFilter.toLowerCase();
    repos = repos.filter(r =>
      (r.name||'').toLowerCase().includes(q) ||
      (r.description||'').toLowerCase().includes(q) ||
      (r.language||'').toLowerCase().includes(q)
    );
  }

  const totalStars = appState.repos.reduce((a, r) => a + (r.stargazers_count || 0), 0);
  const totalForks = appState.repos.reduce((a, r) => a + (r.forks_count || 0), 0);
  const totalIssues = appState.repos.reduce((a, r) => a + (r.open_issues_count || 0), 0);
  const headerRight = '★' + shortNum(totalStars) + '  ⑂' + shortNum(totalForks) +
    '  ⚡' + shortNum(totalIssues) + '  (' + appState.repos.length + ' repos)';
  screen.writeStr(4, y, 'Your Repositories', 'bright');
  screen.writeStr(Math.max(4, W - headerRight.length - 2), y, headerRight, 'dim');
  screen.hline(y + 1, '─');

  if (!repos || repos.length === 0) {
    const msg = appState.repoFilter
      ? 'No repos match "' + appState.repoFilter + '"  [c] Clear  [/] New filter'
      : 'No repositories found';
    screen.writeStr(4, y + 2, msg, 'dim');
    return;
  }

  const sortInfo = REPO_SORT_OPTIONS.find(o => o.field === appState.repoSort.field);
  const sortDir = appState.repoSort.asc ? '↑' : '↓';
  const filterTag = appState.repoFilter
    ? '  •  Filter: "' + appState.repoFilter + '" [c] clear' : '';
  screen.writeStr(4, y + 2,
    'Sort: ' + sortInfo.label + ' ' + sortDir + filterTag, color('accent'));

  const sortKeys = REPO_SORT_OPTIONS.map(o => '[' + o.key + ']' + o.label).join('  ') +
    '  [/] Filter';
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
    const range = (start + 1) + '-' + Math.min(start + maxRows, repos.length) +
      ' of ' + repos.length;
    const more = appState.reposHasMore ? '  [Space] Load more' : '';
    screen.writeStr(4, infoY, range + more, 'dim');
  }
}

// Tab-local keys. Global keys (q, ?, r, o, tab nav) are handled by keys.mjs.
export const keys = {
  '/': () => startInput('Filter: ', 'filter'),
  'c': () => {
    if (appState.repoFilter) {
      appState.repoFilter = '';
      appState.repoScroll = 0;
      showMessage('Filter cleared', 'info');
      render();
    }
  },
  'n': () => toggleRepoSort('name'),
  's': () => toggleRepoSort('stars'),
  'f': () => toggleRepoSort('forks'),
  'i': () => toggleRepoSort('issues'),
  'u': () => toggleRepoSort('updated'),
};

export function up(screen) {
  appState.repoScroll = Math.max(0, appState.repoScroll - 1);
  render();
}
export function down(screen) {
  const maxRows = Math.min(appState.repos.length, visibleRows(screen));
  const maxScroll = Math.max(0, appState.repos.length - maxRows);
  appState.repoScroll = Math.min(maxScroll, appState.repoScroll + 1);
  render();
}
export const space = loadMoreRepos;
