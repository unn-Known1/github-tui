// Repos tab — your personal repositories.
// v0.5+ polish: dismissable filter chips, cleaner density, better selected row.

import { appState, render, startAsync, isStale, showMessage, setTab, upsertEntity } from '../state.mjs';
import { getAuthenticatedUser, getUserRepositories, getStarredRepos, isStarred, starRepo, unstarRepo } from '../github.mjs';
import { removeToken } from '../config.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import { shortNum, relTime, truncate } from '../utils.mjs';
import { color } from '../theme.mjs';
import { emptyState, scrollIndicators, errorState, getBreakpoint } from '../render.mjs';
import { loadDashboardWidgets, recomputeDashboardDerived } from './dashboard.mjs';
import { isBookmarked } from '../store.mjs';
import { togglePin } from '../store.mjs';
import { loadRepoDetails } from './analyze.mjs';
import { sortRepos as _sortRepos, applyAllFilters as _applyAllFilters, floatPinsToTop as _floatPinsToTop } from '../repos-logic.mjs';
import { showError } from '../error-recovery.mjs';

const REPOS_PER_PAGE = 30;
import { STALE_DAYS } from '../repos-logic.mjs';

export const REPO_SORT_OPTIONS = [
  { field: 'name',    label: 'Name',    key: 'n' },
  { field: 'stars',   label: 'Stars', key: 'S' },
  { field: 'forks',   label: 'Forks', key: 'f' },
  { field: 'issues',  label: 'Issues',  key: 'i' },
  { field: 'updated', label: 'Updated', key: 'u' },
];

const TYPE_FILTERS = ['all', 'sources', 'forks', 'archived', 'private', 'public', 'templates'];

export function sortRepos(repos, sort) {
  return _sortRepos(repos, sort);
}

export function toggleRepoSort(field) {
  if (appState.repoSort.field === field) appState.repoSort.asc = !appState.repoSort.asc;
  else { appState.repoSort.field = field; appState.repoSort.asc = field === 'name'; }
  appState.repoScroll = 0;
  appState.repoSelected = 0;
  render();
}

export function applyAllFilters(repos) {
  return _applyAllFilters(repos, {
    typeFilter: appState.repoTypeFilter,
    langFilter: appState.reposLangFilter,
    staleOnly: appState.repoStaleOnly,
    textFilter: appState.repoFilter,
  });
}

export function floatPinsToTop(repos) {
  return _floatPinsToTop(repos, appState.repoPins);
}

// Build the list of currently active filter chips with dismiss handler.
// Each chip has [name, kind, value] so we know what to clear.
function activeFilterChips() {
  const chips = [];
  if (appState.repoTypeFilter !== 'all')
    chips.push({ label: 'type: ' + appState.repoTypeFilter, kind: 'type' });
  if (appState.reposLangFilter)
    chips.push({ label: 'lang: ' + appState.reposLangFilter, kind: 'lang' });
  if (appState.repoStaleOnly)
    chips.push({ label: 'stale', kind: 'stale' });
  if (appState.repoFilter)
    chips.push({ label: '"' + appState.repoFilter + '"', kind: 'filter' });
  return chips;
}

function clearFilterChip(kind) {
  switch (kind) {
    case 'type':   appState.repoTypeFilter = 'all'; break;
    case 'lang':   appState.reposLangFilter = null; break;
    case 'stale':  appState.repoStaleOnly = false; break;
    case 'filter': appState.repoFilter = ''; break;
  }
  appState.repoScroll = 0;
  appState.repoSelected = 0;
  showMessage('Filter cleared', 'info');
  render();
}

// ─── Loaders ──────────────────────────────────────────────────────

