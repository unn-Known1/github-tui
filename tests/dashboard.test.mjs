import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { appState, DASHBOARD_WIDGET_TTL_MS, shouldRefreshWidget, isDashboardHidden, resetAccountState } from '../tui/state.mjs';
import {
  buildHeatmap,
  buildStarHistory,
  getDashboardRepos,
  getDashboardEvents,
  getDashboardIssues,
  getDashboardPRs,
  getFilteredTrending,
  getNeedsAttention,
} from '../tui/tabs/dashboard.mjs';
import { focusNext, focusDashboardZone, getFocusZone, resetFocus } from '../tui/focus.mjs';
import { dashboardDown, dashboardUp } from '../tui/tabs/dashboard.mjs';
import { Screen } from '../tui/screen.mjs';

const saved = {};
const keysToSave = [
  'localRepo', 'localRepoFilter', 'repos', 'events', 'dashboardRecentIssues',
  'dashboardRecentPRs', 'starred', 'trending', 'dashboardFilter',
  'notifications', 'actionsRuns', 'dashboardAttentionItems',
  'dashboardAttentionSelected', 'dashboardAttentionScroll',
  'dashboardActivitySelected', 'dashboardActivityScroll',
  'dashboardIssueSelected', 'dashboardIssueScroll',
  'dashboardPRSelected', 'dashboardPRScroll', 'dashboardFocusZone',
  'dashboardCardsFocus', 'customSections', 'dashboardCustomSectionSelected',
  'dashboardCustomItemSelected',
  'actionsFailures', 'dashboardWidgetFetched', 'dashboardHidden',
  'dashboardQuickActions', 'dashboardTopRepos', 'dashboardLangHistogram',
  'dashboardTotals', 'dashboardTopSelected', 'dashboardTopScroll',
  'dashboardStaleSelected', 'dashboardStaleScroll',
];
for (const key of keysToSave) saved[key] = appState[key];

function restore() {
  for (const key of keysToSave) appState[key] = saved[key];
  resetFocus(0);
}

afterEach(restore);

describe('Dashboard data helpers', () => {
  it('places today in the current Sunday-based heatmap week', () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const heatmap = buildHeatmap([
      { type: 'PushEvent', created_at: today.toISOString(), payload: { size: 1 } },
      { type: 'WatchEvent', created_at: today.toISOString(), payload: {} },
    ], []);
    assert.equal(heatmap.grid[today.getDay()][14], 1);
    assert.equal(heatmap.grid.flat().reduce((a, b) => a + b, 0), 1);
  });

  it('filters Dashboard collections to the detected local repository', () => {
    appState.localRepo = { owner: 'me', repo: 'alpha' };
    appState.localRepoFilter = true;
    appState.repos = [
      { full_name: 'me/alpha', name: 'alpha', language: 'JS' },
      { full_name: 'me/beta', name: 'beta', language: 'Go' },
    ];
    appState.events = [
      { repo: { name: 'me/alpha' } },
      { repo: { name: 'me/beta' } },
    ];
    appState.dashboardRecentIssues = [
      { repository_url: 'https://api.github.com/repos/me/alpha', number: 1 },
      { repository_url: 'https://api.github.com/repos/me/beta', number: 2 },
    ];
    appState.dashboardRecentPRs = [
      { html_url: 'https://github.com/me/alpha/pull/1', number: 1 },
      { html_url: 'https://github.com/me/beta/pull/2', number: 2 },
    ];
    appState.trending = [
      { full_name: 'me/alpha' },
      { full_name: 'me/beta' },
    ];
    appState.dashboardFilter = '';

    assert.deepEqual(getDashboardRepos().map(r => r.full_name), ['me/alpha']);
    assert.equal(getDashboardEvents().length, 1);
    assert.equal(getDashboardIssues().length, 1);
    assert.equal(getDashboardPRs().length, 1);
    assert.deepEqual(getFilteredTrending().map(r => r.full_name), ['me/alpha']);
  });

  it('keeps account-wide Dashboard totals when local context is detected but disabled', () => {
    appState.localRepo = { owner: 'me', repo: 'alpha' };
    appState.localRepoFilter = false;
    appState.repos = [
      { full_name: 'me/alpha' },
      { full_name: 'me/beta' },
    ];
    assert.equal(getDashboardRepos().length, 2);
  });

  it('builds a compact attention summary from loaded data', () => {
    appState.notifications = [
      { unread: true, reason: 'review_requested' },
      { unread: true, reason: 'mention' },
    ];
    appState.actionsRuns = [{ conclusion: 'failure' }];
    appState.repos = [{ name: 'old', pushed_at: '2020-01-01T00:00:00Z' }];
    const items = getNeedsAttention(appState.repos);
    assert.deepEqual(items.map(i => i.id), ['reviews', 'mentions', 'ci', 'stale']);
  });
});

