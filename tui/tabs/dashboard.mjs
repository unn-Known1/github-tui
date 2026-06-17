// Dashboard tab — the home screen.
// Stat cards, profile mini, top repos, language breakdown, activity feed, trending.

import { appState, render, startAsync, isStale, showMessage } from '../state.mjs';
import {
  getUserEvents, getTrendingRepos, getStarredRepos,
} from '../github.mjs';
import { relTime, eventGlyph, greeting, shortNum } from '../utils.mjs';
import { color } from '../theme.mjs';

// Lazy import to avoid a cycle (dashboard refresh action lives in keys.mjs / actions).
export async function loadDashboardWidgets(force = false) {
  if (!appState.token || !appState.user) return;
  if (appState.dashboardLoaded && !force) return;
  const gen = startAsync();
  const username = appState.user.login;
  try {
    const safe = (p) => p.catch(() => null);
    const [events, trending, starred] = await Promise.all([
      safe(getUserEvents(appState.token, username, 15)),
      safe(getTrendingRepos(appState.token, 7, 5)),
      safe(getStarredRepos(appState.token, 1, 30)),
    ]);
    if (isStale(gen)) return;
    appState.events = Array.isArray(events) ? events : [];
    appState.trending = Array.isArray(trending) ? trending : [];
    appState.starred = Array.isArray(starred) ? starred : [];
    appState.dashboardLoaded = true;
    render();
  } catch (e) {
    if (!isStale(gen)) showMessage('Dashboard widgets failed: ' + e.message, 'error');
  }
}

// Draw a labeled stat card with a thin box.
function drawCard(screen, x, y, w, label, value, valueColor) {
  screen.writeStr(x, y,     '┌' + '─'.repeat(Math.max(0, w - 2)) + '┐', 'dim');
  screen.writeStr(x, y + 3, '└' + '─'.repeat(Math.max(0, w - 2)) + '┘', 'dim');
  screen.setCell(x, y + 1, '│', 'dim');
  screen.setCell(x + w - 1, y + 1, '│', 'dim');
  screen.setCell(x, y + 2, '│', 'dim');
  screen.setCell(x + w - 1, y + 2, '│', 'dim');
  screen.writeStr(x + 2, y + 1, String(label).substring(0, w - 4), 'dim');
  screen.writeStr(x + 2, y + 2, String(value).substring(0, w - 4), valueColor || 'bright');
}

