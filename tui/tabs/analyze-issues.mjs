// Issues/PRs sub-pane — render issue and PR lists with state filtering.

import { appState, render, startAsync, isStale, showMessage } from '../state.mjs';
import { getRepositoryIssues, getRepositoryPullRequests } from '../github.mjs';
import { truncate, sectionHeader } from '../utils.mjs';
import { scrollIndicators } from '../render.mjs';

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
  if (appState.detailsPane === 'issues') {
    getRepositoryIssues(appState.token, owner, name, 1, 100, appState.issueStateFilter, gen.signal).then(issues => {
      if (isStale(gen, 'analyze-issues')) { appState.loading = false; return; }
      appState.repoIssues = Array.isArray(issues) ? issues.filter(i => !i.pull_request) : [];
      appState.detailsScroll = 0;
      render();
    }).catch(e => { if (!isStale(gen, 'analyze-issues')) showMessage(e.message || 'Failed to reload issues', 'error'); });
  } else {
    getRepositoryPullRequests(appState.token, owner, name, 1, 100, appState.issueStateFilter, gen.signal).then(prs => {
      if (isStale(gen, 'analyze-issues')) { appState.loading = false; return; }
      appState.repoPullRequests = Array.isArray(prs) ? prs : [];
      appState.detailsScroll = 0;
      render();
    }).catch(e => { if (!isStale(gen, 'analyze-issues')) showMessage(e.message || 'Failed to reload PRs', 'error'); });
  }
}

export function renderIssuesPane(screen, y, maxH) {
  const state = appState.issueStateFilter;
  renderIssuePRList(screen, y, maxH, {
    title: filterLabel(state) + ' ISSUES',
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
    title: filterLabel(state) + ' PULL REQUESTS',
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
        const branch = ((item.head && item.head.ref) || '').substring(0, 8);
        screen.writeStr(col, row, branch, { fg: 'magenta' });
      }
    },
  });
}

function renderIssuePRList(screen, y, maxH, opts) {
  const W = screen.width;
  const items = opts.items;
  sectionHeader(screen, 2, y, opts.title + ' (' + items.length + ')', opts.hint);
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
      '   [↑↓] scroll', { dim: true });
  }
}
