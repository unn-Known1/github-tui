// Global key router.
// Order of resolution:
//   1. Palette open  -> palette handles everything.
//   2. Help overlay  -> any key closes it.
//   3. Input modal   -> input subsystem handles everything.
//   4. Tab-switch / global keys.
//   5. Per-tab key handlers from tab modules' keys map.
//   6. Per-tab arrow / enter / space dispatchers.

import { appState, tabState, setTab, showMessage, render, TABS, dismissConfirm, confirm } from './state.mjs';
import * as palette from './palette.mjs';
import { handleInputKey } from './input.mjs';
import { copyToClipboard, openUrl, notificationToHtmlUrl } from './utils.mjs';

import * as dashboard from './tabs/dashboard.mjs';
import * as repos     from './tabs/repos.mjs';
import * as analyze   from './tabs/analyze.mjs';
import * as settings  from './tabs/settings.mjs';
import * as inbox     from './tabs/inbox.mjs';
import * as detail    from './tabs/detail.mjs';
import { addBookmark, removeBookmark, isBookmarked, addSavedSearch, removeSavedSearch } from './store.mjs';
import { starRepo, unstarRepo, isStarred } from './github.mjs';
import { getScreen } from './render.mjs';

// Map tab index -> module. Used for keys lookup and arrow dispatchers.
const tabModules = [dashboard, repos, analyze, settings, inbox];

// ──────────────────────────────────────────────────────────────────
// Context helpers — figure out what the user is pointing at.
// ──────────────────────────────────────────────────────────────────
function currentRepoForAction() {
  if (tabState.current === 2) {
    const v = appState.analyzeView;
    if (v === 'results' && appState.searchResults[appState.selectedRepo])
      return appState.searchResults[appState.selectedRepo];
    if (v === 'details' && appState.repoDetails)
      return appState.repoDetails;
    if (v === 'forks' && appState.forks[appState.selectedFork])
      return appState.forks[appState.selectedFork];
  }
  if (tabState.current === 1 && appState.repos.length > 0) {
    return appState.repos[appState.repoSelected] || appState.repos[appState.repoScroll] || appState.repos[0];
  }
  return null;
}

function currentUrl() {
  if (tabState.current === 4 && appState.notifications[appState.selectedNotification]) {
    const n = appState.notifications[appState.selectedNotification];
    return notificationToHtmlUrl(n.subject && n.subject.url);
  }
  const r = currentRepoForAction();
  return r ? r.html_url : null;
}

async function openCurrent() {
  const url = currentUrl();
  if (!url) { showMessage('Nothing to open', 'warning'); return; }
  const res = await openUrl(url);
  if (res.ok) showMessage('Opened ' + url, 'success');
  else showMessage(res.error || 'Open failed', 'error');
}

function copyCurrentUrl() {
  const url = currentUrl();
  if (!url) { showMessage('Nothing to copy', 'warning'); return; }
  if (copyToClipboard(url)) showMessage('Copied to clipboard (OSC-52)', 'success');
  else showMessage('Clipboard copy failed', 'error');
}

async function toggleStar() {
  const r = currentRepoForAction();
  if (!r || !appState.token) { showMessage('Login + select a repo first', 'warning'); return; }
  const [owner, name] = r.full_name.split('/');
  try {
    const already = await isStarred(appState.token, owner, name);
    if (already) {
      await unstarRepo(appState.token, owner, name);
      showMessage('Unstarred ' + r.full_name, 'success');
    } else {
      await starRepo(appState.token, owner, name);
      showMessage('Starred ' + r.full_name, 'success');
    }
  } catch (e) { showMessage(e.message || 'Star failed', 'error'); }
}

function toggleBookmark() {
  const r = currentRepoForAction();
  if (!r) { showMessage('Select a repo first', 'warning'); return; }
  if (isBookmarked(r.full_name)) {
    removeBookmark(r.full_name);
    showMessage('Removed bookmark for ' + r.full_name, 'info');
  } else {
    addBookmark(r);
    showMessage('Bookmarked ' + r.full_name, 'success');
  }
  render();
}