export async function loadUserData({ loadDashboard = true } = {}) {
  if (!appState.token) return;
  const gen = startAsync('repos');
  appState.loading = true;
  render();
  try {
    appState.user = await getAuthenticatedUser(appState.token, gen.signal);
    if (isStale(gen, 'repos')) { appState.loading = false; return; }
    if (appState.user) {
      appState.repos = await getUserRepositories(appState.token, 1, REPOS_PER_PAGE, gen.signal);
      appState.reposPage = 1;
      appState.reposHasMore = appState.repos.length >= REPOS_PER_PAGE;
      if (isStale(gen, 'repos')) { appState.loading = false; return; }
      loadAllReposBackground(gen);
      if (loadDashboard) loadDashboardWidgets().catch(() => {});
    }
  } catch (e) {
    if (!isStale(gen, 'repos')) {
      const msg = (e && e.message) || '';
      if (/401|Bad credentials|Unauthorized/i.test(msg)) {
        removeToken();
        appState.token = null;
        appState.user = null;
        appState.repos = [];
        setTab(5);
        showError('Token rejected', 'Authentication', { retry: loadUserData });
      } else {
        showError(msg || 'Unknown error', 'Load repos', { retry: loadUserData });
      }
    }
  }
  appState.loading = false;
  if (!isStale(gen, 'repos')) render();
}

export async function loadAllReposBackground(gen) {
  // Load the complete account repository list in the background. Keep a
  // very high safety ceiling for malformed pagination responses, while
  // avoiding the old 300-repository truncation in normal accounts.
  const MAX_PAGES = 1000;
  let page = 2;
  let capped = false;
  while (appState.reposHasMore && page <= MAX_PAGES) {
    try {
      const more = await getUserRepositories(appState.token, page, REPOS_PER_PAGE, gen.signal);
      if (isStale(gen, 'repos')) { appState.loading = false; return; }
      appState.repos = [...appState.repos, ...more];
      appState.reposPage = page;
      appState.reposHasMore = more.length >= REPOS_PER_PAGE;
      recomputeDashboardDerived();
      page++;
    } catch (e) {
      if (!isStale(gen, 'repos')) showError(((e && e.message) || 'unknown'), 'Background repo load', { retry: () => loadAllReposBackground(gen) });
      appState.loading = false;
      return;
    }
  }
  // If the upstream still has more repos but we stopped at MAX_PAGES, surface
  // a non-modal hint so the user knows they can load more.
  if (appState.reposHasMore) {
    appState.reposHasMore = false;  // we won't keep paging silently
    appState._moreReposAvailable = true;
    capped = true;
    if (!isStale(gen, 'repos')) showMessage(
      'Loaded first ' + appState.repos.length + ' repos (' + MAX_PAGES + ' pages). ' +
      'Press [l] or run \":repos loadMore\" in palette to fetch more.',
      'info', 6000
    );
  }
  if (!isStale(gen, 'repos')) render();
}

export async function loadMoreRepos() {
  if (!appState.token || !appState.reposHasMore) return;
  const gen = startAsync('repos');
  appState.loading = true;
  render();
  try {
    const page = appState.reposPage + 1;
    const more = await getUserRepositories(appState.token, page, REPOS_PER_PAGE, gen.signal);
    if (isStale(gen, 'repos')) { appState.loading = false; return; }
    appState.repos = [...appState.repos, ...more];
    appState.reposPage = page;
    appState.reposHasMore = more.length >= REPOS_PER_PAGE;
    recomputeDashboardDerived();
    showMessage('Loaded ' + appState.repos.length + ' repos total', 'info');
  } catch (e) {
    if (!isStale(gen, 'repos')) showMessage('Failed to load more repos', 'error');
  }
  appState.loading = false;
  if (!isStale(gen, 'repos')) render();
}

registerInputHandler('filter', (value) => {
  appState.repoFilter = (value || '').trim();
  appState.repoScroll = 0;
  appState.repoSelected = 0;
  showMessage(appState.repoFilter
    ? 'Filtering: "' + appState.repoFilter + '"'
    : 'Filter cleared', 'info');
});

registerInputHandler('lang-filter', (value) => {
  const v = (value || '').trim();
  appState.reposLangFilter = v || null;
  appState.reposShowLangFacet = false;
  appState.repoScroll = 0;
  appState.repoSelected = 0;
  showMessage(v ? 'Language: ' + v : 'Language filter cleared', 'info');
});

