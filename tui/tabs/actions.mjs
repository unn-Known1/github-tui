// Actions/CI tab — browse workflow runs, view jobs + steps inline.
// v0.7 milestone: runs list, status indicators, re-run, cancel.
// v0.6 enhancement: expandable run detail with jobs and steps.

import {
  appState, render, startAsync, isStale, showMessage, confirm,
  beginLoading, finishLoading, filterReposByWorkflowState,
} from '../state.mjs';
import {
  getWorkflowRuns, getWorkflowJobs, getWorkflowJobLogs, getWorkflows,
  dispatchWorkflow, rerunWorkflow, cancelWorkflowRun,
} from '../github.mjs';
import { validateWorkflowInputs, buildFailureQueue } from '../recommended-features.mjs';
import { openUrl, relTime, truncate, displayWidth } from '../utils.mjs';
import { color } from '../theme.mjs';
import { emptyState, loadingIndicator, scrollIndicators, collapsibleHeader } from '../render.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import { showError } from '../error-recovery.mjs';

const RUNS_PER_PAGE = 30;

const STATUS_ICONS = {
  success:       { ch: '✓', style: { fg: 'green', bold: true } },
  failure:       { ch: '✗', style: { fg: 'red', bold: true } },
  cancelled:     { ch: 'ø', style: { fg: 'yellow', bold: true } },
  skipped:       { ch: '-', style: { dim: true } },
  startup_failure: { ch: '✗', style: { fg: 'red', bold: true } },
  stale:         { ch: '-', style: { dim: true } },
  timed_out:     { ch: '✗', style: { fg: 'red', bold: true } },
  action_required: { ch: '!', style: { fg: 'yellow', bold: true } },
  neutral:       { ch: '-', style: { dim: true } },
};

function getStatusIcon(run) {
  if (run.status === 'in_progress' || run.status === 'queued' || run.status === 'waiting') {
    return { ch: '~', style: { fg: 'yellow' } };
  }
  return STATUS_ICONS[run.conclusion] || { ch: '?', style: { dim: true } };
}

function jobStatusIcon(job) {
  if (job.status === 'in_progress') return { ch: '~', style: { fg: 'yellow' } };
  if (job.status === 'queued') return { ch: '•', style: { dim: true } };
  return STATUS_ICONS[job.conclusion] || { ch: '?', style: { dim: true } };
}

function stepStatusIcon(step) {
  if (step.status === 'in_progress') return { ch: '~', style: { fg: 'yellow' } };
  if (step.status === 'queued') return { ch: '•', style: { dim: true } };
  if (step.status === 'completed') {
    if (step.conclusion === 'success') return { ch: '✓', style: { fg: 'green' } };
    if (step.conclusion === 'failure') return { ch: '✗', style: { fg: 'red' } };
    if (step.conclusion === 'skipped') return { ch: '-', style: { dim: true } };
    if (step.conclusion === 'cancelled') return { ch: 'ø', style: { fg: 'yellow' } };
  }
  return { ch: '?', style: { dim: true } };
}

const WORKFLOW_SCAN_CONCURRENCY = 5; // bounded probes per repo, like fork compares

export function followScroll(selected, scroll, maxVisible) { if (selected < scroll) return selected; if (selected >= scroll + maxVisible) return selected - maxVisible + 1; return scroll; }

function activeRepo() { const snap = appState.actionsActiveRepo; if (snap) { const hit = (appState.actionsRepos || []).find(r => r.full_name === snap); if (hit) return hit; } const repos = getFilteredRepos(); return repos[appState.actionsRepoSelected] || null; }

let _scanCancelled = false;
export function cancelWorkflowScan() { _scanCancelled = true; }

