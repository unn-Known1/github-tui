// Dashboard tab — the home screen.

import { appState, render, startAsync, isStale, showMessage } from '../state.mjs';
import {
  getUserEvents, getTrendingRepos, getStarredRepos,
  getUserIssues, getUserPullRequests,
} from '../github.mjs';
import { relTime, eventGlyph, greeting, shortNum, truncate } from '../utils.mjs';
import { color } from '../theme.mjs';
import { emptyState } from '../render.mjs';

export async function loadDashboardWidgets(force = false) {
  if (!appState.token || !appState.user) return;
  if (appState.dashboardLoaded && !force) return;
  const gen = startAsync();
  const username = appState.user.login;
  try {
    const safe = (p) => p.catch(() => null);
    const [events, trending, starred, issues, prs] = await Promise.all([
      safe(getUserEvents(appState.token, username, 100)),
      safe(getTrendingRepos(appState.token, 7, 5)),
      safe(getStarredRepos(appState.token, 1, 30)),
      safe(getUserIssues(appState.token, 1, 10)),
      safe(getUserPullRequests(appState.token, 1, 10)),
    ]);
    if (isStale(gen)) return;
    appState.events = Array.isArray(events) ? events : [];
    appState.trending = Array.isArray(trending) ? trending : [];
    appState.starred = Array.isArray(starred) ? starred : [];
    appState.dashboardRecentIssues = Array.isArray(issues) ? issues : [];
    appState.dashboardRecentPRs = Array.isArray(prs) ? (prs.items || prs) : [];
    appState.dashboardContributions = buildHeatmap(appState.events);
    const staleResult = findStaleRepos(appState.repos);
    appState.dashboardStaleCount = staleResult.count;
    appState.dashboardStaleRepos = staleResult.repos;
    appState.dashboardStarHistory = buildStarHistory(appState.starred);
    appState.dashboardLoaded = true;
    render();
  } catch (e) {
    if (!isStale(gen)) showMessage('Dashboard widgets failed: ' + e.message, 'error');
  }
}

// ─── Heatmap builder ──────────────────────────────────────────────────
// Builds a 7-row x N-weeks grid from event timestamps.
// Uses the user's OWN repos' push dates as a fallback when public events are sparse.
function buildHeatmap(events) {
  const dayMs = 86400000;
  const weeks = 15;
  const grid = Array.from({ length: 7 }, () => new Array(weeks).fill(0));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayDay = today.getDay();
  const gridStartMs = today.getTime() - (weeks * 7 - 1 + todayDay) * dayMs;
  const gridEndMs = today.getTime() + dayMs;

  function addDay(isoDate) {
    if (!isoDate) return;
    const d = new Date(isoDate);
    d.setHours(0, 0, 0, 0);
    const diffMs = d.getTime() - gridStartMs;
    if (diffMs < 0) return;
    const diffDays = Math.floor(diffMs / dayMs);
    if (diffDays < 0 || diffDays >= weeks * 7) return;
    const col = Math.floor(diffDays / 7);
    const row = diffDays % 7;
    if (row >= 0 && row < 7 && col >= 0 && col < weeks) {
      grid[row][col]++;
    }
  }

  // 1. Count events from the public events API.
  const activityTypes = new Set([
    'PushEvent', 'IssuesEvent', 'PullRequestEvent', 'CreateEvent',
    'PullRequestReviewEvent', 'ReleaseEvent', 'ForkEvent',
    'WatchEvent', 'MemberEvent', 'PublicEvent',
  ]);
  for (const ev of events) {
    if (!activityTypes.has(ev.type) || !ev.created_at) continue;
    addDay(ev.created_at);
  }

  // 2. Also count push dates from the user's repos (covers private repo activity).
  //    Each repo's pushed_at gives us the last push date.
  for (const repo of (appState.repos || [])) {
    addDay(repo.pushed_at);
  }

  // Find max for intensity scaling.
  let max = 0;
  for (const row of grid) for (const v of row) if (v > max) max = v;
  return { weeks, grid, max };
}

function findStaleRepos(repos) {
  const cutoff60 = Date.now() - 60 * 86400000;
  const stale = repos.filter(r => {
    const lastPush = new Date(r.pushed_at || r.updated_at).getTime();
    return lastPush < cutoff60;
  });
  return { count: stale.length, repos: stale.slice(0, 5).map(r => r.name) };
}

