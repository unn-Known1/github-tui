// Inbox tab — GitHub notifications.
// v0.5+ polish: cleaner section header, by-repo panel as a real box, filter chip.

import { appState, render, startAsync, isStale, showMessage, confirm } from '../state.mjs';
import {
  getNotifications, markNotificationRead,
  markAllNotificationsRead, unsubscribeNotification,
} from '../github.mjs';
import { relTime, notifTypeColor, notificationToHtmlUrl, openUrl, truncate } from '../utils.mjs';
import { color } from '../theme.mjs';
import { emptyState } from '../render.mjs';
import { openDetail } from './detail.mjs';

const FILTERS = ['all', 'unread', 'mentions', 'review'];
const INBOX_PER_PAGE = 50;

export async function loadNotifications() {
  if (!appState.token) {
    showMessage('Login required to view notifications', 'warning');
    return;
  }
  const gen = startAsync();
  appState.loading = true;
  appState.inboxPage = 1;
  render();
  try {
    const notes = await getNotifications(appState.token, 1, INBOX_PER_PAGE);
    if (isStale(gen)) return;
    appState.notifications = Array.isArray(notes) ? notes : [];
    appState.inboxHasMore = notes.length >= INBOX_PER_PAGE;
    appState.inboxScroll = 0;
    appState.selectedNotification = 0;
    showMessage('Loaded ' + appState.notifications.length + ' notifications', 'success');
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Failed to load notifications', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

export async function loadMoreNotifications() {
  if (!appState.inboxHasMore || !appState.token) return;
  const gen = startAsync();
  appState.loading = true;
  render();
  try {
    const page = appState.inboxPage + 1;
    const more = await getNotifications(appState.token, page, INBOX_PER_PAGE);
    if (isStale(gen)) return;
    appState.notifications = [...appState.notifications, ...more];
    appState.inboxPage = page;
    appState.inboxHasMore = more.length >= INBOX_PER_PAGE;
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Failed to load more', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

export function pageUp() {
  if (appState.inboxPage > 1) {
    const page = appState.inboxPage - 1;
    const gen = startAsync();
    appState.loading = true;
    render();
    getNotifications(appState.token, page, INBOX_PER_PAGE).then(more => {
      if (isStale(gen)) return;
      if (Array.isArray(more)) {
        appState.notifications = more;
        appState.inboxPage = page;
        appState.inboxHasMore = true;
        appState.selectedNotification = 0;
        appState.inboxScroll = 0;
      }
      appState.loading = false;
      render();
    }).catch(() => { appState.loading = false; render(); });
  }
}

export function pageDown() {
  if (appState.inboxHasMore) {
    const page = appState.inboxPage + 1;
    const gen = startAsync();
    appState.loading = true;
    render();
    getNotifications(appState.token, page, INBOX_PER_PAGE).then(more => {
      if (isStale(gen)) return;
      if (Array.isArray(more) && more.length > 0) {
        appState.notifications = more;
        appState.inboxPage = page;
        appState.inboxHasMore = more.length >= INBOX_PER_PAGE;
        appState.selectedNotification = 0;
        appState.inboxScroll = 0;
      } else {
        appState.inboxHasMore = false;
      }
      appState.loading = false;
      render();
    }).catch(() => { appState.loading = false; render(); });
  }
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

export async function markCurrentRead() {
  const n = selected();
  if (!n) return;
  try {
    await markNotificationRead(appState.token, n.id);
    n.unread = false;
    showMessage('✓ Marked as read', 'success');
    render();
  } catch (e) { showMessage('Failed: ' + e.message, 'error'); }
}

export function markAllRead() {
  confirm('Mark ALL notifications as read?', async () => {
    if (!appState.token) return;
    try {
      await markAllNotificationsRead(appState.token);
      for (const n of appState.notifications) n.unread = false;
      showMessage('✓ All notifications marked as read', 'success');
      render();
    } catch (e) { showMessage('Failed: ' + e.message, 'error'); }
  }, 'Mark All Read');
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
  const htmlUrl = notificationToHtmlUrl(url);
  const r = await openUrl(htmlUrl);
  if (r.ok) showMessage('Opened ' + htmlUrl, 'success');
  else showMessage(r.error || 'Open failed', 'error');
}

function sectionHeader(screen, x, y, text, hint) {
  screen.writeStr(x, y, text, { fg: 'cyan', bold: true });
  if (hint) {
    const hx = screen.width - hint.length - 2;
    if (hx > x + text.length + 4) screen.writeStr(hx, y, hint, { dim: true });
  }
}

export function renderInbox(screen, y, h) {
  const W = screen.width;
  const list = filtered();
  const allList = appState.notifications;
  const unreadCount = allList.filter(n => n.unread).length;

  screen.writeStr(2, y, 'NOTIFICATIONS', { fg: 'white', bold: true });

  // Filter chip
  const filterChip = ' ' + appState.inboxFilter.toUpperCase() + ' ';
  screen.writeStr(18, y, filterChip, { bg: 'cyan', fg: 'darkGray', bold: true });

  if (allList.length > 0) {
    const counts = (unreadCount > 0 ? unreadCount + ' unread / ' : '0 unread / ') + allList.length + ' total';
    screen.writeStr(Math.max(2, W - counts.length - 2), y, counts,
      unreadCount > 0 ? { fg: 'yellow', bold: true } : { dim: true });
  }
  screen.hline(y + 1, '─', { dim: true });

  if (!appState.token) {
    emptyState(screen, y + 2, h - 2, {
      icon: '🔒',
      title: 'Login required',
      message: 'Sign in to view your GitHub notifications.',
      hint: '',
      keyHint: 'Press [4] for Settings',
    });
    return;
  }
  if (allList.length === 0) {
    emptyState(screen, y + 2, h - 2, {
      icon: '🎉',
      title: appState.loading ? 'Loading...' : 'Inbox zero!',
      message: appState.loading ? 'Fetching notifications...' : 'You have no notifications — enjoy the quiet.',
      hint: appState.loading ? '' : '[r] Refresh',
    });
    return;
  }
  if (list.length === 0) {
    emptyState(screen, y + 2, h - 2, {
      icon: '○',
      title: 'No matches',
      message: 'No notifications match filter [' + appState.inboxFilter + ']',
      hint: '[f] Cycle filter',
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
      screen.writeStr(summaryX + 2, row, short, { fg: 'white' });
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

  const maxRows = Math.max(1, h - 7);
  const start = appState.inboxScroll;
  for (let i = 0; i < maxRows && start + i < list.length; i++) {
    const n = list[start + i];
    const row = headerY + 2 + i;
    const sel = start + i === appState.selectedNotification;
    const unread = n.unread;

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
    const combined = repoName + ' / ' + title;
    const titleW = Math.min(listW - 30, 40);
    screen.writeStr(14, row, truncate(combined, titleW),
      sel ? color('selection') : (unread ? color('listItem') : color('listItemDim')));

    screen.writeStr(Math.min(listW - 12, 56), row,
      truncate(n.reason || '?', 11), sel ? color('selection') : color('dim'));
    const when = n.updated_at ? relTime(n.updated_at) : '';
    screen.writeStr(Math.min(listW - 4, 68), row, when, sel ? color('selection') : color('date'));
  }

  const infoY = headerY + 2 + Math.min(maxRows, list.length) + 1;
  if (infoY < y + h) {
    screen.writeStr(2, infoY,
      '[r] Refresh   [m] Mark read   [M] Mark all   [f] Filter   [u] Unsubscribe   [Enter] Open', { dim: true });
  }
}

export const keys = {
  'm': markCurrentRead,
  'M': markAllRead,
  'u': unsubscribeCurrent,
  'f': cycleFilter,
  'g': () => { appState.selectedNotification = 0; appState.inboxScroll = 0; render(); },
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
export function space() { loadMoreNotifications(); }