export async function loadActionsRepos() {
  if (!appState.token) return;
  // Copy whatever's in appState.repos — never early-return on empty, since
  // the renderer (renderRepoList) already owns the "No repos loaded"
  // empty-state copy. Showing a redundant `Load repos on Dashboard…`
  // toast *on top of* the empty-state would stack two messages and tell
  // the user the same thing twice.
  appState.actionsRepos = filterReposByWorkflowState(appState.repos || []);
  appState.actionsRepoSelected = 0;
  appState.actionsRepoScroll = 0;
  render();
  // First visit: probe each repo's /actions/workflows endpoint so the list
  // shows only repos that actually have a GitHub workflow. One-shot per
  // account — rescan with [R] (repos view).
  if (!appState.actionsScanDone && appState.repos.length > 0) {
    const gen = startAsync('actions-scan');
    appState.actionsScanning = true;
    beginLoading(gen);
    render();
    await scanReposForWorkflows(gen);
    appState.actionsScanning = false;
    if (isStale(gen)) { finishLoading(gen); return; }
    finishLoading(gen);
    appState.actionsRepos = filterReposByWorkflowState(appState.repos || []);
    const total = appState.repos.length;
    const shown = appState.actionsRepos.length;
    const unscanned = Math.max(0, total - 200);
    if (_scanCancelled) {
      showMessage('Scan cancelled — partial results', 'warning', 5000);
    } else if (total > 200 && shown > 0) {
      showMessage('Showing ' + shown + ' of ' + total + ' repos with workflows (first 200 scanned)', 'success', 5000);
    } else {
      showMessage(shown > 0
        ? 'Showing ' + shown + ' of ' + total + ' repos with workflows'
        : 'No GitHub workflows found in any of your ' + total + ' repos',
        shown > 0 ? 'success' : 'info', 5000);
    }
    render();
  }
}

// Probe every account repo for workflows with a bounded worker pool.
// Repos whose probe fails (rate limit / network) are left out of
// actionsNoWorkflowRepos so they stay visible — we never hide a repo we
// couldn't inspect.
async function scanReposForWorkflows(gen) {
  const repos = Array.isArray(appState.repos) ? appState.repos : [];
  const CAP = 200;
  const capped = repos.slice(0, CAP);
  const noWorkflow = new Set();
  const queue = capped.slice();
  _scanCancelled = false;
  let done = 0;
  const worker = async () => {
    while (queue.length > 0 && !isStale(gen) && !_scanCancelled) {
      const r = queue.shift();
      if (!r || !r.full_name) { done++; if (done % 5 === 0) { appState.actionsScanProgress = { done, total: queue.length + done }; render(); } continue; }
      const [owner, name] = r.full_name.split('/');
      if (!owner || !name) { done++; if (done % 5 === 0) { appState.actionsScanProgress = { done, total: queue.length + done }; render(); } continue; }
      try {
        const result = await getWorkflows(appState.token, owner, name, gen.signal);
        const workflows = Array.isArray(result) ? result : (result?.workflows || []);
        if (workflows.length === 0) noWorkflow.add(r.full_name);
      } catch { /* keep repo visible — could not determine */ }
      done++;
      if (done % 5 === 0) { appState.actionsScanProgress = { done, total: queue.length + done }; render(); }
    }
  };
  const count = Math.min(WORKFLOW_SCAN_CONCURRENCY, Math.max(1, queue.length));
  await Promise.all(Array.from({ length: count }, worker));
  appState.actionsScanProgress = null;
  if (!isStale(gen) && !_scanCancelled) {
    appState.actionsNoWorkflowRepos = noWorkflow;
    appState.actionsScanDone = true;
  } else if (!isStale(gen) && _scanCancelled) {
    appState.actionsNoWorkflowRepos = noWorkflow;
  }
}

// Force a fresh probe of every repo (e.g. after adding a workflow).
export async function rescanWorkflowRepos() {
  if (!appState.token) { showMessage('Login first (Settings → Login)', 'warning'); return; }
  if ((appState.repos || []).length === 0) { showMessage('No repos to scan — visit the Repos tab first', 'warning'); return; }
  appState.actionsScanDone = false;
  appState.actionsNoWorkflowRepos = null;
  await loadActionsRepos();
}

export async function openWorkflowLog(jobId) {
  const repo = activeRepo();
  if (!repo || !jobId) return;
  const [owner, name] = repo.full_name.split('/');
  const gen = startAsync('actions-log');
  appState.actionsLoading = true;
  appState.actionsLog = { jobId, text: '', truncated: false, bytes: 0 };
  appState.actionsLogScroll = 0;
  render();
  try {
    const result = await getWorkflowJobLogs(appState.token, owner, name, jobId, gen.signal);
    if (isStale(gen)) return;
    appState.actionsLog = { jobId, ...result };
    showMessage(result.truncated ? 'Workflow log truncated at 2 MB' : 'Loaded workflow log', result.truncated ? 'warning' : 'success');
  } catch (e) {
    if (!isStale(gen)) showError(e.message || 'Failed to load workflow log', 'Workflow log', { retry: () => openWorkflowLog(jobId) });
  } finally {
    if (!isStale(gen)) {
      appState.actionsLoading = false;
      render();
    }
  }
}

