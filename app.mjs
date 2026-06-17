#!/usr/bin/env node

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import {
  getAuthenticatedUser,
  searchRepositories,
  getRepositoryDetails,
  getUserRepositories,
} from './tui/github.mjs';
import { Screen } from './tui/screen.mjs';

const CONFIG_DIR = join(homedir(), '.github-tui');
const TOKEN_FILE = join(CONFIG_DIR, 'token');

const TABS = [
  { key: '1', label: 'Dashboard' },
  { key: '2', label: 'Repos' },
  { key: '3', label: 'Analyze' },
  { key: '4', label: 'Settings' },
];

let currentTab = 0;
let screen = null;
let appState = {
  token: null,
  user: null,
  repos: [],
  searchQuery: '',
  searchResults: [],
  selectedRepo: 0,
  repoDetails: null,
  analyzeView: 'search',
  loading: false,
  message: null,
  messageTimer: null,
  inputMode: null,
  inputBuffer: '',
  inputPrompt: '',
  settingsCursor: 0,
  repoScroll: 0,
  searchScroll: 0,
};

function loadToken() {
  if (existsSync(TOKEN_FILE)) {
    return readFileSync(TOKEN_FILE, 'utf-8').trim();
  }
  return null;
}

function saveToken(token) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, token);
}

function removeToken() {
  if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE);
}

function showMessage(text, type = 'info') {
  appState.message = { text, type };
  if (appState.messageTimer) clearTimeout(appState.messageTimer);
  appState.messageTimer = setTimeout(() => {
    appState.message = null;
    render();
  }, 3000);
}

async function loadUserData() {
  if (!appState.token) return;
  appState.loading = true;
  render();
  try {
    appState.user = await getAuthenticatedUser(appState.token);
    if (appState.user) {
      appState.repos = await getUserRepositories(appState.token, 1, 50);
    }
  } catch (e) {
    showMessage('Failed to load user data', 'error');
  }
  appState.loading = false;
  render();
}

function render() {
  if (!screen) return;
  const W = screen.width;
  const H = screen.height;
  screen.clear();

  screen.box(0, 0, W, 3, 'GitHub TUI');
  if (appState.user) {
    screen.writeStr(2, 1, `Welcome, ${appState.user.login}`);
    if (appState.user.plan) {
      screen.writeStr(W - 15, 1, `Plan: ${appState.user.plan.name}`, 'dim');
    }
  } else {
    screen.writeStr(2, 1, 'Not authenticated', 'dim');
  }

  screen.hline(3, '─');

  const tabWidth = Math.floor((W - 2) / TABS.length);
  TABS.forEach((tab, i) => {
    const isActive = i === currentTab;
    const bx = 1 + i * tabWidth;
    const label = `[${tab.key}] ${tab.label}`;
    const pad = Math.floor((tabWidth - label.length) / 2);
    const tx = bx + Math.max(0, pad);
    screen.writeStr(tx, 5, label, isActive ? 'bright' : 'dim');
  });

  screen.hline(6, '─');

  const contentY = 7;
  const contentH = H - 10;

  switch (currentTab) {
    case 0: renderDashboard(contentY, contentH); break;
    case 1: renderRepos(contentY, contentH); break;
    case 2: renderAnalyze(contentY, contentH); break;
    case 3: renderSettings(contentY, contentH); break;
  }

  screen.hline(H - 3, '─');

  let statusLeft;
  if (appState.inputMode) {
    statusLeft = `[ESC] Cancel  [Enter] Confirm`;
  } else if (currentTab === 2) {
    const v = appState.analyzeView;
    if (v === 'search') {
      statusLeft = `[Enter/i] Search  [1-4] Tabs  [q] Quit`;
    } else if (v === 'results') {
      statusLeft = `[↑↓jk] Navigate  [Enter] View  [Esc/i] Back  [q] Quit`;
    } else {
      statusLeft = `[Esc/h] Back  [i] New search  [1-4] Tabs  [q] Quit`;
    }
  } else {
    statusLeft = `[1-4] Tabs  [↑↓jk] Nav  [Enter] Select  [q] Quit`;
  }

  screen.writeStr(1, H - 2, statusLeft, 'dim');

  if (appState.message) {
    const colors = { info: 'cyan', success: 'green', error: 'red', warning: 'yellow' };
    const msg = appState.message.text;
    const mx = Math.max(1, W - msg.length - 2);
    screen.writeStr(mx, H - 2, msg, colors[appState.message.type]);
  } else if (appState.loading) {
    screen.writeStr(W - 14, H - 2, '⟳ Loading...', 'cyan');
  }

  screen.render();
}

