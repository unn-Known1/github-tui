// Quick Settings Popup — most-used settings in a modal overlay.
// Press Ctrl+, or use palette to open.

import { appState, render as appRender } from './state.mjs';
import { color } from './theme.mjs';
import { truncate, truncateToWidth } from './utils.mjs';
import { listThemes, getThemeName, setTheme } from './theme.mjs';
import { getUnreadCount } from './state.mjs';
import { saveFocus, restoreFocus } from './focus.mjs';

// Settings items for the quick settings popup
const SETTINGS = [
  {
    id: 'theme',
    label: 'Theme',
    type: 'cycle',
    get: () => getThemeName(),
    options: () => listThemes(),
    set: (value) => setTheme(value),
  },
  {
    id: 'density',
    label: 'Repos Density',
    type: 'cycle',
    get: () => appState.repoDensity || 'comfortable',
    options: () => ['compact', 'comfortable'],
    set: (value) => { appState.repoDensity = value; },
  },
  {
    id: 'auto-refresh',
    label: 'Auto-Refresh',
    type: 'cycle',
    get: () => {
      if (!appState.autoRefreshEnabled) return 'Off';
      const mins = Math.round(appState.autoRefreshIntervalMs / 60000);
      return mins + ' min';
    },
    options: () => ['Off', '1 min', '5 min', '15 min'],
    set: (value) => {
      if (value === 'Off') {
        appState.autoRefreshEnabled = false;
      } else {
        appState.autoRefreshEnabled = true;
        appState.autoRefreshIntervalMs = parseInt(value) * 60000;
      }
      if (globalThis._startAutoRefresh) globalThis._startAutoRefresh();
    },
  },
  {
    id: 'stale-only',
    label: 'Stale Repos Only',
    type: 'toggle',
    get: () => appState.repoStaleOnly ? 'On' : 'Off',
    set: (value) => { appState.repoStaleOnly = value === 'On'; },
  },
  {
    id: 'inbox-group',
    label: 'Group Inbox',
    type: 'toggle',
    get: () => appState.inboxGrouped ? 'On' : 'Off',
    set: (value) => { appState.inboxGrouped = value === 'On'; },
  },
  {
    id: 'inbox-filter',
    label: 'Inbox Filter',
    type: 'cycle',
    get: () => appState.inboxFilter || 'all',
    options: () => ['all', 'unread', 'mentions', 'review'],
    set: (value) => { appState.inboxFilter = value; },
  },
  {
    id: 'repos-sort',
    label: 'Repos Sort',
    type: 'cycle',
    get: () => appState.repoSort?.field || 'updated',
    options: () => ['name', 'stars', 'forks', 'issues', 'updated'],
    set: (value) => {
      const current = appState.repoSort && typeof appState.repoSort === 'object'
        ? appState.repoSort
        : { field: 'updated', asc: false };
      appState.repoSort = { field: value, asc: value === current.field ? !!current.asc : value === 'name' };
    },
  },
  {
    id: 'theme-mode',
    label: 'Theme Mode',
    type: 'cycle',
    get: () => appState.themeMode || 'dark',
    options: () => ['dark', 'light'],
    set: (value) => { appState.themeMode = value; },
  },
  {
    id: 'inbox-snooze',
    label: 'Show Snoozed',
    type: 'toggle',
    get: () => appState.inboxShowSnoozed ? 'On' : 'Off',
    set: (value) => { appState.inboxShowSnoozed = value === 'On'; },
  },
  {
    id: 'repos-type',
    label: 'Repos Type',
    type: 'cycle',
    get: () => appState.repoTypeFilter || 'all',
    options: () => ['all', 'sources', 'forks', 'archived', 'private', 'public', 'templates'],
    set: (value) => { appState.repoTypeFilter = value; },
  },
  {
    id: 'dashboard-local',
    label: 'Local Repo Filter',
    type: 'toggle',
    get: () => appState.localRepoFilter ? 'On' : 'Off',
    set: (value) => { appState.localRepoFilter = value === 'On'; },
  },
];

let _cursor = 0;
let _active = false;
let _focusToken = null;

export function isOpen() {
  return _active;
}

