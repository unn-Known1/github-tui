// Search sub-pane — search repos/users/code, paginate, render results.

import { appState, render, startAsync, isStale, showMessage, beginLoading, finishLoading } from '../state.mjs';
import { searchRepositories, searchUsers, searchCode, getUser, getUserRepos } from '../github.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import { shortNum, truncate, truncateToWidth, sectionHeader } from '../utils.mjs';
import { color } from '../theme.mjs';
import { emptyState, scrollIndicators } from '../render.mjs';
import { addSavedSearch } from '../store.mjs';
import { sortRepos } from '../repos-logic.mjs';

const SEARCH_PER_PAGE = 15;
const USER_SEARCH_PER_PAGE = 20;
const CODE_SEARCH_PER_PAGE = 15;
const USER_REPOS_PER_PAGE = 20;

// How many result rows fit in the given content height (rows above/below the
// list: search header, hint, section header, hline, count + hint rows).
// Single source of truth shared by the renderer, keyboard nav, and mouse.
export function maxVisibleResults(contentH) {
  return Math.max(1, contentH - 8);
}

// ── Explore base-view landing ─────────────────────────────────────
// The search view shows a two-column landing below the input: trending
// repos (left) and saved searches + recent repos (right). Items are merged
// into one linear list so keyboard nav, mouse clicks, and rendering agree.

export const EXPLORE_MAX_TRENDING = 6;
export const EXPLORE_MAX_SAVED = 5;
export const EXPLORE_MAX_RECENT = 5;

export function getExploreLanding() {
  const items = [];
  for (const r of appState.trending.slice(0, EXPLORE_MAX_TRENDING)) items.push({ kind: 'trending', repo: r });
  for (const s of appState.savedSearches.slice(0, EXPLORE_MAX_SAVED)) items.push({ kind: 'saved', search: s });
  for (const r of appState.recentRepos.slice(0, EXPLORE_MAX_RECENT)) items.push({ kind: 'recent', repo: r });
  return items;
}

// Lazy-load "trending this week" for the landing (same query the dashboard
// uses). Guarded so it only fires once per session and only when authenticated.
export function loadExploreTrending() {
  if (!appState.token || appState._exploreTrendingLoaded || appState.loading) return;
  appState._exploreTrendingLoaded = true;
  if (appState.trending.length > 0) return;
  const gen = startAsync('analyze-explore-trending');
  const days = appState.trendingPeriod || 7;
  const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  searchRepositories(appState.token, 'created:>' + since + ' stars:>5', 1, 30, gen.signal)
    .then(list => {
      if (isStale(gen, 'analyze-explore-trending')) return;
      if (Array.isArray(list) && list.length > 0) {
        appState.trending = list;
        appState.trendingHasMore = list.length >= 30;
      }
      render();
    })
    .catch(() => {});
}

export function exploreUp() {
  const len = getExploreLanding().length;
  if (len === 0) return;
  appState.exploreSel = Math.max(0, (appState.exploreSel || 0) - 1);
  if (appState.exploreSel < (appState.exploreLandingScroll || 0)) appState.exploreLandingScroll = appState.exploreSel;
  render();
}

export function exploreDown() {
  const len = getExploreLanding().length;
  if (len === 0) return;
  appState.exploreSel = Math.min(len - 1, (appState.exploreSel || 0) + 1);
  render();
}

export function getExploreSelectionLabel() {
  const all = getExploreLanding();
  const item = all[appState.exploreSel] || (appState._exploreVisibleItems || [])[appState.exploreSel];
  if (!item) return 'Nothing selected';
  return item.kind === 'saved' ? 'Saved search — Enter runs it' :
    item.kind === 'trending' ? 'Trending repo — Enter opens it' :
    'Recent repo — Enter opens it';
}