// ─── Action helpers ───────────────────────────────────────────────
export function visibleRows(screen) {
  const compact = appState.repoDensity === 'compact';
  const overhead = 9; // account for new chip row + density indicator
  return Math.max(1, Math.floor((screen.height - overhead) / (compact ? 1 : 2)));
}

function badgeChar(r) {
  if (r.private)     return { ch: 'P', style: color('warning'), label: 'private' };
  if (r.fork)        return { ch: 'F', style: color('fork'),    label: 'fork' };
  if (r.archived)    return { ch: 'A', style: color('dim'),      label: 'archived' };
  if (isPinnedLocal(r.full_name)) return { ch: '★', style: color('pinned'), label: 'pinned' };
  if (isStarredLocal(r.full_name)) return { ch: '★', style: color('star'),      label: 'starred' };
  if (isBookmarked(r.full_name)) return { ch: 'B', style: color('bookmarked'),  label: 'bookmarked' };
  return null;
}

// Use in-memory state to avoid disk roundtrip on every row render.
export function isPinnedLocal(fullName) {
  return appState.repoPins && appState.repoPins.indexOf(fullName) >= 0;
}

export function isStarredLocal(fullName) {
  return appState.entityCache[fullName]?.isStarred === true;
}

/// ─── Render ───────────────────────────────────────────────────────

function renderStarredList(screen, y, h) {
  const W = screen.width;
  const list = appState.starred;

  screen.writeStr(2, y, 'STARRED REPOSITORIES', color('title') || { fg: 'white', bold: true });
  const countText = list.length + ' repos';
  screen.writeStr(Math.max(2, W - countText.length - 2), y, countText, { dim: true });
  screen.hline(y + 1, '─', { dim: true });

  if (list.length === 0) {
    emptyState(screen, y + 3, h - 3, {
      icon: '☆',
      title: appState.loading ? 'Loading...' : 'No starred repos yet',
      message: appState.loading ? 'Fetching starred repos...' : 'Star repos on GitHub to see them here',
      hint: '',
      keyHint: 'Press [V] to return to your repos',
    });
    return;
  }

  const headerY = y + 2;
  screen.writeStr(2, headerY, 'REPO', { fg: 'cyan', bold: true });
  if (W > 40) screen.writeStr(W - 22, headerY, 'STARS', { fg: 'cyan', bold: true });

  const maxRows = Math.max(1, h - 5);
  const start = appState.starredScroll;
  const rowsToShow = Math.min(maxRows, Math.max(0, list.length - start));

  for (let i = 0; i < rowsToShow; i++) {
    const r = list[start + i];
    if (!r) break;
    const row = headerY + 1 + i;
    const sel = start + i === appState.starredSelected;

    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }

    screen.writeStr(2, row, sel ? '▶' : '  ', sel ? color('selection') : color('dim'));
    const name = truncate(r.full_name || '?', Math.max(15, W - 36));
    screen.writeStr(5, row, name, sel ? color('selection') : color('repoName'));
    const stars = '★ ' + shortNum(r.stargazers_count || 0);
    screen.writeStr(W - 22, row, stars, sel ? color('selection') : color('star'));
  }

  scrollIndicators(screen, headerY + 1, headerY + rowsToShow, appState.starredScroll, list.length);

  const footerY = headerY + 1 + rowsToShow + 1;
  if (footerY < y + h) {
    const range = (start + 1) + '-' + Math.min(start + rowsToShow, list.length) + ' of ' + list.length;
    const pageInfo = appState.starredHasMore || appState.starredPage > 1
      ? '   Page ' + appState.starredPage + '   [PgUp/PgDn]' : '';
    screen.writeStr(2, footerY, range + pageInfo + '   [V] Back to own repos   [Enter] Explore', { dim: true });
  }
}