function refreshCurrent() {
  const t = tabState.current;
  if (t === 0) {
    appState.dashboardLoaded = false;
    dashboard.loadDashboardWidgets(true);
    repos.loadUserData();
    showMessage('Refreshing dashboard...', 'info');
  } else if (t === 1) {
    repos.loadUserData();
  } else if (t === 2 && appState.analyzeView === 'details' && appState.repoDetails) {
    const [o, n] = appState.repoDetails.full_name.split('/');
    analyze.loadRepoDetails(o, n);
  } else if (t === 4) {
    inbox.loadNotifications();
  }
}

function quit() {
  process.stdout.write('\x1b[2J\x1b[H');
  process.exit(0);
}

// ──────────────────────────────────────────────────────────────────
// Main entry — process.stdin pipes every keystroke through here.
// ──────────────────────────────────────────────────────────────────
export function handleKey(key) {
  // 1. Palette captures all keys first.
  if (palette.handleKey(key)) return;

  // 1b. Detail popup captures keys when open.
  if (appState.showDetail) {
    if (key === '\x1b' || key === 'h' || key === '\x7f') { detail.handleBack(); return; }
    if (key === '\r' || key === '\n') { detail.enter(); return; }
    if (key === '\x1b[A' || key === 'k') { detail.up(); return; }
    if (key === '\x1b[B' || key === 'j') { detail.down(); return; }
    const mod = detail;
    if (mod.keys && typeof mod.keys[key] === 'function') {
      mod.keys[key]();
      return;
    }
    return;
  }

  // 2. Help overlay swallows the next key, whatever it is.
  if (appState.showHelp) {
    appState.showHelp = false;
    render();
    return;
  }

  // 2b. Confirmation dialog — 'y' executes, anything else dismisses.
  if (appState.confirmAction) {
    if (key === 'y' || key === 'Y') {
      const action = appState.confirmAction;
      appState.confirmAction = null;
      appState.confirmMessage = '';
      action();
    } else {
      dismissConfirm();
    }
    return;
  }

  // 3. Input modal.
  if (handleInputKey(key)) return;

  // 4. Tab-switch + globals.
  switch (key) {
    case '1': case '2': case '3': case '4': case '5': {
      const i = parseInt(key, 10) - 1;
      setTab(i);
      // Auto-load Inbox on first visit.
      if (i === 4 && appState.notifications.length === 0 && appState.token) {
        inbox.loadNotifications();
      }
      return;
    }
    case 'q': case '\x03': quit(); return;
    case '\t': setTab((tabState.current + 1) % TABS.length); return;
    case '\x1b[Z': setTab((tabState.current - 1 + TABS.length) % TABS.length); return;
    case '?': appState.showHelp = true; render(); return;
    case '\x10':  // Ctrl-P
    case ':':
      palette.open(); return;
    case 'r': refreshCurrent(); return;
    case 'o': openCurrent(); return;
    case 'y': copyCurrentUrl(); return;
    case 'b': toggleBookmark(); return;
    case '\r': case '\n': handleEnter(); return;
    case '\x1b[A': case 'k': handleUp(); return;
    case '\x1b[B': case 'j': handleDown(); return;
    case '\x1b[D': case 'h': case '\x7f':
      if (tabState.current === 2) analyze.handleBack();
      return;
    case ' ': handleSpace(); return;
    case 'G': {
      // 'G' = jump to bottom (vim convention). Tab-aware so it doesn't
      // collide with the Files-pane 'G' (gh clone) — that one fires only
      // when we're on the files pane, which is a per-tab key.
      const screen = getScreen();
      if (tabState.current === 1 && typeof repos.bottom === 'function') {
        repos.bottom(screen); return;
      }
      // Fall through to per-tab key map so analyze can route to files.
      break;
    }
  }

  // 5. Global star toggle — '*' so it doesn't conflict with per-tab 's' keys
  //    (forks sort-by-stars, repos sort-by-stars).
  if (key === '*' && currentRepoForAction()) { toggleStar(); return; }

  // 6. Per-tab key map.
  const mod = tabModules[tabState.current];
  if (mod && mod.keys && typeof mod.keys[key] === 'function') {
    mod.keys[key]();
    return;
  }

  // 7. Dashboard quick actions: 'n' opens new issue page.
  if (tabState.current === 0 && key === 'n') {
    const repos = appState.repos;
    if (repos.length > 0) {
      const url = repos[0].html_url + '/issues/new';
      openUrl(url).then(res => {
        if (res.ok) showMessage('Opened new issue page', 'success');
        else showMessage(res.error || 'Open failed', 'error');
      });
    } else {
      showMessage('No repos to create issues for', 'warning');
    }
    return;
  }
}

