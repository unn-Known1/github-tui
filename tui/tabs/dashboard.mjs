// Dashboard tab — the home screen.
// v0.5+ design: cleaner section cards, focus-aware stat cards, breadcrumb-aware.

import { appState, render, startAsync, isStale, showMessage, setTab, confirm, setWidgetLoading, isWidgetLoading, syncStarredEntities, getWidgetAge, beginLoading, finishLoading, shouldRefreshWidget, isDashboardHidden } from '../state.mjs';
import { STALE_DAYS } from '../repos-logic.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import {
  getUserEvents, getTrendingRepos, getStarredRepos,
  getUserIssues, getUserPullRequests, searchRepositories,
  getUserFollowers, getNotifications,
} from '../github.mjs';
import { relTime, eventGlyph, greeting, shortNum, truncate, openUrl, displayWidth } from '../utils.mjs';
import { color } from '../theme.mjs';
import { emptyState, collapsibleHeader, loadingIndicator, getScreen, getStatCardLayout, scrollIndicators } from '../render.mjs';
import { loadRepoDetails } from './analyze.mjs';
import { showError } from '../error-recovery.mjs';

// Refresh the complete Dashboard-owned snapshot. Repository metadata is
// loaded first because cards, stale counts, languages, and the heatmap all
// depend on it; widget requests then update the same snapshot boundary.
export async function refreshDashboard() {
  if (!appState.token) return;
  appState.dashboardLoaded = false;
  try {
    const repos = await import('./repos.mjs');
    await repos.loadUserData({ loadDashboard: false, awaitBackground: true });
    await loadDashboardWidgets(true);
  } catch (error) {
    showError(error.message || 'Dashboard refresh failed', 'Dashboard', { retry: () => refreshDashboard() });
  }
}

export async function loadDashboardWidgets(force = false) {
  if (!appState.token || !appState.user) return;
  // D13 TTL wiring: when the dashboard snapshot already exists and the
  // caller did not force, skip the refresh entirely while every widget is
  // still within its per-widget TTL budget (fixes auto-refresh spam).
  // Otherwise fall through and refetch everything — full per-widget skip
  // (reusing fresh values inside Promise.allSettled) is a future step.
  if (!force && appState.dashboardLoaded) {
    const widgets = ['events', 'trending', 'starred', 'issues', 'prs', 'followers', 'notifications'];
    if (widgets.every(w => !shouldRefreshWidget(w))) return;
  }
  const gen = startAsync('dashboard-widgets');
  beginLoading(gen);
  const username = appState.user.login;

  // Mark individual widgets as loading.
  setWidgetLoading('events', true, gen);
  setWidgetLoading('trending', true, gen);
  setWidgetLoading('starred', true, gen);
  setWidgetLoading('issues', true, gen);
  setWidgetLoading('prs', true, gen);
  setWidgetLoading('followers', true, gen);
  setWidgetLoading('notifications', true, gen);
  render();

  try {
    const days = appState.trendingPeriod || 7;
    const results = await Promise.allSettled([
      getUserEvents(appState.token, username, 100, gen.signal),
      getTrendingRepos(appState.token, days, 30, gen.signal),
      getStarredRepos(appState.token, 1, 100, gen.signal),
      getUserIssues(appState.token, 1, 10, gen.signal),
      getUserPullRequests(appState.token, 1, 10, gen.signal),
      getUserFollowers(appState.token, 1, 10, gen.signal),
      getNotifications(appState.token, 1, 50, gen.signal),
    ]);
    const extract = (r) => r.status === 'fulfilled' ? r.value : null;
    const [events, trending, starred, issues, prs, followers, notifications] = results.map(extract);
    // Surface silent per-widget failures. Previously the code mapped every
    // rejection to null, leaving the user with no signal that a widget
    // vanished because the API failed. Count failures and remember the
    // timestamp so the greeting row can render an "N widgets failed" banner
    // and a freshness badge.
    const widgetLabels = ['events', 'trending', 'starred', 'issues', 'prs', 'followers', 'notifications'];
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
    appState.dashboardLastFetched = Date.now();
    if (isStale(gen, 'dashboard-widgets')) {
      setWidgetLoading('events', false, gen);
      setWidgetLoading('trending', false, gen);
      setWidgetLoading('starred', false, gen);
      setWidgetLoading('issues', false, gen);
      setWidgetLoading('prs', false, gen);
      setWidgetLoading('followers', false, gen);
      setWidgetLoading('notifications', false, gen);
      finishLoading(gen);
      return;
    }
    // Preserve the last known good value when one widget fails. A transient
    // network error must not turn a populated widget into a false empty state.
    if (results[0].status === 'fulfilled') {
      appState.events = Array.isArray(events) ? events : [];
      setWidgetLoading('events', false, gen);
    } else {
      appState.dashboardLoadingWidgets['events'] = false;
      appState.dashboardLoadingOwners['events'] = null;
    }
    if (results[1].status === 'fulfilled') {
      appState.trending = Array.isArray(trending) ? trending : [];
      appState.trendingPage = 1;
      appState.trendingScroll = 0;
      appState.trendingSelected = 0;
      appState.trendingHasMore = appState.trending.length >= 30;
      setWidgetLoading('trending', false, gen);
    } else {
      appState.dashboardLoadingWidgets['trending'] = false;
      appState.dashboardLoadingOwners['trending'] = null;
    }
    if (results[2].status === 'fulfilled') {
      appState.starred = Array.isArray(starred) ? starred.map(s => ({
        ...(s.repo || s),
        starred_at: s.starred_at || s.repo?.starred_at || null,
      })) : [];
      syncStarredEntities(appState.starred);
      setWidgetLoading('starred', false, gen);
    } else {
      appState.dashboardLoadingWidgets['starred'] = false;
      appState.dashboardLoadingOwners['starred'] = null;
    }
    if (results[3].status === 'fulfilled') {
      // `/issues` includes PR-shaped records; keep only actual issues here.
      appState.dashboardRecentIssues = Array.isArray(issues)
        ? issues.filter(item => !item.pull_request)
        : [];
      setWidgetLoading('issues', false, gen);
    } else {
      appState.dashboardLoadingWidgets['issues'] = false;
      appState.dashboardLoadingOwners['issues'] = null;
    }
    if (results[4].status === 'fulfilled') {
      const prItems = Array.isArray(prs) ? prs : (prs && prs.items);
      appState.dashboardRecentPRs = Array.isArray(prItems) ? prItems : [];
      setWidgetLoading('prs', false, gen);
    } else {
      appState.dashboardLoadingWidgets['prs'] = false;
      appState.dashboardLoadingOwners['prs'] = null;
    }
    if (results[5].status === 'fulfilled') {
      appState.userFollowers = Array.isArray(followers) ? followers : [];
      setWidgetLoading('followers', false, gen);
    } else {
      appState.dashboardLoadingWidgets['followers'] = false;
      appState.dashboardLoadingOwners['followers'] = null;
    }
    if (results[6].status === 'fulfilled') {
      appState.notifications = Array.isArray(notifications) ? notifications : [];
      appState.inboxPage = 1;
      appState.inboxHasMore = appState.notifications.length >= 50;
      appState.inboxScroll = Math.min(appState.inboxScroll, Math.max(0, appState.notifications.length - 1));
      appState.selectedNotification = Math.min(appState.selectedNotification, Math.max(0, appState.notifications.length - 1));
      setWidgetLoading('notifications', false, gen);
    } else {
      appState.dashboardLoadingWidgets['notifications'] = false;
      appState.dashboardLoadingOwners['notifications'] = null;
    }
    recomputeDashboardDerived();
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

    if (results[2].status === 'fulfilled' && appState.starred.length >= 100) {
      loadDashboardStarredPages(gen).catch(() => {});
    }
    render();
  } catch (e) {
    if (!isStale(gen, 'dashboard-widgets')) showError(e.message, 'Dashboard widgets', { retry: () => loadDashboardWidgets(true) });
  }
  finishLoading(gen);
}

async function loadDashboardStarredPages(gen) {
  const loadingHandle = { ...gen, scope: 'dashboard-starred-pages' };
  beginLoading(loadingHandle);
  setWidgetLoading('starred', true, gen);
  let page = 2;
  try {
    while (appState.starred.length >= (page - 1) * 100 && !isStale(gen, 'dashboard-widgets')) {
      const more = await getStarredRepos(appState.token, page, 100, gen.signal);
      if (isStale(gen, 'dashboard-widgets') || !Array.isArray(more) || more.length === 0) break;
      const mapped = more.map(s => ({ ...(s.repo || s), starred_at: s.starred_at || s.repo?.starred_at || null }));
      appState.starred = [...appState.starred, ...mapped];
      syncStarredEntities(mapped);
      recomputeDashboardDerived();
      page++;
      // Cap background starred pagination at ~600 repos (pages 1-6) so
      // very large star collections cannot page forever in the background.
      if (page > 6) break;
      if (more.length < 100) break;
    }
  } catch (error) {
    if (!isStale(gen, 'dashboard-widgets')) showError(error.message || 'Failed to load starred repositories', 'Dashboard stars');
  } finally {
    setWidgetLoading('starred', false, gen);
    finishLoading(loadingHandle);
    if (!isStale(gen, 'dashboard-widgets')) render();
  }
}

