// Settings tab — login/logout, refresh actions, system info panel.
// v0.5+ polish: sectioned panels with clearer hierarchy, system info in its own box.

import { appState, render, startAsync, isStale, showMessage, confirm } from '../state.mjs';
import {
  APP_VERSION, CONFIG_DIR, TOKEN_FILE, saveToken, removeToken,
  tokenStorageBackend,
} from '../config.mjs';
import {
  getAuthenticatedUser, getUserRepositories,
  lastRateLimit, lastScopes, getCacheStats, offlineState, isStarred as checkStarred,
} from '../github.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import { color, listThemes, getThemeName, setTheme } from '../theme.mjs';
import { loadDashboardWidgets } from './dashboard.mjs';
import { loadUserData } from './repos.mjs';
import { openUrl } from '../utils.mjs';
import { starRepo as apiStarRepo } from '../github.mjs';

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

function renderRow(screen, y, W, label, desc, enabled, selected, labelStyleOverride) {
  if (selected) {
    for (let x = 0; x < W; x++) screen.styleBuf[y][x] = { bg: 'blue', fg: 'white', bold: true };
  }
  const prefix = selected ? '▶ ' : '  ';
  const labelStyle = labelStyleOverride || (selected
    ? { bg: 'blue', fg: 'white', bold: true }
    : (enabled ? { fg: 'white' } : { dim: true }));
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
  const rowBounds = [];  // Track Y position of each menu item for mouse clicks

  // First decide where the system panel goes so we can constrain left column.
  const sysPanelW = Math.min(56, Math.max(34, Math.floor(W * 0.35)));
  const sysX = Math.max(2, W - sysPanelW - 2);
  const leftMaxW = sysX > 50 ? sysX - 4 : W;
  const sectionH = sysX > 50 ? h - 1 : h - 8;

  // AUTHENTICATION
  sectionHeader(screen, 2, row, '◆ AUTHENTICATION', leftMaxW);
  row += 2;
  const authItems = [
    { label: 'Login',    desc: isLoggedIn ? 'Already logged in' : 'Sign in with a token', enabled: !isLoggedIn, sel: appState.settingsCursor === 0 },
    { label: 'Logout',   desc: isLoggedIn ? 'Sign out' : 'Not logged in',                  enabled: isLoggedIn,  sel: appState.settingsCursor === 1 },
  ];
  for (const item of authItems) {
    if (row >= y + sectionH) break;
    renderRow(screen, row, leftMaxW, item.label, item.desc, item.enabled, item.sel);
    rowBounds.push({ cursor: authItems.indexOf(item), y: row });
    row++;
  }
  row += 2;

  // DATA
  sectionHeader(screen, 2, row, '◆ DATA', leftMaxW);
  row += 2;
  const dataItems = [
    { label: 'Refresh Dashboard', desc: 'Re-fetch events, trending',   enabled: isLoggedIn, sel: appState.settingsCursor === 2 },
    { label: 'Refresh User Data', desc: 'Re-fetch profile and repos',  enabled: isLoggedIn, sel: appState.settingsCursor === 3 },
    { label: 'Auto-Refresh', desc: appState.autoRefreshEnabled ? 'Every ' + Math.round(appState.autoRefreshIntervalMs / 60000) + ' min' : 'Off', enabled: true, sel: appState.settingsCursor === 4 },
  ];
  for (const item of dataItems) {
    if (row >= y + sectionH) break;
    renderRow(screen, row, leftMaxW, item.label, item.desc, item.enabled, item.sel);
    rowBounds.push({ cursor: dataItems.indexOf(item) + 2, y: row });
    row++;
  }
  row += 2;

  // APPEARANCE
  sectionHeader(screen, 2, row, '◆ APPEARANCE', leftMaxW);
  row += 2;
  const themeItem = { label: 'Change Theme', desc: 'Current: ' + getThemeName(), enabled: true, sel: appState.settingsCursor === 5 };
  if (row < y + sectionH) {
    renderRow(screen, row, leftMaxW, themeItem.label, themeItem.desc, true, themeItem.sel);
    rowBounds.push({ cursor: 5, y: row });
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
  sectionHeader(screen, 2, row, '! DANGER ZONE', leftMaxW);
  row += 2;
  const dangerItems = [
    { label: 'Clear Saved Token', desc: 'Wipe token from all storage',  enabled: isLoggedIn, sel: appState.settingsCursor === 6 },
  ];
  for (const item of dangerItems) {
    if (row >= y + sectionH) break;
    const dangerStyle = item.sel
      ? { bg: 'red', fg: 'white', bold: true }
      : (item.enabled ? { fg: 'red', bold: true } : { dim: true });
    renderRow(screen, row, leftMaxW, item.label, item.desc, item.enabled, item.sel, dangerStyle);
    rowBounds.push({ cursor: 6, y: row });
    row++;
  }

  // ABOUT
  row += 2;
  sectionHeader(screen, 2, row, '◆ ABOUT', leftMaxW);
  row += 2;
  if (row < y + sectionH) {
    screen.writeStr(4, row, 'Built with', { dim: true });
    screen.writeStr(14, row, 'zero dependencies', { fg: 'cyan', bold: true });
    screen.writeStr(31, row, '— just Node.js and vibes.', { dim: true });
    row++;
  }
  if (row < y + sectionH) {
    screen.writeStr(4, row, 'Feedback, issues, and PRs are welcome!', { fg: 'white' });
    row++;
  }
  if (row < y + sectionH) {
    const url = 'https://github.com/unn-Known1/github-tui';
    screen.writeStr(4, row, url, { fg: 'cyan', underline: true });
    appState._settingsUrlBounds = { x: 4, y: row, w: url.length, url };
    row++;
  }
  row++;
  if (row < y + sectionH) {
    const starSel = appState.settingsCursor === 7;
    const isStarred = !!appState._repoIsStarred;
    const isWorking = !!appState._starringInProgress;
    const starLabel = isWorking ? '  Starring...' : (isStarred ? '★ Starred!' : '★ Star this repo');
    const starDesc = isWorking
      ? 'Please wait...'
      : (isStarred
          ? 'You have starred github-tui — thank you!'
          : '[s] to star · click to star · helps more features get built');
    const starRowStyle = isStarred
      ? { bg: 'green', fg: 'white', bold: true }
      : (starSel ? { bg: 'yellow', fg: 'darkGray', bold: true } : { fg: 'yellow', bold: true });
    if (starSel || isStarred) {
      const rowBg = isStarred ? { bg: 'green', fg: 'white', bold: true } : { bg: 'yellow', fg: 'darkGray', bold: true };
      for (let xx = 2; xx < leftMaxW - 2; xx++) screen.styleBuf[row][xx] = rowBg;
    }
    renderRow(screen, row, leftMaxW, starLabel, starDesc, true, starSel, starRowStyle);
    appState._starRowBounds = { y: row, x1: 2, x2: leftMaxW - 2 };
    rowBounds.push({ cursor: 7, y: row });
    row++;
  }

  appState._settingsRowBounds = rowBounds;

  // ── System panel (right side or below) ──
  if (sysX > 50) {
    const sysY = y + 3;
    renderSystemPanel(screen, sysX, sysY, sysPanelW, h - 6, W);
  } else {
    // Below: show system info in a compact line.
    if (row < y + h - 2) {
      row += 2;
      sectionHeader(screen, 2, row, '◆ SYSTEM', leftMaxW);
      row++;
      renderSystemLines(screen, row, W, W);
    }
  }

  // Maker profile credit at the bottom
  const creditY = y + h - 1;
  if (creditY > row) {
    screen.writeStr(2, creditY, 'Maker: ', { fg: 'cyan', bold: true });
    screen.writeStr(9, creditY, '@unn-Known1', { fg: 'white', bold: true });
    screen.writeStr(21, creditY, '(https://github.com/unn-Known1)', { dim: true });
  }

  appState._maxSettingsCursor = 7;
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
  // Determine storage label and color
  const backend = tokenStorageBackend || 'plaintext';
  const storageLabel =
    backend === 'macos-keychain'      ? 'macOS Keychain' :
    backend === 'secret-tool'         ? 'Linux libsecret' :
    backend === 'windows-credential'  ? 'Windows Credential Manager' :
                                        'plaintext (fallback)';
  const storageStyle =
    backend === 'plaintext' ? { fg: 'yellow', bold: true } : { fg: 'green', bold: true };

  const lines = [
    ['App',         APP_VERSION,                       { fg: 'cyan', bold: true }],
    ['Maker',       'https://github.com/unn-Known1',   { fg: 'cyan' }],
    ['Config',      CONFIG_DIR.replace(process.env.HOME || '', '~'), null],
    ['Token store', storageLabel,                      storageStyle],
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
  // Cache stats
  const cs = getCacheStats();
  if (cs.entries > 0) {
    lines.push(['Cache', cs.entries + ' entries, ' + cs.totalKB + ' KB', { dim: true }]);
  }
  if (offlineState.isOffline) {
    lines.push(['Status', 'OFFLINE', { fg: 'yellow', bold: true }]);
  }
  return lines;
}

export async function starRepo() {
  if (!appState.token) {
    showMessage('Login required to star the repo', 'warning');
    render();
    return;
  }
  if (appState._starringInProgress) return; // Prevent double-trigger
  appState._starringInProgress = true;
  showMessage('Checking star status...', 'info');
  render();
  try {
    const already = await checkStarred(appState.token, 'unn-Known1', 'github-tui');
    if (already) {
      appState._repoIsStarred = true;
      showMessage('Already starred — thank you for the support! ★', 'success');
    } else {
      await apiStarRepo(appState.token, 'unn-Known1', 'github-tui');
      appState._repoIsStarred = true;
      showMessage('★ Starred github-tui! Thank you for the support!', 'success');
    }
  } catch (e) {
    showMessage('Star failed: ' + (e.message || 'unknown error'), 'error');
  } finally {
    appState._starringInProgress = false;
    render();
  }
}

export const keys = {
  'r': () => {
    showMessage('Refreshing...', 'info');
    import('./repos.mjs').then(m => m.loadUserData());
  },
  's': () => starRepo(),
  'S': () => starRepo(),
  'o': () => openUrl('https://github.com/unn-Known1/github-tui'),
};
const AUTH_ITEMS = [0, 1];  // Login, Logout
const DATA_ITEMS = [2, 3, 4];  // Refresh Dashboard, Refresh User Data, Auto-Refresh
const APPEARANCE_ITEMS = [5]; // Change Theme
const DANGER_ITEMS = [6];  // Clear Token
const ABOUT_ITEMS = [7];  // Star repo

function isCursorEnabled(cursor) {
  const isLoggedIn = !!appState.token;
  if (AUTH_ITEMS.includes(cursor)) {
    if (cursor === 0) return !isLoggedIn;
    return isLoggedIn;
  }
  if (DATA_ITEMS.includes(cursor)) {
    if (cursor === 4) return true;  // Auto-refresh is always available
    return isLoggedIn;
  }
  if (APPEARANCE_ITEMS.includes(cursor)) return true;
  if (DANGER_ITEMS.includes(cursor)) return isLoggedIn;
  if (ABOUT_ITEMS.includes(cursor)) return true;
  return false;
}

export function up() {
  let cur = appState.settingsCursor;
  while (cur > 0) {
    cur--;
    if (isCursorEnabled(cur)) {
      appState.settingsCursor = cur;
      render();
      return;
    }
  }
}
export function down() {
  const max = appState._maxSettingsCursor != null ? appState._maxSettingsCursor : 6;
  let cur = appState.settingsCursor;
  while (cur < max) {
    cur++;
    if (isCursorEnabled(cur)) {
      appState.settingsCursor = cur;
      render();
      return;
    }
  }
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
        appState.loading = true;
        render();
        loadDashboardWidgets(true).finally(() => { appState.loading = false; render(); });
        showMessage('Refreshing dashboard...', 'info');
      }
      break;
    case 3:
      if (isLoggedIn) {
        appState.loading = true;
        render();
        loadUserData().finally(() => { appState.loading = false; render(); });
        showMessage('Refreshing user data...', 'info');
      }
      break;
    case 4: {
      // Auto-refresh: cycle Off → 1 min → 5 min → 15 min → Off
      const intervals = [0, 60000, 300000, 900000];
      const labels = ['Off', '1 min', '5 min', '15 min'];
      if (!appState.autoRefreshEnabled) {
        appState.autoRefreshEnabled = true;
        appState.autoRefreshIntervalMs = 60000;
        showMessage('Auto-refresh: every 1 min', 'success');
      } else {
        const curIdx = intervals.indexOf(appState.autoRefreshIntervalMs);
        const nextIdx = curIdx + 1;
        if (nextIdx >= intervals.length) {
          appState.autoRefreshEnabled = false;
          showMessage('Auto-refresh: Off', 'info');
        } else {
          appState.autoRefreshIntervalMs = intervals[nextIdx];
          showMessage('Auto-refresh: every ' + labels[nextIdx], 'success');
        }
      }
      // Restart the interval
      if (globalThis._startAutoRefresh) globalThis._startAutoRefresh();
      break;
    }
    case 5: {
      const themes = listThemes();
      const curIdx = themes.indexOf(getThemeName());
      const nextIdx = (curIdx + 1) % themes.length;
      if (setTheme(themes[nextIdx])) showMessage('Theme: ' + themes[nextIdx], 'success');
      break;
    }
    case 6:
      if (isLoggedIn) confirm('Wipe token and log out?', () => {
        handleLogout();
        showMessage('Token wiped from all storage', 'success');
      }, 'Wipe Token');
      break;
    case 7:
      starRepo();
      break;
  }
}
