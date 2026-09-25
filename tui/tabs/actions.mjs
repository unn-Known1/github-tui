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
import { openUrl, relTime, truncate, displayWidth, stripAnsi } from '../utils.mjs';
import { color } from '../theme.mjs';
import { emptyState, loadingIndicator, scrollIndicators, collapsibleHeader } from '../render.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import { showError, isAuthError, handleAuthFailure } from '../error-recovery.mjs';

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

// Cancellation is keyed to the in-flight scan generation: a module-level
// boolean was reset on every scan entry, so starting a new scan wiped the
// cancel intent of the scan still running (they are never concurrent in a
// healthy flow, but an [x]-then-[R] sequence hit exactly this window).
let _cancelledScanGen = null;
let _currentScanGen = null;
export function cancelWorkflowScan() { _cancelledScanGen = _currentScanGen; }

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
    if (_cancelledScanGen === gen) {
      showMessage('Scan cancelled — partial results', 'warning', 5000);
    } else if (appState.actionsScanProbeFailures > 0) {
      showMessage(shown + ' repos with workflows (' + appState.actionsScanProbeFailures + ' probes failed — those repos stay visible)', 'warning', 6000);
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
  // Exposed so the render-side scanLabel reports the SAME count the scan
  // actually probes (users with >200 repos saw "Scanning 500 repos…" while
  // only 200 were scanned).
  appState.actionsScanCap = Math.min(repos.length, CAP);
  const capped = repos.slice(0, CAP);
  const noWorkflow = new Set();
  const queue = capped.slice();
  _currentScanGen = gen;
  let probeFailures = 0;
  let done = 0;
  const worker = async () => {
    while (queue.length > 0 && !isStale(gen) && _cancelledScanGen !== gen) {
      const r = queue.shift();
      if (!r || !r.full_name) { done++; if (done % 5 === 0) { appState.actionsScanProgress = { done, total: queue.length + done }; render(); } continue; }
      const [owner, name] = r.full_name.split('/');
      if (!owner || !name) { done++; if (done % 5 === 0) { appState.actionsScanProgress = { done, total: queue.length + done }; render(); } continue; }
      try {
        const result = await getWorkflows(appState.token, owner, name, gen.signal);
        const workflows = Array.isArray(result) ? result : (result?.workflows || []);
        if (workflows.length === 0) noWorkflow.add(r.full_name);
      } catch {
        // Keep the repo visible, but stop pretending failures are free:
        // a 403/rate-limit burst silently bucketed repos wrong. Count them
        // so the completion toast can surface the uncertainty.
        probeFailures++;
      }
      done++;
      if (done % 5 === 0) { appState.actionsScanProgress = { done, total: queue.length + done }; render(); }
    }
  };
  const count = Math.min(WORKFLOW_SCAN_CONCURRENCY, Math.max(1, queue.length));
  await Promise.all(Array.from({ length: count }, worker));
  appState.actionsScanProgress = null;
  appState.actionsScanProbeFailures = probeFailures;
  if (!isStale(gen) && _cancelledScanGen !== gen) {
    appState.actionsNoWorkflowRepos = noWorkflow;
    appState.actionsScanDone = true;
  } else if (!isStale(gen)) {
    // Cancelled (not stale): keep partial results visible, but do not mark
    // the scan as done so a later rescan can finish the job.
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

export function getExpandedJobs() {
  const runId = appState.actionsExpandedRun;
  if (!runId) return [];
  return appState.actionsJobs[runId] || [];
}

// Jobs for job-cursor navigation: prefer the selected run when its jobs are
// loaded (user moved selection after expanding), else fall back to the
// expanded run so J/K keep working without re-expanding.
export function getActiveJobs() {
  const run = appState.actionsRuns[appState.actionsSelected];
  if (run && appState.actionsJobs[run.id]?.length) return appState.actionsJobs[run.id];
  return getExpandedJobs();
}

export function getSelectedJob() {
  const jobs = getExpandedJobs();
  if (!jobs.length) return null;
  const idx = Math.max(0, Math.min(jobs.length - 1, appState.actionsJobSelected || 0));
  return jobs[idx] || null;
}

function persistLogScroll() {
  const id = appState.actionsLog?.jobId;
  if (id != null) {
    if (!appState.actionsLogScrolls || typeof appState.actionsLogScrolls !== 'object') appState.actionsLogScrolls = {};
    appState.actionsLogScrolls[id] = appState.actionsLogScroll || 0;
  }
}

export async function openWorkflowLog(jobId) {
  const repo = activeRepo();
  if (!repo || !jobId) return;
  // Remember scroll of the log we're leaving so each job keeps its own
  // viewport — switching jobs restores where you were.
  persistLogScroll();
  const [owner, name] = repo.full_name.split('/');
  const gen = startAsync('actions-log');
  appState.actionsLoading = true;
  appState.actionsLog = { jobId, text: '', truncated: false, bytes: 0 };
  const saved = appState.actionsLogScrolls?.[jobId];
  appState.actionsLogScroll = Number.isFinite(+saved) ? +saved : 0;
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
  // GT-07: Escape cancels the input modal without invoking this handler, but
  // a null/undefined value must never resolve to a default workflow — treat
  // it as an explicit cancel so no CI run fires.
  if (value === null || value === undefined) { showMessage('Workflow dispatch cancelled', 'info'); return; }
  const dispatch = appState.actionsDispatch;
  const workflows = appState.actionsWorkflowList || [];
  const raw = String(value || '').trim();
  const index = /^\d+$/.test(raw) ? Number(raw) - 1 : -1;
  const workflow = index >= 0 ? workflows[index] : workflows.find(w => String(w.name || w.path || w.id) === raw);
  if (!workflow) { showMessage('Unknown workflow — choose a listed number or exact name', 'warning'); return; }
  dispatch.workflow = workflow;
  startInput('Dispatch ref (branch or tag): ', 'actions-dispatch-ref');
});

registerInputHandler('actions-dispatch-ref', (value) => {
  // GT-07: cancelling the ref prompt must NOT fall back to 'main' and fire a
  // live run. Null/undefined (or empty after validation) aborts the flow.
  if (value === null || value === undefined) { showMessage('Workflow dispatch cancelled', 'info'); return; }
  const dispatch = appState.actionsDispatch;
  if (!dispatch) return;
  const ref = String(value || '').trim();
  if (!ref) { showMessage('Workflow dispatch cancelled — a branch or tag is required', 'info'); return; }
  const declared = dispatch.workflow.inputs || dispatch.workflow.workflow_dispatch?.inputs || {};
  if (Object.keys(declared).length) {
    dispatch.ref = ref;
    startInput('Inputs JSON ({} for defaults): ', 'actions-dispatch-inputs');
    return;
  }
  submitWorkflowDispatch(dispatch, ref, {});
});
registerInputHandler('actions-dispatch-inputs', (value) => {
  if (value === null || value === undefined) { showMessage('Workflow dispatch cancelled', 'info'); return; }
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
    let probeFailures = 0;
    let authFailure = null;
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
        } catch (e) {
          // Preserve the partial aggregate, but count the failure: a 401 or
          // rate-limit burst must not be indistinguishable from "no failures
          // found" (the repos simply never got counted into the queue).
          // Auth failures short-circuit the whole scan via the unified wipe.
          if (isAuthError(e) && !authFailure) authFailure = e;
          probeFailures++;
        }
      }
    };
    const count = Math.min(5, Math.max(1, queue.length));
    await Promise.all(Array.from({ length: count }, worker));
    if (authFailure && !isStale(gen)) {
      appState.actionsFailureLoading = false;
      await handleAuthFailure(authFailure, loadFailureQueue);
      return;
    }
    if (!isStale(gen)) {
      appState.actionsFailures = buildFailureQueue(groups);
      const total = appState.actionsRepos.length;
      const scanned = candidates.length;
      const failedNote = probeFailures > 0 ? ', ' + probeFailures + ' probes failed' : '';
      showMessage('Found ' + appState.actionsFailures.length + ' failed runs (scanned ' + scanned + '/' + total + ' repos' + failedNote + ')',
        probeFailures > 0 ? 'warning' : 'info');
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
  appState.actionsJobSelected = 0;
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
      const jobs = keepJobs[keepExpanded] || [];
      if ((appState.actionsJobSelected || 0) >= jobs.length) appState.actionsJobSelected = 0;
    } else {
      appState.actionsExpandedRun = null;
      appState.actionsJobs = {};
      appState.actionsJobSteps = {};
      appState.actionsJobSelected = 0;
    }
    appState.actionsRunsPage = 1;
    appState.actionsRunsHasMore = runs.length >= RUNS_PER_PAGE;
    appState.actionsView = 'runs';
  } catch (e) {
    if (!isStale(gen)) {
      if (isAuthError(e)) { appState.actionsLoading = false; await handleAuthFailure(e, loadWorkflowRuns); return; }
      showError(e.message, 'Load workflow runs', { retry: loadWorkflowRuns });
    }
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
    if (!isStale(gen)) {
      if (isAuthError(e)) { await handleAuthFailure(e, loadMoreWorkflowRuns); return; }
      showMessage(e.message || 'Failed to load more workflow runs', 'error');
    }
  } finally {
    if (!isStale(gen)) {
      appState.actionsLoading = false;
      render();
    }
  }
}

