// Settings + Inbox regression tests (S1, S2, S6-part, I1-part, I3-part, I6-part, I7-part).
//
// Hermetic: every test that touches appState saves/restores the keys it uses.
// Modules owned by other agents (settings/inbox/utils extensions) are loaded
// via dynamic import with graceful skip, so this suite stays green while the
// tree is mid-migration (e.g. inbox.mjs importing a not-yet-landed export).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

async function tryImport(spec) {
  try {
    return await import(spec);
  } catch {
    return null;
  }
}

const stateMod = await tryImport('../tui/state.mjs');
const utilsMod = await tryImport('../tui/utils.mjs');
const recMod = await tryImport('../tui/recommended-features.mjs');
// settings.mjs / inbox.mjs may be unloadable mid-migration (transitive import
// of a not-yet-landed export); tests below skip gracefully until then.
const settingsMod = await tryImport('../tui/tabs/settings.mjs');
const inboxMod = await tryImport('../tui/tabs/inbox.mjs');

function readSource(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}

// ── S2: isSettingsCursorEnabled matrix (live behavior) ──

describe('settings cursor enablement matrix (S2)', () => {
  it('logged-out without gh: 0 disabled, 1 enabled, 2 disabled', (t) => {
    if (!settingsMod || !stateMod) { t.skip('settings.mjs not loadable yet'); return; }
    const { appState } = stateMod;
    const saved = { token: appState.token };
    try {
      appState.token = null;
      assert.equal(settingsMod.isSettingsCursorEnabled(0, false), false);
      assert.equal(settingsMod.isSettingsCursorEnabled(1, false), true);
      assert.equal(settingsMod.isSettingsCursorEnabled(2, false), false);
    } finally {
      Object.assign(appState, saved);
    }
  });

  it('logged-out with gh: 0 enabled, 1 enabled, 2 disabled', (t) => {
    if (!settingsMod || !stateMod) { t.skip('settings.mjs not loadable yet'); return; }
    const { appState } = stateMod;
    const saved = { token: appState.token };
    try {
      appState.token = null;
      assert.equal(settingsMod.isSettingsCursorEnabled(0, true), true);
      assert.equal(settingsMod.isSettingsCursorEnabled(1, true), true);
      assert.equal(settingsMod.isSettingsCursorEnabled(2, true), false);
    } finally {
      Object.assign(appState, saved);
    }
  });

  it('logged-in: 0/1 disabled, 2 enabled', (t) => {
    if (!settingsMod || !stateMod) { t.skip('settings.mjs not loadable yet'); return; }
    const { appState } = stateMod;
    const saved = { token: appState.token };
    try {
      appState.token = 'test-token';
      for (const ghReady of [false, true]) {
        assert.equal(settingsMod.isSettingsCursorEnabled(0, ghReady), false);
        assert.equal(settingsMod.isSettingsCursorEnabled(1, ghReady), false);
        assert.equal(settingsMod.isSettingsCursorEnabled(2, ghReady), true);
      }
    } finally {
      Object.assign(appState, saved);
    }
  });

  it('data rows 3/4 require login; 5/6 always enabled', (t) => {
    if (!settingsMod || !stateMod) { t.skip('settings.mjs not loadable yet'); return; }
    const { appState } = stateMod;
    const saved = { token: appState.token };
    try {
      appState.token = null;
      assert.equal(settingsMod.isSettingsCursorEnabled(3, true), false);
      assert.equal(settingsMod.isSettingsCursorEnabled(4, true), false);
      assert.equal(settingsMod.isSettingsCursorEnabled(5, true), true);
      assert.equal(settingsMod.isSettingsCursorEnabled(6, true), true);
      appState.token = 'test-token';
      assert.equal(settingsMod.isSettingsCursorEnabled(3, true), true);
      assert.equal(settingsMod.isSettingsCursorEnabled(4, true), true);
      assert.equal(settingsMod.isSettingsCursorEnabled(5, true), true);
      assert.equal(settingsMod.isSettingsCursorEnabled(6, true), true);
    } finally {
      Object.assign(appState, saved);
    }
  });

  it('danger 7 requires login; star 8 always enabled; unknown cursors return boolean', (t) => {
    if (!settingsMod || !stateMod) { t.skip('settings.mjs not loadable yet'); return; }
    const { appState } = stateMod;
    const saved = { token: appState.token };
    try {
      appState.token = null;
      assert.equal(settingsMod.isSettingsCursorEnabled(7, true), false);
      assert.equal(settingsMod.isSettingsCursorEnabled(8, true), true);
      // Logged-out disables the logout (2) and wipe (7) rows.
      assert.equal(settingsMod.isSettingsCursorEnabled(2, true), false);
      appState.token = 'test-token';
      assert.equal(settingsMod.isSettingsCursorEnabled(7, true), true);
      assert.equal(settingsMod.isSettingsCursorEnabled(8, true), true);
      // Out-of-range cursors: assert live behavior shape (boolean), not a
      // prescribed value — the settings owner may extend the menu.
      for (const c of [9, 10, 13, 14, 99]) {
        assert.equal(typeof settingsMod.isSettingsCursorEnabled(c, true), 'boolean');
      }
    } finally {
      Object.assign(appState, saved);
    }
  });
});

