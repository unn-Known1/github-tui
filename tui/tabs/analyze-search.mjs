// Search sub-pane — search repos/users/code, paginate, render results.

import { appState, render, startAsync, isStale, showMessage } from '../state.mjs';
import { searchRepositories, searchUsers, searchCode, getUser } from '../github.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import { shortNum, truncate, openUrl, sectionHeader } from '../utils.mjs';
import { color } from '../theme.mjs';
import { emptyState, scrollIndicators } from '../render.mjs';
import { addSavedSearch } from '../store.mjs';

const SEARCH_PER_PAGE = 15;
const USER_SEARCH_PER_PAGE = 20;
const CODE_SEARCH_PER_PAGE = 15;

export async function submitSearch(value) {
  const query = (value || '').trim();
  if (!query) return;
  const gen = startAsync('analyze-search-repos');
  appState.loading = true;
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
    if (isStale(gen, 'analyze-search-repos')) { appState.loading = false; return; }
    appState.searchResults = results;
    appState.searchHasMore = results.length >= SEARCH_PER_PAGE;
    if (results.length === 0) showMessage('No repositories found', 'warning');
  } catch (e) {
    if (!isStale(gen, 'analyze-search-repos')) showMessage(e.message || 'Search failed', 'error');
  }
  appState.loading = false;
  if (!isStale(gen, 'analyze-search-repos')) render();
}
registerInputHandler('search', submitSearch);

export async function submitUserSearch(value) {
  const query = (value || '').trim();
  if (!query) return;
  const gen = startAsync('analyze-search-users');
  appState.loading = true;
  appState.searchQuery = query;
  appState.searchType = 'users';
  appState.userSelectedRepo = 0;
  appState.userSearchScroll = 0;
  appState.userSearchPage = 1;
  appState.analyzeView = 'results';
  render();
  try {
    const results = await searchUsers(appState.token, query, 1, USER_SEARCH_PER_PAGE, gen.signal);
    if (isStale(gen, 'analyze-search-users')) { appState.loading = false; return; }
    appState.userSearchResults = results;
    appState.userSearchHasMore = results.length >= USER_SEARCH_PER_PAGE;
    if (results.length === 0) showMessage('No users found', 'warning');
  } catch (e) {
    if (!isStale(gen, 'analyze-search-users')) showMessage(e.message || 'User search failed', 'error');
  }
  appState.loading = false;
  if (!isStale(gen, 'analyze-search-users')) render();
}

export async function submitCodeSearch(value) {
  const query = (value || '').trim();
  if (!query) return;
  const gen = startAsync('analyze-search-code');
  appState.loading = true;
  appState.searchQuery = query;
  appState.searchType = 'code';
  appState.codeSelectedRepo = 0;
  appState.codeSearchScroll = 0;
  appState.codeSearchPage = 1;
  appState.analyzeView = 'results';
  render();
  try {
    const results = await searchCode(appState.token, query, 1, CODE_SEARCH_PER_PAGE, gen.signal);
    if (isStale(gen, 'analyze-search-code')) { appState.loading = false; return; }
    appState.codeSearchResults = results;
    appState.codeSearchHasMore = results.length >= CODE_SEARCH_PER_PAGE;
    if (results.length === 0) showMessage('No code results found', 'warning');
  } catch (e) {
    if (!isStale(gen, 'analyze-search-code')) showMessage(e.message || 'Code search failed', 'error');
  }
  appState.loading = false;
  if (!isStale(gen, 'analyze-search-code')) render();
}

registerInputHandler('user-search', submitUserSearch);
registerInputHandler('code-search', submitCodeSearch);

export async function openUserProfile(login) {
  if (!login) return;
  const gen = startAsync('analyze-user-profile');
  appState.loading = true;
  render();
  try {
    const user = await getUser(appState.token, login, gen.signal);
    if (isStale(gen, 'analyze-user-profile')) { appState.loading = false; return; }
    if (user && user.html_url) {
      showMessage('@' + login + ': ' + (user.name || '') + ' — ' + user.public_repos + ' repos, ' + user.followers + ' followers', 'info', 5000);
      openUrl(user.html_url).then(res => {
        if (!res.ok) showMessage(res.error || 'Open failed', 'error');
      });
    }
  } catch (e) {
    if (!isStale(gen, 'analyze-user-profile')) showMessage('Failed to load user: ' + e.message, 'error');
  }
  appState.loading = false;
  if (!isStale(gen, 'analyze-user-profile')) render();
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
    : 'analyze-search-repos';
  const scope = getScope(type);
  const gen = startAsync(scope);
  appState.loading = true;
  render();
  try {
    const page = type === 'users' ? appState.userSearchPage + 1
      : type === 'code' ? appState.codeSearchPage + 1
      : appState.searchPage + 1;
    let more;
    if (type === 'users') {
      if (!appState.userSearchHasMore) { appState.loading = false; render(); return; }
      more = await searchUsers(appState.token, appState.searchQuery, page, USER_SEARCH_PER_PAGE, gen.signal);
    } else if (type === 'code') {
      if (!appState.codeSearchHasMore) { appState.loading = false; render(); return; }
      more = await searchCode(appState.token, appState.searchQuery, page, CODE_SEARCH_PER_PAGE, gen.signal);
    } else {
      if (!appState.searchHasMore) { appState.loading = false; render(); return; }
      more = await searchRepositories(appState.token, appState.searchQuery, page, SEARCH_PER_PAGE, gen.signal);
    }
    if (isStale(gen, scope)) { appState.loading = false; return; }
    if (type === 'users') {
      appState.userSearchResults = [...appState.userSearchResults, ...more];
      appState.userSearchPage = page;
      appState.userSearchHasMore = more.length >= USER_SEARCH_PER_PAGE;
    } else if (type === 'code') {
      appState.codeSearchResults = [...appState.codeSearchResults, ...more];
      appState.codeSearchPage = page;
      appState.codeSearchHasMore = more.length >= CODE_SEARCH_PER_PAGE;
    } else {
      appState.searchResults = [...appState.searchResults, ...more];
      appState.searchPage = page;
      appState.searchHasMore = more.length >= SEARCH_PER_PAGE;
    }
    if (more.length === 0) showMessage('No more results', 'info');
  } catch (e) {
    if (!isStale(gen, scope)) showMessage(e.message || 'Failed to load more', 'error');
  }
  appState.loading = false;
  if (!isStale(gen, scope)) render();
}

