import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { appState } from '../tui/state.mjs';
import {
  buildHeatmap,
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
