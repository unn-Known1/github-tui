// Repos tab — your personal repositories.
// v0.5+ polish: dismissable filter chips, cleaner density, better selected row.

import { appState, render, startAsync, isStale, showMessage, setTab } from '../state.mjs';
import { getAuthenticatedUser, getUserRepositories, getStarredRepos } from '../github.mjs';
import { removeToken } from '../config.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import { shortNum, relTime, truncate } from '../utils.mjs';
import { color } from '../theme.mjs';
import { emptyState, scrollIndicators } from '../render.mjs';
import { loadDashboardWidgets } from './dashboard.mjs';
import { isBookmarked } from '../store.mjs';
import { togglePin } from '../store.mjs';
import { loadRepoDetails } from './analyze.mjs';

const REPOS_PER_PAGE = 30;
const STALE_DAYS = 180;

export const REPO_SORT_OPTIONS = [
  { field: 'name',    label: 'Name',    key: 'n' },
  { field: 'stars',   label: 'Stars', key: 'S' },
  { field: 'forks',   label: 'Forks', key: 'f' },
  { field: 'issues',  label: 'Issues',  key: 'i' },
  { field: 'updated', label: 'Updated', key: 'u' },
];

const TYPE_FILTERS = ['all', 'sources', 'forks', 'archived', 'private', 'public', 'templates'];

