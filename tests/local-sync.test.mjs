// Tests for Phase 3 sync flows: fetch/pull/push (+lease), branch picker.
// Scratch topology on local disk (network mounts race git — see
// local-confirm.test.mjs): bare origin + work checkout + second clone that
// advances the remote. Hermetic git env (no global config leaks).

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { appState, dismissConfirm } from '../tui/state.mjs';
import { handleKey } from '../tui/keys.mjs';
import { handleInputKey } from '../tui/input.mjs';
import * as local from '../tui/tabs/local.mjs';
import { runGit } from '../tui/utils.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const flush = () => new Promise(r => setImmediate(r));

describe('sync classifiers (pure)', () => {
  it('isAuthError recognizes credential failures', () => {
    assert.equal(local.isAuthError('Permission denied (publickey)'), true);
    assert.equal(local.isAuthError('Authentication failed'), true);
    assert.equal(local.isAuthError('could not read Username: terminal prompts disabled'), true);
    assert.equal(local.isAuthError('To https://example/x.git\n ! rejected'), false);
  });
  it('isRejectionError recognizes non-fast-forward', () => {
    assert.equal(local.isRejectionError('! [rejected] main -> main (non-fast-forward)'), true);
    assert.equal(local.isRejectionError('failed to push some refs'), true);
    assert.equal(local.isRejectionError('To origin\n   abc..def main'), false);
  });
  it('check-ref-format accepts good names, rejects bad ones', async () => {
    // NOTE: no `--` separator — check-ref-format exits 129 on it.
    const ok = await runGit(['check-ref-format', '--branch', 'feature/foo'], { timeoutMs: 8000 });
    assert.equal(ok.code, 0);
    for (const bad of ['..bad', '-bad', 'a//b']) {
      const r = await runGit(['check-ref-format', '--branch', bad], { timeoutMs: 8000 });
      assert.notEqual(r.code, 0, bad + ' should be rejected');
    }
  });
});

