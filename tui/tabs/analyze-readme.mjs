// README sub-pane — load and render repo README markdown.

import { appState, render, startAsync, isStale, showMessage } from '../state.mjs';
import { getReadme } from '../github.mjs';
import { sectionHeader, wrapTextWithMap } from '../utils.mjs';
import { scrollIndicators } from '../render.mjs';
import { color } from '../theme.mjs';

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
    // Reset text selection when loading new README.
    appState.textSelectionMode = 'none';
    appState.textSelectStart = null;
    appState.textSelectEnd = null;
  } catch (e) {
    if (!isStale(gen, 'analyze-readme')) showMessage(e.message || 'README unavailable', 'warning');
  }
  appState.loading = false;
  if (!isStale(gen, 'analyze-readme')) render();
}

// Clamp visual-row/col into the visible README area. Returns null if coords
// fall outside the pane's content area.
export function clampReadmeSel(row, col, screen) {
  if (!screen) return null;
  const W = screen.width;
  const innerW = Math.max(20, W - 6);
  // Pane content starts at screen row HEADER_HEIGHT+5 (tab-strip + header), col 2.
  // The exact Y offset matches renderReadmePane below.
  const paneTopY = 9; // HEADER_HEIGHT + 5 (pane tabs row)
  const paneLeftX = 2;
  if (row < paneTopY || row >= paneTopY + screen.height - 2) return null;
  if (col < paneLeftX || col >= paneLeftX + innerW) return null;
  return { row, col };
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

  // Determine selection state for this pane.
  const inSel = appState.textSelectionMode === 'readme';
  let selStart = inSel ? appState.textSelectStart : null;
  let selEnd = inSel ? appState.textSelectEnd : null;
  // Normalise so (sr,sc) <= (er,ec) for easy range checks.
  if (selStart && selEnd) {
    if (selEnd.row < selStart.row || (selEnd.row === selStart.row && selEnd.col < selStart.col)) {
      [selStart, selEnd] = [selEnd, selStart];
    }
  }

  for (let i = 0; i < rows && start + i < visualLines.length; i++) {
    const vLine = visualLines[start + i];
    const logicalIdx = visualToLogical[start + i];
    const sourceLn = logicalLines[logicalIdx] || '';
    const row = y + 2 + i;
    // Apply regex-based highlighting using the SOURCE line. Continuations
    // inherit the source-line style so a wrapped heading stays bold and a
    // wrapped list item stays cyan.
    const isHeading = /^#{1,6}\s/.test(sourceLn);
    const isList = /^\s*[-*+]\s/.test(sourceLn);
    const isCodeFence = /^\s*```/.test(sourceLn);
    const isQuote = /^\s*>/.test(sourceLn);
    const isHrule = /^#{1,6}\s*[-=]+$/.test(sourceLn);

    if (isHrule) continue;

    if (isHeading) {
      const isFirst = (start + i) === 0
        || visualToLogical[start + i - 1] !== logicalIdx;
      const disp = isFirst ? vLine.replace(/^#+\s*/, '') : vLine;
      screen.writeStr(2, row, disp, { bold: true });
    } else if (isList) {
      screen.writeStr(2, row, vLine, { fg: 'cyan' });
    } else if (isCodeFence) {
      screen.writeStr(2, row, vLine, { dim: true });
    } else if (isQuote) {
      screen.writeStr(2, row, vLine, { dim: true });
    } else {
      screen.writeStr(2, row, vLine);
    }
  }

  // Second pass: overlay selection background via styleBuf so it composites
  // correctly over whatever foreground style was written above. Column-aware
  // so partial-row selections don't bleed into unselected cells.
  if (selStart && selEnd) {
    for (let i = 0; i < rows && start + i < visualLines.length; i++) {
      const visRow = start + i;
      const sourceLn = logicalLines[visualToLogical[start + i]] || '';
      // Skip hrule visual rows — they contain no selectable text.
      if (/^#{1,6}\s*[-=]+$/.test(sourceLn)) continue;
      if (visRow < selStart.row || visRow > selEnd.row) continue;
      const row = y + 2 + i;
      const lineStartCol = Math.max(0,
        visRow === selStart.row ? selStart.col : 0);
      const lineEndCol = Math.min(innerW,
        visRow === selEnd.row ? selEnd.col : innerW);
      if (lineEndCol <= lineStartCol) continue;
      for (let x = lineStartCol; x < lineEndCol; x++) {
        screen.styleBuf[row][x + 2] = color('selection');
      }
    }
  }

  scrollIndicators(screen, y + 2, y + 1 + rows, start, visualLines.length);

  const hintCols = [];
  hintCols.push('[↑↓] scroll');
  hintCols.push('[O] back');
  if (inSel) {
    hintCols.push('[Esc] clear selection');
    hintCols.push('[Ctrl+A] select all → copy');
  } else {
    hintCols.push('[Ctrl+A] select all → copy');
  }
  const hintText = hintCols.join('   ');

  if (visualLines.length > rows) {
    screen.writeStr(2, y + 2 + rows,
      'Lines ' + (start + 1) + '-' + Math.min(start + rows, visualLines.length) +
      ' of ' + visualLines.length + '   ' + hintText, { dim: true });
  } else {
    screen.writeStr(2, y + 2 + rows, hintText, { dim: true });
  }
}
