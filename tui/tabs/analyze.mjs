// Analyze tab — search any public repo, drill into rich details,
// toggle Issues/PRs sub-panes, view README, hop to Forks sub-view.

import { appState, render, startAsync, isStale, showMessage } from '../state.mjs';
import {
  searchRepositories, getRepositoryDetails,
  getRepositoryLanguages, getRepositoryContributors,
  getRepositoryReleases, getRepositoryIssues, getRepositoryPullRequests,
  getReadme,
} from '../github.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import { shortNum, truncate } from '../utils.mjs';
import { color } from '../theme.mjs';
import { emptyState } from '../render.mjs';
import { loadForks, loadMoreForks, renderForks, toggleForkSort } from './forks.mjs';
import * as files from './files.mjs';
import { openDetail } from './detail.mjs';
import { addSavedSearch } from '../store.mjs';

const SEARCH_PER_PAGE = 15;

export async function submitSearch(value) {
  const query = (value || '').trim();
  if (!query) return;
  const gen = startAsync();
  appState.loading = true;
  appState.searchQuery = query;
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
registerInputHandler('search', submitSearch);

registerInputHandler('save-search', (label) => {
  const v = (label || '').trim();
  if (!v) return;
  const query = appState.searchQuery;
  if (!query) { showMessage('No search query to save', 'warning'); return; }
  addSavedSearch(v, query);
  showMessage('Saved search: ' + v, 'success');
});

export async function loadMoreSearchResults() {
  if (!appState.searchHasMore) return;
  const gen = startAsync();
  appState.loading = true;
  render();
  try {
    const page = appState.searchPage + 1;
    const more = await searchRepositories(
      appState.token, appState.searchQuery, page, SEARCH_PER_PAGE);
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

export async function loadRepoDetails(owner, name) {
  const gen = startAsync();
  appState.loading = true;
  appState.detailsPane = 'overview';
  appState.detailsScroll = 0;
  appState.repoLanguages = null;
  appState.repoContributors = [];
  appState.repoReleases = [];
  appState.repoIssues = [];
  appState.repoPullRequests = [];
  render();
  try {
    const details = await getRepositoryDetails(appState.token, owner, name);
    if (isStale(gen)) return;
    appState.repoDetails = details;
    appState.analyzeView = 'details';
    render();

    const safe = (p) => p.catch(() => null);
    const [langs, contribs, releases, issues, prs] = await Promise.all([
      safe(getRepositoryLanguages(appState.token, owner, name)),
      safe(getRepositoryContributors(appState.token, owner, name, 1, 10)),
      safe(getRepositoryReleases(appState.token, owner, name, 1, 5)),
      safe(getRepositoryIssues(appState.token, owner, name, 1, 10)),
      safe(getRepositoryPullRequests(appState.token, owner, name, 1, 10)),
    ]);
    if (isStale(gen)) return;
    appState.repoLanguages = langs || null;
    appState.repoContributors = Array.isArray(contribs) ? contribs : [];
    appState.repoReleases = Array.isArray(releases) ? releases : [];
    appState.repoIssues = Array.isArray(issues) ? issues.filter(i => !i.pull_request) : [];
    appState.repoPullRequests = Array.isArray(prs) ? prs : [];
    showMessage('Loaded ' + owner + '/' + name, 'success');
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Failed to load repository', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

// README viewer — overlay-like sub-pane.
export async function viewReadme() {
  const repo = appState.repoDetails;
  if (!repo) return;
  const gen = startAsync();
  appState.loading = true;
  render();
  try {
    const [owner, name] = repo.full_name.split('/');
    const md = await getReadme(appState.token, owner, name);
    if (isStale(gen)) return;
    appState.detailsPane = 'readme';
    appState.detailsScroll = 0;
    appState._readmeText = md || '(empty README)';
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'README unavailable', 'warning');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

function renderSearchInput(screen, y, h) {
  const W = screen.width;
  const inputY = y + 3;
  const inputW = Math.min(50, W - 12);

  // Bordered input box.
  screen.writeStr(4, inputY - 1, 'Search', color('header'));
  screen.box(4, inputY, inputW + 2, 3, '');

  if (appState.inputMode) {
    const shown = appState.inputMask
      ? '*'.repeat(appState.inputBuffer.length) : appState.inputBuffer;
    screen.writeStr(6, inputY + 1,
      (appState.inputPrompt + shown + '_').substring(0, inputW - 2), color('inputBox'));
  } else {
    screen.writeStr(6, inputY + 1, 'Type a repo name or keywords...', color('dim'));
  }

  screen.writeStr(4, y + 6, 'Search for any public GitHub repository to analyze.', color('dim'));
  screen.writeStr(4, y + 7, 'Examples: facebook/react, rust-lang, machine learning', color('dim'));
}

function renderResultsList(screen, y, h) {
  const W = screen.width;
  screen.writeStr(4, y + 2, 'Search:', color('title'));
  screen.writeStr(12, y + 2, appState.searchQuery || '');

  const listY = y + 4;
  const maxVisible = Math.max(1, Math.min(8, h - 10));
  if (appState.searchResults.length === 0) {
    emptyState(screen, listY, h - 4, {
      icon: '---',
      title: 'No results found',
      message: 'Try different keywords or check the spelling',
      hint: '[Esc] Back to search',
    });
    return;
  }

  screen.writeStr(4, listY, 'Results', color('header'));
  screen.hline(listY + 1, '─', color('dim'));
  const start = appState.searchScroll;
  for (let i = 0; i < maxVisible && start + i < appState.searchResults.length; i++) {
    const repo = appState.searchResults[start + i];
    const row = listY + 2 + i;
    const sel = start + i === appState.selectedRepo;

    // Full-row selection highlight.
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }

    screen.writeStr(4, row, sel ? '>' : ' ', sel ? color('selection') : null);
    screen.writeStr(6, row, truncate(repo.full_name, 30), sel ? color('selection') : null);
    screen.writeStr(38, row,
      '★' + shortNum(repo.stargazers_count) +
      ' ⑂' + shortNum(repo.forks_count) +
      ' ⚡' + shortNum(repo.open_issues_count), sel ? color('selection') : color('dim'));
  }
  const countY = listY + 2 + maxVisible;
  if (countY < y + h) {
    const total = appState.searchResults.length;
    const more = appState.searchHasMore ? '  [Space] More' : '';
    screen.writeStr(4, countY, total + ' results' + more, color('dim'));
  }
}

function renderIssuesPane(screen, y, maxH) {
  renderIssuePRList(screen, y, maxH, {
    title: 'Open Issues',
    items: appState.repoIssues,
    emptyMsg: '(no open issues)',
    numColor: color('issue'),
    getCols: (W) => ({
      numW: 7, titleCol: 12,
      authorCol: Math.max(32, W - 24),
      extraCol: Math.max(46, W - 10),
    }),
    renderExtra: (screen, item, col, W, row) => {
      const labels = (item.labels || []).map(l => l.name).slice(0, 2).join(', ');
      if (col + 8 < W && labels) {
        screen.writeStr(col, row, truncate(labels, 8), color('trending'));
      }
    },
  });
}

function renderPRsPane(screen, y, maxH) {
  renderIssuePRList(screen, y, maxH, {
    title: 'Open Pull Requests',
    items: appState.repoPullRequests,
    emptyMsg: '(no open PRs)',
    numColor: color('pr'),
    getCols: (W) => ({
      numW: 7, titleCol: 12,
      authorCol: Math.max(32, W - 24),
      extraCol: Math.max(46, W - 10),
    }),
    renderExtra: (screen, item, col, W, row) => {
      if (col + 8 < W) {
        const branch = ((item.head && item.head.ref) || '').substring(0, 8);
        screen.writeStr(col, row, branch, color('trending'));
      }
    },
  });
}

function renderIssuePRList(screen, y, maxH, opts) {
  const W = screen.width;
  const items = opts.items;
  screen.writeStr(4, y, opts.title + ' (' + items.length + ')', color('header'));
  if (items.length === 0) { screen.writeStr(4, y + 2, opts.emptyMsg, color('dim')); return; }
  const start = appState.detailsScroll;
  const rows = Math.max(1, maxH - 3);
  const cols = opts.getCols(W);

  for (let i = 0; i < rows && start + i < items.length; i++) {
    const item = items[start + i];
    const row = y + 2 + i;
    const num = '#' + item.number;
    screen.writeStr(4, row, num.padEnd(cols.numW), opts.numColor);
    const draft = item.draft ? '[draft] ' : '';
    screen.writeStr(cols.titleCol, row,
      truncate(draft + (item.title || '?'), cols.authorCol - cols.titleCol - 2),
      item.draft ? color('dim') : null);
    if (cols.authorCol + 12 < W) {
      screen.writeStr(cols.authorCol, row,
        truncate((item.user && item.user.login) || '', 12), color('dim'));
    }
    opts.renderExtra(screen, item, cols.extraCol, W, row);
  }
  if (items.length > rows) {
    screen.writeStr(4, y + 2 + rows,
      (start + 1) + '-' + Math.min(start + rows, items.length) + ' of ' + items.length +
      '  [↑↓] scroll', color('dim'));
  }
}

// Naive Markdown rendering with improved styling.
function renderReadmePane(screen, y, maxH) {
  const W = screen.width;
  screen.writeStr(4, y, 'README', color('header'));
  screen.hline(y + 1, '─', color('dim'));
  const text = appState._readmeText || '(no README loaded)';
  const lines = text.split(/\r?\n/);
  const start = appState.detailsScroll;
  const rows = Math.max(1, maxH - 4);
  for (let i = 0; i < rows && start + i < lines.length; i++) {
    const ln = lines[start + i];
    const row = y + 2 + i;
    if (/^#{1,6}\s/.test(ln)) {
      // Headings: bold.
      screen.writeStr(4, row, ln.replace(/^#+\s*/, ''), { bold: true });
    } else if (/^\s*[-*+]\s/.test(ln)) {
      // List items: accent color with bullet preserved.
      screen.writeStr(4, row, truncate(ln, W - 6), color('accent'));
    } else if (/^\s*```/.test(ln)) {
      // Code fences: dim.
      screen.writeStr(4, row, truncate(ln, W - 6), color('dim'));
    } else if (/^\s*>/.test(ln)) {
      // Blockquotes: italic (if available) or dim.
      screen.writeStr(4, row, truncate(ln, W - 6), color('dim'));
    } else if (/^#{1,6}\s*[-=]+$/.test(ln)) {
      // Underline-style headings: skip (redundant).
      continue;
    } else {
      screen.writeStr(4, row, truncate(ln, W - 6));
    }
  }
  if (lines.length > rows) {
    screen.writeStr(4, y + 2 + rows,
      'Lines ' + (start + 1) + '-' + Math.min(start + rows, lines.length) +
      ' of ' + lines.length + '  [↑↓] scroll  [O] back', color('dim'));
  }
}

function renderRepoDetails(screen, y, maxH) {
  const W = screen.width;
  const repo = appState.repoDetails;
  if (!repo) return;

  // Repo name.
  screen.writeStr(4, y, repo.full_name, color('title'));

  // Pane tabs as chips.
  const panes = [
    ['overview', 'Overview',                                  'O'],
    ['issues',   'Issues (' + appState.repoIssues.length + ')',         'i'],
    ['prs',      'PRs (' + appState.repoPullRequests.length + ')',      'P'],
    ['readme',   'README',                                    'R'],
    ['files',    'Files',                                     'F'],
  ];
  let px = 4;
  for (const [id, label, k] of panes) {
    const sel = appState.detailsPane === id;
    const text = '[' + k + '] ' + label;
    const style = sel ? color('chipActive') : color('chipInactive');
    screen.writeStr(px, y + 1, text, style);
    px += text.length + 2;
  }
  screen.hline(y + 2, '─', color('dim'));

  if (appState.detailsPane === 'issues') { renderIssuesPane(screen, y + 3, maxH - 3); return; }
  if (appState.detailsPane === 'prs')    { renderPRsPane(screen, y + 3, maxH - 3); return; }
  if (appState.detailsPane === 'readme') { renderReadmePane(screen, y + 3, maxH - 3); return; }
  if (appState.detailsPane === 'files')  { files.renderFilesPane(screen, y + 3, maxH - 3); return; }

  // Overview pane: 2-column layout.
  const leftWidth = Math.min(48, Math.floor(W / 2));
  const details = [
    ['Description:', repo.description || 'N/A'],
    ['Language:',    repo.language || 'N/A'],
    ['Stars:',       shortNum(repo.stargazers_count || 0)],
    ['Forks:',       shortNum(repo.forks_count || 0)],
    ['Open Issues:', String(appState.repoIssues.length || repo.open_issues_count || 0)],
    ['Open PRs:',    String(appState.repoPullRequests.length || 0)],
    ['Watchers:',    shortNum(repo.watchers_count || 0)],
    ['Size:',        Math.round((repo.size || 0) / 1024) + ' MB'],
    ['License:',     (repo.license && repo.license.name) || 'N/A'],
    ['Default:',     repo.default_branch || 'main'],
    ['Created:',     new Date(repo.created_at).toLocaleDateString()],
    ['Updated:',     new Date(repo.updated_at).toLocaleDateString()],
    ['URL:',         repo.html_url],
  ];
  const rows = Math.min(details.length, maxH - 4);
  for (let i = 0; i < rows; i++) {
    const [k, v] = details[i];
    screen.writeStr(4, y + 3 + i, k, color('dim'));
    screen.writeStr(18, y + 3 + i, truncate(String(v), leftWidth - 14));
  }

  // Right column: languages, contributors, releases.
  const rightX = leftWidth + 6;
  if (rightX + 20 < W) {
    let ry = y + 3;
    if (appState.repoLanguages && Object.keys(appState.repoLanguages).length > 0) {
      screen.writeStr(rightX, ry++, 'Languages', color('header'));
      const total = Object.values(appState.repoLanguages).reduce((a, b) => a + b, 0);
      const sorted = Object.entries(appState.repoLanguages).sort((a, b) => b[1] - a[1]);
      const barWidth = Math.min(30, W - rightX - 18);
      for (const [lang, bytes] of sorted.slice(0, 5)) {
        if (ry >= y + maxH - 1) break;
        const pct = total ? bytes / total : 0;
        const filled = Math.max(1, Math.round(pct * barWidth));
        const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, barWidth - filled));
        screen.writeStr(rightX, ry, lang.substring(0, 12).padEnd(13));
        screen.writeStr(rightX + 13, ry, bar, color('languageBar'));
        screen.writeStr(rightX + 14 + barWidth, ry, (pct * 100).toFixed(1) + '%', color('dim'));
        ry++;
      }
      ry++;
    }
    if (appState.repoContributors.length > 0 && ry < y + maxH - 2) {
      screen.writeStr(rightX, ry++, 'Top Contributors', color('header'));
      for (const c of appState.repoContributors.slice(0, 5)) {
        if (ry >= y + maxH - 1) break;
        screen.writeStr(rightX, ry, truncate('  ' + (c.login || '?'), 24));
        screen.writeStr(rightX + 26, ry, (c.contributions || 0) + ' commits', color('dim'));
        ry++;
      }
      ry++;
    }
    if (appState.repoReleases.length > 0 && ry < y + maxH - 2) {
      screen.writeStr(rightX, ry++, 'Latest Releases', color('header'));
      for (const rel of appState.repoReleases.slice(0, 3)) {
        if (ry >= y + maxH - 1) break;
        const tag = truncate(rel.tag_name || rel.name || '?', 18);
        const when = rel.published_at ? new Date(rel.published_at).toLocaleDateString() : '';
        screen.writeStr(rightX, ry, '> ' + tag);
        screen.writeStr(rightX + 22, ry, when, color('dim'));
        ry++;
      }
    }
  }
}

export function renderAnalyze(screen, y, h) {
  screen.writeStr(4, y, 'Analyze Repository', color('title'));
  screen.hline(y + 1, '─');
  const v = appState.analyzeView;
  if (v === 'search')   { renderSearchInput(screen, y, h); return; }
  if (v === 'results')  { renderResultsList(screen, y, h); return; }
  if (v === 'details')  { renderRepoDetails(screen, y + 2, h - 2); return; }
  if (v === 'forks')    { renderForks(screen, y + 2, h - 2); return; }
}

export function handleBack() {
  if (appState.showDetail) {
    import('./detail.mjs').then(m => m.closeDetail());
    return;
  }
  if (isFilesPane()) {
    files.backOrLeave().then((handled) => {
      if (!handled) {
        appState.detailsPane = 'overview';
        appState.detailsScroll = 0;
        render();
      }
    });
    return;
  }
  const v = appState.analyzeView;
  if (v === 'forks') {
    appState.forks = [];
    appState.selectedFork = 0;
    appState.forkScroll = 0;
    appState.analyzeView = 'details';
    render();
  } else if (v === 'details') {
    if (appState.detailsPane !== 'overview') {
      appState.detailsPane = 'overview';
      appState.detailsScroll = 0;
      render();
      return;
    }
    appState.repoDetails = null;
    appState.analyzeView = 'results';
    render();
  } else if (v === 'results') {
    appState.searchResults = [];
    appState.searchQuery = '';
    appState.analyzeView = 'search';
    render();
  }
}

export const keys = {
  'i': () => {
    if (appState.analyzeView === 'details') {
      appState.detailsPane = appState.detailsPane === 'issues' ? 'overview' : 'issues';
      appState.detailsScroll = 0;
      render();
    } else {
      startInput('Search repos: ', 'search');
    }
  },
  'P': () => {
    if (appState.analyzeView === 'details') {
      appState.detailsPane = appState.detailsPane === 'prs' ? 'overview' : 'prs';
      appState.detailsScroll = 0;
      render();
    }
  },
  'O': () => {
    if (appState.analyzeView === 'details') {
      appState.detailsPane = 'overview';
      appState.detailsScroll = 0;
      render();
    }
  },
  'R': () => { if (appState.analyzeView === 'details') viewReadme(); },
  'F': () => { if (appState.analyzeView === 'details') files.openFilesPane(); },
  's': () => {
    if (appState.analyzeView === 'forks') toggleForkSort('stars');
    else if (isFilesPane()) files.keys.s();
  },
  'S': () => { if (isFilesPane()) files.keys.S(); },
  'Z': () => { if (isFilesPane()) files.keys.Z(); },
  'C': () => { if (isFilesPane()) files.keys.C(); },
  'G': () => { if (isFilesPane()) files.keys.G(); },
  'B': () => { if (isFilesPane()) files.keys.B(); },
  'Y': () => { if (isFilesPane()) files.keys.Y(); },
  'g': () => { if (isFilesPane()) files.jumpTop(); },
  'n': () => { if (appState.analyzeView === 'forks') toggleForkSort('name'); },
};

function isFilesPane() {
  return appState.analyzeView === 'details' && appState.detailsPane === 'files';
}

export function up(screen) {
  if (isFilesPane()) { files.up(); return; }
  if (appState.analyzeView === 'details' && appState.detailsPane !== 'overview') {
    appState.detailsScroll = Math.max(0, appState.detailsScroll - 1); render(); return;
  }
  if (appState.analyzeView === 'results' && appState.searchResults.length > 0) {
    if (appState.selectedRepo > appState.searchScroll) appState.selectedRepo--;
    else if (appState.searchScroll > 0) { appState.searchScroll--; appState.selectedRepo--; }
    render(); return;
  }
  if (appState.analyzeView === 'forks' && appState.forks.length > 0) {
    if (appState.selectedFork > appState.forkScroll) appState.selectedFork--;
    else if (appState.forkScroll > 0) { appState.forkScroll--; appState.selectedFork--; }
    render();
  }
}
export function down(screen) {
  if (isFilesPane()) { files.down(screen); return; }
  if (appState.analyzeView === 'details' && appState.detailsPane !== 'overview') {
    let listLen;
    if (appState.detailsPane === 'issues') listLen = appState.repoIssues.length;
    else if (appState.detailsPane === 'prs') listLen = appState.repoPullRequests.length;
    else if (appState.detailsPane === 'readme')
      listLen = (appState._readmeText || '').split(/\r?\n/).length;
    else listLen = 0;
    appState.detailsScroll = Math.min(Math.max(0, listLen - 1), appState.detailsScroll + 1);
    render(); return;
  }
  if (appState.analyzeView === 'results') {
    const maxVisible = Math.max(1, Math.min(8, screen.height - 16));
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
    const maxVisible = Math.max(1, Math.min(6, screen.height - 16));
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
}
export function enter() {
  if (isFilesPane()) { files.enter(); return; }
  const v = appState.analyzeView;
  if (v === 'results' && appState.searchResults.length > 0) {
    const repo = appState.searchResults[appState.selectedRepo];
    if (repo) {
      const [owner, name] = repo.full_name.split('/');
      loadRepoDetails(owner, name);
    }
  } else if (v === 'details' && appState.repoDetails) {
    if (appState.detailsPane === 'issues') {
      const issue = appState.repoIssues[appState.detailsScroll];
      if (issue) {
        const [owner, name] = appState.repoDetails.full_name.split('/');
        openDetail('issue', owner, name, issue.number);
      }
    } else if (appState.detailsPane === 'prs') {
      const pr = appState.repoPullRequests[appState.detailsScroll];
      if (pr) {
        const [owner, name] = appState.repoDetails.full_name.split('/');
        openDetail('pull_request', owner, name, pr.number);
      }
    } else {
      loadForks();
    }
  } else if (v === 'search') {
    startInput('Search repos: ', 'search');
  }
}
export function space() {
  if (appState.analyzeView === 'results') loadMoreSearchResults();
  else if (appState.analyzeView === 'forks') loadMoreForks();
}