export async function startWorkflowDispatch() {
  const repo = activeRepo();
  if (!repo || !appState.token) return;
  const [owner, name] = repo.full_name.split('/');
  const gen = startAsync('actions-dispatch-workflows');
  appState.actionsLoading = true;
  render();
  try {
    const result = await getWorkflows(appState.token, owner, name, gen.signal);
    if (isStale(gen)) return;
    const workflows = Array.isArray(result) ? result : (result?.workflows || []);
    const active = workflows.filter(w => w.state === 'active' || w.active);
    const available = active.length ? active : workflows;
    if (!available.length) { showMessage('No workflows found in ' + repo.full_name, 'warning'); return; }
    appState.actionsWorkflowList = available;
    appState.actionsDispatch = { repo, workflow: available.length === 1 ? available[0] : null };
    if (available.length > 1) {
      showMessage('Workflows: ' + available.map((w, i) => (i + 1) + '=' + (w.name || w.path || w.id)).join(' | '), 'info', 7000);
      startInput('Workflow number/name: ', 'actions-dispatch-workflow');
    } else startInput('Dispatch ref (branch or tag): ', 'actions-dispatch-ref');
  } catch (e) {
    if (!isStale(gen)) showError(e.message || 'Failed to load workflows', 'Workflow dispatch');
  } finally {
    if (!isStale(gen)) { appState.actionsLoading = false; render(); }
  }
}

async function submitWorkflowDispatch(dispatch, ref, inputs) {
  const validation = validateWorkflowInputs(dispatch.workflow, ref, inputs);
  if (!validation.ok) { showMessage(validation.error, 'error'); return; }
  confirm('Dispatch ' + (dispatch.workflow.name || dispatch.workflow.path || 'workflow') +
    ' on ' + dispatch.repo.full_name + ' at ref ' + ref +
    (Object.keys(inputs).length ? ' with ' + Object.keys(inputs).length + ' input(s)' : '') + '?', async () => {
    const [owner, name] = dispatch.repo.full_name.split('/');
    try {
      await dispatchWorkflow(appState.token, owner, name, dispatch.workflow.id || dispatch.workflow.path, ref, inputs);
      showMessage('Workflow dispatched on ' + ref, 'success');
      appState.actionsDispatch = null;
      appState.actionsWorkflowList = [];
      await loadWorkflowRuns();
    } catch (e) { showError(e.message || 'Dispatch failed', 'Workflow dispatch'); }
  }, 'Dispatch workflow');
}

registerInputHandler('actions-dispatch-workflow', (value) => {
  const dispatch = appState.actionsDispatch;
  const workflows = appState.actionsWorkflowList || [];
  const raw = String(value || '').trim();
  const index = /^\\d+$/.test(raw) ? Number(raw) - 1 : -1;
  const workflow = index >= 0 ? workflows[index] : workflows.find(w => String(w.name || w.path || w.id) === raw);
  if (!workflow) { showMessage('Unknown workflow — choose a listed number or exact name', 'warning'); return; }
  dispatch.workflow = workflow;
  startInput('Dispatch ref (branch or tag): ', 'actions-dispatch-ref');
});

registerInputHandler('actions-dispatch-ref', (value) => {
  const dispatch = appState.actionsDispatch;
  if (!dispatch) return;
  const ref = String(value || '').trim();
  const declared = dispatch.workflow.inputs || dispatch.workflow.workflow_dispatch?.inputs || {};
  if (Object.keys(declared).length) {
    dispatch.ref = ref;
    startInput('Inputs JSON ({} for defaults): ', 'actions-dispatch-inputs');
    return;
  }
  submitWorkflowDispatch(dispatch, ref, {});
});
registerInputHandler('actions-dispatch-inputs', (value) => {
  const dispatch = appState.actionsDispatch;
  if (!dispatch) return;
  let inputs;
  try { inputs = JSON.parse(String(value || '{}')); } catch { showMessage('Inputs must be valid JSON', 'error'); return; }
  submitWorkflowDispatch(dispatch, dispatch.ref, inputs || {});
});

