// Dashboard tab — the home screen.
// v0.5+ design: cleaner section cards, focus-aware stat cards, breadcrumb-aware.

import { appState, render, startAsync, isStale, showMessage, setTab, confirm, setWidgetLoading } from '../state.mjs';
import { STALE_DAYS } from '../repos-logic.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import {
  getUserEvents, getTrendingRepos, getStarredRepos,
  getUserIssues, getUserPullRequests, searchRepositories,
  getUserFollowers,
} from '../github.mjs';
import { relTime, eventGlyph, greeting, shortNum, truncate, openUrl } from '../utils.mjs';
import { color } from '../theme.mjs';
import { emptyState, collapsibleHeader, loadingIndicator, getScreen, errorState, getBreakpoint, getStatCardLayout } from '../render.mjs';
import { loadRepoDetails } from './analyze.mjs';
import { showError } from '../error-recovery.mjs';

export async function loadDashboardWidgets(force = false) {
  if (!appState.token || !appState.user) return;
  if (appState.dashboardLoaded && !force) return;
  const gen = startAsync('dashboard-widgets');
  const username = appState.user.login;

  // Mark individual widgets as loading.
  setWidgetLoading('events', true);
  setWidgetLoading('trending', true);
  setWidgetLoading('starred', true);
  setWidgetLoading('issues', true);
  setWidgetLoading('prs', true);
  setWidgetLoading('followers', true);
  render();

  try {
    const days = appState.trendingPeriod || 7;
    const results = await Promise.allSettled([
      getUserEvents(appState.token, username, 100, gen.signal),
      getTrendingRepos(appState.token, days, 100, gen.signal),
      getStarredRepos(appState.token, 1, 100, gen.signal),
      getUserIssues(appState.token, 1, 10, gen.signal),
      getUserPullRequests(appState.token, 1, 10, gen.signal),
      getUserFollowers(appState.token, 1, 10, gen.signal),
    ]);
    const extract = (r) => r.status === 'fulfilled' ? r.value : null;
    const [events, trending, starred, issues, prs, followers] = results.map(extract);
    // Surface silent per-widget failures. Previously the code mapped every
    // rejection to null, leaving the user with no signal that a widget
    // vanished because the API failed. Count failures and remember the
    // timestamp so the greeting row can render an "N widgets failed" banner
    // and a freshness badge.
    const widgetLabels = ['events', 'trending', 'starred', 'issues', 'prs', 'followers'];
    let failCount = 0;
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        failCount++;
        // DEBUG is module-private to app.mjs; check env vars inline so we
        // don't have to plumb a new export through state.mjs. Avoids
        // uncontrolled stderr writes that would tear the TUI.
        if (process.env.DEBUG || process.env.GITHUB_TUI_DEBUG) {
          console.error('[dashboard] widget "' + widgetLabels[i] + '" failed:',
            results[i].reason && (results[i].reason.message || String(results[i].reason)));
        }
      }
    }
    appState.dashboardWidgetErrorCount = failCount;
    if (failCount === 0) appState.dashboardLastFetched = Date.now();
    if (isStale(gen, 'dashboard-widgets')) {
      setWidgetLoading('events', false);
      setWidgetLoading('trending', false);
      setWidgetLoading('starred', false);
      setWidgetLoading('issues', false);
      setWidgetLoading('prs', false);
      setWidgetLoading('followers', false);
      appState.loading = false;
      return;
    }
    appState.events = Array.isArray(events) ? events : [];
    setWidgetLoading('events', false);
    appState.trending = Array.isArray(trending) ? trending : [];
    appState.trendingPage = 1;
    appState.trendingScroll = 0;
    appState.trendingSelected = 0;
    appState.trendingHasMore = appState.trending.length >= 100;
    setWidgetLoading('trending', false);
    appState.starred = Array.isArray(starred) ? starred.map(s => ({
      ...(s.repo || s),
      starred_at: s.starred_at,
    })) : [];
    setWidgetLoading('starred', false);
    appState.dashboardRecentIssues = Array.isArray(issues) ? issues : [];
    setWidgetLoading('issues', false);
    appState.dashboardRecentPRs = Array.isArray(prs) ? (prs.items || prs) : [];
    setWidgetLoading('prs', false);
    appState.userFollowers = Array.isArray(followers) ? followers : [];
    setWidgetLoading('followers', false);
    appState.dashboardContributions = buildHeatmap(appState.events);
    const staleResult = findStaleRepos(appState.repos);
    appState.dashboardStaleCount = staleResult.count;
    appState.dashboardStaleRepos = staleResult.repos;
    appState.dashboardStarHistory = buildStarHistory(appState.starred);
    appState.dashboardLoaded = true;

    // Load custom user-defined sections (non-blocking — don't fail the dashboard).
    // Errors are NO LONGER silently swallowed: when DEBUG is set we additionally
    // log the failure so a malformed user config isn't invisible. Inline
    // process.env check avoids a circular import through app.mjs's DEBUG.
    if (!appState.customSectionsLoaded || force) {
      try {
        const { loadCustomSections } = await import('../custom-sections.mjs');
        appState.customSections = await loadCustomSections(appState.token);
        appState.customSectionsLoaded = true;
      } catch (e) {
        if (process.env.DEBUG || process.env.GITHUB_TUI_DEBUG) {
          console.error('[dashboard] custom sections failed to load:',
            (e && e.message) || String(e));
        }
      }
    }

    render();
  } catch (e) {
    if (!isStale(gen, 'dashboard-widgets')) showError(e.message, 'Dashboard widgets', { retry: () => loadDashboardWidgets(true) });
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
  // Use the same STALE_DAYS constant as the Repos tab so the two views agree.
  const cutoff = Date.now() - STALE_DAYS * 86400000;
  const stale = repos.filter(r => {
    const lastPush = new Date(r.pushed_at || r.updated_at).getTime();
    return lastPush < cutoff;
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
  const chars = [' ', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
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

// when --accessible is on, swap the sparkline unicode
// gradient for bracketed text so screen readers receive a linear
// density signal instead of opaque glyphs.
function sparkCharsAccessible(level) {
  return [' ', '.', ':', 'o', 'O', '#', '#', '@'][Math.max(0, Math.min(7, level))];
}

// Section header: title + optional key hint on the right.
// When `section` is supplied, route to collapsibleHeader (which handles
// collapse/expand) — that's a different signature from utils.sectionHeader,
// so we keep the local wrapper to compose both behaviours.
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

  // Self-heal stale keyboard selections on every render: if a fetch
  // (or auto-refresh tick) shrinks a list, the previously-selected index
  // might point past the end of the new dataset, leaving an invisible
  // highlighted row. dashboardUp / dashboardDown also clamp on input, but
  // those only fire when the user presses a key. clampList() here covers
  // silent data swaps (auto-refresh returning fewer events, openDashboardItem
  // being called from a stale focus, etc.).
  function clampList(arr, selKey, scrollKey) {
    if (!Array.isArray(arr)) return;
    if (arr.length === 0) {
      appState[selKey] = 0;
      appState[scrollKey] = 0;
      return;
    }
    if (appState[selKey] >= arr.length) appState[selKey] = arr.length - 1;
    if (appState[scrollKey] >= arr.length) appState[scrollKey] = arr.length - 1;
  }
  clampList(appState.events,                'dashboardActivitySelected', 'dashboardActivityScroll');
  clampList(appState.trending,              'trendingSelected',         'trendingScroll');
  clampList(appState.dashboardRecentIssues, 'dashboardIssueSelected',   'dashboardIssueScroll');
  clampList(appState.dashboardRecentPRs,    'dashboardPRSelected',      'dashboardPRScroll');

  if (!user) {
    emptyState(screen, y, h, {
      icon: '! NOT SIGNED IN',
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

  // Local repo context badge.
  if (appState.localRepo && appState.localRepoFilter) {
    const ctxBadge = '/' + appState.localRepo.owner + '/' + appState.localRepo.repo;
    screen.writeStr(2 + heading.length + 2, y, ctxBadge, { fg: 'cyan', dim: true });
  }

  const unread = appState.notifications.filter(n => n.unread).length;
  if (unread > 0) {
    const badge = '• ' + unread + ' unread';
    screen.writeStr(Math.max(2, W - badge.length - 4), y, badge, { fg: 'yellow', bold: true });
  }
  screen.hline(y + 1, '─', { dim: true });

  // Banner row at y+2 (cards start at y+3, no layout shift). Left side
  // surfaces the count of widgets that failed on the most recent
  // loadDashboardWidgets() so silent Promise.allSettled rejections become
  // visible. Right side surfaces a freshness stamp so users can tell
  // whether the dashboard is 30s or 30m stale. Both can coexist on the
  // same row without colliding (error badge starts at x=2, age badge
  // right-aligned).
  if (appState.dashboardWidgetErrorCount > 0) {
    const errBadge = '⚠ ' + appState.dashboardWidgetErrorCount +
      ' widget' + (appState.dashboardWidgetErrorCount === 1 ? '' : 's') + ' failed';
    screen.writeStr(2, y + 2, errBadge, { fg: 'red', bold: true });
  }
  if (appState.dashboardLastFetched) {
    const ageMs = Math.max(0, Date.now() - appState.dashboardLastFetched);
    const ageLabel =
      ageMs < 60_000 ? 'just now' :
      ageMs < 3_600_000 ? Math.floor(ageMs / 60_000) + 'm ago' :
      Math.floor(ageMs / 3_600_000) + 'h ago';
    const ageBadge = 'Updated ' + ageLabel;
    screen.writeStr(Math.max(2, W - ageBadge.length - 4), y + 2, ageBadge, { dim: true });
  }

  // ── Stat cards ──────────────────────────────────────────────
  const cardY = y + 3;
  const totalStars = appState.repos.reduce((a, r) => a + (r.stargazers_count || 0), 0);
  const totalForks = appState.repos.reduce((a, r) => a + (r.forks_count || 0), 0);
  const langSet = new Set(appState.repos.map(r => r.language).filter(Boolean));
  const accountAgeYears = user.created_at
    ? ((Date.now() - new Date(user.created_at).getTime()) / (365.25 * 86400 * 1000)).toFixed(1)
    : '?';

  // Responsive card layout based on terminal width
  const cardLayout = getStatCardLayout(W, 5);
  const cardW = cardLayout.cardWidth;
  const gap = cardLayout.gap;
  const cardH = 4;
  const margin = 2;
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

        // heatmap char gradients differ in --accessible mode.
        const heatChars = appState.accessible
          ? [' ', '.', 'o', 'O', '#']
          : [' ', '░', '▒', '▓', '█'];
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
        if (appState.accessible) {
          screen.writeStr(leftX, ly, 'Less . : : # More', { dim: true });
        } else {
          screen.writeStr(leftX, ly, 'Less ░▒▓█ More', { dim: true });
        }
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

  const activityFocused = appState.dashboardFocusZone === 'activity';
  // When the activity zone is focused, advertise a working key. The previous
  // "[Enter] open first" was misleading — pressing Enter used to fall through
  // to the trending zone and open trendingSelected, NOT the first event.
  const activityHint = activityFocused ? '[Enter] open repo' : null;
  const activityVisible = sectionHeader(screen, rightX, ry, 'RECENT ACTIVITY', activityHint, 'dashboard:recentActivity');
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
      // Honour keyboard scroll: viewport starts at dashboardActivityScroll.
      const activityStart = Math.min(appState.dashboardActivityScroll, appState.events.length);
      const activityEnd = Math.min(activityStart + maxEvents, appState.events.length);
      for (let i = activityStart; i < activityEnd; i++) {
        if (ry >= y + h - 1) break;
        const ev = appState.events[i];
        const sel = activityFocused && i === appState.dashboardActivitySelected;
        const [icon, c, label] = eventGlyph(ev.type);
        const repo = (ev.repo && ev.repo.name ? ev.repo.name : '?').substring(0, Math.max(10, rightW - 22));
        const when = relTime(ev.created_at);
        if (sel) {
          // Background highlight across the full right-column width so the
          // selection is unmistakable, mirroring how Issues/PRs are rendered
          // when selected.
          for (let x = rightX; x < rightX + rightW; x++) screen.styleBuf[ry][x] = { bg: 'blue', fg: 'white', bold: true };
        }
        screen.writeStr(rightX, ry, icon, sel ? { bg: 'blue', fg: 'white', bold: true } : c);
        screen.writeStr(rightX + 2, ry, label.substring(0, 11).padEnd(11), sel ? { bg: 'blue', fg: 'white', bold: true } : { dim: true });
        screen.writeStr(rightX + 14, ry, truncate(repo, rightW - 22), sel ? { bg: 'blue', fg: 'white' } : null);
        screen.writeStr(rightX + rightW - when.length, ry, when, sel ? { bg: 'blue', fg: 'white' } : { dim: true });
        ry++;
      }
    }
    ry++;
  }

  if (ry < y + h - 3 && appState.dashboardRecentIssues.length > 0) {
    const issueFocused = appState.dashboardFocusZone === 'issues';
    const issueHint = issueFocused ? '[Enter] open' : null;
    const issuesVisible = sectionHeader(screen, rightX, ry, 'RECENT ISSUES', issueHint, 'dashboard:issues');
    ry++;
    if (issuesVisible) {
      const maxIssues = Math.min(4, Math.max(1, Math.floor((y + h - bodyY) * 0.20)));
      const issueScroll = appState.dashboardIssueScroll;
      const issueEnd = Math.min(issueScroll + maxIssues, appState.dashboardRecentIssues.length);
      for (let ii = issueScroll; ii < issueEnd; ii++) {
        if (ry >= y + h - 1) break;
        const issue = appState.dashboardRecentIssues[ii];
        const sel = issueFocused && ii === appState.dashboardIssueSelected;
        if (sel) {
          for (let x = rightX; x < rightX + rightW; x++) screen.styleBuf[ry][x] = { bg: 'blue', fg: 'white', bold: true };
        }
        const num = '#' + (issue.number || '?');
        const titleMax = rightW - 14;
        const title = truncate(issue.title || '?', titleMax);
        const stateStyle = issue.state === 'open' ? { fg: 'green' } : { dim: true };
        screen.writeStr(rightX, ry, sel ? '▶ ' : '  ', sel ? { bg: 'blue', fg: 'white' } : null);
        screen.writeStr(rightX + 2, ry, num, sel ? { bg: 'blue', fg: 'yellow' } : { fg: 'yellow' });
        screen.writeStr(rightX + 8, ry, title, sel ? { bg: 'blue', fg: 'white', bold: true } : stateStyle);
        ry++;
      }
      ry++;
    }
  }

  if (ry < y + h - 3 && appState.dashboardRecentPRs.length > 0) {
    const prFocused = appState.dashboardFocusZone === 'prs';
    const prHint = prFocused ? '[Enter] open' : null;
    const prsVisible = sectionHeader(screen, rightX, ry, 'RECENT PRs', prHint, 'dashboard:prs');
    ry++;
    if (prsVisible) {
      const maxPRs = Math.min(4, Math.max(1, Math.floor((y + h - bodyY) * 0.20)));
      const prScroll = appState.dashboardPRScroll;
      const prEnd = Math.min(prScroll + maxPRs, appState.dashboardRecentPRs.length);
      for (let pi = prScroll; pi < prEnd; pi++) {
        if (ry >= y + h - 1) break;
        const pr = appState.dashboardRecentPRs[pi];
        const sel = prFocused && pi === appState.dashboardPRSelected;
        if (sel) {
          for (let x = rightX; x < rightX + rightW; x++) screen.styleBuf[ry][x] = { bg: 'blue', fg: 'white', bold: true };
        }
        const num = '#' + (pr.number || '?');
        const draft = pr.draft ? '[draft] ' : '';
        const titleMax = rightW - 14;
        const title = truncate(draft + (pr.title || '?'), titleMax);
        const stateStyle = pr.state === 'open' ? { fg: 'cyan' } : { dim: true };
        screen.writeStr(rightX, ry, sel ? '▶ ' : '  ', sel ? { bg: 'blue', fg: 'white' } : null);
        screen.writeStr(rightX + 2, ry, num, sel ? { bg: 'blue', fg: 'cyan' } : { fg: 'cyan' });
        screen.writeStr(rightX + 8, ry, title, sel ? { bg: 'blue', fg: 'white', bold: true } : stateStyle);
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

  // ── Custom user-defined sections ──
  if (appState.customSections && appState.customSections.length > 0) {
    for (let si = 0; si < appState.customSections.length; si++) {
      const sec = appState.customSections[si];
      if (ry >= y + h - 3 || sec.items.length === 0) continue;
      const secKey = 'dashboard:custom-' + si;
      const secVisible = sectionHeader(screen, rightX, ry, sec.title.toUpperCase(), null, secKey);
      ry++;
      if (secVisible) {
        const maxItems = Math.min(4, sec.items.length);
        for (let ii = 0; ii < maxItems; ii++) {
          if (ry >= y + h - 1) break;
          const item = sec.items[ii];
          const num = '#' + (item.number || '?');
          const titleMax = rightW - 14;
          const title = truncate(item.title || '?', titleMax);
          const isPR = item.pull_request != null;
          const numStyle = isPR ? { fg: 'cyan' } : { fg: 'yellow' };
          const titleStyle = item.state === 'open'
            ? (isPR ? { fg: 'cyan' } : { fg: 'green' })
            : { dim: true };
          screen.writeStr(rightX + 2, ry, num, numStyle);
          screen.writeStr(rightX + 8, ry, title, titleStyle);
          ry++;
        }
        ry++;
      }
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

// ── Trending fetch helpers — deduped from the three originally near-clone
// handlers (loadMoreTrending / pageUp / pageDown). Each public handler is
// now a 3-line wrapper that delegates to _setTrendingPage with the right
// (page, replace) tuple. Promise.resolve() in keys.mjs already wraps
// per-tab key dispatches, so the public wrappers are intentionally
// sync (fire-and-forget).
function _trendingQuery() {
  const days = appState.trendingPeriod || 7;
  const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  return 'created:>' + since;
}

async function _fetchTrendingPage(page) {
  const gen = startAsync('dashboard-trending');
  try {
    const list = await searchRepositories(
      appState.token, _trendingQuery(), page, 10, gen.signal
    );
    if (isStale(gen, 'dashboard-trending')) return { stale: true };
    return { stale: false, list };
  } catch (error) {
    if (isStale(gen, 'dashboard-trending')) return { stale: true };
    return { stale: false, error };
  }
}

// `replace=true` swaps the list (pageUp). `replace=false` appends
// (loadMoreTrending, pageDown). End-of-list responses clear the
// trendingHasMore flag so the next j/Space stops trying to fetch.
async function _setTrendingPage(page, replace) {
  if (!appState.token) return;
  appState.loading = true;
  render();
  const { stale, list, error } = await _fetchTrendingPage(page);
  if (stale) { appState.loading = false; render(); return; }
  if (error) {
    appState.trendingHasMore = false;
    showMessage('Failed to load trending page ' + page, 'error');
  } else if (Array.isArray(list) && list.length > 0) {
    if (replace) {
      appState.trending = list;
      appState.trendingSelected = 0;
      appState.trendingScroll = 0;
    } else {
      appState.trending = [...appState.trending, ...list];
    }
    appState.trendingPage = page;
    appState.trendingHasMore = list.length >= 10;
  } else {
    appState.trendingHasMore = false;
  }
  appState.loading = false;
  render();
}

export function loadMoreTrending() {
  if (!appState.trendingHasMore || !appState.token || appState.loading) return;
  _setTrendingPage(appState.trendingPage + 1, false);
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
  if (appState.trendingPage > 1 && !appState.loading) {
    _setTrendingPage(appState.trendingPage - 1, true);
  }
}

export function pageDown() {
  if (appState.trendingHasMore && !appState.loading) {
    _setTrendingPage(appState.trendingPage + 1, false);
  }
}

// Open the focused stat card. Maps each of the 5 cards to a sensible action:
//   STARS       (i=0) → Repos tab (whole list)
//   FORKS       (i=1) → Repos tab (whole list)
//   LANGUAGES   (i=2) → Repos tab with the language facet sidebar open
//   ACCOUNT AGE (i=3) → user's GitHub profile in the configured browser
//   STALE       (i=4) → Repos tab filtered to stale repos only
export function openFocusedCard() {
  if (!appState.dashboardCardsFocus) return;
  const i = appState.dashboardSelectedCard;
  if (i === 4) {
    // STALE → Repos with stale-only filter on
    setTab(1);
    appState.repoStaleOnly = true;
    appState.repoScroll = 0;
    appState.repoSelected = 0;
    appState.dashboardCardsFocus = false;
    showMessage('Showing stale repos', 'info');
    render();
  } else if (i === 0 || i === 1) {
    // STARS / FORKS → Repos tab (full list)
    setTab(1);
    appState.dashboardCardsFocus = false;
    render();
  } else if (i === 2) {
    // LANGUAGES → Repos with the language-facet sidebar visible. Setting
    // reposShowLangFacet=true causes repos.mjs to render the chips column
    // on the right; the user can then press L to filter by a chosen
    // language from there.
    setTab(1);
    appState.reposShowLangFacet = true;
    appState.repoScroll = 0;
    appState.repoSelected = 0;
    appState.dashboardCardsFocus = false;
    showMessage('Pick a language to filter repos', 'info');
    render();
  } else if (i === 3) {
    // ACCOUNT AGE → open the user's GitHub profile in browser. openUrl
    // returns { ok, error } so surface failures rather than silently
    // swallowing them. dashboard.mjs already imports openUrl from utils.
    if (appState.user && appState.user.html_url) {
      const url = appState.user.html_url;
      openUrl(url).then(res => {
        if (res && res.ok) showMessage('Opened profile in browser', 'success');
        else showMessage((res && res.error) || 'Browser open failed', 'error');
      });
    } else {
      showMessage('No profile URL available', 'warning');
    }
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
  const gen = startAsync('dashboard-trending');
  appState.loading = true;
  render();
  getTrendingRepos(appState.token, days, 100, gen.signal).then(more => {
    if (isStale(gen, 'dashboard-trending')) { appState.loading = false; return; }
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
  'l': () => {
    if (!appState.localRepo) {
      showMessage('No local git repo detected', 'warning');
      return;
    }
    appState.localRepoFilter = !appState.localRepoFilter;
    showMessage(appState.localRepoFilter
      ? 'Filtering to ' + appState.localRepo.owner + '/' + appState.localRepo.repo
      : 'Local repo filter cleared', 'info');
    render();
  },
};

// (Removed the unused `ZONES` array and dead `cycleDashboardZone()` export.
// Focus is driven entirely by `tui/focus.mjs`'s `_focusState.zoneIndex`
// and Tab/Shift+Tab through `focusNext/focusPrev`. There were zero
// callers of `cycleDashboardZone` anywhere in the codebase.)

export function dashboardUp() {
  const zone = appState.dashboardFocusZone;
  if (zone === 'trending') { trendingUp(); return; }
  if (zone === 'activity') {
    if (appState.events.length === 0) return;
    appState.dashboardActivitySelected = Math.max(0, appState.dashboardActivitySelected - 1);
    if (appState.dashboardActivitySelected < appState.dashboardActivityScroll) {
      appState.dashboardActivityScroll = appState.dashboardActivitySelected;
    }
    render();
    return;
  }
  if (zone === 'issues') {
    if (appState.dashboardRecentIssues.length === 0) return;
    appState.dashboardIssueSelected = Math.max(0, appState.dashboardIssueSelected - 1);
    if (appState.dashboardIssueSelected < appState.dashboardIssueScroll) {
      appState.dashboardIssueScroll = appState.dashboardIssueSelected;
    }
    render();
    return;
  }
  if (zone === 'prs') {
    if (appState.dashboardRecentPRs.length === 0) return;
    appState.dashboardPRSelected = Math.max(0, appState.dashboardPRSelected - 1);
    if (appState.dashboardPRSelected < appState.dashboardPRScroll) {
      appState.dashboardPRScroll = appState.dashboardPRSelected;
    }
    render();
    return;
  }
}

export function dashboardDown() {
  const zone = appState.dashboardFocusZone;
  if (zone === 'trending') { trendingDown(); return; }
  if (zone === 'activity') {
    if (appState.events.length === 0) return;
    const screen = getScreen();
    const H = screen ? screen.height : 24;
    const maxVisible = Math.min(7, Math.max(1, Math.floor((H - 17) * 0.30)));
    appState.dashboardActivitySelected = Math.min(
      appState.events.length - 1,
      appState.dashboardActivitySelected + 1
    );
    if (appState.dashboardActivitySelected >= appState.dashboardActivityScroll + maxVisible) {
      appState.dashboardActivityScroll++;
    }
    render();
    return;
  }
  if (zone === 'issues') {
    if (appState.dashboardRecentIssues.length === 0) return;
    appState.dashboardIssueSelected = Math.min(
      appState.dashboardRecentIssues.length - 1,
      appState.dashboardIssueSelected + 1
    );
    const screen = getScreen();
    const H = screen ? screen.height : 24;
    const maxVisible = Math.min(4, Math.max(1, Math.floor((H - 17) * 0.20)));
    if (appState.dashboardIssueSelected >= appState.dashboardIssueScroll + maxVisible) {
      appState.dashboardIssueScroll++;
    }
    render();
    return;
  }
  if (zone === 'prs') {
    if (appState.dashboardRecentPRs.length === 0) return;
    appState.dashboardPRSelected = Math.min(
      appState.dashboardRecentPRs.length - 1,
      appState.dashboardPRSelected + 1
    );
    const screen = getScreen();
    const H = screen ? screen.height : 24;
    const maxVisible = Math.min(4, Math.max(1, Math.floor((H - 17) * 0.20)));
    if (appState.dashboardPRSelected >= appState.dashboardPRScroll + maxVisible) {
      appState.dashboardPRScroll++;
    }
    render();
    return;
  }
}

export function openDashboardItem() {
  const zone = appState.dashboardFocusZone;
  if (zone === 'trending') { openTrendingRepo(); return; }
  if (zone === 'activity') {
    const ev = appState.events[appState.dashboardActivitySelected];
    if (!ev) return;
    // GitHub events have no single stable browser URL across all event
    // types; the most useful drill-in is the affected repo. We switch to
    // Explore (tab 2) and let loadRepoDetails paint it. Events without a
    // repo.name (rare, e.g. user-level events) surface a warning instead.
    if (ev.repo && ev.repo.name) {
      const parts = ev.repo.name.split('/');
      const owner = parts[0];
      const repo = parts[1];
      if (owner && repo) {
        setTab(2);
        loadRepoDetails(owner, repo);
      } else {
        showMessage('No repository for this event', 'warning');
      }
    } else {
      showMessage('No repository for this event', 'warning');
    }
    return;
  }
  if (zone === 'issues') {
    const issue = appState.dashboardRecentIssues[appState.dashboardIssueSelected];
    if (!issue) return;
    // Extract owner/repo from issue.repository_url or html_url
    let owner, repo;
    if (issue.repository_url) {
      const parts = issue.repository_url.split('/');
      owner = parts[parts.length - 2];
      repo = parts[parts.length - 1];
    } else if (issue.html_url) {
      const match = issue.html_url.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (match) { owner = match[1]; repo = match[2]; }
    }
    if (owner && repo) {
      import('./detail.mjs').then(m => m.openDetail('issue', owner, repo, issue.number));
    }
    return;
  }
  if (zone === 'prs') {
    const pr = appState.dashboardRecentPRs[appState.dashboardPRSelected];
    if (!pr) return;
    let owner, repo;
    if (pr.repository_url) {
      const parts = pr.repository_url.split('/');
      owner = parts[parts.length - 2];
      repo = parts[parts.length - 1];
    } else if (pr.html_url) {
      const match = pr.html_url.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (match) { owner = match[1]; repo = match[2]; }
    }
    if (owner && repo) {
      import('./detail.mjs').then(m => m.openDetail('pull_request', owner, repo, pr.number));
    }
    return;
  }
}

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
  const zone = appState.dashboardFocusZone;
  if (zone === 'trending') return 'dashboard:trending';
  if (zone === 'activity') return 'dashboard:recentActivity';
  if (zone === 'issues') return 'dashboard:issues';
  if (zone === 'prs') return 'dashboard:prs';
  return 'dashboard:profile';
}