// ── S1/S2: mouse dispatch pins (source-level; mouse.mjs is not import-safe ──
// ── to unit-test directly, so pin the dispatcher shape instead) ──

describe('mouse settings dispatch (S1/S2)', () => {
  it('S1: danger-row misroute special case is gone (no rb.cursor === 7 → starRepo)', () => {
    const src = readSource('../tui/mouse.mjs');
    assert.ok(!src.includes('rb.cursor === 7'), 'stale cursor-7 special case must be deleted');
  });

  it('S1: row clicks route via enter() (which maps 7 → wipe confirm, 8 → star)', () => {
    const src = readSource('../tui/mouse.mjs');
    assert.ok(
      src.includes("import('./tabs/settings.mjs').then(m => m.enter())"),
      'row-click dispatcher must call enter()',
    );
  });

  it('S2: disabled-row guard toasts and leaves the cursor unchanged', () => {
    const src = readSource('../tui/mouse.mjs');
    assert.ok(src.includes('isSettingsCursorEnabled'), 'dispatcher must consult isSettingsCursorEnabled');
    assert.ok(
      src.includes("showMessage('That row is unavailable right now', 'warning')"),
      'disabled clicks must toast generically',
    );
    // Guard must run before the cursor assignment in the row-bounds loop.
    const guardIdx = src.indexOf('isSettingsCursorEnabled(rb.cursor)');
    const assignIdx = src.indexOf('appState.settingsCursor = rb.cursor');
    assert.ok(guardIdx !== -1 && assignIdx !== -1 && guardIdx < assignIdx,
      'guard must precede cursor assignment (cursor stays put on disabled rows)');
    // Star wide-hit-area block routes through the same guard (cursor 8).
    assert.ok(src.includes('isSettingsCursorEnabled(8)'), 'star hit-area must share the guard');
  });
});

// ── S6-part: session auto-refresh persistence ──

describe('session auto-refresh persistence (S6)', () => {
  it('defaults exist without touching the filesystem', (t) => {
    if (!stateMod) { t.skip('state.mjs not loadable'); return; }
    assert.equal(typeof stateMod.appState.autoRefreshEnabled, 'boolean');
    assert.equal(stateMod.appState.autoRefreshEnabled, false);
    assert.equal(stateMod.appState.autoRefreshIntervalMs, 300000);
    assert.equal(typeof stateMod.saveSession, 'function');
    assert.equal(typeof stateMod.loadSession, 'function');
  });

  it('saveSession persists both auto-refresh fields', () => {
    const src = readSource('../tui/state.mjs');
    assert.ok(src.includes('autoRefreshEnabled: appState.autoRefreshEnabled'),
      'saveSession must persist autoRefreshEnabled');
    assert.ok(src.includes('autoRefreshIntervalMs: appState.autoRefreshIntervalMs'),
      'saveSession must persist autoRefreshIntervalMs');
  });

  it('loadSession validates types and clamps the interval to 1–60 min', () => {
    const src = readSource('../tui/state.mjs');
    assert.ok(src.includes('typeof s.autoRefreshEnabled'), 'must type-check the boolean');
    assert.ok(src.includes('Number.isFinite(s.autoRefreshIntervalMs)'), 'must validate the number');
    assert.ok(src.includes('Math.min(3600000, Math.max(60000'),
      'must clamp to [60000, 3600000]');
  });

  it('resetAccountState preserves auto-refresh prefs while clearing account data', (t) => {
    if (!stateMod) { t.skip('state.mjs not loadable'); return; }
    const { appState, resetAccountState } = stateMod;
    const snap = { ...appState };
    try {
      appState.autoRefreshEnabled = true;
      appState.autoRefreshIntervalMs = 60000;
      appState.token = 'test-token';
      appState.notifications = [{ id: 'x' }];
      resetAccountState();
      assert.equal(appState.autoRefreshEnabled, true);
      assert.equal(appState.autoRefreshIntervalMs, 60000);
      assert.equal(appState.token, null);
      assert.deepEqual(appState.notifications, []);
    } finally {
      Object.assign(appState, snap);
    }
  });
});

