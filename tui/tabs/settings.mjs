// Settings tab — login/logout, refresh actions, system info panel.
// v0.5+ polish: sectioned panels with clearer hierarchy, system info in its own box.

import { appState, render, startAsync, isStale, showMessage, confirm } from '../state.mjs';
import {
  APP_VERSION, CONFIG_DIR, TOKEN_FILE, saveToken, removeToken,
  tokenStorageBackend,
} from '../config.mjs';
import {
  getAuthenticatedUser, getUserRepositories,
  lastRateLimit, lastScopes, getCacheStats, clearAccountCache, offlineState, isStarred as checkStarred,
} from '../github.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import { color, listThemes, getThemeName, setTheme } from '../theme.mjs';
import { refreshDashboard, loadDashboardWidgets } from './dashboard.mjs';
import { loadUserData, loadAllReposBackground } from './repos.mjs';
import { openUrl } from '../utils.mjs';
import { starRepo as apiStarRepo } from '../github.mjs';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

// ── GitHub CLI integration (optional system dependency) ──

// Cache the gh availability check so we don't spawn processes repeatedly.
let _ghAvailable = null;
export async function isGhInstalled() {
  if (_ghAvailable !== null) return _ghAvailable;
  try {
    await execFileAsync('gh', ['--version']);
    _ghAvailable = true;
  } catch {
    _ghAvailable = false;
  }
  return _ghAvailable;
}

// Attempt to get a token from gh auth.
// Returns the token string or null if gh isn't logged in.
export async function getGhToken() {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: 5000 });
    const token = stdout.trim();
    return token || null;
  } catch {
    return null;
  }
}

// Login via GitHub CLI — reads the token from `gh auth token`.
export async function loginWithGh() {
  const gen = startAsync('login');
  appState.loading = true;
  render();
  try {
    const token = await getGhToken();
    if (isStale(gen, 'login')) { appState.loading = false; return; }
    if (!token) {
      showMessage('GitHub CLI not logged in — run "gh auth login" first', 'warning', 6000);
      appState.loading = false;
      render();
      return;
    }
    const user = await getAuthenticatedUser(token, gen.signal);
    if (isStale(gen, 'login')) { appState.loading = false; return; }
    if (user) {
      saveToken(token);
      appState.token = token;
      appState.user = user;
      appState.repos = await getUserRepositories(token, 1, REPOS_PER_PAGE, gen.signal);
      appState.reposPage = 1;
      appState.reposHasMore = appState.repos.length >= REPOS_PER_PAGE;
      appState.dashboardLoaded = false;
      loadAllReposBackground(gen);
      loadDashboardWidgets().catch(() => {});
      showMessage('✓ Logged in via GitHub CLI as ' + user.login, 'success');
    } else {
      showMessage('GitHub CLI token is invalid', 'error');
    }
  } catch (e) {
    if (!isStale(gen, 'login')) showMessage(e.message || 'GitHub CLI login failed', 'error');
  }
  appState.loading = false;
  if (!isStale(gen, 'login')) render();
}

const REPOS_PER_PAGE = 30;

export async function submitLogin(value) {
  const token = (value || '').trim();
  if (!token) { showMessage('Token cannot be empty', 'error'); render(); return; }
  const gen = startAsync('login');
  appState.loading = true;
  render();
  try {
    const user = await getAuthenticatedUser(token, gen.signal);
    if (isStale(gen, 'login')) { appState.loading = false; return; }
    if (user) {
      // Attempt to persist the token to OS keychain first. If that fails
      // we NEVER set the in-memory token — fail loudly so the user knows
      // their next session won't be logged in.
      const tokenBackend = saveToken(token);
      if (!tokenBackend || tokenBackend === 'plaintext') {
        // saveToken throws on hard failure, but returns 'plaintext' only when
        // the keychain write succeeded and plaintext is the fallback for read.
        // We treat any plaintext-only result as a soft success on macOS/Windows
        // and a hard fail on Linux (no libsecret available).
        if (process.platform === 'linux') {
          showMessage(
            'Login OK, but no OS keychain (libsecret) is available. ' +
            'Token is kept in the chmod 600 plaintext fallback file for future sessions. Install gnome-keyring or KWallet for OS encryption.',
            'warning', 8000
          );
        }
      }
      appState.token = token;
      appState.user = user;
      appState.repos = await getUserRepositories(token, 1, REPOS_PER_PAGE, gen.signal);
      appState.reposPage = 1;
      appState.reposHasMore = appState.repos.length >= REPOS_PER_PAGE;
      appState.dashboardLoaded = false;
      loadAllReposBackground(gen);
      loadDashboardWidgets().catch(() => {});
      showMessage('✓ Logged in as ' + user.login, 'success');
    } else {
      showMessage('Invalid token', 'error');
    }
  } catch (e) {
    if (!isStale(gen, 'login')) showMessage(e.message || 'Login failed', 'error');
  }
  appState.loading = false;
  if (!isStale(gen, 'login')) render();
}
registerInputHandler('login', submitLogin);