export async function submitSearch(value) {
  const query = (value || '').trim();
  if (!query) { showMessage('Type a query first — e.g. language:rust stars:>1000', 'warning'); return; }
  const gen = startAsync('analyze-search-repos');
  beginLoading(gen);
  appState.searchQuery = query;
  appState.searchType = 'repos';
  appState.repoDetails = null;
  appState.forks = [];
  appState.selectedRepo = 0;
  appState.searchScroll = 0;
  appState.searchPage = 1;
  appState.analyzeView = 'results';
  render();
  try {
    const results = await searchRepositories(appState.token, query, 1, SEARCH_PER_PAGE, gen.signal);
    if (isStale(gen, 'analyze-search-repos')) { finishLoading(gen); return; }
    appState.searchResults = results;
    appState.searchHasMore = results.length >= SEARCH_PER_PAGE;
    if (results.length === 0) showMessage('No repositories found', 'warning');
  } catch (e) {
    if (!isStale(gen, 'analyze-search-repos')) showMessage(e.message || 'Search failed', 'error');
  }
  finishLoading(gen);
  if (!isStale(gen, 'analyze-search-repos')) render();
}
registerInputHandler('search', submitSearch);

export async function submitUserSearch(value) {
  const query = (value || '').trim();
  if (!query) { showMessage('Type a query first — e.g. torvalds location:finland', 'warning'); return; }
  const gen = startAsync('analyze-search-users');
  beginLoading(gen);
  appState.searchQuery = query;
  appState.searchType = 'users';
  appState.userSelectedRepo = 0;
  appState.userSearchScroll = 0;
  appState.userSearchPage = 1;
  appState.analyzeView = 'results';
  render();
  try {
    const results = await searchUsers(appState.token, query, 1, USER_SEARCH_PER_PAGE, gen.signal);
    if (isStale(gen, 'analyze-search-users')) { finishLoading(gen); return; }
    appState.userSearchResults = results;
    appState.userSearchHasMore = results.length >= USER_SEARCH_PER_PAGE;
    if (results.length === 0) showMessage('No users found', 'warning');
  } catch (e) {
    if (!isStale(gen, 'analyze-search-users')) showMessage(e.message || 'User search failed', 'error');
  }
  finishLoading(gen);
  if (!isStale(gen, 'analyze-search-users')) render();
}

export async function submitCodeSearch(value) {
  const query = (value || '').trim();
  if (!query) { showMessage('Type a query first — e.g. repo:facebook/react hooks', 'warning'); return; }
  const gen = startAsync('analyze-search-code');
  beginLoading(gen);
  appState.searchQuery = query;
  appState.searchType = 'code';
  appState.codeSelectedRepo = 0;
  appState.codeSearchScroll = 0;
  appState.codeSearchPage = 1;
  appState.analyzeView = 'results';
  render();
  try {
    const results = await searchCode(appState.token, query, 1, CODE_SEARCH_PER_PAGE, gen.signal);
    if (isStale(gen, 'analyze-search-code')) { finishLoading(gen); return; }
    appState.codeSearchResults = results;
    appState.codeSearchHasMore = results.length >= CODE_SEARCH_PER_PAGE;
    if (results.length === 0) showMessage('No code results found', 'warning');
  } catch (e) {
    if (!isStale(gen, 'analyze-search-code')) showMessage(e.message || 'Code search failed', 'error');
  }
  finishLoading(gen);
  if (!isStale(gen, 'analyze-search-code')) render();
}

registerInputHandler('user-search', submitUserSearch);
registerInputHandler('code-search', submitCodeSearch);

export async function openUserRepos(user) {
  if (!user || !user.login) return;
  const gen = startAsync('analyze-user-repos');
  beginLoading(gen);
  appState.searchType = 'user-repos';
  appState.selectedUser = user;
  appState.analyzeView = 'results';
  appState.userReposSelected = 0;
  appState.userReposScroll = 0;
  appState.userReposPage = 1;
  appState.userReposHasMore = true;
  appState.userRepos = [];
  render();
  try {
    // Fetch the full profile (name/followers/public_repos) alongside the
    // first page of repos so the header can show real stats.
    const [profile, repos] = await Promise.all([
      getUser(appState.token, user.login, gen.signal).catch(() => null),
      getUserRepos(appState.token, user.login, 1, USER_REPOS_PER_PAGE, gen.signal),
    ]);
    if (isStale(gen, 'analyze-user-repos')) { finishLoading(gen); return; }
    appState.selectedUser = profile && profile.login ? { ...profile } : user;
    appState.userRepos = repos;
    appState.userReposHasMore = repos.length >= USER_REPOS_PER_PAGE;
    applyUserReposSort();
    if (repos.length === 0) showMessage('@' + user.login + ' has no public repos', 'warning');
  } catch (e) {
    if (!isStale(gen, 'analyze-user-repos')) showMessage(e.message || 'Failed to load user repos', 'error');
  }
  finishLoading(gen);
  if (!isStale(gen, 'analyze-user-repos')) render();
}