describe('Dashboard focus and viewport behavior', () => {
  it('focuses cards first, then the actionable widget', () => {
    appState.dashboardAttentionItems = [{ id: 'unread', count: 1 }];
    resetFocus(0);
    assert.equal(getFocusZone(), null);
    focusNext();
    assert.equal(getFocusZone()?.id, 'cards');
    assert.equal(appState.dashboardCardsFocus, true);
    focusNext();
    assert.equal(getFocusZone()?.id, 'attention');
    assert.equal(appState.dashboardFocusZone, 'attention');
  });

  it('can synchronize focus after a mouse selection', () => {
    appState.events = [{ repo: { name: 'me/alpha' } }];
    assert.equal(focusDashboardZone('activity'), true);
    assert.equal(getFocusZone()?.id, 'activity');
    assert.equal(appState.dashboardCardsFocus, false);
  });

  it('moves through all custom sections instead of trapping on the first', () => {
    appState.customSections = [
      { title: 'Issues', items: [{ number: 1 }, { number: 2 }] },
      { title: 'Reviews', items: [{ number: 3 }] },
    ];
    appState.dashboardFocusZone = 'custom';
    appState.dashboardCustomSectionSelected = 0;
    appState.dashboardCustomItemSelected = 0;
    dashboardDown();
    assert.equal(appState.dashboardCustomSectionSelected, 0);
    assert.equal(appState.dashboardCustomItemSelected, 1);
    dashboardDown();
    assert.equal(appState.dashboardCustomSectionSelected, 1);
    assert.equal(appState.dashboardCustomItemSelected, 0);
    dashboardUp();
    assert.equal(appState.dashboardCustomSectionSelected, 0);
    assert.equal(appState.dashboardCustomItemSelected, 1);
  });

  it('clips and offsets body writes inside a viewport', () => {
    const screen = new Screen();
    screen.width = 20;
    screen.height = 10;
    screen._init();
    screen.pushViewport(3, 8, 2);
    screen.writeStr(1, 5, 'visible');
    screen.writeStr(1, 3, 'hidden');
    screen.popViewport();
    assert.equal(screen.charBuf[3][1], 'v');
    assert.equal(screen.charBuf[3].includes('h'), false);
  });
});

describe('Dashboard state infra — D13 per-widget TTL (state.mjs)', () => {
  it('shouldRefreshWidget returns true when never fetched, false when fresh, true when stale', () => {
    const now = Date.now();
    appState.dashboardWidgetFetched = {};
    assert.equal(shouldRefreshWidget('events', now), true);
    appState.dashboardWidgetFetched = { events: now };
    assert.equal(shouldRefreshWidget('events', now), false);
    appState.dashboardWidgetFetched = { events: now - DASHBOARD_WIDGET_TTL_MS.events - 1 };
    assert.equal(shouldRefreshWidget('events', now), true);
  });

  it('exposes per-widget TTL budgets with slower refresh for expensive widgets', () => {
    assert.equal(DASHBOARD_WIDGET_TTL_MS.events, 5 * 60 * 1000);
    assert.equal(DASHBOARD_WIDGET_TTL_MS.trending, 30 * 60 * 1000);
    assert.equal(DASHBOARD_WIDGET_TTL_MS.starred, 60 * 60 * 1000);
    // Unknown widgets fall back to the 5-minute default.
    const now = Date.now();
    appState.dashboardWidgetFetched = { whatever: now - 6 * 60 * 1000 };
    assert.equal(shouldRefreshWidget('whatever', now), true);
    appState.dashboardWidgetFetched = { whatever: now };
    assert.equal(shouldRefreshWidget('whatever', now), false);
  });
});