export function renderRepos(screen, y, h) {
  if (appState.reposView === 'starred') {
    renderStarredList(screen, y, h);
    return;
  }
  const W = screen.width;
  let repos = sortRepos(appState.repos, appState.repoSort);
  repos = applyAllFilters(repos);
  repos = floatPinsToTop(repos);
  appState._filteredReposCount = repos.length;

  // Aggregate stats.
  const totalStars = appState.repos.reduce((a, r) => a + (r.stargazers_count || 0), 0);
  const totalForks = appState.repos.reduce((a, r) => a + (r.forks_count || 0), 0);
  const totalIssues = appState.repos.reduce((a, r) => a + (r.open_issues_count || 0), 0);

  screen.writeStr(2, y, 'YOUR REPOSITORIES', color('title') || { fg: 'white', bold: true });
  const statsText = '★ ' + shortNum(totalStars) + '   Y ' + shortNum(totalForks) + '   ◉ ' + shortNum(totalIssues);
  screen.writeStr(Math.max(2, W - statsText.length - 2), y, statsText, { dim: true });
  screen.hline(y + 1, '─', { dim: true });

  // Active filter chips line (dismissible with X).
  const chips = activeFilterChips();
  let chipX = 2;
  const chipY = y + 2;
  if (chips.length > 0) {
    for (const chip of chips) {
      const text = ' ' + chip.label + ' ✕ ';
      screen.writeStr(chipX, chipY, text, { bg: 'darkGray', fg: 'cyan' });
      // Store chip positions for click-to-dismiss.
      chip._x1 = chipX;
      chip._x2 = chipX + text.length;
      chipX += text.length + 1;
    }
    // Sort + density indicator on the right.
    const sortInfo = REPO_SORT_OPTIONS.find(o => o.field === appState.repoSort.field);
    const sortDir = appState.repoSort.asc ? ' ↑' : ' ↓';
    const sortText = 'sort: ' + sortInfo.label + sortDir;
    screen.writeStr(W - sortText.length - 2, chipY, sortText, { fg: 'cyan' });
  } else {
    const sortInfo = REPO_SORT_OPTIONS.find(o => o.field === appState.repoSort.field);
    const sortDir = appState.repoSort.asc ? ' ↑' : ' ↓';
    const densityLabel = appState.repoDensity === 'compact' ? 'compact' : 'comfy';
    const statusText = 'sort: ' + sortInfo.label + sortDir + '   density: ' + densityLabel;
    screen.writeStr(2, chipY, statusText, { dim: true });
    const hint = '[c] clear all';
    screen.writeStr(W - hint.length - 2, chipY, hint, { dim: true });
  }
  // Store chips for click handling.
  appState._filterChips = chips;
  appState._chipY = chipY;

  if (!repos || repos.length === 0) {
    const hasFilters = chips.length > 0;
    emptyState(screen, y + 3, h - 3, {
      icon: hasFilters ? '○' : '○',
      title: hasFilters ? 'No matching repos' : 'No repositories',
      message: hasFilters
        ? 'Try clearing filters with [c] or click ✕ on a chip above'
        : 'Load repos by logging in at Settings [6]',
      hint: hasFilters ? '[c] Clear all filters' : '',
    });
    return;
  }

  // Responsive column positions based on terminal width.
  const bp = getBreakpoint(W);
  const badgeW = 2;
  const nameCol = 2 + badgeW + 1;
  const nameW = bp === 'xs' ? Math.max(10, Math.floor(W * 0.25))
    : bp === 'sm' ? Math.max(12, Math.floor(W * 0.28))
    : Math.max(15, Math.floor(W * 0.30));
  const langCol = nameCol + nameW + 1;
  const starsCol = langCol + (bp === 'xs' ? 8 : 12);
  const forksCol = starsCol + (bp === 'xs' ? 5 : 7);
  const issuesCol = forksCol + (bp === 'xs' ? 5 : 7);
  const pushedCol = issuesCol + (bp === 'xs' ? 6 : 8);

  // Optional language facet opened by the Dashboard LANGUAGES card. Keep it
  // compact and inline so it does not create a second navigation surface.
  let headerY = y + 4;
  if (appState.reposShowLangFacet) {
    const languageCounts = {};
    for (const repo of appState.repos) {
      if (repo.language) languageCounts[repo.language] = (languageCounts[repo.language] || 0) + 1;
    }
    const languageText = Object.entries(languageCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([language, count]) => language + '(' + count + ')')
      .join('  ');
    screen.writeStr(2, y + 3, 'LANGUAGES: ' + (languageText || 'none') + '   [L] filter exact', { fg: 'magenta' });
    headerY = y + 5;
  }

  // Column headers.
  screen.writeStr(nameCol, headerY, 'REPO', { fg: 'cyan', bold: true });
  screen.writeStr(langCol, headerY, 'LANG', { fg: 'cyan', bold: true });
  screen.writeStr(starsCol, headerY, 'STARS', { fg: 'cyan', bold: true });
  screen.writeStr(forksCol, headerY, 'FORKS', { fg: 'cyan', bold: true });
  screen.writeStr(issuesCol, headerY, 'ISSUES', { fg: 'cyan', bold: true });
  if (pushedCol + 8 < W) {
    screen.writeStr(pushedCol, headerY, 'PUSHED', { fg: 'cyan', bold: true });
  }
  screen.hline(headerY + 1, '─', { dim: true });

  const compact = appState.repoDensity === 'compact';
  const rowH = compact ? 1 : 2;
  const start = appState.repoScroll;

  // Pre-compute which data rows are "section start" (first pinned repo in a
  // contiguous run) so we can insert a "PINNED" header above them.
  const isSectionStart = new Array(repos.length).fill(false);
  const isPinnedArr    = new Array(repos.length).fill(false);
  for (let i = 0; i < repos.length; i++) {
    isPinnedArr[i] = isPinnedLocal(repos[i].full_name);
    if (isPinnedArr[i] && (i === 0 || !isPinnedArr[i - 1])) isSectionStart[i] = true;
  }
  const maxRows = Math.max(1, Math.floor((h - 10) / rowH));

  // Render loop: emit headers as we cross section boundaries.
  let curY = headerY + 2;
  let drawn = 0;
  for (let i = start; i < repos.length && drawn < maxRows; i++) {
    if (isSectionStart[i]) {
      if (i > 0) screen.hline(curY - 1, '─', { dim: true });
      screen.writeStr(2, curY, '★ PINNED', color('pinned'));
      curY++;
      if (drawn + 1 > maxRows) break;
    }
    const repo = repos[i];
    const sel = i === appState.repoSelected;
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[curY][x] = color('selection');
    }
    const badge = badgeChar(repo);
    if (badge) screen.writeStr(2, curY, '[' + badge.ch + ']', badge.style);
    else screen.writeStr(2, curY, '  ', null);

    const nameStyle = sel ? color('selection') : color('repoName');
    screen.writeStr(nameCol, curY, truncate(repo.name || 'N/A', nameW), nameStyle);

    const statStyle = sel ? color('selection') : color('dim');
    const langStyle = sel ? color('selection') : color('dim');
    screen.writeStr(langCol, curY, truncate(repo.language || '—', 10), langStyle);
    screen.writeStr(starsCol, curY, shortNum(repo.stargazers_count || 0), statStyle);
    screen.writeStr(forksCol, curY, shortNum(repo.forks_count || 0), statStyle);
    screen.writeStr(issuesCol, curY, shortNum(repo.open_issues_count || 0), statStyle);
    if (pushedCol + 8 < W) {
      screen.writeStr(pushedCol, curY, relTime(repo.pushed_at || repo.updated_at), statStyle);
    }
    curY += rowH;
    drawn++;
  }

  scrollIndicators(screen, headerY + 2, Math.max(headerY + 2, curY - 1), start, repos.length, drawn);

  const footerY = curY + 1;
  if (footerY < y + h) {
    const range = (start + 1) + '-' + Math.min(start + drawn, repos.length) +
      ' of ' + repos.length;
    const more = appState.reposHasMore
      ? '   [Space] Load more'
      : (appState._moreReposAvailable
          ? '   [l] More repos available'
          : '');
    screen.writeStr(2, footerY, range + more, { dim: true });
  }
}

