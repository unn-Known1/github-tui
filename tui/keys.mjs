// Global key router.
// Order of resolution:
//   1. Palette open  -> palette handles everything.
//   2. Onboarding / welcome -> onboarding handles everything.
//   3. Help overlay  -> any key closes it (except arrow keys for scroll, / for search).
//   4. Detail popup  -> detail handles everything.
//   5. Input modal   -> input subsystem handles everything.
//   6. Tab-switch / global keys.
//   7. Per-tab key handlers from tab modules' keys map.
//   8. Per-tab arrow / enter / space dispatchers.

import { appState, tabState, setTab, showMessage, render, TABS, dismissConfirm, confirm } from './state.mjs';
import * as palette from './palette.mjs';
import * as onboarding from './tabs/onboarding.mjs';
import { handleInputKey } from './input.mjs';
import { copyToClipboard, openUrl, notificationToHtmlUrl } from './utils.mjs';
import { startInput, registerInputHandler } from './input.mjs';

import * as dashboard from './tabs/dashboard.mjs';
import * as repos     from './tabs/repos.mjs';
import * as analyze   from './tabs/analyze.mjs';
import * as settings  from './tabs/settings.mjs';
import * as inbox     from './tabs/inbox.mjs';
import * as detail    from './tabs/detail.mjs';
import * as actions   from './tabs/actions.mjs';
import * as help      from './tabs/help.mjs';
import { addBookmark, removeBookmark, isBookmarked, addSavedSearch, removeSavedSearch, loadBookmarks } from './store.mjs';
import { starRepo, unstarRepo, isStarred, createIssue, getSubscription, setSubscription, deleteSubscription } from './github.mjs';
import { getScreen } from './render.mjs';
import { parseMouseEvent, handleMouseEvent } from './mouse.mjs';

const tabModules = [dashboard, repos, analyze, settings, inbox, actions];

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

