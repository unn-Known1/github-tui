// Checks sub-pane — load and render CI check runs and suites.

import { appState, render, startAsync, isStale, showMessage, beginLoading, finishLoading } from '../state.mjs';
import { getRepoCheckRuns, getRepoCheckSuites } from '../github.mjs';
import { truncate, sectionHeader } from '../utils.mjs';
import { loadingIndicator } from '../render.mjs';

export async function loadChecks() {
  const repo = appState.repoDetails;
  if (!repo) return;
  const gen = startAsync('analyze-checks');
  beginLoading(gen);
  appState.repoCheckRuns = [];
  appState.repoCheckSuites = [];
  render();
  try {
    const [owner, name] = repo.full_name.split('/');
    const [runs, suites] = await Promise.all([
      getRepoCheckRuns(appState.token, owner, name, repo.default_branch, gen.signal),
      getRepoCheckSuites(appState.token, owner, name, repo.default_branch, gen.signal),
    ]);
    if (isStale(gen)) { finishLoading(gen); return; }
    appState.repoCheckRuns = (runs && runs.check_runs) ? runs.check_runs : [];
    appState.repoCheckSuites = (suites && suites.check_suites) ? suites.check_suites : [];
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to load checks: ' + e.message, 'error');
  }
  finishLoading(gen);
  if (!isStale(gen)) render();
}

export function renderChecksPane(screen, y, maxH) {
  const W = screen.width;
  const runs = appState.repoCheckRuns;
  const suites = appState.repoCheckSuites;
  sectionHeader(screen, 2, y, '✅ CHECKS/CI (' + runs.length + ' runs, ' + suites.length + ' suites)');
  y++;

  if (appState.loading) {
    loadingIndicator(screen, 2, y, 'loading checks');
    return;
  }
  if (runs.length === 0 && suites.length === 0) {
    screen.writeStr(2, y++, 'No checks — push commits to see CI status here', { dim: true });
    return;
  }

  // Summary stats
  const completed = runs.filter(r => r.status === 'completed');
  const success = completed.filter(r => r.conclusion === 'success');
  const failed = completed.filter(r => r.conclusion === 'failure');
  const pending = runs.filter(r => r.status !== 'completed');

  {
    const summary = '✅ ' + success.length + ' passed   ❌ ' + failed.length + ' failed   ⏳ ' + pending.length + ' pending';
    screen.writeStr(2, y, summary, { dim: true });
    y++;
    y++;
  }

  // List check runs
  const yR = y;
  for (const run of runs) {
    if (y >= yR + maxH - 1) break;
    const icon = run.status !== 'completed' ? '⏳'
      : run.conclusion === 'success' ? '✅'
      : run.conclusion === 'failure' ? '❌'
      : run.conclusion === 'cancelled' ? '⚠️'
      : '❓';
    const name = truncate(run.name || '?', 30);
    const status = run.status === 'completed' ? run.conclusion : run.status;
    screen.writeStr(2, y, icon);
    screen.writeStr(5, y, name, { fg: 'white' });
    if (37 + status.length < W) {
      screen.writeStr(37, y, status, { dim: true });
    }
    y++;
  }
}