export function jobCursorDown() {
  const jobs = getActiveJobs();
  if (!jobs.length) { showMessage('Expand a run first to pick a job', 'warning'); return; }
  // When a fullscreen log is open, J flips straight to the next job's log
  // (per-job scrolling without Esc → J → l round-trips).
  if (appState.actionsLog) { openJobLogAt((appState.actionsJobSelected || 0) + 1); return; }
  appState.actionsJobSelected = Math.min(jobs.length - 1, (appState.actionsJobSelected || 0) + 1);
  render();
}

export function jobCursorUp() {
  const jobs = getActiveJobs();
  if (!jobs.length) { showMessage('Expand a run first to pick a job', 'warning'); return; }
  if (appState.actionsLog) { openJobLogAt((appState.actionsJobSelected || 0) - 1); return; }
  appState.actionsJobSelected = Math.max(0, (appState.actionsJobSelected || 0) - 1);
  render();
}

function openJobLogAt(idx) {
  const jobs = getActiveJobs();
  if (!jobs.length) return;
  const clamped = Math.max(0, Math.min(jobs.length - 1, idx));
  appState.actionsJobSelected = clamped;
  const job = jobs[clamped];
  if (job) openWorkflowLog(job.id);
}

export function openSelectedJobLog() {
  const jobs = getActiveJobs();
  if (!jobs || !jobs.length) { showMessage('Expand a run first to load its jobs', 'warning'); return; }
  const idx = Math.max(0, Math.min(jobs.length - 1, appState.actionsJobSelected || 0));
  const job = jobs[idx] || jobs.find(j => j.conclusion === 'failure') || jobs[0];
  if (job) openWorkflowLog(job.id);
}