export const USER_REPOS_SORT_LABELS = {
  stars: 'Stars',
  updated: 'Last updated',
  name: 'Name',
};

export function applyUserReposSort() {
  appState.userRepos = sortRepos(appState.userRepos, appState.userReposSort);
  appState.userReposScroll = 0;
}

export function toggleUserReposSort(field) {
  if (appState.userReposSort.field === field) {
    appState.userReposSort.asc = !appState.userReposSort.asc;
  } else {
    appState.userReposSort.field = field;
    appState.userReposSort.asc = field === 'name';
  }
  applyUserReposSort();
  render();
}

registerInputHandler('save-search', (label) => {
  const v = (label || '').trim();
  if (!v) return;
  const query = appState.searchQuery;
  if (!query) { showMessage('No search query to save', 'warning'); return; }
  appState.savedSearches = addSavedSearch(v, query);
  showMessage('Saved search: ' + v, 'success');
});

export async function loadMoreSearchResults() {
  const type = appState.searchType || 'repos';
  const getScope = (t) => t === 'users' ? 'analyze-search-users'
    : t === 'code' ? 'analyze-search-code'
    : t === 'user-repos' ? 'analyze-user-repos'
    : 'analyze-search-repos';
  const scope = getScope(type);
  const gen = startAsync(scope);
  beginLoading(gen);
  render();
  try {
    const page = type === 'users' ? appState.userSearchPage + 1
      : type === 'code' ? appState.codeSearchPage + 1
      : type === 'user-repos' ? appState.userReposPage + 1
      : appState.searchPage + 1;
    let more;
    if (type === 'users') {
      if (!appState.userSearchHasMore) { finishLoading(gen); render(); return; }
      more = await searchUsers(appState.token, appState.searchQuery, page, USER_SEARCH_PER_PAGE, gen.signal);
    } else if (type === 'code') {
      if (!appState.codeSearchHasMore) { finishLoading(gen); render(); return; }
      more = await searchCode(appState.token, appState.searchQuery, page, CODE_SEARCH_PER_PAGE, gen.signal);
    } else if (type === 'user-repos') {
      if (!appState.userReposHasMore) { finishLoading(gen); render(); return; }
      more = await getUserRepos(appState.token, appState.selectedUser.login, page, USER_REPOS_PER_PAGE, gen.signal);
    } else {
      if (!appState.searchHasMore) { finishLoading(gen); render(); return; }
      more = await searchRepositories(appState.token, appState.searchQuery, page, SEARCH_PER_PAGE, gen.signal);
    }
    if (isStale(gen, scope)) { finishLoading(gen); return; }
    if (type === 'users') {
      appState.userSearchResults = [...appState.userSearchResults, ...more];
      appState.userSearchPage = page;
      appState.userSearchHasMore = more.length >= USER_SEARCH_PER_PAGE;
    } else if (type === 'code') {
      appState.codeSearchResults = [...appState.codeSearchResults, ...more];
      appState.codeSearchPage = page;
      appState.codeSearchHasMore = more.length >= CODE_SEARCH_PER_PAGE;
    } else if (type === 'user-repos') {
      appState.userRepos = [...appState.userRepos, ...more];
      appState.userReposPage = page;
      appState.userReposHasMore = more.length >= USER_REPOS_PER_PAGE;
      applyUserReposSort();
    } else {
      appState.searchResults = [...appState.searchResults, ...more];
      appState.searchPage = page;
      appState.searchHasMore = more.length >= SEARCH_PER_PAGE;
    }
    if (more.length === 0) showMessage('No more results', 'info');
  } catch (e) {
    if (!isStale(gen, scope)) showMessage(e.message || 'Failed to load more', 'error');
  }
  finishLoading(gen);
  if (!isStale(gen, scope)) render();
}

