// Actions/CI tab — browse workflow runs for your repos.
// v0.7 milestone: runs list, status indicators, re-run, cancel.

import { appState, render, startAsync, isStale, showMessage, setTab } from '../state.mjs';
import { getWorkflowRuns, rerunWorkflow, cancelWorkflowRun } from '../github.mjs';
import { openUrl, relTime, truncate } from '../utils.mjs';
import { color } from '../theme.mjs';
import { emptyState, loadingIndicator, scrollIndicators } from '../render.mjs';
import { startInput, registerInputHandler } from '../input.mjs';

const RUNS_PER_PAGE = 30;

const STATUS_ICONS = {
  success:       { ch: '✓', style: { fg: 'green', bold: true } },
  failure:       { ch: '✗', style: { fg: 'red', bold: true } },
  cancelled:     { ch: '⊘', style: { fg: 'yellow', bold: true } },
  skipped:       { ch: '⊘', style: { dim: true } },
  startup_failure: { ch: '✗', style: { fg: 'red', bold: true } },
  stale:         { ch: '⊘', style: { dim: true } },
  timed_out:     { ch: '✗', style: { fg: 'red', bold: true } },
  action_required: { ch: '!', style: { fg: 'yellow', bold: true } },
  neutral:       { ch: '–', style: { dim: true } },
};

function getStatusIcon(run) {
  if (run.status === 'in_progress' || run.status === 'queued' || run.status === 'waiting') {
    return { ch: '◌', style: { fg: 'yellow' } };
  }
  return STATUS_ICONS[run.conclusion] || { ch: '?', style: { dim: true } };
}

export async function loadActionsRepos() {
  if (!appState.token) return;
  appState.actionsRepos = appState.repos || [];
  appState.actionsRepoSelected = 0;
  appState.actionsRepoScroll = 0;
  render();
}

export async function loadWorkflowRuns() {
  const repos = getFilteredRepos();
  const idx = appState.actionsRepoSelected;
  const repo = repos[idx];
  if (!repo) return;
  const [owner, name] = repo.full_name.split('/');
  const gen = startAsync();
  appState.actionsLoading = true;
  appState.actionsRuns = [];
  appState.actionsSelected = 0;
  appState.actionsScroll = 0;
  render();
  try {
    const result = await getWorkflowRuns(appState.token, owner, name, RUNS_PER_PAGE);
    if (isStale(gen)) return;
    const runs = result && result.workflow_runs ? result.workflow_runs : [];
    appState.actionsRuns = runs;
    appState.actionsView = 'runs';
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to load runs: ' + e.message, 'error');
  }
  appState.actionsLoading = false;
  if (!isStale(gen)) render();
}

export async function rerunSelected() {
  const run = appState.actionsRuns[appState.actionsSelected];
  if (!run) return;
  const repos = getFilteredRepos();
  const repo = repos[appState.actionsRepoSelected];
  if (!repo) return;
  const [owner, name] = repo.full_name.split('/');
  try {
    await rerunWorkflow(appState.token, owner, name, run.id);
    showMessage('Re-queued run #' + run.id, 'success');
    loadWorkflowRuns();
  } catch (e) {
    showMessage(e.message || 'Re-run failed', 'error');
  }
}

export async function cancelSelected() {
  const run = appState.actionsRuns[appState.actionsSelected];
  if (!run) return;
  if (run.status !== 'in_progress' && run.status !== 'queued' && run.status !== 'waiting') {
    showMessage('Run is not running', 'warning');
    return;
  }
  const repos = getFilteredRepos();
  const repo = repos[appState.actionsRepoSelected];
  if (!repo) return;
  const [owner, name] = repo.full_name.split('/');
  try {
    await cancelWorkflowRun(appState.token, owner, name, run.id);
    showMessage('Cancelled run #' + run.id, 'success');
    loadWorkflowRuns();
  } catch (e) {
    showMessage(e.message || 'Cancel failed', 'error');
  }
}

function openSelectedRun() {
  const run = appState.actionsRuns[appState.actionsSelected];
  if (!run || !run.html_url) return;
  openUrl(run.html_url).then(res => {
    if (res.ok) showMessage('Opened in browser', 'success');
    else showMessage(res.error || 'Open failed', 'error');
  });
}

