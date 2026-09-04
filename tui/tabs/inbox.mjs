// Inbox tab — GitHub notifications.
// v0.5+ polish: cleaner section header, by-repo panel as a real box, filter chip.

import { appState, render, setTab, startAsync, isStale, showMessage, confirm, beginLoading, finishLoading } from '../state.mjs';
import {
  getNotifications, markNotificationRead,
  markAllNotificationsRead, unsubscribeNotification,
} from '../github.mjs';
import { relTime, notifTypeColor, notifReasonLabel, notificationToHtmlUrl, openUrl, truncate } from '../utils.mjs';
import { color } from '../theme.mjs';
import { emptyState, loadingIndicator, scrollIndicators } from '../render.mjs';
import { openDetail } from './detail.mjs';
import { loadRepoDetails } from './analyze.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import { showError } from '../error-recovery.mjs';
import { groupNotifications } from '../recommended-features.mjs';
import { addInboxFilter } from '../store.mjs';
import { CONFIG_DIR, readJson, writeJson } from '../config.mjs';
import { join } from 'path';

const FILTERS = ['all', 'unread', 'mentions', 'review'];
const INBOX_PER_PAGE = 50;

// I3: persisted snooze — map {id → untilTs} survives restarts via
// ~/.github-tui/inbox-snoozed.json (same readJson/writeJson pattern as store.mjs).
const SNOOZE_FILE = join(CONFIG_DIR, 'inbox-snoozed.json');
let _snoozeLoaded = false;
export function loadSnoozedState() {
  try {
    const raw = readJson(SNOOZE_FILE, {});
    const now = Date.now();
    const clean = {};
    for (const [k, v] of Object.entries(raw || {})) if (v > now) clean[k] = v;
    appState.inboxSnoozed = { ...(appState.inboxSnoozed || {}), ...clean };
  } catch {}
  _snoozeLoaded = true;
}
export function saveSnoozedState() {
  try { writeJson(SNOOZE_FILE, appState.inboxSnoozed || {}); } catch {}
}

// I7: memoize filter pipeline (dashboard D14 pattern).
let _filterCache = { key: null, result: null };
export function bumpInboxFilterGen() { _filterCache.key = null; }

export async function loadNotifications() {
  if (!appState.token) {
    showMessage('Login required to view notifications', 'warning');
    return;
  }
  const gen = startAsync('inbox');
  beginLoading(gen);
  appState.inboxPage = 1;
  render();
  try {
    const notes = await getNotifications(appState.token, 1, INBOX_PER_PAGE, gen.signal);
    if (isStale(gen)) { finishLoading(gen); return; }
    appState.notifications = Array.isArray(notes) ? notes : [];
    appState.inboxHasMore = notes.length >= INBOX_PER_PAGE;
    appState.inboxScroll = 0;
    appState.selectedNotification = 0;
    bumpInboxFilterGen();
    showMessage('Loaded ' + appState.notifications.length + ' notifications', 'success');
  } catch (e) {
    if (!isStale(gen)) showError(e.message || 'Unknown error', 'Load notifications', { retry: loadNotifications });
  }
  finishLoading(gen);
  if (!isStale(gen)) render();
}

export async function loadMoreNotifications() {
  if (!appState.inboxHasMore || !appState.token) return;
  const gen = startAsync('inbox-more');
  beginLoading(gen);
  render();
  try {
    const page = appState.inboxPage + 1;
    const more = await getNotifications(appState.token, page, INBOX_PER_PAGE, gen.signal);
    if (isStale(gen)) { finishLoading(gen); return; }
    appState.notifications = [...appState.notifications, ...more];
    appState.inboxPage = page;
    appState.inboxHasMore = more.length >= INBOX_PER_PAGE;
    bumpInboxFilterGen();
    normalizeInboxCursor();
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Failed to load more', 'error');
  }
  finishLoading(gen);
  if (!isStale(gen)) render();
}

// I1: single viewport truth — canonical renderer geometry (h - 7).
export function inboxMaxRows(h) { return Math.max(1, (h || 24) - 7); }

