// Forks sub-view (lives under the Analyze tab).
// Concurrent ahead/behind compares + Space-for-more pagination.

import { appState, render, startAsync, isStale, showMessage } from '../state.mjs';
import { getRepositoryForks, getCompare } from '../github.mjs';
import { color } from '../theme.mjs';
import { truncate } from '../utils.mjs';
import { loadingIndicator, scrollIndicators } from '../render.mjs';

const FORKS_PER_PAGE = 30;
const COMPARE_CONCURRENCY = 5;

export const FORK_SORT_OPTIONS = [
  { field: 'pushed', label: 'Last Push', key: 'p' },
  { field: 'stars',  label: 'Stars',   key: 's' },
  { field: 'name',   label: 'Name',      key: 'n' },
];

export function sortForks(forks, sort) {
  const sorted = [...forks];
  sorted.sort((a, b) => {
    let va, vb;
    switch (sort.field) {
      case 'pushed': va = a.pushed_at ? new Date(a.pushed_at).getTime() : 0; vb = b.pushed_at ? new Date(b.pushed_at).getTime() : 0; break;
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

async function runCompares(owner, name, defaultBranch, range, gen) {
  let cursor = range.from;
  let completed = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= range.to) return;
      if (isStale(gen)) { appState.loading = false; return; }
      const forkOwner = appState.forks[i] && appState.forks[i].owner && appState.forks[i].owner.login;
      if (!forkOwner) { completed++; continue; }
      try {
        const compare = await getCompare(
          appState.token, owner, name, defaultBranch, forkOwner + ':' + defaultBranch);
        if (isStale(gen)) { appState.loading = false; return; }
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
    if (isStale(gen)) { appState.loading = false; return; }
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
    if (isStale(gen)) { appState.loading = false; return; }
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
  screen.writeStr(4, y, 'Forks of ' + ref, color('title'));
  screen.hline(y + 1, '─', color('dim'));

  const sortInfo = FORK_SORT_OPTIONS.find(o => o.field === appState.forkSort.field);
  const sortDir = appState.forkSort.asc ? ' ↑' : ' ↓';
  screen.writeStr(4, y + 2, 'Sort: ' + sortInfo.label + sortDir, color('accent'));

  // Responsive column positions.
  const nameCol = 4;
  const starsCol = Math.max(30, Math.floor(W * 0.35));
  const forksCol = starsCol + 10;
  const pushedCol = forksCol + 10;
  const aheadCol = pushedCol + 14;

  const headerY = y + 3;
  screen.writeStr(nameCol, headerY, 'Fork Owner', color('header'));
  screen.writeStr(starsCol, headerY, 'Stars', color('header'));
  screen.writeStr(forksCol, headerY, 'Forks', color('header'));
  if (pushedCol + 12 < W) {
    screen.writeStr(pushedCol, headerY, 'Last Push', color('header'));
  }
  if (aheadCol + 8 < W) {
    screen.writeStr(aheadCol, headerY, 'Ahead', color('header'));
  }

  if (forks.length === 0) {
    if (appState.loading) {
      loadingIndicator(screen, 4, headerY + 1, 'loading forks');
    } else {
      screen.writeStr(4, headerY + 1, 'No forks found', color('dim'));
    }
    return;
  }

  const maxRows = Math.min(forks.length, maxH - 6);
  const start = appState.forkScroll;
  for (let i = 0; i < maxRows && start + i < forks.length; i++) {
    const fork = forks[start + i];
    const row = headerY + 1 + i;
    const sel = start + i === appState.selectedFork;

    // Selection highlight.
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }

    screen.writeStr(nameCol, row, sel ? '▶ ' : '  ', sel ? color('selection') : null);
    const ownerName = (fork.owner && fork.owner.login) || fork.full_name.split('/')[0];
    screen.writeStr(nameCol + 2, row, truncate(ownerName, starsCol - nameCol - 4), sel ? color('selection') : null);
    const statStyle = sel ? color('selection') : color('dim');
    screen.writeStr(starsCol, row, String(fork.stargazers_count || 0), statStyle);
    screen.writeStr(forksCol, row, String(fork.forks_count || 0), statStyle);
    if (pushedCol + 12 < W) {
      screen.writeStr(pushedCol, row, new Date(fork.pushed_at).toISOString().split('T')[0], statStyle);
    }
    if (fork._aheadBehind && aheadCol + 8 < W) {
      const ahead = '+' + fork._aheadBehind.ahead;
      const behind = fork._aheadBehind.behind > 0 ? ' -' + fork._aheadBehind.behind : '';
      screen.writeStr(aheadCol, row, ahead, color('success'));
      if (behind) screen.writeStr(aheadCol + ahead.length, row, behind, color('error'));
    }
  }

  scrollIndicators(screen, headerY + 1, headerY + maxRows, appState.forkScroll, forks.length);

  const infoY = headerY + 1 + maxRows + 1;
  if (infoY < y + maxH) {
    const more = appState.forksHasMore ? '  [Space] Load more' : '';
    const range = (start + 1) + '-' + Math.min(start + maxRows, forks.length) +
      ' of ' + forks.length;
    screen.writeStr(4, infoY, range + more, color('dim'));
  }
}

export const keys = {
  'p': () => toggleForkSort('pushed'),
};
