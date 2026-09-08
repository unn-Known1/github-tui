// Reusable Select Component — generic list picker with fuzzy search.

import { appState, render as appRender } from './state.mjs';
import { color } from './theme.mjs';
import { truncate, displayWidth } from './utils.mjs';

/**
 * Create a select dialog.
 * @param {Object} options
 * @param {string} options.title - Dialog title
 * @param {Array<{label: string, value: any, category?: string, hint?: string}>} options.items
 * @param {function} options.onSelect - Callback receiving the selected item
 * @param {function} [options.onCancel] - Callback invoked on Escape
 * @param {boolean} [options.searchable=true] - Show a search input
 * @param {boolean} [options.categories=false] - Show category headers
 * @returns {Object} Select dialog instance
 */
export function createSelect(options = {}) {
  const state = {
    query: '',
    cursor: 0,
    scroll: 0,
    items: Array.isArray(options.items) ? options.items.slice() : [],
    filtered: [],
  };

  function score(query, label) {
    if (!query) return 0;
    const q = String(query).toLowerCase();
    const s = String(label || '').toLowerCase();
    if (s.startsWith(q)) return 1000 - (s.length - q.length);
    let qi = 0;
    let hits = 0;
    for (let si = 0; si < s.length && qi < q.length; si++) {
      if (q[qi] === s[si]) {
        hits++;
        qi++;
      }
    }
    return qi === q.length ? 500 - (s.length - hits) : -1;
  }

  function applyFilter() {
    state.filtered = state.items
      .map((item, index) => ({ item, index, score: score(state.query, item.label) }))
      .filter(entry => entry.score >= 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(entry => entry.item);
    state.cursor = Math.min(state.cursor, Math.max(0, state.filtered.length - 1));
    state.scroll = Math.min(state.scroll, Math.max(0, state.filtered.length - 1));
  }

  function maxVisible(boxH) {
    return Math.max(1, boxH - 5 - (options.searchable === false ? 0 : 1));
  }

  function layout(screen) {
    const boxW = Math.max(1, Math.min(70, screen.width - 4));
    const boxH = Math.max(1, Math.min(20, screen.height - 4));
    return {
      boxW,
      boxH,
      x: Math.floor((screen.width - boxW) / 2),
      y: Math.floor((screen.height - boxH) / 2),
    };
  }

  function render(screen) {
    if (!screen) return;
    const { boxW, boxH, x, y } = layout(screen);
    const backdropStyle = color('modalBackdrop');

    for (let yy = 0; yy < screen.height; yy++) {
      for (let xx = 0; xx < screen.width; xx++) screen.styleBuf[yy][xx] = backdropStyle;
    }
    for (let yy = y; yy < y + boxH; yy++) {
      for (let xx = x; xx < x + boxW; xx++) screen.setCell(xx, yy, ' ', null);
    }

    screen.box(x, y, boxW, boxH, options.title || 'Select', color('modalBorder'));
    let contentY = y + 1;
    if (options.searchable !== false) {
      screen.writeStr(x + 2, contentY, '>', { fg: 'cyan', bold: true });
      screen.writeStr(x + 4, contentY, truncate(state.query, Math.max(0, boxW - 8)), color('inputBox'));
      const cursorX = x + 4 + Math.min(displayWidth(state.query), Math.max(0, boxW - 8));
      screen.writeStr(cursorX, contentY, '█', { fg: 'cyan' });
      contentY++;
    }
    screen.hline(contentY, '─', color('dim'));
    contentY++;

    const visible = maxVisible(boxH);
    const items = state.filtered;
    if (items.length === 0) {
      screen.writeStr(x + 2, contentY, 'No matching items', color('dim'));
    } else if (options.categories) {
      const entries = [];
      let lastCategory = Symbol('none');
      for (let i = 0; i < items.length; i++) {
        const category = items[i].category || 'General';
        if (category !== lastCategory) {
          entries.push({ type: 'header', label: category });
          lastCategory = category;
        }
        entries.push({ type: 'item', item: items[i], index: i });
      }
      const selectedEntry = entries.findIndex(entry => entry.type === 'item' && entry.index === state.cursor);
      const start = Math.max(0, selectedEntry - visible + 1, state.scroll);
      state.scroll = start;
      for (let rowOffset = 0; rowOffset < visible; rowOffset++) {
        const entry = entries[start + rowOffset];
        if (!entry) break;
        const row = contentY + rowOffset;
        if (entry.type === 'header') {
          screen.writeStr(x + 2, row, String(entry.label).toUpperCase(), { fg: 'cyan', bold: true });
          continue;
        }
        const selected = entry.index === state.cursor;
        if (selected) {
          for (let xx = x + 1; xx < x + boxW - 1; xx++) screen.styleBuf[row][xx] = color('selection');
        }
        screen.writeStr(x + 3, row, selected ? '▶' : ' ', selected ? color('selection') : null);
        screen.writeStr(x + 5, row, truncate(entry.item.label, Math.max(0, boxW - 16)), selected ? color('selection') : null);
        if (entry.item.hint) {
          const hint = String(entry.item.hint);
          screen.writeStr(x + Math.max(5, boxW - hint.length - 3), row, hint,
            selected ? color('selection') : { fg: 'cyan', dim: true });
        }
      }
    } else {
      state.scroll = Math.min(state.scroll, Math.max(0, items.length - visible));
      for (let i = 0; i < visible; i++) {
        const index = state.scroll + i;
        const item = items[index];
        if (!item) break;
        const row = contentY + i;
        const selected = index === state.cursor;
        if (selected) {
          for (let xx = x + 1; xx < x + boxW - 1; xx++) screen.styleBuf[row][xx] = color('selection');
        }
        screen.writeStr(x + 3, row, selected ? '▶' : ' ', selected ? color('selection') : null);
        screen.writeStr(x + 5, row, truncate(item.label, Math.max(0, boxW - 16)), selected ? color('selection') : null);
        if (item.hint) {
          const hint = String(item.hint);
          screen.writeStr(x + Math.max(5, boxW - hint.length - 3), row, hint,
            selected ? color('selection') : { fg: 'cyan', dim: true });
        }
      }
    }

    const footY = y + boxH - 2;
    if (footY >= 0 && footY < screen.height) {
      screen.writeStr(x + 2, footY, '↑↓ navigate   ⏎ select   Esc cancel', color('dim'));
      const count = items.length + ' item' + (items.length === 1 ? '' : 's');
      screen.writeStr(x + Math.max(2, boxW - count.length - 3), footY, count, color('dim'));
    }
  }

  function ensureCursorVisible() {
    const visible = 14;
    if (state.cursor < state.scroll) state.scroll = state.cursor;
    else if (state.cursor >= state.scroll + visible) state.scroll = state.cursor - visible + 1;
  }

  function handleKey(key) {
    if (key === '\x1b') {
      options.onCancel?.();
      return false;
    }
    if (key === '\r' || key === '\n') {
      const item = state.filtered[state.cursor];
      if (item) options.onSelect?.(item);
      return false;
    }
    if (key === '\x7f' || key === '\b') {
      state.query = state.query.slice(0, -1);
      applyFilter();
      appRender();
      return true;
    }
    if (key === '\x1b[A' || key === 'k') {
      state.cursor = Math.max(0, state.cursor - 1);
      ensureCursorVisible();
      appRender();
      return true;
    }
    if (key === '\x1b[B' || key === 'j') {
      state.cursor = Math.min(Math.max(0, state.filtered.length - 1), state.cursor + 1);
      ensureCursorVisible();
      appRender();
      return true;
    }
    if (key === '\x1b[5~') {
      state.cursor = Math.max(0, state.cursor - 10);
      ensureCursorVisible();
      appRender();
      return true;
    }
    if (key === '\x1b[6~') {
      state.cursor = Math.min(Math.max(0, state.filtered.length - 1), state.cursor + 10);
      ensureCursorVisible();
      appRender();
      return true;
    }
    if (key === 'g') {
      state.cursor = 0;
      state.scroll = 0;
      appRender();
      return true;
    }
    if (key === 'G') {
      state.cursor = Math.max(0, state.filtered.length - 1);
      ensureCursorVisible();
      appRender();
      return true;
    }
    if (key.length === 1 && key.charCodeAt(0) >= 32 && key.charCodeAt(0) !== 127) {
      state.query += key;
      applyFilter();
      appRender();
      return true;
    }
    return true;
  }

  applyFilter();
  return {
    render,
    handleKey,
    getState: () => state,
    setItems(items) {
      state.items = Array.isArray(items) ? items.slice() : [];
      applyFilter();
      appRender();
    },
    close() {
      options.onCancel?.();
    },
  };
}

/** Show a select dialog and resolve with the selected value. */
export function showSelect(options = {}) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      appState._activeSelect = null;
      resolve(value);
      appRender();
    };
    const select = createSelect({
      ...options,
      onSelect: item => {
        options.onSelect?.(item);
        finish(item?.value);
      },
      onCancel: () => {
        options.onCancel?.();
        finish(undefined);
      },
    });
    appState._activeSelect = select;
    appRender();
  });
}