// Page keys move through the already-loaded, append-only list. If PageDown
// reaches the end, fetches the next server page without replacing earlier rows.
export function pageUp(screen) {
  const list = getFilteredNotifications();
  const maxRows = appState._inboxListBounds?.maxRows
    || inboxMaxRows(screen ? screen.height : process.stdout.rows || 24);
  appState.selectedNotification = Math.max(0, appState.selectedNotification - maxRows);
  normalizeInboxCursor(screen);
  render();
}

export function pageDown(screen) {
  const list = getFilteredNotifications();
  const maxRows = appState._inboxListBounds?.maxRows
    || inboxMaxRows(screen ? screen.height : process.stdout.rows || 24);
  if (appState.selectedNotification >= Math.max(0, list.length - 1) && appState.inboxHasMore) {
    loadMoreNotifications();
    return;
  }
  appState.selectedNotification = Math.min(Math.max(0, list.length - 1), appState.selectedNotification + maxRows);
  normalizeInboxCursor(screen);
  render();
}

export function getFilteredNotifications() {
  if (!_snoozeLoaded) loadSnoozedState();
  const key = [appState.notifications.length, appState.inboxFilter, appState.inboxTextFilter, appState.inboxHideProcessed, appState.localRepoFilter, appState.inboxGrouped, Object.keys(appState.inboxSnoozed || {}).length, (appState.notifications._mutGen || 0)].join('|');
  if (_filterCache.key === key && _filterCache.result) return _filterCache.result;
  let list = appState.notifications;
  if (appState.inboxHideProcessed) list = list.filter(n => n.unread);
  if (appState.localRepo && appState.localRepoFilter) {
    const fullName = appState.localRepo.owner + '/' + appState.localRepo.repo;
    list = list.filter(n => n.repository && n.repository.full_name === fullName);
  }
  switch (appState.inboxFilter) {
    case 'unread':   list = list.filter(n => n.unread); break;
    case 'mentions': list = list.filter(n => n.reason === 'mention'); break;
    case 'review':   list = list.filter(n => n.reason === 'review_requested'); break;
  }
  const snoozed = appState.inboxSnoozed || {};
  const now = Date.now();
  list = list.filter(n => !snoozed[n.id] || snoozed[n.id] <= now);
  const q = (appState.inboxTextFilter || '').trim().toLowerCase();
  if (q) {
    list = list.filter(n => {
      const title = (n.subject && n.subject.title || '').toLowerCase();
      const repo = (n.repository && n.repository.full_name || '').toLowerCase();
      return title.includes(q) || repo.includes(q);
    });
  }
  if (appState.inboxGrouped) {
    const result = groupNotifications(list).map(group => ({
      ...(group.latest || {}),
      _groupCount: group.count,
      _groupUnread: group.unread,
      _groupNotifications: group.notifications,
    }));
    _filterCache = { key, result };
    return result;
  }
  _filterCache = { key, result: list };
  return list;
}

export function getSelectedNotification() {
  return getFilteredNotifications()[appState.selectedNotification];
}

export function normalizeInboxCursor(screen = null) {
  const list = getFilteredNotifications();
  const maxRows = appState._inboxListBounds?.maxRows
    || inboxMaxRows(screen ? screen.height : process.stdout.rows || 24);
  appState.selectedNotification = Math.max(0, Math.min(appState.selectedNotification, Math.max(0, list.length - 1)));
  const maxScroll = Math.max(0, list.length - maxRows);
  appState.inboxScroll = Math.max(0, Math.min(appState.inboxScroll, maxScroll));
  if (appState.selectedNotification < appState.inboxScroll) appState.inboxScroll = appState.selectedNotification;
  if (appState.selectedNotification >= appState.inboxScroll + maxRows) {
    appState.inboxScroll = Math.min(maxScroll, appState.selectedNotification - maxRows + 1);
  }
}

function selected() {
  return getSelectedNotification();
}

function countSnoozed() {
  const snoozed = appState.inboxSnoozed || {};
  const now = Date.now();
  return Object.keys(snoozed).filter(id => (snoozed[id] || 0) > now).length;
}

export async function markCurrentRead() {
  const n = selected();
  if (!n) return;
  try {
    await markNotificationRead(appState.token, n.id);
    n.unread = false;
    bumpInboxFilterGen();
    // Clamp both selection and scroll after the filtered row disappears.
    normalizeInboxCursor();
    showMessage('✓ Marked as read', 'success');
    render();
  } catch (e) { showMessage('Failed: ' + e.message, 'error'); }
}

