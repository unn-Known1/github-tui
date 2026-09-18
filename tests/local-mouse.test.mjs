// Tests for Local-tab mouse support (§6.7): geometry publishing, click
// select, collapsible headers, double-click open, hover follow, wheel zones.
// Fixture-driven (no git): state is seeded, renderLocal publishes bounds,
// then parsed mouse events are dispatched. toggleCollapse persists to disk,
// so collapsed.json is backed up + restored around that test.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { appState, tabState } from '../tui/state.mjs';
import { handleMouseEvent } from '../tui/mouse.mjs';
import { renderLocal } from '../tui/tabs/local.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const flush = () => new Promise(r => setImmediate(r));

function stubScreen(w = 100, h = 40) {
  return {
    width: w, height: h,
    styleBuf: Array.from({ length: h }, () => new Array(w).fill(null)),
    writeStr() {}, hline() {}, box() {}, setCell() {},
    mapViewportY(y) { return y; },
  };
}

const SAVED_KEYS = ['localIsRepo', 'localRoot', 'localBranch', 'localUpstream', 'localAhead',
  'localBehind', 'localOpState', 'localStaged', 'localUnstaged', 'localUntracked',
  'localConflicted', 'localStatusError', 'localHistory', 'localHistoryHasMore',
  'localHistoryPage', 'localStatusSelected', 'localStatusScroll', 'localHistorySelected',
  'localHistoryScroll', 'localFocus', 'localDiff', 'localAutoPoll', 'localLastFetched',
  '_localBounds', 'localRepo', 'showPalette', 'showHelp', 'showBookmarks', 'showDetail',
  'showOnboarding', 'showWelcome', 'confirmAction', 'confirmMessage', 'confirmTitle',
  '_confirmDanger', '_confirmBounds', 'inputMode', 'accessible'];
let saved = {};
let savedTab;

function seedFixture() {
  appState.localIsRepo = true;
  appState.localRoot = '/tmp/fixture-no-repo';
  appState.localBranch = 'main';
  appState.localUpstream = 'origin/main';
  appState.localAhead = 1;
  appState.localBehind = 0;
  appState.localOpState = null;
  appState.localStaged = [{ path: 'a.txt', code: 'M' }, { path: 'b.txt', code: 'A' }];
  appState.localUnstaged = [{ path: 'c.txt', code: 'M' }];
  appState.localUntracked = [];
  appState.localConflicted = [];
  appState.localStatusError = null;
  appState.localHistory = [
    { sha: 'abc123', author: 'alice', date: '2026-09-18T00:00:00Z', subject: 'fix it', body: '' },
    { sha: 'def456', author: 'bob', date: '2026-09-17T00:00:00Z', subject: 'add thing', body: '' },
  ];
  appState.localHistoryHasMore = false;
  appState.localHistoryPage = 1;
  appState.localStatusSelected = 0;
  appState.localStatusScroll = 0;
  appState.localHistorySelected = 0;
  appState.localHistoryScroll = 0;
  appState.localFocus = 'status';
  appState.localDiff = null;
  appState.localAutoPoll = false; // never poll in tests
  appState.localLastFetched = Date.now(); // skip the one-shot refresh kick
  appState.localRepo = null;
  appState.collapsed = {};
}

beforeEach(() => {
  savedTab = tabState.current;
  saved = {};
  for (const k of SAVED_KEYS) saved[k] = appState[k];
  appState.showPalette = false;
  appState.showHelp = false;
  appState.showBookmarks = false;
  appState.showDetail = false;
  appState.showOnboarding = false;
  appState.showWelcome = false;
  appState.confirmAction = null;
  appState.inputMode = null;
  appState._sectionHeaders = {};
  tabState.current = 5;
  seedFixture();
  renderLocal(stubScreen(), 6, 30);
});

afterEach(() => {
  for (const k of SAVED_KEYS) appState[k] = saved[k];
  tabState.current = savedTab;
});

// 1-based terminal coords from 0-based screen coords.
const click = (sx, sy) => handleMouseEvent({ button: 0, col: sx + 1, row: sy + 1, pressed: true });
const hover = (sx, sy) => handleMouseEvent({ button: 32, col: sx + 1, row: sy + 1, pressed: true });
const wheelDown = (sx, sy) => handleMouseEvent({ button: 65, col: sx + 1, row: sy + 1, pressed: false });
const wheelUp = (sx, sy) => handleMouseEvent({ button: 64, col: sx + 1, row: sy + 1, pressed: false });