// PageUp scrolls the viewport up within the already-loaded list, mirroring
// the append-model used by PageDown/Space (which append pages). It never
// replaces the list, so PgUp→PgDn cannot duplicate rows.
export function pageUp() {
  if (appState.analyzeView !== 'results') return;
  const STEP = 10;
  const type = appState.searchType || 'repos';
  if (type === 'users') {
    appState.userSelectedRepo = Math.max(0, (appState.userSelectedRepo || 0) - STEP);
    appState.userSearchScroll = Math.min(appState.userSearchScroll || 0, appState.userSelectedRepo);
  } else if (type === 'code') {
    appState.codeSelectedRepo = Math.max(0, (appState.codeSelectedRepo || 0) - STEP);
    appState.codeSearchScroll = Math.min(appState.codeSearchScroll || 0, appState.codeSelectedRepo);
  } else if (type === 'user-repos') {
    appState.userReposSelected = Math.max(0, (appState.userReposSelected || 0) - STEP);
    appState.userReposScroll = Math.min(appState.userReposScroll || 0, appState.userReposSelected);
  } else {
    appState.selectedRepo = Math.max(0, (appState.selectedRepo || 0) - STEP);
    appState.searchScroll = Math.min(appState.searchScroll || 0, appState.selectedRepo);
  }
  render();
}

export function pageDown() {
  if (appState.analyzeView === 'results') {
    const type = appState.searchType || 'repos';
    if (type === 'users' && appState.userSearchHasMore) {
      const page = appState.userSearchPage + 1;
      const gen = startAsync('analyze-search-users');
      beginLoading(gen);
      render();
      searchUsers(appState.token, appState.searchQuery, page, USER_SEARCH_PER_PAGE, gen.signal).then(more => {
        if (isStale(gen, 'analyze-search-users')) { finishLoading(gen); return; }
        if (Array.isArray(more) && more.length > 0) {
          appState.userSearchResults = [...appState.userSearchResults, ...more];
          appState.userSearchPage = page;
          appState.userSearchHasMore = more.length >= USER_SEARCH_PER_PAGE;
        } else {
          appState.userSearchHasMore = false;
        }
        finishLoading(gen);
        render();
      }).catch(e => { if (!isStale(gen, 'analyze-search-users')) showMessage(e.message || 'Page down failed', 'error'); finishLoading(gen); render(); });
    } else if (type === 'code' && appState.codeSearchHasMore) {
      const page = appState.codeSearchPage + 1;
      const gen = startAsync('analyze-search-code');
      beginLoading(gen);
      render();
      searchCode(appState.token, appState.searchQuery, page, CODE_SEARCH_PER_PAGE, gen.signal).then(more => {
        if (isStale(gen, 'analyze-search-code')) { finishLoading(gen); return; }
        if (Array.isArray(more) && more.length > 0) {
          appState.codeSearchResults = [...appState.codeSearchResults, ...more];
          appState.codeSearchPage = page;
          appState.codeSearchHasMore = more.length >= CODE_SEARCH_PER_PAGE;
        } else {
          appState.codeSearchHasMore = false;
        }
        finishLoading(gen);
        render();
      }).catch(e => { if (!isStale(gen, 'analyze-search-code')) showMessage(e.message || 'Page down failed', 'error'); finishLoading(gen); render(); });
    } else if (type === 'user-repos' && appState.userReposHasMore) {
      const page = appState.userReposPage + 1;
      const gen = startAsync('analyze-user-repos');
      beginLoading(gen);
      render();
      getUserRepos(appState.token, appState.selectedUser.login, page, USER_REPOS_PER_PAGE, gen.signal).then(more => {
        if (isStale(gen, 'analyze-user-repos')) { finishLoading(gen); return; }
        if (Array.isArray(more) && more.length > 0) {
          appState.userRepos = [...appState.userRepos, ...more];
          appState.userReposPage = page;
          appState.userReposHasMore = more.length >= USER_REPOS_PER_PAGE;
          applyUserReposSort();
        } else {
          appState.userReposHasMore = false;
        }
        finishLoading(gen);
        render();
      }).catch(e => { if (!isStale(gen, 'analyze-user-repos')) showMessage(e.message || 'Page down failed', 'error'); finishLoading(gen); render(); });
    } else if (type === 'repos' && appState.searchHasMore) {
      const page = appState.searchPage + 1;
      const gen = startAsync('analyze-search-repos');
      beginLoading(gen);
      render();
      searchRepositories(appState.token, appState.searchQuery, page, SEARCH_PER_PAGE, gen.signal).then(more => {
        if (isStale(gen, 'analyze-search-repos')) { finishLoading(gen); return; }
        if (Array.isArray(more) && more.length > 0) {
          appState.searchResults = [...appState.searchResults, ...more];
          appState.searchPage = page;
          appState.searchHasMore = more.length >= SEARCH_PER_PAGE;
        } else {
          appState.searchHasMore = false;
        }
        finishLoading(gen);
        render();
      }).catch(e => { if (!isStale(gen, 'analyze-search-repos')) showMessage(e.message || 'Page down failed', 'error'); finishLoading(gen); render(); });
    }
  }
}