// ─── Key handlers ─────────────────────────────────────────────────

function currentRepo() {
  let list = sortRepos(appState.repos, appState.repoSort);
  list = applyAllFilters(list);
  list = floatPinsToTop(list);
  return list[appState.repoSelected] || null;
}

function openCurrentInAnalyze() {
  const r = currentRepo();
  if (!r) return;
  const [owner, name] = r.full_name.split('/');
  setTab(2);
  appState.analyzeView = 'details';
  loadRepoDetails(owner, name);
}

function cycleTypeFilter() {
  const i = TYPE_FILTERS.indexOf(appState.repoTypeFilter);
  appState.repoTypeFilter = TYPE_FILTERS[(i + 1) % TYPE_FILTERS.length];
  appState.repoScroll = 0;
  appState.repoSelected = 0;
  showMessage('Type: ' + appState.repoTypeFilter, 'info');
  render();
}

function toggleStale() {
  appState.repoStaleOnly = !appState.repoStaleOnly;
  appState.repoScroll = 0;
  appState.repoSelected = 0;
  showMessage(appState.repoStaleOnly
    ? 'Showing stale repos'
    : 'Stale filter cleared', 'info');
  render();
}

function toggleDensity() {
  appState.repoDensity = appState.repoDensity === 'compact' ? 'comfortable' : 'compact';
  appState.repoScroll = 0;
  showMessage('Density: ' + appState.repoDensity, 'info');
  render();
}