function renderDashboard(y, h) {
  const W = screen.width;
  const user = appState.user;

  if (!user) {
    screen.writeStr(4, y + 2, 'Not authenticated. Go to Settings [4] to login.', 'dim');
    return;
  }

  screen.writeStr(4, y, 'Account Information', 'bright');
  screen.hline(y + 1, '─');

  const info = [
    ['Login:', user.login],
    ['Name:', user.name || 'N/A'],
    ['Email:', user.email || 'N/A'],
    ['Bio:', user.bio || 'N/A'],
    ['Public Repos:', String(user.public_repos || 0)],
    ['Private Repos:', String(user.total_private_repos || 0)],
    ['Followers:', String(user.followers || 0)],
    ['Following:', String(user.following || 0)],
  ];

  info.forEach(([key, val], i) => {
    if (y + 2 + i >= y + h) return;
    screen.writeStr(4, y + 2 + i, key, 'bright');
    screen.writeStr(18, y + 2 + i, String(val).substring(0, W - 22));
  });

  const repoY = y + 12;
  if (repoY + 1 >= y + h) return;

  screen.writeStr(4, repoY, 'Recent Repositories', 'bright');
  screen.hline(repoY + 1, '─');

  const repos = appState.repos.slice(0, Math.min(5, h - 16));
  repos.forEach((repo, i) => {
    if (repoY + 2 + i >= y + h) return;
    screen.writeStr(4, repoY + 2 + i, `● ${repo.name}`);
    screen.writeStr(32, repoY + 2 + i, `★${repo.stargazers_count} ⑂${repo.forks_count}`, 'dim');
  });
}

function renderRepos(y, h) {
  const W = screen.width;
  const repos = appState.repos;

  if (!repos || repos.length === 0) {
    screen.writeStr(4, y + 2, 'No repositories found', 'dim');
    return;
  }

  screen.writeStr(4, y, 'Your Repositories', 'bright');
  screen.hline(y + 1, '─');

  const cols = [
    { label: 'Name', x: 4, w: 24 },
    { label: '★', x: 28, w: 8 },
    { label: '⑂', x: 36, w: 8 },
    { label: 'Issues', x: 44, w: 8 },
    { label: 'Updated', x: 54, w: 12 },
  ];

  cols.forEach(c => screen.writeStr(c.x, y + 2, c.label, 'bright'));

  const maxRows = Math.min(repos.length, h - 5);
  const start = appState.repoScroll;

  for (let i = 0; i < maxRows && start + i < repos.length; i++) {
    const repo = repos[start + i];
    const row = y + 3 + i;
    screen.writeStr(4, row, (repo.name || 'N/A').substring(0, 23));
    screen.writeStr(28, row, String(repo.stargazers_count || 0));
    screen.writeStr(36, row, String(repo.forks_count || 0));
    screen.writeStr(44, row, String(repo.open_issues_count || 0));
    screen.writeStr(54, row, new Date(repo.updated_at).toLocaleDateString());
  }

  const infoY = y + 3 + maxRows + 1;
  if (infoY < y + h) {
    screen.writeStr(4, infoY, `${start + 1}-${Math.min(start + maxRows, repos.length)} of ${repos.length}`, 'dim');
  }
}

