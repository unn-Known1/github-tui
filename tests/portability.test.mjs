// Tests for tui/portability.mjs — config bundle build/validate/import.
// validatePortableConfig is exercised purely in-process. The file-writing
// import/export tests run in a SUBPROCESS with HOME pointed at a sandbox:
// portability.mjs binds its config file paths to homedir() at module-load
// time, so changing process.env.HOME inside this process has no effect.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Runs one import round in a child process with a sandboxed HOME; returns
// { out, home } where home is the sandbox that received the written files.
function runImport(bundle, opts = '{ merge: false }', existingHome = null) {
  const home = existingHome || mkdtempSync(join(tmpdir(), 'gtp-'));
  const bundlePath = join(home, 'bundle-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.json');
  writeFileSync(bundlePath, JSON.stringify(bundle));
  const script = `
    import('./tui/portability.mjs')
      .then(m => m.importPortableConfig(${JSON.stringify(bundlePath)}, ${opts}))
      .then(r => console.log('OK ' + JSON.stringify(r)))
      .catch(e => { console.error('ERR ' + e.message); process.exit(3); });
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf-8',
  }).trim();
  return { out, home };
}

function readConfig(home, name) {
  return JSON.parse(readFileSync(join(home, '.github-tui', name), 'utf8'));
}

describe('portability.validatePortableConfig', () => {
  it('accepts a well-formed bundle', async () => {
    const mod = await import('../tui/portability.mjs');
    const r = mod.validatePortableConfig({
      schemaVersion: 1,
      bookmarks: [{ id: 'bm_1', full_name: 'a/b', url: 'https://x' }],
      pins: [{ id: 'p1' }],
      session: { tab: 1, lastSeenVersion: '0.0.0' },
      theme: 'dark',
      repoPreferences: {},
    });
    assert.deepEqual(r, { ok: true });
  });

  it('rejects non-object and array bundles', async () => {
    const mod = await import('../tui/portability.mjs');
    assert.equal(mod.validatePortableConfig(null).ok, false);
    assert.equal(mod.validatePortableConfig('x').ok, false);
    assert.equal(mod.validatePortableConfig([1]).ok, false);
  });

  it('rejects non-object array elements (previously truthy junk passed)', async () => {
    const mod = await import('../tui/portability.mjs');
    const r = mod.validatePortableConfig({ schemaVersion: 1, bookmarks: ['junk'] });
    assert.equal(r.ok, false);
    assert.match(r.error, /array of objects/);
  });

  it('rejects non-object repoPreferences', async () => {
    const mod = await import('../tui/portability.mjs');
    const r = mod.validatePortableConfig({ schemaVersion: 1, repoPreferences: 'x' });
    assert.equal(r.ok, false);
    assert.match(r.error, /repoPreferences/);
  });

  it('rejects non-object session', async () => {
    const mod = await import('../tui/portability.mjs');
    const r = mod.validatePortableConfig({ schemaVersion: 1, session: [1] });
    assert.equal(r.ok, false);
    assert.match(r.error, /session/);
  });

  it('rejects session keys outside the navigation-only allow-list', async () => {
    const mod = await import('../tui/portability.mjs');
    const r = mod.validatePortableConfig({ schemaVersion: 1, session: { token: 'secret' } });
    assert.equal(r.ok, false);
    assert.match(r.error, /not an allowed session key/);
  });

  it('rejects a non-string theme', async () => {
    const mod = await import('../tui/portability.mjs');
    const r = mod.validatePortableConfig({ schemaVersion: 1, theme: 7 });
    assert.equal(r.ok, false);
    assert.match(r.error, /theme/);
  });

  it('rejects unknown schemaVersion', async () => {
    const mod = await import('../tui/portability.mjs');
    const r = mod.validatePortableConfig({ schemaVersion: 99 });
    assert.equal(r.ok, false);
    assert.match(r.error, /schema version/);
  });
});

describe('portability.importPortableConfig (subprocess, sandboxed HOME)', () => {
  it('throws a friendly error for a missing bundle file', () => {
    const home = mkdtempSync(join(tmpdir(), 'gtp-'));
    const missing = join(home, 'does-not-exist.json');
    let stderr = '';
    try {
      execFileSync(process.execPath, ['-e',
        `import('./tui/portability.mjs').then(m => m.importPortableConfig(${JSON.stringify(missing)}))`],
        { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
      assert.fail('should have thrown');
    } catch (e) {
      stderr = e.stderr || e.stdout || '';
    }
    assert.match(stderr, /Config bundle not found/);
  });

  it('throws a friendly error for invalid JSON', () => {
    const home = mkdtempSync(join(tmpdir(), 'gtp-'));
    const bad = join(home, 'bad.json');
    writeFileSync(bad, '{not json');
    try {
      execFileSync(process.execPath, ['-e',
        `import('./tui/portability.mjs').then(m => m.importPortableConfig(${JSON.stringify(bad)}))`],
        { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
      assert.fail('should have thrown');
    } catch (e) {
      assert.match(e.stderr || '', /not valid JSON/);
    }
  });

  it('throws a friendly error for an oversized bundle', () => {
    const home = mkdtempSync(join(tmpdir(), 'gtp-'));
    const big = join(home, 'big.json');
    writeFileSync(big, 'x'.repeat(6 * 1024 * 1024));
    try {
      execFileSync(process.execPath, ['-e',
        `import('./tui/portability.mjs').then(m => m.importPortableConfig(${JSON.stringify(big)}))`],
        { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
      assert.fail('should have thrown');
    } catch (e) {
      assert.match(e.stderr || '', /too large/);
    }
  });

  it('round-trips a bundle and writes theme + session at 0600', () => {
    const { home } = runImport({
      schemaVersion: 1,
      bookmarks: [{ id: 'bm_1', full_name: 'a/b' }],
      theme: 'light',
      session: { tab: 2, lastSeenVersion: '9.9.9' },
    });
    const configDir = join(home, '.github-tui');
    for (const name of ['bookmarks.json', 'theme', 'session.json']) {
      const mode = statSync(join(configDir, name)).mode & 0o777;
      assert.equal(mode, 0o600, name + ' must be 0600');
    }
    // Theme is a RAW string file (no JSON quotes).
    assert.equal(readFileSync(join(configDir, 'theme'), 'utf8'), 'light');
    const sessionState = JSON.parse(readFileSync(join(configDir, 'session.json'), 'utf8'));
    assert.equal(sessionState.tab, 2);
  });

  it('replace-mode preserves fields the bundle omits (no silent wipe)', () => {
    const home = mkdtempSync(join(tmpdir(), 'gtp-'));
    // First import seeds bookmarks (into the same sandboxed home).
    runImport({ schemaVersion: 1, bookmarks: [{ id: 'bm_1', full_name: 'keep/me' }] }, '{ merge: false }', home);
    // Second bundle carries only pins — bookmarks must survive.
    runImport({ schemaVersion: 1, pins: [{ id: 'p1' }] }, '{ merge: false }', home);
    assert.deepEqual(readConfig(home, 'bookmarks.json'), [{ id: 'bm_1', full_name: 'keep/me' }]);
    assert.deepEqual(readConfig(home, 'pins.json'), [{ id: 'p1' }]);
  });
});