export async function markGroupRead() {
  const list = getFilteredNotifications();
  const n = list[appState.selectedNotification];
  if (!n) return;
  const members = n._groupNotifications && n._groupNotifications.length > 1 ? n._groupNotifications : [n];
  confirm('Mark ' + members.length + ' thread(s) as read?', async () => {
    try {
      for (const m of members) {
        if (m.unread) {
          await markNotificationRead(appState.token, m.id);
          m.unread = false;
        }
      }
      bumpInboxFilterGen();
      normalizeInboxCursor();
      showMessage('✓ Marked ' + members.length + ' as read', 'success');
      render();
    } catch (e) { showMessage('Failed: ' + e.message, 'error'); }
  }, 'Mark Group Read');
}

export function markAllRead() {
  const list = getFilteredNotifications();
  const snoozed = appState.inboxSnoozed || {};
  const now = Date.now();
  // Expand grouped pseudo-rows to members; belt-and-braces snooze exclusion
  // (getFilteredNotifications already excludes active snoozes).
  const seen = new Set();
  const targets = [];
  for (const n of list) {
    const members = n._groupNotifications && n._groupNotifications.length ? n._groupNotifications : [n];
    for (const m of members) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      if (!(snoozed[m.id] > now)) targets.push(m);
    }
  }
  confirm('Mark ' + targets.length + ' visible as read? (filtered view; snoozed excluded)', async () => {
    if (!appState.token) return;
    try {
      let count = 0;
      for (const m of targets) {
        if (m.unread) {
          await markNotificationRead(appState.token, m.id);
          m.unread = false;
          count++;
        }
      }
      bumpInboxFilterGen();
      normalizeInboxCursor();
      showMessage('✓ Marked ' + count + ' as read', 'success');
      render();
    } catch (e) { showMessage('Failed: ' + e.message, 'error'); }
  }, 'Mark All Read');
}

export async function unsubscribeCurrent() {
  const n = selected();
  if (!n) return;
  const title = (n.subject && n.subject.title) || 'this thread';
  confirm('Unsubscribe from "' + truncate(title, 40) + '"?', async () => {
    try {
      await unsubscribeNotification(appState.token, n.id);
      n.unread = false;
      bumpInboxFilterGen();
      normalizeInboxCursor();
      showMessage('Unsubscribed from thread', 'success');
      render();
    } catch (e) { showMessage('Failed: ' + e.message, 'error'); }
  }, 'Unsubscribe');
}

export function toggleGrouped() {
  appState.inboxGrouped = !appState.inboxGrouped;
  appState.inboxScroll = 0;
  appState.selectedNotification = 0;
  bumpInboxFilterGen();
  normalizeInboxCursor();
  showMessage('Grouped notifications: ' + (appState.inboxGrouped ? 'on' : 'off'), 'info');
  render();
}

export function snoozeCurrent() {
  const n = selected();
  if (!n) return;
  // Snooze duration stays 1h; Z unsnoozes (duration choice is follow-up).
  const ids = n._groupNotifications ? n._groupNotifications.map(g => g.id) : [n.id];
  const now = Date.now() + 60 * 60 * 1000;
  for (const id of ids) appState.inboxSnoozed[id] = now;
  saveSnoozedState();
  bumpInboxFilterGen();
  normalizeInboxCursor();
  showMessage('Snoozed notification for 1 hour', 'info');
  render();
}

export function unsnoozeCurrent() {
  const n = selected();
  if (!n) return;
  const ids = n._groupNotifications ? n._groupNotifications.map(g => g.id) : [n.id];
  let cleared = 0;
  for (const id of ids) if (appState.inboxSnoozed && appState.inboxSnoozed[id]) { delete appState.inboxSnoozed[id]; cleared++; }
  saveSnoozedState();
  bumpInboxFilterGen();
  normalizeInboxCursor();
  showMessage(cleared ? 'Unsnoozed ' + cleared + ' thread(s)' : 'Current thread is not snoozed', cleared ? 'success' : 'info');
  render();
}