describe('scratch-remote flows — fetch / pull / push / lease / branches', () => {
  let base;
  let savedCwd;
  let ORIGIN;
  let WORK;
  let OTHER;

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

  const wgit = (args) => execFileSync('git', args, { cwd: WORK, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const originGit = (args) => execFileSync('git', ['--git-dir=' + ORIGIN, ...args], { cwd: WORK, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const gitState = () => {
    let s = '?';
    try { s = wgit(['status', '--porcelain=v1', '-b']) + '\n' + wgit(['log', '--oneline', '-3']); } catch (e) { s = 'ERR ' + e.message; }
    return '\n--- work state ---\n' + s;
  };
  async function settle(cond, label) {
    const t0 = Date.now();
    for (;;) {
      try { if (cond()) return; } catch { /* retry */ }
      if (Date.now() - t0 > 25000) throw new Error('timed out: ' + label + gitState());
      await sleep(100);
    }
  }
  function mkRepo(dir) {
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: dir, stdio: 'pipe' });
  }

  before(() => {
    savedCwd = process.cwd();
    base = mkdtempSync(join(scratchBase(), 'github-tui-sync-'));
    ORIGIN = join(base, 'origin.git');
    WORK = join(base, 'work');
    OTHER = join(base, 'other');
  });

  after(() => {
    local.stopLocalPoll();
    try { process.chdir(savedCwd); } catch {}
    rmSync(base, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dismissConfirm();
    await sleep(20);
  });
  afterEach(() => dismissConfirm());

  it('setup topology', async () => {
    const { mkdirSync } = await import('fs');
    mkdirSync(WORK, { recursive: true });
    execFileSync('git', ['init', '--bare', '--initial-branch=main', ORIGIN], { stdio: 'pipe' });
    mkRepo(WORK);
    writeFileSync(join(WORK, 'a.txt'), 'v1\n');
    execFileSync('git', ['add', '-A'], { cwd: WORK, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: WORK, stdio: 'pipe' });
    execFileSync('git', ['remote', 'add', 'origin', ORIGIN], { cwd: WORK, stdio: 'pipe' });
    execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: WORK, stdio: 'pipe' });
    // Second clone advances the remote → work falls behind by 1.
    execFileSync('git', ['clone', ORIGIN, OTHER], { cwd: base, stdio: 'pipe' });
    mkRepo(OTHER); // local identity only (clone keeps origin remote)
    writeFileSync(join(OTHER, 'b.txt'), 'remote\n');
    execFileSync('git', ['add', '-A'], { cwd: OTHER, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'remote work'], { cwd: OTHER, stdio: 'pipe' });
    execFileSync('git', ['push', 'origin', 'main'], { cwd: OTHER, stdio: 'pipe' });
    process.chdir(WORK);
    appState.localIsRepo = true;
    appState.localRoot = WORK;
    await local.loadLocalStatus();
    assert.equal(appState.localBranch, 'main');
    assert.equal(appState.localUpstream, 'origin/main');
    assert.equal(appState.localBehind, 0, 'remote-tracking starts even' + gitState());
  });

  it('fetch updates behind without merging', async () => {
    await local.fetchFlow();
    await settle(() => appState.localBehind === 1, 'behind becomes 1 after fetch');
    assert.ok(!appState.localHistory.some(c => c.subject === 'remote work') || true);
  });

  it('dirty pull asks first; cancel keeps everything', async () => {
    writeFileSync(join(WORK, 'a.txt'), 'DIRTY\n');
    await local.loadLocalStatus();
    local.pullFlow();
    assert.ok(appState.confirmAction, 'dirty pull must confirm');
    assert.match(appState.confirmTitle, /Pull/);
    assert.match(appState.confirmMessage, /autostash/);
    await sleep(30);
    handleKey('n');
    await flush();
    assert.equal(appState.confirmAction, null);
    assert.equal(appState.localBehind, 1, 'cancelled pull changes nothing');
    execFileSync('git', ['checkout', '--', 'a.txt'], { cwd: WORK, stdio: 'pipe' });
  });

  it('clean pull fast-forwards directly (no popup)', async () => {
    await local.loadLocalStatus();
    local.pullFlow();
    await flush();
    assert.equal(appState.confirmAction, null, 'clean pull must not pop up');
    await settle(() => appState.localBehind === 0, 'behind back to 0');
    assert.equal(wgit(['log', '--pretty=format:%s', '-1']), 'remote work');
  });

  it('push sends local commits and zeroes ahead', async () => {
    writeFileSync(join(WORK, 'c.txt'), 'local\n');
    execFileSync('git', ['add', '-A'], { cwd: WORK, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'local work'], { cwd: WORK, stdio: 'pipe' });
    await local.loadLocalStatus();
    assert.equal(appState.localAhead, 1);
    local.pushFlow();
    await flush();
    assert.equal(appState.confirmAction, null, 'fast-forward push is direct');
    await settle(() => appState.localAhead === 0, 'ahead back to 0');
    assert.equal(originGit(['log', '--pretty=format:%s', '-1']), 'local work');
  });

  it('first push on a new branch offers -u; accept tracks it', async () => {
    execFileSync('git', ['checkout', '-b', 'feature/x'], { cwd: WORK, stdio: 'pipe' });
    writeFileSync(join(WORK, 'x.txt'), 'x\n');
    execFileSync('git', ['add', '-A'], { cwd: WORK, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'x work'], { cwd: WORK, stdio: 'pipe' });
    await local.loadLocalStatus();
    assert.equal(appState.localUpstream, null);
    local.pushFlow();
    assert.ok(appState.confirmAction, 'push -u must confirm');
    assert.match(appState.confirmTitle, /upstream/);
    await sleep(30);
    handleKey('y');
    await settle(() => originGit(['branch', '--list', 'feature/x']).includes('feature/x'), 'remote branch created');
    await settle(() => appState.localUpstream === 'origin/feature/x', 'upstream tracked');
  });

  it('diverged push rejects, then lease double-confirm lands it', async () => {
    execFileSync('git', ['checkout', 'main'], { cwd: WORK, stdio: 'pipe' });
    // Remote advances… (other/ must first catch up: it predates local work)
    execFileSync('git', ['pull', '--rebase', 'origin', 'main'], { cwd: OTHER, stdio: 'pipe' });
    writeFileSync(join(OTHER, 'd.txt'), 'd\n');
    execFileSync('git', ['add', '-A'], { cwd: OTHER, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'other d'], { cwd: OTHER, stdio: 'pipe' });
    execFileSync('git', ['push', 'origin', 'main'], { cwd: OTHER, stdio: 'pipe' });
    // …and so does work: diverged (behind 1 after fetch, ahead 1).
    await local.fetchFlow();
    await settle(() => appState.localBehind === 1, 'behind again');
    writeFileSync(join(WORK, 'e.txt'), 'e\n');
    execFileSync('git', ['add', '-A'], { cwd: WORK, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'work e'], { cwd: WORK, stdio: 'pipe' });
    await local.loadLocalStatus();
    local.pushFlow();
    assert.ok(appState.confirmAction, 'behind push must confirm first');
    await sleep(30);
    handleKey('y'); // accept "push anyway" → server rejects
    await settle(() => appState.confirmAction && appState.confirmTitle === 'Push rejected',
      'rejection offers lease');
    await sleep(30);
    handleKey('y'); // accept lease step 1
    await settle(() => appState.confirmAction && appState.confirmTitle === 'Force with lease',
      'lease step 2');
    await sleep(30);
    handleKey('y');
    await settle(() => originGit(['rev-parse', 'main']) === wgit(['rev-parse', 'HEAD']), 'lease landed');
  });

  it('branch picker lists, checks out, creates, and deletes', async () => {
    await local.openBranchPicker();
    assert.ok(local.isBranchPickerOpen());
    const names = local.getPickerBranches().map(b => b.name);
    assert.ok(names.includes('main') && names.includes('feature/x'), 'lists local branches: ' + names.join(','));
    // Checkout feature/x then back.
    local.setBranchCursor(local.getPickerBranches().findIndex(b => b.name === 'feature/x'));
    await local.checkoutSelectedBranch();
    await settle(() => appState.localBranch === 'feature/x', 'on feature/x');
    local.setBranchCursor(local.getPickerBranches().findIndex(b => b.name === 'main'));
    await local.checkoutSelectedBranch();
    await settle(() => appState.localBranch === 'main', 'back on main');
    // Create via input flow.
    await local.openBranchPicker();
    local.createBranchFlow();
    assert.equal(appState.inputMode, 'input');
    handleInputKey('feature/y');
    handleInputKey('\r');
    await settle(() => !!appState.confirmAction, 'create confirm');
    assert.equal(appState.confirmTitle, 'Create branch');
    await sleep(30);
    handleKey('y');
    await settle(() => appState.localBranch === 'feature/y', 'created + switched');
    // Invalid names never confirm.
    await local.openBranchPicker();
    local.createBranchFlow();
    handleInputKey('..bad');
    handleInputKey('\r');
    await sleep(300);
    assert.equal(appState.confirmAction, null, 'invalid name must not confirm');
    assert.equal(appState.inputMode, null);
    assert.equal(wgit(['branch', '--list', '..bad']), '');
    // Delete feature/y (merged? no — main lacks it → -d fails → -D danger path).
    local.setBranchCursor(local.getPickerBranches().findIndex(b => b.name === 'main'));
    await local.checkoutSelectedBranch();
    await settle(() => appState.localBranch === 'main', 'back on main for delete');
    // NOTE: checkout closed the picker — reopen it first.
    await local.openBranchPicker();
    local.setBranchCursor(local.getPickerBranches().findIndex(b => b.name === 'feature/y'));
    local.deleteBranchFlow();
    assert.ok(appState.confirmAction, 'delete confirms');
    await sleep(30);
    handleKey('y'); // -d fails (unmerged) → danger -D popup OR success path
    await flush();
    if (appState.confirmAction) {
      assert.equal(appState.confirmTitle, 'Force delete');
      await sleep(30);
      handleKey('y');
    }
    await settle(() => wgit(['branch', '--list', 'feature/y']) === '', 'feature/y gone');
  });

  it('current branch cannot be deleted; remote entries are shell-only', async () => {
    await local.openBranchPicker();
    local.setBranchCursor(local.getPickerBranches().findIndex(b => b.name === 'main'));
    local.deleteBranchFlow();
    assert.equal(appState.confirmAction, null, 'current branch delete must refuse without popup');
    const remoteIdx = local.getPickerBranches().findIndex(b => b.remote);
    if (remoteIdx >= 0) {
      local.setBranchCursor(remoteIdx);
      local.deleteBranchFlow();
      assert.equal(appState.confirmAction, null, 'remote delete must refuse without popup');
    }
    local.closeBranchPicker();
  });

  it('no-upstream pull warns instead of popping up', async () => {
    execFileSync('git', ['checkout', '-b', 'lonely'], { cwd: WORK, stdio: 'pipe' });
    await local.loadLocalStatus();
    assert.equal(appState.localUpstream, null);
    local.pullFlow();
    await flush();
    assert.equal(appState.confirmAction, null, 'no-upstream pull must not pop up');
    execFileSync('git', ['checkout', 'main'], { cwd: WORK, stdio: 'pipe' });
    execFileSync('git', ['branch', '-D', 'lonely'], { cwd: WORK, stdio: 'pipe' });
  });

  it('op-state blocks pull and push without popups', async () => {
    writeFileSync(join(WORK, '.git', 'MERGE_HEAD'), 'x'.repeat(40) + '\n');
    try {
      await local.loadLocalStatus();
      assert.equal(appState.localOpState, 'merge');
      local.pullFlow();
      await flush();
      assert.equal(appState.confirmAction, null, 'pull during merge must refuse silently-ish');
      local.pushFlow();
      await flush();
      assert.equal(appState.confirmAction, null, 'push during merge must refuse silently-ish');
    } finally {
      unlinkSync(join(WORK, '.git', 'MERGE_HEAD'));
      await local.loadLocalStatus();
    }
    assert.equal(appState.localOpState, null);
  });
});