export function pageUp() {
  if (appState.analyzeView === 'results') {
    const type = appState.searchType || 'repos';
    if (type === 'users' && appState.userSearchPage > 1) {
      const page = appState.userSearchPage - 1;
      const gen = startAsync('analyze-search-users');
      appState.loading = true;
      render();
      searchUsers(appState.token, appState.searchQuery, page, USER_SEARCH_PER_PAGE, gen.signal).then(more => {
        if (isStale(gen, 'analyze-search-users')) { appState.loading = false; return; }
        if (Array.isArray(more)) {
          appState.userSearchResults = more;
          appState.userSearchPage = page;
          appState.userSearchHasMore = more.length >= USER_SEARCH_PER_PAGE;
          appState.userSelectedRepo = 0;
          appState.userSearchScroll = 0;
        }
        appState.loading = false;
        render();
      }).catch(e => { if (!isStale(gen, 'analyze-search-users')) showMessage(e.message || 'Page up failed', 'error'); appState.loading = false; render(); });
    } else if (type === 'code' && appState.codeSearchPage > 1) {
      const page = appState.codeSearchPage - 1;
      const gen = startAsync('analyze-search-code');
      appState.loading = true;
      render();
      searchCode(appState.token, appState.searchQuery, page, CODE_SEARCH_PER_PAGE, gen.signal).then(more => {
        if (isStale(gen, 'analyze-search-code')) { appState.loading = false; return; }
        if (Array.isArray(more)) {
          appState.codeSearchResults = more;
          appState.codeSearchPage = page;
          appState.codeSearchHasMore = more.length >= CODE_SEARCH_PER_PAGE;
          appState.codeSelectedRepo = 0;
          appState.codeSearchScroll = 0;
        }
        appState.loading = false;
        render();
      }).catch(e => { if (!isStale(gen, 'analyze-search-code')) showMessage(e.message || 'Page up failed', 'error'); appState.loading = false; render(); });
    } else if (type === 'repos' && appState.searchPage > 1) {
      const page = appState.searchPage - 1;
      const gen = startAsync('analyze-search-repos');
      appState.loading = true;
      render();
      searchRepositories(appState.token, appState.searchQuery, page, SEARCH_PER_PAGE, gen.signal).then(more => {
        if (isStale(gen, 'analyze-search-repos')) { appState.loading = false; return; }
        if (Array.isArray(more)) {
          appState.searchResults = more;
          appState.searchPage = page;
          appState.searchHasMore = more.length >= SEARCH_PER_PAGE;
          appState.selectedRepo = 0;
          appState.searchScroll = 0;
        }
        appState.loading = false;
        render();
      }).catch(e => { if (!isStale(gen, 'analyze-search-repos')) showMessage(e.message || 'Page up failed', 'error'); appState.loading = false; render(); });
    }
  }
}