function togglePinCurrent() {
  const r = currentRepo();
  if (!r) return;
  const list = togglePin(r.full_name);
  appState.repoPins = list;
  showMessage(list.includes(r.full_name)
    ? '📌 Pinned ' + r.full_name
    : 'Unpinned ' + r.full_name, 'success');
  render();
}

export async function toggleStarCurrent() {
  const r = currentRepo();
  if (!r) return;
  const fullName = r.full_name;
  if (isStarredLocal(fullName)) {
    await unstarRepo(appState.token, r.owner, r.name);
    showMessage('Unstarred ' + fullName, 'info');
  } else {
    await starRepo(appState.token, r.owner, r.name);
    showMessage('Starred ' + fullName, 'success');
  }
  upsertEntity(r, { isStarred: !isStarredLocal(fullName) });
  render();
}

function clearAllFilters() {
  if (appState.reposView !== 'own') return;
  appState.reposShowLangFacet = false;
  appState.repoFilter = '';
  appState.repoTypeFilter = 'all';
  appState.reposLangFilter = null;
  appState.repoStaleOnly = false;
  appState.repoScroll = 0;
  appState.repoSelected = 0;
  showMessage('All filters cleared', 'info');
  render();
}

// Mouse / click on a filter chip's ✕ to dismiss it.
export function tryDismissChipAt(x, y) {
  if (!appState._filterChips) return false;
  for (const chip of appState._filterChips) {
    if (x >= chip._x1 && x < chip._x2 && y === appState._chipY) {
      clearFilterChip(chip.kind);
      return true;
    }
  }
  return false;
}

export function toggleReposView() {
  appState.reposView = appState.reposView === 'own' ? 'starred' : 'own';
  if (appState.reposView === 'starred' && appState.starred.length === 0) {
    loadStarredRepos();
  }
  appState.repoSelected = 0;
  appState.repoScroll = 0;
  appState.starredSelected = 0;
  appState.starredScroll = 0;
  render();
}

// Seed the entity cache from the current `appState.starred` array. Called
// after every assignment to `appState.starred` so cross-tab viewers
// (dashboard trending, repos tab, analyze) see the starred membership
// immediately. Idempotent — upsertEntity merges.
function _seedStarredCache() {
  if (!Array.isArray(appState.starred)) return;
  for (const r of appState.starred) {
    upsertEntity(r, { isStarred: true, starredAt: r.starred_at, isOwner: false });
  }
}