async function toggleWatch() {
  const r = currentRepoForAction();
  if (!r || !appState.token) { showMessage('Login + select a repo first', 'warning'); return; }
  const [owner, name] = r.full_name.split('/');
  try {
    let sub;
    try { sub = await getSubscription(appState.token, owner, name); } catch (e) { sub = null; }
    if (sub && sub.subscribed) {
      await deleteSubscription(appState.token, owner, name);
      showMessage('Unwatched ' + r.full_name, 'info');
    } else {
      await setSubscription(appState.token, owner, name, true);
      showMessage('Watching ' + r.full_name + ' (all activity)', 'success');
    }
  } catch (e) { showMessage(e.message || 'Watch toggle failed', 'error'); }
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
  } else if (t === 5) {
    actions.loadActionsRepos();
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
  // 0. Mouse events (SGR or legacy X10 format).
  const mouseEvent = parseMouseEvent(key);
  if (mouseEvent) {
    handleMouseEvent(mouseEvent);
    return;
  }

  // 1. Palette captures all keys first.
  if (palette.handleKey(key)) return;

  // 1a. Onboarding / What's new captures all keys.
  if (appState.showOnboarding || appState.showWelcome) {
    onboarding.handleOnboardingKey(key);
    return;
  }

  // 1aa. Bookmarks overlay.
  if (appState.showBookmarks) {
    if (key === '\x1b' || key === 'q' || key === 'b') { appState.showBookmarks = false; render(); return; }
    if (key === '\x1b[A' || key === 'k') {
      appState.bookmarksCursor = Math.max(0, appState.bookmarksCursor - 1);
      render(); return;
    }
    if (key === '\x1b[B' || key === 'j') {
      const max = appState.bookmarks.length - 1;
      appState.bookmarksCursor = Math.min(max, appState.bookmarksCursor + 1);
      render(); return;
    }
    if (key === '\r' || key === '\n') {
      const bm = appState.bookmarks[appState.bookmarksCursor];
      if (bm && bm.url) {
        openUrl(bm.url).then(res => {
          if (res.ok) showMessage('Opened ' + bm.full_name, 'success');
          else showMessage(res.error || 'Open failed', 'error');
        });
      }
      appState.showBookmarks = false;
      render();
      return;
    }
    if (key === 'd' || key === 'D') {
      const bm = appState.bookmarks[appState.bookmarksCursor];
      if (bm) {
        removeBookmark(bm.id || bm.full_name);
        appState.bookmarks = loadBookmarks();
        appState.bookmarksCursor = Math.min(appState.bookmarksCursor, Math.max(0, appState.bookmarks.length - 1));
        showMessage('Removed bookmark: ' + bm.full_name, 'info');
      }
      render();
      return;
    }
    if (key === 'y') {
      const bm = appState.bookmarks[appState.bookmarksCursor];
      if (bm && bm.url && copyToClipboard(bm.url)) showMessage('Copied URL', 'success');
      else showMessage('Clipboard copy failed', 'error');
      render();
      return;
    }
    return;
  }

  // 1b. Help overlay: handle special keys, any other key closes.
  if (appState.showHelp) {
    if (key === '\x1b' || key === 'q') { appState.showHelp = false; render(); return; }
    if (key === '\x1b[A' || key === 'k') { help.scrollHelp(-3, 200, 18); render(); return; }
    if (key === '\x1b[B' || key === 'j') { help.scrollHelp(3, 200, 18); render(); return; }
    if (key === 'g') { help.setHelpQuery(''); appState.helpCursor = 0; render(); return; }
    if (key === '\x7f' || key === '\b') {
      const q = appState.helpQuery || '';
      help.setHelpQuery(q.slice(0, -1));
      render();
      return;
    }
    if (key === '/') {
      // Already in search mode; treat as literal.
      help.setHelpQuery((appState.helpQuery || '') + '/');
      render();
      return;
    }
    if (key === 'n') { help.scrollHelp(3, 200, 18); render(); return; }
    if (key === 'p') { help.scrollHelp(-3, 200, 18); render(); return; }
    if (key.length === 1 && key.charCodeAt(0) >= 32) {
      help.setHelpQuery((appState.helpQuery || '') + key);
      render();
      return;
    }
    return;
  }

  // 1c. Detail popup captures keys when open.
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

  // 2. Confirmation dialog — 'y' executes, anything else dismisses.
  if (appState.confirmAction) {
    if (key === 'y' || key === 'Y') {
      const action = appState.confirmAction;
      appState.confirmAction = null;
      appState.confirmMessage = '';
      try { action(); } catch (e) { showMessage(e?.message || 'Action failed', 'error'); render(); }
    } else {
      dismissConfirm();
    }
    return;
  }

  // 3. Input modal.
  if (handleInputKey(key)) return;

  // 4. Tab-switch + globals.
  switch (key) {
    case '1': case '2': case '3': case '4': case '5': case '6': {
      const i = parseInt(key, 10) - 1;
      setTab(i);
      if (i === 4 && appState.notifications.length === 0 && appState.token) {
        inbox.loadNotifications();
      }
      if (i === 5 && appState.actionsRepos.length === 0 && appState.token) {
        actions.loadActionsRepos();
      }
      return;
    }
    case 'q': case '\x03': quit(); return;
    case '\t':
      if (tabState.current === 0) {
        if (appState.dashboardCardsFocus) {
          dashboard.unfocusCards();
        } else {
          dashboard.focusCards();
        }
      } else {
        setTab((tabState.current + 1) % TABS.length);
      }
      return;
    case '\x1b[Z':
      if (tabState.current === 0 && appState.dashboardCardsFocus) {
        dashboard.unfocusCards();
      } else {
        setTab((tabState.current - 1 + TABS.length) % TABS.length);
      }
      return;
    case '?': appState.showHelp = true; render(); return;
    case '\x10':
    case ':': palette.open(); return;
    case 'r': refreshCurrent(); return;
    case 'o': openCurrent(); return;
    case 'y': copyCurrentUrl(); return;
    case 'b': toggleBookmark(); return;
    case 'w': onboarding.startWelcome(); return;
    case '\r': case '\n': handleEnter(); return;
    case '\x1b[A': case 'k': handleUp(); return;
    case '\x1b[B': case 'j': handleDown(); return;
    case '\x1b[D': case 'h': case '\x7f': handleBack(); return;
    case ' ': handleSpace(); return;
    case '\x1b[5~': handlePageUp(); return;  // PageUp
    case '\x1b[6~': handlePageDown(); return;  // PageDown
    case 'g': handleTop(); return;
    case 'G': handleBottom(); return;
    case 'z': handleCollapseToggle(); return;
    case 'Z': handleCollapseAll(); return;
    case 'X': handleExpandAll(); return;
  }

  // 5. Global star toggle.
  if (key === '*' && currentRepoForAction()) { toggleStar(); return; }

  // 5a. Global watch toggle.
  if (key === 'W' && currentRepoForAction()) { toggleWatch(); return; }

  // 5b. Actions tab per-tab keys.
  if (tabState.current === 5 && appState.actionsView === 'runs') {
    if (key === 'r' || key === 'R') { actions.rerunSelected(); return; }
    if (key === 'x' || key === 'X') { actions.cancelSelected(); return; }
  }

  // 6. Dashboard stat-card focus.
  if (tabState.current === 0) {
    if (key === '\x1b[D' || key === 'H') { dashboard.leftCard(); return; }
    if (key === '\x1b[C' || key === 'L') { dashboard.rightCard(); return; }
    if (key === '\t' && appState.dashboardCardsFocus) {
      dashboard.unfocusCards();
      return;
    }
  }

  // 7. Per-tab key map.
  const mod = tabModules[tabState.current];
  if (mod && mod.keys && typeof mod.keys[key] === 'function') {
    mod.keys[key]();
    return;
  }
}

