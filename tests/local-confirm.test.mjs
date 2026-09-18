// Tests for Phase 2 confirm UX (§6.5): structured dialog, danger Enter-noop,
// clickable mouse buttons, and end-to-end stage/discard/commit/amend in a
// scratch repo (chdir'd — never touches the real checkout).

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { appState, tabState, confirm, confirmDanger, dismissConfirm } from '../tui/state.mjs';
import { handleKey } from '../tui/keys.mjs';
import { handleInputKey } from '../tui/input.mjs';
import { handleMouseEvent } from '../tui/mouse.mjs';
import { renderConfirmDialog } from '../tui/render.mjs';
import * as local from '../tui/tabs/local.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Flush the Promise.resolve() dispatch chains handleKey uses.
const flush = () => new Promise(r => setImmediate(r));

function stubScreen(w = 100, h = 40) {
  return {
    width: w, height: h, writes: [],
    styleBuf: Array.from({ length: h }, () => new Array(w).fill(null)),
    writeStr(x, y, s) { this.writes.push([y, String(s)]); },
    hline() {}, box() {}, setCell() {},
  };
}

describe('classifyCommitError — actionable hints', () => {
  it('detects missing identity', () => {
    assert.match(local.classifyCommitError('Author identity unknown\nfatal: unable to auto-detect email address'),
      /git config user.name/);
  });
  it('detects GPG failures', () => {
    assert.match(local.classifyCommitError('error: gpg failed to sign the data'), /GPG/);
  });
  it('detects nothing-to-commit', () => {
    assert.match(local.classifyCommitError('nothing to commit, working tree clean'), /stage/);
  });
  it('returns null for unknown errors (verbatim path)', () => {
    assert.equal(local.classifyCommitError('some weird hook exploded: exit 7'), null);
  });
});

describe('danger confirm keys — Enter never confirms', () => {
  beforeEach(async () => {
    dismissConfirm();
    await sleep(20); // clear the handleKey repeat debouncer
  });
  afterEach(() => dismissConfirm());

  it('normal confirm: Enter fires, like y', async () => {
    let fired = false;
    confirm(' proceed?', () => { fired = true; }, 'T');
    await sleep(20);
    handleKey('\r');
    await flush();
    assert.equal(fired, true);
  });

  it('danger confirm: Enter is swallowed, y fires', async () => {
    let fired = false;
    confirmDanger(' burn?', () => { fired = true; }, 'Danger');
    await sleep(20);
    handleKey('\r');
    await flush();
    assert.equal(fired, false, 'Enter must not confirm danger');
    assert.ok(appState.confirmAction, 'dialog must stay open after Enter');
    await sleep(20);
    handleKey('y');
    await flush();
    assert.equal(fired, true);
  });
});

describe('renderConfirmDialog — structure + mouse bounds', () => {
  afterEach(() => dismissConfirm());

  it('renders paragraphs, danger banner, and publishes button bounds', () => {
    confirmDanger('Discard changes — a.txt\n\nThis will throw away unstaged edits.\n\n`git restore -- x`\n\n⚠ IRREVERSIBLE — lost.',
      () => {}, 'Discard changes');
    const s = stubScreen();
    renderConfirmDialog(s);
    const text = s.writes.map(w => w[1]).join('\n');
    assert.match(text, /Discard changes — a\.txt/);
    assert.match(text, /git restore -- x/);
    assert.match(text, /IRREVERSIBLE/);
    assert.match(text, /\[ Yes \]/);
    assert.match(text, /\[ Cancel \]/);
    const b = appState._confirmBounds;
    assert.ok(b && b.yes.x2 - b.yes.x1 >= 7, 'Yes button too small');
    assert.ok(b.no.x1 - b.yes.x2 >= 2, 'buttons not separated');
  });

  it('normal dialog has no danger styling', () => {
    confirm('Stage all?', () => {}, 'Stage');
    const s = stubScreen();
    renderConfirmDialog(s);
    assert.equal(appState._confirmDanger, false);
    assert.ok(appState._confirmBounds);
  });
});