async function loadStarredRepos() {
  if (!appState.token) return;
  const gen = startAsync('repos');
  appState.loading = true;
  render();
  try {
    const starred = await getStarredRepos(appState.token, 1, 100, gen.signal);
    if (isStale(gen, 'repos')) { appState.loading = false; return; }
    appState.starred = Array.isArray(starred) ? starred.map(s => ({
      ...s.repo,
      starred_at: s.created_at,
    })) : [];
    _seedStarredCache();
    appState.starredPage = 1;
    appState.starredHasMore = appState.starred.length >= 100;
    showMessage('Loaded ' + appState.starred.length + ' starred repos', 'success');
  } catch (e) {
    if (!isStale(gen, 'repos')) showMessage('Failed to load starred repos: ' + e.message, 'error');
  }
  appState.loading = false;
  if (!isStale(gen, 'repos')) render();
}

export async function loadMoreStarred() {
  if (!appState.token || !appState.starredHasMore) return;
  const gen = startAsync('repos');
  appState.loading = true;
  render();
  try {
    const page = appState.starredPage + 1;
    const more = await getStarredRepos(appState.token, page, 100, gen.signal);
    if (isStale(gen, 'repos')) { appState.loading = false; return; }
    if (Array.isArray(more) && more.length > 0) {
      const mapped = more.map(s => ({ ...(s.repo || s), starred_at: s.starred_at || s.created_at }));
      appState.starred = [...appState.starred, ...mapped];
      // Seed only the newly-mapped delta — previously-seeds stay valid.
      // Full re-seed via _seedStarredCache() would re-upsert every page.
      for (const r of mapped) upsertEntity(r, { isStarred: true, starredAt: r.starred_at, isOwner: false });
      appState.starredPage = page;
      appState.starredHasMore = more.length >= 100;
      showMessage('Loaded ' + appState.starred.length + ' starred repos', 'success');
    } else {
      appState.starredHasMore = false;
      showMessage('All starred repos loaded', 'info');
    }
  } catch (e) {
    if (!isStale(gen, 'repos')) showMessage('Failed to load more starred repos', 'error');
  }
  appState.loading = false;
  if (!isStale(gen, 'repos')) render();
}

export function pageUp() {
  if (appState.reposView === 'starred' && appState.starredPage > 1) {
    const page = appState.starredPage - 1;
    const gen = startAsync('repos');
    appState.loading = true;
    render();
    getStarredRepos(appState.token, page, 100, gen.signal).then(more => {
      if (isStale(gen, 'repos')) { appState.loading = false; return; }
      if (Array.isArray(more)) {
        appState.starred = more.map(s => ({ ...(s.repo || s), starred_at: s.starred_at || s.created_at }));
        _seedStarredCache();
        appState.starredPage = page;
        appState.starredHasMore = more.length >= 100;
        appState.starredSelected = 0;
        appState.starredScroll = 0;
      }
      appState.loading = false;
      render();
    }).catch((e) => {
      if (!isStale(gen, 'repos')) showMessage('Failed to load starred page: ' + ((e && e.message) || 'unknown'), 'error');
      appState.loading = false;
      if (!isStale(gen, 'repos')) render();
    });
  }
}

export function pageDown() {
  if (appState.reposView === 'starred' && appState.starredHasMore) {
    const page = appState.starredPage + 1;
    const gen = startAsync('repos');
    appState.loading = true;
    render();
    getStarredRepos(appState.token, page, 100, gen.signal).then(more => {
      if (isStale(gen, 'repos')) { appState.loading = false; return; }
      if (Array.isArray(more) && more.length > 0) {
        appState.starred = more.map(s => ({ ...(s.repo || s), starred_at: s.starred_at || s.created_at }));
        _seedStarredCache();
        appState.starredPage = page;
        appState.starredHasMore = more.length >= 100;
        appState.starredSelected = 0;
        appState.starredScroll = 0;
      } else {
        appState.starredHasMore = false;
      }
      appState.loading = false;
      render();
    }).catch((e) => {
      if (!isStale(gen, 'repos')) showMessage('Failed to load starred page: ' + ((e && e.message) || 'unknown'), 'error');
      appState.loading = false;
      if (!isStale(gen, 'repos')) render();
    });
  }
}

