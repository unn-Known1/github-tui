// Tests for Local-tab shortcut ownership (§6.8) + which-key stub prune.
// Rule under test: with the Local tab (key 6) focused, every owned footer key must reach
// local.keys — never a Which-Key popup, never a global (bookmarks,
// expand-all, copy-URL...). local.keys entries are monkey-patched with
// flags so the test is hermetic (no git, no clipboard, no timers).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { appState, tabState } from '../tui/state.mjs';
import { handleKey } from '../tui/keys.mjs';
import { keys as localKeys } from '../tui/tabs/local.mjs';
import * as whichKey from '../tui/which-key.mjs';

// Keys Local owns per LOCAL_OWNED in keys.mjs (single-press actions).
const OWNED = ['a', 'A', 'X', 'c', 'C', 'f', 'p', 'P', 'B', 'b', 'y', 'o', '[', ']', 'g', 'G'];

let savedTab;
let savedFns;
let fired;

beforeEach(() => {
  savedTab = tabState.current;
  tabState.current = 5;
  // Clean overlay/modal state so handleKey reaches tab dispatch.
  appState.showPalette = false;
  appState.showHelp = false;
  appState.showBookmarks = false;
  appState.showDetail = false;
  appState.showOnboarding = false;
  appState.showWelcome = false;
  appState.confirmAction = null;
  appState.inputMode = null;
  if (whichKey.isOpen()) whichKey.close();
  fired = {};
  savedFns = {};
  for (const k of OWNED) {
    savedFns[k] = localKeys[k];
    localKeys[k] = () => { fired[k] = true; };
  }
});

afterEach(() => {
  for (const k of OWNED) localKeys[k] = savedFns[k];
  if (whichKey.isOpen()) whichKey.close();
  tabState.current = savedTab;
  appState.showBookmarks = false;
});

describe('Local tab owns its shortcuts (§6.8)', () => {
  for (const k of OWNED) {
    it(`'${k}' reaches local.keys on the Local tab (no popup, no hijack)`, async () => {
      handleKey(k);
      // handleKey dispatches per-tab handlers through Promise.resolve() —
      // flush before asserting.
      await new Promise(r => setImmediate(r));
      assert.equal(fired[k], true, `local.keys['${k}'] did not fire`);
      assert.equal(whichKey.isOpen(), false, 'Which-Key trapped the key');
      assert.equal(tabState.current, 5, 'tab switched unexpectedly');
      assert.equal(appState.showBookmarks, false, 'bookmarks browser opened');
    });
  }

  it('does not collapse sections as a side effect (X is discard, not expand-all)', async () => {
    appState.collapsed['local:staged'] = true;
    handleKey('X');
    await new Promise(r => setImmediate(r));
    assert.equal(fired.X, true);
    assert.equal(appState.collapsed['local:staged'], true);
    delete appState.collapsed['local:staged'];
  });
});

describe('which-key stub prune regressions', () => {
  it("Repos 'c' clears filters instead of opening a popup", async () => {
    tabState.current = 1;
    appState.reposView = 'own';
    appState.repoFilter = 'zzz';
    handleKey('c');
    await new Promise(r => setImmediate(r));
    assert.equal(whichKey.isOpen(), false);
    assert.equal(appState.repoFilter, '');
  });

  it("Inbox 'f' cycles the filter instead of opening a popup", async () => {
    tabState.current = 4;
    appState.inboxFilter = 'all';
    handleKey('f');
    await new Promise(r => setImmediate(r));
    assert.equal(whichKey.isOpen(), false);
    assert.notEqual(appState.inboxFilter, 'all');
    appState.inboxFilter = 'all';
  });

  it("only the functional 'g' prefix group remains", () => {
    assert.equal(whichKey.isPrefixKey('g'), true);
    for (const k of ['c', 'b', 'f', 'z', 'd', 'w']) {
      assert.equal(whichKey.isPrefixKey(k), false, `'${k}' is still a prefix`);
    }
  });
});
