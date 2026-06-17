// Settings tab — login/logout, refresh actions, system info panel.

import { appState, render, startAsync, isStale, showMessage, confirm } from '../state.mjs';
import {
  APP_VERSION, CONFIG_DIR, TOKEN_FILE, saveToken, removeToken,
} from '../config.mjs';
import {
  getAuthenticatedUser, getUserRepositories,
  lastRateLimit, lastScopes,
} from '../github.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import { color, listThemes, getThemeName, setTheme } from '../theme.mjs';
import { loadDashboardWidgets } from './dashboard.mjs';
import { loadUserData } from './repos.mjs';

const REPOS_PER_PAGE = 30;

export async function submitLogin(value) {
  const token = (value || '').trim();
  if (!token) { showMessage('Token cannot be empty', 'error'); render(); return; }
  const gen = startAsync();
  appState.loading = true;
  render();
  try {
    const user = await getAuthenticatedUser(token);
    if (isStale(gen)) return;
    if (user) {
      saveToken(token);
      appState.token = token;
      appState.user = user;
      appState.repos = await getUserRepositories(token, 1, REPOS_PER_PAGE);
      appState.reposPage = 1;
      appState.reposHasMore = appState.repos.length >= REPOS_PER_PAGE;
      appState.dashboardLoaded = false;
      loadDashboardWidgets().catch(() => {});
      showMessage('Logged in as ' + user.login, 'success');
    } else {
      showMessage('Invalid token', 'error');
    }
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Login failed', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}
registerInputHandler('login', submitLogin);

export async function handleLogout() {
  appState.token = null;
  appState.user = null;
  appState.repos = [];
  appState.reposPage = 1;
  appState.reposHasMore = true;
  appState.events = [];
  appState.trending = [];
  appState.notifications = [];
  appState.dashboardLoaded = false;
  removeToken();
  showMessage('Logged out', 'success');
  render();
}

registerInputHandler('theme', (value) => {
  const v = (value || '').trim();
  if (setTheme(v)) showMessage('Theme: ' + v, 'success');
  else showMessage('Unknown theme. Available: ' + listThemes().join(', '), 'warning');
});

export function renderSettings(screen, y, h) {
  const W = screen.width;
  const isLoggedIn = !!appState.token;

  screen.writeStr(4, y, 'Settings', color('title'));
  screen.hline(y + 1, '─', color('dim'));

  // Section: Authentication.
  let row = y + 2;
  screen.writeStr(4, row++, 'AUTHENTICATION', color('header'));

  const items = [
    { label: 'Login',              desc: isLoggedIn ? 'Already logged in' : 'Press Enter to login',  enabled: !isLoggedIn },
    { label: 'Logout',             desc: isLoggedIn ? 'Press Enter to logout' : 'Not logged in',     enabled: isLoggedIn },
  ];

  for (const item of items) {
    if (row >= y + h - 1) break;
    const sel = appState.settingsCursor === row - (y + 2);
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    screen.writeStr(4, row, sel ? '> ' : '  ', sel ? color('selection') : null);
    screen.writeStr(6, row, item.label, sel ? color('selection') : (item.enabled ? null : color('dim')));
    screen.writeStr(24, row, item.desc.substring(0, W - 26), color('dim'));
    row++;
  }

  row++;

  // Section: Data.
  screen.writeStr(4, row++, 'DATA', color('header'));
  const dataItems = [
    { label: 'Refresh Dashboard',  desc: 'Re-fetch events, trending, starred',  enabled: isLoggedIn },
    { label: 'Refresh User Data',  desc: 'Re-fetch profile and repositories',   enabled: isLoggedIn },
  ];
  for (const item of dataItems) {
    if (row >= y + h - 1) break;
    const sel = appState.settingsCursor === row - (y + 2);
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    screen.writeStr(4, row, sel ? '> ' : '  ', sel ? color('selection') : null);
    screen.writeStr(6, row, item.label, sel ? color('selection') : (item.enabled ? null : color('dim')));
    screen.writeStr(24, row, item.desc.substring(0, W - 26), color('dim'));
    row++;
  }

  row++;

  // Section: Appearance.
  screen.writeStr(4, row++, 'APPEARANCE', color('header'));
  const themeItem = { label: 'Change Theme', desc: 'Active: ' + getThemeName() + ' (' + listThemes().join(', ') + ')', enabled: true };
  if (row < y + h - 1) {
    const sel = appState.settingsCursor === row - (y + 2);
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    screen.writeStr(4, row, sel ? '> ' : '  ', sel ? color('selection') : null);
    screen.writeStr(6, row, themeItem.label, sel ? color('selection') : null);
    screen.writeStr(24, row, themeItem.desc.substring(0, W - 26), color('dim'));
    row++;
  }

  row++;

  // Section: Danger Zone.
  screen.writeStr(4, row++, 'DANGER ZONE', { fg: 'red', bold: true });
  const dangerItems = [
    { label: 'Clear Token File', desc: 'Wipe ' + TOKEN_FILE + ' (also logs out)', enabled: isLoggedIn },
  ];
  for (const item of dangerItems) {
    if (row >= y + h - 1) break;
    const sel = appState.settingsCursor === row - (y + 2);
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    screen.writeStr(4, row, sel ? '> ' : '  ', sel ? color('selection') : null);
    screen.writeStr(6, row, item.label, sel ? color('selection') : (item.enabled ? color('error') : color('dim')));
    screen.writeStr(24, row, item.desc.substring(0, W - 26), color('dim'));
    row++;
  }

  appState._maxSettingsCursor = row - (y + 2) - 1;

  // System panel with box.
  const infoX = Math.min(W - 38, Math.floor(W * 0.55));
  if (infoX > 30) {
    const lines = [
      ['App version',  APP_VERSION,                'cyan'],
      ['Config dir',   CONFIG_DIR,                 null],
      ['Token file',   TOKEN_FILE,                 null],
      ['Node',         process.version,            null],
      ['Platform',     process.platform + ' ' + process.arch, null],
      ['Terminal',     W + 'x' + screen.height,    null],
    ];
    if (lastRateLimit.remaining !== null) {
      const resetIn = lastRateLimit.reset
        ? Math.max(0, Math.floor((lastRateLimit.reset * 1000 - Date.now()) / 60000))
        : '?';
      lines.push(['API remaining', lastRateLimit.remaining + '/' + lastRateLimit.limit, 'yellow']);
      lines.push(['API resets in', resetIn + ' min', 'dim']);
    }
    if (lastScopes.scopes && lastScopes.scopes.length) {
      lines.push(['Token scopes', lastScopes.scopes.join(', '), 'dim']);
    }

    // Draw system panel box.
    const boxH = lines.length + 3;
    screen.box(infoX, y + 2, W - infoX - 2, boxH, 'System');
    lines.forEach(([k, v, c], i) => {
      const row = y + 3 + i;
      if (row >= y + 2 + boxH - 1) return;
      screen.writeStr(infoX + 2, row, k + ':', color('dim'));
      screen.writeStr(infoX + 18, row, String(v).substring(0, W - infoX - 20), c || null);
    });
  }

  const helpY = y + 2 + items.length + 1;
  if (helpY + 2 < y + h) {
    if (isLoggedIn && appState.user) {
      screen.writeStr(4, y + h - 1,
        'Signed in as ' + appState.user.login + '  |  ' + appState.repos.length + ' repos loaded',
        color('accent'));
    }
  }
}

export const keys = {};
export function up() {
  appState.settingsCursor = Math.max(0, appState.settingsCursor - 1); render();
}
export function down() {
  appState.settingsCursor = Math.min(
    appState._maxSettingsCursor != null ? appState._maxSettingsCursor : 6,
    appState.settingsCursor + 1);
  render();
}

export function enter() {
  const isLoggedIn = !!appState.token;
  switch (appState.settingsCursor) {
    case 0:
      if (!isLoggedIn) startInput('PAT token: ', 'login', true);
      else showMessage('Already logged in', 'info');
      break;
    case 1:
      if (isLoggedIn) confirm('Log out of GitHub?', handleLogout);
      else showMessage('Not logged in', 'warning');
      break;
    case 2:
      if (isLoggedIn) {
        appState.dashboardLoaded = false;
        loadDashboardWidgets(true);
        showMessage('Refreshing dashboard...', 'info');
      }
      break;
    case 3:
      if (isLoggedIn) { loadUserData(); showMessage('Refreshing user data...', 'info'); }
      break;
    case 4:
      startInput('Theme (' + listThemes().join('/') + '): ', 'theme');
      break;
    case 5:
      if (isLoggedIn) confirm('Wipe token file and log out?', () => {
        handleLogout();
        showMessage('Token file wiped', 'success');
      });
      break;
  }
}