export async function loadFailureQueue() {
  if (!appState.token || appState.actionsRepos.length === 0) {
    showMessage('Load repositories before scanning workflow failures', 'warning');
    return;
  }
  const gen = startAsync('actions-failures');
  appState.actionsFailureLoading = true;
  appState.actionsFailures = [];
  render();
  const groups = [];
  try {
    // Keep the aggregate deliberately bounded to protect rate limits. Users
    // can still drill into the normal per-repository run view.
    // Sort candidates by recency so the bounded slice covers the most
    // likely-active repos first.
    const candidates = [...appState.actionsRepos].sort((a,b) => Date.parse(b.pushed_at||b.updated_at||0) - Date.parse(a.pushed_at||a.updated_at||0)).slice(0, 20);
    const queue = candidates.slice();
    const worker = async () => {
      while (queue.length > 0) {
        if (isStale(gen)) return;
        const repo = queue.shift();
        if (!repo) continue;
        const [owner, name] = (repo.full_name || '').split('/');
        if (!owner || !name) continue;
        try {
          const result = await getWorkflowRuns(appState.token, owner, name, 1, 10, gen.signal);
          groups.push({ repo: repo.full_name, runs: result?.workflow_runs || [] });
        } catch { /* preserve partial aggregate */ }
      }
    };
    const count = Math.min(5, Math.max(1, queue.length));
    await Promise.all(Array.from({ length: count }, worker));
    if (!isStale(gen)) {
      appState.actionsFailures = buildFailureQueue(groups);
      const total = appState.actionsRepos.length;
      const scanned = candidates.length;
      showMessage('Found ' + appState.actionsFailures.length + ' failed runs (scanned ' + scanned + '/' + total + ' repos)', 'info');
    }
  } finally {
    if (!isStale(gen)) { appState.actionsFailureLoading = false; render(); }
  }
}

export async function loadWorkflowRuns() {
  const repos = getFilteredRepos();
  const idx = appState.actionsRepoSelected;
  const repo = repos[idx];
  if (!repo) return;
  appState.actionsActiveRepo = repo.full_name;
  const [owner, name] = repo.full_name.split('/');
  const keepExpanded = appState.actionsExpandedRun;
  const keepJobs = appState.actionsJobs;
  const keepSteps = appState.actionsJobSteps;
  const gen = startAsync('actions-runs');
  appState.actionsLoading = true;
  appState.actionsRuns = [];
  appState.actionsSelected = 0;
  appState.actionsScroll = 0;
  render();
  try {
    const result = await getWorkflowRuns(appState.token, owner, name, 1, RUNS_PER_PAGE, gen.signal);
    if (isStale(gen)) return;
    const runs = result && result.workflow_runs ? result.workflow_runs : [];
    appState.actionsRuns = runs;
    // Auto-refresh therefore no longer collapses open runs: preserve
    // expansion + cached jobs/steps when the same run id still exists.
    if (keepExpanded && runs.some(r => r.id === keepExpanded)) {
      appState.actionsExpandedRun = keepExpanded;
      appState.actionsJobs = keepJobs;
      appState.actionsJobSteps = keepSteps;
    } else {
      appState.actionsExpandedRun = null;
      appState.actionsJobs = {};
      appState.actionsJobSteps = {};
    }
    appState.actionsRunsPage = 1;
    appState.actionsRunsHasMore = runs.length >= RUNS_PER_PAGE;
    appState.actionsView = 'runs';
  } catch (e) {
    if (!isStale(gen)) showError(e.message, 'Load workflow runs', { retry: loadWorkflowRuns });
  }
  if (!isStale(gen)) {
    appState.actionsLoading = false;
    render();
  }
}