export function toggleHideProcessed() {
  appState.inboxHideProcessed = !appState.inboxHideProcessed;
  appState.inboxScroll = 0;
  appState.selectedNotification = 0;
  bumpInboxFilterGen();
  normalizeInboxCursor();
  showMessage('Hide processed: ' + (appState.inboxHideProcessed ? 'on' : 'off'), 'info');
  render();
}

export function cycleFilter() {
  const i = FILTERS.indexOf(appState.inboxFilter);
  appState.inboxFilter = FILTERS[(i + 1) % FILTERS.length];
  appState.inboxScroll = 0;
  appState.selectedNotification = 0;
  bumpInboxFilterGen();
  normalizeInboxCursor();
  showMessage('Filter: ' + appState.inboxFilter, 'info');
  render();
}

export async function openCurrent() {
  const n = selected();
  if (!n) return;
  const type = n.subject && n.subject.type;
  const url = n.subject && n.subject.url;
  if ((type === 'Issue' || type === 'PullRequest') && url) {
    const match = url.match(/\/repos\/([^/]+)\/([^/]+)\/(?:issues|pulls)\/(\d+)/);
    if (match) {
      const [, owner, repo, num] = match;
      openDetail(type === 'PullRequest' ? 'pull_request' : 'issue', owner, repo, parseInt(num, 10));
      return;
    }
  }
  // Non-Issue/PR notifications (Release, Discussion, CheckSuite, Commit,
  // SecurityAlert, ...) have no inline TUI view, so open the actual thread
  // in the browser — that IS the notification. Only if no browser is
  // available (e.g. headless/WSL without xdg-open) fall back to the repo's
  // Explore view, with an explanatory toast so Enter is never a silent no-op.
  const htmlUrl = notificationToHtmlUrl(url) || (n.repository && n.repository.html_url);
  if (htmlUrl) {
    const title = (n.subject && n.subject.title) || '';
    const r = await openUrl(htmlUrl);
    if (r.ok) {
      showMessage('Opened "' + truncate(title, 40) + '" in browser', 'success');
      return;
    }
    showMessage('Browser unavailable (' + (r.error || 'open failed') + ') — showing repo in Explore', 'warning', 6000);
  } else {
    showMessage('No URL available for this notification', 'warning');
  }
  const repoFull = n.repository && n.repository.full_name;
  if (repoFull) {
    const [owner, name] = repoFull.split('/');
    setTab(2);
    appState.analyzeView = 'details';
    loadRepoDetails(owner, name);
  }
}