function handleSpace() {
  const t = tabState.current;
  if (t === 0) dashboard.pageDown();
  else if (t === 1) repos.pageDown();
  else if (t === 2) analyze.pageDown();
  else if (t === 4) inbox.pageDown();
}
function handlePageUp() {
  const t = tabState.current;
  if (t === 0) dashboard.pageUp();
  else if (t === 1) repos.pageUp();
  else if (t === 2) analyze.pageUp();
  else if (t === 4) inbox.pageUp();
}
function handlePageDown() {
  const t = tabState.current;
  if (t === 0) dashboard.pageDown();
  else if (t === 1) repos.pageDown();
  else if (t === 2) analyze.pageDown();
  else if (t === 4) inbox.pageDown();
}
function handleTop() {
  const t = tabState.current;
  const screen = getScreen();
  if (t === 0) return;
  if (t === 1) {
    if (appState.reposView === 'starred') {
      appState.starredSelected = 0;
      appState.starredScroll = 0;
    } else {
      appState.repoSelected = 0;
      appState.repoScroll = 0;
    }
    render();
  } else if (t === 2) {
    if (appState.analyzeView === 'results') {
      appState.selectedRepo = 0;
      appState.searchScroll = 0;
    } else if (appState.analyzeView === 'forks') {
      appState.selectedFork = 0;
      appState.forkScroll = 0;
    } else {
      appState.detailsScroll = 0;
    }
    render();
  } else if (t === 4) {
    appState.selectedNotification = 0;
    appState.inboxScroll = 0;
    render();
  } else if (t === 5) {
    if (appState.actionsView === 'repos') {
      appState.actionsRepoSelected = 0;
      appState.actionsRepoScroll = 0;
    } else {
      appState.actionsSelected = 0;
      appState.actionsScroll = 0;
    }
    render();
  }
}
function handleBottom() {
  const t = tabState.current;
  const screen = getScreen();
  if (t === 0) return;
  if (t === 1) repos.bottom(screen);
  else if (t === 2) {
    if (appState.analyzeView === 'results') {
      const maxVisible = Math.max(1, Math.min(8, screen.height - 16));
      appState.selectedRepo = Math.max(0, appState.searchResults.length - 1);
      appState.searchScroll = Math.max(0, appState.searchResults.length - maxVisible);
    } else if (appState.analyzeView === 'forks') {
      const maxVisible = Math.max(1, Math.min(6, screen.height - 16));
      appState.selectedFork = Math.max(0, appState.forks.length - 1);
      appState.forkScroll = Math.max(0, appState.forks.length - maxVisible);
    } else {
      appState.detailsScroll = 9999;
    }
    render();
  } else if (t === 4) {
    inbox.bottom(screen);
  } else if (t === 5) {
    actions.bottom(screen);
    render();
  }
}