export async function loadMoreWorkflowRuns() {
  const repo = activeRepo();
  if (!repo || !appState.actionsRunsHasMore || appState.actionsLoading) return;
  const [owner, name] = repo.full_name.split('/');
  const gen = startAsync('actions-runs-more');
  appState.actionsLoading = true;
  render();
  try {
    const page = appState.actionsRunsPage + 1;
    const result = await getWorkflowRuns(appState.token, owner, name, page, RUNS_PER_PAGE, gen.signal);
    if (isStale(gen)) return;
    const more = result && result.workflow_runs ? result.workflow_runs : [];
    appState.actionsRuns = [...appState.actionsRuns, ...more];
    appState.actionsRunsPage = page;
    appState.actionsRunsHasMore = more.length >= RUNS_PER_PAGE;
    showMessage(more.length ? 'Loaded ' + appState.actionsRuns.length + ' workflow runs' : 'All workflow runs loaded', 'info');
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Failed to load more workflow runs', 'error');
  } finally {
    if (!isStale(gen)) {
      appState.actionsLoading = false;
      render();
    }
  }
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
    const repo = activeRepo();
    if (!repo) return;
    const [owner, name] = repo.full_name.split('/');
    const gen = startAsync('actions-jobs');
    appState.actionsLoading = true;
    render();
    try {
      const result = await getWorkflowJobs(appState.token, owner, name, runId, gen.signal);
      if (isStale(gen)) return;
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
    if (!isStale(gen)) appState.actionsLoading = false;
  }
  render();
}

export async function rerunSelected() {
  const run = appState.actionsRuns[appState.actionsSelected];
  if (!run) return;
  const repo = activeRepo();
  if (!repo) return;
  const [owner, name] = repo.full_name.split('/');
  confirm('Re-run workflow "' + (run.name||run.id) + ' #' + run.run_number + '" on ' + repo.full_name + '?', async () => {
    try {
      await rerunWorkflow(appState.token, owner, name, run.id);
      showMessage('Re-queued run #' + run.id, 'success');
      loadWorkflowRuns();
    } catch (e) {
      showMessage(e.message || 'Re-run failed', 'error');
    }
  }, 'Re-run workflow');
}

export async function cancelSelected() {
  const run = appState.actionsRuns[appState.actionsSelected];
  if (!run) return;
  if (run.status !== 'in_progress' && run.status !== 'queued' && run.status !== 'waiting') {
    showMessage('Run is not running', 'warning');
    return;
  }
  const repo = activeRepo();
  if (!repo) return;
  const [owner, name] = repo.full_name.split('/');
  confirm('Cancel run #' + run.run_number + ' on ' + repo.full_name + '?', async () => {
    try {
      await cancelWorkflowRun(appState.token, owner, name, run.id);
      showMessage('Cancelled run #' + run.id, 'success');
      loadWorkflowRuns();
    } catch (e) {
      showMessage(e.message || 'Cancel failed', 'error');
    }
  }, 'Cancel run');
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
  if (appState.actionsLog) {
    appState.actionsLog = null;
    appState.actionsLogScroll = 0;
    render();
    return;
  }
  if (appState.actionsView === 'failures') {
    appState.actionsView = 'repos';
    render();
    return;
  }
  if (appState.actionsView === 'runs') {
    if (appState.actionsExpandedRun) {
      appState.actionsExpandedRun = null;
    } else {
      appState.actionsView = 'repos';
    }
    render();
  }
  // repos view: fall through to handleBack → setTab(0)
}

function renderWorkflowLog(screen, y, h, W) {
  const log = appState.actionsLog;
  screen.writeStr(2, y, 'WORKFLOW LOG #' + (log?.jobId || '?'), color('title'));
  screen.writeStr(Math.max(2, W - 28), y, log?.truncated ? 'TRUNCATED' : 'FULL LOG', log?.truncated ? { fg: 'yellow', bold: true } : { dim: true });
  screen.hline(y + 1, '─', color('dim'));
  if (appState.actionsLoading && !log?.text) { loadingIndicator(screen, 2, y + 3, 'loading log'); return; }
  const lines = String(log?.text || '(empty log)').split(/\\r?\\n/);
  const rows = Math.max(1, h - 5);
  const maxScroll = Math.max(0, lines.length - rows);
  appState.actionsLogScroll = Math.max(0, Math.min(maxScroll, appState.actionsLogScroll || 0));
  for (let i = 0; i < rows && i + appState.actionsLogScroll < lines.length; i++) {
    const line = lines[i + appState.actionsLogScroll];
    const style = /error|fail|exception|fatal/i.test(line) ? { fg: 'red' } : /warning|warn/i.test(line) ? { fg: 'yellow' } : null;
    screen.writeStr(2, y + 2 + i, truncate(line, W - 4), style);
  }
  screen.writeStr(2, y + 2 + Math.min(rows, lines.length),
    'Lines ' + (appState.actionsLogScroll + 1) + '-' + Math.min(appState.actionsLogScroll + rows, lines.length) +
    ' of ' + lines.length + '   [Esc] back  [g/G] top/bottom', { dim: true });
}

