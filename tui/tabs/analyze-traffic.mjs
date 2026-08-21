// Traffic sub-pane — load and render repo traffic views, clones, paths, referrers.

import { appState, render, startAsync, isStale, showMessage, beginLoading, finishLoading } from '../state.mjs';
import {
  getRepoTrafficViews, getRepoTrafficClones,
  getRepoTrafficPopularPaths, getRepoTrafficPopularReferrers,
} from '../github.mjs';
import { truncate, sectionHeader } from '../utils.mjs';
import { loadingIndicator } from '../render.mjs';

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
    const safe = (p) => p.catch(() => null);
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
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to load traffic: ' + e.message, 'error');
  }
  finishLoading(gen);
  if (!isStale(gen)) render();
}

export function renderTrafficPane(screen, y, maxH) {
  const W = screen.width;
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

  if (!views || (views.count === 0 && (!clones || clones.count === 0))) {
    screen.writeStr(2, y++, 'No traffic data yet — stats appear once a repo has visitors', { dim: true });
    screen.writeStr(2, y++, 'Press [T] to retry', { fg: 'cyan' });
    return;
  }

  // Views summary
  if (views) {
    screen.writeStr(2, y, 'Views:', { fg: 'cyan', bold: true });
    screen.writeStr(10, y, String(views.count || 0), { fg: 'white' });
    screen.writeStr(20, y, 'unique:', { dim: true });
    screen.writeStr(28, y, String(views.uniques || 0), { fg: 'white' });
    y++;
  }

  // Clones summary
  if (clones) {
    screen.writeStr(2, y, 'Clones:', { fg: 'cyan', bold: true });
    screen.writeStr(10, y, String(clones.count || 0), { fg: 'white' });
    screen.writeStr(20, y, 'unique:', { dim: true });
    screen.writeStr(28, y, String(clones.uniques || 0), { fg: 'white' });
    y++;
  }

  y++;

  // Popular paths
  const paths = appState.repoTrafficPopularPaths;
  if (paths.length > 0) {
    sectionHeader(screen, 2, y, 'Popular Paths');
    y++;
    const y0 = y;
    for (const p of paths.slice(0, 5)) {
      if (y >= y0 + maxH - 1) break;
      screen.writeStr(4, y, truncate(p.path || '', 30));
      screen.writeStr(36, y, String(p.count || 0), { dim: true });
      screen.writeStr(44, y, String(p.uniques || 0) + ' unique', { dim: true });
      y++;
    }
    y++;
  }

  // Popular referrers
  const referrers = appState.repoTrafficPopularReferrers;
  if (referrers.length > 0) {
    sectionHeader(screen, 2, y, 'Popular Referrers');
    y++;
    const y1 = y;
    for (const r of referrers.slice(0, 5)) {
      if (y >= y1 + maxH - 1) break;
      screen.writeStr(4, y, truncate(r.referrer || '', 30));
      screen.writeStr(36, y, String(r.count || 0), { dim: true });
      screen.writeStr(44, y, String(r.uniques || 0) + ' unique', { dim: true });
      y++;
    }
  }
}
