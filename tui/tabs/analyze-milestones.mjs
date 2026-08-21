// Milestones sub-pane — load and render repo milestones.

import { appState, render, startAsync, isStale, showMessage, beginLoading, finishLoading } from '../state.mjs';
import { getRepoMilestones } from '../github.mjs';
import { truncate, sectionHeader } from '../utils.mjs';
import { loadingIndicator } from '../render.mjs';

export async function loadMilestones() {
  const repo = appState.repoDetails;
  if (!repo) return;
  const gen = startAsync('analyze-milestones');
  beginLoading(gen);
  appState.repoMilestones = [];
  render();
  try {
    const [owner, name] = repo.full_name.split('/');
    const milestones = await getRepoMilestones(appState.token, owner, name, 1, 20, gen.signal);
    if (isStale(gen)) { finishLoading(gen); return; }
    appState.repoMilestones = Array.isArray(milestones) ? milestones : [];
    appState.repoMilestonesPage = 1;
    appState.repoMilestonesHasMore = Array.isArray(milestones) && milestones.length >= 20;
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to load milestones: ' + e.message, 'error');
  }
  finishLoading(gen);
  if (!isStale(gen)) render();
}

export async function loadMoreMilestones() {
  const repo = appState.repoDetails;
  if (!repo || !appState.repoMilestonesHasMore || appState.loading) return;
  const [owner, name] = repo.full_name.split('/');
  const page = appState.repoMilestonesPage + 1;
  const gen = startAsync('analyze-milestones-more');
  beginLoading(gen);
  render();
  try {
    const more = await getRepoMilestones(appState.token, owner, name, page, 20, gen.signal);
    if (isStale(gen)) return;
    const items = Array.isArray(more) ? more : [];
    appState.repoMilestones = [...appState.repoMilestones, ...items];
    appState.repoMilestonesPage = page;
    appState.repoMilestonesHasMore = items.length >= 20;
    showMessage(items.length ? 'Loaded more milestones' : 'All milestones loaded', 'info');
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Failed to load more milestones', 'error');
  } finally {
    finishLoading(gen);
    if (!isStale(gen)) render();
  }
}

export function renderMilestonesPane(screen, y, maxH) {
  const W = screen.width;
  const milestones = appState.repoMilestones;
  sectionHeader(screen, 2, y, '📋 MILESTONES (' + milestones.length + ')');
  y++;

  if (appState.loading) {
    loadingIndicator(screen, 2, y, 'loading milestones');
    return;
  }
  if (milestones.length === 0) {
    screen.writeStr(2, y++, 'No milestones — create one on GitHub to track progress', { dim: true });
    return;
  }

  const yM = y;
  if (appState.repoMilestonesHasMore) screen.writeStr(2, y++, '[Space] load more milestones', { dim: true });
  for (const m of milestones) {
    if (y >= yM + maxH - 1) break;
    const title = truncate(m.title || '', 30);
    const state = m.state === 'open' ? '○' : '●';
    const stateStyle = m.state === 'open' ? { fg: 'green' } : { dim: true };
    const due = m.due_on ? new Date(m.due_on).toISOString().split('T')[0] : 'no due date';
    const issues = (m.open_issues || 0) + '/' + ((m.open_issues || 0) + (m.closed_issues || 0));

    screen.writeStr(2, y, state, stateStyle);
    screen.writeStr(4, y, title, { fg: 'white' });
    screen.writeStr(36, y, due, { dim: true });
    screen.writeStr(52, y, issues + ' issues', { dim: true });
    y++;
  }
}
