// Dashboard tab — the home screen.
// v0.4 features: contribution heatmap, issues/PRs activity, stale repos alert,
// star history sparkline, quick actions bar.

import { appState, render, startAsync, isStale, showMessage } from '../state.mjs';
import {
  getUserEvents, getTrendingRepos, getStarredRepos,
  getUserIssues, getUserPullRequests,
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

    // Calculate contribution heatmap from events.
    appState.dashboardContributions = buildHeatmap(appState.events);

    // Calculate stale repos.
    const staleResult = findStaleRepos(appState.repos);
    appState.dashboardStaleCount = staleResult.count;
    appState.dashboardStaleRepos = staleResult.repos;

    // Build star history from starred repos.
    appState.dashboardStarHistory = buildStarHistory(appState.starred);

    appState.dashboardLoaded = true;
    render();
  } catch (e) {
    if (!isStale(gen)) showMessage('Dashboard widgets failed: ' + e.message, 'error');
  }
}

// ─── Heatmap builder ──────────────────────────────────────────────────
// Build a 7-row × 15-column grid from event timestamps.
// Uses PushEvent + IssuesEvent + PullRequestEvent + CreateEvent for activity.
function buildHeatmap(events) {
  const now = Date.now();
  const dayMs = 86400000;
  const weeks = 15;
  const grid = Array.from({ length: 7 }, () => new Array(weeks).fill(0));

  // Count any activity event, not just PushEvent.
  const activityTypes = new Set([
    'PushEvent', 'IssuesEvent', 'PullRequestEvent', 'CreateEvent',
    'PullRequestReviewEvent', 'ReleaseEvent', 'ForkEvent',
  ]);

  // Find the Sunday that starts the grid.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayDay = today.getDay(); // 0=Sun
  const gridStartMs = today.getTime() - (weeks * 7 - 1 + todayDay) * dayMs;

  for (const ev of events) {
    if (!activityTypes.has(ev.type) || !ev.created_at) continue;
    const evDate = new Date(ev.created_at);
    evDate.setHours(0, 0, 0, 0);
    const diffMs = evDate.getTime() - gridStartMs;
    if (diffMs < 0) continue;
    const diffDays = Math.floor(diffMs / dayMs);
    if (diffDays < 0 || diffDays >= weeks * 7) continue;
    const col = Math.floor(diffDays / 7);
    const row = diffDays % 7;
    if (row >= 0 && row < 7 && col >= 0 && col < weeks) {
      grid[row][col]++;
    }
  }
  return { weeks, grid };
}

// ─── Stale repos finder ───────────────────────────────────────────────
function findStaleRepos(repos) {
  const cutoff60 = Date.now() - 60 * 86400000;
  const stale = repos.filter(r => {
    const lastPush = new Date(r.pushed_at || r.updated_at).getTime();
    return lastPush < cutoff60;
  });
  return { count: stale.length, repos: stale.slice(0, 5).map(r => r.name) };
}

// ─── Star history sparkline ───────────────────────────────────────────
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

