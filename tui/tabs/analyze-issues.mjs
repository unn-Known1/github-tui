// Issues/PRs sub-pane — render issue and PR lists with state filtering.

import { appState, render, startAsync, isStale, showMessage, beginLoading, finishLoading } from '../state.mjs';
import { getRepositoryIssues, getRepositoryPullRequests } from '../github.mjs';
import { truncate, sectionHeader } from '../utils.mjs';
import { scrollIndicators, loadingIndicator } from '../render.mjs';

export function filterLabel(state) {
  return state === 'all' ? 'ALL' : state === 'closed' ? 'CLOSED' : 'OPEN';
}

export function cycleIssueStateFilter() {
  if (appState.analyzeView !== 'details') return;
  if (appState.detailsPane !== 'issues' && appState.detailsPane !== 'prs') return;
  const cycle = { 'open': 'closed', 'closed': 'all', 'all': 'open' };
  appState.issueStateFilter = cycle[appState.issueStateFilter] || 'open';
  showMessage('Issues/PRs state filter: ' + appState.issueStateFilter, 'info', 1500);
  const repo = appState.repoDetails;
  if (!repo) return;
  const [owner, name] = repo.full_name.split('/');
  const gen = startAsync('analyze-issues');
  beginLoading(gen);
  render();
  if (appState.detailsPane === 'issues') {
    getRepositoryIssues(appState.token, owner, name, 1, 100, appState.issueStateFilter, gen.signal).then(issues => {
      if (isStale(gen, 'analyze-issues')) { finishLoading(gen); return; }
      appState.repoIssues = Array.isArray(issues) ? issues.filter(i => !i.pull_request) : [];
      appState.repoIssuesPage = 1;
      appState.repoIssuesHasMore = Array.isArray(issues) && issues.length >= 100;
      appState.detailsScroll = 0;
      finishLoading(gen);
      render();
    }).catch(e => {
      finishLoading(gen);
      if (!isStale(gen, 'analyze-issues')) { showMessage(e.message || 'Failed to reload issues', 'error'); render(); }
    });
  } else {
    getRepositoryPullRequests(appState.token, owner, name, 1, 100, appState.issueStateFilter, gen.signal).then(prs => {
      if (isStale(gen, 'analyze-issues')) { finishLoading(gen); return; }
      appState.repoPullRequests = Array.isArray(prs) ? prs : [];
      appState.repoPullRequestsPage = 1;
      appState.repoPullRequestsHasMore = Array.isArray(prs) && prs.length >= 100;
      appState.detailsScroll = 0;
      finishLoading(gen);
      render();
    }).catch(e => {
      finishLoading(gen);
      if (!isStale(gen, 'analyze-issues')) { showMessage(e.message || 'Failed to reload PRs', 'error'); render(); }
    });
  }
}

export async function loadMoreIssues() {
  const repo = appState.repoDetails;
  const isIssues = appState.detailsPane === 'issues';
  const hasMore = isIssues ? appState.repoIssuesHasMore : appState.repoPullRequestsHasMore;
  if (!repo || !hasMore || appState.loading) return;
  const [owner, name] = repo.full_name.split('/');
  const page = (isIssues ? appState.repoIssuesPage : appState.repoPullRequestsPage) + 1;
  const gen = startAsync('analyze-issues-more');
  beginLoading(gen);
  render();
  try {
    const more = isIssues
      ? await getRepositoryIssues(appState.token, owner, name, page, 100, appState.issueStateFilter, gen.signal)
      : await getRepositoryPullRequests(appState.token, owner, name, page, 100, appState.issueStateFilter, gen.signal);
    if (isStale(gen)) return;
    const items = Array.isArray(more) ? more : [];
    if (isIssues) {
      appState.repoIssues = [...appState.repoIssues, ...items.filter(i => !i.pull_request)];
      appState.repoIssuesPage = page;
      appState.repoIssuesHasMore = items.length >= 100;
    } else {
      appState.repoPullRequests = [...appState.repoPullRequests, ...items];
      appState.repoPullRequestsPage = page;
      appState.repoPullRequestsHasMore = items.length >= 100;
    }
    showMessage(items.length ? 'Loaded more ' + (isIssues ? 'issues' : 'pull requests') : 'All items loaded', 'info');
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Failed to load more items', 'error');
  } finally {
    finishLoading(gen);
    if (!isStale(gen)) render();
  }
}