function renderAnalyze(y, h) {
  const W = screen.width;
  const view = appState.analyzeView;

  screen.writeStr(4, y, 'Analyze Public Repository', 'bright');
  screen.hline(y + 1, '─');

  if (view === 'search') {
    screen.writeStr(4, y + 2, 'Search:', 'bright');
    if (appState.inputMode === 'search') {
      screen.writeStr(12, y + 2, `${appState.inputPrompt}${appState.inputBuffer}█`.substring(0, W - 16));
    } else {
      screen.writeStr(12, y + 2, '(press Enter or i to search)', 'dim');
    }
    screen.writeStr(4, y + 4, 'Search for any public GitHub repository to analyze.', 'dim');
    screen.writeStr(4, y + 5, 'Type owner/repo or keywords, then press Enter.', 'dim');
    return;
  }

  screen.writeStr(4, y + 2, 'Search:', 'bright');
  screen.writeStr(12, y + 2, appState.searchQuery || '');

  const listY = y + 4;
  const maxVisible = Math.min(8, h - 9);

  if (appState.searchResults.length > 0) {
    screen.writeStr(4, listY, `Results: ↑↓ navigate  Enter view details  Esc back`, 'dim');
    screen.hline(listY + 1, '─');

    const start = appState.searchScroll;
    for (let i = 0; i < maxVisible && start + i < appState.searchResults.length; i++) {
      const repo = appState.searchResults[start + i];
      const row = listY + 2 + i;
      const sel = start + i === appState.selectedRepo;

      screen.writeStr(4, row, sel ? ' ▶' : '  ');
      screen.writeStr(7, row, repo.full_name.substring(0, 28), sel ? 'bright' : null);
      screen.writeStr(36, row, `★${repo.stargazers_count} ⑂${repo.forks_count} ⚡${repo.open_issues_count}`, 'dim');
    }

    const countY = listY + 2 + maxVisible;
    if (countY < y + h) {
      const total = appState.searchResults.length;
      screen.writeStr(4, countY, `${start + 1}-${Math.min(start + maxVisible, total)} of ${total}`, 'dim');
    }
  } else if (!appState.loading) {
    screen.writeStr(4, listY + 1, 'No results found', 'dim');
  }

  if (view === 'details' && appState.repoDetails) {
    const dY = listY + maxVisible + 4;
    if (dY < y + h) {
      renderRepoDetails(dY, y + h - dY);
    }
  }
}

function renderRepoDetails(y, maxH) {
  const repo = appState.repoDetails;
  if (!repo) return;
  const W = screen.width;

  screen.writeStr(4, y, `▸ ${repo.full_name}`, 'bright');
  screen.hline(y + 1, '─');

  const details = [
    ['Description:', repo.description || 'N/A'],
    ['Language:', repo.language || 'N/A'],
    ['Stars:', String(repo.stargazers_count || 0)],
    ['Forks:', String(repo.forks_count || 0)],
    ['Open Issues:', String(repo.open_issues_count || 0)],
    ['Watchers:', String(repo.watchers_count || 0)],
    ['Size:', `${Math.round((repo.size || 0) / 1024)} MB`],
    ['License:', repo.license?.name || 'N/A'],
    ['Created:', new Date(repo.created_at).toLocaleDateString()],
    ['Updated:', new Date(repo.updated_at).toLocaleDateString()],
    ['URL:', repo.html_url],
  ];

  const rows = Math.min(details.length, maxH - 2);
  for (let i = 0; i < rows; i++) {
    const [key, val] = details[i];
    screen.writeStr(4, y + 2 + i, key, 'bright');
    screen.writeStr(18, y + 2 + i, String(val).substring(0, W - 22));
  }
}

function renderSettings(y, h) {
  const W = screen.width;
  const isLoggedIn = !!appState.token;

  screen.writeStr(4, y, 'Settings', 'bright');
  screen.hline(y + 1, '─');

  const items = [
    { label: 'Login', desc: isLoggedIn ? 'Already logged in' : 'Press Enter to login' },
    { label: 'Logout', desc: isLoggedIn ? 'Press Enter to logout' : 'Not logged in' },
    { label: 'Token', desc: isLoggedIn ? '••••••••••••' : 'Not set' },
  ];

  items.forEach((item, i) => {
    const row = y + 2 + i;
    const sel = appState.settingsCursor === i;
    screen.writeStr(4, row, sel ? ' ▶ ' : '   ');
    screen.writeStr(7, row, item.label, sel ? 'bright' : null);
    screen.writeStr(24, row, item.desc, 'dim');
  });

  const helpY = y + 7;
  if (helpY + 3 < y + h) {
    screen.writeStr(4, helpY, 'Keys:', 'bright');
    screen.writeStr(4, helpY + 1, '  ↑/↓ or j/k  Navigate', 'dim');
    screen.writeStr(4, helpY + 2, '  Enter        Select', 'dim');
  }
}