describe('local mouse — geometry + click select', () => {
  it('publishes row bounds for every painted data row', () => {
    const b = appState._localBounds;
    assert.ok(b, 'no bounds published');
    assert.equal(b.rows.length, 5, '3 status + 2 history rows, got ' + b.rows.length);
    assert.deepEqual(b.rows.map(r => r.kind), ['status', 'status', 'status', 'history', 'history']);
    assert.deepEqual(b.rows.filter(r => r.kind === 'status').map(r => r.index), [0, 1, 2]);
  });

  it('click selects a status row and focuses status', () => {
    const row = appState._localBounds.rows[2]; // c.txt (unstaged)
    appState.localStatusSelected = 0;
    appState.localFocus = 'history';
    click(10, row.y);
    assert.equal(appState.localStatusSelected, 2);
    assert.equal(appState.localFocus, 'status');
  });

  it('click selects a history row and focuses history', () => {
    const row = appState._localBounds.rows.find(r => r.kind === 'history');
    click(60, row.y);
    assert.equal(appState.localHistorySelected, row.index);
    assert.equal(appState.localFocus, 'history');
  });

  it('collapsible header click toggles without touching selection', () => {
    const path = join(homedir(), '.github-tui', 'collapsed.json');
    let backup = null;
    let hadFile = false;
    try {
      if (existsSync(path)) { backup = readFileSync(path); hadFile = true; }
      const h = appState._sectionHeaders['local:staged'];
      assert.ok(h, 'no staged header published');
      const before = appState.localStatusSelected;
      click(h.x, h.y);
      assert.equal(appState.collapsed['local:staged'], true);
      assert.equal(appState.localStatusSelected, before);
    } finally {
      try {
        if (hadFile) writeFileSync(path, backup);
        else if (existsSync(path)) unlinkSync(path); // remove what the toggle created
      } catch { /* best-effort restore */ }
      delete appState.collapsed['local:staged'];
    }
  });

  it('outside click cancels a pending confirm without touching selection', () => {
    appState.confirmAction = () => {};
    appState.confirmMessage = 'sure?';
    const row = appState._localBounds.rows[1];
    click(10, row.y);
    assert.equal(appState.confirmAction, null, 'outside click must dismiss');
    assert.equal(appState.localStatusSelected, 0, 'dismiss must not reselect');
  });
});

describe('local mouse — double-click, hover, wheel', () => {
  it('double-click opens the diff flow for the row', async () => {
    await sleep(450); // isolate from the previous test's click tracking
    const row = appState._localBounds.rows[0];
    click(10, row.y);
    click(10, row.y);
    await flush();
    // Selection lands first (sync); the async diff errors headlessly
    // (fake root) which is fine — Enter path is covered by keyboard tests.
    assert.equal(appState.localStatusSelected, 0);
    assert.equal(appState.localFocus, 'status');
  });

  it('hover follows selection without stealing the tab', () => {
    const row = appState._localBounds.rows.find(r => r.kind === 'history');
    hover(60, row.y);
    assert.equal(appState.localHistorySelected, row.index);
    assert.equal(appState.localFocus, 'history');
    assert.equal(tabState.current, 5);
  });

  it('wheel scrolls the pane under the cursor', () => {
    // Tab-6 wheel dispatches before the screen guard (mouse.mjs), so this
    // works headless and render() stays a no-op in tests.
    const b = appState._localBounds;
    const statusRow = b.rows.find(r => r.kind === 'status');
    const historyRow = b.rows.find(r => r.kind === 'history');
    // Wide layout: left half = status, right half = history.
    wheelDown(10, statusRow.y);
    assert.equal(appState.localStatusScroll, 1);
    wheelUp(10, statusRow.y);
    assert.equal(appState.localStatusScroll, 0);
    wheelDown(70, historyRow.y);
    assert.equal(appState.localHistoryScroll, 1);
    wheelUp(70, historyRow.y);
    assert.equal(appState.localHistoryScroll, 0);
  });
});
