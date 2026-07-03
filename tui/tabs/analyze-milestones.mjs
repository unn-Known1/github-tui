// Milestones sub-pane — load and render repo milestones.

import { appState, render, startAsync, isStale, showMessage } from '../state.mjs';
import { getRepoMilestones } from '../github.mjs';
import { truncate, sectionHeader } from '../utils.mjs';

export async function loadMilestones() {
  const repo = appState.repoDetails;
  if (!repo) return;
  const gen = startAsync('analyze-milestones');
  appState.loading = true;
  appState.repoMilestones = [];
  render();
  try {
    const [owner, name] = repo.full_name.split('/');
    const milestones = await getRepoMilestones(appState.token, owner, name, 1, 20, gen.signal);
    if (isStale(gen)) { appState.loading = false; return; }
    appState.repoMilestones = Array.isArray(milestones) ? milestones : [];
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to load milestones: ' + e.message, 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

export function renderMilestonesPane(screen, y, maxH) {
  const W = screen.width;
  const milestones = appState.repoMilestones;
  sectionHeader(screen, 2, y, '📋 MILESTONES (' + milestones.length + ')');
  y++;

  if (milestones.length === 0) {
    screen.writeStr(2, y++, 'No milestones — create one on GitHub to track progress', { dim: true });
    return;
  }

  const yM = y;
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