function startInput(prompt) {
  appState.inputMode = 'search';
  appState.inputBuffer = '';
  appState.inputPrompt = prompt;
  render();
}

function cancelInput() {
  appState.inputMode = null;
  appState.inputBuffer = '';
  appState.inputPrompt = '';
  render();
}

async function submitSearch() {
  const query = appState.inputBuffer.trim();
  if (!query) {
    cancelInput();
    return;
  }

  appState.loading = true;
  appState.searchQuery = query;
  appState.inputMode = null;
  appState.inputBuffer = '';
  appState.inputPrompt = '';
  appState.repoDetails = null;
  appState.selectedRepo = 0;
  appState.searchScroll = 0;
  appState.analyzeView = 'results';
  render();

  try {
    appState.searchResults = await searchRepositories(appState.token, query);
    if (appState.searchResults.length === 0) {
      showMessage('No repositories found', 'warning');
    }
  } catch (e) {
    showMessage('Search failed', 'error');
  }

  appState.loading = false;
  render();
}

async function submitLogin() {
  const token = appState.inputBuffer.trim();
  appState.inputMode = null;
  appState.inputBuffer = '';

  if (!token) {
    showMessage('Token cannot be empty', 'error');
    render();
    return;
  }

  appState.loading = true;
  render();

  try {
    const user = await getAuthenticatedUser(token);
    if (user) {
      saveToken(token);
      appState.token = token;
      appState.user = user;
      appState.repos = await getUserRepositories(token, 1, 50);
      showMessage(`Logged in as ${user.login}`, 'success');
    } else {
      showMessage('Invalid token', 'error');
    }
  } catch (e) {
    showMessage('Login failed', 'error');
  }

  appState.loading = false;
  render();
}

async function loadRepoDetails(owner, name) {
  appState.loading = true;
  render();
  try {
    appState.repoDetails = await getRepositoryDetails(appState.token, owner, name);
    appState.analyzeView = 'details';
    showMessage(`Loaded ${owner}/${name}`, 'success');
  } catch (e) {
    showMessage('Failed to load repository', 'error');
  }
  appState.loading = false;
  render();
}

async function handleLogout() {
  appState.token = null;
  appState.user = null;
  appState.repos = [];
  removeToken();
  showMessage('Logged out', 'success');
  render();
}

function handleKey(key) {
  if (appState.inputMode === 'search') {
    if (key === '\r' || key === '\n') {
      if (appState.analyzeView === 'search') {
        submitSearch();
      } else {
        submitLogin();
      }
    } else if (key === '\x1b') {
      cancelInput();
    } else if (key === '\x7f' || key === '\b') {
      appState.inputBuffer = appState.inputBuffer.slice(0, -1);
      render();
    } else if (key.length === 1 && key.charCodeAt(0) >= 32) {
      appState.inputBuffer += key;
      render();
    }
    return;
  }

  switch (key) {
    case '1': case '2': case '3': case '4':
      currentTab = parseInt(key) - 1;
      render();
      break;

    case 'q': case '\x03':
      process.stdout.write('\x1b[2J\x1b[H');
      process.exit(0);
      break;

    case '\t':
      currentTab = (currentTab + 1) % TABS.length;
      render();
      break;

    case '\x1b[Z':
      currentTab = (currentTab - 1 + TABS.length) % TABS.length;
      render();
      break;

    case '\r': case '\n':
      handleEnter();
      break;

    case '\x1b[A': case 'k':
      handleUp();
      break;

    case '\x1b[B': case 'j':
      handleDown();
      break;

    case '\x1b[D': case 'h': case '\x7f':
      if (currentTab === 2) {
        handleBack();
      }
      break;

    case 'i':
      if (currentTab === 2) {
        if (appState.analyzeView === 'details') {
          appState.repoDetails = null;
          appState.analyzeView = 'results';
          render();
        } else {
          appState.repoDetails = null;
          appState.searchResults = [];
          appState.searchQuery = '';
          appState.analyzeView = 'search';
          startInput('Search repos: ');
        }
      } else if (currentTab === 3 && !appState.token) {
        startInput('PAT token: ');
      }
      break;
  }
}

