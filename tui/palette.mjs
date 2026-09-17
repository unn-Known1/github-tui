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
    moveCursorToItem(0);
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

// ── Slot model ─────────────────────────────────────────────────────
// In grouped mode (empty query) the rendered list interleaves category
// headers and action items. paletteCursor addresses *slots* (rendered
// rows); only item slots are selectable/executable. Flat mode (with a
// query) renders one item per slot, so the mapping degenerates to the
// identity. Render, key navigation, execSelected, and mouse handlers
// all share this mapping — do not compare the cursor against filter()
// indices anywhere else.

export function getSlotRows() {
  const q = appState.paletteQuery;
  if (q) return filter(q).map(a => ({ type: 'item', a }));
  const rows = [];
  for (const [cat, items] of filterGrouped(q)) {
    rows.push({ type: 'header', label: cat });
    for (const a of items) rows.push({ type: 'item', a });
  }
  return rows;
}

function firstItemSlot() {
  const i = getSlotRows().findIndex(r => r.type === 'item');
  return i;
}

/**
 * Nearest selectable slot at or after `slot` (skips headers). Falls back to
 * the first selectable slot; returns -1 when nothing is selectable.
 * Exported for the mouse handlers so clicks/hovers on a header row snap to
 * the first item under it instead of landing on an unselectable slot.
 */
export function nearestItemSlot(slot) {
  const rows = getSlotRows();
  if (slot >= 0 && slot < rows.length && rows[slot].type === 'item') return slot;
  for (let i = Math.max(0, slot); i < rows.length; i++) {
    if (rows[i].type === 'item') return i;
  }
  return firstItemSlot();
}

function lastItemSlot() {
  const rows = getSlotRows();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].type === 'item') return i;
  }
  return -1;
}

function moveCursorToItem(slot) {
  // Snap to the nearest selectable slot; keep 0 when nothing is selectable.
  const rows = getSlotRows();
  if (slot >= 0 && slot < rows.length && rows[slot].type === 'item') {
    appState.paletteCursor = slot;
    return;
  }
  const first = firstItemSlot();
  appState.paletteCursor = first >= 0 ? first : 0;
}

let _paletteFocusToken = null;