export function renderSearchInput(screen, y, h) {
  const W = screen.width;
  const inputY = y + 3;
  const inputW = Math.min(50, W - 12);
  const type = appState.searchType || 'repos';
  const typeLabel = type === 'users' ? 'SEARCH USERS'
    : type === 'code' ? 'SEARCH CODE'
    : 'SEARCH PUBLIC REPOSITORIES';
  const placeholder = type === 'users' ? 'Type a GitHub username or keywords...'
    : type === 'code' ? 'Type code terms (e.g. user:torvalds language:c)...'
    : 'Type a repo name or keywords...';

  sectionHeader(screen, 2, inputY - 1, '🔎 ' + typeLabel);
  screen.box(2, inputY, inputW + 2, 3, '');

  if (appState.inputMode) {
    const shown = appState.inputMask
      ? '*'.repeat(appState.inputBuffer.length) : appState.inputBuffer;
    screen.writeStr(4, inputY + 1,
      truncateToWidth(appState.inputPrompt + shown + '_', inputW - 2, ''), { fg: 'cyan', underline: true });
  } else {
    screen.writeStr(4, inputY + 1, placeholder, { dim: true });
  }

  // Tips + quick examples.
  let tipY = inputY + 4;
  screen.writeStr(2, tipY, '💡 Tips', { fg: 'yellow', bold: true });
  const tips = type === 'users'
    ? [
        '• Search by username:  torvalds',
        '• Search by full name: "Linus Torvalds"',
        '• Combine filters:     location:finland followers:>1000',
        '• Press Enter on a user to list their public repos',
      ]
    : type === 'code'
    ? [
        '• Search by terms:     map( in:file',
        '• Limit to a repo:     repo:facebook/react hooks',
        '• Limit to a user:      user:torvalds scheduler',
        '• Code search needs auth (login in Settings)',
      ]
    : [
        '• Search by name:    facebook/react',
        '• Search by topic:   language:rust stars:>1000',
        '• Filter orgs:       org:microsoft',
        '• Combine filters:   machine learning language:python',
      ];
  for (const t of tips) {
    screen.writeStr(2, ++tipY, t, { dim: true });
  }

  // Key hints — always show how to search repos, users, and code.
  tipY += 2;
  const hint = '[i] Search repos   [u] Search users   [C] Search code   [Enter] Open highlighted';
  screen.writeStr(2, tipY, hint, { dim: true });
  screen.writeStr(Math.max(2, screen.width - getExploreSelectionLabel().length - 2), tipY,
    getExploreSelectionLabel(), { fg: 'cyan', dim: true });

  renderExploreLanding(screen, tipY + 1, h);
}

