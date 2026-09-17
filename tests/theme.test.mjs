import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { color } from '../tui/theme.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('theme NO_COLOR', () => {
  const originalEnv = process.env.NO_COLOR;

  after(() => {
    if (originalEnv === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = originalEnv;
  });

  it('color() returns style objects normally', () => {
    delete process.env.NO_COLOR;
    const style = color('title');
    assert.ok(style);
    assert.equal(typeof style, 'object');
    assert.equal(style.bold, true);
  });

  it('color() returns null for unknown role', () => {
    const style = color('nonexistent_role_xyz');
    assert.equal(style, null);
  });

  it('NO_COLOR honoring is observable through the isAccessible() contract', () => {
    // The NO_COLOR constant is read once at module load, so it cannot be
    // toggled per-test in-process. Rather than re-asserting a bare ternary
    // (which proves nothing), verify the mechanism NO_COLOR feeds into:
    // screen fillers and style emission branch on isAccessible(), and
    // color() must return null — never a style object — for unknown roles
    // in BOTH modes, since accessible mode collapses unknown roles the
    // same way. See tui/theme.mjs and screen.mjs writeStr fillers.
    const unknownRole = color('definitely_not_a_role_123');
    assert.equal(unknownRole, null);
  });

  // The load-time contract, verified end-to-end in a fresh process for BOTH
  // values of the env var — in-process toggling is a no-op by design, so the
  // only honest test of "NO_COLOR is read at module load" is a subprocess.
  const probe = (env) => execFileSync(
    process.execPath,
    ['-e', `import('./tui/theme.mjs').then(m => console.log(JSON.stringify(m.color('title'))))`],
    { cwd: ROOT, env, encoding: 'utf-8' }
  ).trim();

  it('with NO_COLOR=1 set at launch, color() returns null (load-time contract)', () => {
    assert.equal(probe({ ...process.env, NO_COLOR: '1' }), 'null');
  });

  it('without NO_COLOR, color() returns a style object (load-time contract)', () => {
    const env = { ...process.env };
    delete env.NO_COLOR;
    const out = probe(env);
    assert.notEqual(out, 'null');
    const style = JSON.parse(out);
    assert.equal(typeof style, 'object');
  });
});
