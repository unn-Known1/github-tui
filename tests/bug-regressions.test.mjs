import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cacheKeyFor, encodeRepoPath, downloadToFile } from '../tui/github.mjs';
import { appState } from '../tui/state.mjs';
import { CONFIG_DIR } from '../tui/config.mjs';
import { existsSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { getSelectedNotification } from '../tui/tabs/inbox.mjs';
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