describe('Dashboard state infra — D14 caches, D8 zones, D17 prefs defaults (state.mjs)', () => {
  it('defaults memoized derived caches, new focus-zone cursors, and prefs', () => {
    assert.deepEqual(appState.dashboardTopRepos, []);
    assert.deepEqual(appState.dashboardLangHistogram, []);
    assert.deepEqual(appState.dashboardTotals, { stars: 0, forks: 0, languages: 0 });
    assert.equal(appState.dashboardTopSelected, 0);
    assert.equal(appState.dashboardTopScroll, 0);
    assert.equal(appState.dashboardStaleSelected, 0);
    assert.equal(appState.dashboardStaleScroll, 0);
    assert.deepEqual(appState.dashboardHidden, []);
    assert.equal(appState.dashboardQuickActions, true);
  });

  it('isDashboardHidden defaults to false and reflects dashboardHidden', () => {
    appState.dashboardHidden = [];
    assert.equal(isDashboardHidden('trending'), false);
    appState.dashboardHidden = ['trending'];
    assert.equal(isDashboardHidden('trending'), true);
    assert.equal(isDashboardHidden('events'), false);
  });

  it('resetAccountState clears derived caches and zone cursors', () => {
    const savedToken = appState.token;
    const savedUser = appState.user;
    try {
      appState.dashboardTopRepos = [{ full_name: 'me/alpha' }];
      appState.dashboardLangHistogram = [['JavaScript', 2]];
      appState.dashboardTotals = { stars: 9, forks: 1, languages: 2 };
      appState.dashboardTopSelected = 3;
      appState.dashboardTopScroll = 2;
      appState.dashboardStaleSelected = 1;
      appState.dashboardStaleScroll = 1;
      resetAccountState();
      assert.deepEqual(appState.dashboardTopRepos, []);
      assert.deepEqual(appState.dashboardLangHistogram, []);
      assert.deepEqual(appState.dashboardTotals, { stars: 0, forks: 0, languages: 0 });
      assert.equal(appState.dashboardTopSelected, 0);
      assert.equal(appState.dashboardTopScroll, 0);
      assert.equal(appState.dashboardStaleSelected, 0);
      assert.equal(appState.dashboardStaleScroll, 0);
    } finally {
      appState.token = savedToken;
      appState.user = savedUser;
    }
  });
});

describe('Dashboard star history basics (D1 regression cover)', () => {
  // NOTE: sparkline() and sparkCharsAccessible() are module-private in
  // dashboard.mjs (not exported), so cover the exported buildStarHistory()
  // semantics instead: outgoing starred repos bucketed per day.
  it('returns [] for empty input', () => {
    assert.deepEqual(buildStarHistory([]), []);
  });

  it('buckets a repo starred today into the trailing slot', () => {
    const history = buildStarHistory([{ starred_at: new Date().toISOString() }]);
    assert.equal(history.length, 30);
    assert.equal(history[29], 1);
    assert.equal(history.slice(0, 29).reduce((a, b) => a + b, 0), 0);
  });

  it('ignores entries older than 30 days and entries without dates', () => {
    const old = new Date(Date.now() - 60 * 86400000).toISOString();
    const history = buildStarHistory([{ starred_at: old }, { full_name: 'x/y' }]);
    assert.equal(history.length, 30);
    assert.equal(history.reduce((a, b) => a + b, 0), 0);
  });
});

describe('Dashboard attention CI source (D5 regression cover)', () => {
  it('getNeedsAttention prefers actionsFailures over actionsRuns', () => {
    appState.actionsFailures = [{ conclusion: 'failure', repo: 'o/r' }];
    appState.actionsRuns = [];
    appState.repos = [];
    appState.notifications = [];
    appState.localRepo = null;
    appState.localRepoFilter = false;
    const items = getNeedsAttention();
    assert.ok(items.some((i) => i.id === 'ci'), 'expected a CI item from actionsFailures');
  });
});
