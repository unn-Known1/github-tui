// Regression tests for Local-tab gap fixes (review pass after v0.8.0):
// stale upstream clearing, detached-SHA label, stage-all/unstage-all toggle,
// bottom() scroll pinning, conflicted diff/discard guards, diff truncation
// notice, non-origin push remote, quiet-poll status path, symlink escape.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { appState, dismissConfirm } from '../tui/state.mjs';
import { handleKey } from '../tui/keys.mjs';
import * as local from '../tui/tabs/local.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const flush = () => new Promise(r => setImmediate(r));

describe('bottom() pins the scroll window to the selection', () => {
  let saved;
  before(() => {
    saved = {
      history: appState.localHistory, hs: appState.localHistorySelected,
      hscroll: appState.localHistoryScroll, staged: appState.localStaged,
      unstaged: appState.localUnstaged, untracked: appState.localUntracked,
      conflicted: appState.localConflicted, ss: appState.localStatusSelected,
      sscroll: appState.localStatusScroll, focus: appState.localFocus,
      diff: appState.localDiff,
    };
  });
  after(() => {
    appState.localHistory = saved.history;
    appState.localHistorySelected = saved.hs;
    appState.localHistoryScroll = saved.hscroll;
    appState.localStaged = saved.staged;
    appState.localUnstaged = saved.unstaged;
    appState.localUntracked = saved.untracked;
    appState.localConflicted = saved.conflicted;
    appState.localStatusSelected = saved.ss;
    appState.localStatusScroll = saved.sscroll;
    appState.localFocus = saved.focus;
    appState.localDiff = saved.diff;
  });

  it('history bottom() selects last AND scrolls it into view', () => {
    appState.localHistory = Array.from({ length: 30 }, (_, i) => ({
      sha: String(i).padStart(40, 'a'), author: 't', date: '', subject: 'c' + i, body: '',
    }));
    appState.localHistorySelected = 0;
    appState.localHistoryScroll = 0;
    appState.localFocus = 'history';
    appState.localDiff = null;
    local.bottom();
    assert.equal(appState.localHistorySelected, 29);
    assert.ok(appState.localHistoryScroll > 0, 'scroll must follow to the end');
    assert.ok(appState.localHistorySelected < appState.localHistoryScroll + 30);
  });

  it('status bottom() selects last AND scrolls it into view', () => {
    appState.localStaged = Array.from({ length: 15 }, (_, i) => ({ path: 'f' + i + '.txt', code: 'M' }));
    appState.localUnstaged = [];
    appState.localUntracked = [];
    appState.localConflicted = [];
    appState.localStatusSelected = 0;
    appState.localStatusScroll = 0;
    appState.localFocus = 'status';
    appState.localDiff = null;
    local.bottom();
    assert.equal(appState.localStatusSelected, 14);
    assert.ok(appState.localStatusScroll > 0, 'scroll must follow to the end');
  });
});

