// Tests for per-file line stats (+added/-deleted on status rows) and the
// guaranteed diff-box slice (Enter/double-click must always paint something).

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { appState, dismissConfirm } from '../tui/state.mjs';
import { parseNumstatZ, numstatArgs } from '../tui/git-local.mjs';
import * as local from '../tui/tabs/local.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const NUL = String.fromCharCode(0);

function stubScreen(w = 100, h = 24) {
  return {
    width: w, height: h, writes: [],
    styleBuf: Array.from({ length: h }, () => new Array(w).fill(null)),
    writeStr(x, y, s) { this.writes.push([y, String(s)]); },
    hline() {}, box() {}, setCell() {},
  };
}

describe('parseNumstatZ', () => {
  it('parses add/del per path', () => {
    const out = parseNumstatZ('4' + '\t' + '0' + '\t' + 'g.txt' + NUL + '0' + '\t' + '3' + '\t' + 'f.txt' + NUL);
    assert.deepEqual(out['g.txt'], { add: 4, del: 0, binary: false });
    assert.deepEqual(out['f.txt'], { add: 0, del: 3, binary: false });
  });
  it('marks binary files', () => {
    const out = parseNumstatZ('-' + '\t' + '-' + '\t' + 'b.bin' + NUL);
    assert.deepEqual(out['b.bin'], { add: 0, del: 0, binary: true });
  });
  it('keeps spaces/unicode paths raw (no unquoting)', () => {
    const out = parseNumstatZ('1' + '\t' + '2' + '\t' + 'sp ace ü.txt' + NUL);
    assert.deepEqual(out['sp ace ü.txt'], { add: 1, del: 2, binary: false });
  });
  it(' rejoins literal tabs inside paths', () => {
    const out = parseNumstatZ('1' + '\t' + '0' + '\t' + 'a' + '\t' + 'b.txt' + NUL);
    assert.deepEqual(out['a\tb.txt'], { add: 1, del: 0, binary: false });
  });
  it('returns {} for empty input', () => {
    assert.deepEqual(parseNumstatZ(''), {});
    assert.deepEqual(parseNumstatZ(null), {});
  });
});

describe('numstatArgs', () => {
  it('builds argv arrays with --no-renames -z', () => {
    assert.deepEqual(numstatArgs(false), ['diff', '--no-color', '--numstat', '--no-renames', '-z']);
    assert.deepEqual(numstatArgs(true), ['diff', '--no-color', '--numstat', '--no-renames', '-z', '--cached']);
  });
});