export function goBack() {
  if (appState.actionsView === 'runs') {
    appState.actionsView = 'repos';
    render();
  }
}

export function renderActions(screen, y, h) {
  const W = screen.width;
  if (!appState.token) {
    emptyState(screen, y, h, {
      icon: '🔒  NOT SIGNED IN',
      title: 'CI / Actions',
      message: 'Sign in to view your workflow runs.',
      keyHint: 'Press [4] for Settings  →  [Enter] on Login',
    });
    return;
  }

  screen.writeStr(2, y, 'CI / ACTIONS', { fg: 'white', bold: true });
  screen.hline(y + 1, '─', { dim: true });

  if (appState.actionsView === 'repos') {
    renderRepoList(screen, y + 3, h - 3, W);
  } else {
    renderRunList(screen, y + 3, h - 3, W);
  }
}

function getFilteredRepos() {
  const q = (appState.actionsFilter || '').trim().toLowerCase();
  if (!q) return appState.actionsRepos;
  return appState.actionsRepos.filter(r => (r.full_name || '').toLowerCase().includes(q));
}

function renderRepoList(screen, y, h, W) {
  const filterHint = appState.actionsFilter ? ' | filter: "' + appState.actionsFilter + '"' : '';
  screen.writeStr(2, y, 'Select a repo to view workflow runs:' + filterHint, { dim: true });
  y += 2;
  const repos = getFilteredRepos();
  if (repos.length === 0) {
    emptyState(screen, y - 2, Math.max(8, h), {
      icon: '○',
      title: 'No repos loaded',
      message: 'First visit the Dashboard or Repos tab to load your repos',
    });
    return;
  }
  const maxVisible = Math.max(1, h - 2);
  for (let i = 0; i < maxVisible && i < repos.length; i++) {
    const idx = appState.actionsRepoScroll + i;
    if (idx >= repos.length) break;
    const r = repos[idx];
    const sel = idx === appState.actionsRepoSelected;
    const row = y + i;
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    const prefix = sel ? '▶ ' : '  ';
    const name = truncate(r.full_name || '?', W - 20);
    const stars = '★' + (r.stargazers_count || 0);
    screen.writeStr(2, row, prefix + name, sel ? color('selection') : { fg: 'white' });
    screen.writeStr(W - stars.length - 2, row, stars, sel ? color('selection') : { fg: 'yellow' });
  }
  scrollIndicators(screen, y, y + maxVisible - 1, appState.actionsRepoScroll, repos.length);
}

function renderRunList(screen, y, h, W) {
  const repos = appState.actionsRepos;
  const repo = repos[appState.actionsRepoSelected];
  if (repo) {
    screen.writeStr(2, y, 'Repo: ' + (repo.full_name || '?'), { fg: 'cyan' });
    screen.keyHint(2 + (repo.full_name || '?').length + 2, y, 'Esc', 'back');
    y += 2;
  } else {
    y += 1;
  }

  if (appState.actionsLoading) {
    loadingIndicator(screen, 2, y, 'loading workflow runs');
    return;
  }

  const runs = appState.actionsRuns;
  if (runs.length === 0) {
    emptyState(screen, y - 2, Math.max(8, h), {
      icon: '○',
      title: 'No workflow runs',
      message: 'Configure GitHub Actions in this repo to see runs here',
    });
    return;
  }

  // Header
  screen.writeStr(2, y, 'STATUS', { fg: 'cyan', bold: true });
  screen.writeStr(10, y, 'WORKFLOW', { fg: 'cyan', bold: true });
  screen.writeStr(40, y, 'BRANCH', { fg: 'cyan', bold: true });
  screen.writeStr(56, y, 'AGE', { fg: 'cyan', bold: true });
  y++;

  const maxVisible = Math.max(1, h - 3);
  for (let i = 0; i < maxVisible && i < runs.length; i++) {
    const idx = appState.actionsScroll + i;
    if (idx >= runs.length) break;
    const run = runs[idx];
    const sel = idx === appState.actionsSelected;
    const row = y + i;
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    const icon = getStatusIcon(run);
    const prefix = sel ? '▶ ' : '  ';
    const status = icon.ch;
    const wfName = truncate(run.name || run.display_title || '(unnamed)', 26);
    const branch = truncate(run.head_branch || '?', 14);
    const when = relTime(run.created_at);
    screen.writeStr(2, row, prefix, sel ? color('selection') : null);
    screen.writeStr(4, row, status, sel ? color('selection') : icon.style);
    screen.writeStr(10, row, wfName, sel ? color('selection') : { fg: 'white' });
    screen.writeStr(40, row, branch, sel ? color('selection') : { fg: 'cyan' });
    screen.writeStr(56, row, when, sel ? color('selection') : { dim: true });
  }

  scrollIndicators(screen, y, y + maxVisible - 1, appState.actionsScroll, runs.length);

  // Status bar hint
  const hintY = y + Math.min(maxVisible, runs.length);
  if (hintY < y + h - 1) {
    screen.hline(hintY + 1, '─', { dim: true });
    screen.writeStr(2, hintY + 2, '[Enter] Open  [r] Re-run  [x] Cancel  [Esc] Back', { dim: true });
  }
}