function handleSpace() {
  const t = tabState.current;
  if (t === 0) dashboard.loadMoreTrending();
  else if (t === 1) repos.space();
  else if (t === 2) analyze.space();
  else if (t === 4) inbox.space();
}
function handleEnter() {
  const t = tabState.current;
  if (t === 0) dashboard.openTrendingRepo();
  else if (t === 1) repos.enter();
  else if (t === 2) analyze.enter();
  else if (t === 3) settings.enter();
  else if (t === 4) inbox.enter();
}
function handleUp() {
  const t = tabState.current;
  const screen = getScreen();
  if (t === 0) { dashboard.up(); return; }
  if (t === 1) repos.up(screen);
  else if (t === 2) analyze.up(screen);
  else if (t === 3) settings.up();
  else if (t === 4) inbox.up();
}
function handleDown() {
  const t = tabState.current;
  const screen = getScreen();
  if (t === 0) { dashboard.down(); return; }
  if (t === 1) repos.down(screen);
  else if (t === 2) analyze.down(screen);
  else if (t === 3) settings.down();
  else if (t === 4) inbox.down(screen);
}

// ──────────────────────────────────────────────────────────────────
// Palette action registry.
// ──────────────────────────────────────────────────────────────────
export function registerCoreActions() {
  const reg = palette.register;

  TABS.forEach((t, i) => reg({
    id: 'tab.' + t.label.toLowerCase(),
    label: 'Go to ' + t.label,
    hint: 'tab ' + (i + 1),
    run: () => setTab(i),
  }));

  reg({ id: 'refresh', label: 'Refresh current view',         hint: 'r', run: refreshCurrent });
  reg({ id: 'open',    label: 'Open current item in browser', hint: 'o', run: openCurrent });
  reg({ id: 'copy',    label: 'Copy current URL to clipboard', hint: 'y', run: copyCurrentUrl });
  reg({ id: 'help',    label: 'Show help overlay',            hint: '?',
        run: () => { appState.showHelp = true; render(); } });
  reg({ id: 'quit',    label: 'Quit application',             hint: 'q', run: quit });

  reg({ id: 'star.toggle',     label: 'Star / unstar current repo',         hint: '*', run: toggleStar });
  reg({ id: 'bookmark.toggle', label: 'Bookmark / unbookmark current repo', hint: 'b', run: toggleBookmark });

  reg({ id: 'repos.sort.name',    label: 'Sort repos by name',    run: () => { setTab(1); repos.keys.n(); } });
  reg({ id: 'repos.sort.stars',   label: 'Sort repos by stars',   run: () => { setTab(1); repos.keys.S(); } });
  reg({ id: 'repos.sort.updated', label: 'Sort repos by updated', run: () => { setTab(1); repos.keys.u(); } });
  reg({ id: 'repos.filter',       label: 'Filter your repositories...',
        run: () => { setTab(1); repos.keys['/'](); } });
  reg({ id: 'repos.clear-filter', label: 'Clear all repos filters',
        run: () => { setTab(1); repos.keys.c(); } });
  reg({ id: 'repos.type', label: 'Cycle repos type filter (all/sources/forks/...)',
        run: () => { setTab(1); repos.keys.t(); } });
  reg({ id: 'repos.lang', label: 'Filter repos by language...',
        run: () => { setTab(1); repos.keys.L(); } });
  reg({ id: 'repos.stale', label: 'Toggle stale-only filter (no push 6+ months)',
        run: () => { setTab(1); repos.keys.x(); } });
  reg({ id: 'repos.starred', label: 'View starred repos',
        run: () => { setTab(1); repos.toggleReposView(); } });
  reg({ id: 'repos.density', label: 'Toggle Repos density (compact / comfortable)',
        run: () => { setTab(1); repos.keys.D(); } });
  reg({ id: 'repos.pin', label: 'Pin / unpin highlighted repo',
        run: () => { setTab(1); repos.keys.P(); } });
  reg({ id: 'analyze.files', label: 'Open File explorer for current repo',
        run: () => {
          if (!appState.repoDetails) { showMessage('Open a repo on Analyze first', 'warning'); return; }
          setTab(2);
          analyze.keys.F();
        }});

  reg({ id: 'analyze.search', label: 'Search public repositories...',
        run: () => { setTab(2); analyze.keys.i(); } });
  reg({ id: 'analyze.readme', label: 'View README of current repo',
        run: () => { if (appState.repoDetails) analyze.keys.R(); } });

  reg({ id: 'inbox.refresh',     label: 'Inbox: refresh notifications',       run: inbox.loadNotifications });
  reg({ id: 'inbox.mark.read',   label: 'Inbox: mark current thread as read', run: inbox.markCurrentRead });
  reg({ id: 'inbox.mark.all',    label: 'Inbox: mark all as read',            run: inbox.markAllRead });
  reg({ id: 'inbox.unsubscribe', label: 'Inbox: unsubscribe from thread',     run: inbox.unsubscribeCurrent });
  reg({ id: 'inbox.cycle',       label: 'Inbox: cycle filter',                run: inbox.cycleFilter });

  reg({ id: 'settings.theme',  label: 'Change theme...',
        run: () => { setTab(3); appState.settingsCursor = 4; render(); settings.enter(); } });
  reg({ id: 'settings.logout', label: 'Log out', run: () => confirm('Log out of GitHub?', settings.handleLogout) });
  reg({ id: 'dashboard.refresh', label: 'Refresh dashboard widgets',
        run: () => dashboard.loadDashboardWidgets(true) });
  reg({ id: 'dashboard.new-issue', label: 'Dashboard: Create new issue',
        run: () => {
          if (appState.repos.length > 0) {
            openUrl(appState.repos[0].html_url + '/issues/new');
          } else {
            showMessage('No repos to create issues for', 'warning');
          }
        } });

  reg({ id: 'detail.comment', label: 'Comment on current issue/PR',
        run: () => { if (appState.showDetail) detail.openCommentInput(); } });
  reg({ id: 'detail.close', label: 'Close / Reopen current issue/PR',
        run: () => { if (appState.showDetail) detail.closeOrReopen(); } });
  reg({ id: 'detail.merge', label: 'Merge current PR',
        run: () => { if (appState.showDetail) detail.mergePR(); } });
  reg({ id: 'detail.react', label: 'Add reaction to current issue/PR',
        run: () => { if (appState.showDetail) detail.toggleReactionPicker(); } });

  // Saved searches
  reg({ id: 'search.save', label: 'Save current search query...',
        run: () => {
          if (!appState.searchQuery) { showMessage('No search query to save', 'warning'); return; }
          startInput('Label for this search: ', 'save-search');
        } });
  appState.savedSearches.forEach(s => {
    reg({ id: 'search.run.' + s.id, label: 'Run saved search: ' + s.label,
          hint: s.query,
          run: () => {
            setTab(2);
            appState.analyzeView = 'search';
            submitSearch(s.query);
          } });
    reg({ id: 'search.delete.' + s.id, label: 'Delete saved search: ' + s.label,
          run: () => {
            removeSavedSearch(s.id);
            appState.savedSearches = appState.savedSearches.filter(x => x.id !== s.id);
            showMessage('Deleted saved search: ' + s.label, 'success');
          } });
  });
}

import { submitSearch } from './tabs/analyze.mjs';
