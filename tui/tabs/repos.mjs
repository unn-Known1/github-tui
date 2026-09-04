// Repos tab — your personal repositories.
// v0.5+ polish: dismissable filter chips, cleaner density, better selected row.

import { appState, render, startAsync, isStale, showMessage, setTab, upsertEntity,
  beginLoading, finishLoading, resetAccountState, filterReposByWorkflowState } from '../state.mjs';
import { getAuthenticatedUser, getUserRepositories, getStarredRepos, isStarred, starRepo, unstarRepo, getRepositoryPullRequests } from '../github.mjs';
import { removeToken } from '../config.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import { shortNum, relTime, truncate, displayWidth } from '../utils.mjs';
import { color } from '../theme.mjs';
import { emptyState, scrollIndicators, getBreakpoint } from '../render.mjs';
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

// Starred-view sort override (module-local by contract — no appState fields).
// Null = API order (zero behavior change unless the user sorts in starred view).
let starredSortOverride = null;
let _starredView = null; // last sorted starred list produced by render
export function getStarredSort() { return starredSortOverride; }
export function starredViewList() {
  const base = appState.starred || [];
  return starredSortOverride ? sortRepos(base, starredSortOverride) : base;
}
function toggleStarredSort(field) {
  if (starredSortOverride && starredSortOverride.field === field) starredSortOverride.asc = !starredSortOverride.asc;
  else starredSortOverride = { field, asc: field === 'name' };
  appState.starredSelected = 0;
  appState.starredScroll = 0;
  const opt = REPO_SORT_OPTIONS.find(o => o.field === field);
  showMessage('Starred sort: ' + (opt ? opt.label : field) + (starredSortOverride.asc ? ' ↑' : ' ↓'), 'info');
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

export async function loadUserData({ loadDashboard = true, awaitBackground = false } = {}) {
  if (!appState.token) return;
  const gen = startAsync('repos');
  beginLoading(gen);
  render();
  try {
    appState.user = await getAuthenticatedUser(appState.token, gen.signal);
    if (isStale(gen, 'repos')) { finishLoading(gen); return; }
    if (appState.user) {
      appState.repos = await getUserRepositories(appState.token, 1, REPOS_PER_PAGE, gen.signal);
      appState.reposPage = 1;
      appState.reposHasMore = appState.repos.length >= REPOS_PER_PAGE;
      if (isStale(gen, 'repos')) { finishLoading(gen); return; }
      // Backfill true issue counts (PRs excluded) for the visible page.
      enrichIssueCounts();
      const background = loadAllReposBackground(gen);
      if (awaitBackground) await background;
      if (loadDashboard) loadDashboardWidgets().catch(() => {});
    }
  } catch (e) {
    if (!isStale(gen, 'repos')) {
      const msg = (e && e.message) || '';
      const status = e && e.status;
      if (status === 401 || /401|Bad credentials|Unauthorized/i.test(msg)) {
        resetAccountState();
        removeToken();
        setTab(5);
        showError('Token expired or invalid — please log in again', 'Authentication', { retry: loadUserData });
      } else {
        showError(msg || 'Unknown error', 'Load repos', { retry: loadUserData });
      }
    }
  }
  finishLoading(gen);
  if (!isStale(gen, 'repos')) render();
}

export async function loadAllReposBackground(gen) {
  // Load the complete account repository list in the background. Keep a
  // very high safety ceiling for malformed pagination responses, while
  // avoiding the old 300-repository truncation in normal accounts.
  const MAX_PAGES = 1000;
  let capped = false;
  // Background pagination shares the account generation but owns a separate
  // loading contribution; the foreground first-page request may finish while
  // this work continues.
  const loadingHandle = { ...gen, scope: 'repos-background' };
  beginLoading(loadingHandle);
  try {
  // Bounded prefetch pool (CONCURRENCY=3). Pages are committed to
  // appState.repos in page order via the buffered ordered-commit below, so
  // out-of-order fetch completion can never scramble list order. Over-fetch
  // past the last page is bounded by CONCURRENCY-1 tail pages (discarded).
  const CONCURRENCY = 3;
  let nextPage = 2;
  let commitPage = 2;
  const buffered = new Map(); // page -> repos[]; committed when contiguous
  let exhausted = !appState.reposHasMore;
  let fetchError = null;
  let sawStale = false;
  const commitContiguous = () => {
    while (buffered.has(commitPage)) {
      const items = buffered.get(commitPage);
      buffered.delete(commitPage);
      if (exhausted) { commitPage++; continue; } // discard over-fetched tail
      appState.repos = [...appState.repos, ...items];
      // Actions consumes a snapshot of repositories; keep it complete while
      // background pagination discovers additional account repos. Once the
      // Actions workflow scan has run, drop repos confirmed workflow-less so
      // late pages don't resurrect them.
      if (appState.actionsView === 'repos') appState.actionsRepos = filterReposByWorkflowState(appState.repos);
      appState.reposPage = commitPage;
      appState.reposHasMore = items.length >= REPOS_PER_PAGE;
      // Recompute derived at most every 5 pages + final (was: every page,
      // O(pages x repos) with Date parsing per repo per page). The cheap
      // per-page actionsRepos sync above is kept ungated.
      if (commitPage % 5 === 0 || !appState.reposHasMore) recomputeDashboardDerived();
      commitPage++;
      if (!appState.reposHasMore) exhausted = true;
    }
  };
  const worker = async () => {
    while (!exhausted && !fetchError && !sawStale && !isStale(gen, 'repos')) {
      const p = nextPage++;
      if (p > MAX_PAGES) return;
      let more;
      try {
        more = await getUserRepositories(appState.token, p, REPOS_PER_PAGE, gen.signal);
      } catch (e) {
        if (isStale(gen, 'repos')) { sawStale = true; return; }
        fetchError = e;
        return;
      }
      if (isStale(gen, 'repos')) { sawStale = true; return; }
      buffered.set(p, more);
      commitContiguous();
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (sawStale || isStale(gen, 'repos')) { finishLoading(loadingHandle); return; }
  if (fetchError) {
    showError(((fetchError && fetchError.message) || 'unknown'), 'Background repo load', { retry: () => loadAllReposBackground(gen) });
    finishLoading(loadingHandle);
    return;
  }
  // If the upstream still has more repos but we stopped at MAX_PAGES, surface
  // a non-modal hint so the user knows they can load more.
  if (appState.reposHasMore) {
    appState.reposHasMore = false;  // we won't keep paging silently
    appState._moreReposAvailable = true;
    capped = true;
    if (!isStale(gen, 'repos')) showMessage(
      'Loaded first ' + appState.repos.length + ' repos (' + MAX_PAGES + ' pages). ' +
      'Press [l] or run "repos.load-more" in the palette to fetch more.',
      'info', 6000
    );
  }
  } finally {
    finishLoading(loadingHandle);
  }
  if (!isStale(gen, 'repos')) render();
}

export async function loadMoreRepos() {
  if (!appState.token || !appState.reposHasMore) return;
  const gen = startAsync('repos');
  beginLoading(gen);
  render();
  try {
    const page = appState.reposPage + 1;
    const more = await getUserRepositories(appState.token, page, REPOS_PER_PAGE, gen.signal);
    if (isStale(gen, 'repos')) { finishLoading(gen); return; }
    appState.repos = [...appState.repos, ...more];
    appState.reposPage = page;
    appState.reposHasMore = more.length >= REPOS_PER_PAGE;
    recomputeDashboardDerived();
    enrichIssueCounts();
    showMessage('Loaded ' + appState.repos.length + ' repos total', 'info');
  } catch (e) {
    if (!isStale(gen, 'repos')) showMessage('Failed to load more repos', 'error');
  }
  finishLoading(gen);
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

// ─── Issue-count enrichment ────────────────────────────────────────
// GitHub's open_issues_count field counts open issues AND open pull
// requests together. Since the REST issues endpoint can't exclude PRs,
// we probe each visible repo's open PRs and subtract them, so the Issues
// column shows real issue counts. Cached per repo with a TTL.
const ISSUE_ENRICH_CAP = 30;              // repos per pass (~ one page / screen)
const ISSUE_ENRICH_CONCURRENCY = 4;
const ISSUE_ENRICH_TTL = 10 * 60 * 1000;  // 10 min

export function trueIssueCount(repo) {
  if (!repo || !repo.full_name) return null;
  const e = appState.repoTrueIssues[repo.full_name];
  return e && typeof e.count === 'number' ? e.count : null;
}

export async function enrichIssueCounts() {
  if (!appState.token || !Array.isArray(appState.repos) || appState.repos.length === 0) return;
  const gen = startAsync('repos-issue-counts');
  let list = sortRepos(appState.repos, appState.repoSort);
  list = applyAllFilters(list);
  list = floatPinsToTop(list);
  const now = Date.now();
  // Scroll-idle enrichment: target the visible window instead of always the
  // first page, so rows scrolled into view get true counts too.
  const start = appState.repoScroll || 0;
  const targets = list.slice(start, start + ISSUE_ENRICH_CAP).filter(r => {
    const e = appState.repoTrueIssues[r.full_name];
    return !e || now - e.ts > ISSUE_ENRICH_TTL;
  });
  if (targets.length === 0) return;
  const queue = targets.slice();
  const worker = async () => {
    while (queue.length > 0) {
      if (isStale(gen)) return;
      const r = queue.shift();
      if (!r || !r.full_name) continue;
      const [owner, name] = r.full_name.split('/');
      if (!owner || !name) continue;
      let prCount = 0;
      try {
        const prs = await getRepositoryPullRequests(appState.token, owner, name, 1, 100, 'open', gen.signal);
        if (isStale(gen)) return;
        if (Array.isArray(prs)) prCount = prs.length;
      } catch {
        if (isStale(gen)) return;
        continue; // probe failed — keep the combined-count fallback
      }
      const combined = Math.max(0, r.open_issues_count || 0);
      appState.repoTrueIssues[r.full_name] = { count: Math.max(0, combined - prCount), ts: Date.now() };
    }
  };
  const workers = Array.from({ length: Math.min(ISSUE_ENRICH_CONCURRENCY, Math.max(1, queue.length)) }, worker);
  await Promise.all(workers);
  if (!isStale(gen)) render();
}

// ─── Action helpers ───────────────────────────────────────────────
export function visibleRows(screen) {
  const compact = appState.repoDensity === 'compact';
  const overhead = 9; // account for new chip row + density indicator
  return Math.max(1, Math.floor((screen.height - overhead) / (compact ? 1 : 2)));
}

// Count pinned-run header rows ("★ PINNED" section starts) inside the
// window [start, start+count) of a pin-floated list. Exported for tests and
// used by nav to discount header rows from visibleRows().
export function pinnedHeaderCount(list, start, count) {
  let n = 0;
  for (let i = start; i < Math.min(list.length, start + count); i++) {
    if (isPinnedLocal(list[i].full_name) && (i === 0 || !isPinnedLocal(list[i - 1].full_name))) n++;
  }
  return n;
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
  // No star button in the starred view — stale click bounds from the
  // own-repos view must not linger.
  appState._reposStarBounds = null;
  const W = screen.width;
  // Sorted ONCE per render; selection/mouse must resolve through
  // starredViewList() so indexes match this order.
  const list = starredViewList();
  _starredView = list;

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

  const totalStars = appState.repos.reduce((a, r) => a + (r.stargazers_count || 0), 0);
  const totalForks = appState.repos.reduce((a, r) => a + (r.forks_count || 0), 0);
  const totalIssues = appState.repos.reduce((a, r) => a + (trueIssueCount(r) != null ? trueIssueCount(r) : (r.open_issues_count || 0)), 0);

  screen.writeStr(2, y, 'YOUR REPOSITORIES', color('title') || { fg: 'white', bold: true });
  const statsText = '★ ' + shortNum(totalStars) + '   Y ' + shortNum(totalForks) + '   ◉ ' + shortNum(totalIssues);
  screen.writeStr(Math.max(2, W - statsText.length - 2), y, statsText, { dim: true });
  screen.hline(y + 1, '─', { dim: true });

  // Active filter chips line (dismissible with X).
  const chips = activeFilterChips();
  let chipX = 2;
  const chipY = y + 2;

  // Star / unstar button for the highlighted repo — mirrors the [s] key.
  // Click target stored so mouse.mjs can trigger the same toggle.
  let starRight = W; // right-aligned content must end left of the button
  const selRepo = currentRepo();
  if (appState.token && selRepo) {
    const starred = isStarredLocal(selRepo.full_name);
    const starLabel = starred ? '[s] ★ Unstar' : '[s] ★ Star';
    const starStyle = { fg: 'yellow', bold: true };
    const starX = W - starLabel.length - 2;
    screen.writeStr(starX, chipY, starLabel, starStyle);
    appState._reposStarBounds = { y: chipY, x1: starX, x2: starX + starLabel.length };
    starRight = starX - 2;
  } else {
    appState._reposStarBounds = null;
  }

  if (chips.length > 0) {
    // Width guard: stop emitting chips before they can underlap the star
    // button, collapsing the remainder into a +N overflow chip. Length is
    // computed before writeStr; coords are kept for rendered chips only.
    for (let ci = 0; ci < chips.length; ci++) {
      const chip = chips[ci];
      const text = ' ' + chip.label + ' ✕ ';
      // Cell-based math: filter text is user-typed and may hold CJK/emoji.
      const textW = displayWidth(text);
      if (chipX + textW > starRight - 2) {
        const overflowText = ' +' + (chips.length - ci) + ' ';
        if (chipX + displayWidth(overflowText) <= starRight - 2) {
          screen.writeStr(chipX, chipY, overflowText, { bg: 'darkGray', fg: 'white' });
        }
        break;
      }
      screen.writeStr(chipX, chipY, text, { bg: 'darkGray', fg: 'cyan' });
      // Store chip positions for click-to-dismiss.
      chip._x1 = chipX;
      chip._x2 = chipX + textW;
      chipX += textW + 1;
    }
    // Sort + density indicator on the right (kept clear of the star button).
    const sortInfo = REPO_SORT_OPTIONS.find(o => o.field === appState.repoSort.field);
    const sortDir = appState.repoSort.asc ? ' ↑' : ' ↓';
    const sortText = 'sort: ' + sortInfo.label + sortDir;
    const sortX = Math.max(chipX + 2, starRight - sortText.length - 2);
    screen.writeStr(sortX, chipY, sortText, { fg: 'cyan' });
  } else {
    const sortInfo = REPO_SORT_OPTIONS.find(o => o.field === appState.repoSort.field);
    const sortDir = appState.repoSort.asc ? ' ↑' : ' ↓';
    const densityLabel = appState.repoDensity === 'compact' ? 'compact' : 'comfy';
    const statusText = 'sort: ' + sortInfo.label + sortDir + '   density: ' + densityLabel;
    screen.writeStr(2, chipY, statusText, { dim: true });
    const hint = '[c] clear all';
    const hintX = Math.max(statusText.length + 4, starRight - hint.length - 2);
    screen.writeStr(hintX, chipY, hint, { dim: true });
  }
  // Store chips for click handling (rendered chips only — hidden overflow
  // chips carry no coords so tryDismissChipAt can't hit them).
  appState._filterChips = chips.filter(c => typeof c._x1 === 'number');
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
    const issues = trueIssueCount(repo);
    screen.writeStr(issuesCol, curY, shortNum(issues != null ? issues : (repo.open_issues_count || 0)), statStyle);
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

// Shared star / unstar toggle for any repo object. Ask GitHub for the
// authoritative state instead of trusting the local entity cache, which
// may not have been seeded for every view yet. Updates every in-memory
// copy of stargazers_count so all views agree, then syncs the cache +
// starred-list via upsertEntity.
export async function toggleStarRepo(r) {
  if (!r || !appState.token) { showMessage('Login + select a repo first', 'warning'); return; }
  const fullName = r.full_name;
  const [owner, name] = fullName.split('/');
  try {
    const already = await isStarred(appState.token, owner, name);
    const applyCount = (count) => {
      r.stargazers_count = count;
      for (const arr of [appState.repos, appState.searchResults,
                         appState.trending, appState.forks, appState.actionsRepos]) {
        if (!Array.isArray(arr)) continue;
        for (let i = 0; i < arr.length; i++) {
          if (arr[i] && arr[i].full_name === fullName) arr[i].stargazers_count = count;
        }
      }
      if (appState.repoDetails && appState.repoDetails.full_name === fullName) {
        appState.repoDetails.stargazers_count = count;
      }
      if (Array.isArray(appState.starred)) {
        for (const s of appState.starred) {
          if (s && s.full_name === fullName) s.stargazers_count = count;
        }
      }
    };
    if (already) {
      await unstarRepo(appState.token, owner, name);
      applyCount(Math.max(0, (r.stargazers_count || 0) - 1));
      showMessage('Unstarred ' + fullName, 'success');
    } else {
      await starRepo(appState.token, owner, name);
      applyCount((r.stargazers_count || 0) + 1);
      showMessage('Starred ' + fullName, 'success');
    }
    // upsertEntity keeps appState.starred + the entity cache in sync
    // (removes the repo from the starred view when unstarring there).
    upsertEntity(r, {
      isStarred: !already,
      starredAt: already ? null : new Date().toISOString(),
      isOwner: false,
    });
    render();
  } catch (e) {
    showMessage((e && e.message) || 'Star toggle failed', 'error');
    render();
  }
}

export async function toggleStarCurrent() {
  // Works in both the own-repos view and the starred view (V).
  // Starred branch resolves through starredViewList() so the index matches
  // the rendered (possibly sorted) order.
  const r = appState.reposView === 'starred'
    ? starredViewList()[appState.starredSelected]
    : currentRepo();
  await toggleStarRepo(r);
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
  const gen = startAsync('repos-starred');
  beginLoading(gen);
  render();
  try {
    const starred = await getStarredRepos(appState.token, 1, 100, gen.signal);
    if (isStale(gen, 'repos-starred')) { finishLoading(gen); return; }
    appState.starred = Array.isArray(starred) ? starred.map(s => ({
      ...s.repo,
      starred_at: s.starred_at || s.repo?.starred_at || null,
    })) : [];
    _seedStarredCache();
    appState.starredPage = 1;
    appState.starredHasMore = appState.starred.length >= 100;
    showMessage('Loaded ' + appState.starred.length + ' starred repos', 'success');
  } catch (e) {
    if (!isStale(gen, 'repos-starred')) showMessage('Failed to load starred repos: ' + e.message, 'error');
  }
  finishLoading(gen);
  if (!isStale(gen, 'repos-starred')) render();
}

export async function loadMoreStarred() {
  if (!appState.token || !appState.starredHasMore) return;
  const gen = startAsync('repos-starred');
  beginLoading(gen);
  render();
  try {
    const page = appState.starredPage + 1;
    const more = await getStarredRepos(appState.token, page, 100, gen.signal);
    if (isStale(gen, 'repos-starred')) { finishLoading(gen); return; }
    if (Array.isArray(more) && more.length > 0) {
      const mapped = more.map(s => ({ ...(s.repo || s), starred_at: s.starred_at || s.repo?.starred_at || null }));
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
    if (!isStale(gen, 'repos-starred')) showMessage('Failed to load more starred repos', 'error');
  }
  finishLoading(gen);
  if (!isStale(gen, 'repos-starred')) render();
}

const PAGE_STEP = 10;

export function pageUp() {
  // Pure viewport scroll-up over the loaded list (no server replace-fetch).
  // pageUp takes no screen arg, so a fixed STEP is used.
  if (appState.reposView === 'starred') {
    appState.starredSelected = Math.max(0, appState.starredSelected - PAGE_STEP);
    appState.starredScroll = Math.min(appState.starredScroll, appState.starredSelected);
    render();
    return;
  }
  appState.repoSelected = Math.max(0, appState.repoSelected - PAGE_STEP);
  appState.repoScroll = Math.min(appState.repoScroll, appState.repoSelected);
  render();
}

export function pageDown() {
  if (appState.reposView === 'starred') {
    // Append-model paging: Space stays the sole loader — delegate so the
    // list grows instead of being replaced and selection is preserved.
    if (appState.starredHasMore) { loadMoreStarred(); return; }
    // Fully loaded: pure viewport move over the loaded list.
    const total = starredViewList().length;
    appState.starredSelected = total > 0 ? Math.min(total - 1, appState.starredSelected + PAGE_STEP) : 0;
    if (appState.starredSelected >= appState.starredScroll + PAGE_STEP) appState.starredScroll = appState.starredSelected - PAGE_STEP + 1;
    render();
    return;
  }
  // Own view: viewport paging (was: early-return, dead keys). Total mirrors
  // down()/bottom() (WITHOUT pins — lengths equal); fixed STEP scroll pin.
  const total = applyAllFilters(sortRepos(appState.repos, appState.repoSort)).length;
  appState.repoSelected = total > 0 ? Math.min(total - 1, appState.repoSelected + PAGE_STEP) : 0;
  if (appState.repoSelected >= appState.repoScroll + PAGE_STEP) appState.repoScroll = appState.repoSelected - PAGE_STEP + 1;
  render();
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
  'n': () => { if (appState.reposView === 'starred') toggleStarredSort('name'); else toggleRepoSort('name'); },
  'S': () => { if (appState.reposView === 'starred') toggleStarredSort('stars'); else toggleRepoSort('stars'); },
  'f': () => { if (appState.reposView === 'starred') toggleStarredSort('forks'); else toggleRepoSort('forks'); },
  'i': () => { if (appState.reposView === 'starred') toggleStarredSort('issues'); else toggleRepoSort('issues'); },
  'u': () => { if (appState.reposView === 'starred') toggleStarredSort('updated'); else toggleRepoSort('updated'); },
  't': () => { if (appState.reposView === 'own') cycleTypeFilter(); },
  'L': () => { if (appState.reposView === 'own') startInput('Language: ', 'lang-filter'); },
  'x': () => { if (appState.reposView === 'own') toggleStale(); },
  'D': () => { if (appState.reposView === 'own') toggleDensity(); },
  'P': () => { if (appState.reposView === 'own') togglePinCurrent(); },
  's': () => { toggleStarCurrent(); },
  'V': toggleReposView,
};

export function up(screen) {
  if (appState.reposView === 'starred') {
    if (appState.starredSelected > 0) appState.starredSelected--;
    if (appState.starredSelected < appState.starredScroll) appState.starredScroll = appState.starredSelected;
    render();
    return;
  }
  const total = floatPinsToTop(applyAllFilters(sortRepos(appState.repos, appState.repoSort))).length;
  if (total === 0) { render(); return; }
  if (appState.repoSelected > 0) appState.repoSelected--;
  if (appState.repoSelected < appState.repoScroll) appState.repoScroll = appState.repoSelected;
  render();
}
export function down(screen) {
  if (appState.reposView === 'starred') {
    const total = starredViewList().length;
    appState.starredSelected = Math.min(total - 1, appState.starredSelected + 1);
    const v = visibleRows(screen);
    if (appState.starredSelected >= appState.starredScroll + v) appState.starredScroll = appState.starredSelected - v + 1;
    render();
    return;
  }
  // Own view: discount "★ PINNED" header rows (which consume rendered rows
  // but aren't data rows) from the visible-row budget.
  const fullList = floatPinsToTop(applyAllFilters(sortRepos(appState.repos, appState.repoSort)));
  const total = fullList.length;
  if (total === 0) { render(); return; }
  appState.repoSelected = Math.min(total - 1, appState.repoSelected + 1);
  const rawV = visibleRows(screen);
  const v = Math.max(1, rawV - pinnedHeaderCount(fullList, appState.repoScroll, rawV));
  if (appState.repoSelected >= appState.repoScroll + v) appState.repoScroll = appState.repoSelected - v + 1;
  render();
}
export function space() {
  if (appState.reposView === 'starred') { loadMoreStarred(); return; }
  loadMoreRepos();
}
export function enter() {
  if (appState.reposView === 'starred') {
    const r = starredViewList()[appState.starredSelected];
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
    const total = starredViewList().length;
    appState.starredSelected = Math.max(0, total - 1);
    const v = visibleRows(screen);
    appState.starredScroll = Math.max(0, total - v);
    render();
    return;
  }
  // Own view: discount pinned headers from the visible budget (approximated
  // over the trailing window, since scroll depends on v and vice versa).
  const fullList = floatPinsToTop(applyAllFilters(sortRepos(appState.repos, appState.repoSort)));
  const total = fullList.length;
  if (total === 0) { render(); return; }
  appState.repoSelected = Math.max(0, total - 1);
  const rawV = visibleRows(screen);
  const v = Math.max(1, rawV - pinnedHeaderCount(fullList, Math.max(0, total - rawV), rawV));
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
