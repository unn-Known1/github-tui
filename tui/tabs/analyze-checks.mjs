// Checks sub-pane — load and render CI check runs for the default branch HEAD.
//
// NOTE: only check-*runs* are fetched. Check-*suites* were previously fetched
// too but never rendered anywhere (header counts, scroll math, health score
// all use runs), so the second request was pure quota waste — dropped.

import { appState, render, startAsync, isStale, showMessage, beginLoading, finishLoading } from '../state.mjs';
import { getRepoCheckRuns } from '../github.mjs';
import { truncate, sectionHeader } from '../utils.mjs';
import { loadingIndicator, scrollIndicators } from '../render.mjs';

// Pure helpers — exported for tests.
export function checkRunIcon(run) {
  if (!run || run.status !== 'completed') return '⏳';
  switch (run.conclusion) {
    case 'success': return '✅';
    case 'failure': return '❌';
    case 'cancelled': return '⚠️';
    case 'neutral':
    case 'skipped': return '➖';
    case 'timed_out': return '⏱️';
    case 'action_required': return '❗';
    case 'stale': return '📦';
    default: return '❓';
  }
}

export function summarizeChecks(runs) {
  const list = Array.isArray(runs) ? runs : [];
  const completed = list.filter(r => r.status === 'completed');
  return {
    success: completed.filter(r => r.conclusion === 'success').length,
    failed: completed.filter(r => r.conclusion === 'failure').length,
    pending: list.filter(r => r.status !== 'completed').length,
  };
}

export async function loadChecks() {
  const repo = appState.repoDetails;
  if (!repo) return;
  // Empty repo (no default branch → no commits) has no checks to query —
  // the ref endpoint would 404. Show the empty state instead of an error.
  if (!repo.default_branch) {
    appState.repoCheckRuns = [];
    appState.repoCheckRunsTotal = 0;
    appState.repoCheckSuites = [];
    render();
    return;
  }
  const gen = startAsync('analyze-checks');
  beginLoading(gen);
  appState.repoCheckRuns = [];
  appState.repoCheckRunsTotal = 0;
  appState.repoCheckSuites = [];
  render();
  try {
    const [owner, name] = repo.full_name.split('/');
    const runs = await getRepoCheckRuns(appState.token, owner, name, repo.default_branch, gen.signal);
    if (isStale(gen)) { finishLoading(gen); return; }
    appState.repoCheckRuns = (runs && runs.check_runs) ? runs.check_runs : [];
    appState.repoCheckRunsTotal = (runs && Number.isFinite(runs.total_count))
      ? runs.total_count
      : appState.repoCheckRuns.length;
  } catch (e) {
    if (isStale(gen)) { finishLoading(gen); return; }
    // 404/422 = ref has no commit or no checks (empty repo, orphan branch):
    // friendly empty state, not an error toast. Other failures (403, 500,
    // network) still surface.
    const status = e && e.status;
    if (status === 404 || status === 422) {
      appState.repoCheckRuns = [];
      appState.repoCheckRunsTotal = 0;
    } else {
      if (!isStale(gen)) showMessage('Failed to load checks: ' + e.message, 'error');
    }
  }
  finishLoading(gen);
  if (!isStale(gen)) render();
}

export function renderChecksPane(screen, y, maxH) {
  const W = screen.width;
  const y0 = y;
  const runs = appState.repoCheckRuns;
  const total = appState.repoCheckRunsTotal || runs.length;
  const countLabel = total > runs.length
    ? runs.length + ' of ' + total + ' runs'
    : runs.length + ' runs';
  sectionHeader(screen, 2, y, '✅ CHECKS/CI (' + countLabel + ')');
  y++;

  // Only spinner while no data yet — the global loading flag covers every
  // tab (background repo pagination, auto-refresh), so gating on it alone
  // would blank populated rows whenever anything else loads.
  if (runs.length === 0) {
    if (appState.loading) {
      loadingIndicator(screen, 2, y, 'loading checks');
      return;
    }
    screen.writeStr(2, y++, 'No checks — push commits to see CI status here', { dim: true });
    return;
  }

  // Summary stats
  const { success, failed, pending } = summarizeChecks(runs);

  {
    const summary = '✅ ' + success + ' passed   ❌ ' + failed + ' failed   ⏳ ' + pending + ' pending';
    screen.writeStr(2, y, summary, { dim: true });
    y++;
    y++;
  }

  // List check runs
  const yR = y;
  const start = appState.detailsScroll || 0;
  const rows = Math.max(1, y0 + maxH - yR - 2);
  for (let i = 0; i < rows && start + i < runs.length; i++) {
    const run = runs[start + i];
    if (y >= yR + rows) break;
    const icon = checkRunIcon(run);
    const name = truncate(run.name || '?', 30);
    const status = run.status === 'completed' ? (run.conclusion || 'completed') : run.status;
    screen.writeStr(2, y, icon);
    screen.writeStr(5, y, name, { fg: 'white' });
    if (37 + status.length < W) {
      screen.writeStr(37, y, status, { dim: true });
    }
    y++;
  }
  scrollIndicators(screen, yR, yR + rows - 1, start, runs.length);
  if (runs.length > rows) {
    screen.writeStr(2, yR + rows,
      (start + 1) + '-' + Math.min(start + rows, runs.length) + ' of ' + runs.length +
      '   [↑↓] scroll', { dim: true });
  }
}