export function getLayout(screen) {
  const boxW = Math.min(50, Math.max(1, screen.width - 4));
  const boxH = SETTINGS.length + 6;
  return {
    boxW,
    boxH,
    x: Math.floor((screen.width - boxW) / 2),
    y: Math.floor((screen.height - boxH) / 2),
    rowStart: Math.floor((screen.height - boxH) / 2) + 2,
    rowCount: SETTINGS.length,
  };
}

export function open(manageFocus = true) {
  if (_active) return;
  _active = true;
  _cursor = 0;
  if (manageFocus) _focusToken = saveFocus();
  appRender();
}

export function close() {
  if (!_active) return;
  _active = false;
  if (_focusToken) restoreFocus(_focusToken);
  _focusToken = null;
}

function getValue(setting) {
  return setting.get();
}

function cycleSetting(setting) {
  const current = getValue(setting);
  const options = setting.options();
  const idx = options.indexOf(current);
  const next = options[(idx + 1) % options.length];
  setting.set(next);
  appRender();
}

function toggleSetting(setting) {
  const current = getValue(setting);
  setting.set(current === 'On' ? 'Off' : 'On');
  appRender();
}

export function activateAt(index) {
  if (!_active || !Number.isInteger(index) || index < 0 || index >= SETTINGS.length) return false;
  _cursor = index;
  const setting = SETTINGS[_cursor];
  if (setting.type === 'cycle') cycleSetting(setting);
  else if (setting.type === 'toggle') toggleSetting(setting);
  return true;
}

export function handleKey(key) {
  if (!_active) return false;

  if (key === '\x1b' || key === 'q') {
    close();
    return true;
  }

  if (key === '\x1b[A' || key === 'k') {
    _cursor = Math.max(0, _cursor - 1);
    appRender();
    return true;
  }

  if (key === '\x1b[B' || key === 'j') {
    _cursor = Math.min(SETTINGS.length - 1, _cursor + 1);
    appRender();
    return true;
  }

  if (key === '\r' || key === '\n' || key === ' ') {
    const setting = SETTINGS[_cursor];
    if (setting.type === 'cycle') {
      cycleSetting(setting);
    } else if (setting.type === 'toggle') {
      toggleSetting(setting);
    }
    return true;
  }

  // Number keys 1-11 for direct selection
  if (key >= '1' && key <= '9') {
    const idx = parseInt(key) - 1;
    if (idx < SETTINGS.length) activateAt(idx);
    return true;
  }

  return true;
}

export function renderQuickSettings(screen) {
  if (!_active) return;

  const W = screen.width, H = screen.height;
  const { boxW, boxH, x, y } = getLayout(screen);

  // Backdrop
  const backdropStyle = color('modalBackdrop');
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) {
      screen.styleBuf[yy][xx] = backdropStyle;
    }
  }

  // Clear box area
  for (let yy = y; yy < y + boxH; yy++) {
    for (let xx = x; xx < x + boxW; xx++) {
      screen.setCell(xx, yy, ' ', null);
    }
  }

  // Draw box
  screen.box(x, y, boxW, boxH, 'Quick Settings', color('modalBorder'));

  // Settings items
  for (let i = 0; i < SETTINGS.length; i++) {
    const setting = SETTINGS[i];
    const row = y + 2 + i;
    const sel = i === _cursor;
    const value = getValue(setting);

    if (sel) {
      for (let xx = x + 1; xx < x + boxW - 1; xx++) {
        screen.styleBuf[row][xx] = color('selection');
      }
    }

    // Number hint
    screen.writeStr(x + 2, row, '[' + (i + 1) + ']', { fg: 'cyan', bold: true });

    // Label
    screen.writeStr(x + 6, row, truncate(setting.label, boxW - 20),
      sel ? color('selection') : null);

    // Value (right-aligned)
    const valueText = setting.type === 'toggle' ? value : value;
    screen.writeStr(x + boxW - valueText.length - 3, row,
      valueText, sel ? color('selection') : { fg: 'cyan' });
  }

  // Footer
  const footY = y + boxH - 2;
  const hint = '↑↓ navigate   ⏎/Space cycle   Esc close';
  screen.writeStr(x + 2, footY, hint, color('dim'));
}