export function renderActions(screen, y, h) {
  const W = screen.width;
  if (appState.actionsLog) { renderWorkflowLog(screen, y, h, W); return; }
  appState._actionsListBounds = null;
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

  const section = appState.actionsView === 'runs' ? 'actions:runs' : appState.actionsView === 'failures' ? 'actions:failures' : 'actions:repos';
  const expanded = collapsibleHeader(screen, 2, y + 2, section,
    appState.actionsView === 'runs' ? 'WORKFLOW RUNS' : appState.actionsView === 'failures' ? 'FAILURE QUEUE' : 'REPOSITORIES',
    appState.actionsView === 'runs' ? '[t] back to repos' : appState.actionsView === 'failures' ? '[t] back to repos' : null);
  if (!expanded) return;

  if (appState.actionsView === 'repos') {
    renderRepoList(screen, y + 4, h - 4, W);
  } else if (appState.actionsView === 'failures') {
    renderFailureList(screen, y + 4, h - 4, W);
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
  let scanLabel;
  if (appState.actionsScanning) {
    const prog = appState.actionsScanProgress;
    scanLabel = prog
      ? 'Scanning ' + prog.done + '/' + prog.total + ' repos…' + filterHint
      : 'Scanning ' + (appState.repos?.length || 0) + ' repos for GitHub workflows…' + filterHint;
  } else {
    scanLabel = 'Select a repo to view workflow runs:' + filterHint;
  }
  screen.writeStr(2, y, scanLabel, { dim: true });
  y += 2;
  const repos = getFilteredRepos();
  if (repos.length === 0) {
    const scannedAndFiltered = appState.actionsScanDone
      && appState.actionsNoWorkflowRepos && appState.actionsNoWorkflowRepos.size > 0;
    emptyState(screen, y - 2, Math.max(8, h), {
      icon: '○',
      title: scannedAndFiltered ? 'No repos with workflows' : 'No repos loaded',
      message: scannedAndFiltered
        ? 'None of your ' + (appState.repos?.length || 0) + ' repos have GitHub Actions workflows'
        : 'First visit the Dashboard or Repos tab to load your repos',
      keyHint: scannedAndFiltered ? '[R] Rescan for workflows' : '',
    });
    return;
  }
  const maxVisible = Math.max(1, h - 2);
  appState._actionsListBounds = { rowStart: y, maxRows: maxVisible, scroll: appState.actionsRepoScroll, length: repos.length };
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
    const stars = '★ ' + (r.stargazers_count || 0);
    screen.writeStr(2, row, prefix + name, sel ? color('selection') : (color('repoName') || { fg: 'white' }));
    screen.writeStr(W - stars.length - 2, row, stars, sel ? color('selection') : { fg: 'yellow' });
  }
  scrollIndicators(screen, y, y + maxVisible - 1, appState.actionsRepoScroll, repos.length);
}

function renderFailureList(screen, y, h, W) {
  if (appState.actionsFailureLoading) { loadingIndicator(screen, 2, y, 'scanning workflow failures'); return; }
  const failures = appState.actionsFailures || [];
  if (failures.length === 0) {
    emptyState(screen, y, h, { icon: '✓', title: 'No recent workflow failures', message: 'Press [F] to scan up to 20 repositories' });
    return;
  }
  screen.writeStr(2, y, 'CONCLUSION', { fg: 'cyan', bold: true });
  screen.writeStr(18, y, 'REPOSITORY / WORKFLOW', { fg: 'cyan', bold: true });
  y++;
  const max = Math.max(1, h - 3);
  appState._actionsListBounds = { rowStart: y, maxRows: max, scroll: appState.actionsScroll, length: failures.length };
  for (let i = 0; i < max && i + appState.actionsScroll < failures.length; i++) {
    const idx = i + appState.actionsScroll;
    const run = failures[idx];
    const selected = idx === appState.actionsSelected;
    if (selected) for (let x = 0; x < W; x++) screen.styleBuf[y + i][x] = color('selection');
    screen.writeStr(2, y + i, selected ? '▶ ✗' : '  ✗', selected ? color('selection') : { fg: 'red', bold: true });
    screen.writeStr(18, y + i, truncate(run.repo + ' / ' + (run.name || run.display_title || '?'), W - 36), selected ? color('selection') : null);
    screen.writeStr(W - 16, y + i, '#' + (run.run_number || run.id || '?') + ' ' + relTime(run.updated_at || run.created_at), selected ? color('selection') : { dim: true });
  }
  scrollIndicators(screen, y, y + max - 1, appState.actionsScroll, failures.length);
  screen.writeStr(2, y + Math.min(max, failures.length) + 1, '[F] rescan   [Enter] open repo runs   [Esc] back', { dim: true });
}

