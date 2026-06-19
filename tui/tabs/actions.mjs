// Actions/CI tab — browse workflow runs, view jobs + steps inline.
// v0.7 milestone: runs list, status indicators, re-run, cancel.
// v0.6 enhancement: expandable run detail with jobs and steps.

import { appState, render, startAsync, isStale, showMessage, setTab } from '../state.mjs';
import { getWorkflowRuns, getWorkflowJobs, rerunWorkflow, cancelWorkflowRun } from '../github.mjs';
import { openUrl, relTime, truncate } from '../utils.mjs';
import { color } from '../theme.mjs';
import { emptyState, loadingIndicator, scrollIndicators, collapsibleHeader } from '../render.mjs';
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

function jobStatusIcon(job) {
  if (job.status === 'in_progress') return { ch: '◌', style: { fg: 'yellow' } };
  if (job.status === 'queued') return { ch: '◻', style: { dim: true } };
  return STATUS_ICONS[job.conclusion] || { ch: '?', style: { dim: true } };
}

function stepStatusIcon(step) {
  if (step.status === 'in_progress') return { ch: '◌', style: { fg: 'yellow' } };
  if (step.status === 'queued') return { ch: '◻', style: { dim: true } };
  if (step.status === 'completed') {
    if (step.conclusion === 'success') return { ch: '✓', style: { fg: 'green' } };
    if (step.conclusion === 'failure') return { ch: '✗', style: { fg: 'red' } };
    if (step.conclusion === 'skipped') return { ch: '⊘', style: { dim: true } };
    if (step.conclusion === 'cancelled') return { ch: '⊘', style: { fg: 'yellow' } };
  }
  return { ch: '?', style: { dim: true } };
}

export async function loadActionsRepos() {
  if (!appState.token) return;
  if (appState.repos.length === 0) {
    showMessage('Load repos on Dashboard or Repos tab first', 'warning');
    return;
  }
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
  appState.actionsExpandedRun = null;
  appState.actionsJobs = {};
  appState.actionsJobSteps = {};
  render();
  try {
    const result = await getWorkflowRuns(appState.token, owner, name, RUNS_PER_PAGE);
    if (isStale(gen)) { appState.loading = false; return; }
    const runs = result && result.workflow_runs ? result.workflow_runs : [];
    appState.actionsRuns = runs;
    appState.actionsView = 'runs';
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to load runs: ' + e.message, 'error');
  }
  appState.actionsLoading = false;
  if (!isStale(gen)) render();
}

export async function toggleRunDetail() {
  const run = appState.actionsRuns[appState.actionsSelected];
  if (!run) return;
  const runId = run.id;

  // Toggle collapse
  if (appState.actionsExpandedRun === runId) {
    appState.actionsExpandedRun = null;
    render();
    return;
  }

  // Expand — load jobs if not cached
  appState.actionsExpandedRun = runId;
  if (!appState.actionsJobs[runId]) {
    const repos = getFilteredRepos();
    const repo = repos[appState.actionsRepoSelected];
    if (!repo) return;
    const [owner, name] = repo.full_name.split('/');
    const gen = startAsync();
    appState.actionsLoading = true;
    render();
    try {
      const result = await getWorkflowJobs(appState.token, owner, name, runId);
      if (isStale(gen)) { appState.actionsLoading = false; return; }
      const jobs = result && result.jobs ? result.jobs : [];
      appState.actionsJobs[runId] = jobs;
      // Cache steps for each job
      for (const job of jobs) {
        appState.actionsJobSteps[job.id] = job.steps || [];
      }
    } catch (e) {
      if (!isStale(gen)) showMessage('Failed to load jobs: ' + e.message, 'error');
      appState.actionsJobs[runId] = [];
    }
    appState.actionsLoading = false;
  }
  render();
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
    if (appState.actionsExpandedRun) {
      appState.actionsExpandedRun = null;
      render();
    } else {
      appState.actionsView = 'repos';
      render();
    }
  }
}