export async function handleLogout() {
  // Invalidate account-scoped requests before clearing their data. The
  // generation bump aborts active requests and prevents late responses from
  // repopulating the UI after logout.
  for (const scope of [
    'login', 'repos', 'repos-more', 'dashboard-widgets', 'dashboard-trending',
    'inbox', 'inbox-more', 'inbox-page', 'actions-runs', 'actions-jobs',
    'analyze-details', 'analyze-search-repos', 'analyze-search-users',
    'analyze-search-code', 'analyze-user-profile', 'forks', 'forks-more',
    'analyze-labels', 'analyze-checks', 'analyze-issues', 'analyze-traffic',
    'analyze-milestones', 'analyze-readme', 'analyze-packages',
    'analyze-security', 'files-tree', 'files-view', 'files-branches', 'files-bulk', 'detail',
  ]) startAsync(scope);

  appState.token = null;
  appState.user = null;
  appState.repos = [];
  appState.reposPage = 1;
  appState.reposHasMore = true;
  appState.repoSelected = 0;
  appState.repoScroll = 0;
  appState.events = [];
  appState.trending = [];
  appState.trendingPage = 1;
  appState.trendingHasMore = true;
  appState.notifications = [];
  appState.inboxPage = 1;
  appState.inboxHasMore = false;
  appState.selectedNotification = 0;
  appState.starred = [];
  appState.starredPage = 1;
  appState.starredHasMore = false;
  appState.entityCache = {};
  appState.actionsRepos = [];
  appState.actionsRuns = [];
  appState.actionsJobs = {};
  appState.repoDetails = null;
  appState.repoLanguages = null;
  appState.repoContributors = [];
  appState.repoReleases = [];
  appState.repoReleaseAssets = [];
  appState.repoIssues = [];
  appState.repoPullRequests = [];
  appState.repoTraffic = null;
  appState.repoTrafficClones = null;
  appState.repoTrafficPopularPaths = [];
  appState.repoTrafficPopularReferrers = [];
  appState.repoMilestones = [];
  appState.repoLabels = [];
  appState.repoCheckRuns = [];
  appState.repoCheckSuites = [];
  appState.repoDependabotAlerts = [];
  appState.secretScanningAlerts = [];
  appState.codeScanningAlerts = [];
  appState.securityAdvisories = [];
  appState.branchProtection = null;
  appState.dependencyManifests = [];
  appState.forks = [];
  appState.searchResults = [];
  appState.userSearchResults = [];
  appState.codeSearchResults = [];
  appState.filesEntries = [];
  appState.filesBranches = [];
  appState.filesPath = '';
  appState.fileViewing = null;
  appState.fileText = '';
  appState._readmeText = null;
  appState.showDetail = false;
  appState.detailData = null;
  appState.detailComments = [];
  appState.detailReviews = [];
  appState.detailFiles = [];
  appState.detailDiffContent = '';
  appState.detailDiffFile = null;
  appState.securityAlertDetail = null;
  appState.dashboardRecentIssues = [];
  appState.dashboardRecentPRs = [];
  appState.dashboardAttentionItems = [];
  appState.dashboardContributions = null;
  appState.dashboardStarHistory = [];
  appState.dashboardLoaded = false;
  appState.loading = false;
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
  // Local extension of utils.sectionHeader that ALSO draws an underline row
  // at y+1 — used for the Settings tab's left-column dividers.
  screen.writeStr(x, y, text, { fg: 'cyan', bold: true });
  const underlineEnd = Math.min(x + text.length + 4, maxW || screen.width);
  for (let i = x; i < underlineEnd; i++) {
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

  // Check gh CLI availability (async, cached after first check)
  if (appState._ghAvailable === undefined) {
    appState._ghAvailable = false; // assume not available until proven
    isGhInstalled().then(available => {
      if (appState._ghAvailable !== available) {
        appState._ghAvailable = available;
        render();
      }
    }).catch(() => {});
  }

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
  // Keep the cursor on an actionable row while asynchronous CLI detection
  // settles. In particular, PAT login must remain reachable when `gh` is
  // unavailable.
  const ghReady = appState._ghAvailable === true;
  if (!isCursorEnabled(appState.settingsCursor, ghReady)) {
    const firstEnabled = [...Array(9).keys()].find(cursor => isCursorEnabled(cursor, ghReady));
    if (firstEnabled != null) appState.settingsCursor = firstEnabled;
  }
  const authItems = [
    { label: 'Login (GitHub CLI)', desc: isLoggedIn ? 'Already logged in' : (ghReady ? 'Use gh auth token' : 'Install gh CLI first'), enabled: !isLoggedIn && ghReady, sel: appState.settingsCursor === 0 },
    { label: 'Login (PAT)',        desc: isLoggedIn ? 'Already logged in' : 'Paste a Personal Access Token', enabled: !isLoggedIn, sel: appState.settingsCursor === 1 },
    { label: 'Logout',             desc: isLoggedIn ? 'Sign out' : 'Not logged in', enabled: isLoggedIn,  sel: appState.settingsCursor === 2 },
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
    { label: 'Refresh Dashboard', desc: 'Re-fetch events, trending',   enabled: isLoggedIn, sel: appState.settingsCursor === 3 },
    { label: 'Refresh User Data', desc: 'Re-fetch profile and repos',  enabled: isLoggedIn, sel: appState.settingsCursor === 4 },
    { label: 'Auto-Refresh', desc: appState.autoRefreshEnabled ? 'Every ' + Math.round(appState.autoRefreshIntervalMs / 60000) + ' min' : 'Off', enabled: true, sel: appState.settingsCursor === 5 },
  ];
  for (const item of dataItems) {
    if (row >= y + sectionH) break;
    renderRow(screen, row, leftMaxW, item.label, item.desc, item.enabled, item.sel);
    rowBounds.push({ cursor: dataItems.indexOf(item) + 3, y: row });
    row++;
  }
  row += 2;

  // APPEARANCE
  sectionHeader(screen, 2, row, '◆ APPEARANCE', leftMaxW);
  row += 2;
  const themeItem = { label: 'Change Theme', desc: 'Current: ' + getThemeName(), enabled: true, sel: appState.settingsCursor === 6 };
  if (row < y + sectionH) {
    renderRow(screen, row, leftMaxW, themeItem.label, themeItem.desc, true, themeItem.sel);
    rowBounds.push({ cursor: 6, y: row });
    row++;
  }
  // Show all available themes as reflowing chip rows — wraps to fit any width.
  if (row < y + sectionH - 1) {
    row++;
    const themeChips = [];
    const accentColors = {
      default: 'cyan', light: 'blue',
    };

    const LABEL_X   = 2;   // left margin
    const CHIP_X    = 2;   // chips also start at left margin
    const SWATCH_W  = 2;   // '█' + space
    const GAP       = 2;   // space between chips
    const maxRight  = leftMaxW - 2;

    // Label on first row
    screen.writeStr(LABEL_X, row, 'Themes:', { dim: true });

    const themes = listThemes();
    let cx = LABEL_X + 'Themes: '.length;  // start after label on first row

    for (const t of themes) {
      const isCurrent = t === getThemeName();
      const accent = accentColors[t] || 'cyan';
      // Use theme's own accent color for the active chip background
      const accentStyle = isCurrent ? { bg: accent, fg: 'darkGray', bold: true } : { dim: true };
      const chipText = ' ' + t + ' ';
      const chipW = SWATCH_W + chipText.length;  // swatch + label

      // Wrap to next row if it won't fit — but only if we still have vertical room
      if (cx + chipW > maxRight) {
        row++;
        if (row >= y + sectionH - 1) break;  // no more vertical room
        cx = CHIP_X;
      }

      // Draw swatch block
      screen.writeStr(cx, row, '█', { fg: accent });
      // Draw chip label
      screen.writeStr(cx + SWATCH_W, row, chipText, accentStyle);

      themeChips.push({ theme: t, x1: cx, x2: cx + chipW, y: row });
      cx += chipW + GAP;
    }

    appState._themeChips = themeChips;
    row++;  // advance past last chip row
  }
  row++;  // blank line before next section

  // DANGER ZONE
  sectionHeader(screen, 2, row, '! DANGER ZONE', leftMaxW);
  row += 2;
  const dangerItems = [
    { label: 'Clear Saved Token', desc: 'Wipe token from all storage',  enabled: isLoggedIn, sel: appState.settingsCursor === 7 },
  ];
  for (const item of dangerItems) {
    if (row >= y + sectionH) break;
    const dangerStyle = item.sel
      ? { bg: 'red', fg: 'white', bold: true }
      : (item.enabled ? { fg: 'red', bold: true } : { dim: true });
    renderRow(screen, row, leftMaxW, item.label, item.desc, item.enabled, item.sel, dangerStyle);
    rowBounds.push({ cursor: 7, y: row });
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
    const starSel = appState.settingsCursor === 8;
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
    rowBounds.push({ cursor: 8, y: row });
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

  appState._maxSettingsCursor = 8;
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
    const age = cs.oldestTs ? Math.max(0, Math.floor((Date.now() - cs.oldestTs) / 60000)) + 'm oldest' : 'unknown age';
    lines.push(['Cache', cs.entries + ' entries, ' + cs.totalKB + ' KB', { dim: true }]);
    lines.push(['Cache age', age, { dim: true }]);
  }
  if (appState.user?.login) {
    lines.push(['Account', '@' + appState.user.login, { fg: 'cyan', bold: true }]);
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
  'o': () => openUrl('https://github.com/unn-Known1/github-tui').then(r => {
    if (r.ok) showMessage('Opened project page', 'success');
    else showMessage(r.error || 'Open failed', 'error');
  }),
  'c': () => {
    if (!appState.token) { showMessage('Login required to clear account cache', 'warning'); return; }
    const removed = clearAccountCache(appState.token);
    showMessage(removed ? 'Cleared ' + removed + ' cached account responses' : 'No cached account responses', 'success');
    render();
  },
};
const AUTH_ITEMS = [0, 1, 2];  // Login (CLI), Login (PAT), Logout
const DATA_ITEMS = [3, 4, 5];  // Refresh Dashboard, Refresh User Data, Auto-Refresh
const APPEARANCE_ITEMS = [6]; // Change Theme
const DANGER_ITEMS = [7];  // Clear Token
const ABOUT_ITEMS = [8];  // Star repo

export function isSettingsCursorEnabled(cursor, ghReady = appState._ghAvailable === true) {
  const isLoggedIn = !!appState.token;
  if (AUTH_ITEMS.includes(cursor)) {
    if (cursor === 0) return !isLoggedIn && ghReady;
    if (cursor === 1) return !isLoggedIn;
    return isLoggedIn;
  }
  if (DATA_ITEMS.includes(cursor)) {
    if (cursor === 5) return true;  // Auto-refresh is always available
    return isLoggedIn;
  }
  if (APPEARANCE_ITEMS.includes(cursor)) return true;
  if (DANGER_ITEMS.includes(cursor)) return isLoggedIn;
  if (ABOUT_ITEMS.includes(cursor)) return true;
  return false;
}

function isCursorEnabled(cursor) {
  return isSettingsCursorEnabled(cursor);
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
  const max = appState._maxSettingsCursor != null ? appState._maxSettingsCursor : 8;
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
      // Login with GitHub CLI
      if (!isLoggedIn) loginWithGh();
      else showMessage('Already logged in', 'info');
      break;
    case 1:
      // Login with PAT
      if (!isLoggedIn) startInput('PAT token: ', 'login', true);
      else showMessage('Already logged in', 'info');
      break;
    case 2:
      // Logout
      if (isLoggedIn) confirm('Log out of GitHub?', handleLogout, 'Log Out');
      else showMessage('Not logged in', 'warning');
      break;
    case 3:
      if (isLoggedIn) {
        appState.loading = true;
        render();
        refreshDashboard().finally(() => {
          appState.loading = false;
          render();
        });
        showMessage('Refreshing dashboard...', 'info');
      }
      break;
    case 4:
      if (isLoggedIn) {
        appState.loading = true;
        render();
        loadUserData().finally(() => { appState.loading = false; render(); });
        showMessage('Refreshing user data...', 'info');
      }
      break;
    case 5: {
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
    case 6: {
      const themes = listThemes();
      const curIdx = themes.indexOf(getThemeName());
      const nextIdx = (curIdx + 1) % themes.length;
      if (setTheme(themes[nextIdx])) showMessage('Theme: ' + themes[nextIdx], 'success');
      break;
    }
    case 7:
      if (isLoggedIn) confirm(
        'Wipe token and log out?\n\n' +
        'Current storage backend: ' + (tokenStorageBackend || 'plaintext') + '\n' +
        'This will remove the token from OS keychain (if available) ' +
        'and the plaintext fallback file.',
        () => {
          handleLogout();
          showMessage('Token wiped from all storage', 'success');
        },
        'Wipe Token'
      );
      break;
    case 8:
      starRepo();
      break;
  }
}
