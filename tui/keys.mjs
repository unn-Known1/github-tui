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

import {
  appState, tabState, setTab, showMessage, render, TABS, dismissConfirm, confirm,
  consumeRetryHandler, SECURITY_SUB_PANES, toggleFocusMode,
} from './state.mjs';
import * as palette from './palette.mjs';
import * as onboarding from './tabs/onboarding.mjs';
import { handleInputKey } from './input.mjs';
import { copyToClipboard, openUrl, notificationToHtmlUrl, getLastClipboardMethod, getClipboardTempFilePath } from './utils.mjs';
import { startInput, registerInputHandler } from './input.mjs';
import * as bookmarks from './bookmarks.mjs';

import * as dashboard from './tabs/dashboard.mjs';
import * as repos     from './tabs/repos.mjs';
import * as analyze   from './tabs/analyze.mjs';
import * as settings  from './tabs/settings.mjs';
import * as inbox     from './tabs/inbox.mjs';
import * as detail    from './tabs/detail.mjs';
import * as actions   from './tabs/actions.mjs';
import * as help      from './tabs/help.mjs';
import { addBookmark, removeBookmark, isBookmarked, removeSavedSearch } from './store.mjs';
import { starRepo, unstarRepo, isStarred, getSubscription, setSubscription, deleteSubscription } from './github.mjs';
import { getScreen } from './render.mjs';
import { parseMouseEvent, handleMouseEvent } from './mouse.mjs';
import { getUndoInfo } from './undo.mjs';
import { upsertEntity as _upsertEntity, getStarredList as _getStarredList } from './state.mjs';
const upsertEntity = _upsertEntity;
const getStarredList = _getStarredList;

const tabModules = [dashboard, repos, analyze, actions, inbox, settings];

// Context helpers — figure out what the user is pointing at.

function currentRepoForAction() {
  if (tabState.current === 2) {
    const v = appState.analyzeView;
    if (v === 'results') {
      if (appState.searchType === 'repos' && appState.searchResults[appState.selectedRepo])
        return appState.searchResults[appState.selectedRepo];
      if (appState.searchType === 'user-repos' && appState.userRepos[appState.userReposSelected])
        return appState.userRepos[appState.userReposSelected];
    }
    if (v === 'details' && appState.repoDetails)
      return appState.repoDetails;
    if (v === 'forks' && appState.forks[appState.selectedFork])
      return appState.forks[appState.selectedFork];
  }
  if (tabState.current === 1) {
    // Starred view (V) keeps its own selection — use it, not the own-repos
    // selection, so global actions like s / * star the highlighted repo.
    if (appState.reposView === 'starred') {
      return appState.starred[appState.starredSelected] || null;
    }
    if (appState.repos.length > 0) {
      let list = repos.applyAllFilters(repos.sortRepos(appState.repos, appState.repoSort));
      list = repos.floatPinsToTop(list);
      return list[appState.repoSelected] || null;
    }
  }
  return null;
}

function currentUrl() {
  if (tabState.current === 4) {
    const n = inbox.getSelectedNotification();
    return n ? notificationToHtmlUrl(n.subject && n.subject.url) : null;
  }
  if (tabState.current === 2 && appState.analyzeView === 'results') {
    if (appState.searchType === 'users') {
      const u = appState.userSearchResults[appState.userSelectedRepo];
      return u ? u.html_url : null;
    }
  }
  const r = currentRepoForAction();
  return r ? r.html_url : null;
}

async function openCurrent() {
  const url = currentUrl();
  if (!url) { showMessage('Nothing to open', 'warning'); return; }
  // when opening from Inbox, distinguish check-suite notifications
  // (whose URL redirects to the Actions tab) and friendly-message the user
  // instead of dumping a confusing /check-suites/N URL.
  let toastLabel = 'Opened ' + url;
  if (tabState.current === 4) {
    const n = inbox.getSelectedNotification();
    const subjectType = n && n.subject && n.subject.type;
    if (subjectType === 'CheckSuite') toastLabel = 'Opened Actions tab';
    else if (subjectType === 'Discussion') toastLabel = 'Opened discussion in browser';
  }
  const res = await openUrl(url);
  if (res.ok) showMessage(toastLabel, 'success');
  else showMessage(res.error || 'Open failed', 'error');
}

function copyCurrentUrl() {
  const url = currentUrl();
  if (!url) { showMessage('Nothing to copy', 'warning'); return; }
  if (copyToClipboard(url)) {
    const method = getLastClipboardMethod();
    const tmp = getClipboardTempFilePath();
    showMessage(method === 'temp-file' && tmp ? 'Saved copy to ' + tmp :
      method === 'tmux' ? 'Copied to tmux buffer' : 'Copied to clipboard', 'success');
  } else showMessage('Clipboard copy failed', 'error');
}

let _starToggling = false;
async function toggleStar() {
  if (_starToggling) return;
  _starToggling = true;
  try { await _toggleStarInner(); } finally { _starToggling = false; }
}
async function _toggleStarInner() {
  const r = currentRepoForAction();
  if (!r || !appState.token) { showMessage('Login + select a repo first', 'warning'); return; }
  const fullName = r.full_name;
  const [owner, name] = fullName.split('/');
  // capture the pre-mutation stargazers_count so we can roll back
  // if any post-API work (buildStarHistory, dataset propagation) throws.
  const preCount = r.stargazers_count || 0;
  try {
    const already = await isStarred(appState.token, owner, name);
    if (already) {
      await unstarRepo(appState.token, owner, name);
      r.stargazers_count = Math.max(0, (r.stargazers_count || 0) - 1);
      showMessage('Unstarred ' + fullName, 'success');
    } else {
      await starRepo(appState.token, owner, name);
      r.stargazers_count = (r.stargazers_count || 0) + 1;
      showMessage('Starred ' + fullName, 'success');
    }
    // snapshot pre-mutation state so a post-API throw can roll
    // back BOTH the count AND the starred-list membership.
    const preStargazers = r.stargazers_count || 0;
    const preStarredList = Array.isArray(appState.starred) ? [...appState.starred] : [];
    try {
      // Update stargazers_count in every app state array that may contain this repo.
      for (const arr of [appState.repos, appState.searchResults,
                         appState.trending, appState.forks, appState.actionsRepos]) {
        if (!Array.isArray(arr)) continue;
        for (let i = 0; i < arr.length; i++) {
          if (arr[i] && arr[i].full_name === fullName) {
            arr[i].stargazers_count = r.stargazers_count;
          }
        }
      }
      if (appState.repoDetails && appState.repoDetails.full_name === fullName) {
        appState.repoDetails.stargazers_count = r.stargazers_count;
      }
      // single source of truth. upsertEntity() keeps
      // appState.starred membership in sync internally via unshift/splice
      // so no inline splice/unshift is needed here. Single source of
      // truth avoids the previous double-bookkeeping divergence between
      // the cache and the visible starred list.
      const starredAt = already ? null : new Date().toISOString();
      upsertEntity(r, { isStarred: !already, starredAt, isOwner: false });
      appState.dashboardStarHistory = dashboard.buildStarHistory(getStarredList());
      render();
  } catch (e) {
    // post-API step failed — undo BOTH the count AND the
    // starred-list mutation so the UI doesn't lie about GitHub state. Note
    // rollback restores BOTH the count and the cache entry. The
    // upsertEntity call below re-mirrors the original `isStarred: already`
    // state so cache and starred list agree.
    r.stargazers_count = preStargazers;
    appState.starred = preStarredList;
    upsertEntity(r, { isStarred: already, starredAt: null, isOwner: false });
    throw e;
  }
  } catch (e) {
    showMessage(e.message || 'Star failed', 'error');
    render();
  }
}

