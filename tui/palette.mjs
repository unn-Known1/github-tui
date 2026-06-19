// Command palette — Ctrl-P / ':' to fuzzy-search every action.

import { appState, render, showMessage } from './state.mjs';
import { color } from './theme.mjs';
import { truncate } from './utils.mjs';

const actions = [];
const seen = new Set();

export function register(action) {
  if (!action || !action.id || seen.has(action.id)) return;
  seen.add(action.id);
  actions.push(action);
}

function score(query, label) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const s = label.toLowerCase();
  if (s.startsWith(q)) return 1000 - (s.length - q.length);
  let qi = 0, si = 0, hits = 0;
  while (qi < q.length && si < s.length) {
    if (q[qi] === s[si]) { hits++; qi++; }
    si++;
  }
  if (qi < q.length) return -1;
  return 500 - (s.length - hits);
}

export function filter(query) {
  return actions
    .map(a => ({ a, s: score(query, a.label) }))
    .filter(x => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 15)
    .map(x => x.a);
}

export function open() {
  appState.showPalette = true;
  appState.paletteQuery = '';
  appState.paletteCursor = 0;
  render();
}
export function close() {
  appState.showPalette = false;
  appState.paletteQuery = '';
  appState.paletteCursor = 0;
  render();
}
export function execSelected() {
  const matches = filter(appState.paletteQuery);
  const a = matches[appState.paletteCursor];
  if (!a) { close(); return; }
  close();
  try { Promise.resolve(a.run()).catch(e => showMessage(e.message, 'error')); }
  catch (e) { showMessage(e.message, 'error'); }
}

export function handleKey(key) {
  if (!appState.showPalette) return false;
  if (key === '\r' || key === '\n') { execSelected(); return true; }
  if (key === '\x1b') { close(); return true; }
  if (key === '\x7f' || key === '\b') {
    appState.paletteQuery = appState.paletteQuery.slice(0, -1);
    appState.paletteCursor = 0;
    render(); return true;
  }
  if (key === '\x1b[A' || key === 'k') {
    appState.paletteCursor = Math.max(0, appState.paletteCursor - 1);
    render(); return true;
  }
  if (key === '\x1b[B' || key === 'j') {
    const max = Math.max(0, filter(appState.paletteQuery).length - 1);
    appState.paletteCursor = Math.min(max, appState.paletteCursor + 1);
    render(); return true;
  }
  if (key.length === 1 && key.charCodeAt(0) >= 32) {
    appState.paletteQuery += key;
    appState.paletteCursor = 0;
    render(); return true;
  }
  return true;
}

export function renderPalette(screen) {
  const W = screen.width, H = screen.height;

  // Modal backdrop: dim everything.
  const backdropStyle = color('modalBackdrop');
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) {
      screen.styleBuf[yy][xx] = backdropStyle;
    }
  }

  const boxW = Math.min(80, W - 4);
  const boxH = Math.min(18, H - 4);
  const x = Math.floor((W - boxW) / 2);
  const y = Math.floor((H - boxH) / 2);

  // Clear the box area.
  for (let yy = y; yy < y + boxH; yy++) {
    for (let xx = x; xx < x + boxW; xx++) screen.setCell(xx, yy, ' ', null);
  }
  screen.box(x, y, boxW, boxH, 'Command Palette');

  // Query line with input box styling.
  const q = appState.paletteQuery;
  const inputStyle = color('inputBox');
  screen.writeStr(x + 2, y + 1, '>', { fg: 'cyan', bold: true });
  screen.writeStr(x + 4, y + 1, truncate(q, boxW - 8), inputStyle);
  screen.writeStr(x + 4 + q.length, y + 1, '█', { fg: 'cyan' });

  const list = filter(q);
  screen.hline(y + 2, '─', color('dim'));

  if (list.length === 0) {
    screen.writeStr(x + 2, y + 3, 'No matching actions', color('dim'));
    return;
  }

  const maxVisible = boxH - 5;
  let scrollOff = 0;
  if (appState.paletteCursor >= maxVisible) {
    scrollOff = appState.paletteCursor - maxVisible + 1;
  }

  for (let i = 0; i < maxVisible && (i + scrollOff) < list.length; i++) {
    const a = list[i + scrollOff];
    const row = y + 3 + i;
    const sel = (i + scrollOff) === appState.paletteCursor;

    if (sel) {
      for (let xx = x + 1; xx < x + boxW - 1; xx++) {
        screen.styleBuf[row][xx] = color('selection');
      }
    }

    screen.writeStr(x + 1, row, sel ? '▶' : ' ', sel ? color('selection') : null);
    screen.writeStr(x + 3, row, truncate(a.label, boxW - 34), sel ? color('selection') : null);
    if (a.hint) {
      const hintText = truncate(a.hint, 12);
      screen.writeStr(x + boxW - hintText.length - 3, row,
        ' ' + hintText, sel ? color('selection') : { fg: 'cyan', dim: true });
    }
  }

  // Scroll indicator + footer hints on the same bottom row.
  if (list.length > maxVisible) {
    const s = (scrollOff + 1) + '-' + Math.min(scrollOff + maxVisible, list.length) +
      ' of ' + list.length;
    screen.writeStr(x + 2, y + boxH - 2, s, color('dim'));
    const hint = '↑↓ navigate   ⏎ run   Esc close';
    screen.writeStr(x + boxW - hint.length - 3, y + boxH - 2, hint, color('dim'));
  } else {
    const hint = list.length + ' action' + (list.length !== 1 ? 's' : '') +
      ' found   ↑↓ navigate   ⏎ run   Esc close';
    screen.writeStr(x + 2, y + boxH - 2, hint.substring(0, boxW - 4), color('dim'));
  }
}