// ─── Heatmap builder ──────────────────────────────────────────────────
// UTC-normalised so the grid agrees with buildStarHistory (which already
// uses UTC midnight) regardless of the viewer's local timezone. Returns
// totals + streak metadata so the header can be honest about what the
// REST public-events feed actually contains (max ~100 events, no private
// contributions — GraphQL contributionCalendar would be needed for those).
export const CONTRIB_WEEKS = 15;
export const CONTRIB_DAYS = CONTRIB_WEEKS * 7; // 105
export function contribDayKey(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}
export function buildHeatmap(events, repos = appState.repos) {
  const dayMs = 86400000;
  const weeks = CONTRIB_WEEKS;
  const grid = Array.from({ length: 7 }, () => new Array(weeks).fill(0));

  // UTC midnight today + its weekday (0=Sun) keep row 0 aligned with the
  // Sunday label for every timezone.
  const now = new Date();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const todayDay = new Date(todayMs).getUTCDay();
  // Start on Sunday of the first displayed week and include the current
  // partial week. This keeps row 0 aligned with the Sunday label.
  const gridStartMs = todayMs - ((weeks - 1) * 7 + todayDay) * dayMs;

  function dayIndexForMs(ms) {
    const diffDays = Math.floor((ms - gridStartMs) / dayMs);
    if (diffDays < 0 || diffDays >= weeks * 7) return -1;
    return diffDays;
  }

  function addDay(isoDate) {
    if (!isoDate) return;
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return;
    const ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const diffDays = Math.floor((ms - gridStartMs) / dayMs);
    if (diffDays < 0 || diffDays >= weeks * 7) return;
    const col = Math.floor(diffDays / 7);
    const row = diffDays % 7;
    if (row >= 0 && row < 7 && col >= 0 && col < weeks) {
      grid[row][col]++;
    }
  }

  // Push/Issue/PR/Review/Release are the core contribution signals.
  // Create + Fork are also contributions on github.com (new branches/tags,
  // forked repos) so they count here. Watch (stars) is intentionally
  // excluded — outgoing stars already have their own sparkline widget.
  const activityTypes = new Set([
    'PushEvent', 'IssuesEvent', 'PullRequestEvent',
    'PullRequestReviewEvent', 'ReleaseEvent',
    'CreateEvent', 'ForkEvent',
  ]);
  let commitCount = 0;
  for (const ev of (events || [])) {
    if (!ev || !activityTypes.has(ev.type) || !ev.created_at) continue;
    addDay(ev.created_at);
    if (ev.type === 'PushEvent' && ev.payload) {
      commitCount += (ev.payload.size || ev.payload.distinct_size) || 0;
    }
  }

  let max = 0;
  let total = 0;
  const perDay = new Array(weeks * 7).fill(0);
  // Flatten in day-index order (col-major: idx = col*7 + rowOffset where
  // rowOffset aligns with gridStart Sunday). Recompute directly so streak
  // math can't drift from the render path.
  for (let idx = 0; idx < weeks * 7; idx++) {
    const col = Math.floor(idx / 7);
    const row = idx % 7;
    perDay[idx] = grid[row] ? (grid[row][col] || 0) : 0;
  }
  for (const v of perDay) {
    if (v > max) max = v;
    total += v;
  }
  let best = 0;
  for (const v of perDay) if (v > best) best = v;
  // Current streak: consecutive active days ending today (or yesterday when
  // today is still empty — mirrors github.com behaviour).
  let streak = 0;
  let end = weeks * 7 - 1;
  if (perDay[end] === 0 && weeks * 7 >= 2) end = weeks * 7 - 2;
  for (let i = end; i >= 0; i--) {
    if (perDay[i] > 0) streak++;
    else break;
  }
  // Month label per week column (UTC short name when the month flips).
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabels = new Array(weeks).fill('');
  let prevMonth = -1;
  for (let col = 0; col < weeks; col++) {
    const ms = gridStartMs + col * 7 * dayMs;
    const m = new Date(ms).getUTCMonth();
    if (m !== prevMonth) {
      monthLabels[col] = monthNames[m];
      prevMonth = m;
    }
  }
  return { weeks, grid, max, total, commitCount, streak, best, perDay, gridStartMs, todayMs, monthLabels };
}

function localRepoName() {
  if (!appState.localRepo || !appState.localRepoFilter) return null;
  return appState.localRepo.owner + '/' + appState.localRepo.repo;
}

function itemRepoName(item) {
  if (!item) return '';
  if (item.repo && item.repo.name) return item.repo.name;
  if (item.full_name) return item.full_name;
  if (item.repository && item.repository.full_name) return item.repository.full_name;
  if (item.repository_url) return item.repository_url.split('/').slice(-2).join('/');
  if (item.html_url) {
    const match = item.html_url.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (match) return match[1] + '/' + match[2];
  }
  return '';
}

function matchesLocalRepo(item) {
  const local = localRepoName();
  return !local || itemRepoName(item) === local;
}

export function getDashboardRepos() {
  const local = localRepoName();
  return local ? (appState.repos || []).filter(r => r.full_name === local) : (appState.repos || []);
}

export function getDashboardEvents() {
  return (appState.events || []).filter(matchesLocalRepo);
}

export function getDashboardIssues() {
  return (appState.dashboardRecentIssues || []).filter(matchesLocalRepo);
}

export function getDashboardPRs() {
  return (appState.dashboardRecentPRs || []).filter(matchesLocalRepo);
}

export function getDashboardStarred() {
  return (appState.starred || []).filter(matchesLocalRepo);
}