export function renderInbox(screen, y, h) {
  const W = screen.width;
  const list = getFilteredNotifications();
  const allList = appState.notifications;
  const unreadCount = allList.filter(n => n.unread).length;
  appState._inboxListBounds = null;

  screen.writeStr(2, y, 'NOTIFICATIONS', color('title') || { fg: 'white', bold: true });

  // Filter chip
  const filterChip = ' ' + appState.inboxFilter.toUpperCase() + ' ';
  screen.writeStr(18, y, filterChip, { bg: 'cyan', fg: 'darkGray', bold: true });

  if (allList.length > 0) {
    const snoozedCount = countSnoozed();
    const passiveFilters = [];
    if (appState.localRepo && appState.localRepoFilter) passiveFilters.push('repo: ' + appState.localRepo.owner + '/' + appState.localRepo.repo);
    if ((appState.inboxTextFilter || '').trim()) passiveFilters.push('search: "' + appState.inboxTextFilter.trim() + '"');
    const filteredNote = passiveFilters.length ? ' · ' + passiveFilters.join(' · ') : '';
    const counts = (unreadCount > 0 ? unreadCount + ' unread / ' : '0 unread / ') +
      allList.length + (appState.inboxHasMore ? '+ loaded' : ' total') +
      (snoozedCount > 0 ? ' · ' + snoozedCount + ' snoozed' : '') + filteredNote;
    screen.writeStr(Math.max(2, W - counts.length - 2), y, counts,
      unreadCount > 0 ? { fg: 'yellow', bold: true } : { dim: true });
  }
  screen.hline(y + 1, '─', { dim: true });

  if (!appState.token) {
    emptyState(screen, y + 2, h - 2, {
      icon: '*',
      title: 'Login required',
      message: 'Sign in to view your GitHub notifications.',
      hint: '',
      keyHint: 'Press [6] for Settings',
    });
    return;
  }
  if (allList.length === 0) {
    if (appState.loading) {
      loadingIndicator(screen, 2, y + 2, 'loading notifications');
      return;
    }
    emptyState(screen, y + 2, h - 2, {
      icon: '*',
      title: 'Inbox zero!',
      message: 'You have no notifications — enjoy the quiet.',
      hint: '[r] Refresh',
    });
    return;
  }
  if (list.length === 0) {
    // Diagnose WHY the list is empty — several silent filters can hide every
    // row while the header still counts them, which read as "no notifications".
    const reasons = [];
    const q = (appState.inboxTextFilter || '').trim();
    if (appState.localRepo && appState.localRepoFilter) {
      reasons.push('local-repo filter: ' + appState.localRepo.owner + '/' + appState.localRepo.repo +
        ' (off: [l] on Dashboard)');
    }
    if (q) reasons.push('text search: "' + q + '" ([/]+Enter clears)');
    const snoozedCount = countSnoozed();
    if (snoozedCount > 0) reasons.push(snoozedCount + ' snoozed (~1h)');
    if (appState.inboxHideProcessed) reasons.push('[H] hide processed on');
    if (appState.inboxFilter !== 'all') reasons.push('filter: ' + appState.inboxFilter);
    emptyState(screen, y + 2, h - 2, {
      icon: '○',
      title: 'No matches',
      message: 'No notifications match' +
        (reasons.length ? ' — ' + reasons.join('; ') : ' the current filter'),
      hint: '[f] Filter   [/] Search   [r] Refresh',
    });
    return;
  }

  // By-repo summary panel (right).
  const repoCounts = {};
  for (const n of allList) {
    const r = n.repository && n.repository.full_name;
    if (!r) continue;
    repoCounts[r] = (repoCounts[r] || 0) + 1;
  }
  const topRepos = Object.entries(repoCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const summaryX = Math.max(W - 32, Math.floor(W * 0.62));
  const summaryW = W - summaryX - 2;
  let summaryH = 0;
  if (summaryX > 50 && topRepos.length > 0) {
    const panelH = topRepos.length + 3;
    screen.box(summaryX, y + 3, summaryW, panelH, 'By Repo', { fg: 'cyan', bold: true });
    topRepos.forEach(([repo, count], i) => {
      const row = y + 4 + i;
      if (row >= y + h - 1) return;
      const short = truncate(repo, summaryW - 8);
      screen.writeStr(summaryX + 2, row, short, color('repoName') || { fg: 'white' });
      const countStr = String(count);
      screen.writeStr(summaryX + summaryW - countStr.length - 2, row, countStr, { fg: 'cyan', bold: true });
    });
    summaryH = panelH;
  }

  const headerY = y + 3;
  const listW = summaryX > 50 ? summaryX - 6 : W - 4;
  screen.writeStr(2, headerY, 'TYPE', { fg: 'cyan', bold: true });
  screen.writeStr(14, headerY, 'REPO / TITLE', { fg: 'cyan', bold: true });
  screen.writeStr(Math.min(listW - 12, 56), headerY, 'REASON', { fg: 'cyan', bold: true });
  screen.writeStr(Math.min(listW - 4, 68), headerY, 'WHEN', { fg: 'cyan', bold: true });
  screen.hline(headerY + 1, '─', { dim: true });

  const maxRows = inboxMaxRows(h);
  // Self-heal stale selection/scroll: a shorter list can arrive while this
  // tab is inactive (dashboard auto-refresh replaces appState.notifications
  // without resetting inboxScroll). Without this a leftover scroll would
  // blank the list while the header still shows the unread counts.
  appState.selectedNotification = Math.max(0, Math.min(appState.selectedNotification, list.length - 1));
  const maxScroll = Math.max(0, list.length - maxRows);
  appState.inboxScroll = Math.max(0, Math.min(appState.inboxScroll, maxScroll));
  if (appState.selectedNotification < appState.inboxScroll) appState.inboxScroll = appState.selectedNotification;
  if (appState.selectedNotification >= appState.inboxScroll + maxRows) {
    appState.inboxScroll = Math.min(maxScroll, appState.selectedNotification - maxRows + 1);
  }
  // Publish the exact painted list geometry so keyboard, mouse, and wheel
  // interactions use the same origin. `headerY + 2` is the first row, not the
  // tab content origin (which also contains the title and filter chip).
  appState._inboxListBounds = { rowStart: headerY + 2, maxRows, length: list.length };
  const start = appState.inboxScroll;
  for (let i = 0; i < maxRows && start + i < list.length; i++) {
    const n = list[start + i];
    const row = headerY + 2 + i;
    const sel = start + i === appState.selectedNotification;
    const unread = n._groupUnread > 0 ? true : n.unread;

    if (sel) {
      for (let x = 0; x < listW + 4; x++) screen.styleBuf[row][x] = color('selection');
    }

    screen.writeStr(2, row, sel ? '▶' : '  ', sel ? color('selection') : color('dim'));
    screen.writeStr(3, row, unread ? '●' : ' ', unread ? color('unread') : color('dim'));

    const type = (n.subject && n.subject.type) || '?';
    const typeColor = notifTypeColor(type);
    const typeName = type === 'PullRequest' ? 'PR'
      : type === 'Issue' ? 'Issue'
      : type === 'Release' ? 'Release'
      : type === 'Discussion' ? 'Discuss'
      : type === 'Commit' ? 'Commit'
      : type === 'CheckSuite' ? 'CI'
      : type;
    screen.writeStr(4, row, typeName.padEnd(9), sel ? color('selection') : typeColor);

    const repoName = (n.repository && n.repository.full_name || '?').split('/')[1] ||
      (n.repository && n.repository.full_name) || '?';
    const title = (n.subject && n.subject.title) || '';
    const combined = repoName + ' / ' + title + (n._groupCount > 1 ? ' (' + n._groupCount + ')' : '');
    const titleW = Math.min(listW - 30, 40);
    screen.writeStr(14, row, truncate(combined, titleW),
      sel ? color('selection') : (unread ? color('listItem') : color('listItemDim')));

    screen.writeStr(Math.min(listW - 12, 56), row,
      truncate(notifReasonLabel(n.reason), 11), sel ? color('selection') : color('dim'));
    const when = n.updated_at ? relTime(n.updated_at) : '';
    screen.writeStr(Math.min(listW - 4, 68), row, when, sel ? color('selection') : color('date'));
  }

  scrollIndicators(screen, headerY + 2, headerY + 1 + maxRows, appState.inboxScroll, list.length);

  const infoY = headerY + 2 + Math.min(maxRows, list.length) + 1;
  if (infoY < y + h) {
    // U19: info line is ~120 chars untruncated — truncate to the pane width
    // so it can't overwrite edge cells on narrow terminals. truncate() is a
    // width-aware no-op when wide, so all segments survive at full width.
    const infoLine =
      '[/] Search   [r] Refresh   [m] Mark read   [M] Mark all   [f] Filter   [u] Unsubscribe   [Enter] Open' +
      (appState.inboxHasMore ? '   [Space] More' : '') +
      '   [H] Hide processed: ' + (appState.inboxHideProcessed ? 'on' : 'off') +
      '   [G] Group: ' + (appState.inboxGrouped ? 'on' : 'off') + '   [z] Snooze 1h';
    screen.writeStr(2, infoY, truncate(infoLine, W - 4), { dim: true });
  }
}

registerInputHandler('inbox-filter-save', (value) => {
  const label = String(value || '').trim();
  if (!label) return;
  appState.inboxSavedFilters = addInboxFilter(label, {
    inboxFilter: appState.inboxFilter,
    inboxTextFilter: appState.inboxTextFilter,
    inboxHideProcessed: appState.inboxHideProcessed,
    inboxGrouped: appState.inboxGrouped,
  });
  showMessage('Saved Inbox filter: ' + label, 'success');
});

export function saveCurrentFilter() {
  startInput('Name this Inbox filter: ', 'inbox-filter-save');
}

export function applySavedFilter() {
  const saved = appState.inboxSavedFilters || [];
  if (!saved.length) { showMessage('No saved Inbox filters', 'info'); return; }
  showMessage(saved.map((f, i) => (i + 1) + '=' + f.label).join(' | '), 'info', 7000);
  startInput('Saved filter number: ', 'inbox-filter-apply');
}
registerInputHandler('inbox-filter-apply', (value) => {
  const item = (appState.inboxSavedFilters || [])[Math.max(0, Number(value || 1) - 1)];
  if (!item) { showMessage('Unknown saved filter', 'warning'); return; }
  const filter = item.filter || {};
  appState.inboxFilter = FILTERS.includes(filter.inboxFilter) ? filter.inboxFilter : 'all';
  appState.inboxTextFilter = String(filter.inboxTextFilter || '');
  appState.inboxHideProcessed = !!filter.inboxHideProcessed;
  appState.inboxGrouped = !!filter.inboxGrouped;
  appState.selectedNotification = 0;
  appState.inboxScroll = 0;
  bumpInboxFilterGen();
  normalizeInboxCursor();
  showMessage('Applied Inbox filter: ' + item.label, 'success');
  render();
});

registerInputHandler('inbox-filter', (value) => {
  appState.inboxTextFilter = (value || '').trim();
  appState.inboxScroll = 0;
  appState.selectedNotification = 0;
  bumpInboxFilterGen();
  normalizeInboxCursor();
  showMessage(appState.inboxTextFilter
    ? 'Filtering: "' + appState.inboxTextFilter + '"'
    : 'Filter cleared', 'info');
  render();
});

export const keys = {
  // Reopening '/' prefills the active query so a stale search is visible in
  // the prompt and easy to edit/clear (Enter with an empty buffer resets it).
  '/': () => startInput('Search notifications: ', 'inbox-filter', false, appState.inboxTextFilter || ''),
  // I5-part: no collapsible headers here — global collapse-all (Z/X) is
  // intentionally shadowed; Z reclaims unsnooze-current (pairs with I3).
  'm': () => { const n = getSelectedNotification(); if (n && n._groupCount > 1) markGroupRead(); else markCurrentRead(); },
  'M': markAllRead,
  'u': unsubscribeCurrent,
  'f': cycleFilter,
  'H': toggleHideProcessed,
  'G': toggleGrouped,
  'z': snoozeCurrent,
  'Z': unsnoozeCurrent,
  'v': saveCurrentFilter,
  'V': applySavedFilter,
};

export function bottom(screen) {
  const list = getFilteredNotifications();
  appState.selectedNotification = Math.max(0, list.length - 1);
  const maxVisible = appState._inboxListBounds?.maxRows
    || inboxMaxRows(screen ? screen.height : process.stdout.rows || 24);
  appState.inboxScroll = Math.max(0, list.length - maxVisible);
  render();
}

export function up(screen) {
  const list = getFilteredNotifications();
  if (list.length === 0) return;
  const maxVisible = appState._inboxListBounds?.maxRows
    || inboxMaxRows(screen ? screen.height : process.stdout.rows || 24);
  appState.selectedNotification = Math.max(0, appState.selectedNotification - 1);
  // Scroll up to keep selection visible
  if (appState.selectedNotification < appState.inboxScroll) {
    appState.inboxScroll = appState.selectedNotification;
  }
  render();
}
export function down(screen) {
  const list = getFilteredNotifications();
  if (list.length === 0) return;
  const maxVisible = appState._inboxListBounds?.maxRows
    || inboxMaxRows(screen ? screen.height : process.stdout.rows || 24);
  appState.selectedNotification = Math.min(list.length - 1, appState.selectedNotification + 1);
  // Scroll down to keep selection visible
  if (appState.selectedNotification >= appState.inboxScroll + maxVisible) {
    appState.inboxScroll = appState.selectedNotification - maxVisible + 1;
  }
  render();
}
export const enter = openCurrent;
export function space() { loadMoreNotifications(); }

// ── Collapsible sections ──
const INBOX_SECTIONS = ['unread', 'read', 'byRepo'];

export function getSections() {
  return INBOX_SECTIONS.map(s => 'inbox:' + s);
}

export function getCurrentSection() {
  return 'inbox:' + (appState.inboxFilter || 'all');
}