// ── Collapsible section handlers ──
import { toggleCollapse, collapseAll, expandAll } from './state.mjs';

function handleCollapseToggle() {
  const section = getCurrentSection();
  if (section) toggleCollapse(section);
}

function handleCollapseAll() {
  const sections = getTabSections();
  if (sections.length) collapseAll(sections);
}

function handleExpandAll() {
  const sections = getTabSections();
  if (sections.length) expandAll(sections);
}

function getCurrentSection() {
  const t = tabState.current;
  if (t === 0) return dashboard.getCurrentSection ? dashboard.getCurrentSection() : null;
  if (t === 1) return repos.getCurrentSection ? repos.getCurrentSection() : null;
  if (t === 2) return analyze.getCurrentSection ? analyze.getCurrentSection() : null;
  if (t === 4) return inbox.getCurrentSection ? inbox.getCurrentSection() : null;
  return null;
}

function getTabSections() {
  const t = tabState.current;
  if (t === 0) return dashboard.getSections ? dashboard.getSections() : [];
  if (t === 1) return repos.getSections ? repos.getSections() : [];
  if (t === 2) return analyze.getSections ? analyze.getSections() : [];
  if (t === 4) return inbox.getSections ? inbox.getSections() : [];
  return [];
}

function handleEnter() {
  const t = tabState.current;
  if (t === 0) {
    if (appState.dashboardCardsFocus) { dashboard.openFocusedCard(); return; }
    dashboard.openTrendingRepo();
    return;
  }
  if (t === 1) repos.enter();
  else if (t === 2) analyze.enter();
  else if (t === 3) settings.enter();
  else if (t === 4) inbox.enter();
  else if (t === 5) actions.enter();
}
function handleUp() {
  const t = tabState.current;
  const screen = getScreen();
  if (t === 0) { dashboard.trendingUp(); return; }
  if (t === 1) repos.up(screen);
  else if (t === 2) analyze.up(screen);
  else if (t === 3) settings.up();
  else if (t === 4) inbox.up();
  else if (t === 5) actions.up();
}
function handleDown() {
  const t = tabState.current;
  const screen = getScreen();
  if (t === 0) { dashboard.trendingDown(); return; }
  if (t === 1) repos.down(screen);
  else if (t === 2) analyze.down(screen);
  else if (t === 3) settings.down();
  else if (t === 4) inbox.down(screen);
  else if (t === 5) actions.down();
}
function handleBack() {
  const t = tabState.current;
  if (t === 0) return;
  if (t === 2) { analyze.handleBack(); return; }
  if (t === 1) {
    if (appState.reposView === 'starred') { repos.toggleReposView(); return; }
  }
  if (t === 4) {
    if (appState.showDetail) {
      import('./tabs/detail.mjs').then(m => m.closeDetail()).catch(() => {});
      return;
    }
  }
  if (t === 5) { actions.goBack(); return; }
  setTab(0);
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
  reg({ id: 'welcome', label: 'Show "What\'s new" / tour',    hint: 'w', run: onboarding.startWelcome });
  reg({ id: 'quit',    label: 'Quit application',             hint: 'q', run: quit });

  reg({ id: 'star.toggle',     label: 'Star / unstar current repo',         hint: '*', run: toggleStar });
  reg({ id: 'watch.toggle',    label: 'Watch / unwatch current repo',       hint: 'W', run: toggleWatch });
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
  reg({ id: 'settings.logout', label: 'Log out', run: () => confirm('Log out of GitHub?', settings.handleLogout, 'Log Out') });
  reg({ id: 'dashboard.refresh', label: 'Refresh dashboard widgets',
        run: () => dashboard.loadDashboardWidgets(true) });
  reg({ id: 'dashboard.new-issue', label: 'Create new issue from TUI',
        run: startCreateIssue });

  reg({ id: 'detail.comment', label: 'Comment on current issue/PR',
        run: () => { if (appState.showDetail) detail.openCommentInput(); } });
  reg({ id: 'detail.close', label: 'Close / Reopen current issue/PR',
        run: () => { if (appState.showDetail) detail.closeOrReopen(); } });
  reg({ id: 'detail.merge', label: 'Merge current PR',
        run: () => { if (appState.showDetail) detail.mergePR(); } });
  reg({ id: 'detail.react', label: 'Add reaction to current issue/PR',
        run: () => { if (appState.showDetail) detail.toggleReactionPicker(); } });

  // Bookmarks browser
  reg({ id: 'bookmarks.browse', label: 'Browse bookmarks',
        run: () => {
          appState.bookmarks = loadBookmarks();
          appState.showBookmarks = true;
          appState.bookmarksCursor = 0;
          appState.bookmarksScroll = 0;
          render();
        } });
  reg({ id: 'bookmarks.export', label: 'Export bookmarks to Markdown',
        run: () => {
          const bm = appState.bookmarks;
          if (bm.length === 0) { showMessage('No bookmarks to export', 'warning'); return; }
          const md = '# Bookmarks\n\n' + bm.map(b => `- [${b.full_name}](${b.url})`).join('\n');
          if (copyToClipboard(md)) showMessage('Copied bookmarks as Markdown', 'success');
          else showMessage('Clipboard copy failed', 'error');
        } });

  reg({ id: 'actions.refresh', label: 'Actions: load workflow runs',
        run: () => { setTab(5); actions.loadActionsRepos(); } });

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

// ── Create Issue Workflow ─────────────────────────────────────────
// Temporary state for multi-step issue creation.
let _issueRepoIndex = 0;
let _issueTitle = '';
let _issueBody = '';

registerInputHandler('issue-title', async (value) => {
  const title = (value || '').trim();
  if (!title) { showMessage('Issue title cannot be empty', 'error'); return; }
  _issueTitle = title;
  startInput('Issue body (optional, Enter to skip): ', 'issue-body');
});

registerInputHandler('issue-body', async (value) => {
  const body = (value || '').trim();
  _issueBody = body;
  const repos = appState.repos;
  if (!repos[_issueRepoIndex]) { showMessage('No repo selected', 'error'); return; }
  const repo = repos[_issueRepoIndex];
  const [owner, name] = repo.full_name.split('/');
  try {
    const result = await createIssue(appState.token, owner, name, _issueTitle, _issueBody);
    if (result && result.html_url) {
      showMessage('Created issue: ' + result.title, 'success');
    } else {
      showMessage('Issue created', 'success');
    }
  } catch (e) {
    showMessage(e.message || 'Failed to create issue', 'error');
  }
  _issueTitle = '';
  _issueBody = '';
});

registerInputHandler('issue-pick-repo', (value) => {
  const idx = parseInt(value, 10);
  const repos = appState.repos;
  if (isNaN(idx) || idx < 0 || idx >= repos.length) {
    showMessage('Invalid repo number', 'error');
    _issueTitle = '';
    _issueBody = '';
    return;
  }
  _issueRepoIndex = idx;
  startInput('Issue title: ', 'issue-title');
});

function startCreateIssue() {
  const repos = appState.repos;
  if (!appState.token) { showMessage('Login first', 'warning'); return; }
  if (repos.length === 0) { showMessage('No repos loaded', 'warning'); return; }
  // Show repo picker in status bar.
  const names = repos.map((r, i) => i + ': ' + r.name).join('  ');
  showMessage('Available repos: ' + names, 'info', 5000);
  startInput('Enter repo number (0-' + (repos.length - 1) + '): ', 'issue-pick-repo');
}