function buildStarHistory(starred) {
  if (!starred || starred.length === 0) return [];
  const dayMs = 86400000;
  const days = 30;
  const counts = new Array(days).fill(0);
  const now = Date.now();
  for (const r of starred) {
    if (!r.starred_at) continue;
    const diffDays = Math.floor((now - new Date(r.starred_at).getTime()) / dayMs);
    if (diffDays >= 0 && diffDays < days) {
      counts[days - 1 - diffDays]++;
    }
  }
  return counts;
}

function sparkline(data, width) {
  if (!data || data.length === 0) return '';
  const chars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const max = Math.max(...data, 1);
  const sampled = [];
  const step = data.length / width;
  for (let i = 0; i < width; i++) {
    const idx = Math.min(Math.floor(i * step), data.length - 1);
    sampled.push(data[idx]);
  }
  return sampled.map(v => {
    const normalized = Math.floor((v / max) * (chars.length - 1));
    return chars[normalized];
  }).join('');
}

function drawCard(screen, x, y, w, label, value, valueStyle) {
  if (w < 6) return;
  screen.writeStr(x, y,     '┌' + '─'.repeat(w - 2) + '┐', color('dim'));
  screen.setCell(x, y + 1, '│', color('dim'));
  screen.writeStr(x + 2, y + 1, truncate(label, w - 4), color('dim'));
  screen.setCell(x + w - 1, y + 1, '│', color('dim'));
  screen.setCell(x, y + 2, '│', color('dim'));
  screen.writeStr(x + 2, y + 2, truncate(value, w - 4), valueStyle || color('title'));
  screen.setCell(x + w - 1, y + 2, '│', color('dim'));
  screen.writeStr(x, y + 3, '└' + '─'.repeat(w - 2) + '┘', color('dim'));
}

function sectionHeader(screen, x, y, text) {
  screen.writeStr(x, y, text, color('header'));
}

// Render the contribution heatmap with intensity gradient.
function renderHeatmap(screen, leftX, y, splitX, h) {
  const hm = appState.dashboardContributions;
  if (!hm) return;

  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const maxCellW = Math.floor((splitX - leftX - 4) / hm.weeks);
  const cellW = Math.max(1, Math.min(2, maxCellW));

  // Check if we have any activity.
  const totalEvents = hm.grid.flat().reduce((a, b) => a + b, 0);
  if (totalEvents === 0) {
    screen.writeStr(leftX, y, '(no public activity in last 15 weeks)', color('dim'));
    return;
  }

  sectionHeader(screen, leftX, y, 'ACTIVITY (' + totalEvents + ' events)');
  y++;

  // Intensity levels: dim green -> brighter green based on max value.
  const heatStyle = (level) => {
    if (level === 0) return color('dim');
    if (hm.max <= 3) return { fg: 'green' };
    const ratio = level / hm.max;
    if (ratio < 0.25) return { fg: 'green', dim: true };
    if (ratio < 0.5)  return { fg: 'green' };
    if (ratio < 0.75) return { fg: 'green', bold: true };
    return { fg: 'green', bold: true };
  };

  const heatChars = [' ', '░', '▒', '▓', '█'];
  for (let row = 0; row < 7; row++) {
    if (y >= 0 + h) break;
    screen.writeStr(leftX, y, dayLabels[row], color('dim'));
    for (let col = 0; col < hm.weeks; col++) {
      const cx = leftX + 2 + col * cellW;
      if (cx >= splitX - 1) break;
      const val = hm.grid[row][col];
      // Map value to 0-4 level, scaled by max.
      const level = val === 0 ? 0
        : hm.max <= 4 ? Math.min(4, val)
        : Math.min(4, Math.ceil((val / hm.max) * 4));
      const ch = heatChars[level].repeat(cellW);
      screen.writeStr(cx, y, ch, heatStyle(level));
    }
    y++;
  }

  // Legend bar.
  const legend = 'Less ░▒▓█ More';
  screen.writeStr(leftX, y, legend, color('dim'));
}