// ─── Sparkline renderer ───────────────────────────────────────────────
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

  const cardCount = 5;
  const margin = 4;
  const gap = 2;
  const cardW = Math.max(14, Math.floor((W - margin * 2 - gap * (cardCount - 1)) / cardCount));
  const cards = [
    ['★ Total Stars',  shortNum(totalStars), color('star')],
    ['⑂ Total Forks',  shortNum(totalForks), color('fork')],
    ['◆ Languages',    String(langSet.size), color('trending')],
    ['⏱ Account Age',  accountAgeYears + 'y', color('success')],
    ['⚠ Stale Repos',  appState.dashboardStaleCount + '', appState.dashboardStaleCount > 0 ? color('warning') : 'dim'],
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

  // ─── Contribution Heatmap ───
  if (ly < y + h - 8 && appState.dashboardContributions) {
    screen.writeStr(leftX, ly++, '📊 Activity (15 weeks)', 'bright');
    const hm = appState.dashboardContributions;
    const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const cellW = Math.min(2, Math.floor((splitX - leftX - 4) / hm.weeks));
    const heatChars = [' ', '░', '▒', '▓', '█'];
    let totalContribs = 0;
    for (let row = 0; row < 7; row++) {
      if (ly >= y + h - 1) break;
      screen.writeStr(leftX, ly, dayLabels[row], 'dim');
      for (let col = 0; col < hm.weeks; col++) {
        if (leftX + 2 + col * cellW >= splitX - 1) break;
        const val = hm.grid[row][col];
        totalContribs += val;
        const level = val === 0 ? 0 : val === 1 ? 1 : val <= 3 ? 2 : val <= 5 ? 3 : 4;
        const ch = heatChars[level].repeat(cellW);
        const clr = level === 0 ? 'dim' : color('success');
        screen.writeStr(leftX + 2 + col * cellW, ly, ch, clr);
      }
      ly++;
    }
    screen.writeStr(leftX, ly, totalContribs + ' events', 'dim');
    ly += 2;
  }

  // ─── Star History Sparkline ───
  if (ly < y + h - 3 && appState.dashboardStarHistory.length > 0) {
    screen.writeStr(leftX, ly++, '⭐ Stars Last 30 Days', 'bright');
    const sparkW = Math.min(30, splitX - leftX - 4);
    const spark = sparkline(appState.dashboardStarHistory, sparkW);
    const totalStarsRecent = appState.dashboardStarHistory.reduce((a, b) => a + b, 0);
    screen.writeStr(leftX, ly, spark, color('star'));
    screen.writeStr(leftX + sparkW + 2, ly, totalStarsRecent + ' new', 'dim');
    ly += 2;
  }

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
    const maxEvents = Math.min(6, Math.max(1, Math.floor(bodyH * 0.35)));
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

  // ─── Recent Issues ───
  if (ry < y + h - 3 && appState.dashboardRecentIssues.length > 0) {
    screen.writeStr(rightX, ry++, '◉ Recent Issues', 'bright');
    const maxIssues = Math.min(4, Math.max(1, Math.floor(bodyH * 0.2)));
    for (const issue of appState.dashboardRecentIssues.slice(0, maxIssues)) {
      if (ry >= y + h - 1) break;
      const num = '#' + (issue.number || '?');
      const title = (issue.title || '?').substring(0, Math.max(10, rightW - 20));
      const state = issue.state === 'open' ? color('success') : 'dim';
      screen.writeStr(rightX, ry, num.padEnd(7), color('issue'));
      screen.writeStr(rightX + 7, ry, title, state);
      ry++;
    }
    ry++;
  }

  // ─── Recent PRs ───
  if (ry < y + h - 3 && appState.dashboardRecentPRs.length > 0) {
    screen.writeStr(rightX, ry++, '⇄ Recent Pull Requests', 'bright');
    const maxPRs = Math.min(4, Math.max(1, Math.floor(bodyH * 0.2)));
    for (const pr of appState.dashboardRecentPRs.slice(0, maxPRs)) {
      if (ry >= y + h - 1) break;
      const num = '#' + (pr.number || '?');
      const title = (pr.title || '?').substring(0, Math.max(10, rightW - 20));
      const draft = pr.draft ? '[draft] ' : '';
      const state = pr.state === 'open' ? color('pr') : 'dim';
      screen.writeStr(rightX, ry, num.padEnd(7), color('pr'));
      screen.writeStr(rightX + 7, ry, (draft + title).substring(0, rightW - 9), state);
      ry++;
    }
    ry++;
  }

  // ─── Stale Repos Alert ───
  if (ry < y + h - 3 && appState.dashboardStaleCount > 0) {
    screen.writeStr(rightX, ry++, '⚠ Stale Repos (60+ days)', 'bright');
    for (const name of appState.dashboardStaleRepos) {
      if (ry >= y + h - 1) break;
      screen.writeStr(rightX + 2, ry++, name.substring(0, rightW - 4), color('warning'));
    }
    if (appState.dashboardStaleCount > appState.dashboardStaleRepos.length) {
      screen.writeStr(rightX + 2, ry++, '... and ' +
        (appState.dashboardStaleCount - appState.dashboardStaleRepos.length) + ' more', 'dim');
    }
    ry++;
  }

  // Trending This Week.
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

  // ─── Quick Actions Bar ───
  const actionsY = y + h - 1;
  if (actionsY > bodyY) {
    const actions = [
      '[r] Refresh',
      '[n] New Issue',
      '[s] Star Repo',
      '[b] Bookmark',
      '[o] Open Browser',
    ];
    const actionsStr = actions.join('  ');
    screen.writeStr(4, actionsY, actionsStr.substring(0, W - 8), 'dim');
  }
}

export const keys = {};
export const render_ = renderDashboard;