export function renderActions(screen, y, h) {
  const W = screen.width;
  if (!appState.token) {
    emptyState(screen, y, h, {
      icon: '🔒  NOT SIGNED IN',
      title: 'CI / Actions',
      message: 'Sign in to view your workflow runs.',
      keyHint: 'Press [6] for Settings  →  [Enter] on Login',
    });
    return;
  }

  screen.writeStr(2, y, 'CI / ACTIONS', color('title') || { fg: 'white', bold: true });
  screen.hline(y + 1, '─', { dim: true });

  const section = appState.actionsView === 'runs' ? 'actions:runs' : 'actions:repos';
  const expanded = collapsibleHeader(screen, 2, y + 2, section,
    appState.actionsView === 'runs' ? 'WORKFLOW RUNS' : 'REPOSITORIES',
    appState.actionsView === 'runs' ? '[t] back to repos' : null);
  if (!expanded) return;

  if (appState.actionsView === 'repos') {
    renderRepoList(screen, y + 4, h - 4, W);
  } else {
    renderRunList(screen, y + 4, h - 4, W);
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
    screen.writeStr(2, row, prefix + name, sel ? color('selection') : (color('repoName') || { fg: 'white' }));
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
  screen.writeStr(2, y, '', { dim: true });
  screen.writeStr(5, y, 'WORKFLOW', { fg: 'cyan', bold: true });
  screen.writeStr(38, y, 'BRANCH', { fg: 'cyan', bold: true });
  screen.writeStr(54, y, 'EVENT', { fg: 'cyan', bold: true });
  screen.writeStr(66, y, 'AGE', { fg: 'cyan', bold: true });
  y++;

  const maxVisible = Math.max(1, h - 3);
  let curY = y;
  let drawn = 0;

  for (let i = 0; i < runs.length && drawn < maxVisible; i++) {
    const idx = appState.actionsScroll + i;
    if (idx >= runs.length) break;
    const run = runs[idx];
    const sel = idx === appState.actionsSelected;
    const isExpanded = appState.actionsExpandedRun === run.id;

    // Run row
    if (curY >= y + maxVisible) break;
    const row = curY;
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    const icon = getStatusIcon(run);
    const arrow = isExpanded ? '▾' : '▸';
    const wfName = truncate(run.name || run.display_title || '(unnamed)', 26);
    const branch = truncate(run.head_branch || '?', 14);
    const event = truncate(run.event || '?', 10);
    const when = relTime(run.created_at);
    const runNumber = '#' + run.run_number;

    screen.writeStr(2, row, sel ? '▶' : ' ', sel ? color('selection') : null);
    screen.writeStr(4, row, arrow, sel ? color('selection') : color('dim'));
    screen.writeStr(6, row, icon.ch, sel ? color('selection') : icon.style);
    screen.writeStr(8, row, truncate(runNumber, 6), sel ? color('selection') : color('dim'));
    screen.writeStr(15, row, wfName, sel ? color('selection') : (color('repoName') || { fg: 'white' }));
    screen.writeStr(40, row, branch, sel ? color('selection') : { fg: 'cyan' });
    screen.writeStr(56, row, event, sel ? color('selection') : color('dim'));
    screen.writeStr(68, row, when, sel ? color('selection') : { dim: true });
    curY++;
    drawn++;

    // Expanded: show jobs
    if (isExpanded) {
      const jobs = appState.actionsJobs[run.id] || [];
      if (jobs.length === 0 && appState.actionsLoading) {
        if (curY < y + maxVisible) {
          screen.writeStr(6, curY, 'Loading jobs...', { dim: true });
          curY++;
          drawn++;
        }
      } else {
        for (const job of jobs) {
          if (curY >= y + maxVisible) break;
          const ji = jobStatusIcon(job);
          const jobName = truncate(job.name || '?', W - 16);
          const jobWhen = job.started_at ? relTime(job.started_at) : '';
          const jobDur = job.completed_at && job.started_at
            ? Math.round((new Date(job.completed_at) - new Date(job.started_at)) / 1000) + 's'
            : '';

          screen.writeStr(6, curY, '  ');
          screen.writeStr(8, curY, ji.ch, ji.style);
          screen.writeStr(10, curY, jobName, color('repoName') || { fg: 'white' });
          if (jobDur && 10 + jobName.length + 2 < W) {
            screen.writeStr(10 + jobName.length + 2, curY, jobDur, { dim: true });
          }
          curY++;
          drawn++;

          // Show steps
          const steps = appState.actionsJobSteps[job.id] || [];
          for (const step of steps) {
            if (curY >= y + maxVisible) break;
            const si = stepStatusIcon(step);
            const stepName = truncate(step.name || '?', W - 14);
            screen.writeStr(10, curY, '  ');
            screen.writeStr(12, curY, si.ch, si.style);
            screen.writeStr(14, curY, stepName, color('dim'));
            curY++;
            drawn++;
          }
        }
      }
    }
  }

  scrollIndicators(screen, y, y + maxVisible - 1, appState.actionsScroll, runs.length);

  // Status bar hint
  const hintY = y + Math.min(maxVisible, drawn);
  if (hintY < y + h - 1) {
    screen.hline(hintY, '─', { dim: true });
    const hint = appState.actionsExpandedRun
      ? '[Enter] Close detail   [o] Open in browser   [r] Re-run   [x] Cancel   [Esc] Back'
      : '[Enter] Expand jobs   [o] Open in browser   [r] Re-run   [x] Cancel   [Esc] Back';
    screen.writeStr(2, hintY + 1, hint, { dim: true });
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
  't': () => {
    if (appState.actionsView === 'runs') {
      appState.actionsView = 'repos';
      appState.actionsExpandedRun = null;
      render();
    }
  },
  'o': () => {
    if (appState.actionsView === 'runs') openSelectedRun();
  },
};

export function up() {
  if (appState.actionsView === 'repos') {
    const repos = getFilteredRepos();
    if (repos.length === 0) return;
    appState.actionsRepoSelected = Math.max(0, appState.actionsRepoSelected - 1);
    if (appState.actionsRepoSelected < appState.actionsRepoScroll) {
      appState.actionsRepoScroll = appState.actionsRepoSelected;
    }
    render();
  } else {
    if (appState.actionsExpandedRun) return; // don't move selection when viewing jobs
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
    if (appState.actionsExpandedRun) return; // don't move selection when viewing jobs
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
    toggleRunDetail();
  }
}

export function space() {
  if (appState.actionsView === 'repos') {
    // No pagination for repos list currently.
  } else {
    toggleRunDetail();
  }
}

const ACTIONS_SECTIONS = ['repos', 'runs'];

export function getSections() {
  return ACTIONS_SECTIONS.map(s => 'actions:' + s);
}

export function getCurrentSection() {
  return appState.actionsView === 'runs' ? 'actions:runs' : 'actions:repos';
}
