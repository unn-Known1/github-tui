// Command palette — Ctrl-P / ':' to fuzzy-search every action.
// Enhanced with categories and suggested commands.

import { appState, render, showMessage } from './state.mjs';
import { color } from './theme.mjs';
import { truncate, truncateToWidth } from './utils.mjs';
import { saveFocus, restoreFocus } from './focus.mjs';

const actions = [];
const seen = new Set();

// Bracketed-paste assembly buffer for handleKey (see below).
let _pasteActive = false;
let _pasteBuf = '';

function insertPasteChars(str) {
  let out = '';
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c !== 127) out += ch;
  }
  if (out) {
    appState.paletteQuery = (appState.paletteQuery || '') + out;
    appState.paletteCursor = 0;
  }
  render();
}

// Register a palette action.
// Enhanced with:
//   - category: string — group label for display (default: 'General')
//   - suggested: boolean | (() => boolean) — context-aware recommendation
export function register(action) {
  if (!action || !action.id || seen.has(action.id)) return;
  seen.add(action.id);
  actions.push({
    ...action,
    category: action.category || 'General',
    suggested: action.suggested ?? false,
  });
}

// Check if an action is currently suggested (supports function or boolean).
function isSuggested(action) {
  if (typeof action.suggested === 'function') return action.suggested();
  return !!action.suggested;
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

// Filter actions by query, returning sorted results.
// When query is empty, returns suggested actions first, then all others.
export function filter(query) {
  const all = actions
    .map(a => ({ a, s: score(query, a.label) }))
    .filter(x => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 20)  // Increased from 15 to accommodate categories
    .map(x => x.a);
  
  if (!query) {
    // When no query, show suggested actions first
    const suggested = all.filter(a => isSuggested(a));
    const rest = all.filter(a => !isSuggested(a));
    return [...suggested, ...rest];
  }
  
  return all;
}

// Group filtered actions by category.
// Returns array of [category, actions[]] pairs.
export function filterGrouped(query) {
  const filtered = filter(query);
  const grouped = new Map();
  
  for (const a of filtered) {
    const cat = a.category || 'General';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat).push(a);
  }
  
  // Preserve order: suggested first, then alphabetical categories
  const result = [];
  const suggested = filtered.filter(a => isSuggested(a));
  if (suggested.length > 0) {
    result.push(['Suggested', suggested]);
  }
  
  for (const [cat, items] of grouped) {
    if (cat === 'Suggested') continue;  // Already handled
    result.push([cat, items]);
  }
  
  return result;
}

let _paletteFocusToken = null;

