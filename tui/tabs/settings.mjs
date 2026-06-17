// Settings tab — login/logout, refresh actions, system info panel.

import { appState, render, startAsync, isStale, showMessage } from '../state.mjs';
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

  screen.writeStr(4, y, 'Settings', 'bright');
  screen.hline(y + 1, '─');

  const items = [
    { label: 'Login',              desc: isLoggedIn ? 'Already logged in' : 'Press Enter to login',  enabled: !isLoggedIn },
    { label: 'Logout',             desc: isLoggedIn ? 'Press Enter to logout' : 'Not logged in',     enabled: isLoggedIn },
    { label: 'Refresh Dashboard',  desc: 'Re-fetch events, trending, starred',                       enabled: isLoggedIn },
    { label: 'Refresh User Data',  desc: 'Re-fetch profile and repositories',                        enabled: isLoggedIn },
    { label: 'Change Theme',       desc: 'Active: ' + getThemeName() + ' — ' + listThemes().join('/'), enabled: true },
    { label: 'Clear Token File',   desc: 'Wipe ' + TOKEN_FILE + ' (also logs out)',                  enabled: isLoggedIn },
    { label: 'Token (display)',    desc: isLoggedIn ? '•••••••••••• (hidden)' : 'Not set',           enabled: false },
  ];
  appState._maxSettingsCursor = items.length - 1;

  items.forEach((item, i) => {
    const row = y + 2 + i;
    if (row >= y + h - 1) return;
    const sel = appState.settingsCursor === i;
    screen.writeStr(4, row, sel ? ' ▶ ' : '   ');
    screen.writeStr(7, row, item.label, sel ? 'bright' : (item.enabled ? null : 'dim'));
    screen.writeStr(28, row, item.desc.substring(0, W - 30), 'dim');
  });

  // System panel.
  const infoX = Math.min(W - 38, Math.floor(W * 0.55));
  if (infoX > 30) {
    const lines = [
      ['App version',  APP_VERSION,                'cyan'],
      ['Config dir',   CONFIG_DIR,                 null],
      ['Token file',   TOKEN_FILE,                 null],
      ['Node',         process.version,            null],
      ['Platform',     process.platform + ' ' + process.arch, null],
      ['Terminal',     W + '×' + screen.height,    null],
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
    screen.writeStr(infoX, y + 2, 'System', 'bright');
    lines.forEach(([k, v, c], i) => {
      const row = y + 3 + i;
      if (row >= y + h - 1) return;
      screen.writeStr(infoX, row, k + ':', 'dim');
      screen.writeStr(infoX + 16, row, String(v).substring(0, W - infoX - 17), c || null);
    });
  }

  const helpY = y + 2 + items.length + 1;
  if (helpY + 2 < y + h) {
    screen.writeStr(4, helpY, '↑/↓ Navigate   Enter Select   ? Help overlay', 'dim');
    if (isLoggedIn && appState.user) {
      screen.writeStr(4, helpY + 1,
        'Signed in as ' + appState.user.login + '  •  ' + appState.repos.length + ' repos loaded',
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
      if (isLoggedIn) handleLogout();
      else showMessage('Not logged in', 'warning');
      break;
    case 2:
      if (isLoggedIn) {
        appState.dashboardLoaded = false;
        loadDashboardWidgets(true);
        showMessage('Refreshing dashboard…', 'info');
      }
      break;
    case 3:
      if (isLoggedIn) { loadUserData(); showMessage('Refreshing user data…', 'info'); }
      break;
    case 4:
      startInput('Theme (' + listThemes().join('/') + '): ', 'theme');
      break;
    case 5:
      if (isLoggedIn) { handleLogout(); showMessage('Token file wiped', 'success'); }
      break;
  }
}
