// README sub-pane — load and render repo README markdown.

import { appState, render, startAsync, isStale, showMessage } from '../state.mjs';
import { getReadme } from '../github.mjs';
import { truncate, sectionHeader } from '../utils.mjs';
import { scrollIndicators } from '../render.mjs';

export async function viewReadme() {
  const repo = appState.repoDetails;
  if (!repo) return;
  const gen = startAsync('analyze-readme');
  appState.loading = true;
  render();
  try {
    const [owner, name] = repo.full_name.split('/');
    const md = await getReadme(appState.token, owner, name, gen.signal);
    if (isStale(gen, 'analyze-readme')) { appState.loading = false; return; }
    appState.detailsPane = 'readme';
    appState.detailsScroll = 0;
    appState._readmeText = md || '(empty README)';
  } catch (e) {
    if (!isStale(gen, 'analyze-readme')) showMessage(e.message || 'README unavailable', 'warning');
  }
  appState.loading = false;
  if (!isStale(gen, 'analyze-readme')) render();
}

export function renderReadmePane(screen, y, maxH) {
  const W = screen.width;
  sectionHeader(screen, 2, y, '◆ README');
  screen.hline(y + 1, '─', { dim: true });
  const text = appState._readmeText || '(no README loaded)';
  const lines = text.split(/\r?\n/);
  const start = appState.detailsScroll;
  const rows = Math.max(1, maxH - 4);
  for (let i = 0; i < rows && start + i < lines.length; i++) {
    const ln = lines[start + i];
    const row = y + 2 + i;
    if (/^#{1,6}\s/.test(ln)) {
      screen.writeStr(2, row, ln.replace(/^#+\s*/, ''), { bold: true });
    } else if (/^\s*[-*+]\s/.test(ln)) {
      screen.writeStr(2, row, truncate(ln, W - 6), { fg: 'cyan' });
    } else if (/^\s*```/.test(ln)) {
      screen.writeStr(2, row, truncate(ln, W - 6), { dim: true });
    } else if (/^\s*>/.test(ln)) {
      screen.writeStr(2, row, truncate(ln, W - 6), { dim: true });
    } else if (/^#{1,6}\s*[-=]+$/.test(ln)) {
      continue;
    } else {
      screen.writeStr(2, row, truncate(ln, W - 6));
    }
  }
  scrollIndicators(screen, y + 2, y + 1 + rows, start, lines.length);
  if (lines.length > rows) {
    screen.writeStr(2, y + 2 + rows,
      'Lines ' + (start + 1) + '-' + Math.min(start + rows, lines.length) +
      ' of ' + lines.length + '   [↑↓] scroll   [O] back', { dim: true });
  }
}