function renderExploreLanding(screen, y, h) {
  // Compact, viewport-first landing: the default 24-row terminal should
  // never expose keyboard targets that are below the footer. The selected
  // rows are a single painted list, so Enter and mouse bounds stay in parity.
  const W = screen.width;
  const landing = getExploreLanding();
  const bottom = Math.min(screen.height - 2, y + Math.max(1, h) - 1);
  const maxRows = Math.max(1, bottom - y - 2);
  let scroll = Math.min(appState.exploreLandingScroll || 0, Math.max(0, landing.length - maxRows));
  let sel = Math.max(0, Math.min((appState.exploreSel || 0), Math.max(0, landing.length - 1)));
  if (sel < scroll) scroll = sel;
  else if (sel >= scroll + maxRows) scroll = sel - maxRows + 1;
  appState.exploreSel = sel;
  appState.exploreLandingScroll = scroll;
  const visible = landing.slice(scroll, scroll + maxRows);
  appState._exploreVisibleItems = visible;
  appState._exploreBounds = { list: { x: 2, y: y + 2, count: visible.length, startIdx: scroll } };

  screen.writeStr(2, y, 'EXPLORE', color('title') || { fg: 'white', bold: true });
  screen.writeStr(12, y, visible.length + '/' + landing.length + ' visible', { dim: true });
  screen.hline(y + 1, '─', { dim: true });
  for (let i = 0; i < visible.length; i++) {
    const item = visible[i];
    const row = y + 2 + i;
    const selected = i === sel - scroll;
    for (let x = 0; selected && x < W; x++) screen.styleBuf[row][x] = color('selection');
    const prefix = selected ? '▶ ' : '  ';
    let label;
    let detail = '';
    if (item.kind === 'trending') {
      label = 'Trending  ' + (item.repo?.full_name || '?');
      detail = '★ ' + shortNum(item.repo?.stargazers_count || 0);
    } else if (item.kind === 'saved') {
      label = 'Saved      ' + (item.search?.label || item.search?.query || '?');
      detail = item.search?.query || '';
    } else {
      label = 'Recent     ' + (item.repo?.full_name || '?');
      detail = item.repo?.description || '';
    }
    screen.writeStr(2, row, prefix + truncate(label, Math.max(10, W - 30)), selected ? color('selection') : color('repoName'));
    if (detail) screen.writeStr(Math.max(20, W - Math.min(28, Math.max(8, detail.length)) - 2), row, truncate(detail, 26), selected ? color('selection') : color('dim'));
  }
  scrollIndicators(screen, y + 2, y + 1 + visible.length, scroll, landing.length);
  const above = scroll;
  const below = landing.length - (scroll + visible.length);
  if (above > 0 || below > 0) {
    let more;
    if (above > 0 && below > 0) more = '↑ ' + above + ' above · ↓ ' + below + ' more — search to narrow this list';
    else if (above > 0) more = '↑ ' + above + ' above — search to narrow this list';
    else more = '↓ ' + below + ' more — search to narrow this list';
    screen.writeStr(2, bottom, more, { dim: true });
  }
}

export function renderResultsList(screen, y, h) {
  const W = screen.width;
  const type = appState.searchType || 'repos';
  const typeLabel = type === 'repos' ? 'REPOS' : type === 'users' ? 'USERS'
    : type === 'user-repos' ? "USER'S REPOS" : 'CODE';
  screen.writeStr(2, y + 1, 'Search ' + typeLabel + ':', color('title') || { fg: 'white', bold: true });
  screen.writeStr(14 + typeLabel.length, y + 1, appState.searchQuery || '', { fg: 'cyan' });
  const hint = '[i] Search repos   [u] Search users   [C] Search code   [Ctrl-S] Save search';
  screen.writeStr(2, y + 2, hint, { dim: true });

  const listY = y + 4;
  const maxVisible = maxVisibleResults(h);

  if (type === 'users') {
    renderUserResults(screen, listY, h, W, maxVisible);
  } else if (type === 'code') {
    renderCodeResults(screen, listY, h, W, maxVisible);
  } else if (type === 'user-repos') {
    renderUserRepos(screen, listY, h, W, maxVisible);
  } else {
    renderRepoResults(screen, listY, h, W, maxVisible);
  }
}

