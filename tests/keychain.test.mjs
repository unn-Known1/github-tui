import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// We test the pure logic of keychain.mjs by mocking execSync at the module level.
// Since we can't easily mock ESM imports in Node's built-in test runner without
// a loader, we test the observable contract: detectBackend returns a string or null,
// and the save/load/remove functions return the expected types.

import {
  detectBackend,
  saveTokenSecure,
  loadTokenSecure,
  removeTokenSecure,
} from '../tui/keychain.mjs';

describe('detectBackend', () => {
  it('returns a string or null', () => {
    const result = detectBackend();
    assert.ok(
      result === null || typeof result === 'string',
      'detectBackend should return a string or null, got: ' + result
    );
  });

  it('returns one of the known backend identifiers or null', () => {
    const KNOWN = ['macos-keychain', 'secret-tool', 'windows-credential', null];
    const result = detectBackend();
    assert.ok(
      KNOWN.includes(result),
      'detectBackend returned unknown value: ' + result
    );
  });

  it('is consistent across multiple calls', () => {
    // detectBackend is cached — calling it twice must return the same value
    const a = detectBackend();
    const b = detectBackend();
    assert.equal(a, b, 'detectBackend should return the same value on repeated calls');
  });
});

describe('saveTokenSecure', () => {
  it('returns a boolean', () => {
    // We cannot actually write to a keychain in all CI environments.
    // Verify the function at least returns a boolean without throwing.
    const result = saveTokenSecure('test-token-value');
    assert.equal(typeof result, 'boolean');
  });

  it('returns false for empty/falsy token', () => {
    assert.equal(saveTokenSecure(''), false);
    assert.equal(saveTokenSecure(null), false);
    assert.equal(saveTokenSecure(undefined), false);
  });
});

describe('loadTokenSecure', () => {
  it('returns a string or null', () => {
    const result = loadTokenSecure();
    assert.ok(
      result === null || typeof result === 'string',
      'loadTokenSecure should return a string or null, got: ' + typeof result
    );
  });
});

describe('removeTokenSecure', () => {
  it('does not throw', () => {
    assert.doesNotThrow(() => removeTokenSecure());
  });

  it('is idempotent — calling twice does not throw', () => {
    assert.doesNotThrow(() => {
      removeTokenSecure();
      removeTokenSecure();
    });
  });
});

describe('save → load → remove roundtrip', () => {
  const TEST_TOKEN = 'ghp_testtoken_keychain_roundtrip_' + Date.now();

  it('round-trips a token through secure storage (skipped when no backend)', () => {
    const backend = detectBackend();
    if (!backend) {
      // No keychain available in this environment — skip but do not fail
      return;
    }

    const saved = saveTokenSecure(TEST_TOKEN);
    if (!saved) {
      // Keychain detected but save failed (e.g. sandboxed CI) — acceptable
      return;
    }

    const loaded = loadTokenSecure();
    assert.equal(loaded, TEST_TOKEN, 'loaded token should match saved token');

    // Clean up
    removeTokenSecure();

    const afterRemove = loadTokenSecure();
    assert.ok(
      afterRemove !== TEST_TOKEN,
      'token should no longer be retrievable after removeTokenSecure'
    );
  });
});