export function renderDashboard(screen, y, h) {
  const W = screen.width;
  const user = appState.user;

  if (!user) {
    screen.writeStr(4, y + 2, 'Not authenticated. Go to Settings [4] to login.', 'dim');
    screen.writeStr(4, y + 4, 'Once logged in, the Dashboard shows:', 'dim');
    screen.writeStr(6, y + 5, '• Account stats & language breakdown', 'dim');
    screen.writeStr(6, y + 6, '• Recent activity feed', 'dim');
    screen.writeStr(6, y + 7, '• Top repos by stars', 'dim');
    screen.writeStr(6, y + 8, '• Trending repos this week', 'dim');
    screen.writeStr(6, y + 9, '• Unread notifications badge', 'dim');
    return;
  }

  // Greeting row.
  const heading = greeting() + ', ' + (user.name || user.login) + ' 👋';
  screen.writeStr(4, y, heading, color('title'));

  const unread = appState.notifications.filter(n => n.unread).length;
  if (unread > 0) {
    const badge = '🔔 ' + unread + ' unread';
    screen.writeStr(Math.max(4, W - badge.length - 2), y, badge, color('warning'));
  } else if (appState.notifications.length > 0) {
    screen.writeStr(Math.max(4, W - 12), y, '🔔 inbox 0', 'dim');
  }
  screen.hline(y + 1, '─');

  // Stat cards.
  const cardY = y + 2;
  const totalStars = appState.repos.reduce((a, r) => a + (r.stargazers_count || 0), 0);
  const totalForks = appState.repos.reduce((a, r) => a + (r.forks_count || 0), 0);
  const langSet = new Set(appState.repos.map(r => r.language).filter(Boolean));
  const accountAgeYears = user.created_at
    ? ((Date.now() - new Date(user.created_at).getTime()) / (365.25 * 86400 * 1000)).toFixed(1)
    : '?';

  const cardCount = 4;
  const margin = 4;
  const gap = 2;
  const cardW = Math.max(14, Math.floor((W - margin * 2 - gap * (cardCount - 1)) / cardCount));
  const cards = [
    ['★ Total Stars',  shortNum(totalStars), color('star')],
    ['⑂ Total Forks',  shortNum(totalForks), color('fork')],
    ['◆ Languages',    String(langSet.size), color('trending')],
    ['⏱ Account Age',  accountAgeYears + 'y', color('success')],
  ];
  cards.forEach((c, i) => {
    const cx = margin + i * (cardW + gap);
    if (cardY + 3 >= y + h) return;
    drawCard(screen, cx, cardY, cardW, c[0], c[1], c[2]);
  });

  // Body: 2 columns.
  const bodyY = cardY + 5;
  if (bodyY >= y + h) return;
  const splitX = Math.floor(W / 2);
  const leftX = 4;
  const rightX = splitX + 2;
  const bodyH = (y + h) - bodyY;

  // LEFT COLUMN.
  let ly = bodyY;
  screen.writeStr(leftX, ly++, 'Profile', 'bright');
  const profile = [
    ['@' + user.login, ''],
    [user.email || '—', 'dim'],
    ['Followers: ' + (user.followers || 0) + '  Following: ' + (user.following || 0), 'dim'],
    ['Public: ' + (user.public_repos || 0) + '  Private: ' + (user.total_private_repos || 0), 'dim'],
  ];
  for (const [txt, style] of profile) {
    if (ly >= y + h - 1) break;
    screen.writeStr(leftX, ly++, txt.substring(0, splitX - leftX - 1), style || null);
  }
  ly++;

  // Top repos by stars.
  if (ly < y + h - 2) {
    screen.writeStr(leftX, ly++, '★ Top Repos by Stars', 'bright');
    const top = [...appState.repos]
      .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
      .slice(0, 5);
    if (top.length === 0) {
      screen.writeStr(leftX, ly++, '(no repos)', 'dim');
    } else {
      for (const r of top) {
        if (ly >= y + h - 1) break;
        const stars = '★' + shortNum(r.stargazers_count || 0);
        screen.writeStr(leftX, ly, r.name.substring(0, splitX - leftX - 10));
        screen.writeStr(splitX - 8, ly, stars, color('star'));
        ly++;
      }
    }
    ly++;
  }

  // Language breakdown.
  if (ly < y + h - 2 && appState.repos.length > 0) {
    screen.writeStr(leftX, ly++, '◆ Languages Across Repos', 'bright');
    const langCount = {};
    for (const r of appState.repos) {
      if (r.language) langCount[r.language] = (langCount[r.language] || 0) + 1;
    }
    const total = Object.values(langCount).reduce((a, b) => a + b, 0);
    const sorted = Object.entries(langCount).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const barW = Math.max(6, splitX - leftX - 22);
    if (sorted.length === 0) {
      screen.writeStr(leftX, ly++, '(no language metadata)', 'dim');
    } else {
      for (const [lang, count] of sorted) {
        if (ly >= y + h - 1) break;
        const pct = count / total;
        const filled = Math.max(1, Math.round(pct * barW));
        const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, barW - filled));
        screen.writeStr(leftX, ly, lang.substring(0, 10).padEnd(11));
        screen.writeStr(leftX + 11, ly, bar, color('languageBar'));
        screen.writeStr(leftX + 12 + barW, ly, String(count), 'dim');
        ly++;
      }
    }
  }

  // RIGHT COLUMN.
  let ry = bodyY;
  const rightW = W - rightX - 2;

  screen.writeStr(rightX, ry++, '⚡ Recent Activity', 'bright');
  if (appState.events.length === 0) {
    screen.writeStr(rightX, ry++, appState.dashboardLoaded
      ? '(no recent public events)' : 'Loading…', 'dim');
  } else {
    const maxEvents = Math.min(8, Math.max(1, Math.floor(bodyH * 0.5)));
    for (const ev of appState.events.slice(0, maxEvents)) {
      if (ry >= y + h - 1) break;
      const [icon, c, label] = eventGlyph(ev.type);
      const repo = (ev.repo && ev.repo.name ? ev.repo.name : '?').substring(0, Math.max(10, rightW - 22));
      const when = relTime(ev.created_at);
      screen.writeStr(rightX, ry, icon, c);
      screen.writeStr(rightX + 2, ry, label.substring(0, 11).padEnd(11), 'dim');
      screen.writeStr(rightX + 14, ry, repo);
      screen.writeStr(rightX + rightW - when.length - 1, ry, when, 'dim');
      ry++;
    }
  }
  ry++;

  if (ry < y + h - 2) {
    screen.writeStr(rightX, ry++, '🔥 Trending This Week', 'bright');
    if (appState.trending.length === 0) {
      screen.writeStr(rightX, ry++,
        appState.dashboardLoaded ? '(none)' : 'Loading…', 'dim');
    } else {
      for (const r of appState.trending.slice(0, 5)) {
        if (ry >= y + h - 1) break;
        const name = (r.full_name || '?').substring(0, Math.max(10, rightW - 12));
        const stars = '★' + shortNum(r.stargazers_count || 0);
        screen.writeStr(rightX, ry, name);
        screen.writeStr(rightX + rightW - stars.length - 1, ry, stars, color('star'));
        ry++;
      }
    }
  }
}

export const keys = {};
export const render_ = renderDashboard;