// ─── Contributions day selection + activity-feed filter ──────────────
// The heatmap is a 15×7 UTC grid starting on a Sunday. `dashboardContribSelected`
// is a day index 0..104 (defaults to TODAY, which is (weeks-1)*7 + weekday,
// not 104 — the trailing cells after today are future days in the current
// partial week). `dashboardContribDayFilter` is a 'YYYY-MM-DD' UTC key (or
// null) that scopes the right-column activity feed to a single heatmap day.
export function getTodayContribIndex() {
  const now = new Date();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const todayDay = new Date(todayMs).getUTCDay();
  return (CONTRIB_WEEKS - 1) * 7 + todayDay;
}
export function clampContribSelected() {
  const maxIdx = CONTRIB_DAYS - 1;
  if (!Number.isFinite(appState.dashboardContribSelected)) appState.dashboardContribSelected = getTodayContribIndex();
  appState.dashboardContribSelected = Math.max(0, Math.min(maxIdx, appState.dashboardContribSelected | 0));
  return appState.dashboardContribSelected;
}
export function getContribSelectedDayKey() {
  const hm = appState.dashboardContributions;
  if (!hm || !Number.isFinite(hm.gridStartMs)) return null;
  const idx = clampContribSelected();
  return contribDayKey(hm.gridStartMs + idx * 86400000);
}
export function getContribSelectedDayCount() {
  const hm = appState.dashboardContributions;
  if (!hm || !Array.isArray(hm.perDay)) return 0;
  const idx = clampContribSelected();
  return hm.perDay[idx] || 0;
}
function eventDayKey(ev) {
  if (!ev || !ev.created_at) return null;
  const d = new Date(ev.created_at);
  if (Number.isNaN(d.getTime())) return null;
  return contribDayKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
export function getActivityDayFilter() {
  return appState.dashboardContribDayFilter || null;
}
// Activity feed rows honour the heatmap day filter when one is set.
// The heatmap itself always uses the unfiltered event list.
export function getFilteredActivityEvents() {
  const events = getDashboardEvents();
  const day = getActivityDayFilter();
  if (!day) return events;
  return events.filter(ev => eventDayKey(ev) === day);
}
export function toggleContribDayFilter() {
  const key = getContribSelectedDayKey();
  if (!key) return null;
  if (appState.dashboardContribDayFilter === key) {
    appState.dashboardContribDayFilter = null;
    showMessage('Day filter cleared', 'info');
  } else {
    appState.dashboardContribDayFilter = key;
    appState.dashboardActivityScroll = 0;
    appState.dashboardActivitySelected = 0;
    const n = getFilteredActivityEvents().length;
    showMessage(n > 0 ? 'Filtering activity to ' + key + ' (' + n + ')' : 'No activity on ' + key, n > 0 ? 'info' : 'warning');
  }
  render();
  return appState.dashboardContribDayFilter;
}
export function clearContribDayFilter(silent = false) {
  if (!appState.dashboardContribDayFilter) return;
  appState.dashboardContribDayFilter = null;
  appState.dashboardActivityScroll = 0;
  appState.dashboardActivitySelected = 0;
  if (!silent) showMessage('Day filter cleared', 'info');
  render();
}
export function moveContribSelection(dDays) {
  const maxIdx = CONTRIB_DAYS - 1;
  clampContribSelected();
  appState.dashboardContribSelected = Math.max(0, Math.min(maxIdx, appState.dashboardContribSelected + dDays));
  render();
}

// Top-5 repos by stars, same ordering as the TOP REPOS section render.
// Prefers the memoized D14 cache, falling back to a live sort when the
// cache is empty (e.g. recompute hasn't run yet).
function getTopReposSorted() {
  if (Array.isArray(appState.dashboardTopRepos) && appState.dashboardTopRepos.length > 0) {
    return appState.dashboardTopRepos;
  }
  return [...getDashboardRepos()]
    .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
    .slice(0, 5);
}

export function getNeedsAttention(repos = getDashboardRepos(), staleCount = null) {
  const items = [];
  const notes = Array.isArray(appState.notifications) ? appState.notifications : [];
  const mentions = notes.filter(n => n.unread && n.reason === 'mention' && matchesLocalRepo(n)).length;
  const reviews = notes.filter(n => n.unread && n.reason === 'review_requested' && matchesLocalRepo(n)).length;
  const unread = notes.filter(n => n.unread && matchesLocalRepo(n)).length;
  const local = localRepoName();
  const failureSource = (appState.actionsFailures && appState.actionsFailures.length > 0) ? appState.actionsFailures : (appState.actionsRuns || []);
  const failedRuns = failureSource.filter(run =>
    (!local || matchesLocalRepo(run) || run.repo === local) &&
    (run.conclusion === 'failure' || run.status === 'failure')
  ).length;
  const stale = staleCount == null ? findStaleRepos(repos).count : staleCount;

  if (reviews > 0) items.push({ id: 'reviews', label: 'Review requests', count: reviews, kind: 'inbox', filter: 'review' });
  if (mentions > 0) items.push({ id: 'mentions', label: 'Unread mentions', count: mentions, kind: 'inbox', filter: 'mentions' });
  if (failedRuns > 0) items.push({ id: 'ci', label: 'Failed workflow runs', count: failedRuns, kind: 'actions' });
  if (stale > 0) items.push({ id: 'stale', label: 'Stale repositories', count: stale, kind: 'stale' });
  if (items.length === 0 && unread > 0) items.push({ id: 'unread', label: 'Unread notifications', count: unread, kind: 'inbox', filter: 'unread' });
  return items.slice(0, 4);
}

export function recomputeDashboardDerived() {
  const repos = getDashboardRepos();
  const staleResult = findStaleRepos(repos);
  appState.dashboardContributions = buildHeatmap(getDashboardEvents(), repos);
  clampContribSelected();
  // Drop a day filter that no longer matches any visible event (e.g. after
  // a local-repo scope change) so the activity feed can't get stuck empty.
  if (appState.dashboardContribDayFilter) {
    const stillMatches = getDashboardEvents().some(ev => eventDayKey(ev) === appState.dashboardContribDayFilter);
    if (!stillMatches) {
      // Keep the filter key only when the heatmap day itself still has
      // activity — otherwise the user filtered to a day with zero rows.
      const hm = appState.dashboardContributions;
      const idx = hm && Number.isFinite(hm.gridStartMs)
        ? Math.floor((Date.parse(appState.dashboardContribDayFilter + 'T00:00:00Z') - hm.gridStartMs) / 86400000)
        : -1;
      const dayCount = hm && Array.isArray(hm.perDay) && idx >= 0 && idx < hm.perDay.length ? hm.perDay[idx] : 0;
      if (dayCount === 0) appState.dashboardContribDayFilter = null;
    }
  }
  appState.dashboardStaleCount = staleResult.count;
  appState.dashboardStaleRepos = staleResult.repos;
  appState.dashboardStarHistory = buildStarHistory(getDashboardStarred());
  appState.dashboardAttentionItems = getNeedsAttention(repos, staleResult.count);
  // D14 memo wiring: cache the derived top-repos / language / totals views
  // so renderDashboard() doesn't re-sort on every frame.
  appState.dashboardTopRepos = [...repos]
    .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
    .slice(0, 5);
  const langCount = {};
  for (const r of repos) {
    if (r.language) langCount[r.language] = (langCount[r.language] || 0) + 1;
  }
  appState.dashboardLangHistogram = Object.entries(langCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7);
  appState.dashboardTotals = {
    stars: repos.reduce((a, r) => a + (r.stargazers_count || 0), 0),
    forks: repos.reduce((a, r) => a + (r.forks_count || 0), 0),
    languages: Object.keys(langCount).length,
  };
  render();
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
  const chars = appState.accessible ? [' ', '.', ':', 'o', 'O', '#', '#', '@'] : [' ', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
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
    const widget = text.includes('TRENDING') ? 'trending' :
      (text.includes('STARS') || text.includes('STARRED')) ? 'starred' :
      text.includes('ACTIVITY') || text.includes('CONTRIBUTIONS') ? 'events' :
      text.includes('ISSUES') ? 'issues' :
      text.includes('PRs') ? 'prs' : null;
    const age = widget && appState.dashboardWidgetFetched[widget] ? ' · ' + getWidgetAge(widget) : '';
    return collapsibleHeader(screen, x, y, section, text + age, hint);
  }
  screen.writeStr(x, y, text, color('sectionHeading'));
  if (hint) {
    const hx = screen.width - hint.length - 2;
    if (hx > x + text.length + 4) screen.writeStr(hx, y, hint, { dim: true });
  }
  return true;
}

function ensureDashboardCollapseDefaults() {
  const defaults = ['stars', 'topRepos', 'contributions', 'languages', 'issues', 'prs', 'stale', 'trending'];
  for (const section of defaults) {
    const key = 'dashboard:' + section;
    if (!(key in appState.collapsed)) appState.collapsed[key] = false;
  }
  for (let i = 0; i < (appState.customSections || []).length; i++) {
    const key = 'dashboard:custom-' + i;
    if (!(key in appState.collapsed)) appState.collapsed[key] = false;
  }
}

function renderFocusDashboard(screen, y, h) {
  const W = screen.width;
  const mode = appState.focusMode || 'attention';
  screen.writeStr(2, y, 'FOCUS MODE: ' + mode.toUpperCase(), color('title'));
  screen.hline(y + 1, '─', { dim: true });
  const items = mode === 'ci' ? (appState.actionsFailures || []).map(r => ({ label: 'CI ' + (r.repo || '') + ' #' + (r.run_number || r.id), kind: 'failure' }))
    : mode === 'work' ? (appState.myWorkQueue || []).map(item => ({ label: item.kind.toUpperCase() + ' ' + (item.repo || '?') + ' — ' + item.title, kind: item.kind }))
    : mode === 'inbox' ? (appState.notifications || []).filter(n => n.unread).map(n => ({ label: (n.repository?.full_name || '?') + ' — ' + (n.subject?.title || ''), kind: 'notification' }))
    : mode === 'review' ? (appState.dashboardRecentPRs || []).map(pr => ({ label: (pr.base?.repo?.full_name || '?') + ' — ' + (pr.title || ''), kind: 'review' }))
    : (appState.dashboardAttentionItems || []).map(item => ({ label: item.label + ' (' + item.count + ')', kind: item.kind }));
  if (items.length === 0) {
    screen.writeStr(2, y + 3, 'Nothing needs attention in this focus view.', { fg: 'green' });
  } else {
    const rows = Math.max(1, h - 5);
    appState.dashboardAttentionSelected = Math.min(appState.dashboardAttentionSelected, items.length - 1);
    for (let i = 0; i < rows && i < items.length; i++) {
      const selected = i === appState.dashboardAttentionSelected;
      if (selected) for (let x = 0; x < W; x++) screen.styleBuf[y + 2 + i][x] = color('selection');
      screen.writeStr(2, y + 2 + i, selected ? '▶ ' : '  ', selected ? color('selection') : color('dim'));
      screen.writeStr(5, y + 2 + i, truncate(items[i].label, W - 7), selected ? color('selection') : null);
    }
  }
  screen.writeStr(2, y + h - 1, '[Ctrl-F] exit focus   [↑↓] navigate   [Enter] open source', { dim: true });
}

export function renderDashboard(screen, y, h) {
  if (appState.focusMode) { renderFocusDashboard(screen, y, h); return; }
  const W = screen.width;
  const user = appState.user;
  ensureDashboardCollapseDefaults();

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
  const dashboardEvents = getDashboardEvents();
  const dashboardIssues = getDashboardIssues();
  const dashboardPRs = getDashboardPRs();
  const attentionItems = getNeedsAttention();
  appState.dashboardAttentionItems = attentionItems;
  clampContribSelected();
  clampList(attentionItems, 'dashboardAttentionSelected', 'dashboardAttentionScroll');
  clampList(getFilteredActivityEvents(), 'dashboardActivitySelected', 'dashboardActivityScroll');
  clampList(getFilteredTrending(), 'trendingSelected', 'trendingScroll');
  clampList(dashboardIssues, 'dashboardIssueSelected', 'dashboardIssueScroll');
  clampList(dashboardPRs, 'dashboardPRSelected', 'dashboardPRScroll');
  clampList(appState.dashboardStaleRepos, 'dashboardStaleSelected', 'dashboardStaleScroll');

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

  // Local repo context badge (D12a: '· repo: owner/repo' prefix, matching inbox).
  // Display names may hold CJK/emoji — anchor followers by cells, not units.
  const headingEnd = 2 + displayWidth(heading) + 2;
  if (appState.localRepo && appState.localRepoFilter) {
    const ctxBadge = '· repo: ' + appState.localRepo.owner + '/' + appState.localRepo.repo;
    screen.writeStr(headingEnd, y, ctxBadge, { fg: 'cyan', dim: true });
  } else if (appState.localRepo && !appState.localRepoFilter) {
    // D11 local hint: advertise the scope key when a local repo is detected
    // but the filter is off.
    const scopeHint = '[l] scope to ' + appState.localRepo.owner + '/' + appState.localRepo.repo;
    screen.writeStr(headingEnd, y, scopeHint, { dim: true });
  }

  const unread = appState.notifications.filter(n => n.unread).length;
  if (unread > 0 || appState.inboxHasMore || appState.reposHasMore) {
    const badge = (unread > 0 ? '• ' + unread + ' unread' : '') +
      (appState.inboxHasMore ? '  inbox partial' : '') +
      (appState.reposHasMore ? '  repos loading' : '');
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
  let bannerX = 2;
  if (appState.dashboardWidgetErrorCount > 0) {
    const errBadge = '⚠ ' + appState.dashboardWidgetErrorCount +
      ' widget' + (appState.dashboardWidgetErrorCount === 1 ? '' : 's') + ' failed';
    screen.writeStr(bannerX, y + 2, errBadge, { fg: 'red', bold: true });
    bannerX += errBadge.length + 2;
  }
  const loadingCount = Object.values(appState.dashboardLoadingWidgets || {}).filter(Boolean).length;
  if (loadingCount > 0) {
    const loadingBadge = '⟳ ' + loadingCount + ' loading';
    screen.writeStr(bannerX, y + 2, loadingBadge, { fg: 'cyan', dim: true });
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
  const dashboardRepos = getDashboardRepos();
  const totalStars = dashboardRepos.reduce((a, r) => a + (r.stargazers_count || 0), 0);
  const totalForks = dashboardRepos.reduce((a, r) => a + (r.forks_count || 0), 0);
  const langSet = new Set(dashboardRepos.map(r => r.language).filter(Boolean));
  const accountAgeYears = user.created_at
    ? ((Date.now() - new Date(user.created_at).getTime()) / (365.25 * 86400 * 1000)).toFixed(1)
    : '?';

  // Responsive card layout based on terminal width. Cards spread across the
  // full width on md+ (capped + centered on very wide terminals) and wrap to
  // a second row on xs/sm breakpoints.
  const cardLayout = getStatCardLayout(W, 5);
  const cardW = cardLayout.cardWidth;
  const gap = cardLayout.gap;
  const cardsPerRow = cardLayout.cardsPerRow;
  const cardH = 4;
  const cards = [
    { label: 'STARS',         value: shortNum(totalStars),                            style: { fg: 'yellow', bold: true } },
    { label: 'FORKS',         value: shortNum(totalForks),                            style: { fg: 'cyan', bold: true } },
    { label: 'LANGUAGES',     value: String(langSet.size),                            style: { fg: 'magenta', bold: true } },
    { label: 'ACCOUNT AGE',   value: accountAgeYears + 'y',                           style: { fg: 'green', bold: true } },
    { label: 'STALE',         value: String(appState.dashboardStaleCount),            style: appState.dashboardStaleCount > 0 ? { fg: 'yellow', bold: true } : { dim: true } },
  ];
  const cardRows = Math.ceil(cards.length / cardsPerRow);
  const cardsFocus = appState.dashboardCardsFocus;
  cards.forEach((c, i) => {
    const row = Math.floor(i / cardsPerRow);
    const col = i % cardsPerRow;
    const cx = cardLayout.startX + col * (cardW + gap);
    const cy = cardY + row * (cardH + 1);
    if (cy + cardH >= y + h) return;
    const focused = cardsFocus && i === appState.dashboardSelectedCard;
    const fillStyle = focused ? { bg: 'blue', fg: 'white' } : null;
    const borderStyle = focused ? { fg: 'cyan', bold: true } : { fg: 'gray', dim: true };
    screen.card(cx, cy, cardW, cardH, c.label, fillStyle, borderStyle);
    const valStr = c.value;
    const valX = cx + Math.floor((cardW - valStr.length) / 2);
    screen.writeStr(valX, cy + 2, valStr, focused ? { fg: 'white', bold: true } : c.style);
  });

  // ── Body: 2 columns ────────────────────────────────────────
  let bodyY = cardY + cardRows * (cardH + 1) + 1;
  // D17 quick-actions bar: a single dim hint line directly under the stat
  // cards. It is a hint bar, not buttons — the TUI is keyboard-driven.
  if (appState.dashboardQuickActions !== false) {
    if (bodyY < y + h) {
      const qaHint = '[r] Refresh   [t] Trend period   [/] Filter   [l] Local   [Tab] Widgets   [?] Help';
      screen.writeStr(2, bodyY, truncate(qaHint, Math.max(0, W - 4)), { dim: true });
    }
    bodyY++;
  }
  if (bodyY >= y + h) return;
  // Keep cards/header fixed while allowing the larger body to scroll inside
  // the content viewport. Screen handles clipping for body writes.
  const bodyViewportBottom = y + h;
  const bodyScroll = Math.max(0, Math.min(appState.dashboardScroll || 0, appState.dashboardMaxScroll || 0));
  screen.pushViewport(bodyY, bodyViewportBottom, bodyScroll);
  // D9 responsive stacking: below 80 cols the two columns would crush each
  // other, so collapse to a single stacked column (left then right).
  const isNarrow = W < 80;
  let splitX = Math.floor(W / 2);
  let leftX = 2;
  let rightX = splitX + 2;
  let leftW = splitX - leftX - 2;
  let rightW = W - rightX - 2;
  if (isNarrow) {
    splitX = W; // no divider; both columns span the full width
    leftX = 2;
    rightX = 2;
    leftW = W - 4;
    rightW = W - 4;
  }

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
      screen.writeStr(leftX, ly++, truncate(p.text, leftW), p.style);
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
        const login = truncate(f.login || '?', leftW - 2);
        screen.writeStr(leftX + 2, ly++, '@' + login, { fg: 'cyan' });
      }
    }
  }

  if (ly < y + h - 4 && appState.dashboardStarHistory.length > 0 && !isDashboardHidden('stars')) {
    const starsVisible = sectionHeader(screen, leftX, ly, 'STARRED · LAST 30 DAYS', null, 'dashboard:stars');
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
      screen.writeStr(leftX, ly, totalStarsRecent + ' repos you starred in 30 days', { dim: true });
      ly += 2;
    }
  }

  if (ly < y + h - 2 && !isDashboardHidden('topRepos')) {
    const topReposFocused = appState.dashboardFocusZone === 'topRepos';
    const topReposHint = topReposFocused ? '[Enter] open' : null;
    const topReposVisible = sectionHeader(screen, leftX, ly, 'TOP REPOS', topReposHint, 'dashboard:topRepos');
    ly++;
    if (topReposVisible) {
      // D14: prefer the memoized cache, falling back to a live sort.
      const top = getTopReposSorted();
      clampList(top, 'dashboardTopSelected', 'dashboardTopScroll');
      if (top.length === 0) {
        screen.writeStr(leftX, ly++, 'No repos — add repos to your GitHub account', { dim: true });
      } else {
        for (let ti = 0; ti < top.length; ti++) {
          if (ly >= y + h - 1) break;
          const r = top[ti];
          const selected = topReposFocused && ti === appState.dashboardTopSelected;
          if (selected) {
            for (let x = leftX; x < leftX + leftW; x++) screen.setStyle(x, ly, { bg: 'blue', fg: 'white', bold: true });
          }
          const stars = '★ ' + shortNum(r.stargazers_count || 0);
          const nameMax = leftW - stars.length - 4;
          screen.writeStr(leftX, ly, selected ? '▶ ' : '  ', selected ? { bg: 'blue', fg: 'white' } : null);
          screen.writeStr(leftX + 2, ly, truncate(r.name, nameMax), selected ? { bg: 'blue', fg: 'white' } : color('repoName') || { fg: 'white' });
          screen.writeStr(leftX + leftW - stars.length, ly, stars, selected ? { bg: 'blue', fg: 'yellow' } : { fg: 'yellow' });
          ly++;
        }
      }
      ly++;
    }
  }

  // Heatmap + Languages side by side in left column below top repos.
  // D9: on narrow terminals the heatmap spans the full width and languages
  // stack below it instead of beside it.
  const halfW = splitX - leftX - 2;
  let heatRightX = leftX + Math.floor(halfW * 0.58);
  let langLeftX = heatRightX + 2;
  if (isNarrow) {
    heatRightX = leftX + halfW;
    langLeftX = leftX;
  }
  const heatTopY = ly;

  // ── Heatmap (left sub-column) ──
  // Honest label: this is PUBLIC events only (REST caps at ~100 rows, no
  // private contributions). Totals + streak come from buildHeatmap so the
  // header can't mix commit counts with event-cell counts.
  if (ly < y + h - 4 && !isDashboardHidden('contributions')) {
    const hm = appState.dashboardContributions;
    const eventsLoading = isWidgetLoading('events');
    if (!hm && eventsLoading) {
      const loadingVisible = sectionHeader(screen, leftX, ly, 'CONTRIBUTIONS (PUBLIC)', null, 'dashboard:contributions');
      ly++;
      if (loadingVisible) {
        loadingIndicator(screen, leftX, ly, 'loading contributions');
        ly += 2;
      }
    } else if (hm) {
      const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
      const heatW = Math.max(0, heatRightX - leftX - 4);
      const cellW = Math.max(1, Math.min(2, Math.floor(heatW / hm.weeks) || 1));
      const totalEvents = hm.total || 0;
      const commitCount = hm.commitCount || 0;
      const contribFocused = appState.dashboardFocusZone === 'contributions';

      let activityLabel;
      if (totalEvents === 0) activityLabel = 'CONTRIBUTIONS (PUBLIC)';
      else if (commitCount > 0) activityLabel = 'CONTRIBUTIONS (PUBLIC) · ' + totalEvents + ' ev · ' + commitCount + ' commits';
      else activityLabel = 'CONTRIBUTIONS (PUBLIC) · ' + totalEvents + ' ev';
      // Keep the header inside the left column so it never bleeds into the
      // languages sub-column on narrow-but-not-stacked widths.
      const maxLabelLen = Math.max(10, heatRightX - leftX - 2);
      activityLabel = truncate(activityLabel, maxLabelLen);
      const contribHint = contribFocused ? '[←→] day [Enter] filter' : null;
      const activityVisible = sectionHeader(screen, leftX, ly, activityLabel, contribHint, 'dashboard:contributions');
      ly++;

      if (activityVisible) {
      if (totalEvents === 0 && !eventsLoading) {
        screen.writeStr(leftX, ly++, truncate('No recent public activity — private needs GraphQL', Math.max(10, heatRightX - leftX)), { dim: true });
        // Even with zero events the scope caveat stays visible so an empty
        // grid is never mistaken for "no contributions at all".
        screen.writeStr(leftX, ly++, truncate('REST: last ~100 public events only', Math.max(10, heatRightX - leftX)), { dim: true });
      } else if (totalEvents === 0 && eventsLoading) {
        loadingIndicator(screen, leftX, ly, 'loading contributions');
        ly++;
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
        // Month strip: one 3-letter label per week column where the UTC
        // month flips. Skipped when the column is too narrow to fit.
        if (cellW >= 1 && ly < y + h - 1) {
          const monthRowAvail = heatRightX - leftX - 3;
          if (monthRowAvail >= hm.weeks) {
            screen.writeStr(leftX + 3, ly, '', null);
            let monthStr = '';
            for (let col = 0; col < hm.weeks; col++) {
              const lbl = (hm.monthLabels && hm.monthLabels[col]) || '';
              // Each week column occupies cellW cells; show the first
              // letter of a new month so labels never overlap.
              const ch = lbl ? lbl[0] : ' ';
              monthStr += ch.repeat(cellW).slice(0, cellW);
              if (leftX + 3 + col * cellW >= heatRightX - 1) break;
            }
            screen.writeStr(leftX + 3, ly, truncate(monthStr, monthRowAvail), { dim: true });
            ly++;
          }
        }
        clampContribSelected();
        const selIdx = appState.dashboardContribSelected;
        const selCol = Math.floor(selIdx / 7);
        const selRow = selIdx % 7;
        // Remember grid geometry for mouse click→day mapping. Store the
        // viewport-mapped Y of the first grid row so screen coords compare
        // correctly while the dashboard body is scrolled.
        const gridStartLy = ly;
        const renderedGridY = typeof screen.mapViewportY === 'function' ? screen.mapViewportY(gridStartLy) : gridStartLy;
        appState._contribGeom = { gridY: renderedGridY, cellW, leftX, weeks: hm.weeks, heatRightX };
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
            const isSel = contribFocused && col === selCol && row === selRow;
            const cell = heatChars[level].repeat(cellW);
            if (isSel) {
              // Selection cursor: paint the cell with the list-selection
              // style so keyboard focus is unmistakable.
              for (let x = cx; x < cx + cellW && x < heatRightX; x++) screen.setStyle(x, ly, { bg: 'blue', fg: 'white', bold: true });
              screen.writeStr(cx, ly, cell, { bg: 'blue', fg: 'white', bold: true });
            } else {
              screen.writeStr(cx, ly, cell, heatStyle(level));
            }
          }
          ly++;
        }
        if (appState.accessible) {
          screen.writeStr(leftX, ly, 'Less . o O # More', { dim: true });
        } else {
          screen.writeStr(leftX, ly, 'Less ░▒▓█ More', { dim: true });
        }
        ly++;
        // Totals + streak line: distinct metrics on one honest row.
        const statsLine = totalEvents + ' events · ' + commitCount + ' commits · ' + hm.streak + 'd streak · best ' + hm.best + '/day';
        screen.writeStr(leftX, ly, truncate(statsLine, Math.max(10, heatRightX - leftX)), { dim: true });
        ly++;
        // Selected-day line when focused; day-filter state always visible.
        if (contribFocused) {
          const dayKey = getContribSelectedDayKey();
          const dayCount = getContribSelectedDayCount();
          const selLine = (dayKey || '—') + ': ' + dayCount + ' ev · [Enter] filter feed';
          screen.writeStr(leftX, ly, truncate(selLine, Math.max(10, heatRightX - leftX)), { fg: 'cyan' });
          ly++;
        }
        if (appState.dashboardContribDayFilter) {
          const fLine = 'Feed filtered to ' + appState.dashboardContribDayFilter + ' · [Enter] clear';
          screen.writeStr(leftX, ly, truncate(fLine, Math.max(10, heatRightX - leftX)), { fg: 'yellow' });
          ly++;
        }
        // Permanent scope caveat — the previous build only showed this when
        // the grid was empty, letting partial data pass as complete.
        screen.writeStr(leftX, ly, truncate('public only · private needs GraphQL', Math.max(10, heatRightX - leftX)), { dim: true });
        ly++;
        // Stale-data signal: the loader keeps the last good grid on widget
        // failure, so stamp its age instead of letting it look fresh.
        const evAge = appState.dashboardWidgetFetched['events'];
        if (evAge && appState.dashboardWidgetErrorCount > 0) {
          screen.writeStr(leftX, ly, truncate('last good data · ' + getWidgetAge('events') + ' old · [r] retry', Math.max(10, heatRightX - leftX)), { fg: 'yellow' });
          ly++;
        }
      }
      } // activityVisible
      ly++;
    }
  }

  // ── Languages (right sub-column, aligned with heatmap top) ──
  // D9: on narrow terminals languages stack below the heatmap full-width.
  if (dashboardRepos.length > 0 && (isNarrow ? ly : heatTopY) < y + h - 2 && !isDashboardHidden('languages')) {
    const langX = isNarrow ? leftX : langLeftX;
    const langY = isNarrow ? ly : heatTopY;
    const langVisible = sectionHeader(screen, langX, langY, 'LANGUAGES', null, 'dashboard:languages');
    if (langVisible) {
      // D14: prefer the memoized histogram, falling back to a live count.
      let langSorted, langTotal;
      if (Array.isArray(appState.dashboardLangHistogram) && appState.dashboardLangHistogram.length > 0) {
        langSorted = appState.dashboardLangHistogram;
        langTotal = langSorted.reduce((a, e) => a + e[1], 0);
      } else {
        const langCount = {};
        for (const r of dashboardRepos) {
          if (r.language) langCount[r.language] = (langCount[r.language] || 0) + 1;
        }
        langTotal = Object.values(langCount).reduce((a, b) => a + b, 0);
        langSorted = Object.entries(langCount).sort((a, b) => b[1] - a[1]).slice(0, 7);
      }
      const total = langTotal;
      const sorted = langSorted;
      // Available width for the bar: full left-column width when stacked,
      // otherwise the right sub-column width. Clamp so the bar + label +
      // count never overflow on narrow terminals.
      const langAvailW = isNarrow ? leftW : Math.max(10, splitX - langLeftX - 2);
      const barW = Math.max(3, Math.min(20, langAvailW - 12));
      let lly = langY + 1;
      if (sorted.length === 0) {
        screen.writeStr(langX, lly, 'No language data — repos may not have languages detected', { dim: true });
        lly++;
      } else {
        for (const [lang, count] of sorted) {
          if (lly >= y + h - 1) break;
          const pct = total > 0 ? count / total : 0;
          const filled = Math.max(1, Math.round(pct * barW));
          const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, barW - filled));
          screen.writeStr(langX, lly, truncate(lang, 8).padEnd(9));
          screen.writeStr(langX + 9, lly, bar, { fg: 'cyan' });
          screen.writeStr(langX + 10 + barW, lly, String(count), { dim: true });
          lly++;
        }
      }
      if (isNarrow) ly = lly + 1;
    } else if (isNarrow) {
      ly = langY + 1;
    }
  }

  // RIGHT COLUMN ────────────────────────────────────────────
  // D9: on narrow terminals the right column stacks below the left column.
  let ry = isNarrow ? ly + 1 : bodyY;

  if (attentionItems.length > 0) {
    const attentionFocused = appState.dashboardFocusZone === 'attention';
    const attentionHint = attentionFocused ? '[Enter] open' : null;
    const attentionVisible = sectionHeader(screen, rightX, ry, 'NEEDS ATTENTION', attentionHint, 'dashboard:attention');
    ry++;
    if (attentionVisible) {
      const start = appState.dashboardAttentionScroll || 0;
      const end = Math.min(start + 4, attentionItems.length);
      for (let ai = start; ai < end; ai++) {
        const item = attentionItems[ai];
        const selected = attentionFocused && ai === appState.dashboardAttentionSelected;
        if (selected) {
          for (let x = rightX; x < rightX + rightW; x++) screen.setStyle(x, ry, { bg: 'blue', fg: 'white', bold: true });
        }
        screen.writeStr(rightX, ry, selected ? '▶ ' : '  ', selected ? { bg: 'blue', fg: 'white' } : null);
        screen.writeStr(rightX + 2, ry, truncate(item.label, Math.max(10, rightW - 12)), selected ? { bg: 'blue', fg: 'white' } : { dim: true });
        const count = String(item.count);
        screen.writeStr(rightX + rightW - count.length, ry, count, selected ? { bg: 'blue', fg: 'yellow', bold: true } : { fg: 'yellow', bold: true });
        ry++;
      }
      ry++;
    }
  }

  const activityFocused = appState.dashboardFocusZone === 'activity';
  // When the activity zone is focused, advertise a working key. The previous
  // "[Enter] open first" was misleading — pressing Enter used to fall through
  // to the trending zone and open trendingSelected, NOT the first event.
  const dayFilter = getActivityDayFilter();
  const activityEvents = dayFilter ? getFilteredActivityEvents() : dashboardEvents;
  const activityTitle = dayFilter ? 'ACTIVITY · ' + dayFilter : 'RECENT ACTIVITY';
  const activityHint = activityFocused ? '[Enter] open repo' : (dayFilter ? '[x] clear day' : null);
  const activityVisible = sectionHeader(screen, rightX, ry, activityTitle, activityHint, 'dashboard:recentActivity');
  ry++;
  if (dayFilter) {
    screen.writeStr(rightX, ry, truncate('day ' + dayFilter + ' · ' + activityEvents.length + ' ev · [x] clear', Math.max(10, rightW)), { fg: 'yellow' });
    ry++;
  }
  if (activityVisible) {
    if ((dayFilter ? activityEvents : dashboardEvents).length === 0) {
      if (!appState.dashboardLoaded) {
        loadingIndicator(screen, rightX, ry, 'loading events');
        ry++;
      } else if (dayFilter) {
        screen.writeStr(rightX, ry++, truncate('No activity on ' + dayFilter + ' — [x] clear filter', Math.max(10, rightW)), { dim: true });
      } else {
        screen.writeStr(rightX, ry++, 'No activity yet — [r] to refresh', { dim: true });
      }
    } else {
      const maxEvents = Math.min(7, Math.max(1, Math.floor((y + h - bodyY) * 0.30)));
      // Honour keyboard scroll: viewport starts at dashboardActivityScroll.
      const activityStart = Math.min(appState.dashboardActivityScroll, activityEvents.length);
      const activityEnd = Math.min(activityStart + maxEvents, activityEvents.length);
      const activityStartY = ry;
      for (let i = activityStart; i < activityEnd; i++) {
        if (ry >= y + h - 1) break;
        const ev = activityEvents[i];
        const sel = activityFocused && i === appState.dashboardActivitySelected;
        const [icon, c, label] = eventGlyph(ev.type);
        const repo = truncate(ev.repo && ev.repo.name ? ev.repo.name : '?', Math.max(10, rightW - 22));
        const when = relTime(ev.created_at);
        if (sel) {
          // Background highlight across the full right-column width so the
          // selection is unmistakable, mirroring how Issues/PRs are rendered
          // when selected.
          for (let x = rightX; x < rightX + rightW; x++) screen.setStyle(x, ry, { bg: 'blue', fg: 'white', bold: true });
        }
        screen.writeStr(rightX, ry, icon, sel ? { bg: 'blue', fg: 'white', bold: true } : c);
        screen.writeStr(rightX + 2, ry, truncate(label, 11).padEnd(11), sel ? { bg: 'blue', fg: 'white', bold: true } : { dim: true });
        screen.writeStr(rightX + 14, ry, truncate(repo, rightW - 22), sel ? { bg: 'blue', fg: 'white' } : null);
        screen.writeStr(rightX + rightW - when.length, ry, when, sel ? { bg: 'blue', fg: 'white' } : { dim: true });
        ry++;
      }
      scrollIndicators(screen, activityStartY, ry - 1, appState.dashboardActivityScroll, activityEvents.length);
    }
    ry++;
  }

  if (ry < y + h - 3 && (dashboardIssues.length > 0 || (appState.dashboardLoaded && !isWidgetLoading('issues'))) && !isDashboardHidden('issues')) {
    const issueFocused = appState.dashboardFocusZone === 'issues';
    const issueHint = issueFocused ? '[Enter] open' : null;
    const issuesVisible = sectionHeader(screen, rightX, ry, 'RECENT ISSUES', issueHint, 'dashboard:issues');
    ry++;
    if (issuesVisible) {
      if (dashboardIssues.length === 0) {
        screen.writeStr(rightX, ry++, 'No recent issues — [r] refresh', { dim: true });
        ry++;
      }
      const maxIssues = Math.min(4, Math.max(1, Math.floor((y + h - bodyY) * 0.20)));
      const issueScroll = appState.dashboardIssueScroll;
      const issueEnd = Math.min(issueScroll + maxIssues, dashboardIssues.length);
      for (let ii = issueScroll; ii < issueEnd; ii++) {
        if (ry >= y + h - 1) break;
        const issue = dashboardIssues[ii];
        const sel = issueFocused && ii === appState.dashboardIssueSelected;
        if (sel) {
          for (let x = rightX; x < rightX + rightW; x++) screen.setStyle(x, ry, { bg: 'blue', fg: 'white', bold: true });
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

  if (ry < y + h - 3 && (dashboardPRs.length > 0 || (appState.dashboardLoaded && !isWidgetLoading('prs'))) && !isDashboardHidden('prs')) {
    const prFocused = appState.dashboardFocusZone === 'prs';
    const prHint = prFocused ? '[Enter] open' : null;
    const prsVisible = sectionHeader(screen, rightX, ry, 'RECENT PRs', prHint, 'dashboard:prs');
    ry++;
    if (prsVisible) {
      if (dashboardPRs.length === 0) {
        screen.writeStr(rightX, ry++, 'No recent PRs — [r] refresh', { dim: true });
        ry++;
      }
      const maxPRs = Math.min(4, Math.max(1, Math.floor((y + h - bodyY) * 0.20)));
      const prScroll = appState.dashboardPRScroll;
      const prEnd = Math.min(prScroll + maxPRs, dashboardPRs.length);
      for (let pi = prScroll; pi < prEnd; pi++) {
        if (ry >= y + h - 1) break;
        const pr = dashboardPRs[pi];
        const sel = prFocused && pi === appState.dashboardPRSelected;
        if (sel) {
          for (let x = rightX; x < rightX + rightW; x++) screen.setStyle(x, ry, { bg: 'blue', fg: 'white', bold: true });
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

  if (ry < y + h - 3 && appState.dashboardStaleCount > 0 && !isDashboardHidden('stale')) {
    const staleFocused = appState.dashboardFocusZone === 'stale';
    const staleHint = staleFocused ? '[Enter] open' : null;
    const staleVisible = sectionHeader(screen, rightX, ry, 'STALE REPOS', staleHint, 'dashboard:stale');
    ry++;
    if (staleVisible) {
      for (let sti = 0; sti < appState.dashboardStaleRepos.length; sti++) {
        if (ry >= y + h - 1) break;
        const name = appState.dashboardStaleRepos[sti];
        const selected = staleFocused && sti === appState.dashboardStaleSelected;
        if (selected) {
          for (let x = rightX; x < rightX + rightW; x++) screen.setStyle(x, ry, { bg: 'blue', fg: 'white', bold: true });
        }
        screen.writeStr(rightX, ry, selected ? '▶ ' : '  ', selected ? { bg: 'blue', fg: 'white' } : null);
        screen.writeStr(rightX + 2, ry, truncate(name, rightW - 2), selected ? { bg: 'blue', fg: 'white' } : { fg: 'yellow' });
        ry++;
      }
      if (appState.dashboardStaleCount > appState.dashboardStaleRepos.length) {
        screen.writeStr(rightX, ry++, '... and ' +
          (appState.dashboardStaleCount - appState.dashboardStaleRepos.length) + ' more', { dim: true });
      }
      ry++;
    }
  }

  // D16 opt-in SECURITY section: non-focusable display rows (no focus zone —
  // focus.mjs is owned elsewhere). Surfaced only when data exists and the
  // widget isn't hidden via dashboard prefs.
  if (ry < y + h - 3 && (appState.securityAggregate || []).length > 0 && !isDashboardHidden('security')) {
    const secAlerts = appState.securityAggregate;
    const secVisible = sectionHeader(screen, rightX, ry, 'SECURITY · ' + secAlerts.length, null, 'dashboard:security');
    ry++;
    if (secVisible) {
      const maxSec = Math.min(3, secAlerts.length);
      for (let si2 = 0; si2 < maxSec; si2++) {
        if (ry >= y + h - 1) break;
        const alert = secAlerts[si2] || {};
        const sev = String(alert.severity || (alert.rule && alert.rule.security_severity_level) || '?').toUpperCase();
        const secRepo = alert.repository || '?';
        const secTitle = alert.title
          || (alert.security_advisory && alert.security_advisory.summary)
          || (alert.dependency && alert.dependency.package && alert.dependency.package.name)
          || alert.secret_type
          || (alert.rule && (alert.rule.description || alert.rule.name))
          || alert.source
          || 'alert';
        screen.writeStr(rightX, ry++, truncate(sev + ' ' + secRepo + ' — ' + secTitle, rightW), { fg: 'cyan' });
      }
      ry++;
    }
  }

  // D16 opt-in MY WORK section: same non-focusable display treatment.
  if (ry < y + h - 3 && (appState.myWorkQueue || []).length > 0 && !isDashboardHidden('mywork')) {
    const workItems = appState.myWorkQueue;
    const workVisible = sectionHeader(screen, rightX, ry, 'MY WORK · ' + workItems.length, null, 'dashboard:mywork');
    ry++;
    if (workVisible) {
      const maxWork = Math.min(3, workItems.length);
      for (let wi = 0; wi < maxWork; wi++) {
        if (ry >= y + h - 1) break;
        const item = workItems[wi] || {};
        screen.writeStr(rightX, ry++, truncate(
          String(item.kind || '?').toUpperCase() + ' ' + (item.repo || '?') + ' — ' + (item.title || ''), rightW), { dim: true });
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
      const customFocused = appState.dashboardFocusZone === 'custom' && appState.dashboardCustomSectionSelected === si;
      const secVisible = sectionHeader(screen, rightX, ry, sec.title.toUpperCase(), customFocused ? '[Enter] open' : null, secKey);
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
          const selected = customFocused && ii === appState.dashboardCustomItemSelected;
          if (selected) {
            for (let x = rightX; x < rightX + rightW; x++) screen.setStyle(x, ry, { bg: 'blue', fg: 'white', bold: true });
          }
          const numStyle = selected ? { bg: 'blue', fg: isPR ? 'cyan' : 'yellow', bold: true } : (isPR ? { fg: 'cyan' } : { fg: 'yellow' });
          const titleStyle = item.state === 'open'
            ? (isPR ? { fg: 'cyan' } : { fg: 'green' })
            : { dim: true };
          screen.writeStr(rightX, ry, selected ? '▶ ' : '  ', selected ? { bg: 'blue', fg: 'white' } : null);
          screen.writeStr(rightX + 2, ry, num, numStyle);
          screen.writeStr(rightX + 8, ry, title, selected ? { bg: 'blue', fg: 'white', bold: true } : titleStyle);
          ry++;
        }
        ry++;
      }
    }
  }

  if (ry < y + h - 2 && !isDashboardHidden('trending')) {
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
      } else if (localRepoName()) {
        screen.writeStr(rightX, ry++, 'No trending for this repo — [l] to clear local filter', { dim: true });
      } else {
        screen.writeStr(rightX, ry++, '(none) — [t] period · [/] filter · [r] refresh', { dim: true });
      }
    } else {
      // Trending is the LAST section in the right column, so it fills the
      // remaining viewport height instead of a fixed budget (the old ~30%
      // cap hid most of the list on tall terminals). Keep one row for the
      // page indicator when paging applies.
      const pageInfoRow = (appState.trendingHasMore || appState.trendingPage > 1) ? 1 : 0;
      const maxTrending = Math.max(1, y + h - 1 - ry - pageInfoRow);
      // Keep selection + scroll inside the rows drawn this frame so
      // keyboard/hover/clicks never leave the highlight off-screen.
      const scroll = appState.trendingScroll;
      if (appState.trendingSelected >= scroll + maxTrending) {
        appState.trendingScroll = Math.max(0, appState.trendingSelected - maxTrending + 1);
      } else if (appState.trendingSelected < appState.trendingScroll) {
        appState.trendingScroll = appState.trendingSelected;
      }
      const end = Math.min(appState.trendingScroll + maxTrending, trendingList.length);
      const trendingStartY = ry;
      for (let i = appState.trendingScroll; i < end; i++) {
        if (ry >= y + h - 1) break;
        const r = trendingList[i];
        const sel = i === appState.trendingSelected;
        if (sel) {
          for (let x = rightX; x < rightX + rightW; x++) screen.setStyle(x, ry, { bg: 'blue', fg: 'white', bold: true });
        }
        const name = truncate(r.full_name || '?', rightW - 8);
        const stars = '★ ' + shortNum(r.stargazers_count || 0);
        screen.writeStr(rightX, ry, sel ? '▶ ' : '  ', sel ? { bg: 'blue', fg: 'white' } : null);
        screen.writeStr(rightX + 2, ry, name, sel ? { bg: 'blue', fg: 'white', bold: true } : (color('repoName') || { fg: 'white' }));
        screen.writeStr(rightX + rightW - stars.length, ry, stars, sel ? { bg: 'blue', fg: 'magenta' } : { fg: 'magenta' });
        ry++;
      }
      if (pageInfoRow > 0 && ry < y + h - 1) {
        const pageInfo = 'Page ' + appState.trendingPage + '   [PgUp/PgDn]';
        screen.writeStr(rightX, ry, pageInfo, { dim: true });
        ry++;
      }
      scrollIndicators(screen, trendingStartY, ry - 1, appState.trendingScroll, trendingList.length);
    }
  }

  // Column divider line (skipped in narrow stacked mode — D9).
  const colBot = Math.max(ly, ry);
  const bodyH = Math.max(0, colBot - bodyY);
  appState.dashboardMaxScroll = Math.max(0, bodyH - (bodyViewportBottom - bodyY));
  if (!isNarrow) {
    for (let dy = 0; dy < bodyH; dy++) {
      screen.setCell(splitX, bodyY + dy, '│', { dim: true });
    }
  }
  screen.popViewport();
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
  // Match github.mjs getTrendingRepos (stars floor keeps noise out).
  return 'created:>' + since + ' stars:>5';
}

async function _fetchTrendingPage(page, gen) {
  try {
    const list = await searchRepositories(
      appState.token, _trendingQuery(), page, 30, gen.signal
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
  const gen = startAsync('dashboard-trending');
  beginLoading(gen);
  render();
  const { stale, list, error } = await _fetchTrendingPage(page, gen);
  if (stale) return;
  if (error) {
    showError(error.message || 'Failed to load trending page ' + page, 'Trending', {
      retry: () => _setTrendingPage(page, replace),
    });
  } else if (Array.isArray(list) && list.length > 0) {
    if (replace) {
      appState.trending = list;
      appState.trendingSelected = 0;
      appState.trendingScroll = 0;
    } else {
      appState.trending = [...appState.trending, ...list];
    }
    appState.trendingPage = page;
    appState.trendingHasMore = list.length >= 30;
  } else {
    appState.trendingHasMore = false;
  }
  if (!isStale(gen, 'dashboard-trending')) {
    finishLoading(gen);
    render();
  }
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
    // Scroll is kept aligned at draw time (renderDashboard clamps
    // trendingScroll to the rows actually visible this frame), so no
    // window-size arithmetic is needed here.
    appState.trendingSelected++;
    render();
  } else if (appState.trendingHasMore) {
    loadMoreTrending();
  }
}

export function pageUp() {
  const step = Math.max(1, Math.floor((getScreen()?.height || 24) * 0.6));
  appState.dashboardScroll = Math.max(0, (appState.dashboardScroll || 0) - step);
  render();
}

export function pageDown() {
  const step = Math.max(1, Math.floor((getScreen()?.height || 24) * 0.6));
  appState.dashboardScroll = Math.min(appState.dashboardMaxScroll || 0, (appState.dashboardScroll || 0) + step);
  render();
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
    appState.reposView = 'own';
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
    appState.reposView = 'own';
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
  appState.trendingScroll = 0;
  showMessage(appState.dashboardFilter
    ? 'Filtering trending: "' + appState.dashboardFilter + '"'
    : 'Trending filter cleared', 'info');
  render();
});

export function getFilteredTrending() {
  const q = (appState.dashboardFilter || '').trim().toLowerCase();
  const local = localRepoName();
  return (appState.trending || []).filter(r => {
    if (local && r.full_name !== local) return false;
    if (!q) return true;
    const haystack = [
      r.full_name, r.name, r.description, r.language,
      r.owner && (r.owner.login || r.owner.login),
      ...(Array.isArray(r.topics) ? r.topics : []),
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(q);
  });
}

function reloadTrending(previousPeriod = appState.trendingPeriod) {
  if (!appState.token) return;
  const days = appState.trendingPeriod;
  const gen = startAsync('dashboard-trending');
  beginLoading(gen);
  render();
  getTrendingRepos(appState.token, days, 30, gen.signal).then(more => {
    if (isStale(gen, 'dashboard-trending')) return;
    appState.trending = Array.isArray(more) ? more : [];
    appState.trendingPage = 1;
    appState.trendingScroll = 0;
    appState.trendingSelected = 0;
    appState.trendingHasMore = appState.trending.length >= 30;
    if (!isStale(gen, 'dashboard-trending')) {
      finishLoading(gen);
      render();
    }
  }).catch((error) => {
    if (!isStale(gen, 'dashboard-trending')) {
      appState.trendingPeriod = previousPeriod;
      showError(error.message || 'Trending refresh failed', 'Trending', { retry: () => reloadTrending(previousPeriod) });
      if (!isStale(gen, 'dashboard-trending')) {
        finishLoading(gen);
        render();
      }
    }
  });
}

export const keys = {
  't': () => {
    const cycle = { 1: 7, 7: 30, 30: 1 };
    const previousPeriod = appState.trendingPeriod;
    appState.trendingPeriod = cycle[appState.trendingPeriod] || 7;
    const labels = { 1: 'today', 7: 'this week', 30: 'this month' };
    showMessage('Trending: ' + labels[appState.trendingPeriod], 'info');
    reloadTrending(previousPeriod);
  },
  '/': () => startInput('Filter trending: ', 'dashboard-filter'),
  'x': () => {
    if (appState.dashboardContribDayFilter) clearContribDayFilter();
    else showMessage('No day filter to clear', 'info');
  },
  'c': () => {
    if (appState.dashboardContribDayFilter) clearContribDayFilter();
    else showMessage('No day filter to clear', 'info');
  },
  'n': () => {
    import('../issue-create.mjs').then(m => m.startCreateIssue());
  },
  'l': () => {
    if (!appState.localRepo) {
      showMessage('No local git repo detected', 'warning');
      return;
    }
    appState.localRepoFilter = !appState.localRepoFilter;
    appState.dashboardScroll = 0;
    appState.trendingScroll = 0;
    appState.trendingSelected = 0;
    appState.dashboardActivityScroll = 0;
    appState.dashboardActivitySelected = 0;
    appState.dashboardIssueScroll = 0;
    appState.dashboardIssueSelected = 0;
    appState.dashboardPRScroll = 0;
    appState.dashboardPRSelected = 0;
    recomputeDashboardDerived();
    showMessage(appState.localRepoFilter
      ? 'Filtering to ' + appState.localRepo.owner + '/' + appState.localRepo.repo
      : 'Local repo filter cleared', 'info');
  },
};

// (Removed the unused `ZONES` array and dead `cycleDashboardZone()` export.
// Focus is driven entirely by `tui/focus.mjs`'s `_focusState.zoneIndex`
// and Tab/Shift+Tab through `focusNext/focusPrev`. There were zero
// callers of `cycleDashboardZone` anywhere in the codebase.)

function dashboardCustomSectionsWithItems() {
  return appState.customSections || [];
}

function firstCustomSectionIndex(from = 0, direction = 1) {
  const sections = dashboardCustomSectionsWithItems();
  for (let i = from; i >= 0 && i < sections.length; i += direction) {
    if (sections[i]?.items?.length > 0) return i;
  }
  return -1;
}

export function dashboardUp() {
  const zone = appState.dashboardFocusZone;
  if (zone === 'attention') {
    if (!appState.dashboardAttentionItems?.length) return;
    appState.dashboardAttentionSelected = Math.max(0, appState.dashboardAttentionSelected - 1);
    if (appState.dashboardAttentionSelected < appState.dashboardAttentionScroll) appState.dashboardAttentionScroll = appState.dashboardAttentionSelected;
    render();
    return;
  }
  if (zone === 'cards') return;
  if (zone === 'contributions') {
    // Vertical step = one week back in the heatmap grid.
    moveContribSelection(-7);
    return;
  }
  if (zone === 'custom') {
    const sections = dashboardCustomSectionsWithItems();
    let sectionIndex = appState.dashboardCustomSectionSelected;
    if (!sections[sectionIndex]?.items?.length) sectionIndex = firstCustomSectionIndex(0);
    const sec = sections[sectionIndex];
    if (!sec) return;
    if (appState.dashboardCustomItemSelected > 0) {
      appState.dashboardCustomItemSelected--;
    } else {
      const previous = firstCustomSectionIndex(sectionIndex - 1, -1);
      if (previous >= 0) {
        appState.dashboardCustomSectionSelected = previous;
        appState.dashboardCustomItemSelected = sections[previous].items.length - 1;
      }
    }
    render();
    return;
  }
  if (zone === 'trending') { trendingUp(); return; }
  if (zone === 'activity') {
    const events = getFilteredActivityEvents();
    if (events.length === 0) return;
    appState.dashboardActivitySelected = Math.max(0, appState.dashboardActivitySelected - 1);
    if (appState.dashboardActivitySelected < appState.dashboardActivityScroll) {
      appState.dashboardActivityScroll = appState.dashboardActivitySelected;
    }
    render();
    return;
  }
  if (zone === 'issues') {
    const issues = getDashboardIssues();
    if (issues.length === 0) return;
    appState.dashboardIssueSelected = Math.max(0, appState.dashboardIssueSelected - 1);
    if (appState.dashboardIssueSelected < appState.dashboardIssueScroll) {
      appState.dashboardIssueScroll = appState.dashboardIssueSelected;
    }
    render();
    return;
  }
  if (zone === 'prs') {
    const prs = getDashboardPRs();
    if (prs.length === 0) return;
    appState.dashboardPRSelected = Math.max(0, appState.dashboardPRSelected - 1);
    if (appState.dashboardPRSelected < appState.dashboardPRScroll) {
      appState.dashboardPRScroll = appState.dashboardPRSelected;
    }
    render();
    return;
  }
  if (zone === 'topRepos') {
    const top = getTopReposSorted();
    if (top.length === 0) return;
    appState.dashboardTopSelected = Math.max(0, appState.dashboardTopSelected - 1);
    appState.dashboardTopScroll = 0;
    render();
    return;
  }
  if (zone === 'stale') {
    const stale = appState.dashboardStaleRepos || [];
    if (stale.length === 0) return;
    appState.dashboardStaleSelected = Math.max(0, appState.dashboardStaleSelected - 1);
    appState.dashboardStaleScroll = 0;
    render();
    return;
  }
}

export function dashboardDown() {
  const zone = appState.dashboardFocusZone;
  if (zone === 'attention') {
    const items = appState.dashboardAttentionItems || [];
    if (!items.length) return;
    appState.dashboardAttentionSelected = Math.min(items.length - 1, appState.dashboardAttentionSelected + 1);
    if (appState.dashboardAttentionSelected >= appState.dashboardAttentionScroll + 4) appState.dashboardAttentionScroll++;
    render();
    return;
  }
  if (zone === 'cards') return;
  if (zone === 'contributions') {
    moveContribSelection(7);
    return;
  }
  if (zone === 'custom') {
    const sections = dashboardCustomSectionsWithItems();
    let sectionIndex = appState.dashboardCustomSectionSelected;
    if (!sections[sectionIndex]?.items?.length) sectionIndex = firstCustomSectionIndex(0);
    const sec = sections[sectionIndex];
    if (!sec) return;
    if (appState.dashboardCustomItemSelected < sec.items.length - 1) {
      appState.dashboardCustomItemSelected++;
    } else {
      const next = firstCustomSectionIndex(sectionIndex + 1, 1);
      if (next >= 0) {
        appState.dashboardCustomSectionSelected = next;
        appState.dashboardCustomItemSelected = 0;
      }
    }
    render();
    return;
  }
  if (zone === 'trending') { trendingDown(); return; }
  if (zone === 'activity') {
    const events = getFilteredActivityEvents();
    if (events.length === 0) return;
    const screen = getScreen();
    const H = screen ? screen.height : 24;
    const maxVisible = Math.min(7, Math.max(1, Math.floor((H - 17) * 0.30)));
    appState.dashboardActivitySelected = Math.min(
      events.length - 1,
      appState.dashboardActivitySelected + 1
    );
    if (appState.dashboardActivitySelected >= appState.dashboardActivityScroll + maxVisible) {
      appState.dashboardActivityScroll++;
    }
    render();
    return;
  }
  if (zone === 'issues') {
    const issues = getDashboardIssues();
    if (issues.length === 0) return;
    appState.dashboardIssueSelected = Math.min(
      issues.length - 1,
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
    const prs = getDashboardPRs();
    if (prs.length === 0) return;
    appState.dashboardPRSelected = Math.min(
      prs.length - 1,
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
  if (zone === 'topRepos') {
    const top = getTopReposSorted();
    if (top.length === 0) return;
    appState.dashboardTopSelected = Math.min(top.length - 1, appState.dashboardTopSelected + 1);
    appState.dashboardTopScroll = 0;
    render();
    return;
  }
  if (zone === 'stale') {
    const stale = appState.dashboardStaleRepos || [];
    if (stale.length === 0) return;
    appState.dashboardStaleSelected = Math.min(stale.length - 1, appState.dashboardStaleSelected + 1);
    appState.dashboardStaleScroll = 0;
    render();
    return;
  }
}

export function openNeedsAttention() {
  const item = (appState.dashboardAttentionItems || [])[appState.dashboardAttentionSelected];
  if (!item) return;
  if (item.kind === 'inbox') {
    appState.inboxFilter = item.filter || 'all';
    appState.inboxTextFilter = '';
    setTab(4);
    if (appState.notifications.length === 0 && appState.token) {
      import('./inbox.mjs').then(m => m.loadNotifications()).catch(() => {});
    } else {
      render();
    }
    return;
  }
  if (item.kind === 'actions') {
    setTab(3);
    if (appState.actionsRepos.length === 0 && appState.token) {
      import('./actions.mjs').then(m => m.loadActionsRepos()).catch(() => {});
    } else {
      render();
    }
    return;
  }
  if (item.kind === 'stale') {
    appState.reposView = 'own';
    appState.repoStaleOnly = true;
    appState.repoScroll = 0;
    appState.repoSelected = 0;
    setTab(1);
    return;
  }
}

export function openDashboardItem() {
  const zone = appState.dashboardFocusZone;
  if (zone === 'attention') { openNeedsAttention(); return; }
  if (zone === 'cards') { openFocusedCard(); return; }
  if (zone === 'contributions') { toggleContribDayFilter(); return; }
  if (zone === 'trending') { openTrendingRepo(); return; }
  if (zone === 'custom') {
    const sections = dashboardCustomSectionsWithItems();
    const sec = sections[appState.dashboardCustomSectionSelected];
    const item = sec?.items?.[appState.dashboardCustomItemSelected];
    if (!item) return;
    let owner, repo;
    if (item.repository_url) {
      const parts = item.repository_url.split('/');
      owner = parts[parts.length - 2];
      repo = parts[parts.length - 1];
    } else if (item.html_url) {
      const match = item.html_url.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (match) { owner = match[1]; repo = match[2]; }
    }
    if (owner && repo) {
      const type = item.pull_request != null || sec.type === 'prs' ? 'pull_request' : 'issue';
      import('./detail.mjs').then(m => m.openDetail(type, owner, repo, item.number)).catch(() => showMessage('Unable to open custom item', 'error'));
    } else {
      showMessage('No repository URL for this custom item', 'warning');
    }
    return;
  }
  if (zone === 'activity') {
    const ev = getFilteredActivityEvents()[appState.dashboardActivitySelected];
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
    const issue = getDashboardIssues()[appState.dashboardIssueSelected];
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
      import('./detail.mjs').then(m => m.openDetail('issue', owner, repo, issue.number)).catch(() => showMessage('Unable to open issue detail', 'error'));
    } else {
      showMessage('No repository URL for this issue', 'warning');
    }
    return;
  }
  if (zone === 'prs') {
    const pr = getDashboardPRs()[appState.dashboardPRSelected];
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
      import('./detail.mjs').then(m => m.openDetail('pull_request', owner, repo, pr.number)).catch(() => showMessage('Unable to open PR detail', 'error'));
    } else {
      showMessage('No repository URL for this pull request', 'warning');
    }
    return;
  }
  if (zone === 'topRepos') {
    const top = getTopReposSorted();
    if (top.length === 0) return;
    const idx = Math.min(appState.dashboardTopSelected, top.length - 1);
    const selected = top[idx] || top[0];
    const full = selected.full_name
      || (selected.owner && selected.owner.login ? selected.owner.login + '/' + selected.name : null);
    if (full && full.includes('/')) {
      const [owner, repo] = full.split('/');
      setTab(2);
      loadRepoDetails(owner, repo);
    } else {
      showMessage('No repository for this top repo', 'warning');
    }
    return;
  }
  if (zone === 'stale') {
    const stale = appState.dashboardStaleRepos || [];
    if (stale.length === 0) return;
    const idx = Math.min(appState.dashboardStaleSelected, stale.length - 1);
    const staleName = stale[idx];
    const match = getDashboardRepos().find(r => r.name === staleName);
    const full = match && match.full_name;
    if (full && full.includes('/')) {
      const [owner, repo] = full.split('/');
      setTab(2);
      loadRepoDetails(owner, repo);
    } else {
      showMessage('No repository for this stale entry', 'warning');
    }
    return;
  }
}

// Card focus navigation (Tab on dashboard).
export function focusCards() {
  appState.dashboardCardsFocus = true;
  appState.dashboardFocusZone = 'cards';
  render();
}
export function unfocusCards() {
  appState.dashboardCardsFocus = false;
  appState.dashboardFocusZone = 'trending';
  render();
}
// Contributions day cursor: ←/→ move one day, ↑/↓ (via dashboardUp/Down)
// move one week. Only active when the contributions zone holds focus so the
// global card arrows keep working elsewhere.
export function leftContrib() {
  if (appState.dashboardFocusZone !== 'contributions') return false;
  moveContribSelection(-1);
  return true;
}
export function rightContrib() {
  if (appState.dashboardFocusZone !== 'contributions') return false;
  moveContribSelection(1);
  return true;
}
export function leftCard() {
  if (appState.dashboardFocusZone === 'contributions') { moveContribSelection(-1); return; }
  if (!appState.dashboardCardsFocus) return;
  appState.dashboardSelectedCard = Math.max(0, appState.dashboardSelectedCard - 1);
  render();
}
export function rightCard() {
  if (appState.dashboardFocusZone === 'contributions') { moveContribSelection(1); return; }
  if (!appState.dashboardCardsFocus) return;
  appState.dashboardSelectedCard = Math.min(4, appState.dashboardSelectedCard + 1);
  render();
}

// ── Collapsible sections ──
const DASHBOARD_SECTIONS = ['profile', 'stars', 'topRepos', 'contributions', 'languages', 'attention', 'recentActivity', 'issues', 'prs', 'stale', 'trending'];

export function getSections() {
  const base = DASHBOARD_SECTIONS.map(s => 'dashboard:' + s);
  const custom = (appState.customSections || []).map((_, i) => 'dashboard:custom-' + i);
  return [...base, ...custom];
}

export function getCurrentSection() {
  const zone = appState.dashboardFocusZone;
  if (zone === 'trending') return 'dashboard:trending';
  if (zone === 'attention') return 'dashboard:attention';
  if (zone === 'contributions') return 'dashboard:contributions';
  if (zone === 'activity') return 'dashboard:recentActivity';
  if (zone === 'issues') return 'dashboard:issues';
  if (zone === 'prs') return 'dashboard:prs';
  if (zone === 'topRepos') return 'dashboard:topRepos';
  if (zone === 'stale') return 'dashboard:stale';
  if (zone === 'custom') return 'dashboard:custom-' + appState.dashboardCustomSectionSelected;
  return 'dashboard:profile';
}