function renderRunList(screen, y, h, W) {
  const repos = getFilteredRepos();
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
  appState._actionsListBounds = { rowStart: y, maxRows: maxVisible, scroll: appState.actionsScroll, length: runs.length };
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
          // Workflow/job names are user content — measure cells so CJK/emoji
          // names can't slide under the duration.
          if (jobDur && 10 + displayWidth(jobName) + 2 < W) {
            screen.writeStr(10 + displayWidth(jobName) + 2, curY, jobDur, { dim: true });
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
      const moreHint = appState.actionsRunsHasMore ? '   [Space] Load more' : '';
    const hint = appState.actionsExpandedRun
      ? '[Enter] Close detail   [o] Open in browser   [r] Re-run   [x] Cancel   [Esc] Back' + moreHint
      : '[Enter] Expand jobs   [o] Open in browser   [r] Re-run   [x] Cancel   [Esc] Back' + moreHint;
    screen.writeStr(2, hintY + 1, hint, { dim: true });
  }
}

registerInputHandler('actions-filter', (value) => {
  appState.actionsFilter = (value || '').trim();
  appState.actionsRepoScroll = 0;
  appState.actionsRepoSelected = 0;
  appState.actionsExpandedRun = null;
  showMessage(appState.actionsFilter
    ? 'Filtering repos: "' + appState.actionsFilter + '"'
    : 'Repo filter cleared', 'info');
  render();
});

export const keys = {
  '/': () => startInput('Filter repos: ', 'actions-filter'),
  'F': () => { appState.actionsView = 'failures'; appState.actionsSelected = 0; appState.actionsScroll = 0; loadFailureQueue(); },
  'd': () => { if (appState.actionsView === 'runs') startWorkflowDispatch(); },
  'l': () => {
    if (appState.actionsView === 'runs') {
      const repo = activeRepo();
      if (!repo) return;
      const run = appState.actionsRuns[appState.actionsSelected];
      const jobs = run && appState.actionsJobs[run.id];
      const job = jobs && jobs.find(j => j.conclusion === 'failure') || jobs && jobs[0];
      if (job) openWorkflowLog(job.id); else showMessage('Expand a run first to load its jobs', 'warning');
    }
  },
  't': () => {
    if (appState.actionsView === 'runs' || appState.actionsView === 'failures') {
      appState.actionsView = 'repos';
      appState.actionsExpandedRun = null;
      render();
    }
  },
  'o': () => {
    if (appState.actionsView === 'runs') openSelectedRun();
  },
  'R': () => {
    if (appState.actionsView === 'runs') rerunSelected();
    else if (appState.actionsView === 'repos') rescanWorkflowRepos();
  },
  'x': () => { if (appState.actionsView === 'runs') cancelSelected(); else if (appState.actionsView === 'repos' && appState.actionsScanning) cancelWorkflowScan(); },
};

export function up() {
  if (appState.actionsLog) {
    appState.actionsLogScroll = Math.max(0, appState.actionsLogScroll - 1);
    render();
  } else if (appState.actionsView === 'failures') {
    const maxVisible = appState._actionsListBounds?.maxRows || Math.max(1, 10);
    appState.actionsSelected = Math.max(0, appState.actionsSelected - 1);
    appState.actionsScroll = followScroll(appState.actionsSelected, appState.actionsScroll, maxVisible);
    render();
  } else if (appState.actionsView === 'repos') {
    const repos = getFilteredRepos();
    if (repos.length === 0) return;
    appState.actionsRepoSelected = Math.max(0, appState.actionsRepoSelected - 1);
    const maxVisible = appState._actionsListBounds?.maxRows || Math.max(1, 10);
    appState.actionsRepoScroll = followScroll(appState.actionsRepoSelected, appState.actionsRepoScroll, maxVisible);
    render();
  } else {
    const runs = appState.actionsRuns;
    if (runs.length === 0) return;
    appState.actionsSelected = Math.max(0, appState.actionsSelected - 1);
    const maxVisible = appState._actionsListBounds?.maxRows || Math.max(1, 10);
    appState.actionsScroll = followScroll(appState.actionsSelected, appState.actionsScroll, maxVisible);
    // Don't auto-collapse expanded run on arrow navigation
    render();
  }
}