registerInputHandler('actions-filter', (value) => {
  appState.actionsFilter = (value || '').trim();
  appState.actionsRepoScroll = 0;
  appState.actionsRepoSelected = 0;
  showMessage(appState.actionsFilter
    ? 'Filtering repos: "' + appState.actionsFilter + '"'
    : 'Repo filter cleared', 'info');
  render();
});

export const keys = {
  '/': () => startInput('Filter repos: ', 'actions-filter'),
};

export function up() {
  const screen = { height: process.stdout.rows || 24 };
  if (appState.actionsView === 'repos') {
    const repos = getFilteredRepos();
    if (repos.length === 0) return;
    appState.actionsRepoSelected = Math.max(0, appState.actionsRepoSelected - 1);
    if (appState.actionsRepoSelected < appState.actionsRepoScroll) {
      appState.actionsRepoScroll = appState.actionsRepoSelected;
    }
    render();
  } else {
    appState.actionsSelected = Math.max(0, appState.actionsSelected - 1);
    if (appState.actionsSelected < appState.actionsScroll) {
      appState.actionsScroll = Math.max(0, appState.actionsScroll - 1);
    }
    render();
  }
}

export function down() {
  if (appState.actionsView === 'repos') {
    const repos = getFilteredRepos();
    const maxVisible = Math.max(1, Math.min(10, (process.stdout.rows || 24) - 12));
    if (repos.length === 0) return;
    appState.actionsRepoSelected = Math.min(repos.length - 1, appState.actionsRepoSelected + 1);
    if (appState.actionsRepoSelected >= appState.actionsRepoScroll + maxVisible) {
      appState.actionsRepoScroll++;
    }
    render();
  } else {
    const runs = appState.actionsRuns;
    const maxVisible = Math.max(1, Math.min(10, (process.stdout.rows || 24) - 16));
    if (runs.length === 0) return;
    appState.actionsSelected = Math.min(runs.length - 1, appState.actionsSelected + 1);
    if (appState.actionsSelected >= appState.actionsScroll + maxVisible) {
      appState.actionsScroll++;
    }
    render();
  }
}

export function bottom(screen) {
  if (appState.actionsView === 'repos') {
    const repos = getFilteredRepos();
    appState.actionsRepoSelected = Math.max(0, repos.length - 1);
    const maxVisible = Math.max(1, Math.min(10, (screen ? screen.height : process.stdout.rows || 24) - 12));
    appState.actionsRepoScroll = Math.max(0, repos.length - maxVisible);
  } else {
    const runs = appState.actionsRuns;
    appState.actionsSelected = Math.max(0, runs.length - 1);
    const maxVisible = Math.max(1, Math.min(10, (screen ? screen.height : process.stdout.rows || 24) - 16));
    appState.actionsScroll = Math.max(0, runs.length - maxVisible);
  }
  render();
}

export function enter() {
  if (appState.actionsView === 'repos') {
    loadWorkflowRuns();
  } else {
    openSelectedRun();
  }
}

export function space() {}

export function getSections() { return []; }
export function getCurrentSection() { return null; }