describe('mouse on confirm — Yes fires (even danger), No/outside cancels', () => {
  beforeEach(async () => {
    dismissConfirm();
    appState.showDetail = false;
    await sleep(20);
  });
  afterEach(() => dismissConfirm());

  it('[Yes] click fires a danger action', async () => {
    let fired = false;
    confirmDanger(' burn?', () => { fired = true; }, 'Danger');
    appState._confirmBounds = { yes: { x1: 10, x2: 17, y: 5 }, no: { x1: 23, x2: 33, y: 5 } };
    handleMouseEvent({ button: 0, col: 12, row: 6, pressed: true }); // sx=11, sy=5
    await flush();
    assert.equal(fired, true);
    assert.equal(appState.confirmAction, null);
  });

  it('[Cancel] click dismisses without firing', async () => {
    let fired = false;
    confirmDanger(' burn?', () => { fired = true; }, 'Danger');
    appState._confirmBounds = { yes: { x1: 10, x2: 17, y: 5 }, no: { x1: 23, x2: 33, y: 5 } };
    handleMouseEvent({ button: 0, col: 25, row: 6, pressed: true });
    await flush();
    assert.equal(fired, false);
    assert.equal(appState.confirmAction, null);
  });

  it('outside click dismisses without firing', async () => {
    let fired = false;
    confirm(' sure?', () => { fired = true; }, 'T');
    appState._confirmBounds = { yes: { x1: 10, x2: 17, y: 5 }, no: { x1: 23, x2: 33, y: 5 } };
    handleMouseEvent({ button: 0, col: 70, row: 20, pressed: true });
    await flush();
    assert.equal(fired, false);
    assert.equal(appState.confirmAction, null);
  });
});