function renderUserRepos(screen, listY, h, W, maxVisible) {
  const user = appState.selectedUser;
  const results = appState.userRepos;
  if (user && user.login) {
    const line = '@' + user.login +
      (user.name ? '  ' + user.name : '') +
      (user.public_repos != null ? '   ' + shortNum(user.public_repos) + ' repos' : '') +
      (user.followers != null ? '   ' + shortNum(user.followers) + ' followers' : '') +
      (user.bio ? '   ' + truncate(user.bio, W - 52) : '');
    screen.writeStr(2, listY - 1, truncate(line, W - 4), { fg: 'cyan', bold: true });
  }
  if (results.length === 0) {
    emptyState(screen, listY, h - 4, {
      icon: '○', title: 'No repositories',
      message: user && user.login ? '@' + user.login + ' has no public repos' : 'No public repos',
      hint: '[Esc] Back to user search',
    });
    return;
  }
  sectionHeader(screen, 2, listY, '◫ REPOSITORIES', '[' + results.length + ']');
  screen.hline(listY + 1, '─', { dim: true });
  const start = appState.userReposScroll;
  for (let i = 0; i < maxVisible && start + i < results.length; i++) {
    const repo = results[start + i];
    const row = listY + 2 + i;
    const sel = start + i === appState.userReposSelected;
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    screen.writeStr(2, row, sel ? '▶' : '  ', sel ? color('selection') : color('dim'));
    screen.writeStr(5, row, truncate(repo.name || '?', 24), sel ? color('selection') : color('repoName'));
    const lang = repo.language ? '  ' + repo.language : '';
    screen.writeStr(31, row, truncate((repo.description || '') + lang, W - 36), sel ? color('selection') : color('dim'));
    const stats = '★ ' + shortNum(repo.stargazers_count) +
      '   ⑂ ' + shortNum(repo.forks_count) +
      '   ⚡ ' + shortNum(repo.open_issues_count);
    screen.writeStr(Math.min(74, W - 22), row, stats, sel ? color('selection') : color('dim'));
  }
  scrollIndicators(screen, listY + 2, listY + 1 + maxVisible, appState.userReposScroll, results.length);

  const countY = listY + 2 + maxVisible;
  if (countY < listY + h) {
    const pageInfo = appState.userReposHasMore || appState.userReposPage > 1
      ? '   Page ' + appState.userReposPage + '   [PgUp/PgDn]' : '';
    const sortLabel = USER_REPOS_SORT_LABELS[appState.userReposSort.field] || '';
    const sortInfo = sortLabel ? '   Sort: ' + sortLabel + (appState.userReposSort.asc ? ' ↑' : ' ↓') + '   [S] Stars   [U] Updated' : '';
    screen.writeStr(2, countY, results.length + ' repos' + pageInfo + sortInfo, { dim: true });
  }
}

function renderRepoResults(screen, listY, h, W, maxVisible) {
  const results = appState.searchResults;
  if (results.length === 0) {
    emptyState(screen, listY, h - 4, {
      icon: '○', title: 'No repos found',
      message: 'Try different keywords',
      hint: '[Esc] Back',
    });
    return;
  }
  sectionHeader(screen, 2, listY, '◫ REPOSITORIES', '[' + results.length + ']');
  screen.hline(listY + 1, '─', { dim: true });
  const start = appState.searchScroll;
  for (let i = 0; i < maxVisible && start + i < results.length; i++) {
    const repo = results[start + i];
    const row = listY + 2 + i;
    const sel = start + i === appState.selectedRepo;
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    screen.writeStr(2, row, sel ? '▶' : '  ', sel ? color('selection') : color('dim'));
    screen.writeStr(5, row, truncate(repo.full_name, 30), sel ? color('selection') : color('repoName'));
    const stats = '★ ' + shortNum(repo.stargazers_count) +
      '   ⑂ ' + shortNum(repo.forks_count) +
      '   ⚡ ' + shortNum(repo.open_issues_count);
    screen.writeStr(36, row, stats, sel ? color('selection') : color('dim'));
  }
  scrollIndicators(screen, listY + 2, listY + 1 + maxVisible, appState.searchScroll, results.length);

  const countY = listY + 2 + maxVisible;
  if (countY < listY + h) {
    const pageInfo = appState.searchHasMore || appState.searchPage > 1
      ? '   Page ' + appState.searchPage + '   [PgUp/PgDn]' : '';
    screen.writeStr(2, countY, results.length + ' results' + pageInfo, { dim: true });
  }
}

