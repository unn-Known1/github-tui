// Tests for collapsible Settings sections: defaults (auth + about open),
// cursor/mouse following collapsed state, and z/Z section keys.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { appState, tabState } from '../tui/state.mjs';
import { handleKey } from '../tui/keys.mjs';
import { handleMouseEvent } from '../tui/mouse.mjs';
import * as settings from '../tui/tabs/settings.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const flush = () => new Promise(r => setImmediate(r));

function stubScreen(w = 100, h = 30) {
  return {
    width: w, height: h, writes: [],
    styleBuf: Array.from({ length: h }, () => new Array(w).fill(null)),
    writeStr(x, y, s) { this.writes.push([y, String(s)]); },
    hline() {}, box() {}, setCell() {},
  };
}

const writes = (s) => s.writes.map(w => w[1]).join('\n');

let savedTab;
let savedCollapsed;
let savedCursor;
let savedInit;

beforeEach(async () => {
  savedTab = tabState.current;
  savedCollapsed = { ...appState.collapsed };
  savedCursor = appState.settingsCursor;
  savedInit = appState._settingsCollapseInit;
  tabState.current = 6;
  appState.showPalette = false;
  appState.showHelp = false;
  appState.showBookmarks = false;
  appState.showDetail = false;
  appState.showOnboarding = false;
  appState.showWelcome = false;
  appState.confirmAction = null;
  appState.inputMode = null;
  appState._sectionHeaders = {};
  appState._lastClickTime = 0;
  await sleep(20); // clear the handleKey repeat debouncer
});

afterEach(() => {
  appState.collapsed = savedCollapsed;
  appState.settingsCursor = savedCursor;
  appState._settingsCollapseInit = savedInit;
  tabState.current = savedTab;
  appState.showBookmarks = false;
  appState._lastClickTime = 0;
});

describe('collapse defaults', () => {
  it('opens auth + about, collapses the rest on a fresh state', () => {
    for (const k of settings.SETTINGS_SECTIONS) delete appState.collapsed[k];
    settings.applySettingsCollapseDefaults();
    assert.equal(appState.collapsed['settings:auth'], undefined);
    assert.equal(appState.collapsed['settings:about'], undefined);
    assert.equal(appState.collapsed['settings:data'], true);
    assert.equal(appState.collapsed['settings:appearance'], true);
    assert.equal(appState.collapsed['settings:integrations'], true);
    assert.equal(appState.collapsed['settings:danger'], true);
  });

  it('never overrides an explicit user toggle', () => {
    appState.collapsed['settings:data'] = false; // user expanded it once
    appState.collapsed['settings:auth'] = true; // user collapsed it once
    settings.applySettingsCollapseDefaults();
    assert.equal(appState.collapsed['settings:data'], false);
    assert.equal(appState.collapsed['settings:auth'], true);
  });
});

describe('section mapping', () => {
  it('exposes all six sections', () => {
    assert.deepEqual(settings.getSections(), [
      'settings:auth', 'settings:data', 'settings:appearance',
      'settings:integrations', 'settings:danger', 'settings:about',
    ]);
  });

  it('maps cursors to their section', () => {
    const cases = [[0, 'auth'], [2, 'auth'], [3, 'data'], [5, 'data'], [6, 'appearance'],
      [9, 'integrations'], [13, 'integrations'], [7, 'danger'], [14, 'danger'], [8, 'about']];
    for (const [cursor, sec] of cases) {
      appState.settingsCursor = cursor;
      assert.equal(settings.getCurrentSection(), 'settings:' + sec, 'cursor ' + cursor);
    }
  });
});

describe('cursor follows collapsed state', () => {
  let savedToken;
  beforeEach(() => {
    // Deterministic enabled-map regardless of machine login state.
    savedToken = appState.token;
    appState.token = 'test-token';
    appState._maxSettingsCursor = 14; // normally set by renderSettings
  });
  afterEach(() => { appState.token = savedToken; });

  it('down() skips a collapsed section', () => {
    appState.collapsed['settings:data'] = true;
    appState.settingsCursor = 2;
    settings.down();
    assert.equal(appState.settingsCursor, 6, 'must land past hidden 3/4/5');
  });

  it('up() skips a collapsed section', () => {
    appState.collapsed['settings:data'] = true;
    appState.settingsCursor = 6;
    settings.up();
    assert.equal(appState.settingsCursor, 2);
  });

  it('enter() on a hidden row relocates instead of firing', () => {
    appState.collapsed['settings:data'] = true;
    appState.settingsCursor = 3;
    settings.enter(); // guard relocates to 2 before the switch
    assert.equal(appState.settingsCursor, 2, 'must land on a visible row');
  });
});

describe('rendering with collapsed sections', () => {
  it('hides collapsed rows but keeps auth + about reachable', () => {
    for (const k of settings.SETTINGS_SECTIONS) delete appState.collapsed[k];
    appState._settingsCollapseInit = false; // exercise the lazy-default path
    appState.settingsCursor = 1;
    const s = stubScreen();
    settings.renderSettings(s, 0, 30);
    const text = writes(s);
    assert.match(text, /Login \(PAT\)/, 'auth rows paint');
    assert.match(text, /Star this repo|Starred!/, 'about star row paints');
    assert.ok(!text.includes('Refresh Dashboard'), 'collapsed data rows hide');
    assert.ok(!text.includes('Change Theme'), 'collapsed appearance rows hide');
    for (const sec of settings.SETTINGS_SECTIONS) {
      assert.ok(appState._sectionHeaders[sec], sec + ' header published for mouse');
    }
  });
});

describe('mouse + keys on section headers', () => {
  it('clicking a header toggles its section', () => {
    appState.collapsed['settings:data'] = false;
    settings.renderSettings(stubScreen(), 0, 30);
    const h = appState._sectionHeaders['settings:data'];
    assert.ok(h, 'no data header published');
    handleMouseEvent({ button: 0, col: h.x + 1, row: h.y + 1, pressed: true });
    assert.equal(appState.collapsed['settings:data'], true, 'click collapses');
  });

  it('z collapses the current section on the Settings tab', async () => {
    appState.collapsed['settings:auth'] = false;
    appState.settingsCursor = 1;
    handleKey('z');
    await flush();
    assert.equal(appState.collapsed['settings:auth'], true);
  });
});
