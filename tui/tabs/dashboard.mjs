// Dashboard tab — the home screen.
// v0.5+ design: cleaner section cards, focus-aware stat cards, breadcrumb-aware.

import { appState, render, startAsync, isStale, showMessage, setTab, confirm } from '../state.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import {
  getUserEvents, getTrendingRepos, getStarredRepos,
  getUserIssues, getUserPullRequests, searchRepositories,
  getUserFollowers,
} from '../github.mjs';
import { relTime, eventGlyph, greeting, shortNum, truncate, openUrl } from '../utils.mjs';
import { color } from '../theme.mjs';
import { emptyState, collapsibleHeader, loadingIndicator, getScreen } from '../render.mjs';
import { loadRepoDetails } from './analyze.mjs';

export async function loadDashboardWidgets(force = false) {
  if (!appState.token || !appState.user) return;
  if (appState.dashboardLoaded && !force) return;
  const gen = startAsync();
  const username = appState.user.login;
  try {
    const safe = (p) => p.catch(() => null);
    const days = appState.trendingPeriod || 7;
    const [events, trending, starred, issues, prs, followers] = await Promise.all([
      safe(getUserEvents(appState.token, username, 100)),
      safe(getTrendingRepos(appState.token, days, 100)),
      safe(getStarredRepos(appState.token, 1, 100)),
      safe(getUserIssues(appState.token, 1, 10)),
      safe(getUserPullRequests(appState.token, 1, 10)),
      safe(getUserFollowers(appState.token, 1, 10)),
    ]);
    if (isStale(gen)) { appState.loading = false; return; }
    appState.events = Array.isArray(events) ? events : [];
    appState.trending = Array.isArray(trending) ? trending : [];
    appState.trendingPage = 1;
    appState.trendingScroll = 0;
    appState.trendingSelected = 0;
    appState.trendingHasMore = appState.trending.length >= 100;
    appState.starred = Array.isArray(starred) ? starred : [];
    appState.dashboardRecentIssues = Array.isArray(issues) ? issues : [];
    appState.dashboardRecentPRs = Array.isArray(prs) ? (prs.items || prs) : [];
    appState.userFollowers = Array.isArray(followers) ? followers : [];
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
function buildHeatmap(events) {
  const dayMs = 86400000;
  const weeks = 15;
  const grid = Array.from({ length: 7 }, () => new Array(weeks).fill(0));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayDay = today.getDay();
  const gridStartMs = today.getTime() - (weeks * 7 - 1 + todayDay) * dayMs;

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

  const activityTypes = new Set([
    'PushEvent', 'IssuesEvent', 'PullRequestEvent', 'CreateEvent',
    'PullRequestReviewEvent', 'ReleaseEvent', 'ForkEvent',
    'WatchEvent', 'MemberEvent', 'PublicEvent',
  ]);
  for (const ev of events) {
    if (!activityTypes.has(ev.type) || !ev.created_at) continue;
    addDay(ev.created_at);
  }

  for (const repo of (appState.repos || [])) {
    addDay(repo.pushed_at);
  }

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

export function buildStarHistory(starred) {
  if (!starred || starred.length === 0) return [];
  const dayMs = 86400000;
  const days = 30;
  const counts = new Array(days).fill(0);
  // Normalise both dates to midnight UTC so the day boundary is clean.
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  for (const r of starred) {
    if (!r.starred_at) continue;
    const d = new Date(r.starred_at);
    d.setUTCHours(0, 0, 0, 0);
    const diffDays = Math.floor((now.getTime() - d.getTime()) / dayMs);
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

// Section header: title + optional key hint on the right.
function sectionHeader(screen, x, y, text, hint, section) {
  if (section) {
    return collapsibleHeader(screen, x, y, section, text, hint);
  }
  screen.writeStr(x, y, text, color('sectionHeading'));
  if (hint) {
    const hx = screen.width - hint.length - 2;
    if (hx > x + text.length + 4) screen.writeStr(hx, y, hint, { dim: true });
  }
  return true;
}

export function renderDashboard(screen, y, h) {
  const W = screen.width;
  const user = appState.user;

  if (!user) {
    emptyState(screen, y, h, {
      icon: '🔒  NOT SIGNED IN',
      title: 'Welcome to GitHub TUI',
      message: 'Sign in with a Personal Access Token to see your dashboard.',
      hint: '',
      keyHint: 'Press [6] for Settings  →  [Enter] on Login',
    });
    return;
  }

  // Greeting row.
  const heading = greeting() + ', ' + (user.name || user.login);
  screen.writeStr(2, y, heading, color('title') || { fg: 'white', bold: true });

  const unread = appState.notifications.filter(n => n.unread).length;
  if (unread > 0) {
    const badge = '🔔 ' + unread + ' unread';
    screen.writeStr(Math.max(2, W - badge.length - 4), y, badge, { fg: 'yellow', bold: true });
  }
  screen.hline(y + 1, '─', { dim: true });

  // ── Stat cards ──────────────────────────────────────────────
  const cardY = y + 3;
  const totalStars = appState.repos.reduce((a, r) => a + (r.stargazers_count || 0), 0);
  const totalForks = appState.repos.reduce((a, r) => a + (r.forks_count || 0), 0);
  const langSet = new Set(appState.repos.map(r => r.language).filter(Boolean));
  const accountAgeYears = user.created_at
    ? ((Date.now() - new Date(user.created_at).getTime()) / (365.25 * 86400 * 1000)).toFixed(1)
    : '?';

  const cardCount = 5;
  const margin = 2;
  const gap = 1;
  const cardW = Math.max(14, Math.floor((W - margin * 2 - gap * (cardCount - 1)) / cardCount));
  const cardH = 4;
  const cards = [
    { label: 'STARS',         value: shortNum(totalStars),                            style: { fg: 'yellow', bold: true } },
    { label: 'FORKS',         value: shortNum(totalForks),                            style: { fg: 'cyan', bold: true } },
    { label: 'LANGUAGES',     value: String(langSet.size),                            style: { fg: 'magenta', bold: true } },
    { label: 'ACCOUNT AGE',   value: accountAgeYears + 'y',                           style: { fg: 'green', bold: true } },
    { label: 'STALE',         value: String(appState.dashboardStaleCount),            style: appState.dashboardStaleCount > 0 ? { fg: 'yellow', bold: true } : { dim: true } },
  ];
  const cardsFocus = appState.dashboardCardsFocus;
  cards.forEach((c, i) => {
    const cx = margin + i * (cardW + gap);
    if (cardY + cardH >= y + h) return;
    const focused = cardsFocus && i === appState.dashboardSelectedCard;
    const fillStyle = focused ? { bg: 'blue', fg: 'white' } : null;
    const borderStyle = focused ? { fg: 'cyan', bold: true } : { fg: 'gray', dim: true };
    screen.card(cx, cardY, cardW, cardH, c.label, fillStyle, borderStyle);
    const valStr = c.value;
    const valX = cx + Math.floor((cardW - valStr.length) / 2);
    screen.writeStr(valX, cardY + 2, valStr, focused ? { fg: 'white', bold: true } : c.style);
  });

  // ── Body: 2 columns ────────────────────────────────────────
  const bodyY = cardY + cardH + 2;
  if (bodyY >= y + h) return;
  const splitX = Math.floor(W / 2);
  const leftX = 2;
  const rightX = splitX + 2;
  const leftW = splitX - leftX - 2;
  const rightW = W - rightX - 2;

  // LEFT COLUMN ─────────────────────────────────────────────
  let ly = bodyY;

  const profileVisible = sectionHeader(screen, leftX, ly, 'PROFILE', null, 'dashboard:profile');
  ly++;
  if (profileVisible) {
    const profile = [
      { text: '@' + user.login, style: { fg: 'cyan', bold: true } },
      { text: user.email || '—', style: { dim: true } },
      { text: 'Followers: ' + (user.followers || 0) + '   Following: ' + (user.following || 0), style: { dim: true } },
      { text: 'Public: ' + (user.public_repos || 0) + '   Private: ' + (user.total_private_repos || 0), style: { dim: true } },
    ];
    for (const p of profile) {
      if (ly >= y + h - 1) break;
      screen.writeStr(leftX, ly++, p.text.substring(0, leftW), p.style);
    }
    ly++;

    // Show recent followers if available
    if (appState.userFollowers.length > 0 && ly < y + h - 2) {
      screen.writeStr(leftX, ly, 'Recent followers:', { dim: true });
      ly++;
      const maxFollowers = Math.min(5, appState.userFollowers.length);
      for (let i = 0; i < maxFollowers; i++) {
        if (ly >= y + h - 1) break;
        const f = appState.userFollowers[i];
        const login = (f.login || '?').substring(0, leftW - 2);
        screen.writeStr(leftX + 2, ly++, '@' + login, { fg: 'cyan' });
      }
    }
  }

  if (ly < y + h - 4 && appState.dashboardStarHistory.length > 0) {
    const starsVisible = sectionHeader(screen, leftX, ly, 'STARS · LAST 30 DAYS', null, 'dashboard:stars');
    ly++;
    if (starsVisible) {
      const sparkW = Math.min(leftW - 2, 30);
      const spark = sparkline(appState.dashboardStarHistory, sparkW);
      screen.writeStr(leftX, ly, spark, { fg: 'yellow' });
      ly++;
      const totalStarsRecent = appState.dashboardStarHistory.reduce((a, b) => a + b, 0);
      screen.writeStr(leftX, ly, '30d ago', { dim: true });
      const todayLabel = 'today';
      screen.writeStr(leftX + sparkW - todayLabel.length, ly, todayLabel, { dim: true });
      ly++;
      screen.writeStr(leftX, ly, totalStarsRecent + ' new stars in 30 days', { dim: true });
      ly += 2;
    }
  }

  if (ly < y + h - 2) {
    const topReposVisible = sectionHeader(screen, leftX, ly, 'TOP REPOS', null, 'dashboard:topRepos');
    ly++;
    if (topReposVisible) {
      const top = [...appState.repos]
        .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
        .slice(0, 5);
      if (top.length === 0) {
        screen.writeStr(leftX, ly++, 'No repos — add repos to your GitHub account', { dim: true });
      } else {
        for (const r of top) {
          if (ly >= y + h - 1) break;
          const stars = '★ ' + shortNum(r.stargazers_count || 0);
          const nameMax = leftW - stars.length - 2;
          screen.writeStr(leftX, ly, truncate(r.name, nameMax), color('repoName') || { fg: 'white' });
          screen.writeStr(leftX + leftW - stars.length, ly, stars, { fg: 'yellow' });
          ly++;
        }
      }
      ly++;
    }
  }

  // Heatmap + Languages side by side in left column below top repos.
  const halfW = splitX - leftX - 2;
  const heatRightX = leftX + Math.floor(halfW * 0.58);
  const langLeftX = heatRightX + 2;
  const heatTopY = ly;

  // ── Heatmap (left sub-column) ──
  if (ly < y + h - 4) {
    const hm = appState.dashboardContributions;
    if (hm) {
      const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
      const heatW = heatRightX - leftX - 4;
      const cellW = Math.max(1, Math.min(2, Math.floor(heatW / hm.weeks)));
      const commitCount = appState.events
        .filter(ev => ev.type === 'PushEvent')
        .reduce((sum, ev) => sum + (ev.payload.size || ev.payload.distinct_size || 0), 0);
      const totalEvents = hm.grid.flat().reduce((a, b) => a + b, 0);

      const activityLabel = commitCount === 0
        ? (totalEvents === 0 ? 'CONTRIBUTIONS' : 'CONTRIBUTIONS · ' + totalEvents)
        : 'CONTRIBUTIONS · ' + commitCount + ' commits';
      const activityVisible = sectionHeader(screen, leftX, ly, activityLabel, null, 'dashboard:contributions');
      ly++;

      if (activityVisible) {
      if (totalEvents === 0) {
        screen.writeStr(leftX, ly++, 'No recent activity — push code or open issues to get started', { dim: true });
      } else {

  const heatStyle = (level) => {
    if (level === 0) return color('dim');
    if (hm.max <= 3) return color('activity');
    const ratio = level / hm.max;
    if (ratio < 0.25) return color('heatmapLow');
    if (ratio < 0.5)  return color('heatmapMid');
    return color('heatmapHigh');
  };

        const heatChars = [' ', '░', '▒', '▓', '█'];
        for (let row = 0; row < 7; row++) {
          if (ly >= y + h - 1) break;
          screen.writeStr(leftX, ly, dayLabels[row], { dim: true });
          for (let col = 0; col < hm.weeks; col++) {
            const cx = leftX + 3 + col * cellW;
            if (cx >= heatRightX - 1) break;
            const val = hm.grid[row][col];
            const level = val === 0 ? 0
              : hm.max <= 4 ? Math.min(4, val)
              : Math.min(4, Math.ceil((val / hm.max) * 4));
            screen.writeStr(cx, ly, heatChars[level].repeat(cellW), heatStyle(level));
          }
          ly++;
        }
        screen.writeStr(leftX, ly, 'Less ░▒▓█ More', { dim: true });
        ly++;
      }
      } // activityVisible
      ly++;
    }
  }

  // ── Languages (right sub-column, aligned with heatmap top) ──
  if (appState.repos.length > 0 && heatTopY < y + h - 2) {
    const langVisible = sectionHeader(screen, langLeftX, heatTopY, 'LANGUAGES', null, 'dashboard:languages');
    if (langVisible) {
      const langCount = {};
      for (const r of appState.repos) {
        if (r.language) langCount[r.language] = (langCount[r.language] || 0) + 1;
      }
      const total = Object.values(langCount).reduce((a, b) => a + b, 0);
      const sorted = Object.entries(langCount).sort((a, b) => b[1] - a[1]).slice(0, 7);
      const barW = Math.max(3, halfW - Math.floor(halfW * 0.58) - 14);
      let lly = heatTopY + 1;
      if (sorted.length === 0) {
        screen.writeStr(langLeftX, lly, 'No language data — repos may not have languages detected', { dim: true });
      } else {
        for (const [lang, count] of sorted) {
          if (lly >= y + h - 1) break;
          const pct = count / total;
          const filled = Math.max(1, Math.round(pct * barW));
          const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, barW - filled));
          screen.writeStr(langLeftX, lly, lang.substring(0, 8).padEnd(9));
          screen.writeStr(langLeftX + 9, lly, bar, { fg: 'cyan' });
          screen.writeStr(langLeftX + 10 + barW, lly, String(count), { dim: true });
          lly++;
        }
      }
    }
  }

  // RIGHT COLUMN ────────────────────────────────────────────
  let ry = bodyY;

  const activityVisible = sectionHeader(screen, rightX, ry, 'RECENT ACTIVITY', '[Enter] open first', 'dashboard:recentActivity');
  ry++;
  if (activityVisible) {
    if (appState.events.length === 0) {
      if (!appState.dashboardLoaded) {
        loadingIndicator(screen, rightX, ry, 'loading events');
        ry++;
      } else {
        screen.writeStr(rightX, ry++, 'No activity yet — [r] to refresh', { dim: true });
      }
    } else {
      const maxEvents = Math.min(7, Math.max(1, Math.floor((y + h - bodyY) * 0.30)));
      for (const ev of appState.events.slice(0, maxEvents)) {
        if (ry >= y + h - 1) break;
        const [icon, c, label] = eventGlyph(ev.type);
        const repo = (ev.repo && ev.repo.name ? ev.repo.name : '?').substring(0, Math.max(10, rightW - 22));
        const when = relTime(ev.created_at);
        screen.writeStr(rightX, ry, icon, c);
        screen.writeStr(rightX + 2, ry, label.substring(0, 11).padEnd(11), { dim: true });
        screen.writeStr(rightX + 14, ry, truncate(repo, rightW - 22));
        screen.writeStr(rightX + rightW - when.length, ry, when, { dim: true });
        ry++;
      }
    }
    ry++;
  }

  if (ry < y + h - 3 && appState.dashboardRecentIssues.length > 0) {
    const issuesVisible = sectionHeader(screen, rightX, ry, 'RECENT ISSUES', null, 'dashboard:issues');
    ry++;
    if (issuesVisible) {
      const maxIssues = Math.min(4, Math.max(1, Math.floor((y + h - bodyY) * 0.20)));
      for (const issue of appState.dashboardRecentIssues.slice(0, maxIssues)) {
        if (ry >= y + h - 1) break;
        const num = '#' + (issue.number || '?');
        const titleMax = rightW - 14;
        const title = truncate(issue.title || '?', titleMax);
        const stateStyle = issue.state === 'open' ? { fg: 'green' } : { dim: true };
        screen.writeStr(rightX, ry, num, { fg: 'yellow' });
        screen.writeStr(rightX + 8, ry, title, stateStyle);
        ry++;
      }
      ry++;
    }
  }

  if (ry < y + h - 3 && appState.dashboardRecentPRs.length > 0) {
    const prsVisible = sectionHeader(screen, rightX, ry, 'RECENT PRs', null, 'dashboard:prs');
    ry++;
    if (prsVisible) {
      const maxPRs = Math.min(4, Math.max(1, Math.floor((y + h - bodyY) * 0.20)));
      for (const pr of appState.dashboardRecentPRs.slice(0, maxPRs)) {
        if (ry >= y + h - 1) break;
        const num = '#' + (pr.number || '?');
        const draft = pr.draft ? '[draft] ' : '';
        const titleMax = rightW - 14;
        const title = truncate(draft + (pr.title || '?'), titleMax);
        const stateStyle = pr.state === 'open' ? { fg: 'cyan' } : { dim: true };
        screen.writeStr(rightX, ry, num, { fg: 'cyan' });
        screen.writeStr(rightX + 8, ry, title, stateStyle);
        ry++;
      }
      ry++;
    }
  }

  if (ry < y + h - 3 && appState.dashboardStaleCount > 0) {
    const staleVisible = sectionHeader(screen, rightX, ry, 'STALE REPOS', null, 'dashboard:stale');
    ry++;
    if (staleVisible) {
      for (const name of appState.dashboardStaleRepos) {
        if (ry >= y + h - 1) break;
        screen.writeStr(rightX, ry++, truncate(name, rightW), { fg: 'yellow' });
      }
      if (appState.dashboardStaleCount > appState.dashboardStaleRepos.length) {
        screen.writeStr(rightX, ry++, '... and ' +
          (appState.dashboardStaleCount - appState.dashboardStaleRepos.length) + ' more', { dim: true });
      }
      ry++;
    }
  }

  if (ry < y + h - 2) {
    const trendingList = getFilteredTrending();
    const periodLabel = appState.trendingPeriod === 1 ? 'TRENDING TODAY' : appState.trendingPeriod === 7 ? 'TRENDING THIS WEEK' : 'TRENDING THIS MONTH';
    const trendingVisible = sectionHeader(screen, rightX, ry, periodLabel, '[t] toggle', 'dashboard:trending');
    if (appState.dashboardFilter) {
      screen.writeStr(rightX + 24, ry, 'filter: "' + appState.dashboardFilter + '"', { dim: true, fg: 'yellow' });
    }
    ry++;
    if (trendingList.length === 0) {
      if (!appState.dashboardLoaded) {
        loadingIndicator(screen, rightX, ry, 'loading trending');
        ry++;
      } else {
        screen.writeStr(rightX, ry++, '(none)', { dim: true });
      }
    } else {
      const maxTrending = Math.max(3, Math.floor((y + h - bodyY) * 0.30));
      const scroll = appState.trendingScroll;
      const end = Math.min(scroll + maxTrending, trendingList.length);
      for (let i = scroll; i < end; i++) {
        if (ry >= y + h - 1) break;
        const r = trendingList[i];
        const sel = i === appState.trendingSelected;
        if (sel) {
          for (let x = rightX; x < rightX + rightW; x++) screen.styleBuf[ry][x] = { bg: 'blue', fg: 'white', bold: true };
        }
        const name = truncate(r.full_name || '?', rightW - 8);
        const stars = '★ ' + shortNum(r.stargazers_count || 0);
        screen.writeStr(rightX, ry, sel ? '▶ ' : '  ', sel ? { bg: 'blue', fg: 'white' } : null);
        screen.writeStr(rightX + 2, ry, name, sel ? { bg: 'blue', fg: 'white', bold: true } : (color('repoName') || { fg: 'white' }));
        screen.writeStr(rightX + rightW - stars.length, ry, stars, sel ? { bg: 'blue', fg: 'magenta' } : { fg: 'magenta' });
        ry++;
      }
      if (appState.trendingHasMore || appState.trendingPage > 1) {
        const pageInfo = 'Page ' + appState.trendingPage + '   [PgUp/PgDn]';
        screen.writeStr(rightX, ry, pageInfo, { dim: true });
        ry++;
      }
    }
  }

  // Column divider line.
  const colBot = Math.max(ly, ry);
  const bodyH = Math.max(0, colBot - bodyY);
  for (let dy = 0; dy < bodyH; dy++) {
    screen.setCell(splitX, bodyY + dy, '│', { dim: true });
  }
}

export async function loadMoreTrending() {
  if (!appState.trendingHasMore || !appState.token || appState.loading) return;
  const gen = startAsync();
  appState.loading = true;
  render();
  try {
    const days = appState.trendingPeriod || 7;
    const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
    const q = 'created:>' + since;
    const page = appState.trendingPage + 1;
    const more = await searchRepositories(appState.token, q, page, 10);
    if (isStale(gen)) { appState.loading = false; render(); return; }
    if (Array.isArray(more) && more.length > 0) {
      appState.trending = [...appState.trending, ...more];
      appState.trendingPage = page;
      appState.trendingHasMore = more.length >= 10;
    } else {
      appState.trendingHasMore = false;
    }
    appState.loading = false;
    render();
  } catch (e) {
    appState.loading = false;
    if (!isStale(gen)) showMessage('Failed to load more trending', 'error');
  }
}

export function openTrendingRepo() {
  const trendingList = getFilteredTrending();
  if (trendingList.length === 0) return;
  const idx = Math.min(appState.trendingSelected, trendingList.length - 1);
  const r = trendingList[idx] || trendingList[0];
  const [owner, name] = r.full_name.split('/');
  setTab(2);
  loadRepoDetails(owner, name);
}

export function trendingUp() {
  const trendingList = getFilteredTrending();
  if (trendingList.length === 0) return;
  appState.trendingSelected = Math.max(0, appState.trendingSelected - 1);
  if (appState.trendingSelected < appState.trendingScroll) {
    appState.trendingScroll = appState.trendingSelected;
  }
  render();
}

export function trendingDown() {
  const trendingList = getFilteredTrending();
  if (trendingList.length === 0) return;
  if (appState.trendingSelected < trendingList.length - 1) {
    appState.trendingSelected++;
    const screen = getScreen();
    const H = screen ? screen.height : 24;
    const maxTrending = Math.max(3, Math.floor((H - 17) * 0.30));
    if (appState.trendingSelected >= appState.trendingScroll + maxTrending) {
      appState.trendingScroll++;
    }
    render();
  } else if (appState.trendingHasMore) {
    loadMoreTrending();
  }
}

export function pageUp() {
  if (appState.trendingPage > 1) {
    const page = appState.trendingPage - 1;
    const days = appState.trendingPeriod || 7;
    const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
    const q = 'created:>' + since;
    const gen = startAsync();
    appState.loading = true;
    render();
    searchRepositories(appState.token, q, page, 10).then(more => {
      if (isStale(gen)) { appState.loading = false; return; }
      if (Array.isArray(more)) {
        appState.trending = more;
        appState.trendingPage = page;
        appState.trendingHasMore = true;
      }
      appState.loading = false;
      render();
    }).catch(() => { appState.loading = false; render(); });
  }
}

export function pageDown() {
  if (appState.trendingHasMore) {
    const page = appState.trendingPage + 1;
    const days = appState.trendingPeriod || 7;
    const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
    const q = 'created:>' + since;
    const gen = startAsync();
    appState.loading = true;
    render();
    searchRepositories(appState.token, q, page, 10).then(more => {
      if (isStale(gen)) { appState.loading = false; return; }
      if (Array.isArray(more) && more.length > 0) {
        appState.trending = [...appState.trending, ...more];
        appState.trendingPage = page;
        appState.trendingHasMore = more.length >= 10;
      } else {
        appState.trendingHasMore = false;
      }
      appState.loading = false;
      render();
    }).catch(() => { appState.loading = false; render(); });
  }
}

// Open the focused stat card (currently: STALE = jump to Repos with stale filter).
export function openFocusedCard() {
  if (!appState.dashboardCardsFocus) return;
  const i = appState.dashboardSelectedCard;
  if (i === 4) {
    // Stale → repos with stale filter
    setTab(1);
    appState.repoStaleOnly = true;
    appState.repoScroll = 0;
    appState.repoSelected = 0;
    appState.dashboardCardsFocus = false;
    showMessage('Showing stale repos', 'info');
    render();
  } else if (i === 0 || i === 1) {
    // Stars / Forks → repos tab
    setTab(1);
    appState.dashboardCardsFocus = false;
    render();
  }
}

registerInputHandler('dashboard-filter', (value) => {
  appState.dashboardFilter = (value || '').trim();
  appState.trendingSelected = 0;
  showMessage(appState.dashboardFilter
    ? 'Filtering trending: "' + appState.dashboardFilter + '"'
    : 'Trending filter cleared', 'info');
  render();
});

function getFilteredTrending() {
  const q = (appState.dashboardFilter || '').trim().toLowerCase();
  if (!q) return appState.trending;
  return appState.trending.filter(r => (r.full_name || '').toLowerCase().includes(q));
}

function reloadTrending() {
  if (!appState.token) return;
  const days = appState.trendingPeriod;
  const gen = startAsync();
  appState.loading = true;
  render();
  getTrendingRepos(appState.token, days, 100).then(more => {
    if (isStale(gen)) { appState.loading = false; return; }
    appState.trending = Array.isArray(more) ? more : [];
    appState.trendingPage = 1;
    appState.trendingScroll = 0;
    appState.trendingSelected = 0;
    appState.trendingHasMore = appState.trending.length >= 100;
    appState.loading = false;
    render();
  }).catch(() => { appState.loading = false; render(); });
}

export const keys = {
  't': () => {
    const cycle = { 1: 7, 7: 30, 30: 1 };
    appState.trendingPeriod = cycle[appState.trendingPeriod] || 7;
    const labels = { 1: 'today', 7: 'this week', 30: 'this month' };
    showMessage('Trending: ' + labels[appState.trendingPeriod], 'info');
    reloadTrending();
  },
  '/': () => startInput('Filter trending: ', 'dashboard-filter'),
  'n': () => {
    import('../issue-create.mjs').then(m => m.startCreateIssue());
  },
};

// Card focus navigation (Tab on dashboard).
export function focusCards() {
  appState.dashboardCardsFocus = true;
  render();
}
export function unfocusCards() {
  appState.dashboardCardsFocus = false;
  render();
}
export function leftCard() {
  if (!appState.dashboardCardsFocus) return;
  appState.dashboardSelectedCard = Math.max(0, appState.dashboardSelectedCard - 1);
  render();
}
export function rightCard() {
  if (!appState.dashboardCardsFocus) return;
  appState.dashboardSelectedCard = Math.min(4, appState.dashboardSelectedCard + 1);
  render();
}

// ── Collapsible sections ──
const DASHBOARD_SECTIONS = ['profile', 'stars', 'topRepos', 'contributions', 'languages', 'recentActivity', 'issues', 'prs', 'stale', 'trending'];

export function getSections() {
  return DASHBOARD_SECTIONS.map(s => 'dashboard:' + s);
}

export function getCurrentSection() {
  return 'dashboard:profile';
}