function renderUserResults(screen, listY, h, W, maxVisible) {
  const results = appState.userSearchResults;
  if (results.length === 0) {
    emptyState(screen, listY, h - 4, {
      icon: '○', title: 'No users found',
      message: 'Try different keywords',
      hint: '[Esc] Back',
    });
    return;
  }
  sectionHeader(screen, 2, listY, '◫ USERS', '[' + results.length + ']');
  screen.hline(listY + 1, '─', { dim: true });
  const start = appState.userSearchScroll;
  for (let i = 0; i < maxVisible && start + i < results.length; i++) {
    const user = results[start + i];
    const row = listY + 2 + i;
    const sel = start + i === appState.userSelectedRepo;
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    screen.writeStr(2, row, sel ? '▶' : '  ', sel ? color('selection') : color('dim'));
    screen.writeStr(5, row, truncate(user.login || '?', 20), sel ? color('selection') : { fg: 'cyan', bold: true });
    const type = user.type || '';
    screen.writeStr(28, row, type, sel ? color('selection') : color('dim'));
  }
  scrollIndicators(screen, listY + 2, listY + 1 + maxVisible, appState.userSearchScroll, results.length);

  const countY = listY + 2 + maxVisible;
  if (countY < listY + h) {
    const pageInfo = appState.userSearchHasMore || appState.userSearchPage > 1
      ? '   Page ' + appState.userSearchPage + '   [PgUp/PgDn]' : '';
    screen.writeStr(2, countY, results.length + ' results' + pageInfo, { dim: true });
    if (countY + 1 < listY + h) {
      screen.writeStr(2, countY + 1, '[Enter] list user\'s repos   [o] open profile   [Space] load more', { dim: true });
    }
  }
}

function renderCodeResults(screen, listY, h, W, maxVisible) {
  const results = appState.codeSearchResults;
  if (results.length === 0) {
    emptyState(screen, listY, h - 4, {
      icon: '○', title: 'No code results found',
      message: 'Try different search terms',
      hint: '[Esc] Back',
    });
    return;
  }
  sectionHeader(screen, 2, listY, '◆ CODE', '[' + results.length + ']');
  screen.hline(listY + 1, '─', { dim: true });
  const start = appState.codeSearchScroll;
  for (let i = 0; i < maxVisible && start + i < results.length; i++) {
    const item = results[start + i];
    const row = listY + 2 + i;
    const sel = start + i === appState.codeSelectedRepo;
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    const path = truncate(item.path || '?', 25);
    const repo = item.repository ? item.repository.full_name : '?';
    screen.writeStr(2, row, sel ? '▶' : '  ', sel ? color('selection') : color('dim'));
    screen.writeStr(5, row, path, sel ? color('selection') : { fg: 'white' });
    screen.writeStr(32, row, truncate(repo, W - 35), sel ? color('selection') : { fg: 'cyan' });
  }
  scrollIndicators(screen, listY + 2, listY + 1 + maxVisible, appState.codeSearchScroll, results.length);

  const countY = listY + 2 + maxVisible;
  if (countY < listY + h) {
    const pageInfo = appState.codeSearchHasMore || appState.codeSearchPage > 1
      ? '   Page ' + appState.codeSearchPage + '   [PgUp/PgDn]' : '';
    screen.writeStr(2, countY, results.length + ' results' + pageInfo, { dim: true });
  }
}

export function getResultList() {
  const type = appState.searchType || 'repos';
  if (type === 'users') return appState.userSearchResults;
  if (type === 'code') return appState.codeSearchResults;
  if (type === 'user-repos') return appState.userRepos;
  return appState.searchResults;
}
