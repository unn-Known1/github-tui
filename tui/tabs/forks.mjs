// Forks sub-view (lives under the Analyze tab).
// Concurrent ahead/behind compares + Space-for-more pagination.

import { appState, render, startAsync, isStale, showMessage } from '../state.mjs';
import { getRepositoryForks, getCompare } from '../github.mjs';
import { color } from '../theme.mjs';

const FORKS_PER_PAGE = 30;
const COMPARE_CONCURRENCY = 5;

export const FORK_SORT_OPTIONS = [
  { field: 'pushed', label: 'Last Push', key: 'p' },
  { field: 'stars',  label: '★ Stars',   key: 's' },
  { field: 'name',   label: 'Name',      key: 'n' },
];

export function sortForks(forks, sort) {
  const sorted = [...forks];
  sorted.sort((a, b) => {
    let va, vb;
    switch (sort.field) {
      case 'pushed': va = new Date(a.pushed_at).getTime(); vb = new Date(b.pushed_at).getTime(); break;
      case 'stars':  va = a.stargazers_count || 0; vb = b.stargazers_count || 0; break;
      case 'name':   va = (a.full_name||'').toLowerCase(); vb = (b.full_name||'').toLowerCase(); break;
      default: va = 0; vb = 0;
    }
    if (va < vb) return sort.asc ? -1 : 1;
    if (va > vb) return sort.asc ? 1 : -1;
    return 0;
  });
  return sorted;
}

export function toggleForkSort(field) {
  if (appState.forkSort.field === field) appState.forkSort.asc = !appState.forkSort.asc;
  else { appState.forkSort.field = field; appState.forkSort.asc = field === 'name'; }
  appState.forkScroll = 0;
  render();
}

// Run compares concurrently (worker pool).
async function runCompares(owner, name, defaultBranch, range, gen) {
  let cursor = range.from;
  let completed = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= range.to) return;
      if (isStale(gen)) return;
      const forkOwner = appState.forks[i] && appState.forks[i].owner && appState.forks[i].owner.login;
      if (!forkOwner) { completed++; continue; }
      try {
        const compare = await getCompare(
          appState.token, owner, name, defaultBranch, forkOwner + ':' + defaultBranch);
        if (isStale(gen)) return;
        appState.forks[i]._aheadBehind = compare
          ? { ahead: compare.ahead_by || 0, behind: compare.behind_by || 0 }
          : { ahead: 0, behind: 0 };
      } catch (e) {
        appState.forks[i]._aheadBehind = { ahead: 0, behind: 0 };
      }
      completed++;
      if (completed % 5 === 0 && !isStale(gen)) render();
    }
  };
  await Promise.all(Array.from({ length: COMPARE_CONCURRENCY }, worker));
}

export async function loadForks() {
  const repo = appState.repoDetails;
  if (!repo) return;
  const gen = startAsync();
  appState.loading = true;
  appState.analyzeView = 'forks';
  appState.forks = [];
  appState.selectedFork = 0;
  appState.forkScroll = 0;
  appState.forksPage = 1;
  render();
  try {
    const [owner, name] = repo.full_name.split('/');
    const forks = await getRepositoryForks(appState.token, owner, name, 1, FORKS_PER_PAGE);
    if (isStale(gen)) return;
    appState.forks = forks;
    appState.forksHasMore = forks.length >= FORKS_PER_PAGE;
    await runCompares(owner, name, repo.default_branch || 'main',
      { from: 0, to: forks.length }, gen);
    if (!isStale(gen)) showMessage('Loaded ' + forks.length + ' forks', 'success');
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Failed to load forks', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

export async function loadMoreForks() {
  const repo = appState.repoDetails;
  if (!repo || !appState.forksHasMore) return;
  const gen = startAsync();
  appState.loading = true;
  render();
  try {
    const [owner, name] = repo.full_name.split('/');
    const page = appState.forksPage + 1;
    const more = await getRepositoryForks(appState.token, owner, name, page, FORKS_PER_PAGE);
    if (isStale(gen)) return;
    const offset = appState.forks.length;
    appState.forks = [...appState.forks, ...more];
    appState.forksPage = page;
    appState.forksHasMore = more.length >= FORKS_PER_PAGE;
    await runCompares(owner, name, repo.default_branch || 'main',
      { from: offset, to: offset + more.length }, gen);
    if (!isStale(gen)) showMessage('Loaded ' + appState.forks.length + ' forks total', 'success');
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Failed to load more forks', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

export function renderForks(screen, y, maxH) {
  const W = screen.width;
  const forks = sortForks(appState.forks, appState.forkSort);

  const ref = (appState.repoDetails && appState.repoDetails.full_name) || 'repo';
  screen.writeStr(4, y, 'Forks of ' + ref, 'bright');
  screen.hline(y + 1, '─');

  const sortInfo = FORK_SORT_OPTIONS.find(o => o.field === appState.forkSort.field);
  const sortDir = appState.forkSort.asc ? '↑' : '↓';
  screen.writeStr(4, y + 2, 'Sort: ' + sortInfo.label + ' ' + sortDir, color('accent'));
  screen.writeStr(4, y + 3,
    FORK_SORT_OPTIONS.map(o => '[' + o.key + ']' + o.label).join('  '), 'dim');

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
    const ownerName = (fork.owner && fork.owner.login) || fork.full_name.split('/')[0];
    screen.writeStr(7, row, ownerName.substring(0, 20), sel ? 'bright' : null);
    screen.writeStr(28, row, String(fork.stargazers_count || 0));
    screen.writeStr(38, row, String(fork.forks_count || 0));
    screen.writeStr(48, row, new Date(fork.pushed_at).toLocaleDateString(), 'dim');
    if (fork._aheadBehind) {
      screen.writeStr(62, row, '+' + fork._aheadBehind.ahead, color('success'));
      if (fork._aheadBehind.behind > 0) {
        screen.writeStr(68, row, '-' + fork._aheadBehind.behind, color('error'));
      }
    }
  }

  const infoY = headerY + 1 + maxRows + 1;
  if (infoY < y + maxH) {
    const more = appState.forksHasMore ? '  [Space] Load more' : '';
    const range = (start + 1) + '-' + Math.min(start + maxRows, forks.length) +
      ' of ' + forks.length;
    screen.writeStr(4, infoY, range + more + '  •  Esc back  [p/s/n] Sort', 'dim');
  }
}

export const keys = {
  'p': () => toggleForkSort('pushed'),
  // 's' and 'n' are handled by the analyze tab's key map (which delegates).
};