export const keys = {
  '/': () => { if (appState.reposView === 'own') startInput('Filter: ', 'filter'); },
  'c': clearAllFilters,
  'l': () => {
    // Manual load-more if the background cap kicked in (lowercase l).
    if (appState._moreReposAvailable && appState.reposView === 'own') {
      appState._moreReposAvailable = false;
      const gen = startAsync('repos-more');
      appState.reposHasMore = true;
      loadAllReposBackground(gen);
    }
  },
  'n': () => { if (appState.reposView === 'own') toggleRepoSort('name'); },
  'S': () => { if (appState.reposView === 'own') toggleRepoSort('stars'); },
  'f': () => { if (appState.reposView === 'own') toggleRepoSort('forks'); },
  'i': () => { if (appState.reposView === 'own') toggleRepoSort('issues'); },
  'u': () => { if (appState.reposView === 'own') toggleRepoSort('updated'); },
  't': () => { if (appState.reposView === 'own') cycleTypeFilter(); },
  'L': () => { if (appState.reposView === 'own') startInput('Language: ', 'lang-filter'); },
  'x': () => { if (appState.reposView === 'own') toggleStale(); },
  'D': () => { if (appState.reposView === 'own') toggleDensity(); },
  'P': () => { if (appState.reposView === 'own') togglePinCurrent(); },
  's': () => { if (appState.reposView === 'own') toggleStarCurrent(); },
  'V': toggleReposView,
};

export function up(screen) {
  if (appState.reposView === 'starred') {
    if (appState.starredSelected > 0) appState.starredSelected--;
    if (appState.starredSelected < appState.starredScroll) appState.starredScroll = appState.starredSelected;
    render();
    return;
  }
  if (appState.repoSelected > 0) appState.repoSelected--;
  if (appState.repoSelected < appState.repoScroll) appState.repoScroll = appState.repoSelected;
  render();
}
export function down(screen) {
  if (appState.reposView === 'starred') {
    const total = appState.starred.length;
    appState.starredSelected = Math.min(total - 1, appState.starredSelected + 1);
    const v = visibleRows(screen);
    if (appState.starredSelected >= appState.starredScroll + v) appState.starredScroll = appState.starredSelected - v + 1;
    render();
    return;
  }
  const total = applyAllFilters(sortRepos(appState.repos, appState.repoSort)).length;
  appState.repoSelected = Math.min(total - 1, appState.repoSelected + 1);
  const v = visibleRows(screen);
  if (appState.repoSelected >= appState.repoScroll + v) appState.repoScroll = appState.repoSelected - v + 1;
  render();
}
export function space() {
  if (appState.reposView === 'starred') { loadMoreStarred(); return; }
  loadMoreRepos();
}
export function enter() {
  if (appState.reposView === 'starred') {
    const r = appState.starred[appState.starredSelected];
    if (r) {
      const [owner, name] = r.full_name.split('/');
      setTab(2);
      loadRepoDetails(owner, name);
    }
    return;
  }
  openCurrentInAnalyze();
}

export function bottom(screen) {
  if (appState.reposView === 'starred') {
    const total = appState.starred.length;
    appState.starredSelected = Math.max(0, total - 1);
    const v = visibleRows(screen);
    appState.starredScroll = Math.max(0, total - v);
    render();
    return;
  }
  const total = applyAllFilters(sortRepos(appState.repos, appState.repoSort)).length;
  appState.repoSelected = Math.max(0, total - 1);
  const v = visibleRows(screen);
  appState.repoScroll = Math.max(0, total - v);
  render();
}

// ── Collapsible sections ──
const REPOS_SECTIONS = ['pinned', 'repos'];

export function getSections() {
  return REPOS_SECTIONS.map(s => 'repos:' + s);
}

export function getCurrentSection() {
  if (appState.reposView === 'starred') return 'repos:repos';
  let list = sortRepos(appState.repos, appState.repoSort);
  list = applyAllFilters(list);
  list = floatPinsToTop(list);
  const repo = list[appState.repoSelected];
  if (repo && isPinnedLocal(repo.full_name)) return 'repos:pinned';
  return 'repos:repos';
}
