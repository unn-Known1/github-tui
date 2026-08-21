import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cacheKeyFor, encodeRepoPath, downloadToFile } from '../tui/github.mjs';
import { appState } from '../tui/state.mjs';
import { CONFIG_DIR } from '../tui/config.mjs';
import { existsSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { getSelectedNotification, getFilteredNotifications, normalizeInboxCursor } from '../tui/tabs/inbox.mjs';
import { isSettingsCursorEnabled, down as settingsDown } from '../tui/tabs/settings.mjs';
import { rawFileUrl } from '../tui/tabs/files.mjs';
import { securityStateOptions } from '../tui/tabs/analyze-security.mjs';
import { Screen } from '../tui/screen.mjs';
import * as onboarding from '../tui/tabs/onboarding.mjs';

describe('audit regressions', () => {
  it('partitions API cache keys by account and response representation', () => {
    const a = cacheKeyFor('GET', '/user', null, false, 'token-a');
    const b = cacheKeyFor('GET', '/user', null, false, 'token-b');
    const raw = cacheKeyFor('GET', '/user', 'application/vnd.github.raw', true, 'token-a');
    assert.notEqual(a, b);
    assert.notEqual(a, raw);
    assert.match(a, /^v2:/);
    assert.equal(cacheKeyFor('GET', '/user', null, false, 'token-a'), a);
  });

  it('encodes each repository path segment without changing separators', () => {
    assert.equal(encodeRepoPath('src/my file#1.js'), 'src/my%20file%231.js');
    assert.equal(encodeRepoPath('docs/a/b.md'), 'docs/a/b.md');
  });

  it('rejects non-HTTPS downloads before creating a destination', async () => {
    await assert.rejects(
      downloadToFile('http://example.test/archive.zip', '/tmp/github-tui-invalid-download.zip'),
      /HTTPS/,
    );
  });

  it('uses the filtered Inbox item for the global selection helper', () => {
    const saved = {
      notifications: appState.notifications,
      inboxFilter: appState.inboxFilter,
      inboxTextFilter: appState.inboxTextFilter,
      selectedNotification: appState.selectedNotification,
    };
    try {
      appState.notifications = [
        { id: 'all-1', unread: false, reason: 'subscribed', subject: { title: 'read' } },
        { id: 'unread-1', unread: true, reason: 'mention', subject: { title: 'unread' } },
      ];
      appState.inboxFilter = 'unread';
      appState.inboxTextFilter = '';
      appState.selectedNotification = 0;
      assert.equal(getSelectedNotification().id, 'unread-1');
    } finally {
      Object.assign(appState, saved);
    }
  });

  it('keeps PAT login reachable when GitHub CLI is unavailable', () => {
    const saved = { token: appState.token, settingsCursor: appState.settingsCursor, max: appState._maxSettingsCursor };
    try {
      appState.token = null;
      appState.settingsCursor = 0;
      appState._maxSettingsCursor = 8;
      assert.equal(isSettingsCursorEnabled(0, false), false);
      assert.equal(isSettingsCursorEnabled(1, false), true);
      settingsDown();
      assert.equal(appState.settingsCursor, 1);
    } finally {
      Object.assign(appState, saved);
    }
  });

  it('clamps Inbox selection and scroll after a filter mutation', () => {
    const saved = {
      notifications: appState.notifications,
      inboxFilter: appState.inboxFilter,
      inboxHideProcessed: appState.inboxHideProcessed,
      inboxScroll: appState.inboxScroll,
      selectedNotification: appState.selectedNotification,
      inboxListBounds: appState._inboxListBounds,
    };
    try {
      appState.notifications = [
        { id: 'a', unread: true, subject: { title: 'a' } },
        { id: 'b', unread: false, subject: { title: 'b' } },
      ];
      appState.inboxFilter = 'all';
      appState.inboxHideProcessed = false;
      appState._inboxListBounds = { rowStart: 10, maxRows: 1, length: 2 };
      appState.inboxScroll = 1;
      appState.selectedNotification = 1;
      appState.inboxFilter = 'unread';
      normalizeInboxCursor();
      assert.equal(appState.selectedNotification, 0);
      assert.equal(appState.inboxScroll, 0);
    } finally {
      appState.notifications = saved.notifications;
      appState.inboxFilter = saved.inboxFilter;
      appState.inboxHideProcessed = saved.inboxHideProcessed;
      appState.inboxScroll = saved.inboxScroll;
      appState.selectedNotification = saved.selectedNotification;
      appState._inboxListBounds = saved.inboxListBounds;
    }
  });

  it('applies Inbox status, local-repo, and text filters as one view model', () => {
    const saved = {
      notifications: appState.notifications,
      inboxFilter: appState.inboxFilter,
      inboxTextFilter: appState.inboxTextFilter,
      localRepo: appState.localRepo,
      localRepoFilter: appState.localRepoFilter,
    };
    try {
      appState.notifications = [
        { id: 'keep', unread: true, reason: 'mention', subject: { title: 'deploy' }, repository: { full_name: 'me/app' } },
        { id: 'hide', unread: true, reason: 'mention', subject: { title: 'docs' }, repository: { full_name: 'me/app' } },
        { id: 'other', unread: true, reason: 'mention', subject: { title: 'deploy' }, repository: { full_name: 'me/other' } },
      ];
      appState.inboxFilter = 'unread';
      appState.inboxTextFilter = 'deploy';
      appState.localRepo = { owner: 'me', repo: 'app' };
      appState.localRepoFilter = true;
      assert.deepEqual(getFilteredNotifications().map(n => n.id), ['keep']);
    } finally {
      Object.assign(appState, saved);
    }
  });

  it('builds raw file URLs with encoded path segments and refs', () => {
    assert.equal(rawFileUrl('me', 'repo', 'feature/ui', 'src/my file#1.js'),
      'https://raw.githubusercontent.com/me/repo/feature/ui/src/my%20file%231.js');
  });

  it('uses security state vocabularies supported by each sub-pane', () => {
    assert.deepEqual(securityStateOptions('secret'), ['open', 'resolved', 'all']);
    assert.deepEqual(securityStateOptions('branch'), []);
  });

  it('diffs equivalent freshly-created styles instead of repainting them', () => {
    const screen = new Screen();
    screen.width = 4;
    screen.height = 2;
    screen._init();
    const writes = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = (value) => { writes.push(String(value)); return true; };
    try {
      screen.setCell(0, 0, 'x', { fg: 'cyan', bold: true });
      screen.render();
      const firstWriteCount = writes.length;
      screen.setCell(0, 0, 'x', { fg: 'cyan', bold: true });
      screen.render();
      assert.equal(writes.length, firstWriteCount);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('opens the What\'s New flow on the release-notes step and marks it seen on Enter', () => {
    const saved = {
      showWelcome: appState.showWelcome,
      showOnboarding: appState.showOnboarding,
      lastSeenVersion: appState.lastSeenVersion,
    };
    const marker = join(CONFIG_DIR, '.welcome-seen');
    const markerExisted = existsSync(marker);
    const configExisted = existsSync(CONFIG_DIR);
    const markerContents = markerExisted ? readFileSync(marker) : null;
    try {
      appState.showOnboarding = false;
      appState.showWelcome = false;
      appState.lastSeenVersion = null;
      onboarding.startWelcome();
      assert.equal(appState.showWelcome, true);
      onboarding.handleOnboardingKey('\r');
      assert.equal(appState.showWelcome, false);
      assert.equal(typeof appState.lastSeenVersion, 'string');
    } finally {
      Object.assign(appState, saved);
      try {
        if (markerExisted) writeFileSync(marker, markerContents);
        else unlinkSync(marker);
        if (!configExisted) rmdirSync(CONFIG_DIR);
      } catch {}
    }
  });
});