function handleBack() {
  if (appState.analyzeView === 'details') {
    appState.repoDetails = null;
    appState.analyzeView = 'results';
    render();
  } else if (appState.analyzeView === 'results') {
    appState.repoDetails = null;
    appState.searchResults = [];
    appState.searchQuery = '';
    appState.analyzeView = 'search';
    render();
  }
}

async function handleEnter() {
  switch (currentTab) {
    case 2:
      if (appState.analyzeView === 'results' && appState.searchResults.length > 0) {
        const repo = appState.searchResults[appState.selectedRepo];
        if (repo) {
          const [owner, name] = repo.full_name.split('/');
          await loadRepoDetails(owner, name);
        }
      } else if (appState.analyzeView === 'search') {
        startInput('Search repos: ');
      }
      break;
    case 3:
      if (appState.settingsCursor === 0 && !appState.token) {
        startInput('PAT token: ');
      } else if (appState.settingsCursor === 1 && appState.token) {
        await handleLogout();
      }
      break;
  }
}

function handleUp() {
  switch (currentTab) {
    case 1: {
      appState.repoScroll = Math.max(0, appState.repoScroll - 1);
      render();
      break;
    }
    case 2: {
      if (appState.analyzeView === 'results' && appState.searchResults.length > 0) {
        if (appState.selectedRepo > appState.searchScroll) {
          appState.selectedRepo--;
        } else if (appState.searchScroll > 0) {
          appState.searchScroll--;
          appState.selectedRepo--;
        }
        render();
      }
      break;
    }
    case 3:
      appState.settingsCursor = Math.max(0, appState.settingsCursor - 1);
      render();
      break;
  }
}

function handleDown() {
  switch (currentTab) {
    case 1: {
      const maxRows = Math.min(appState.repos.length, screen.height - 10);
      const maxScroll = Math.max(0, appState.repos.length - maxRows);
      appState.repoScroll = Math.min(maxScroll, appState.repoScroll + 1);
      render();
      break;
    }
    case 2: {
      const maxVisible = Math.min(8, screen.height - 16);
      if (appState.analyzeView === 'results' && appState.searchResults.length > 0) {
        if (appState.selectedRepo < appState.searchScroll + maxVisible - 1) {
          appState.selectedRepo = Math.min(appState.searchResults.length - 1, appState.selectedRepo + 1);
        } else if (appState.searchScroll + maxVisible < appState.searchResults.length) {
          appState.searchScroll++;
          appState.selectedRepo = Math.min(appState.searchResults.length - 1, appState.selectedRepo + 1);
        }
        render();
      }
      break;
    }
    case 3:
      appState.settingsCursor = Math.min(2, appState.settingsCursor + 1);
      render();
      break;
  }
}

async function init() {
  if (!process.stdin.isTTY) {
    console.log('GitHub TUI requires an interactive terminal.');
    console.log('Usage: node app.mjs');
    process.exit(1);
  }

  process.stdout.write('\x1b[?25l');

  screen = new Screen();
  appState.token = loadToken();

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', handleKey);

  process.stdout.on('resize', () => {
    screen.updateSize();
    render();
  });

  screen.updateSize();

  const cleanup = () => {
    process.stdout.write('\x1b[?25h\x1b[2J\x1b[H');
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  if (appState.token) {
    await loadUserData();
  }

  render();
}

init().catch(e => {
  console.error(e);
  process.exit(1);
});
