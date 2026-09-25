// Traffic sub-pane — load and render repo traffic views, clones, paths, referrers.

import { appState, render, startAsync, isStale, showMessage, beginLoading, finishLoading } from '../state.mjs';
import {
  getRepoTrafficViews, getRepoTrafficClones,
  getRepoTrafficPopularPaths, getRepoTrafficPopularReferrers,
} from '../github.mjs';
import { truncate, sectionHeader } from '../utils.mjs';
import { loadingIndicator, scrollIndicators } from '../render.mjs';
import { isAuthError, handleAuthFailure, showError } from '../error-recovery.mjs';

export async function loadTraffic() {
  const repo = appState.repoDetails;
  if (!repo) return;
  const gen = startAsync('analyze-traffic');
  beginLoading(gen);
  appState.repoTraffic = null;
  appState.repoTrafficClones = null;
  appState.repoTrafficPopularPaths = [];
  appState.repoTrafficPopularReferrers = [];
  render();
  try {
    const [owner, name] = repo.full_name.split('/');
    const safe = (p) => p.catch((e) => { loadErrors.push(e); return null; });
    const loadErrors = [];
    const [views, clones, paths, referrers] = await Promise.all([
      safe(getRepoTrafficViews(appState.token, owner, name, gen.signal)),
      safe(getRepoTrafficClones(appState.token, owner, name, gen.signal)),
      safe(getRepoTrafficPopularPaths(appState.token, owner, name, gen.signal)),
      safe(getRepoTrafficPopularReferrers(appState.token, owner, name, gen.signal)),
    ]);
    if (isStale(gen)) { finishLoading(gen); return; }
    appState.repoTraffic = views;
    appState.repoTrafficClones = clones;
    appState.repoTrafficPopularPaths = Array.isArray(paths) ? paths : [];
    appState.repoTrafficPopularReferrers = Array.isArray(referrers) ? referrers : [];
    // Surface total failure: safe() previously converted every rejection to
    // null and the user saw a silent empty pane for 401/403/rate-limit.
    // Distinguish auth (unified wipe) from permission-denied vs empty.
    if (loadErrors.length === 4) {
      const first = loadErrors[0];
      if (isAuthError(first)) { finishLoading(gen); await handleAuthFailure(first, loadTraffic); return; }
      const denied = loadErrors.some(e => e && (e.status === 403 || e.status === 404));
      showError((first && first.message) || 'all endpoints failed', denied ? 'Traffic (access denied — requires push access)' : 'Traffic', { retry: loadTraffic });
    } else if (loadErrors.length > 0) {
      const auth = loadErrors.find(isAuthError);
      if (auth) { finishLoading(gen); await handleAuthFailure(auth, loadTraffic); return; }
    }
  } catch (e) {
    if (!isStale(gen)) {
      if (isAuthError(e)) { finishLoading(gen); await handleAuthFailure(e, loadTraffic); return; }
      showError(e.message, 'Traffic', { retry: loadTraffic });
    }
  }
  finishLoading(gen);
  if (!isStale(gen)) render();
}

export function renderTrafficPane(screen, y, maxH) {
  const W = screen.width;
  const y0 = y;
  const start = appState.detailsScroll || 0;
  const views = appState.repoTraffic;
  const clones = appState.repoTrafficClones;
  sectionHeader(screen, 2, y, '📊 TRAFFIC');
  y++;

  if (!views && !clones) {
    if (appState.loading) {
      loadingIndicator(screen, 2, y, 'loading traffic');
      y++;
      return;
    }
    screen.writeStr(2, y++, 'No traffic data — may require push access', { dim: true });
    return;
  }

  // Treat the two endpoints independently: the old short-circuit
  // (!views || (views.count === 0 && ...)) bailed out when views was null
  // even when valid CLONES data was present, hiding it entirely.
  const viewsEmpty = !views || views.count === 0;
  const clonesEmpty = !clones || clones.count === 0;
  if (viewsEmpty && clonesEmpty) {
    screen.writeStr(2, y++, 'No traffic data yet — stats appear once a repo has visitors', { dim: true });
    screen.writeStr(2, y++, 'Press [T] to retry', { fg: 'cyan' });
    return;
  }

  // Views + clones summaries (shared layout — was two near-identical blocks).
  y = writeSummaryRow(screen, y, 'Views:', views);
  y = writeSummaryRow(screen, y, 'Clones:', clones);

  y++;

  // Popular paths — single-list scroll model over [paths, referrers].
  // Clamp `start` against the combined total first: a stale detailsScroll
  // larger than both arrays previously produced an oversize/negative refOff.
  const paths = appState.repoTrafficPopularPaths || [];
  const referrers = appState.repoTrafficPopularReferrers || [];
  const total = paths.length + referrers.length;
  const clampedStart = Math.max(0, Math.min(start, Math.max(0, total - 1)));
  const pathOff = Math.min(clampedStart, paths.length);
  const refOff = clampedStart >= paths.length ? Math.min(clampedStart - paths.length, referrers.length) : 0;
  if (paths.length > 0) {
    y = writePopularSection(screen, y, maxH, 'Popular Paths', paths.slice(pathOff, pathOff + 5), (p) => p.path);
  }

  // Popular referrers
  if (referrers.length > 0) {
    y = writePopularSection(screen, y, maxH, 'Popular Referrers', referrers.slice(refOff, refOff + 5), (r) => r.referrer);
  }
  scrollIndicators(screen, y0, y0 + maxH - 1, start, paths.length + referrers.length);
}

// Shared summary row: `data` is { count, uniques } or null (skipped).
function writeSummaryRow(screen, y, label, data) {
  if (!data) return y;
  screen.writeStr(2, y, label, { fg: 'cyan', bold: true });
  screen.writeStr(10, y, String(data.count || 0), { fg: 'white' });
  screen.writeStr(20, y, 'unique:', { dim: true });
  screen.writeStr(28, y, String(data.uniques || 0), { fg: 'white' });
  return y + 1;
}

// Shared popular-list section: header + up to N rows of
// `label | count | N unique`. Returns the next y.
function writePopularSection(screen, y, maxH, title, rows, labelOf) {
  sectionHeader(screen, 2, y, title);
  y++;
  const y1 = y;
  for (const r of rows) {
    if (y >= y1 + maxH - 1) break;
    screen.writeStr(4, y, truncate(labelOf(r) || '', 30));
    screen.writeStr(36, y, String(r.count || 0), { dim: true });
    screen.writeStr(44, y, String(r.uniques || 0) + ' unique', { dim: true });
    y++;
  }
  return y + 1;
}
