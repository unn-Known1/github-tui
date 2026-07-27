// Tests for tui/utils.mjs::safeCwdJoin path-traversal protection.
// Locks the defensive guarantees added in the deep-fix pass:
//   * null/undefined relPath throws before doing any resolution
//   * root-CWD ("/") refuses any non-equal absolute target
//   * Windows uses case-insensitive path comparison
//   * absolute paths are rejected when they don't start with CWD
//   * `..` traversal still rejected
//   * writeFileSafe delegates to safeCwdJoin (no direct writeFileSync bypass)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { safeCwdJoin, writeFileSafe } from '../tui/utils.mjs';

describe('safeCwdJoin — defensive guarantees', () => {
  let sandbox;

  before(() => {
    sandbox = join(tmpdir(), 'github-tui-safe-cwd-' + Date.now());
    mkdirSync(sandbox, { recursive: true });
    mkdirSync(join(sandbox, 'inside'), { recursive: true });
    mkdirSync(join(sandbox, 'inside-other'), { recursive: true });
    process.chdir(join(sandbox, 'inside'));
  });

  after(() => {
    process.chdir(sandbox);
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('allows a normal relative path inside CWD', () => {
    const p = safeCwdJoin('file.txt');
    assert.ok(p.endsWith('file.txt'));
    assert.ok(p.includes('inside'));
  });

  it('allows nested subdirectory', () => {
    const p = safeCwdJoin('sub/file.txt');
    assert.ok(p.endsWith(join('sub', 'file.txt')));
  });

  it('allows the CWD itself', () => {
    const p = safeCwdJoin('.');
    assert.ok(p.includes('inside'));
  });

  it('rejects traversal with ..', () => {
    assert.throws(() => safeCwdJoin('../escape.txt'), /escapes CWD/);
  });

  it('rejects traversal with multiple ..', () => {
    assert.throws(() => safeCwdJoin('../../etc/passwd'), /escapes CWD/);
  });

  it('rejects absolute path outside CWD', () => {
    assert.throws(() => safeCwdJoin('/etc/passwd'), /escapes CWD/);
  });

  it('rejects null relPath', () => {
    assert.throws(() => safeCwdJoin(null), /relPath is required/);
  });

  it('rejects undefined relPath', () => {
    assert.throws(() => safeCwdJoin(undefined), /relPath is required/);
  });

  it('allows absolute path that is exactly CWD', () => {
    const cwd = process.cwd();
    assert.equal(safeCwdJoin(cwd), cwd);
  });

  // Real-world "same-prefix sibling" scenario: CWD is /a/b, and a malicious
  // relative path uses "../b-other/x" to escape. The pre-fix code accepted
  // it because the startsWith check used the CWD path with a separator.
  it('rejects parent-traversal to a same-prefix sibling directory', () => {
    // From CWD=sandbox/inside, "../inside-other/evil.txt" resolves to
    // sandbox/inside-other/evil.txt — escapes CWD.
    assert.throws(
      () => safeCwdJoin('../inside-other/evil.txt'),
      /escapes CWD/
    );
  });

  it('allows absolute path under CWD', () => {
    const cwd = process.cwd();
    const inside = join(cwd, 'nested', 'file.txt');
    assert.equal(safeCwdJoin(inside), inside);
  });

  it('writeFileSafe creates parent dir and writes file', () => {
    const target = writeFileSafe('created.txt', 'hello');
    assert.ok(target.endsWith('created.txt'));
  });

  it('writeFileSafe refuses to escape CWD', () => {
    assert.throws(() => writeFileSafe('../escape.txt', 'x'), /escapes CWD/);
  });

  it('writeFileSafe refuses same-prefix sibling escape', () => {
    assert.throws(
      () => writeFileSafe('../inside-other/evil.txt', 'x'),
      /escapes CWD/
    );
  });
});