describe('scratch-repo gap fixes', () => {
  let sandbox;
  let bareBase;
  let savedCwd;

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

  const git = (args, cwd) => execFileSync('git', args, {
    cwd: cwd || sandbox, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  const cached = () => git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  async function settle(cond, label) {
    const t0 = Date.now();
    for (;;) {
      try { if (cond()) return; } catch { /* retry */ }
      if (Date.now() - t0 > 20000) throw new Error('timed out waiting: ' + label);
      await sleep(100);
    }
  }

  before(() => {
    savedCwd = process.cwd();
    sandbox = mkdtempSync(join(scratchBase(), 'github-tui-gaps-'));
    bareBase = mkdtempSync(join(scratchBase(), 'github-tui-gaps-bare-'));
    const env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: join(sandbox, 'no-global-config'),
      GIT_CONFIG_SYSTEM: join(sandbox, 'no-system-config'),
    };
    const run = (args, cwd) => execFileSync('git', args, { cwd: cwd || sandbox, env, stdio: 'pipe' });
    run(['init', '-b', 'main']);
    run(['config', 'user.email', 't@t']);
    run(['config', 'user.name', 't']);
    writeFileSync(join(sandbox, 'a.txt'), 'v1\n');
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
    try { process.chdir(savedCwd); } catch {}
    rmSync(sandbox, { recursive: true, force: true });
    rmSync(bareBase, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dismissConfirm();
    appState.localDiff = null;
    await sleep(20);
  });
  afterEach(() => dismissConfirm());

  it('upstream clears after --unset-upstream (no stale pill)', async () => {
    const bare = join(bareBase, 'gaps-origin.git');
    execFileSync('git', ['init', '--bare', bare], { stdio: 'pipe' });
    git(['remote', 'add', 'origin', bare]);
    git(['push', '-u', 'origin', 'main']);
    await local.loadLocalStatus();
    assert.equal(appState.localUpstream, 'origin/main');
    git(['branch', '--unset-upstream']);
    await local.loadLocalStatus();
    assert.equal(appState.localUpstream, null, 'stale upstream must clear');
    assert.equal(appState.localAhead, 0);
    assert.equal(appState.localBehind, 0);
  });

  it('detached HEAD keeps the short-SHA label across reloads', async () => {
    git(['checkout', '--detach', 'HEAD']);
    try {
      await local.loadLocalStatus();
      assert.match(String(appState.localBranch || ''), /^HEAD \(detached [0-9a-f]+\)$/i);
      await local.loadLocalStatus({ quiet: true });
      assert.match(String(appState.localBranch || ''), /^HEAD \(detached [0-9a-f]+\)$/i);
    } finally {
      git(['checkout', 'main']);
      await local.loadLocalStatus();
    }
    assert.equal(appState.localBranch, 'main');
  });

  it('quiet poll with a cached root populates status (no sync meta needed)', async () => {
    writeFileSync(join(sandbox, 'quiet.txt'), 'q\n');
    await local.loadLocalStatus({ quiet: true });
    assert.ok(local.getStatusList().some(r => r.path === 'quiet.txt'), 'quiet status must list the file');
    rmSync(join(sandbox, 'quiet.txt'));
  });

  it('stageAll toggles to unstage-all when only the index is dirty', async () => {
    writeFileSync(join(sandbox, 'a.txt'), 'staged-v2\n');
    await local.loadLocalStatus();
    let rows = local.getStatusList();
    appState.localStatusSelected = rows.findIndex(r => r.path === 'a.txt');
    await local.toggleStage();
    await settle(() => cached().includes('a.txt'), 'a.txt staged');
    await local.loadLocalStatus();
    local.stageAll();
    assert.ok(appState.confirmAction, 'unstage-all must confirm');
    assert.match(appState.confirmTitle, /Unstage all/);
    assert.match(appState.confirmMessage, /restore --staged/);
    await sleep(30);
    handleKey('y');
    await flush();
    await settle(() => !cached().includes('a.txt'), 'index cleared by unstage-all');
    await local.loadLocalStatus();
  });

  it('push -u names a non-origin remote instead of hardcoding origin', async () => {
    const bare2 = join(bareBase, 'gaps-upstream.git');
    execFileSync('git', ['init', '--bare', bare2], { stdio: 'pipe' });
    git(['checkout', '-b', 'feat/remote-name']);
    writeFileSync(join(sandbox, 'r.txt'), 'r\n');
    git(['add', '-A']);
    git(['commit', '-m', 'remote name work']);
    // Point the branch at a remote that is NOT called origin.
    try { git(['remote', 'remove', 'origin']); } catch {}
    git(['remote', 'add', 'upstream', bare2]);
    await local.loadLocalStatus();
    assert.equal(appState.localUpstream, null);
    local.pushFlow();
    assert.ok(appState.confirmAction, 'push -u must confirm');
    assert.match(appState.confirmMessage, /git push -u upstream feat\/remote-name/);
    dismissConfirm();
    git(['checkout', 'main']);
    git(['branch', '-D', 'feat/remote-name']);
    git(['remote', 'remove', 'upstream']);
    await local.loadLocalStatus();
  });

  it('conflicted files: discard blocked, diff-against-HEAD shown', async () => {
    git(['checkout', '-b', 'gaps-side']);
    writeFileSync(join(sandbox, 'a.txt'), 'side\n');
    git(['add', '-A']);
    git(['commit', '-m', 'side']);
    git(['checkout', 'main']);
    writeFileSync(join(sandbox, 'a.txt'), 'main\n');
    git(['add', '-A']);
    git(['commit', '-m', 'main']);
    try {
      git(['merge', 'gaps-side']);
    } catch { /* exit 1 on conflict — expected */ }
    try {
      await local.loadLocalStatus();
      assert.ok((appState.localConflicted || []).some(e => e.path === 'a.txt'), 'a.txt must be conflicted');
      const rows = local.getStatusList();
      appState.localStatusSelected = rows.findIndex(r => r.section === 'conflicted' && r.path === 'a.txt');
      appState.localFocus = 'status';
      local.discardFlow();
      assert.equal(appState.confirmAction, null, 'conflicted discard must not pop up');
      await local.loadLocalDiff();
      assert.ok(appState.localDiff, 'conflicted diff must open');
      assert.ok((appState.localDiff.text || '').length > 0, 'conflicted diff must not be empty');
    } finally {
      appState.localDiff = null;
      git(['merge', '--abort']);
      git(['branch', '-D', 'gaps-side']);
      await local.loadLocalStatus();
    }
  });

  it('large diffs carry a truncation notice', async () => {
    const big = Array.from({ length: 1500 }, (_, i) => 'line ' + i + ' padding padding padding padding').join('\n') + '\n';
    writeFileSync(join(sandbox, 'big.txt'), big);
    await local.loadLocalStatus();
    const rows = local.getStatusList();
    appState.localStatusSelected = rows.findIndex(r => r.path === 'big.txt');
    appState.localFocus = 'status';
    await local.loadLocalDiff();
    assert.ok(appState.localDiff, 'diff must open');
    assert.match(appState.localDiff.text, /truncated \(12KB preview cap\)/);
    appState.localDiff = null;
    rmSync(join(sandbox, 'big.txt'));
    await local.loadLocalStatus();
  });

  it('untracked symlink escaping the repo is refused', async () => {
    const outside = join(bareBase, 'gaps-secret.txt');
    writeFileSync(outside, 'secret\n');
    try {
      symlinkSync(outside, join(sandbox, 'evil-link.txt'));
      await local.loadLocalStatus();
      const rows = local.getStatusList();
      appState.localStatusSelected = rows.findIndex(r => r.path === 'evil-link.txt');
      assert.ok(appState.localStatusSelected >= 0, 'symlink must be listed');
      appState.localFocus = 'status';
      await local.loadLocalDiff();
      assert.equal(appState.localDiff, null, 'escaping symlink must not preview');
    } finally {
      try { rmSync(join(sandbox, 'evil-link.txt')); } catch {}
      try { rmSync(outside); } catch {}
      await local.loadLocalStatus();
    }
  });
});

describe('help documents the shipped Local bindings', () => {
  it('LOCAL help shows single-press g and the [ ] focus keys', async () => {
    const { tabState } = await import('../tui/state.mjs');
    const help = await import('../tui/tabs/help.mjs');
    const savedTab = tabState.current;
    tabState.current = 5;
    try {
      const lines = help.getHelpLines('');
      const shortcuts = lines.filter(l => l && l.kind === 'shortcut');
      const g = shortcuts.find(s => s.key === 'g / G');
      assert.ok(g, 'g row must exist');
      assert.ok(!/two-press/.test(g.desc || ''), 'g is single-press on Local, help must not claim two-press');
      assert.ok(shortcuts.some(s => s.key === '[ / ]'), '[ / ] focus row must exist');
    } finally {
      tabState.current = savedTab;
    }
  });
});