export async function toggleRunDetail() {
  const run = appState.actionsRuns[appState.actionsSelected];
  if (!run) return;
  const runId = run.id;

  if (appState.actionsExpandedRun === runId) {
    appState.actionsExpandedRun = null;
    appState.actionsJobSelected = 0;
    render();
    return;
  }

  appState.actionsExpandedRun = runId;
  appState.actionsJobSelected = 0;
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
      // Await so a failure here is caught below (and not mis-attributed to
      // the re-run itself as an unhandled rejection).
      await loadWorkflowRuns();
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
      await loadWorkflowRuns(); // same unhandled-rejection fix as rerun
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
    persistLogScroll();
    appState.actionsLog = null;
    appState.actionsLogScroll = 0;
    invalidateLogLines();
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

function findLogJob() {
  const id = appState.actionsLog?.jobId;
  if (id == null) return { jobs: [], idx: -1, job: null };
  const active = getActiveJobs();
  let idx = active.findIndex(j => j.id === id);
  if (idx >= 0) return { jobs: active, idx, job: active[idx] };
  for (const list of Object.values(appState.actionsJobs || {})) {
    if (!Array.isArray(list)) continue;
    idx = list.findIndex(j => j.id === id);
    if (idx >= 0) return { jobs: list, idx, job: list[idx] };
  }
  return { jobs: active, idx: -1, job: null };
}

function renderWorkflowLog(screen, y, h, W) {
  const log = appState.actionsLog;
  const { jobs, idx: jobIdx, job } = findLogJob();
  const jobName = job?.name || null;
  const title = 'WORKFLOW LOG #' + (log?.jobId || '?') +
    (jobName ? ' ' + truncate(jobName, 24) : '') +
    (jobIdx >= 0 && jobs.length > 1 ? ' (' + (jobIdx + 1) + '/' + jobs.length + ')' : '');
  screen.writeStr(2, y, title, color('title'));
  screen.writeStr(Math.max(2, W - 28), y, log?.truncated ? 'TRUNCATED' : 'FULL LOG', log?.truncated ? { fg: 'yellow', bold: true } : { dim: true });
  screen.hline(y + 1, '─', color('dim'));
  if (appState.actionsLoading && !log?.text) { loadingIndicator(screen, 2, y + 3, 'loading log'); return; }
  // Cached split+sanitized lines (see getLogLines): a 2MB log re-split on
  // every frame/keypress janked scrolling badly enough to feel broken.
  const lines = getLogLines();
  const rows = Math.max(1, h - 5);
  // Publish viewport geometry for paging (pageUp/pageDown), the mouse wheel
  // handler, and g/G clamping — previously every consumer recomputed (or
  // guessed) rows differently, so PgDn moved one line and G overshot.
  appState._actionsLogRows = rows;
  const maxScroll = Math.max(0, lines.length - rows);
  appState.actionsLogScroll = Math.max(0, Math.min(maxScroll, appState.actionsLogScroll || 0));
  for (let i = 0; i < rows && i + appState.actionsLogScroll < lines.length; i++) {
    const line = lines[i + appState.actionsLogScroll];
    const style = /error|fail|exception|fatal/i.test(line) ? { fg: 'red' } : /warning|warn/i.test(line) ? { fg: 'yellow' } : null;
    screen.writeStr(2, y + 2 + i, truncate(line, W - 4), style);
  }
  scrollIndicators(screen, y + 2, y + 2 + rows - 1, appState.actionsLogScroll, lines.length);
  screen.writeStr(2, y + 2 + Math.min(rows, lines.length),
    'Lines ' + (appState.actionsLogScroll + 1) + '-' + Math.min(appState.actionsLogScroll + rows, lines.length) +
    ' of ' + lines.length + '   [Esc] back  [J/K] prev/next job  [g/G] top/bottom  [PgUp/PgDn] page', { dim: true });
}

// ── Workflow log scroll model ────────────────────────────────────
// Single source of truth for the log viewport so keyboard, mouse wheel,
// and g/G all clamp to the same maxScroll (lines - visible rows). The old
// code clamped to lines.length - 1 in four different places, letting the
// stored scroll drift past the viewport and snap back on the next render.

let _logLinesCache = { ref: null, lines: [] };

// Split + sanitize once per loaded log. Strips ANSI color codes (CI logs
// are full of them — they broke truncate()'s width math and could bleed
// styles into following rows) and normalizes CRLF.
export function getLogLines() {
  const log = appState.actionsLog;
  if (!log) return [];
  if (_logLinesCache.ref === log) return _logLinesCache.lines;
  const lines = String(log.text || '(empty log)').split(/\r?\n/).map(l => stripAnsi(l));
  _logLinesCache = { ref: log, lines };
  return lines;
}

export function invalidateLogLines() { _logLinesCache = { ref: null, lines: [] }; }

export function getLogRows() {
  return Math.max(1, appState._actionsLogRows || 10);
}

export function getLogMaxScroll() {
  return Math.max(0, getLogLines().length - getLogRows());
}

function clampLogScroll(v) {
  return Math.max(0, Math.min(getLogMaxScroll(), Number.isFinite(+v) ? +v : 0));
}

function setLogScroll(v) {
  appState.actionsLogScroll = clampLogScroll(v);
  persistLogScroll();
}

export function logTop() {
  setLogScroll(0);
  render();
}

export function logBottom() {
  setLogScroll(getLogMaxScroll());
  render();
}

export function logPageUp() {
  setLogScroll((appState.actionsLogScroll || 0) - getLogRows());
  render();
}

export function logPageDown() {
  setLogScroll((appState.actionsLogScroll || 0) + getLogRows());
  render();
}

// Mouse wheel step (3 lines, clamped). Exported so mouse.mjs can share the
// same clamping instead of guessing geometry.
export function logWheel(delta) {
  setLogScroll((appState.actionsLogScroll || 0) + delta);
  render();
}

export function pageUp() {
  if (appState.actionsLog) { logPageUp(); return; }
  up();
}

export function pageDown() {
  if (appState.actionsLog) { logPageDown(); return; }
  down();
}

export function renderActions(screen, y, h) {
  const W = screen.width;
  if (appState.actionsLog) {
    // Clear list geometry while the fullscreen log owns the viewport so
    // clicks/hover can't mutate the hidden run list underneath.
    appState._actionsListBounds = null;
    appState._actionsRowMap = null;
    renderWorkflowLog(screen, y, h, W);
    return;
  }
  appState._actionsListBounds = null;
  if (!appState.token) {
    emptyState(screen, y, h, {
      icon: '🔒  NOT SIGNED IN',
      title: 'CI / Actions',
      message: 'Sign in to view your workflow runs.',
      keyHint: 'Press [0] for Settings  →  [Enter] on Login',
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
      : 'Scanning ' + (appState.actionsScanCap || appState.repos?.length || 0) + ' repos for GitHub workflows…' + filterHint;
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

  screen.writeStr(2, y, '', { dim: true });
  screen.writeStr(5, y, 'WORKFLOW', { fg: 'cyan', bold: true });
  screen.writeStr(38, y, 'BRANCH', { fg: 'cyan', bold: true });
  screen.writeStr(54, y, 'EVENT', { fg: 'cyan', bold: true });
  screen.writeStr(66, y, 'AGE', { fg: 'cyan', bold: true });
  y++;

  const maxVisible = Math.max(1, h - 3);
  appState._actionsListBounds = { rowStart: y, maxRows: maxVisible, scroll: appState.actionsScroll, length: runs.length };
  // Row map for mouse hit-testing: each painted row knows whether it's a
  // run header or a job row (runIdx + jobIdx). Steps are mapped to their
  // parent job so clicking a step still selects the right job.
  const rowMap = [];
  let curY = y;
  let drawn = 0;

  for (let i = 0; i < runs.length && drawn < maxVisible; i++) {
    const idx = appState.actionsScroll + i;
    if (idx >= runs.length) break;
    const run = runs[idx];
    const sel = idx === appState.actionsSelected;
    const isExpanded = appState.actionsExpandedRun === run.id;

    if (curY >= y + maxVisible) break;
    const row = curY;
    if (sel && !isExpanded) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    } else if (sel && isExpanded) {
      // Run header still gets selection bg so the expanded block reads as one group.
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
    rowMap.push({ y: curY, runIdx: idx, jobIdx: -1 });
    curY++;
    drawn++;

    if (isExpanded) {
      const jobs = appState.actionsJobs[run.id] || [];
      // Clamp the job cursor whenever jobs (re)load so `l` can't open a stale index.
      if (jobs.length && (appState.actionsJobSelected || 0) >= jobs.length) appState.actionsJobSelected = jobs.length - 1;
      if (jobs.length === 0 && appState.actionsLoading) {
        if (curY < y + maxVisible) {
          screen.writeStr(6, curY, 'Loading jobs...', { dim: true });
          curY++;
          drawn++;
        }
      } else {
        for (let ji2 = 0; ji2 < jobs.length; ji2++) {
          const job = jobs[ji2];
          if (curY >= y + maxVisible) break;
          const ji = jobStatusIcon(job);
          const isJobSel = sel && ji2 === (appState.actionsJobSelected || 0);
          if (isJobSel) {
            for (let x = 0; x < W; x++) screen.styleBuf[curY][x] = color('selection');
          }
          const jobName = truncate(job.name || '?', W - 16);
          const jobWhen = job.started_at ? relTime(job.started_at) : '';
          const jobDur = job.completed_at && job.started_at
            ? Math.round((new Date(job.completed_at) - new Date(job.started_at)) / 1000) + 's'
            : '';

          screen.writeStr(6, curY, isJobSel ? '▶ ' : '  ', isJobSel ? color('selection') : null);
          screen.writeStr(8, curY, ji.ch, isJobSel ? color('selection') : ji.style);
          screen.writeStr(10, curY, jobName, isJobSel ? color('selection') : (color('repoName') || { fg: 'white' }));
          // Workflow/job names are user content — measure cells so CJK/emoji
          // names can't slide under the duration.
          if (jobDur && 10 + displayWidth(jobName) + 2 < W) {
            screen.writeStr(10 + displayWidth(jobName) + 2, curY, jobDur, isJobSel ? color('selection') : { dim: true });
          }
          rowMap.push({ y: curY, runIdx: idx, jobIdx: ji2 });
          curY++;
          drawn++;

          const steps = appState.actionsJobSteps[job.id] || [];
          for (const step of steps) {
            if (curY >= y + maxVisible) break;
            const si = stepStatusIcon(step);
            const stepName = truncate(step.name || '?', W - 14);
            screen.writeStr(10, curY, '  ');
            screen.writeStr(12, curY, si.ch, si.style);
            screen.writeStr(14, curY, stepName, color('dim'));
            rowMap.push({ y: curY, runIdx: idx, jobIdx: ji2 });
            curY++;
            drawn++;
          }
        }
      }
    }
  }
  appState._actionsRowMap = rowMap;

  scrollIndicators(screen, y, y + maxVisible - 1, appState.actionsScroll, runs.length);

  const hintY = y + Math.min(maxVisible, drawn);
  if (hintY < y + h - 1) {
    screen.hline(hintY, '─', { dim: true });
      const moreHint = appState.actionsRunsHasMore ? '   [Space] Load more' : '';
    const hint = appState.actionsExpandedRun
      ? '[Enter] Close   [J/K] job   [l] log   [o] Browser   [r] Re-run   [x] Cancel   [Esc] Back' + moreHint
      : '[Enter] Expand jobs   [o] Open in browser   [r] Re-run   [x] Cancel   [Esc] Back' + moreHint;
    screen.writeStr(2, hintY + 1, hint, { dim: true });
  }
}

registerInputHandler('actions-filter', (value) => {
  appState.actionsFilter = (value || '').trim();
  appState.actionsRepoScroll = 0;
  appState.actionsRepoSelected = 0;
  appState.actionsExpandedRun = null;
  appState.actionsJobSelected = 0;
  showMessage(appState.actionsFilter
    ? 'Filtering repos: "' + appState.actionsFilter + '"'
    : 'Repo filter cleared', 'info');
  render();
});

export function resolveActionsRow(sy) {
  const map = appState._actionsRowMap;
  if (!Array.isArray(map)) return null;
  return map.find(r => r.y === sy) || null;
}

export const keys = {
  '/': () => { if (!appState.actionsLog) startInput('Filter repos: ', 'actions-filter'); },
  'F': () => { if (!appState.actionsLog) { appState.actionsView = 'failures'; appState.actionsSelected = 0; appState.actionsScroll = 0; loadFailureQueue(); } },
  'd': () => { if (appState.actionsView === 'runs' && !appState.actionsLog) startWorkflowDispatch(); },
  'J': () => { if (appState.actionsView === 'runs') jobCursorDown(); },
  ']': () => { if (appState.actionsView === 'runs') jobCursorDown(); },
  'K': () => { if (appState.actionsView === 'runs') jobCursorUp(); },
  '[': () => { if (appState.actionsView === 'runs') jobCursorUp(); },
  'l': () => {
    if (appState.actionsView === 'runs' && !appState.actionsLog) openSelectedJobLog();
  },
  't': () => {
    if (appState.actionsLog) return;
    if (appState.actionsView === 'runs' || appState.actionsView === 'failures') {
      appState.actionsView = 'repos';
      appState.actionsExpandedRun = null;
      appState.actionsJobSelected = 0;
      render();
    }
  },
  'o': () => {
    if (appState.actionsView === 'runs' && !appState.actionsLog) openSelectedRun();
  },
  'R': () => {
    if (appState.actionsLog) return;
    if (appState.actionsView === 'runs') rerunSelected();
    else if (appState.actionsView === 'repos') rescanWorkflowRepos();
  },
  'x': () => { if (appState.actionsLog) return; if (appState.actionsView === 'runs') cancelSelected(); else if (appState.actionsView === 'repos' && appState.actionsScanning) cancelWorkflowScan(); },
};

export function up() {
  if (appState.actionsLog) {
    setLogScroll((appState.actionsLogScroll || 0) - 1);
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
    const prev = appState.actionsSelected;
    appState.actionsSelected = Math.max(0, appState.actionsSelected - 1);
    if (appState.actionsSelected !== prev) appState.actionsJobSelected = 0;
    const maxVisible = appState._actionsListBounds?.maxRows || Math.max(1, 10);
    appState.actionsScroll = followScroll(appState.actionsSelected, appState.actionsScroll, maxVisible);
    // Don't auto-collapse expanded run on arrow navigation
    render();
  }
}

export function down() {
  if (appState.actionsLog) {
    setLogScroll((appState.actionsLogScroll || 0) + 1);
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
    const prev = appState.actionsSelected;
    appState.actionsSelected = Math.min(runs.length - 1, appState.actionsSelected + 1);
    if (appState.actionsSelected !== prev) appState.actionsJobSelected = 0;
    appState.actionsScroll = followScroll(appState.actionsSelected, appState.actionsScroll, maxVisible);
    // Don't auto-collapse expanded run on arrow navigation
    render();
  }
}

export function bottom(screen) {
  if (appState.actionsLog) {
    setLogScroll(getLogMaxScroll());
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
  if (appState.actionsLog) return;
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
  if (appState.actionsLog) return;
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