export function open(manageFocus = true) {
  if (appState.showPalette) return;
  appState.showPalette = true;
  appState.paletteQuery = '';
  moveCursorToItem(0);
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
  const rows = getSlotRows();
  const slot = rows[appState.paletteCursor];
  const a = slot && slot.type === 'item' ? slot.a : null;
  if (!a) { close(); return; }
  // Capture the action, then run it BEFORE closing: actions may introspect
  // palette state, and error messages must surface while the palette's
  // focus context is still intact (close() hands focus back to the
  // previous widget).
  try {
    const result = Promise.resolve(a.run());
    // Sync throw already handled above; async rejection surfaces after the
    // close but is still attributed to the action.
    result.catch(e => showMessage((e && e.message) || 'Command failed', 'error'));
  } catch (e) {
    showMessage((e && e.message) || 'Command failed', 'error');
  }
  close();
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
    moveCursorToItem(0);
    render(); return true;
  }
  if (key === '\x1b[A' || key === 'k') {
    // Walk up to the nearest item slot above the cursor (skips headers).
    const rows = getSlotRows();
    let i = appState.paletteCursor - 1;
    while (i >= 0 && (i >= rows.length || rows[i].type !== 'item')) i--;
    if (i >= 0) appState.paletteCursor = i;
    render(); return true;
  }
  if (key === '\x1b[B' || key === 'j') {
    // Walk down to the nearest item slot below the cursor (skips headers).
    const rows = getSlotRows();
    let i = appState.paletteCursor + 1;
    while (i < rows.length && rows[i].type !== 'item') i++;
    if (i < rows.length) appState.paletteCursor = i;
    render(); return true;
  }
  if (key.length === 1 && key.charCodeAt(0) >= 32) {
    appState.paletteQuery += key;
    moveCursorToItem(0);
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

  // Clamp against tiny terminals: W-4/H-4 going negative previously made
  // the box, centering math, and fill loops use nonsense coordinates.
  const boxW = Math.max(8, Math.min(80, W - 4));
  const boxH = Math.max(6, Math.min(20, H - 4)); // Slightly taller for categories
  const x = Math.max(0, Math.floor((W - boxW) / 2));
  const y = Math.max(0, Math.floor((H - boxH) / 2));

  for (let yy = y; yy < y + boxH; yy++) {
    for (let xx = x; xx < x + boxW; xx++) screen.setCell(xx, yy, ' ', null);
  }
  screen.box(x, y, boxW, boxH, 'Command Palette', color('modalBorder'));

  const q = appState.paletteQuery;
  const inputStyle = color('inputBox');
  screen.writeStr(x + 2, y + 1, '>', { fg: 'cyan', bold: true });
  const shown = truncate(q, boxW - 8);
  screen.writeStr(x + 4, y + 1, shown, inputStyle);
  // Cursor tracks the TRUNCATED query, not the raw length — otherwise it
  // drifts past the visible area and can collide with the right border.
  const cursorX = Math.min(x + 4 + shown.length, x + boxW - 3);
  screen.writeStr(cursorX, y + 1, '█', { fg: 'cyan' });

  screen.hline(y + 2, '─', color('dim'));

  // Use grouped display when no query (shows categories + suggested)
  const useGrouped = !q;
  const list = filter(q);
  
  if (list.length === 0) {
    screen.writeStr(x + 2, y + 3, 'No matching actions', color('dim'));
    return;
  }

  const maxVisible = boxH - 5;
  // Slot model: paletteCursor indexes rows (headers included) in both modes;
  // only item slots are selectable. Cursor-anchored scrolling keeps the
  // selected row visible without counting list indices separately.
  const rows = getSlotRows();
  if (appState.paletteCursor >= rows.length) appState.paletteCursor = lastItemSlot() >= 0 ? lastItemSlot() : 0;
  let scrollOff = 0;
  if (appState.paletteCursor >= maxVisible) {
    scrollOff = appState.paletteCursor - maxVisible + 1;
  }

  if (useGrouped) {
    // Grouped display with category headers
    let rendered = 0;

    for (let slot = scrollOff; slot < rows.length && rendered < maxVisible; slot++) {
      const entry = rows[slot];
      const row = y + 3 + (slot - scrollOff);
      if (row >= y + boxH - 2) break;

      if (entry.type === 'header') {
        screen.writeStr(x + 2, row, entry.label.toUpperCase(), { fg: 'cyan', bold: true });
        rendered++;
        continue;
      }

      const a = entry.a;
      const sel = slot === appState.paletteCursor;

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
    // Visible item range: map the visible slots to their indices within the
    // flat item list so the range stays meaningful in grouped mode (where
    // scrollOff counts slots, not items).
    let firstItemIdx = null, lastItemIdx = null, ii = 0;
    for (let s = 0; s < rows.length; s++) {
      if (rows[s].type !== 'item') continue;
      if (s >= scrollOff && s < scrollOff + maxVisible) {
        if (firstItemIdx === null) firstItemIdx = ii;
        lastItemIdx = ii;
      }
      ii++;
    }
    const first = (firstItemIdx ?? 0) + 1;
    const last = (lastItemIdx ?? Math.min(maxVisible, totalCount) - 1) + 1;
    const s = first + '-' + last + ' of ' + totalCount;
    screen.writeStr(x + 2, y + boxH - 2, s, color('dim'));
    const hint = '↑↓ navigate   ⏎ run   Esc close';
    screen.writeStr(x + boxW - hint.length - 3, y + boxH - 2, hint, color('dim'));
  } else {
    const hint = totalCount + ' action' + (totalCount !== 1 ? 's' : '') +
      ' found   ↑↓ navigate   ⏎ run   Esc close';
    screen.writeStr(x + 2, y + boxH - 2, truncateToWidth(hint, boxW - 4, ''), color('dim'));
  }
}
