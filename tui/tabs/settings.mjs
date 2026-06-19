// Settings tab — login/logout, refresh actions, system info panel.
// v0.5+ polish: sectioned panels with clearer hierarchy, system info in its own box.

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
    if (isStale(gen)) { appState.loading = false; return; }
    if (user) {
      saveToken(token);
      appState.token = token;
      appState.user = user;
      appState.repos = await getUserRepositories(token, 1, REPOS_PER_PAGE);
      appState.reposPage = 1;
      appState.reposHasMore = appState.repos.length >= REPOS_PER_PAGE;
      appState.dashboardLoaded = false;
      loadDashboardWidgets().catch(() => {});
      showMessage('✓ Logged in as ' + user.login, 'success');
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

function sectionHeader(screen, x, y, text, maxW) {
  screen.writeStr(x, y, text, { fg: 'cyan', bold: true });
  // Underline separator, limited to the left column.
  const W = maxW || screen.width;
  for (let i = x; i < x + W - x; i++) {
    screen.setCell(i, y + 1, '─', { dim: true });
  }
}

function renderRow(screen, y, W, label, desc, enabled, selected) {
  if (selected) {
    for (let x = 0; x < W; x++) screen.styleBuf[y][x] = { bg: 'blue', fg: 'white', bold: true };
  }
  const prefix = selected ? '▶ ' : '  ';
  const labelStyle = selected
    ? { bg: 'blue', fg: 'white', bold: true }
    : (enabled ? { fg: 'white' } : { dim: true });
  const descStyle = selected
    ? { bg: 'blue', fg: 'white' }
    : { dim: true };
  screen.writeStr(2, y, prefix, selected ? { bg: 'blue', fg: 'white' } : { dim: true });
  screen.writeStr(4, y, label, labelStyle);
  // Right-align description within the row's allowed width.
  const maxX = W - 2;
  const descX = Math.max(4 + label.length + 2, maxX - desc.length);
  screen.writeStr(descX, y, desc.substring(0, Math.max(0, maxX - descX)), descStyle);
}

export function renderSettings(screen, y, h) {
  const W = screen.width;
  const isLoggedIn = !!appState.token;

  screen.writeStr(2, y, 'SETTINGS', color('title') || { fg: 'white', bold: true });
  screen.hline(y + 1, '─', { dim: true });

  let row = y + 3;

  // First decide where the system panel goes so we can constrain left column.
  const sysPanelW = Math.min(46, Math.max(34, Math.floor(W * 0.4)));
  const sysX = Math.max(2, W - sysPanelW - 2);
  const leftMaxW = sysX > 50 ? sysX - 4 : W;
  const sectionH = h - 8;

  // AUTHENTICATION
  sectionHeader(screen, 2, row, '🔑 AUTHENTICATION', leftMaxW);
  row += 2;
  const authItems = [
    { label: 'Login',    desc: isLoggedIn ? 'Already logged in' : 'Sign in with a token', enabled: !isLoggedIn, sel: appState.settingsCursor === 0 },
    { label: 'Logout',   desc: isLoggedIn ? 'Sign out' : 'Not logged in',                  enabled: isLoggedIn,  sel: appState.settingsCursor === 1 },
  ];
  for (const item of authItems) {
    if (row >= y + sectionH) break;
    renderRow(screen, row, leftMaxW, item.label, item.desc, item.enabled, item.sel);
    row++;
  }
  row += 2;

  // DATA
  sectionHeader(screen, 2, row, '🔄 DATA', leftMaxW);
  row += 2;
  const dataItems = [
    { label: 'Refresh Dashboard', desc: 'Re-fetch events, trending',   enabled: isLoggedIn, sel: appState.settingsCursor === 2 },
    { label: 'Refresh User Data', desc: 'Re-fetch profile and repos',  enabled: isLoggedIn, sel: appState.settingsCursor === 3 },
  ];
  for (const item of dataItems) {
    if (row >= y + sectionH) break;
    renderRow(screen, row, leftMaxW, item.label, item.desc, item.enabled, item.sel);
    row++;
  }
  row += 2;

  // APPEARANCE
  sectionHeader(screen, 2, row, '🎨 APPEARANCE', leftMaxW);
  row += 2;
  const themeItem = { label: 'Change Theme', desc: 'Current: ' + getThemeName(), enabled: true, sel: appState.settingsCursor === 4 };
  if (row < y + sectionH) {
    renderRow(screen, row, leftMaxW, themeItem.label, themeItem.desc, true, themeItem.sel);
    row++;
  }
  // Show all available themes as a small chip row with accent-colored indicators.
  if (row < y + sectionH - 1) {
    row++;
    screen.writeStr(2, row, 'Available:', { dim: true });
    let cx = 14;
    const themeChips = [];
    const accentColors = {
      default: 'cyan', highContrast: 'white', dracula: 'magenta',
      solarized: 'blue', nord: 'cyan', monokai: 'green', gruvbox: 'yellow', light: 'blue',
    };
    for (const t of listThemes()) {
      const isCurrent = t === getThemeName();
      const accent = accentColors[t] || 'cyan';
      const label = ' ' + t + ' ';
      const style = isCurrent
        ? { bg: 'cyan', fg: 'darkGray', bold: true }
        : { dim: true };
      if (cx + label.length + 4 < leftMaxW - 2) {
        screen.writeStr(cx, row, '█', { fg: accent });
        screen.writeStr(cx + 2, row, label, style);
        themeChips.push({ theme: t, x1: cx, x2: cx + 2 + label.length, y: row });
        cx += label.length + 4;
      }
    }
    appState._themeChips = themeChips;
  }
  row += 2;

  // DANGER ZONE
  sectionHeader(screen, 2, row, '⚠ DANGER ZONE', leftMaxW);
  row += 2;
  const dangerItems = [
    { label: 'Clear Token File', desc: 'Wipe saved token',  enabled: isLoggedIn, sel: appState.settingsCursor === 5 },
  ];
  for (const item of dangerItems) {
    if (row >= y + sectionH) break;
    renderRow(screen, row, leftMaxW, item.label, item.desc, item.enabled, item.sel);
    const labelStyle = item.sel
      ? { bg: 'red', fg: 'white', bold: true }
      : (item.enabled ? { fg: 'red', bold: true } : { dim: true });
    screen.writeStr(4, row, item.label, labelStyle);
    row++;
  }

  // ── System panel (right side or below) ──
  if (sysX > 50) {
    const sysY = y + 3;
    renderSystemPanel(screen, sysX, sysY, sysPanelW, h - 6, W);
  } else {
    // Below: show system info in a compact line.
    if (row < y + h - 1) {
      row += 2;
      sectionHeader(screen, 2, row, 'ℹ SYSTEM', leftMaxW);
      row++;
      renderSystemLines(screen, row, W, W);
    }
  }

  appState._maxSettingsCursor = 5;
}

function renderSystemPanel(screen, x, y, w, h, screenW) {
  const lines = buildSystemLines(screenW);
  const boxH = Math.min(lines.length + 3, h);
  screen.box(x, y, w, boxH, 'System', { fg: 'cyan', bold: true });
  for (let i = 0; i < lines.length && i < boxH - 3; i++) {
    const [k, v, c] = lines[i];
    screen.writeStr(x + 2, y + 2 + i, k + ':', { dim: true });
    const val = String(v);
    const valX = x + Math.min(16, w - val.length - 4);
    screen.writeStr(valX, y + 2 + i, val.substring(0, w - (valX - x) - 2), c || { fg: 'white' });
  }
}

function renderSystemLines(screen, y, W, screenW) {
  const lines = buildSystemLines(screenW);
  const items = lines.map(([k, v]) => k + ': ' + v).join('   ');
  screen.writeStr(2, y, items.substring(0, W - 4), { dim: true });
}

function buildSystemLines(screenW) {
  const lines = [
    ['App',         APP_VERSION,                       { fg: 'cyan', bold: true }],
    ['Config',      CONFIG_DIR.replace(process.env.HOME || '', '~'), null],
    ['Token file',  TOKEN_FILE.replace(process.env.HOME || '', '~'), null],
    ['Node',        process.version,                   null],
    ['Platform',    process.platform + ' ' + process.arch, null],
    ['Terminal',    (screenW || 80) + '×' + (process.stdout.rows || 24), null],
  ];
  if (lastRateLimit.remaining !== null) {
    const resetIn = lastRateLimit.reset
      ? Math.max(0, Math.floor((lastRateLimit.reset * 1000 - Date.now()) / 60000))
      : '?';
    const pct = lastRateLimit.limit > 0 ? lastRateLimit.remaining / lastRateLimit.limit : 0;
    const style = pct < 0.1 ? { fg: 'yellow', bold: true } : { fg: 'green' };
    lines.push(['API',  lastRateLimit.remaining + '/' + lastRateLimit.limit, style]);
    lines.push(['Reset in', resetIn + ' min', { dim: true }]);
  }
  if (lastScopes.scopes && lastScopes.scopes.length) {
    lines.push(['Scopes', lastScopes.scopes.join(', '), { dim: true }]);
  }
  return lines;
}

export const keys = {
  'r': () => {
    showMessage('Refreshing...', 'info');
    import('./repos.mjs').then(m => m.loadUserData());
  },
};
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
      if (isLoggedIn) confirm('Log out of GitHub?', handleLogout, 'Log Out');
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
      }, 'Wipe Token');
      break;
  }
}