describe('diff-box hint stays pinned to the bottom', () => {
  let saved;
  before(() => {
    saved = {
      isRepo: appState.localIsRepo, root: appState.localRoot, branch: appState.localBranch,
      fetched: appState.localLastFetched, err: appState.localStatusError, diff: appState.localDiff,
      focus: appState.localFocus, staged: appState.localStaged, unstaged: appState.localUnstaged,
      untracked: appState.localUntracked, conflicted: appState.localConflicted,
      hist: appState.localHistory,
    };
    appState.localIsRepo = true;
    appState.localRoot = '/tmp';
    appState.localBranch = 'main';
    appState.localUpstream = null;
    appState.localAhead = 0;
    appState.localBehind = 0;
    appState.localLastFetched = Date.now();
    appState.localStatusError = null;
    appState.localFocus = 'status';
    appState.localStaged = [];
    appState.localUnstaged = [];
    appState.localUntracked = [];
    appState.localConflicted = [];
    appState.localHistory = [];
    appState.localHistoryHasMore = false;
  });
  after(() => {
    Object.assign(appState, {
      localIsRepo: saved.isRepo, localRoot: saved.root, localBranch: saved.branch,
      localLastFetched: saved.fetched, localStatusError: saved.err, localDiff: saved.diff,
      localFocus: saved.focus, localStaged: saved.staged, localUnstaged: saved.unstaged,
      localUntracked: saved.untracked, localConflicted: saved.conflicted,
      localHistory: saved.hist,
    });
  });

  const hintY = (s) => {
    const hit = s.writes.filter(w => String(w[1]).includes('[Enter] close'));
    assert.ok(hit.length > 0, 'hint must paint');
    return hit[0][0];
  };

  it('hint sits on the last box row with a full diff', () => {
    appState.localDiff = {
      path: 'f.txt', staged: false,
      text: Array.from({ length: 50 }, (_, i) => 'line ' + i).join('\n'),
    };
    const s = stubScreen(100, 24);
    local.renderLocal(s, 0, 24);
    assert.equal(hintY(s), 23, 'hint must be pinned to the bottom row');
  });

  it('hint stays pinned while scrolled', () => {
    appState.localDiff = {
      path: 'f.txt', staged: false,
      text: Array.from({ length: 50 }, (_, i) => 'line ' + i).join('\n'),
    };
    local.scrollDiff(999999); // clamps to the end
    const s = stubScreen(100, 24);
    local.renderLocal(s, 0, 24);
    assert.equal(hintY(s), 23, 'hint must not scroll with the content');
    local.scrollDiff(-999999); // reset for other suites
  });

  it('header shows aggregate file + line totals', () => {
    appState.localDiff = null;
    appState.localStaged = [{ path: 'a.txt', code: 'M' }];
    appState.localUnstaged = [{ path: 'b.txt', code: 'M' }];
    appState.localUntracked = [{ path: 'c.txt' }];
    appState.localConflicted = [];
    appState.localNumstatStaged = { 'a.txt': { add: 5, del: 1, binary: false } };
    appState.localNumstatUnstaged = { 'b.txt': { add: 2, del: 2, binary: false } };
    appState.localUntrackedLines = { 'c.txt': { lines: 4 } };
    const s = stubScreen(100, 24);
    local.renderLocal(s, 0, 24);
    const text = s.writes.map(w => w[1]).join('\n');
    assert.match(text, /3 files/, 'file count must render');
    assert.match(text, /\+11/, 'added lines must total 5+2+4');
    assert.match(text, /-3/, 'removed lines must total 1+2');
    appState.localStaged = [];
    appState.localUnstaged = [];
    appState.localUntracked = [];
  });

  it('F toggles split ↔ fullscreen rendering', () => {
    appState.localDiff = { path: 'f.txt', staged: false, text: 'a\nb\n' };
    appState.localStaged = [{ path: 'a.txt', code: 'M' }];
    appState.localUnstaged = [];
    appState.localUntracked = [];
    appState.localConflicted = [];
    let s = stubScreen(100, 24);
    local.renderLocal(s, 0, 24);
    let text = s.writes.map(w => w[1]).join('\n');
    assert.match(text, /STAGED \(/, 'split shows columns');
    assert.match(text, /\[F\] full/, 'split hint offers fullscreen');
    local.toggleDiffFullscreen();
    assert.equal(local.isDiffFullscreen(), true);
    s = stubScreen(100, 24);
    local.renderLocal(s, 0, 24);
    text = s.writes.map(w => w[1]).join('\n');
    assert.ok(!text.includes('STAGED ('), 'fullscreen hides columns');
    assert.match(text, /\[F\] split/, 'fullscreen hint offers split');
    local.toggleDiffFullscreen();
    assert.equal(local.isDiffFullscreen(), false);
    appState.localDiff = null;
    appState.localStaged = [];
  });

  it('Esc steps fullscreen → split → closed → Dashboard', () => {
    appState.localDiff = { path: 'f.txt', staged: false, text: 'x\n' };
    local.toggleDiffFullscreen();
    assert.equal(local.isDiffFullscreen(), true);
    assert.equal(local.back(), true);
    assert.ok(appState.localDiff, 'first Esc unsplits but keeps the diff');
    assert.equal(local.isDiffFullscreen(), false);
    assert.equal(local.back(), true);
    assert.equal(appState.localDiff, null, 'second Esc closes');
    assert.equal(local.back(), false, 'third Esc falls through to Dashboard');
  });

  it('F with nothing to diff warns instead of opening', () => {
    appState.localDiff = null;
    appState.localStaged = [];
    appState.localUnstaged = [];
    appState.localUntracked = [];
    appState.localConflicted = [];
    appState.localFocus = 'status';
    local.toggleDiffFullscreen();
    assert.equal(appState.localDiff, null);
    assert.equal(local.isDiffFullscreen(), false);
  });

  it('clicking the diff title toggles fullscreen', async () => {
    const { tabState } = await import('../tui/state.mjs');
    const mouse = await import('../tui/mouse.mjs');
    const savedTab = tabState.current;
    tabState.current = 5;
    try {
      appState.localDiff = { path: 'f.txt', staged: false, text: 'x\ny\n' };
      appState.confirmAction = null;
      appState.inputMode = null;
      appState.showPalette = false;
      appState._lastClickTime = 0;
      // Direct renderLocal calls never clear _sectionHeaders (doRender does
      // that in the live app) — stale header rows would swallow the click
      // as a collapse toggle instead of reaching dispatchLocalClick.
      appState._sectionHeaders = {};
      // Render at the real content offset (TAB_CONTENT_Y) so title rows
      // land in the mouse layer's content zone, not the header/tab strip.
      local.renderLocal(stubScreen(100, 40), 6, 30);
      const row = (appState._localBounds.rows || []).find(r => r.kind === 'difftoggle');
      assert.ok(row, 'title toggle row must be published');
      mouse.handleMouseEvent({ button: 0, col: 5 + 1, row: row.y + 1, pressed: true });
      assert.equal(local.isDiffFullscreen(), true, 'title click enters fullscreen');
      await sleep(450); // leave the double-click window before the next click
      appState._sectionHeaders = {};
      local.renderLocal(stubScreen(100, 40), 6, 30);
      const row2 = (appState._localBounds.rows || []).find(r => r.kind === 'difftoggle');
      assert.ok(row2, 'title row must exist in fullscreen too');
      mouse.handleMouseEvent({ button: 0, col: 5 + 1, row: row2.y + 1, pressed: true });
      assert.equal(local.isDiffFullscreen(), false, 'second click leaves fullscreen');
    } finally {
      tabState.current = savedTab;
      appState.localDiff = null;
      appState._lastClickTime = 0;
    }
  });
});

describe('navigable diff files', () => {
  const DIFF = ['commit abc subject',
    'Author: A',
    '',
    ' f.txt | 3 ++-',
    ' g.txt | 2 ++',
    ' 2 files changed',
    '',
    'diff --git a/f.txt b/f.txt',
    '--- a/f.txt',
    '+++ b/f.txt',
    '@@ -1,2 +1,3 @@',
    ' ctx',
    '-old',
    '+new1',
    '+new2',
    '',
    'diff --git a/g.txt b/g.txt',
    '--- a/g.txt',
    '+++ b/g.txt',
    '@@ -1 +1,2 @@',
    ' g',
    '+h1',
    '+h2'].join('\n');

  let saved;
  before(() => {
    saved = {
      isRepo: appState.localIsRepo, root: appState.localRoot, branch: appState.localBranch,
      fetched: appState.localLastFetched, err: appState.localStatusError, diff: appState.localDiff,
      focus: appState.localFocus, staged: appState.localStaged, unstaged: appState.localUnstaged,
      untracked: appState.localUntracked, conflicted: appState.localConflicted,
      hist: appState.localHistory, collapsed: appState.collapsed,
    };
    appState.localIsRepo = true;
    appState.localRoot = '/tmp';
    appState.localBranch = 'main';
    appState.localUpstream = null;
    appState.localAhead = 0;
    appState.localBehind = 0;
    appState.localLastFetched = Date.now();
    appState.localStatusError = null;
    appState.localFocus = 'status';
    appState.localStaged = [];
    appState.localUnstaged = [];
    appState.localUntracked = [];
    appState.localConflicted = [];
    appState.localHistory = [];
    appState.localHistoryHasMore = false;
    appState.collapsed = {};
  });
  after(() => {
    Object.assign(appState, {
      localIsRepo: saved.isRepo, localRoot: saved.root, localBranch: saved.branch,
      localLastFetched: saved.fetched, localStatusError: saved.err, localDiff: saved.diff,
      localFocus: saved.focus, localStaged: saved.staged, localUnstaged: saved.unstaged,
      localUntracked: saved.untracked, localConflicted: saved.conflicted,
      localHistory: saved.hist, collapsed: saved.collapsed,
    });
  });
  beforeEach(() => {
    appState.localDiff = { path: 'abc subject', staged: false, text: DIFF };
    local.scrollDiff(-999999);
  });
  afterEach(() => { appState.localDiff = null; dismissConfirm(); });

  const writes = (s) => s.writes.map(w => w[1]).join('\n');

  it('renders file sections with a sticky position bar', () => {
    const s = stubScreen(100, 40);
    local.renderLocal(s, 0, 40);
    const text = writes(s);
    assert.match(text, /f\.txt \+2 -1/, 'first file header with stats');
    assert.match(text, /top · 2 files/, 'position bar above the files');
  });

  it('n walks forward through the files', () => {
    local.keys['n'](); // summary → file 1
    let s = stubScreen(100, 40);
    local.renderLocal(s, 0, 40);
    assert.match(writes(s), /file 1\/2/);
    local.keys['n'](); // file 1 → file 2
    s = stubScreen(100, 40);
    local.renderLocal(s, 0, 40);
    const text = writes(s);
    assert.match(text, /file 2\/2/, 'position bar follows the jump');
    assert.match(text, /g\.txt/, 'second file visible');
  });

  it('N jumps back to the previous file', () => {
    local.keys['n']();
    local.keys['N']();
    const s = stubScreen(100, 30);
    local.renderLocal(s, 0, 30);
    assert.match(writes(s), /file 1\/2/);
  });

  it('z folds the current file, hiding its body', () => {
    local.keys['z']();
    const s = stubScreen(100, 30);
    local.renderLocal(s, 0, 30);
    const text = writes(s);
    assert.match(text, /f\.txt/, 'folded header still shows');
    assert.ok(!text.includes('+new1'), 'folded body hidden, got:\n' + text);
    local.keys['z'](); // unfold for other tests
  });

  it('jumping to a folded file unfolds it', () => {
    local.keys['n'](); // summary → file 1
    local.keys['n'](); // file 1 → file 2
    local.keys['z'](); // fold file 2
    let s = stubScreen(100, 40);
    local.renderLocal(s, 0, 40);
    assert.ok(!writes(s).includes('+h1'), 'folded file hides its body');
    local.keys['N'](); // back to file 1
    local.keys['n'](); // → file 2 unfolds on arrival
    s = stubScreen(100, 40);
    local.renderLocal(s, 0, 40);
    assert.match(writes(s), /\+h1/, 'revisited file unfolds');
  });

  it('file header rows are clickable fold targets', () => {
    // Fullscreen gives the box every row, so all headers paint at once.
    local.toggleDiffFullscreen();
    try {
      const s = stubScreen(100, 40);
      local.renderLocal(s, 0, 40);
      const text = writes(s);
      assert.match(text, /g\.txt \+2/, 'second file header paints');
      const folds = (appState._localBounds.rows || []).filter(r => r.kind === 'difffile');
      assert.equal(folds.length, 2, 'one fold row per file');
    } finally {
      local.toggleDiffFullscreen();
    }
  });

  it('clicking a file header folds it', async () => {
    const { tabState } = await import('../tui/state.mjs');
    const mouse = await import('../tui/mouse.mjs');
    const savedTab = tabState.current;
    tabState.current = 5;
    try {
      appState.confirmAction = null;
      appState.inputMode = null;
      appState.showPalette = false;
      appState._lastClickTime = 0;
      appState._sectionHeaders = {};
      local.renderLocal(stubScreen(100, 40), 6, 30);
      const fold = (appState._localBounds.rows || []).find(r => r.kind === 'difffile');
      assert.ok(fold, 'fold row published');
      mouse.handleMouseEvent({ button: 0, col: 5 + 1, row: fold.y + 1, pressed: true });
      const s = stubScreen(100, 40);
      local.renderLocal(s, 6, 30);
      assert.ok(!writes(s).includes('+new1'), 'clicked file folds');
    } finally {
      tabState.current = savedTab;
      appState._lastClickTime = 0;
    }
  });

  it('z without a diff keeps its global column-collapse meaning', () => {
    appState.localDiff = null;
    delete appState.collapsed['local:staged'];
    local.keys['z']();
    assert.equal(appState.collapsed['local:staged'], true, 'falls back to section collapse');
    delete appState.collapsed['local:staged'];
  });
});

describe('scratch-repo line stats', () => {
  let sandbox;
  let savedCwd;
  let savedState;

  function scratchBase() {
    const cands = process.platform === 'win32'
      ? [process.env.TEMP, process.env.TMP, tmpdir()]
      : ['/tmp', tmpdir()];
    for (const d of cands) {
      if (!d) continue;
      try { execFileSync(process.execPath, ['-e', ''], { cwd: d, stdio: 'pipe' }); return d; } catch { /* next */ }
    }
    return tmpdir();
  }

  const git = (args) => execFileSync('git', args, { cwd: sandbox, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

  before(() => {
    savedCwd = process.cwd();
    savedState = {
      isRepo: appState.localIsRepo, root: appState.localRoot, focus: appState.localFocus,
      diff: appState.localDiff, staged: appState.localStaged, unstaged: appState.localUnstaged,
      untracked: appState.localUntracked, conflicted: appState.localConflicted,
      nsS: appState.localNumstatStaged, nsU: appState.localNumstatUnstaged,
      unl: appState.localUntrackedLines, branch: appState.localBranch,
      fetched: appState.localLastFetched, err: appState.localStatusError,
      hist: appState.localHistory, hsel: appState.localHistorySelected,
      hscr: appState.localHistoryScroll, ssel: appState.localStatusSelected,
      sscr: appState.localStatusScroll,
    };
    sandbox = mkdtempSync(join(scratchBase(), 'github-tui-stat-'));
    const env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: join(sandbox, 'no-global-config'),
      GIT_CONFIG_SYSTEM: join(sandbox, 'no-system-config'),
    };
    const run = (args) => execFileSync('git', args, { cwd: sandbox, env, stdio: 'pipe' });
    run(['init', '-b', 'main']);
    run(['config', 'user.email', 't@t']);
    run(['config', 'user.name', 't']);
    writeFileSync(join(sandbox, 'tracked.txt'), 'one\ntwo\nthree\n');
    writeFileSync(join(sandbox, 'staged.txt'), 's1\n');
    run(['add', '-A']);
    run(['commit', '-m', 'init']);
    process.chdir(sandbox);
    appState.localIsRepo = true;
    appState.localRoot = sandbox;
    appState.localFocus = 'status';
    appState.localDiff = null;
  });

  after(() => {
    dismissConfirm();
    local.stopLocalPoll();
    Object.assign(appState, {
      localIsRepo: savedState.isRepo, localRoot: savedState.root, localFocus: savedState.focus,
      localDiff: savedState.diff, localStaged: savedState.staged, localUnstaged: savedState.unstaged,
      localUntracked: savedState.untracked, localConflicted: savedState.conflicted,
      localNumstatStaged: savedState.nsS, localNumstatUnstaged: savedState.nsU,
      localUntrackedLines: savedState.unl, localBranch: savedState.branch,
      localLastFetched: savedState.fetched, localStatusError: savedState.err,
      localHistory: savedState.hist, localHistorySelected: savedState.hsel,
      localHistoryScroll: savedState.hscr, localStatusSelected: savedState.ssel,
      localStatusScroll: savedState.sscr,
    });
    try { process.chdir(savedCwd); } catch {}
    rmSync(sandbox, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dismissConfirm();
    appState.localDiff = null;
    await sleep(20);
  });
  afterEach(() => dismissConfirm());

  it('loads staged/unstaged numstats and untracked line counts', async () => {
    // Unstaged: +3 -1 on tracked.txt (one line changed, two appended).
    writeFileSync(join(sandbox, 'tracked.txt'), 'one\nTWO\nthree\nfour\nfive\n');
    // Staged: append 3 lines to staged.txt.
    writeFileSync(join(sandbox, 'staged.txt'), 's1\ns2\ns3\ns4\n');
    git(['add', '--', 'staged.txt']);
    // Untracked: 5-line new file.
    writeFileSync(join(sandbox, 'new.txt'), 'a\nb\nc\nd\ne\n');
    await local.loadLocalStatus();
    assert.deepEqual(appState.localNumstatUnstaged['tracked.txt'], { add: 3, del: 1, binary: false });
    assert.deepEqual(appState.localNumstatStaged['staged.txt'], { add: 3, del: 0, binary: false });
    assert.deepEqual(appState.localUntrackedLines['new.txt'], { lines: 5 });
  });

  it('renders +A -D next to status rows', async () => {
    await local.loadLocalStatus();
    appState.localLastFetched = Date.now(); // skip the first-paint kick
    const s = stubScreen(100, 24);
    local.renderLocal(s, 0, 24);
    const text = s.writes.map(w => w[1]).join('\n');
    assert.match(text, /tracked\.txt/, 'row must render');
    assert.match(text, /\+3/, 'unstaged adds must render');
    assert.match(text, /-1/, 'unstaged dels must render');
    assert.match(text, /new\.txt/, 'untracked row must render');
    assert.match(text, /\+5/, 'new-file line count must render');
  });

  it('an open diff always paints, even with a full screen of files', async () => {
    // Flood the status list so the columns alone fill the viewport.
    for (let i = 0; i < 40; i++) writeFileSync(join(sandbox, 'flood' + i + '.txt'), 'x\n');
    await local.loadLocalStatus();
    appState.localLastFetched = Date.now();
    const rows = local.getStatusList();
    assert.ok(rows.length > 20, 'need a full screen: ' + rows.length);
    appState.localStatusSelected = rows.findIndex(r => r.path === 'tracked.txt');
    appState.localFocus = 'status';
    await local.loadLocalDiff();
    assert.ok(appState.localDiff, 'diff must load');
    const s = stubScreen(100, 24);
    local.renderLocal(s, 0, 24);
    const text = s.writes.map(w => w[1]).join('\n');
    assert.match(text, /DIFF ·/, 'diff box must paint despite full columns');
  });

  it('commit diff loads for the selected history entry', async () => {
    git(['add', '-A']);
    git(['commit', '-m', 'stat work']);
    await local.loadLocalStatus();
    await local.loadLocalHistory();
    assert.ok((appState.localHistory || []).length > 0, 'history must load');
    appState.localHistorySelected = 0;
    appState.localFocus = 'history';
    await local.loadLocalDiff();
    assert.ok(appState.localDiff, 'commit diff must load');
    assert.match(appState.localDiff.text, /stat work|staged\.txt|tracked\.txt/);
    appState.localDiff = null;
    appState.localFocus = 'status';
  });
});