export function down() {
  if (appState.actionsLog) {
    const lines = String(appState.actionsLog.text || '').split(/\\r?\\n/);
    appState.actionsLogScroll = Math.min(Math.max(0, lines.length - 1), appState.actionsLogScroll + 1);
    render();
  } else if (appState.actionsView === 'failures') {
    const failures = appState.actionsFailures || [];
    if (failures.length === 0) return;
    const maxVisible = appState._actionsListBounds?.maxRows || Math.max(1, 10);
    appState.actionsSelected = Math.min(failures.length - 1, appState.actionsSelected + 1);
    appState.actionsScroll = followScroll(appState.actionsSelected, appState.actionsScroll, maxVisible);
    render();
  } else if (appState.actionsView === 'repos') {
    const repos = getFilteredRepos();
    const maxVisible = Math.max(1, (process.stdout.rows || 24) - 12);
    if (repos.length === 0) return;
    appState.actionsRepoSelected = Math.min(repos.length - 1, appState.actionsRepoSelected + 1);
    appState.actionsRepoScroll = followScroll(appState.actionsRepoSelected, appState.actionsRepoScroll, maxVisible);
    render();
  } else {
    const runs = appState.actionsRuns;
    const maxVisible = Math.max(1, (process.stdout.rows || 24) - 16);
    if (runs.length === 0) return;
    appState.actionsSelected = Math.min(runs.length - 1, appState.actionsSelected + 1);
    appState.actionsScroll = followScroll(appState.actionsSelected, appState.actionsScroll, maxVisible);
    // Don't auto-collapse expanded run on arrow navigation
    render();
  }
}

export function bottom(screen) {
  if (appState.actionsLog) {
    const lines = String(appState.actionsLog.text || '').split(/\\r?\\n/);
    appState.actionsLogScroll = Math.max(0, lines.length - 1);
  } else if (appState.actionsView === 'repos') {
    const repos = getFilteredRepos();
    appState.actionsRepoSelected = Math.max(0, repos.length - 1);
    const maxVisible = Math.max(1, (screen ? screen.height : process.stdout.rows || 24) - 12);
    appState.actionsRepoScroll = Math.max(0, repos.length - maxVisible);
  } else {
    const runs = appState.actionsRuns;
    appState.actionsSelected = Math.max(0, runs.length - 1);
    const maxVisible = Math.max(1, (screen ? screen.height : process.stdout.rows || 24) - 16);
    appState.actionsScroll = Math.max(0, runs.length - maxVisible);
  }
  render();
}

export function enter() {
  if (appState.actionsView === 'repos') {
    loadWorkflowRuns();
  } else if (appState.actionsView === 'failures') {
    const failure = appState.actionsFailures[appState.actionsSelected];
    if (failure?.repo) {
      const idx = getFilteredRepos().findIndex(r => r.full_name === failure.repo);
      if (idx >= 0) { appState.actionsRepoSelected = idx; appState.actionsView = 'runs'; loadWorkflowRuns(); }
    }
  } else {
    toggleRunDetail();
  }
}

export function space() {
  if (appState.actionsView === 'failures') { loadFailureQueue(); return; }
  if (appState.actionsView === 'repos') {
    // Repository metadata is loaded in the Repos tab.
    return;
  }
  if (appState.actionsRunsHasMore && appState.actionsSelected >= appState.actionsRuns.length - 1) {
    loadMoreWorkflowRuns();
  } else {
    toggleRunDetail();
  }
}

const ACTIONS_SECTIONS = ['repos', 'runs', 'failures'];

export function getSections() {
  return ACTIONS_SECTIONS.map(s => 'actions:' + s);
}

export function getCurrentSection() {
  return appState.actionsView === 'runs' ? 'actions:runs' : appState.actionsView === 'failures' ? 'actions:failures' : 'actions:repos';
}