export function pageDown() {
  if (appState.analyzeView === 'results') {
    const type = appState.searchType || 'repos';
    if (type === 'users' && appState.userSearchHasMore) {
      const page = appState.userSearchPage + 1;
      const gen = startAsync('analyze-search-users');
      appState.loading = true;
      render();
      searchUsers(appState.token, appState.searchQuery, page, USER_SEARCH_PER_PAGE, gen.signal).then(more => {
        if (isStale(gen, 'analyze-search-users')) { appState.loading = false; return; }
        if (Array.isArray(more) && more.length > 0) {
          appState.userSearchResults = [...appState.userSearchResults, ...more];
          appState.userSearchPage = page;
          appState.userSearchHasMore = more.length >= USER_SEARCH_PER_PAGE;
        } else {
          appState.userSearchHasMore = false;
        }
        appState.loading = false;
        render();
      }).catch(e => { if (!isStale(gen, 'analyze-search-users')) showMessage(e.message || 'Page down failed', 'error'); appState.loading = false; render(); });
    } else if (type === 'code' && appState.codeSearchHasMore) {
      const page = appState.codeSearchPage + 1;
      const gen = startAsync('analyze-search-code');
      appState.loading = true;
      render();
      searchCode(appState.token, appState.searchQuery, page, CODE_SEARCH_PER_PAGE, gen.signal).then(more => {
        if (isStale(gen, 'analyze-search-code')) { appState.loading = false; return; }
        if (Array.isArray(more) && more.length > 0) {
          appState.codeSearchResults = [...appState.codeSearchResults, ...more];
          appState.codeSearchPage = page;
          appState.codeSearchHasMore = more.length >= CODE_SEARCH_PER_PAGE;
        } else {
          appState.codeSearchHasMore = false;
        }
        appState.loading = false;
        render();
      }).catch(e => { if (!isStale(gen, 'analyze-search-code')) showMessage(e.message || 'Page down failed', 'error'); appState.loading = false; render(); });
    } else if (type === 'repos' && appState.searchHasMore) {
      const page = appState.searchPage + 1;
      const gen = startAsync('analyze-search-repos');
      appState.loading = true;
      render();
      searchRepositories(appState.token, appState.searchQuery, page, SEARCH_PER_PAGE, gen.signal).then(more => {
        if (isStale(gen, 'analyze-search-repos')) { appState.loading = false; return; }
        if (Array.isArray(more) && more.length > 0) {
          appState.searchResults = [...appState.searchResults, ...more];
          appState.searchPage = page;
          appState.searchHasMore = more.length >= SEARCH_PER_PAGE;
        } else {
          appState.searchHasMore = false;
        }
        appState.loading = false;
        render();
      }).catch(e => { if (!isStale(gen, 'analyze-search-repos')) showMessage(e.message || 'Page down failed', 'error'); appState.loading = false; render(); });
    }
  }
}

export function renderSearchInput(screen, y, h) {
  const W = screen.width;
  const inputY = y + 3;
  const inputW = Math.min(50, W - 12);

  sectionHeader(screen, 2, inputY - 1, '🔎 SEARCH PUBLIC REPOSITORIES');
  screen.box(2, inputY, inputW + 2, 3, '');

  if (appState.inputMode) {
    const shown = appState.inputMask
      ? '*'.repeat(appState.inputBuffer.length) : appState.inputBuffer;
    screen.writeStr(4, inputY + 1,
      (appState.inputPrompt + shown + '_').substring(0, inputW - 2), { fg: 'cyan', underline: true });
  } else {
    screen.writeStr(4, inputY + 1, 'Type a repo name or keywords...', { dim: true });
  }

  // Tips + quick examples.
  let tipY = inputY + 4;
  screen.writeStr(2, tipY, '💡 Tips', { fg: 'yellow', bold: true });
  const tips = [
    '• Search by name:    facebook/react',
    '• Search by topic:   language:rust stars:>1000',
    '• Filter orgs:       org:microsoft',
    '• Combine filters:   machine learning language:python',
  ];
  for (const t of tips) {
    screen.writeStr(2, ++tipY, t, { dim: true });
  }

  // Recent repos (if any) — quick access.
  if (appState.recentRepos.length > 0) {
    tipY += 2;
    sectionHeader(screen, 2, tipY, '🕘 RECENT');
    const recentStart = tipY;
    tipY++;
    let recentIdx = 0;
    for (const r of appState.recentRepos.slice(0, 5)) {
      screen.writeStr(2, tipY, truncate(r.full_name, W - 4), color('repoName') || { fg: 'white' });
      if (r.description) {
        const desc = '  ' + truncate(r.description, W - 22);
        screen.writeStr(2 + 2 + truncate(r.full_name, W - 4).length, tipY, desc, { dim: true });
      }
      tipY++;
      recentIdx++;
      if (tipY > y + h - 2) break;
    }
    appState._recentReposBounds = { x: 2, y: recentStart, count: recentIdx };
  }
}

export function renderResultsList(screen, y, h) {
  const W = screen.width;
  const type = appState.searchType || 'repos';
  const typeLabel = type === 'repos' ? 'REPOS' : type === 'users' ? 'USERS' : 'CODE';
  screen.writeStr(2, y + 1, 'Search ' + typeLabel + ':', color('title') || { fg: 'white', bold: true });
  screen.writeStr(14 + typeLabel.length, y + 1, appState.searchQuery || '', { fg: 'cyan' });
  const hint = type === 'repos' ? '[i] Search repos   [u] Search users   [C] Search code'
    : type === 'users' ? '[i] Search repos   [u] Search users   [C] Search code'
    : '[i] Search repos   [u] Search users   [C] Search code';
  screen.writeStr(2, y + 2, hint, { dim: true });

  const listY = y + 4;
  const maxVisible = Math.max(1, Math.min(8, h - 10));

  if (type === 'users') {
    renderUserResults(screen, listY, h, W, maxVisible);
  } else if (type === 'code') {
    renderCodeResults(screen, listY, h, W, maxVisible);
  } else {
    renderRepoResults(screen, listY, h, W, maxVisible);
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
  return appState.searchResults;
}