export function renderDashboard(screen, y, h) {
  const W = screen.width;
  const user = appState.user;

  if (!user) {
    emptyState(screen, y, h, {
      icon: '---',
      title: 'Not authenticated',
      message: 'Go to Settings [4] to log in',
      hint: '',
    });
    return;
  }

  // Greeting row.
  const heading = greeting() + ', ' + (user.name || user.login);
  screen.writeStr(4, y, heading, color('title'));

  const unread = appState.notifications.filter(n => n.unread).length;
  if (unread > 0) {
    const badge = unread + ' unread';
    screen.writeStr(Math.max(4, W - badge.length - 6), y, badge, { fg: 'yellow', bold: true });
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

  const cardCount = 5;
  const margin = 4;
  const gap = 1;
  const cardW = Math.max(14, Math.floor((W - margin * 2 - gap * (cardCount - 1)) / cardCount));
  const cards = [
    ['Stars',      shortNum(totalStars), color('star')],
    ['Forks',      shortNum(totalForks), color('fork')],
    ['Languages',  String(langSet.size), color('trending')],
    ['Account Age', accountAgeYears + 'y', color('success')],
    ['Stale',      String(appState.dashboardStaleCount), appState.dashboardStaleCount > 0 ? color('warning') : color('dim')],
  ];
  cards.forEach((c, i) => {
    const cx = margin + i * (cardW + gap);
    if (cardY + 3 >= y + h) return;
    drawCard(screen, cx, cardY, cardW, c[0], c[1], c[2]);
  });

  // Body: 2 columns with a vertical divider.
  const bodyY = cardY + 5;
  if (bodyY >= y + h) return;
  const splitX = Math.floor(W / 2);
  const leftX = 4;
  const rightX = splitX + 3;
  const bodyH = (y + h) - bodyY;

  for (let dy = 0; dy < bodyH; dy++) {
    screen.setCell(splitX + 1, bodyY + dy, '│', color('dim'));
  }

  // LEFT COLUMN.
  let ly = bodyY;
  sectionHeader(screen, leftX, ly++, 'PROFILE');
  const profile = [
    ['@' + user.login, null],
    [user.email || '—', color('dim')],
    ['Followers: ' + (user.followers || 0) + '  Following: ' + (user.following || 0), color('dim')],
    ['Public: ' + (user.public_repos || 0) + '  Private: ' + (user.total_private_repos || 0), color('dim')],
  ];
  for (const [txt, style] of profile) {
    if (ly >= y + h - 1) break;
    screen.writeStr(leftX, ly++, txt.substring(0, splitX - leftX - 2), style);
  }
  ly++;

  // Heatmap.
  if (ly < y + h - 8) {
    renderHeatmap(screen, leftX, ly, splitX, y + h);
    ly += 10; // Reserve space for heatmap (7 rows + header + legend + gap)
  }

  // Sparkline with axis labels.
  if (ly < y + h - 4 && appState.dashboardStarHistory.length > 0) {
    sectionHeader(screen, leftX, ly++, 'STARS (30 DAYS)');
    const sparkW = Math.min(30, splitX - leftX - 4);
    const spark = sparkline(appState.dashboardStarHistory, sparkW);
    const totalStarsRecent = appState.dashboardStarHistory.reduce((a, b) => a + b, 0);
    screen.writeStr(leftX, ly, spark, color('star'));
    // Axis labels.
    screen.writeStr(leftX, ly + 1, '30d ago', color('dim'));
    const todayLabel = 'today';
    screen.writeStr(leftX + sparkW - todayLabel.length, ly + 1, todayLabel, color('dim'));
    ly += 2;
    screen.writeStr(leftX, ly, totalStarsRecent + ' new stars', color('dim'));
    ly++;
  }

  // Top repos.
  if (ly < y + h - 2) {
    sectionHeader(screen, leftX, ly++, 'TOP REPOS');
    const top = [...appState.repos]
      .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
      .slice(0, 5);
    if (top.length === 0) {
      screen.writeStr(leftX, ly++, '(no repos)', color('dim'));
    } else {
      for (const r of top) {
        if (ly >= y + h - 1) break;
        const stars = '★' + shortNum(r.stargazers_count || 0);
        screen.writeStr(leftX, ly, r.name.substring(0, splitX - leftX - 12));
        screen.writeStr(splitX - 8, ly, stars, color('star'));
        ly++;
      }
    }
    ly++;
  }

  // Language breakdown.
  if (ly < y + h - 2 && appState.repos.length > 0) {
    sectionHeader(screen, leftX, ly++, 'LANGUAGES');
    const langCount = {};
    for (const r of appState.repos) {
      if (r.language) langCount[r.language] = (langCount[r.language] || 0) + 1;
    }
    const total = Object.values(langCount).reduce((a, b) => a + b, 0);
    const sorted = Object.entries(langCount).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const barW = Math.max(6, splitX - leftX - 22);
    if (sorted.length === 0) {
      screen.writeStr(leftX, ly++, '(no language metadata)', color('dim'));
    } else {
      for (const [lang, count] of sorted) {
        if (ly >= y + h - 1) break;
        const pct = count / total;
        const filled = Math.max(1, Math.round(pct * barW));
        const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, barW - filled));
        screen.writeStr(leftX, ly, lang.substring(0, 10).padEnd(11));
        screen.writeStr(leftX + 11, ly, bar, color('languageBar'));
        screen.writeStr(leftX + 12 + barW, ly, String(count), color('dim'));
        ly++;
      }
    }
  }

  // RIGHT COLUMN.
  let ry = bodyY;
  const rightW = W - rightX - 2;

  sectionHeader(screen, rightX, ry++, 'RECENT ACTIVITY');
  if (appState.events.length === 0) {
    screen.writeStr(rightX, ry++, appState.dashboardLoaded
      ? '(no public events)' : 'Loading...', color('dim'));
  } else {
    const maxEvents = Math.min(6, Math.max(1, Math.floor(bodyH * 0.35)));
    for (const ev of appState.events.slice(0, maxEvents)) {
      if (ry >= y + h - 1) break;
      const [icon, c, label] = eventGlyph(ev.type);
      const repo = (ev.repo && ev.repo.name ? ev.repo.name : '?').substring(0, Math.max(10, rightW - 22));
      const when = relTime(ev.created_at);
      screen.writeStr(rightX, ry, icon, c);
      screen.writeStr(rightX + 2, ry, label.substring(0, 11).padEnd(11), color('dim'));
      screen.writeStr(rightX + 14, ry, repo);
      screen.writeStr(rightX + rightW - when.length - 1, ry, when, color('dim'));
      ry++;
    }
  }
  ry++;

  if (ry < y + h - 3 && appState.dashboardRecentIssues.length > 0) {
    sectionHeader(screen, rightX, ry++, 'RECENT ISSUES');
    const maxIssues = Math.min(4, Math.max(1, Math.floor(bodyH * 0.2)));
    for (const issue of appState.dashboardRecentIssues.slice(0, maxIssues)) {
      if (ry >= y + h - 1) break;
      const num = '#' + (issue.number || '?');
      const title = (issue.title || '?').substring(0, Math.max(10, rightW - 20));
      const state = issue.state === 'open' ? color('success') : color('dim');
      screen.writeStr(rightX, ry, num.padEnd(7), color('issue'));
      screen.writeStr(rightX + 7, ry, title, state);
      ry++;
    }
    ry++;
  }

  if (ry < y + h - 3 && appState.dashboardRecentPRs.length > 0) {
    sectionHeader(screen, rightX, ry++, 'RECENT PRS');
    const maxPRs = Math.min(4, Math.max(1, Math.floor(bodyH * 0.2)));
    for (const pr of appState.dashboardRecentPRs.slice(0, maxPRs)) {
      if (ry >= y + h - 1) break;
      const num = '#' + (pr.number || '?');
      const title = (pr.title || '?').substring(0, Math.max(10, rightW - 20));
      const draft = pr.draft ? '[draft] ' : '';
      const state = pr.state === 'open' ? color('pr') : color('dim');
      screen.writeStr(rightX, ry, num.padEnd(7), color('pr'));
      screen.writeStr(rightX + 7, ry, (draft + title).substring(0, rightW - 9), state);
      ry++;
    }
    ry++;
  }

  if (ry < y + h - 3 && appState.dashboardStaleCount > 0) {
    sectionHeader(screen, rightX, ry++, 'STALE REPOS');
    for (const name of appState.dashboardStaleRepos) {
      if (ry >= y + h - 1) break;
      screen.writeStr(rightX + 2, ry++, name.substring(0, rightW - 4), color('warning'));
    }
    if (appState.dashboardStaleCount > appState.dashboardStaleRepos.length) {
      screen.writeStr(rightX + 2, ry++, '... and ' +
        (appState.dashboardStaleCount - appState.dashboardStaleRepos.length) + ' more', color('dim'));
    }
    ry++;
  }

  if (ry < y + h - 2) {
    sectionHeader(screen, rightX, ry++, 'TRENDING');
    if (appState.trending.length === 0) {
      screen.writeStr(rightX, ry++, appState.dashboardLoaded ? '(none)' : 'Loading...', color('dim'));
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
