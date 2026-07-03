// Labels sub-pane — load and render repo labels with color mapping.

import { appState, render, startAsync, isStale, showMessage } from '../state.mjs';
import { getRepoLabels } from '../github.mjs';
import { truncate, sectionHeader } from '../utils.mjs';

export async function loadLabels() {
  const repo = appState.repoDetails;
  if (!repo) return;
  const gen = startAsync('analyze-labels');
  appState.loading = true;
  appState.repoLabels = [];
  render();
  try {
    const [owner, name] = repo.full_name.split('/');
    const labels = await getRepoLabels(appState.token, owner, name, 1, 100, gen.signal);
    if (isStale(gen)) { appState.loading = false; return; }
    appState.repoLabels = Array.isArray(labels) ? labels : [];
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to load labels: ' + e.message, 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

export function renderLabelsPane(screen, y, maxH) {
  const W = screen.width;
  const labels = appState.repoLabels;
  sectionHeader(screen, 2, y, '🏷️  LABELS (' + labels.length + ')');
  y++;

  if (labels.length === 0) {
    screen.writeStr(2, y++, 'No labels — manage labels on GitHub to categorize issues', { dim: true });
    return;
  }

  const yL = y;
  for (const l of labels) {
    if (y >= yL + maxH - 1) break;
    const name = truncate(l.name || '', 25);
    const desc = truncate(l.description || '', 35);
    const colorHex = l.color || 'ededed';
    screen.writeStr(2, y, '██', { fg: mapLabelColor(colorHex) });
    screen.writeStr(5, y, name, { fg: 'white' });
    if (desc && 32 + desc.length < W) {
      screen.writeStr(32, y, desc, { dim: true });
    }
    y++;
  }
}

function mapLabelColor(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  if (r > 180 && g < 100 && b < 100) return 'red';
  if (r < 100 && g > 180 && b < 100) return 'green';
  if (r < 100 && g < 100 && b > 180) return 'blue';
  if (r > 180 && g > 180 && b < 100) return 'yellow';
  if (r > 180 && g < 100 && b > 180) return 'magenta';
  if (r < 100 && g > 180 && b > 180) return 'cyan';
  if (r > 200 && g > 200 && b > 200) return 'white';
  if (r < 80 && g < 80 && b < 80) return 'darkGray';
  return 'white';
}