export function sortRepos(repos, sort) {
  const sorted = [...repos];
  sorted.sort((a, b) => {
    let va, vb;
    switch (sort.field) {
      case 'name':    va = (a.name||'').toLowerCase(); vb = (b.name||'').toLowerCase(); break;
      case 'stars':   va = a.stargazers_count || 0; vb = b.stargazers_count || 0; break;
      case 'forks':   va = a.forks_count || 0; vb = b.forks_count || 0; break;
      case 'issues':  va = a.open_issues_count || 0; vb = b.open_issues_count || 0; break;
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
  appState.repoSelected = 0;
  render();
}

export function applyAllFilters(repos) {
  let out = [...repos];

  switch (appState.repoTypeFilter) {
    case 'sources':   out = out.filter(r => !r.fork); break;
    case 'forks':     out = out.filter(r => r.fork); break;
    case 'archived':  out = out.filter(r => r.archived); break;
    case 'private':   out = out.filter(r => r.private); break;
    case 'public':    out = out.filter(r => !r.private); break;
    case 'templates': out = out.filter(r => r.is_template); break;
  }

  if (appState.reposLangFilter) {
    out = out.filter(r => (r.language || '') === appState.reposLangFilter);
  }

  if (appState.repoStaleOnly) {
    const cutoff = Date.now() - STALE_DAYS * 86400000;
    out = out.filter(r => new Date(r.pushed_at || r.updated_at).getTime() < cutoff);
  }

  if (appState.repoFilter) {
    const q = appState.repoFilter.toLowerCase();
    out = out.filter(r =>
      (r.name||'').toLowerCase().includes(q) ||
      (r.description||'').toLowerCase().includes(q) ||
      (r.language||'').toLowerCase().includes(q)
    );
  }

  return out;
}

export function floatPinsToTop(repos) {
  if (appState.repoPins.length === 0) return repos;
  const pins = new Set(appState.repoPins);
  const pinned = [];
  const rest = [];
  for (const r of repos) (pins.has(r.full_name) ? pinned : rest).push(r);
  pinned.sort((a, b) =>
    appState.repoPins.indexOf(a.full_name) - appState.repoPins.indexOf(b.full_name));
  return [...pinned, ...rest];
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

export async function loadUserData() {
  if (!appState.token) return;
  const gen = startAsync();
  appState.loading = true;
  render();
  try {
    appState.user = await getAuthenticatedUser(appState.token);
    if (isStale(gen)) { appState.loading = false; return; }
    if (appState.user) {
      appState.repos = await getUserRepositories(appState.token, 1, REPOS_PER_PAGE);
      appState.reposPage = 1;
      appState.reposHasMore = appState.repos.length >= REPOS_PER_PAGE;
      if (isStale(gen)) { appState.loading = false; return; }
      loadAllReposBackground(gen);
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
        setTab(5);
        showMessage('Stored token rejected — please log in again', 'error');
      } else {
        showMessage('Failed to load user data: ' + (msg || 'unknown'), 'error');
      }
    }
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

async function loadAllReposBackground(gen) {
  const MAX_PAGES = 10;
  let page = 2;
  while (appState.reposHasMore && page <= MAX_PAGES) {
    try {
      const more = await getUserRepositories(appState.token, page, REPOS_PER_PAGE);
      if (isStale(gen)) { appState.loading = false; return; }
      appState.repos = [...appState.repos, ...more];
      appState.reposPage = page;
      appState.reposHasMore = more.length >= REPOS_PER_PAGE;
      page++;
    } catch (e) {
      if (!isStale(gen)) showMessage('Background repo loading failed: ' + ((e && e.message) || 'unknown'), 'error');
      break;
    }
  }
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
    if (isStale(gen)) { appState.loading = false; return; }
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
  if (isBookmarked(r.full_name)) return { ch: 'B', style: color('bookmarked'),  label: 'bookmarked' };
  return null;
}

// Use in-memory state to avoid disk roundtrip on every row render.
export function isPinnedLocal(fullName) {
  return appState.repoPins && appState.repoPins.indexOf(fullName) >= 0;
}

// ─── Render ───────────────────────────────────────────────────────

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
    screen.writeStr(2, footerY, range + pageInfo + '   [V] Back to own repos   [Enter] Analyze', { dim: true });
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

  // Responsive column positions.
  const badgeW = 2;
  const nameCol = 2 + badgeW + 1;
  const nameW = Math.max(15, Math.floor(W * 0.30));
  const langCol = nameCol + nameW + 1;
  const starsCol = langCol + 12;
  const forksCol = starsCol + 7;
  const issuesCol = forksCol + 7;
  const pushedCol = issuesCol + 8;

  // Column headers.
  const headerY = y + 4;
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
    const range = (start + 1) + '-' + Math.min(start + maxRows, repos.length) +
      ' of ' + repos.length;
    const more = appState.reposHasMore ? '   [Space] Load more' : '';
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

function clearAllFilters() {
  if (appState.reposView !== 'own') return;
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

async function loadStarredRepos() {
  if (!appState.token) return;
  const gen = startAsync();
  appState.loading = true;
  render();
  try {
    const starred = await getStarredRepos(appState.token, 1, 100);
    if (isStale(gen)) { appState.loading = false; return; }
    appState.starred = Array.isArray(starred) ? starred.map(s => ({
      ...s.repo,
      starred_at: s.created_at,
    })) : [];
    appState.starredPage = 1;
    appState.starredHasMore = appState.starred.length >= 100;
    showMessage('Loaded ' + appState.starred.length + ' starred repos', 'success');
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to load starred repos: ' + e.message, 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

export async function loadMoreStarred() {
  if (!appState.token || !appState.starredHasMore) return;
  const gen = startAsync();
  appState.loading = true;
  render();
  try {
    const page = appState.starredPage + 1;
    const more = await getStarredRepos(appState.token, page, 100);
    if (isStale(gen)) { appState.loading = false; return; }
    if (Array.isArray(more) && more.length > 0) {
      appState.starred = [...appState.starred, ...more];
      appState.starredPage = page;
      appState.starredHasMore = more.length >= 100;
      showMessage('Loaded ' + appState.starred.length + ' starred repos', 'success');
    } else {
      appState.starredHasMore = false;
      showMessage('All starred repos loaded', 'info');
    }
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to load more starred repos', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

export function pageUp() {
  if (appState.reposView === 'starred' && appState.starredPage > 1) {
    const page = appState.starredPage - 1;
    const gen = startAsync();
    appState.loading = true;
    render();
    getStarredRepos(appState.token, page, 100).then(more => {
      if (isStale(gen)) { appState.loading = false; return; }
      if (Array.isArray(more)) {
        appState.starred = more;
        appState.starredPage = page;
        appState.starredHasMore = true;
        appState.starredSelected = 0;
        appState.starredScroll = 0;
      }
      appState.loading = false;
      render();
    }).catch((e) => {
      if (!isStale(gen)) showMessage('Failed to load starred page: ' + ((e && e.message) || 'unknown'), 'error');
      appState.loading = false;
      if (!isStale(gen)) render();
    });
  }
}

export function pageDown() {
  if (appState.reposView === 'starred' && appState.starredHasMore) {
    const page = appState.starredPage + 1;
    const gen = startAsync();
    appState.loading = true;
    render();
    getStarredRepos(appState.token, page, 100).then(more => {
      if (isStale(gen)) { appState.loading = false; return; }
      if (Array.isArray(more) && more.length > 0) {
        appState.starred = more;
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
      if (!isStale(gen)) showMessage('Failed to load starred page: ' + ((e && e.message) || 'unknown'), 'error');
      appState.loading = false;
      if (!isStale(gen)) render();
    });
  }
}

export const keys = {
  '/': () => { if (appState.reposView === 'own') startInput('Filter: ', 'filter'); },
  'c': clearAllFilters,
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
