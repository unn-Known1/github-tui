// Repos tab — your personal repositories.
// W2/W3 features: row selection, Enter to drill in, type filter cycle,
// language facet, stale filter, density toggle, pins, badges, honest counts.

import { appState, render, startAsync, isStale, showMessage, setTab } from '../state.mjs';
import { getAuthenticatedUser, getUserRepositories } from '../github.mjs';
import { removeToken } from '../config.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import { shortNum, relTime } from '../utils.mjs';
import { color } from '../theme.mjs';
import { loadDashboardWidgets } from './dashboard.mjs';
import { isBookmarked } from '../store.mjs';
import { isPinned, togglePin, loadPins } from '../store.mjs';
import { loadRepoDetails } from './analyze.mjs';

const REPOS_PER_PAGE = 30;
const STALE_DAYS = 180;

export const REPO_SORT_OPTIONS = [
  { field: 'name',    label: 'Name',    key: 'n' },
  { field: 'stars',   label: '★ Stars', key: 'S' },
  { field: 'forks',   label: '⑂ Forks', key: 'f' },
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

function applyAllFilters(repos) {
  let out = [...repos];

  // Type filter cycle.
  switch (appState.repoTypeFilter) {
    case 'sources':   out = out.filter(r => !r.fork); break;
    case 'forks':     out = out.filter(r => r.fork); break;
    case 'archived':  out = out.filter(r => r.archived); break;
    case 'private':   out = out.filter(r => r.private); break;
    case 'public':    out = out.filter(r => !r.private); break;
    case 'templates': out = out.filter(r => r.is_template); break;
  }

  // Language facet.
  if (appState.reposLangFilter) {
    out = out.filter(r => (r.language || '') === appState.reposLangFilter);
  }

  // Stale-only toggle.
  if (appState.repoStaleOnly) {
    const cutoff = Date.now() - STALE_DAYS * 86400000;
    out = out.filter(r => new Date(r.pushed_at || r.updated_at).getTime() < cutoff);
  }

  // Substring filter.
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

function floatPinsToTop(repos) {
  if (appState.repoPins.length === 0) return repos;
  const pins = new Set(appState.repoPins);
  const pinned = [];
  const rest = [];
  for (const r of repos) (pins.has(r.full_name) ? pinned : rest).push(r);
  // Preserve pin order from the on-disk list.
  pinned.sort((a, b) =>
    appState.repoPins.indexOf(a.full_name) - appState.repoPins.indexOf(b.full_name));
  return [...pinned, ...rest];
}

// ─── Loaders ──────────────────────────────────────────────────────

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
  // density toggle: comfortable density = 2 lines per row, half the rows fit.
  const compact = appState.repoDensity === 'compact';
  return Math.max(1, Math.floor((screen.height - 18) / (compact ? 1 : 2)));
}

function badgesFor(r) {
  const out = [];
  if (r.private)      out.push(['🔒', color('warning')]);
  if (r.fork)         out.push(['🔱', color('accent')]);
  if (r.archived)     out.push(['📦', 'dim']);
  if (r.is_template)  out.push(['🗄', color('trending')]);
  if (isPinned(r.full_name)) out.push(['📌', color('star')]);
  if (isBookmarked(r.full_name)) out.push(['★', color('star')]);
  return out;
}

function filterTagsLine() {
  const tags = [];
  if (appState.repoTypeFilter !== 'all') tags.push('type=' + appState.repoTypeFilter);
  if (appState.reposLangFilter)          tags.push('lang=' + appState.reposLangFilter);
  if (appState.repoStaleOnly)            tags.push('stale-only');
  if (appState.repoFilter)               tags.push('"' + appState.repoFilter + '"');
  return tags.join('  •  ');
}

// ─── Render ───────────────────────────────────────────────────────

export function renderRepos(screen, y, h) {
  const W = screen.width;
  let repos = sortRepos(appState.repos, appState.repoSort);
  repos = applyAllFilters(repos);
  repos = floatPinsToTop(repos);

  // Aggregate over the unfiltered list — gives an account-wide picture.
  const totalStars = appState.repos.reduce((a, r) => a + (r.stargazers_count || 0), 0);
  const totalForks = appState.repos.reduce((a, r) => a + (r.forks_count || 0), 0);
  const totalIssues = appState.repos.reduce((a, r) => a + (r.open_issues_count || 0), 0);
  const totalArch = appState.repos.filter(r => r.archived).length;
  const headerRight = '★' + shortNum(totalStars) + '  ⑂' + shortNum(totalForks) +
    '  ⚡' + shortNum(totalIssues) + '  (' + appState.repos.length + ' repos' +
    (totalArch ? ', ' + totalArch + ' archived' : '') + ')';
  screen.writeStr(4, y, 'Your Repositories', 'bright');
  screen.writeStr(Math.max(4, W - headerRight.length - 2), y, headerRight, 'dim');
  screen.hline(y + 1, '─');

  // Sort + density + filter summary lines.
  const sortInfo = REPO_SORT_OPTIONS.find(o => o.field === appState.repoSort.field);
  const sortDir = appState.repoSort.asc ? '↑' : '↓';
  const densityLabel = appState.repoDensity === 'compact' ? 'compact' : 'comfy';
  const tags = filterTagsLine();
  screen.writeStr(4, y + 2,
    'Sort: ' + sortInfo.label + ' ' + sortDir + '  •  Density: ' + densityLabel +
    (tags ? '  •  ' + tags : ''), color('accent'));

  const keysHint =
    REPO_SORT_OPTIONS.map(o => '[' + o.key + ']' + o.label).join(' ') +
    '  [/] Filter  [t] Type  [L] Lang  [x] Stale  [D] Density  [P] Pin  [s] Star  [Enter] Open';
  screen.writeStr(4, y + 3, keysHint, 'dim');

  if (!repos || repos.length === 0) {
    const msg = (appState.repoFilter || appState.reposLangFilter ||
      appState.repoStaleOnly || appState.repoTypeFilter !== 'all')
      ? 'No repos match current filters  [c] Clear all  [t] Type  [L] Lang'
      : 'No repositories found';
    screen.writeStr(4, y + 5, msg, 'dim');
    return;
  }

  // Column headers.
  const headerY = y + 4;
  screen.writeStr(4,  headerY, 'Repo', 'bright');
  screen.writeStr(34, headerY, 'Lang', 'bright');
  screen.writeStr(46, headerY, '★', 'bright');
  screen.writeStr(53, headerY, '⑂', 'bright');
  screen.writeStr(60, headerY, 'Issues', 'bright');
  screen.writeStr(70, headerY, 'Pushed', 'bright');

  const compact = appState.repoDensity === 'compact';
  const rowH = compact ? 1 : 2;
  const maxRows = Math.max(1, Math.floor((h - 8) / rowH));
  const start = appState.repoScroll;
  const rowsToShow = Math.min(maxRows, Math.max(0, repos.length - start));

  for (let i = 0; i < rowsToShow; i++) {
    const repo = repos[start + i];
    if (!repo) break;
    const row = headerY + 1 + i * rowH;
    const sel = start + i === appState.repoSelected;

    screen.writeStr(2, row, sel ? '▶' : ' ', sel ? 'bright' : null);

    // Badges before the name.
    const badges = badgesFor(repo);
    let nx = 4;
    for (const [icon, c] of badges.slice(0, 3)) {
      screen.writeStr(nx, row, icon, c);
      nx += 2;
    }
    const nameMaxLen = 30 - (nx - 4);
    screen.writeStr(nx, row, (repo.name || 'N/A').substring(0, nameMaxLen),
      sel ? 'bright' : null);

    // Issues vs PRs split — best-effort using open_issues_count and the
    // (rare) pulls_url presence. Today we just show total in brown until
    // the per-repo enrichment lands.
    screen.writeStr(34, row, (repo.language || '—').substring(0, 11), 'dim');
    screen.writeStr(46, row, shortNum(repo.stargazers_count || 0));
    screen.writeStr(53, row, shortNum(repo.forks_count || 0));
    screen.writeStr(60, row, shortNum(repo.open_issues_count || 0));
    screen.writeStr(70, row, relTime(repo.pushed_at || repo.updated_at), 'dim');

    if (!compact && repo.description) {
      screen.writeStr(6, row + 1,
        repo.description.substring(0, W - 10), 'dim');
    }
  }

  // Footer.
  const footerY = headerY + 1 + rowsToShow * rowH + 1;
  if (footerY < y + h) {
    const range = (start + 1) + '-' + Math.min(start + rowsToShow, repos.length) +
      ' of ' + repos.length + ' shown';
    const more = appState.reposHasMore ? '  [Space] Load more from GitHub' : '';
    screen.writeStr(4, footerY, range + more, 'dim');
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
    ? 'Showing repos with no push in 6+ months'
    : 'Stale-only filter cleared', 'info');
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
  appState.repoFilter = '';
  appState.repoTypeFilter = 'all';
  appState.reposLangFilter = null;
  appState.repoStaleOnly = false;
  appState.repoScroll = 0;
  appState.repoSelected = 0;
  showMessage('All filters cleared', 'info');
  render();
}

export const keys = {
  '/': () => startInput('Filter: ', 'filter'),
  'c': clearAllFilters,
  'n': () => toggleRepoSort('name'),
  'S': () => toggleRepoSort('stars'),
  'f': () => toggleRepoSort('forks'),
  'i': () => toggleRepoSort('issues'),
  'u': () => toggleRepoSort('updated'),
  't': cycleTypeFilter,
  'L': () => startInput('Language: ', 'lang-filter'),
  'x': toggleStale,
  'D': toggleDensity,
  'P': togglePinCurrent,
  'g': () => { appState.repoSelected = 0; appState.repoScroll = 0; render(); },
};

export function up(screen) {
  if (appState.repoSelected > 0) appState.repoSelected--;
  if (appState.repoSelected < appState.repoScroll) appState.repoScroll = appState.repoSelected;
  render();
}
export function down(screen) {
  const total = applyAllFilters(sortRepos(appState.repos, appState.repoSort)).length;
  appState.repoSelected = Math.min(total - 1, appState.repoSelected + 1);
  const v = visibleRows(screen);
  if (appState.repoSelected >= appState.repoScroll + v) appState.repoScroll = appState.repoSelected - v + 1;
  render();
}
export const space = loadMoreRepos;
export const enter = openCurrentInAnalyze;

// Capital G = jump to bottom (paired with lowercase 'g' jump-to-top).
export function bottom(screen) {
  const total = applyAllFilters(sortRepos(appState.repos, appState.repoSort)).length;
  appState.repoSelected = Math.max(0, total - 1);
  const v = visibleRows(screen);
  appState.repoScroll = Math.max(0, total - v);
  render();
}