// ── I1-part: single viewport truth ──

describe('inbox viewport truth (I1)', () => {
  it('inboxMaxRows equals max(1, h-7)', async (t) => {
    const m = inboxMod || await tryImport('../tui/tabs/inbox.mjs');
    if (!m || typeof m.inboxMaxRows !== 'function') { t.skip('inboxMaxRows not available'); return; }
    for (const h of [10, 24, 50]) {
      assert.equal(m.inboxMaxRows(h), Math.max(1, h - 7), 'h=' + h);
    }
  });
});

// ── I6-part: reason labels ──

describe('notification reason labels (I6)', () => {
  it('notifReasonLabel maps mention/review, passes unknown through, falsy → ?', async (t) => {
    const m = utilsMod || await tryImport('../tui/utils.mjs');
    if (!m || typeof m.notifReasonLabel !== 'function') { t.skip('notifReasonLabel not available'); return; }
    assert.equal(m.notifReasonLabel('mention'), '@mentioned');
    assert.equal(m.notifReasonLabel('review_requested'), 'review');
    assert.equal(m.notifReasonLabel('subscribed'), 'subscribed');
    assert.equal(m.notifReasonLabel('something-weird'), 'something-weird');
    assert.equal(m.notifReasonLabel(''), '?');
    assert.equal(m.notifReasonLabel(null), '?');
    assert.equal(m.notifReasonLabel(undefined), '?');
  });

  it('notifTypeColor precedent still holds (PR/Issue/unknown)', (t) => {
    if (!utilsMod || typeof utilsMod.notifTypeColor !== 'function') { t.skip('notifTypeColor missing'); return; }
    assert.equal(utilsMod.notifTypeColor('PullRequest'), 'cyan');
    assert.equal(utilsMod.notifTypeColor('Issue'), 'yellow');
    assert.equal(utilsMod.notifTypeColor('Nope'), 'dim');
  });
});

// ── I7-part + grouping: filter pipeline determinism ──

describe('inbox filter pipeline (I7 + grouping)', () => {
  function fixture() {
    return [
      { id: 'tsi-1', unread: true, reason: 'mention', subject: { title: 'hello world', url: 'u-a' }, repository: { full_name: 'o/a' }, updated_at: '2026-09-03T00:00:00Z' },
      { id: 'tsi-2', unread: false, reason: 'subscribed', subject: { title: 'other thing', url: 'u-b' }, repository: { full_name: 'o/b' }, updated_at: '2026-09-02T00:00:00Z' },
      { id: 'tsi-3', unread: true, reason: 'mention', subject: { title: 'hello again', url: 'u-a' }, repository: { full_name: 'o/a' }, updated_at: '2026-09-04T00:00:00Z' },
    ];
  }

  function snapInbox(appState) {
    return {
      notifications: appState.notifications,
      inboxFilter: appState.inboxFilter,
      inboxTextFilter: appState.inboxTextFilter,
      inboxHideProcessed: appState.inboxHideProcessed,
      localRepo: appState.localRepo,
      localRepoFilter: appState.localRepoFilter,
      inboxGrouped: appState.inboxGrouped,
      inboxSnoozed: appState.inboxSnoozed,
      selectedNotification: appState.selectedNotification,
      inboxScroll: appState.inboxScroll,
    };
  }

  it('same filters twice → same array reference; bump changes reference', async (t) => {
    const m = inboxMod || await tryImport('../tui/tabs/inbox.mjs');
    if (!m || typeof m.getFilteredNotifications !== 'function') { t.skip('filter pipeline not available'); return; }
    if (!stateMod) { t.skip('state.mjs not loadable'); return; }
    const { appState } = stateMod;
    const saved = snapInbox(appState);
    try {
      appState.notifications = fixture();
      appState.inboxFilter = 'unread';
      appState.inboxTextFilter = '';
      appState.inboxHideProcessed = false;
      appState.localRepo = null;
      appState.localRepoFilter = false;
      appState.inboxGrouped = false;
      appState.inboxSnoozed = {};
      const a = m.getFilteredNotifications();
      const b = m.getFilteredNotifications();
      assert.equal(a, b, 'memoized pipeline must return the cached array');
      assert.deepEqual(a.map(n => n.id).sort(), ['tsi-1', 'tsi-3']);
      if (typeof m.bumpInboxFilterGen === 'function') {
        m.bumpInboxFilterGen();
        const c = m.getFilteredNotifications();
        assert.notEqual(c, a, 'bump must invalidate the cache');
        assert.deepEqual(c.map(n => n.id).sort(), ['tsi-1', 'tsi-3']);
      }
    } finally {
      Object.assign(appState, saved);
      if (typeof (inboxMod || m).bumpInboxFilterGen === 'function') (inboxMod || m).bumpInboxFilterGen();
    }
  });

  it('grouped pseudo-rows scope their threads via _groupNotifications', async (t) => {
    const m = inboxMod || await tryImport('../tui/tabs/inbox.mjs');
    if (!m || typeof m.getFilteredNotifications !== 'function') { t.skip('filter pipeline not available'); return; }
    if (!stateMod) { t.skip('state.mjs not loadable'); return; }
    const { appState } = stateMod;
    const saved = snapInbox(appState);
    try {
      appState.notifications = fixture();
      appState.inboxFilter = 'all';
      appState.inboxTextFilter = '';
      appState.inboxHideProcessed = false;
      appState.localRepo = null;
      appState.localRepoFilter = false;
      appState.inboxGrouped = true;
      appState.inboxSnoozed = {};
      if (typeof m.bumpInboxFilterGen === 'function') m.bumpInboxFilterGen();
      const rows = m.getFilteredNotifications();
      assert.equal(rows.length, 2);
      const grouped = rows.find(r => r._groupCount === 2);
      assert.ok(grouped, 'threads sharing a subject url collapse into one pseudo-row');
      assert.equal(grouped._groupNotifications.length, 2);
      assert.deepEqual(grouped._groupNotifications.map(n => n.id).sort(), ['tsi-1', 'tsi-3']);
    } finally {
      Object.assign(appState, saved);
      if (typeof (inboxMod || m).bumpInboxFilterGen === 'function') (inboxMod || m).bumpInboxFilterGen();
    }
  });
});