async function toggleWatch() {
  const r = currentRepoForAction();
  if (!r || !appState.token) { showMessage('Login + select a repo first', 'warning'); return; }
  const [owner, name] = r.full_name.split('/');
  try {
    let sub;
    try { sub = await getSubscription(appState.token, owner, name); } catch (e) { sub = null; }
    if (sub && sub.subscribed) {
      // Unwatching is destructive — it silently stops notifications. Require
      // confirmation so a stray `W` keystroke in the Repos tab doesn't undo
      // the user's subscription. Re-watching is one keystroke so the cost
      // of guarding is small.
      confirm('Unwatch ' + r.full_name + '? You\'ll stop receiving notifications about it.', async () => {
        try {
          await deleteSubscription(appState.token, owner, name);
          showMessage('Unwatched ' + r.full_name, 'info');
        } catch (e) { showMessage(e.message || 'Unwatch failed', 'error'); }
      }, 'Unwatch repo');
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
    dashboard.refreshDashboard();
    showMessage('Refreshing dashboard...', 'info');
  } else if (t === 1) {
    repos.loadUserData();
  } else if (t === 2 && appState.analyzeView === 'details' && appState.repoDetails) {
    const [o, n] = appState.repoDetails.full_name.split('/');
    analyze.loadRepoDetails(o, n);
  } else if (t === 3) {
    if (appState.actionsView === 'runs') actions.loadWorkflowRuns();
    else actions.loadActionsRepos();
  } else if (t === 4) {
    inbox.loadNotifications();
  } else if (t === 5) {
    settings.refreshAll();
  }
}

function quit() {
  process.exit(0);
}

// Main entry — process.stdin pipes every keystroke through here.
// ──────────────────────────────────────────────────────────────────// Key repeat debouncing — limit renders to ~60fps for held keys.
// bypass the debouncer for multi-byte / sequence keys (paste,
// mouse events, escape sequences) so paste isn't silently dropped.
let _lastKeyTime = 0;
let _lastKeyStr = '';
const KEY_REPEAT_DEBOUNCE_MS = 16; // ~60fps

export function handleKey(key) {
  // Debounce repeated single-char keys (held arrow keys). Multi-char
  // sequences (paste, mouse, escape sequences) always pass through.
  const now = Date.now();
  if (key.length === 1 && key === _lastKeyStr && now - _lastKeyTime < KEY_REPEAT_DEBOUNCE_MS) return;
  _lastKeyTime = now;
  _lastKeyStr = key;
  // 0. Ctrl+C quits by default — except when a text selection is active
  //    (README / file viewer), in which case Ctrl+C copies the selection.
  if (key === '\x03') {
    if (appState.textSelectionMode !== 'none') {
      import('./mouse.mjs').then(m => m.copySelectedText()).catch(() => {});
      return;
    }
    quit();
  }

  // 0a. Mouse events (SGR or legacy X10 format).
  const mouseEvent = parseMouseEvent(key);
  if (mouseEvent) {
    handleMouseEvent(mouseEvent);
    return;
  }

  // 0b. Esc dismisses ANY open overlay — prevents stuck modal states.
  // Also clears text selection in README / file viewer before falling
  // through to the normal back handler.
  if (key === '\x1b') {
    if (appState.showPalette) { palette.close(); return; }
    if (appState.showOnboarding || appState.showWelcome) {
      // Let the onboarding module close the overlay and persist the seen
      // version; directly clearing the flags made upgrade notes reappear.
      onboarding.handleOnboardingKey(key);
      return;
    }
    if (appState.showBookmarks) { bookmarks.closeBookmarks(); return; }
    if (appState.showHelp) { appState.showHelp = false; render(); return; }
    // Confirm / input overlays sit ON TOP of the detail popup (actions like
    // c/r/x/M open them while showDetail stays true), so Esc must dismiss
    // those first. handleBack closes the reaction picker / diff view before
    // the whole popup, mirroring the 1e branch below.
    if (appState.confirmAction) { dismissConfirm(); return; }
    if (appState.inputMode === 'input') { import('./input.mjs').then(m => m.cancelInput()).catch(() => {}); return; }
    if (appState.showDetail) { detail.handleBack(); return; }
    // Clear text selection if one is active.
    if (appState.textSelectionMode !== 'none') {
      appState.textSelectionMode = 'none';
      appState.textSelectStart = null;
      appState.textSelectEnd = null;
      render();
      return;
    }
    // No overlay open — let Esc fall through to per-tab back handlers.
  }

  // 1. Palette captures all keys first.
  if (palette.handleKey(key)) return;

  // 1a. Onboarding / What's new captures all keys.
  if (appState.showOnboarding || appState.showWelcome) {
    onboarding.handleOnboardingKey(key);
    return;
  }

  // 1aa. Bookmarks overlay.
  if (bookmarks.handleKey(key)) return;

  // 1b. Help overlay: handle special keys, any other key closes.
  // the printable-char branch must come FIRST so typing letters
  // like k/j/g/n/p lets the user search. Previously those letters short-
  // circuited the scroll handlers above, making help search unusable.
  if (appState.showHelp) {
    if (key === '\x1b' || key === 'q') { appState.showHelp = false; render(); return; }
    // Backspace deletes the last char from the search query.
    if (key === '\x7f' || key === '\b') {
      const q = appState.helpQuery || '';
      help.setHelpQuery(q.slice(0, -1));
      render();
      return;
    }
    // Up / k → scroll content up. Down / j / Enter → scroll content down.
    // g / Home → go to top of help. G / End → go to bottom.
    if (key === '\x1b[A' || key === 'k') { help.scrollHelp(-3); render(); return; }
    if (key === '\x1b[B' || key === 'j' || key === '\r' || key === '\n') { help.scrollHelp(3); render(); return; }
    if (key === 'g' || key === '\x1b[H' || key === '\x1bOH') {
      // g scrolls-to-top WITHOUT clearing the user's search query.
      // Previously this inadvertently wiped any filter the user had typed.
      // Use 'gg' (type g twice) to also clear, or 'Esc' to dismiss the overlay.
      appState.helpCursor = 0;
      render();
      return;
    }
    if (key === 'G' && appState.helpQuery) {
      help.setHelpQuery('');
      render();
      return;
    }
    if (key === 'n') { help.scrollHelp(3); render(); return; }
    if (key === 'p') { help.scrollHelp(-3); render(); return; }
    if (key === '/') {
      // / starts search; subsequent presses append to query.
      help.setHelpQuery((appState.helpQuery || '').length === 0 ? '/' : (appState.helpQuery || '') + '/');
      render();
      return;
    }
    // Printable ASCII + above — append to search query.
    if (key.length >= 1 && key.charCodeAt(0) >= 32) {
      help.setHelpQuery((appState.helpQuery || '') + key);
      render();
      return;
    }
    return;
  }

  // 1c. Confirmation dialog — 'y'/'Y'/Enter executes, 'n'/'N'/Esc cancels.
  // Handled BEFORE the detail popup: detail actions (c/r/x/M/C/...) open
  // confirms while showDetail stays true, so the popup would otherwise
  // swallow the confirming keystrokes (Enter cycled tabs, y copied URL).
  if (appState.confirmAction) {
    if (key === 'y' || key === 'Y' || key === '\r' || key === '\n') {
      const action = appState.confirmAction;
      appState.confirmAction = null;
      appState.confirmMessage = '';
      try { action(); } catch (e) { showMessage(e?.message || 'Action failed', 'error'); render(); }
    } else if (key === 'n' || key === 'N' || key === '\x1b') {
      dismissConfirm();
    }
    return;
  }

  // 1d. Input modal — also wins over the detail popup so comment / review /
  // label / fields / dispatch prompts can actually receive keystrokes.
  if (handleInputKey(key)) return;

  // 1e. Detail popup captures keys when open.
  if (appState.showDetail) {
    if (key === '\x1b' || key === 'h' || key === '\x7f') { detail.handleBack(); return; }
    if (key === '\r' || key === '\n') { detail.enter(); return; }
    if (key === '\x1b[A' || key === 'k') { detail.up(); return; }
    if (key === '\x1b[B' || key === 'j') { detail.down(); return; }
    const mod = detail;
    if (mod.keys && typeof mod.keys[key] === 'function') {
      // Route errors to showMessage so async detail actions (checkout,
      // reviews, merges) surface failures instead of silent rejections.
      Promise.resolve()
        .then(() => mod.keys[key]())
        .catch((e) => showMessage((e && e.message) || 'Action failed', 'error'));
      return;
    }
    return;
  }

  // 4. Tab-switch + globals.
  // Skip number keys 1-6 when in Analyze security pane (they switch sub-panes).
  const isSecurityPane = tabState.current === 2 && appState.analyzeView === 'details' && appState.detailsPane === 'security';
  switch (key) {
    case '1': case '2': case '3': case '4': case '5': case '6': {
      // when in the Analyze security sub-pane, 1-6 switch between
      // sub-panes (dependabot / secret / codescan / advisories / branch / deps)
      // instead of changing tabs. The previous `break` fall-through silently
      // relied on the per-tab key map running AFTER the switch — fragile if
      // dispatch order ever changed. Now dispatched explicitly.
      if (isSecurityPane) {
        const order = ['dependabot', 'secret', 'codescan', 'advisories', 'branch', 'deps'];
        const idx = parseInt(key, 10) - 1;
        if (idx >= 0 && idx < SECURITY_SUB_PANES.length) {
          appState.securitySubPane = SECURITY_SUB_PANES[idx];
          render();
        }
        return;
      }
      const i = parseInt(key, 10) - 1;
      setTab(i);
      resetFocus(i);
      if (i === 4 && appState.notifications.length === 0 && appState.token) {
        inbox.loadNotifications();
      }
      if (i === 3 && appState.actionsRepos.length === 0 && appState.token) {
        actions.loadActionsRepos();
      }
      if (i === 1 && appState.repos.length === 0 && appState.token) {
        repos.loadUserData();
      }
      return;
    }
    case '\x13': {
      // Ctrl-S — save the current Explore search query (palette
      // already advertises this; pressing the actual key does it now).
      if (!appState.searchQuery) { showMessage('No search query to save', 'warning'); return; }
      startInput('Label for this search: ', 'save-search');
      return;
    }
    case '\x0b': {
      // Ctrl-K — hint about custom keybindings (we don't auto-open
      // an editor to avoid spawning child processes; users can configure
      // $EDITOR in their own time). Toast for 6s is enough discoverability.
      showMessage('Edit ~/.github-tui/keybindings.json for custom key bindings — format: [{key, command, label, context}]', 'info', 6000);
      return;
    }
    case '\x06': {
      toggleFocusMode(appState.focusMode ? appState.focusMode : 'attention');
      return;
    }
    case 'q': quit(); return;
    case '\t': {
      // Dashboard uses Tab for in-page focus because its cards and widgets
      // are interactive. Other tabs retain Tab as tab navigation.
      if (appState.showHelp || appState.showPalette || appState.showBookmarks || appState.showDetail
          || tabState.current === 0) {
        focusNext();
      } else {
        const target = (tabState.current + 1) % TABS.length;
        setTab(target);
        resetFocus(target);
      }
      return;
    }
    case '\x1b[Z': {
      if (appState.showHelp || appState.showPalette || appState.showBookmarks || appState.showDetail
          || tabState.current === 0) {
        focusPrev();
      } else {
        const target = (tabState.current - 1 + TABS.length) % TABS.length;
        setTab(target);
        resetFocus(target);
      }
      return;
    }
    case '?': appState.showHelp = true; render(); return;
    case '\x10':
    case ':': palette.open(); return;
    case 'r': {
      // a retry handler attached by error-recovery.mjs takes priority
      // over the per-tab refresh / Actions workflow rerun. Users in an error
      // state expect `r` to fix the failure, not re-fire a workflow.
      const retryFn = consumeRetryHandler();
      if (retryFn) {
        showMessage('Retrying…', 'info');
        render();
        Promise.resolve().then(() => {
          try { retryFn(); } catch (e) {
            showMessage((e && e.message) || 'Retry failed', 'error');
          }
        });
        return;
      }
      // Actions runs view: 'r' re-runs selected workflow, not a generic refresh.
      if (tabState.current === 3 && appState.actionsView === 'runs') { actions.rerunSelected(); return; }
      refreshCurrent();
      // surface undo affordance in toast when an undo stack exists.
      // Append only once to avoid noisy double-suffix in chained messages.
      const undoInfo = getUndoInfo ? getUndoInfo() : null;
      if (undoInfo && undoInfo.canUndo) {
        showMessage('Refreshed   [u] undo last action', 'info');
      }
      return;
    }
    case 'o': openCurrent(); return;
    case 'y': copyCurrentUrl(); return;
    case 'b': {
      if (tabState.current === 2 && appState.analyzeView === 'details' && appState.detailsPane === 'files') {
        import('./tabs/files.mjs').then(m => m.openFileBlame()).catch(e => showMessage('Blame failed: ' + (e?.message || 'unknown'), 'error'));
        return;
      }
      toggleBookmark(); return;
    }
    case 'B': {
      // in the files pane, B opens the branch picker; everywhere
      // else it opens the bookmarks browser. Explicit dispatch.
      if (tabState.current === 2 && appState.analyzeView === 'details' && appState.detailsPane === 'files') {
        import('./tabs/files.mjs').then(m => m.openBranchPicker()).catch(e =>
          showMessage('Branch picker failed: ' + (e && e.message || 'unknown'), 'error'));
        return;
      }
      bookmarks.openBookmarks();
      return;
    }
    case 'w': onboarding.startWelcome(); return;
    case '\r': case '\n': handleEnter(); return;
    case '\x1b[A': case 'k': handleUp(); return;
    case '\x1b[B': case 'j': handleDown(); return;
    case 'h': case '\x7f': handleBack(); return;
    case ' ': handleSpace(); return;
    case '\x1b[5~': handlePageUp(); return;  // PageUp
    case '\x1b[6~': handlePageDown(); return;  // PageDown
    case 'g': handleTop(); return;
    case 'G': {
      // in the files pane (Analyze details + files sub-pane),
      // capital G triggers `gh repo clone` rather than jump-to-bottom.
      // Previously this was a `break;` fall-through that silently relied on
      // the per-tab key map running AFTER the switch — fragile if anyone
      // reordered the dispatch. Now the dispatch is explicit.
      if (tabState.current === 2 && appState.analyzeView === 'details' && appState.detailsPane === 'files') {
        import('./tabs/files.mjs').then(m => m.ghCloneIntoCwd()).catch(e =>
          showMessage('gh clone failed: ' + (e && e.message || 'unknown'), 'error'));
        return;
      }
      // Inbox binds 'G' to toggle grouping (advertised in its footer hint);
      // without this the global jump-to-bottom swallowed it, so the key
      // looked dead there. Other tabs keep generic jump-to-bottom.
      if (tabState.current === 4) {
        Promise.resolve()
          .then(() => inbox.keys.G())
          .catch((e) => showMessage((e && e.message) || 'Action failed', 'error'));
        return;
      }
      handleBottom();
      return;
    }
    case 'z': {
      // Inbox binds 'z' to snooze (advertised in its footer hint); the
      // global collapse-toggle used to swallow it. Other tabs keep the
      // generic collapse toggle.
      if (tabState.current === 4) {
        Promise.resolve()
          .then(() => inbox.keys.z())
          .catch((e) => showMessage((e && e.message) || 'Action failed', 'error'));
        return;
      }
      handleCollapseToggle();
      return;
    }
    case 'Z': {
      // Inbox binds 'Z' to unsnooze (advertised in its footer hint); the
      // global collapse-all used to swallow it. Other tabs keep the
      // generic collapse-all.
      if (tabState.current === 4) {
        Promise.resolve()
          .then(() => inbox.keys.Z())
          .catch((e) => showMessage((e && e.message) || 'Action failed', 'error'));
        return;
      }
      // in the files pane, Z triggers a zipball download; everywhere
      // else it collapses all collapsible sections. Explicit dispatch.
      if (tabState.current === 2 && appState.analyzeView === 'details' && appState.detailsPane === 'files') {
        import('./tabs/files.mjs').then(m => m.downloadZipball()).catch(e =>
          showMessage('Zipball failed: ' + (e && e.message || 'unknown'), 'error'));
        return;
      }
      handleCollapseAll();
      return;
    }
    case 'X': {
      // Actions runs view: 'X' cancels selected workflow, not a generic expand-all.
      if (tabState.current === 3 && appState.actionsView === 'runs') { actions.cancelSelected(); return; }
      handleExpandAll();
      return;
    }
    case 'u': {
      // 'u' is the undo hotkey globally — but several tabs define their OWN
      // 'u' meaning (Explore → search users, Repos → sort by updated, Inbox →
      // unsubscribe). Those per-tab handlers could NEVER fire because this
      // global binding caught the key first. Yield to the active tab's 'u'
      // handler when one exists; fall back to undo everywhere else.
      const mod = tabModules[tabState.current];
      if (mod && mod.keys && typeof mod.keys[key] === 'function') {
        Promise.resolve()
          .then(() => mod.keys[key]())
          .catch((e) => showMessage((e && e.message) || 'Action failed', 'error'));
        return;
      }
      undo();
      return;
    }
    case '\x19': redo(); return;  // Ctrl+Y
  }

  // 5. Global star toggle.
  if (key === '*' && currentRepoForAction()) { toggleStar(); return; }

  // lowercase 's' on repo-bearing tabs (1=Repos / 3=Explore details,
  // NOT inside Files sub-pane where 's' means saveCurrentFile) toggles star
  // for the current repo. 'S' on Settings still stars the github-tui repo.
  // Critical: Files sub-pane (analyzeView === 'details' && detailsPane === 'files')
  // binds 's' → saveCurrentFile in files.mjs. Catch that binding to ship the
  // per-tab handler so we don't break the save shortcut.
  const inFilesSubPane = tabState.current === 2
    && appState.analyzeView === 'details'
    && appState.detailsPane === 'files';
  // Analyze owns lowercase `s` for pane-local filters/sorts. Never let the
  // global star mutation preempt that handler (an accidental star is a public
  // side effect, while the local command is only a view change).
  if (key === 's' && !inFilesSubPane && tabState.current !== 2) {
    if (tabState.current === 5) {
      if (!appState.token) { showMessage('Login first (Settings → Login)', 'warning'); return; }
      Promise.resolve().then(() => settings.starRepo()).catch((e) => {
        showMessage((e && e.message) || 'Star failed', 'error');
      });
      return;
    }
    if (currentRepoForAction()) { toggleStar(); return; }
  }
  // 'S' in file-pane contexts (Files sub-view of Explore)
  // still acts on the file (save), not the globally-bound star.
  if (key === 'S' && tabState.current === 5 && !appState.showDetail) {
    if (!appState.token) { showMessage('Login first (Settings → Login)', 'warning'); return; }
    Promise.resolve().then(() => settings.starRepo()).catch((e) => {
      showMessage((e && e.message) || 'Star failed', 'error');
    });
    return;
  }

  // keep `w` as the canonical "what's new" toggle (canonical doc key);
  // the global capital `W` watch toggle is now palette-only (Ctrl-P → "Watch
  // current repo"). This avoids the long-standing `W` vs `w` key collision
  // that new users reported when both "Watch toggle" and "What's new"
  // appeared in the bindings help.
  // 5a. Global watch toggle removed from hotkey scope — palette only.

  // 6. Dashboard stat-card focus — ←/→ arrows and H/L move between cards.
  if (tabState.current === 0) {
    if (key === '\x1b[D' || key === 'H') { dashboard.leftCard(); return; }
    if (key === '\x1b[C' || key === 'L') { dashboard.rightCard(); return; }
    // lowercase 'l' is intentionally NOT bound to rightCard. The dashboard tab
    // binds 'l' per-tab to toggle localRepoFilter; binding it here as well
    // used to fire BOTH actions on a single press (card moved AND filter
    // toggled), which was a UX bug. Per-tab handler dispatch in step 7 runs
    // after this returns.
    if (key === '\t' && appState.dashboardCardsFocus) {
      dashboard.unfocusCards();
      return;
    }
  }

  // Left arrow on non-dashboard tabs acts as back (same as 'h').
  if (key === '\x1b[D' && tabState.current !== 0) {
    handleBack();
    return;
  }

  // l (lowercase vi "right/forward") — acts as Enter on non-dashboard tabs
  // so vi users can drill into items without switching hands.
  if (key === 'l' && tabState.current !== 0) {
    if (tabState.current === 3 && appState.actionsView === 'runs') {
      actions.keys.l();
      return;
    }
    handleEnter();
    return;
  }

  // Ctrl+A — select all text and auto-copy in README / file viewer panes.
  if (key === '\x01') {
    const inTextSel = appState.textSelectionMode !== 'none';
    if (inTextSel) {
      import('./mouse.mjs').then(m => m.selectAllAndCopy()).catch(() => {});
      return;
    }
    // Not in text-selection mode yet — activate it at current scroll position.
    if (tabState.current === 2 && appState.analyzeView === 'details') {
      if (appState.detailsPane === 'readme') {
        appState.textSelectionMode = 'readme';
        appState.textSelectStart = { row: 0, col: 0 };
        appState.textSelectEnd = { row: 0, col: 0 };
        import('./mouse.mjs').then(m => m.selectAllAndCopy()).catch(() => {});
        return;
      }
      if (appState.detailsPane === 'files' && appState.fileViewing) {
        appState.textSelectionMode = 'file';
        appState.textSelectStart = { row: 0, col: 0 };
        appState.textSelectEnd = { row: 0, col: 0 };
        import('./mouse.mjs').then(m => m.selectAllAndCopy()).catch(() => {});
        return;
      }
    }
  }

  // 7. Per-tab key map.
  // many tab keys[key] entries return Promises (saveCurrentFile,
  // downloadZipball, toggleStar, etc.). Previously the Promise was dropped,
  // creating silent unhandled rejections. Now we await through a Promise.resolve
  // and route errors to showMessage so users see a toast.
  const mod = tabModules[tabState.current];
  if (mod && mod.keys && typeof mod.keys[key] === 'function') {
    Promise.resolve()
      .then(() => mod.keys[key]())
      .catch((e) => {
        showMessage((e && e.message) || 'Action failed', 'error');
      });
    return;
  }

  // 8. Custom user keybindings (module loaded once, not per-keypress).
  if (_customKeysModule) { _customKeysModule.runCustomKey(key); }
}

function handleSpace() {
  const t = tabState.current;
  if (t === 0) dashboard.loadMoreTrending();
  else if (t === 1) repos.space();
  else if (t === 2) analyze.pageDown();
  else if (t === 3) actions.space();
  else if (t === 4) inbox.space();
}
function handlePageUp() {
  const t = tabState.current;
  if (t === 0) dashboard.pageUp();
  else if (t === 1) repos.pageUp();
  else if (t === 2) analyze.pageUp();
  else if (t === 3) actions.up();
  else if (t === 4) inbox.pageUp();
}
function handlePageDown() {
  const t = tabState.current;
  if (t === 0) dashboard.pageDown();
  else if (t === 1) repos.pageDown();
  else if (t === 2) analyze.pageDown();
  else if (t === 3) actions.down();
  else if (t === 4) inbox.pageDown();
}
function handleTop() {
  const t = tabState.current;
  const screen = getScreen();
  if (t === 0) {
    if (appState.dashboardCardsFocus) {
      appState.dashboardSelectedCard = 0;
    } else {
      appState.dashboardScroll = 0;
      appState.trendingSelected = 0;
      appState.trendingScroll = 0;
    }
    render();
    return;
  }
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
    analyze.jumpTop();
  } else if (t === 3) {
    if (appState.actionsLog) appState.actionsLogScroll = 0;
    else { appState.actionsSelected = 0; appState.actionsScroll = 0; }
    render();
  } else if (t === 4) {
    appState.selectedNotification = 0;
    appState.inboxScroll = 0;
    render();
  } else if (t === 5) {
    appState.settingsCursor = 0;
    render();
  }
}
function handleBottom() {
  const t = tabState.current;
  const screen = getScreen();
  if (t === 0) {
    if (appState.dashboardCardsFocus) {
      appState.dashboardSelectedCard = 4;
    } else {
      appState.dashboardScroll = appState.dashboardMaxScroll || 0;
    }
    render();
    return;
  }
  if (t === 1) repos.bottom(screen);
  else if (t === 2) {
    if (appState.analyzeView === 'results') {
      const type = appState.searchType || 'repos';
      const maxVisible = analyze.maxVisibleResults(screen.height - 8);
      if (type === 'users') {
        appState.userSelectedRepo = Math.max(0, appState.userSearchResults.length - 1);
        appState.userSearchScroll = Math.max(0, appState.userSearchResults.length - maxVisible);
      } else if (type === 'code') {
        appState.codeSelectedRepo = Math.max(0, appState.codeSearchResults.length - 1);
        appState.codeSearchScroll = Math.max(0, appState.codeSearchResults.length - maxVisible);
      } else if (type === 'user-repos') {
        appState.userReposSelected = Math.max(0, appState.userRepos.length - 1);
        appState.userReposScroll = Math.max(0, appState.userRepos.length - maxVisible);
      } else {
        appState.selectedRepo = Math.max(0, appState.searchResults.length - 1);
        appState.searchScroll = Math.max(0, appState.searchResults.length - maxVisible);
      }
    } else if (appState.analyzeView === 'forks') {
      const maxVisible = Math.max(1, Math.min(6, screen.height - 16));
      appState.selectedFork = Math.max(0, appState.forks.length - 1);
      appState.forkScroll = Math.max(0, appState.forks.length - maxVisible);
    } else {
      appState.detailsScroll = 9999;
    }
    render();
  } else if (t === 3) {
    if (appState.actionsLog) {
      const lines = String(appState.actionsLog.text || '').split(/\r?\n/);
      appState.actionsLogScroll = Math.max(0, lines.length - 1);
      render();
    } else {
      actions.bottom(screen);
      render();
    }
  } else if (t === 4) {
    inbox.bottom(screen);
  } else if (t === 5) {
    // Settings has no scrollable list
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
  if (t === 3) return actions.getCurrentSection ? actions.getCurrentSection() : null;
  if (t === 4) return inbox.getCurrentSection ? inbox.getCurrentSection() : null;
  return null;
}

function getTabSections() {
  const t = tabState.current;
  if (t === 0) return dashboard.getSections ? dashboard.getSections() : [];
  if (t === 1) return repos.getSections ? repos.getSections() : [];
  if (t === 2) return analyze.getSections ? analyze.getSections() : [];
  if (t === 3) return actions.getSections ? actions.getSections() : [];
  if (t === 4) return inbox.getSections ? inbox.getSections() : [];
  return [];
}

function handleEnter() {
  const t = tabState.current;
  if (t === 0) {
    if (appState.dashboardCardsFocus) { dashboard.openFocusedCard(); return; }
    dashboard.openDashboardItem();
    return;
  }
  if (t === 1) repos.enter();
  else if (t === 2) analyze.enter();
  else if (t === 3) actions.enter();
  else if (t === 4) inbox.enter();
  else if (t === 5) settings.enter();
}
function handleUp() {
  const t = tabState.current;
  const screen = getScreen();
  if (t === 0) { dashboard.dashboardUp(); return; }
  if (t === 1) repos.up(screen);
  else if (t === 2) {
    // Explore base view (search mode): up/down move through the merged
    // trending / saved-search / recent landing list.
    if (appState.analyzeView === 'search') { analyze.exploreUp(); return; }
    analyze.up(screen);
    return;
  }
  else if (t === 3) actions.up();
  else if (t === 4) inbox.up();
  else if (t === 5) settings.up();
}
function handleDown() {
  const t = tabState.current;
  const screen = getScreen();
  if (t === 0) { dashboard.dashboardDown(); return; }
  if (t === 1) repos.down(screen);
  else if (t === 2) {
    if (appState.analyzeView === 'search') { analyze.exploreDown(); return; }
    analyze.down(screen);
    return;
  }
  else if (t === 3) actions.down();
  else if (t === 4) inbox.down(screen);
  else if (t === 5) settings.down();
}
function handleBack() {
  const t = tabState.current;
  if (t === 0) {
    // `Esc` / `h` / `Backspace` on Dashboard MUST NOT trigger a
    // quit confirmation — one stray `Enter` would silently exit the app.
    // It's a muscle-memory trap. Quit is bound to `q` and `Ctrl-C` directly.
    // On Dashboard these keys instead (a) clear the heatmap day filter,
    // (b) unfocus the stat cards if they're focused, or (c) surface a
    // one-shot hint telling the user where quit actually lives.
    if (appState.dashboardContribDayFilter) {
      dashboard.clearContribDayFilter();
      return;
    }
    if (appState.dashboardCardsFocus) {
      dashboard.unfocusCards();
      resetFocus(0);
      return;
    }
    if (appState.confirmAction) return; // don't stack confirms
    showMessage('Quit: press [q] or [Ctrl-C]', 'info', 2400);
    return;
  }
  if (t === 2) { analyze.handleBack(); return; }
  if (t === 1) {
    if (appState.reposView === 'starred') { repos.toggleReposView(); return; }
  }
  if (t === 3) { actions.goBack(); return; }
  if (t === 4) {
    if (appState.showDetail) {
      import('./tabs/detail.mjs').then(m => m.closeDetail()).catch(() => {});
      return;
    }
    // Inbox Esc with no open detail popup now falls back to
    // tab 0 (Dashboard) like every other tab. Previously it was a silent
    // no-op, breaking the expected "Esc = back" mental model.
  }
  setTab(0);
}

// Palette action registry.

// Settings → Appearance → Change Theme cursor index (see settings.mjs
// APPEARANCE section: 'Change Theme' is item 6). Named so the palette
// 'settings.theme' action doesn't hardcode a magic number.
const SETTINGS_APPEARANCE_CURSOR = 6;

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
  reg({ id: 'watch.toggle',    label: 'Watch / unwatch current repo',       hint: 'palette', run: toggleWatch });
  reg({ id: 'bookmark.toggle', label: 'Bookmark / unbookmark current repo', hint: 'b', run: toggleBookmark });

  reg({ id: 'repos.sort.name',    label: 'Sort repos by name',    hint: 'n', run: () => { setTab(1); repos.keys.n(); } });
  reg({ id: 'repos.sort.stars',   label: 'Sort repos by stars',   hint: 'S', run: () => { setTab(1); repos.keys.S(); } });
  reg({ id: 'repos.sort.updated', label: 'Sort repos by updated', hint: 'u', run: () => { setTab(1); repos.keys.u(); } });
  reg({ id: 'repos.filter',       label: 'Filter your repositories...',
        hint: '/', run: () => { setTab(1); repos.keys['/'](); } });
  reg({ id: 'repos.clear-filter', label: 'Clear all repos filters',
        hint: 'c', run: () => { setTab(1); repos.keys.c(); } });
  reg({ id: 'repos.type', label: 'Cycle repos type filter (all/sources/forks/...)',
        hint: 't', run: () => { setTab(1); repos.keys.t(); } });
  reg({ id: 'repos.lang', label: 'Filter repos by language...',
        hint: 'L', run: () => { setTab(1); repos.keys.L(); } });
  reg({ id: 'repos.stale', label: 'Toggle stale-only filter (no push 6+ months)',
        hint: 'x', run: () => { setTab(1); repos.keys.x(); } });
  reg({ id: 'repos.starred', label: 'View starred repos',
        hint: 'V', run: () => { setTab(1); repos.toggleReposView(); } });
  reg({ id: 'repos.density', label: 'Toggle Repos density (compact / comfortable)',
        hint: 'D', run: () => { setTab(1); repos.keys.D(); } });
  reg({ id: 'repos.pin', label: 'Pin / unpin highlighted repo',
        hint: 'P', run: () => { setTab(1); repos.keys.P(); } });
  reg({ id: 'repos.load-more', label: 'Load more repositories (lift background cap)',
        hint: 'l', run: () => { setTab(1); repos.keys.l(); } });
  reg({ id: 'analyze.files', label: 'Open File explorer for current repo',
        hint: 'F',
        run: () => {
          if (!appState.repoDetails) { showMessage('Open a repo on Explore first', 'warning'); return; }
          setTab(2);
          analyze.keys.F();
        }});

  reg({ id: 'analyze.search', label: 'Search public repositories...',
        hint: 'i', run: () => { setTab(2); analyze.keys.i(); } });
  reg({ id: 'analyze.search-users', label: 'Search GitHub users...',
        hint: 'u', run: () => { setTab(2); analyze.keys.u(); } });
  reg({ id: 'analyze.search-code', label: 'Search code...',
        hint: 'C', run: () => { setTab(2); analyze.keys.C(); } });
  reg({ id: 'analyze.readme', label: 'View README of current repo',
        hint: 'R', run: () => { setTab(2); if (appState.repoDetails) analyze.keys.R(); } });

  // Files pane actions (files.mjs is lazily imported — keys.mjs has no
  // static import to avoid a cycle; setTab(2) mirrors the analyze neighbors).
  reg({ id: 'files.save', label: 'Files: save current file to CWD',
        hint: 's', run: () => { setTab(2); return import('./tabs/files.mjs').then(m => m.keys.s()); } });
  reg({ id: 'files.save-folder', label: 'Files: save whole folder recursively to CWD',
        hint: 'S', run: () => { setTab(2); return import('./tabs/files.mjs').then(m => m.keys.S()); } });
  reg({ id: 'files.zipball', label: 'Files: download repo zipball to CWD',
        hint: 'Z', run: () => { setTab(2); return import('./tabs/files.mjs').then(m => m.keys.Z()); } });
  reg({ id: 'files.clone', label: 'Files: git clone repo into CWD',
        hint: 'C', run: () => { setTab(2); return import('./tabs/files.mjs').then(m => m.keys.C()); } });
  reg({ id: 'files.gh-clone', label: 'Files: gh repo clone (private repos)',
        hint: 'G', run: () => { setTab(2); return import('./tabs/files.mjs').then(m => m.keys.G()); } });
  reg({ id: 'files.branch', label: 'Files: branch / tag picker',
        hint: 'B', run: () => { setTab(2); return import('./tabs/files.mjs').then(m => m.keys.B()); } });
  reg({ id: 'files.copy-contents', label: 'Files: copy entire file contents',
        hint: 'Y', run: () => { setTab(2); return import('./tabs/files.mjs').then(m => m.keys.Y()); } });
  reg({ id: 'files.history', label: 'Files: per-file commit history',
        hint: 'H', run: () => { setTab(2); return import('./tabs/files.mjs').then(m => m.keys.H()); } });

  reg({ id: 'undo.undo', label: 'Undo last action', hint: 'u',
        run: () => undo() });
  reg({ id: 'undo.redo', label: 'Redo last undone action', hint: 'Ctrl-Y',
        run: () => redo() });

  reg({ id: 'inbox.refresh',     label: 'Inbox: refresh notifications',       hint: 'r', run: inbox.loadNotifications });
  reg({ id: 'inbox.mark.read',   label: 'Inbox: mark current thread as read', hint: 'm', run: inbox.markCurrentRead });
  reg({ id: 'inbox.mark.all',    label: 'Inbox: mark all as read',            hint: 'M', run: inbox.markAllRead });
  reg({ id: 'inbox.unsubscribe', label: 'Inbox: unsubscribe from thread',     hint: 'u', run: inbox.unsubscribeCurrent });
  reg({ id: 'inbox.cycle',       label: 'Inbox: cycle filter',                run: inbox.cycleFilter });
  reg({ id: 'inbox.hide-processed', label: 'Inbox: hide / show processed threads', hint: 'H',
        run: () => { setTab(4); inbox.keys.H(); } });
  reg({ id: 'inbox.group', label: 'Inbox: toggle grouping by thread', hint: 'G',
        run: () => { setTab(4); inbox.keys.G(); } });
  reg({ id: 'inbox.snooze', label: 'Inbox: snooze thread for 1 hour', hint: 'z',
        run: () => { setTab(4); inbox.keys.z(); } });
  reg({ id: 'inbox.unsnooze', label: 'Inbox: unsnooze current thread', hint: 'Z',
        run: () => { setTab(4); inbox.keys.Z(); } });
  reg({ id: 'inbox.save-filter', label: 'Inbox: save current filter...', hint: 'v',
        run: () => { setTab(4); inbox.keys.v(); } });
  reg({ id: 'inbox.apply-filter', label: 'Inbox: apply a saved filter...', hint: 'V',
        run: () => { setTab(4); inbox.keys.V(); } });

  reg({ id: 'settings.theme',  label: 'Change theme...',
        run: () => { setTab(5); appState.settingsCursor = SETTINGS_APPEARANCE_CURSOR; render(); settings.enter(); } });
  reg({ id: 'settings.logout', label: 'Log out', run: () => confirm('Log out of GitHub?', settings.handleLogout, 'Log Out') });
  reg({ id: 'dashboard.refresh', label: 'Refresh dashboard data',
        run: () => dashboard.refreshDashboard() });
  reg({ id: 'dashboard.inbox', label: 'Open Inbox',
        run: () => {
          setTab(4);
          if (appState.notifications.length === 0 && appState.token) inbox.loadNotifications();
          else render();
        } });
  reg({ id: 'dashboard.actions', label: 'Open Actions',
        run: () => {
          setTab(3);
          if (appState.actionsRepos.length === 0 && appState.token) actions.loadActionsRepos();
          else render();
        } });
  reg({ id: 'dashboard.search', label: 'Search repositories',
        run: () => { setTab(2); analyze.keys.i(); } });
  reg({ id: 'dashboard.new-issue', label: 'Create new issue from TUI',
        run: () => import('./issue-create.mjs').then(m => m.startCreateIssue()) });

  reg({ id: 'detail.comment', label: 'Comment on current issue/PR',
        run: () => { if (appState.showDetail) detail.openCommentInput(); } });
  reg({ id: 'detail.close', label: 'Close / Reopen current issue/PR',
        run: () => { if (appState.showDetail) detail.closeOrReopen(); } });
  reg({ id: 'detail.merge', label: 'Merge current PR',
        run: () => { if (appState.showDetail) detail.mergePR(); } });
  reg({ id: 'detail.react', label: 'Add reaction to current issue/PR',
        run: () => { if (appState.showDetail) detail.toggleReactionPicker(); } });
  reg({ id: 'detail.review.approve', label: 'Approve current pull request',
        run: () => { if (appState.showDetail) detail.startReview('APPROVE'); } });
  reg({ id: 'detail.review.changes', label: 'Request changes on current pull request',
        run: () => { if (appState.showDetail) detail.startReview('REQUEST_CHANGES'); } });
  reg({ id: 'detail.review.request', label: 'Request reviewers for current pull request',
        run: () => { if (appState.showDetail) detail.startReviewerRequest(); } });
  reg({ id: 'release.draft', label: 'Create draft release for current repo',
        run: () => import('./release-actions.mjs').then(m => m.startReleaseDraft()) });
  reg({ id: 'release.publish', label: 'Publish a release for current repo',
        run: () => import('./release-actions.mjs').then(m => m.publishRelease()) });
  reg({ id: 'release.edit', label: 'Edit a release for current repo',
        run: () => import('./release-actions.mjs').then(m => m.editRelease()) });

  // Bookmarks browser
  reg({ id: 'bookmarks.browse', label: 'Browse bookmarks',
        run: () => bookmarks.openBookmarks() });
  reg({ id: 'bookmarks.export', label: 'Export bookmarks to Markdown',
        run: () => bookmarks.exportMarkdown() });

  reg({ id: 'actions.refresh', label: 'Actions: load workflow runs',
        run: () => { setTab(3); actions.loadActionsRepos(); } });
  reg({ id: 'actions.logs', label: 'Actions: open selected workflow log', hint: 'l',
        run: () => { setTab(3); actions.keys.l(); } });
  reg({ id: 'actions.dispatch', label: 'Actions: dispatch workflow', hint: 'd',
        run: () => { setTab(3); actions.startWorkflowDispatch(); } });
  reg({ id: 'actions.failures', label: 'Actions: scan workflow failures', hint: 'F',
        run: () => { setTab(3); actions.keys.F(); } });
  reg({ id: 'actions.open-run', label: 'Actions: open selected run in browser', hint: 'o',
        run: () => { setTab(3); actions.keys.o(); } });
  reg({ id: 'actions.back', label: 'Actions: back to repo list', hint: 't',
        run: () => { setTab(3); actions.keys.t(); } });
  reg({ id: 'actions.cancel', label: 'Actions: cancel selected running workflow', hint: 'x',
        run: () => { setTab(3); actions.keys.x(); } });
  reg({ id: 'security.aggregate', label: 'Security: scan repository alerts',
        run: () => import('./security-aggregate.mjs').then(m => m.loadSecurityAggregate()) });
  reg({ id: 'work.queue', label: 'Open My Work focus queue',
        run: () => import('./work-queue.mjs').then(m => {
          appState.myWorkQueue = m.buildMyWorkQueue({ notifications: appState.notifications, pullRequests: appState.dashboardRecentPRs, issues: appState.dashboardRecentIssues, failures: appState.actionsFailures });
          setTab(0);
          toggleFocusMode('work');
          showMessage(appState.myWorkQueue.length ? 'My Work: ' + appState.myWorkQueue.length + ' item(s)' : 'My Work is clear', appState.myWorkQueue.length ? 'warning' : 'success', 5000);
        }) });
  reg({ id: 'focus.toggle', label: 'Toggle focus mode', hint: 'Ctrl-F',
        run: () => toggleFocusMode(appState.focusMode || 'attention') });
  reg({ id: 'sections.create', label: 'Create dashboard query section',
        run: () => import('./custom-sections.mjs').then(m => m.startSectionEditor()) });
  reg({ id: 'sections.edit', label: 'Edit dashboard query section',
        run: () => startInput('Section number to edit: ', 'section-edit-index') });
  reg({ id: 'sections.delete', label: 'Delete dashboard query section',
        run: () => startInput('Section number to delete: ', 'section-delete-index') });
  reg({ id: 'sections.preview', label: 'Preview dashboard query section',
        run: () => startInput('Section number to preview: ', 'section-preview-index') });
  reg({ id: 'config.export', label: 'Export GitHub TUI configuration',
        run: () => startInput('Export path: ', 'config-export') });
  reg({ id: 'config.import', label: 'Import GitHub TUI configuration',
        run: () => startInput('Import path: ', 'config-import') });
  reg({ id: 'enterprise.host', label: 'Configure GitHub Enterprise host',
        run: () => startInput('API host (https://...): ', 'enterprise-host') });
  reg({ id: 'profiles.list', label: 'List account/host profiles',
        run: () => import('./profiles.mjs').then(m => showMessage(m.loadProfiles().map(p => p.id + ': ' + p.apiHost).join(' | ') || 'No profiles configured', 'info', 6000)) });
  reg({ id: 'profiles.switch', label: 'Switch account/host profile',
        run: () => startInput('Profile id (re-login if account changes): ', 'profile-switch') });
  reg({ id: 'organizations.load', label: 'Load organization repositories and teams',
        run: () => import('./organizations.mjs').then(m => m.loadOrganizations()) });
  reg({ id: 'plugins.scan', label: 'Scan installed read-only plugins',
        run: () => import('./plugins.mjs').then(m => { const p = m.discoverPlugins(); showMessage(p.length ? p.map(x => x.id + ': ' + x.status).join(' | ') : 'No plugins installed', 'info', 6000); }) });
  reg({ id: 'smart.insight', label: 'Show rule-based repo insights',
        run: () => import('./recommended-features.mjs').then(m => {
          if (!appState.repoDetails) { showMessage('Open a repository first', 'warning'); return; }
          const insight = m.buildSmartInsight(appState.repoDetails, { openIssues: appState.repoIssues.length, lastPushDays: appState.repoDetails.pushed_at ? Math.floor((Date.now() - Date.parse(appState.repoDetails.pushed_at)) / 86400000) : null, openSecurityAlerts: appState.securityAggregate.length });
          showMessage(insight.findings.length ? insight.findings.join(' ') : 'No rule-based concerns detected', 'info', 7000);
        }) });

  // Saved searches
  reg({ id: 'search.save', label: 'Save current search query...',
        run: () => {
          if (!appState.searchQuery) { showMessage('No search query to save', 'warning'); return; }
          startInput('Label for this search: ', 'save-search');
        } });
  registerInputHandler('section-edit-index', (value) => {
    import('./custom-sections.mjs').then(m => m.startSectionEdit(Math.max(0, Number(value || 1) - 1))).catch(e => showMessage('Section edit failed: ' + e.message, 'error'));
  });
  registerInputHandler('section-delete-index', (value) => {
    import('./custom-sections.mjs').then(m => m.deleteSection(Math.max(0, Number(value || 1) - 1))).catch(e => showMessage('Section delete failed: ' + e.message, 'error'));
  });
  registerInputHandler('section-preview-index', (value) => {
    import('./custom-sections.mjs').then(m => m.previewSection(Math.max(0, Number(value || 1) - 1))).catch(e => showMessage('Section preview failed: ' + e.message, 'error'));
  });
  registerInputHandler('config-export', (path) => {
    import('./portability.mjs').then(m => showMessage('Exported ' + m.exportPortableConfig(path), 'success'))
      .catch(e => showMessage('Export failed: ' + e.message, 'error'));
  });
  registerInputHandler('config-import', (path) => {
    import('./portability.mjs').then(m => { m.importPortableConfig(path); showMessage('Configuration imported — restart to apply all settings', 'success'); })
      .catch(e => showMessage('Import failed: ' + e.message, 'error'));
  });
  registerInputHandler('profile-switch', (id) => {
    import('./profiles.mjs').then(m => {
      const result = m.activateProfileById(id);
      if (!result.ok) throw new Error(result.error);
      appState.activeProfile = result.profile.id;
      appState.enterpriseHost = result.profile.apiHost;
      appState.enterpriseWebHost = result.profile.webHost;
      showMessage('Switched to ' + result.profile.label + ' — re-login if this is another account', 'success');
      render();
    }).catch(e => showMessage('Profile switch failed: ' + e.message, 'error'));
  });
  registerInputHandler('enterprise-host', (apiHost) => {
    startInput('Web host (https://...): ', 'enterprise-web-host');
    appState._pendingEnterpriseApiHost = apiHost;
  });
  registerInputHandler('enterprise-web-host', (webHost) => {
    import('./profiles.mjs').then(m => {
      const result = m.upsertProfile({ id: 'default', label: 'Default', apiHost: appState._pendingEnterpriseApiHost, webHost });
      if (!result.ok) throw new Error(result.error);
      m.activateProfile(result.profile);
      appState.enterpriseHost = result.profile.apiHost;
      appState.enterpriseWebHost = result.profile.webHost;
      showMessage('Configured GitHub host: ' + result.profile.apiHost, 'success');
    }).catch(e => showMessage('Host configuration failed: ' + e.message, 'error'));
  });

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
            // Saved searches are persisted to disk under ~/.github-tui/.
            // Confirm before removing so a misclick doesn't blow away
            // a query the user spent time composing.
            confirm('Delete saved search "' + s.label + '"?', () => {
              removeSavedSearch(s.id);
              appState.savedSearches = appState.savedSearches.filter(x => x.id !== s.id);
              showMessage('Deleted saved search: ' + s.label, 'success');
            }, 'Delete saved search');
          } });
  });
}

import { submitSearch } from './tabs/analyze.mjs';
import { focusNext, focusPrev, resetFocus } from './focus.mjs';
import { undo, redo } from './undo.mjs';

// Lazy-loaded custom keybindings module — loaded once, not per-keypress.
let _customKeysModule = null;
import('./custom-keys.mjs').then(m => { _customKeysModule = m; }).catch(() => {});