export function renderIssuesPane(screen, y, maxH) {
  const state = appState.issueStateFilter;
  renderIssuePRList(screen, y, maxH, {
    title: filterLabel(state) + ' ISSUES' + (appState.repoIssuesHasMore ? ' (loaded)' : ''),
    items: appState.repoIssues,
    hint: '[s] ' + filterLabel(state),
    emptyMsg: state === 'all' ? '(no issues)' : '(no ' + filterLabel(state).toLowerCase() + ' issues)',
    numColor: { fg: 'yellow' },
    getCols: (W) => ({
      numW: 7, titleCol: 12,
      authorCol: Math.max(32, W - 24),
      extraCol: Math.max(46, W - 10),
    }),
    renderExtra: (screen, item, col, W, row) => {
      const labels = (item.labels || []).map(l => l.name).slice(0, 2).join(', ');
      if (col + 8 < W && labels) {
        screen.writeStr(col, row, truncate(labels, 8), { fg: 'magenta' });
      }
    },
  });
}

export function renderPRsPane(screen, y, maxH) {
  const state = appState.issueStateFilter;
  renderIssuePRList(screen, y, maxH, {
    title: filterLabel(state) + ' PULL REQUESTS' + (appState.repoPullRequestsHasMore ? ' (loaded)' : ''),
    items: appState.repoPullRequests,
    hint: '[s] ' + filterLabel(state),
    emptyMsg: state === 'all' ? '(no PRs)' : '(no ' + filterLabel(state).toLowerCase() + ' PRs)',
    numColor: { fg: 'cyan' },
    getCols: (W) => ({
      numW: 7, titleCol: 12,
      authorCol: Math.max(32, W - 24),
      extraCol: Math.max(46, W - 10),
    }),
    renderExtra: (screen, item, col, W, row) => {
      if (col + 8 < W) {
        const branch = truncate((item.head && item.head.ref) || '', 8);
        screen.writeStr(col, row, branch, { fg: 'magenta' });
      }
    },
  });
}

function renderIssuePRList(screen, y, maxH, opts) {
  const W = screen.width;
  const items = opts.items;
  sectionHeader(screen, 2, y, opts.title + ' (' + items.length + ')', opts.hint);
  if (appState.loading) { loadingIndicator(screen, 2, y + 2, 'loading ' + (opts.title.includes('PULL') ? 'pull requests' : 'issues')); return; }
  if (items.length === 0) { screen.writeStr(2, y + 2, opts.emptyMsg, { dim: true }); return; }
  const start = appState.detailsScroll;
  const rows = Math.max(1, maxH - 3);
  const cols = opts.getCols(W);

  for (let i = 0; i < rows && start + i < items.length; i++) {
    const item = items[start + i];
    const row = y + 2 + i;
    const num = '#' + item.number;
    screen.writeStr(2, row, num.padEnd(cols.numW), opts.numColor);
    const draft = item.draft ? '[draft] ' : '';
    screen.writeStr(cols.titleCol, row,
      truncate(draft + (item.title || '?'), cols.authorCol - cols.titleCol - 2),
      item.draft ? { dim: true } : null);
    if (cols.authorCol + 12 < W) {
      screen.writeStr(cols.authorCol, row,
        truncate((item.user && item.user.login) || '', 12), { dim: true });
    }
    opts.renderExtra(screen, item, cols.extraCol, W, row);
  }
  scrollIndicators(screen, y + 2, y + 1 + rows, start, items.length);
  if (items.length > rows) {
    screen.writeStr(2, y + 2 + rows,
      (start + 1) + '-' + Math.min(start + rows, items.length) + ' of ' + items.length +
      '   [↑↓] scroll' + ((opts.items === appState.repoIssues && appState.repoIssuesHasMore) || (opts.items === appState.repoPullRequests && appState.repoPullRequestsHasMore) ? '   [Space] load more' : ''), { dim: true });
  }
}