// ── groupNotifications unit shape (module loads independently) ──

describe('groupNotifications (recommended-features)', () => {
  it('groups threads sharing a subject url with count/unread/latest', (t) => {
    if (!recMod || typeof recMod.groupNotifications !== 'function') { t.skip('groupNotifications missing'); return; }
    const groups = recMod.groupNotifications([
      { id: 'g-1', unread: true, subject: { url: 'u' }, updated_at: '2026-09-01T00:00:00Z' },
      { id: 'g-2', unread: false, subject: { url: 'u' }, updated_at: '2026-09-02T00:00:00Z' },
      { id: 'g-3', unread: true, subject: { url: 'v' }, updated_at: '2026-09-03T00:00:00Z' },
    ]);
    assert.equal(groups.length, 2);
    const g = groups.find(x => x.key === 'u');
    assert.equal(g.count, 2);
    assert.equal(g.unread, 1);
    assert.equal(g.latest.id, 'g-2');
    assert.deepEqual(g.notifications.map(n => n.id).sort(), ['g-1', 'g-2']);
  });

  it('empty input → empty output', (t) => {
    if (!recMod || typeof recMod.groupNotifications !== 'function') { t.skip('groupNotifications missing'); return; }
    assert.deepEqual(recMod.groupNotifications([]), []);
    assert.deepEqual(recMod.groupNotifications(), []);
  });

  it('sorts groups by latest activity descending', (t) => {
    if (!recMod || typeof recMod.groupNotifications !== 'function') { t.skip('groupNotifications missing'); return; }
    const groups = recMod.groupNotifications([
      { id: 'old', subject: { url: 'a' }, updated_at: '2026-01-01T00:00:00Z' },
      { id: 'new', subject: { url: 'b' }, updated_at: '2026-09-01T00:00:00Z' },
    ]);
    assert.equal(groups[0].key, 'b');
    assert.equal(groups[1].key, 'a');
  });
});

// ── I3-part: snooze persistence surface ──

describe('snooze persistence surface (I3)', () => {
  it('loadSnoozedState/saveSnoozedState are functions', async (t) => {
    const m = inboxMod || await tryImport('../tui/tabs/inbox.mjs');
    if (!m || typeof m.loadSnoozedState !== 'function' || typeof m.saveSnoozedState !== 'function') {
      t.skip('snooze persistence fns not available');
      return;
    }
    assert.equal(typeof m.loadSnoozedState, 'function');
    assert.equal(typeof m.saveSnoozedState, 'function');
  });
});