describe('scratch-repo flows — stage / discard / commit / amend', () => {
  let sandbox;
  let savedCwd;

  // Scratch repos MUST live on a local disk: the suite TMPDIR can point at
  // a network mount (Drive FUSE), where git intermittently reads back an
  // "empty repo" right after writing .git (close-to-open races). /tmp is
  // local on POSIX; Windows falls back to TEMP, then os.tmpdir().
  function scratchBase() {
    const cands = process.platform === 'win32'
      ? [process.env.TEMP, process.env.TMP, tmpdir()]
      : ['/tmp', tmpdir()];
    for (const d of cands) {
      if (!d) continue;
      try {
        execFileSync(process.execPath, ['-e', ''], { cwd: d, stdio: 'pipe' });
        return d;
      } catch { /* not usable — try next */ }
    }
    return tmpdir();
  }

  const git = (args) => execFileSync('git', args, { cwd: sandbox, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const gitState = () => {
    let status = '?', log = '?';
    try { status = git(['status', '--porcelain=v1', '-b']); } catch (e) { status = 'STATUS-ERR ' + e.message; }
    try { log = git(['log', '--oneline', '-3']); } catch (e) { log = 'LOG-ERR ' + e.message; }
    return '\n--- git status ---\n' + status + '\n--- git log ---\n' + log;
  };
  const cached = () => git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  const unstaged = () => git(['diff', '--name-only']).split('\n').filter(Boolean);
  async function settle(cond, label) {
    const t0 = Date.now();
    for (;;) {
      try {
        if (cond()) return;
      } catch (e) { /* cond git call flaked — retry until timeout */ }
      if (Date.now() - t0 > 20000) throw new Error('timed out waiting: ' + label + gitState());
      await sleep(100);
    }
  }

  before(() => {
    savedCwd = process.cwd();
    sandbox = mkdtempSync(join(scratchBase(), 'github-tui-local-'));
    // Hermetic identity + no signing/hooks: global gitconfig must not leak in.
    const env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: join(sandbox, 'no-global-config'),
      GIT_CONFIG_SYSTEM: join(sandbox, 'no-system-config'),
    };
    const run = (args) => execFileSync('git', args, { cwd: sandbox, env, stdio: 'pipe' });
    run(['init', '-b', 'main']);
    run(['config', 'user.email', 't@t']);
    run(['config', 'user.name', 't']);
    writeFileSync(join(sandbox, 'a.txt'), 'v1\n');
    run(['add', '-A']);
    run(['commit', '-m', 'init']);
    // Fail fast with a clear error if setup didn't land (network-FS races).
    const head = execFileSync('git', ['log', '--pretty=format:%s', '-1'],
      { cwd: sandbox, env, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    assert.equal(head, 'init', 'scratch repo setup failed — no init commit' + gitState());
    process.chdir(sandbox);
    appState.localIsRepo = true;
    appState.localRoot = sandbox;
  });

  after(() => {
    dismissConfirm();
    local.stopLocalPoll();
    process.chdir(savedCwd);
    rmSync(sandbox, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dismissConfirm();
    await sleep(20);
  });
  afterEach(() => dismissConfirm());

  it('stage + unstage a single file via toggleStage', async () => {
    writeFileSync(join(sandbox, 'a.txt'), 'v2\n');
    await local.loadLocalStatus();
    const rows = local.getStatusList();
    appState.localStatusSelected = rows.findIndex(r => r.path === 'a.txt');
    await local.toggleStage();
    await settle(() => cached().includes('a.txt'), 'stage a.txt');
    await local.toggleStage();
    await settle(() => !cached().includes('a.txt') && unstaged().includes('a.txt'), 'unstage a.txt');
  });

  it('discard restores worktree content behind two danger confirms', async () => {
    writeFileSync(join(sandbox, 'a.txt'), 'DOOMED\n');
    await local.loadLocalStatus();
    const rows = local.getStatusList();
    appState.localStatusSelected = rows.findIndex(r => r.path === 'a.txt');
    local.discardFlow();
    assert.ok(appState.confirmAction, 'first danger confirm missing');
    assert.equal(appState._confirmDanger, true);
    await sleep(30);
    handleKey('y');
    await flush();
    assert.ok(appState.confirmAction, 'second danger confirm missing');
    await sleep(30);
    handleKey('y');
    await settle(() => readFileSync(join(sandbox, 'a.txt'), 'utf-8') === 'v1\n' || readFileSync(join(sandbox, 'a.txt'), 'utf-8') === 'v2\n', 'discard a.txt');
    assert.match(readFileSync(join(sandbox, 'a.txt'), 'utf-8'), /^v[12]\n$/);
  });

  it('commit flows subject+body through two prompts and a detail popup', async () => {
    writeFileSync(join(sandbox, 'b.txt'), 'new\n');
    await local.loadLocalStatus();
    const rows = local.getStatusList();
    appState.localStatusSelected = rows.findIndex(r => r.path === 'b.txt');
    await local.toggleStage();
    await settle(() => cached().includes('b.txt'), 'stage b.txt');
    local.commitFlow();
    assert.equal(appState.inputMode, 'input');
    handleInputKey('add b');
    handleInputKey('\r');
    assert.equal(appState.inputMode, 'input', 'body prompt missing');
    handleInputKey('why line');
    handleInputKey('\r');
    await flush();
    assert.ok(appState.confirmAction, 'commit detail popup missing');
    assert.equal(appState.confirmTitle, 'Commit');
    assert.match(appState.confirmMessage, /add b/);
    assert.match(appState.confirmMessage, /git commit -m/);
    await sleep(30);
    handleKey('y');
    await settle(() => git(['log', '--pretty=format:%s', '-1']) === 'add b', 'commit lands');
    // _commitImpl keeps reloading status+history AFTER the commit lands and
    // the confirm action floats (un-awaited by design). Wait for quiescence
    // so the amend test never races those trailing loads on the same scope.
    await settle(() => (appState.localHistory || []).length > 0 && appState.loading === false,
      'commit trailing loads; message=' + JSON.stringify(appState.message));
    assert.equal(git(['log', '--pretty=format:%b', '-1']), 'why line');
  });

  it('amend rewrites HEAD subject', async () => {
    assert.equal(appState.localIsRepo, true, 'pre: isRepo, cwd=' + process.cwd());
    assert.ok(appState.localRoot, 'pre: root');
    assert.ok((appState.localHistory || []).length > 0,
      'pre: history loaded, cwd=' + process.cwd() + ' root=' + appState.localRoot);
    await local.amendFlow();
    assert.equal(appState.inputMode, 'input');
    handleInputKey(' ++');
    handleInputKey('\r'); // subject (appended to prefill)
    handleInputKey('\r'); // body (untouched prefill kept)
    await flush();
    assert.ok(appState.confirmAction, 'amend popup missing');
    assert.equal(appState.confirmTitle, 'Amend HEAD');
    await sleep(30);
    handleKey('y');
    await settle(() => git(['log', '--pretty=format:%s', '-1']).endsWith('++'), 'amend lands');
  });
});