export function open(manageFocus = true) {
  if (appState.showPalette) return;
  appState.showPalette = true;
  appState.paletteQuery = '';
  appState.paletteCursor = 0;
  _pasteActive = false;
  _pasteBuf = '';
  if (manageFocus) _paletteFocusToken = saveFocus();
  render();
}
export function close() {
  if (!appState.showPalette) return;
  appState.showPalette = false;
  appState.paletteQuery = '';
  appState.paletteCursor = 0;
  _pasteActive = false;
  _pasteBuf = '';
  if (_paletteFocusToken) restoreFocus(_paletteFocusToken);
  _paletteFocusToken = null;
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
  // Bracketed-paste path (minimal standalone mirror of input.mjs:73-159).
  // input.mjs couples paste to its cursor/insert helpers, so the palette
  // keeps a small local version: accumulate between \x1b[200~ … \x1b[201~,
  // then insert the printable chars as query text. Split-chunk pastes
  // reuse the same module-local buffer across calls.
  const PASTE_START = '\x1b[200~';
  const PASTE_END = '\x1b[201~';
  if (_pasteActive) {
    const endIdx = key.indexOf(PASTE_END);
    if (endIdx === -1) { _pasteBuf += key; return true; }
    _pasteBuf += key.slice(0, endIdx);
    insertPasteChars(_pasteBuf);
    _pasteBuf = '';
    _pasteActive = false;
    const rest = key.slice(endIdx + PASTE_END.length);
    if (rest.length > 0) return handleKey(rest);
    return true;
  }
  const startIdx = key.indexOf(PASTE_START);
  if (startIdx !== -1) {
    _pasteActive = true;
    _pasteBuf = '';
    const after = key.slice(startIdx + PASTE_START.length);
    if (after.length > 0) return handleKey(after);
    return true;
  }
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

  const backdropStyle = color('modalBackdrop');
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) {
      screen.styleBuf[yy][xx] = backdropStyle;
    }
  }

  const boxW = Math.min(80, W - 4);
  const boxH = Math.min(20, H - 4);  // Slightly taller for categories
  const x = Math.floor((W - boxW) / 2);
  const y = Math.floor((H - boxH) / 2);

  for (let yy = y; yy < y + boxH; yy++) {
    for (let xx = x; xx < x + boxW; xx++) screen.setCell(xx, yy, ' ', null);
  }
  screen.box(x, y, boxW, boxH, 'Command Palette', color('modalBorder'));

  const q = appState.paletteQuery;
  const inputStyle = color('inputBox');
  screen.writeStr(x + 2, y + 1, '>', { fg: 'cyan', bold: true });
  screen.writeStr(x + 4, y + 1, truncate(q, boxW - 8), inputStyle);
  screen.writeStr(x + 4 + q.length, y + 1, '█', { fg: 'cyan' });

  screen.hline(y + 2, '─', color('dim'));

  // Use grouped display when no query (shows categories + suggested)
  const useGrouped = !q;
  const list = filter(q);
  
  if (list.length === 0) {
    screen.writeStr(x + 2, y + 3, 'No matching actions', color('dim'));
    return;
  }

  const maxVisible = boxH - 5;
  let scrollOff = 0;
  if (appState.paletteCursor >= maxVisible) {
    scrollOff = appState.paletteCursor - maxVisible + 1;
  }

  if (useGrouped) {
    // Grouped display with category headers
    const grouped = filterGrouped(q);
    let itemIndex = 0;
    let rendered = 0;
    
    for (const [cat, items] of grouped) {
      if (rendered >= maxVisible) break;
      
      // Render category header
      if (scrollOff <= itemIndex && itemIndex < scrollOff + maxVisible) {
        const row = y + 3 + (itemIndex - scrollOff);
        if (row < y + boxH - 2) {
          screen.writeStr(x + 2, row, cat.toUpperCase(), { fg: 'cyan', bold: true });
          rendered++;
        }
      }
      itemIndex++;
      
      // Render items in category
      for (const a of items) {
        if (rendered >= maxVisible) break;
        if (itemIndex >= scrollOff && itemIndex < scrollOff + maxVisible) {
          const row = y + 3 + (itemIndex - scrollOff);
          if (row < y + boxH - 2) {
            const sel = itemIndex === appState.paletteCursor;
            
            if (sel) {
              for (let xx = x + 1; xx < x + boxW - 1; xx++) {
                screen.styleBuf[row][xx] = color('selection');
              }
            }
            
            screen.writeStr(x + 3, row, sel ? '▶' : ' ', sel ? color('selection') : null);
            screen.writeStr(x + 5, row, truncate(a.label, boxW - 36), sel ? color('selection') : null);
            if (a.hint) {
              const hintText = truncate(a.hint, 12);
              screen.writeStr(x + boxW - hintText.length - 3, row,
                ' ' + hintText, sel ? color('selection') : { fg: 'cyan', dim: true });
            }
            rendered++;
          }
        }
        itemIndex++;
      }
    }
  } else {
    // Flat display with search query
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
  }

  const totalCount = list.length;
  if (totalCount > maxVisible) {
    const s = (scrollOff + 1) + '-' + Math.min(scrollOff + maxVisible, totalCount) +
      ' of ' + totalCount;
    screen.writeStr(x + 2, y + boxH - 2, s, color('dim'));
    const hint = '↑↓ navigate   ⏎ run   Esc close';
    screen.writeStr(x + boxW - hint.length - 3, y + boxH - 2, hint, color('dim'));
  } else {
    const hint = totalCount + ' action' + (totalCount !== 1 ? 's' : '') +
      ' found   ↑↓ navigate   ⏎ run   Esc close';
    screen.writeStr(x + 2, y + boxH - 2, truncateToWidth(hint, boxW - 4, ''), color('dim'));
  }
}
