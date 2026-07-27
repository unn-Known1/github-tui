// README sub-pane — load and render repo README markdown.

import { appState, render, startAsync, isStale, showMessage } from '../state.mjs';
import { getReadme } from '../github.mjs';
import { sectionHeader, wrapTextWithMap } from '../utils.mjs';
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
  const innerW = Math.max(20, W - 6);
  sectionHeader(screen, 2, y, '◆ README');
  screen.hline(y + 1, '─', { dim: true });
  const text = appState._readmeText || '(no README loaded)';
  // Wrap so long horizontal lines reflow into the pane width instead of
  // being hidden past the right edge.
  const { lines: visualLines, visualToLogical } = wrapTextWithMap(text, innerW);
  const logicalLines = text.split(/\r?\n/);
  const start = appState.detailsScroll;
  const rows = Math.max(1, maxH - 4);
  for (let i = 0; i < rows && start + i < visualLines.length; i++) {
    const vLine = visualLines[start + i];
    const logicalIdx = visualToLogical[start + i];
    const sourceLn = logicalLines[logicalIdx] || '';
    const row = y + 2 + i;
    // Apply regex-based highlighting using the SOURCE line. Continuations
    // inherit the source-line style so a wrapped heading stays bold and a
    // wrapped list item stays cyan.
    if (/^#{1,6}\s/.test(sourceLn)) {
      // Strip the leading `#` only on the FIRST visual row of the source
      // line — continuations should not show extra `#` prefixes.
      const isFirst = (start + i) === 0
        || visualToLogical[start + i - 1] !== logicalIdx;
      const disp = isFirst ? vLine.replace(/^#+\s*/, '') : vLine;
      screen.writeStr(2, row, disp, { bold: true });
    } else if (/^\s*[-*+]\s/.test(sourceLn)) {
      screen.writeStr(2, row, vLine, { fg: 'cyan' });
    } else if (/^\s*```/.test(sourceLn)) {
      screen.writeStr(2, row, vLine, { dim: true });
    } else if (/^\s*>/.test(sourceLn)) {
      screen.writeStr(2, row, vLine, { dim: true });
    } else if (/^#{1,6}\s*[-=]+$/.test(sourceLn)) {
      continue;
    } else {
      screen.writeStr(2, row, vLine);
    }
  }
  scrollIndicators(screen, y + 2, y + 1 + rows, start, visualLines.length);
  if (visualLines.length > rows) {
    screen.writeStr(2, y + 2 + rows,
      'Lines ' + (start + 1) + '-' + Math.min(start + rows, visualLines.length) +
      ' of ' + visualLines.length + '   [↑↓] scroll   [O] back', { dim: true });
  }
}
