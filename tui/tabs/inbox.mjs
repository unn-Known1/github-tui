// Inbox tab — GitHub notifications.
// v0.3 features: mark-as-read (per-thread + all), unsubscribe, filter cycle.

import { appState, render, startAsync, isStale, showMessage } from '../state.mjs';
import {
  getNotifications, markNotificationRead,
  markAllNotificationsRead, unsubscribeNotification,
} from '../github.mjs';
import { relTime, notifTypeColor, notificationToHtmlUrl, openUrl } from '../utils.mjs';
import { color } from '../theme.mjs';

const FILTERS = ['all', 'unread', 'mentions', 'review'];

export async function loadNotifications() {
  if (!appState.token) {
    showMessage('Login required to view notifications', 'warning');
    return;
  }
  const gen = startAsync();
  appState.loading = true;
  render();
  try {
    const notes = await getNotifications(appState.token);
    if (isStale(gen)) return;
    appState.notifications = Array.isArray(notes) ? notes : [];
    appState.inboxScroll = 0;
    appState.selectedNotification = 0;
    showMessage('Loaded ' + appState.notifications.length + ' notifications', 'success');
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Failed to load notifications', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

function filtered() {
  const list = appState.notifications;
  switch (appState.inboxFilter) {
    case 'unread':   return list.filter(n => n.unread);
    case 'mentions': return list.filter(n => n.reason === 'mention');
    case 'review':   return list.filter(n => n.reason === 'review_requested');
    default:         return list;
  }
}

function selected() {
  return filtered()[appState.selectedNotification];
}

// Actions used by keys + command palette.
export async function markCurrentRead() {
  const n = selected();
  if (!n) return;
  try {
    await markNotificationRead(appState.token, n.id);
    n.unread = false;
    showMessage('Marked as read', 'success');
    render();
  } catch (e) { showMessage('Failed: ' + e.message, 'error'); }
}

export async function markAllRead() {
  if (!appState.token) return;
  try {
    await markAllNotificationsRead(appState.token);
    for (const n of appState.notifications) n.unread = false;
    showMessage('All notifications marked as read', 'success');
    render();
  } catch (e) { showMessage('Failed: ' + e.message, 'error'); }
}

export async function unsubscribeCurrent() {
  const n = selected();
  if (!n) return;
  try {
    await unsubscribeNotification(appState.token, n.id);
    n.unread = false;
    showMessage('Unsubscribed from thread', 'success');
    render();
  } catch (e) { showMessage('Failed: ' + e.message, 'error'); }
}

export function cycleFilter() {
  const i = FILTERS.indexOf(appState.inboxFilter);
  appState.inboxFilter = FILTERS[(i + 1) % FILTERS.length];
  appState.inboxScroll = 0;
  appState.selectedNotification = 0;
  showMessage('Filter: ' + appState.inboxFilter, 'info');
  render();
}

export async function openCurrent() {
  const n = selected();
  if (!n) return;
  const url = notificationToHtmlUrl(n.subject && n.subject.url);
  const r = await openUrl(url);
  if (r.ok) showMessage('Opened ' + url, 'success');
  else showMessage(r.error || 'Open failed', 'error');
}

export function renderInbox(screen, y, h) {
  const W = screen.width;
  const list = filtered();
  const allList = appState.notifications;
  const unreadCount = allList.filter(n => n.unread).length;

  screen.writeStr(4, y, 'Notifications', 'bright');
  const filterLabel = '[' + appState.inboxFilter + ']';
  screen.writeStr(20, y, filterLabel, color('accent'));

  if (allList.length > 0) {
    const counts = unreadCount + ' unread / ' + allList.length + ' total';
    screen.writeStr(Math.max(4, W - counts.length - 2), y, counts,
      unreadCount > 0 ? color('warning') : 'dim');
  }
  screen.hline(y + 1, '─');

  if (!appState.token) {
    screen.writeStr(4, y + 2, 'Login required. Go to Settings [4].', 'dim');
    return;
  }
  if (allList.length === 0) {
    screen.writeStr(4, y + 2, appState.loading
      ? 'Loading…' : '✨ Inbox zero! Press [r] to refresh.', 'dim');
    return;
  }
  if (list.length === 0) {
    screen.writeStr(4, y + 2,
      'No notifications match filter [' + appState.inboxFilter + ']  [f] cycle', 'dim');
    return;
  }

  // By-repo summary on the right.
  const repoCounts = {};
  for (const n of allList) {
    const r = n.repository && n.repository.full_name;
    if (!r) continue;
    repoCounts[r] = (repoCounts[r] || 0) + 1;
  }
  const topRepos = Object.entries(repoCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const summaryX = Math.max(W - 32, Math.floor(W * 0.65));
  if (summaryX > 40) {
    screen.writeStr(summaryX, y + 2, 'By Repo', 'bright');
    topRepos.forEach(([repo, count], i) => {
      const row = y + 3 + i;
      if (row >= y + h - 1) return;
      const short = repo.substring(0, W - summaryX - 6);
      screen.writeStr(summaryX, row, short, 'dim');
      screen.writeStr(W - 4, row, String(count), color('accent'));
    });
  }

  const headerY = y + 2;
  const listW = summaryX > 40 ? summaryX - 6 : W - 4;
  screen.writeStr(4, headerY, ' Type', 'bright');
  screen.writeStr(16, headerY, 'Repo / Title', 'bright');
  screen.writeStr(Math.min(listW - 12, 56), headerY, 'Reason', 'bright');
  screen.writeStr(Math.min(listW - 4, 68), headerY, 'When', 'bright');

  const maxRows = Math.max(1, h - 5);
  const start = appState.inboxScroll;
  for (let i = 0; i < maxRows && start + i < list.length; i++) {
    const n = list[start + i];
    const row = headerY + 1 + i;
    const sel = start + i === appState.selectedNotification;
    const unread = n.unread;

    screen.writeStr(2, row, sel ? '▶' : ' ', sel ? 'bright' : null);
    screen.writeStr(3, row, unread ? '●' : ' ', unread ? color('unread') : 'dim');

    const type = (n.subject && n.subject.type) || '?';
    screen.writeStr(5, row, type.substring(0, 10).padEnd(11), notifTypeColor(type));

    const repoName = (n.repository && n.repository.full_name || '?').split('/')[1] ||
      (n.repository && n.repository.full_name) || '?';
    const title = (n.subject && n.subject.title) || '';
    const combined = repoName + ' · ' + title;
    const titleW = Math.min(listW - 30, 40);
    screen.writeStr(16, row, combined.substring(0, titleW),
      sel ? 'bright' : (unread ? null : 'dim'));

    screen.writeStr(Math.min(listW - 12, 56), row,
      (n.reason || '?').substring(0, 11), 'dim');
    const when = n.updated_at ? relTime(n.updated_at) : '';
    screen.writeStr(Math.min(listW - 4, 68), row, when, 'dim');
  }

  const infoY = headerY + 1 + Math.min(maxRows, list.length) + 1;
  if (infoY < y + h) {
    screen.writeStr(4, infoY,
      '[r] Refresh  [m] Mark read  [M] Mark all  [u] Unsubscribe  [f] Filter  [Enter/o] Open',
      'dim');
  }
}

export const keys = {
  'm': markCurrentRead,
  'M': markAllRead,
  'u': unsubscribeCurrent,
  'f': cycleFilter,
};

export function up() {
  const list = filtered();
  if (list.length === 0) return;
  if (appState.selectedNotification > appState.inboxScroll) {
    appState.selectedNotification--;
  } else if (appState.inboxScroll > 0) {
    appState.inboxScroll--;
    appState.selectedNotification--;
  }
  render();
}
export function down(screen) {
  const list = filtered();
  if (list.length === 0) return;
  const maxVisible = Math.max(1, screen.height - 15);
  if (appState.selectedNotification < appState.inboxScroll + maxVisible - 1) {
    appState.selectedNotification = Math.min(list.length - 1, appState.selectedNotification + 1);
  } else if (appState.inboxScroll + maxVisible < list.length) {
    appState.inboxScroll++;
    appState.selectedNotification = Math.min(list.length - 1, appState.selectedNotification + 1);
  }
  render();
}
export const enter = openCurrent;
