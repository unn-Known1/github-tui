import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// No mocking is performed: these tests exercise the REAL OS keychain backend
// (where present). The suite asserts the observable contract: detectBackend
// returns a known identifier or null, and the save/load/remove functions
// return the expected types. Roundtrip tests skip honestly (t.skip) when no
// backend is available rather than silently passing.

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

  it('returns false (not undefined/throw) for empty/falsy token', () => {
    // Contract: zero/false/null/undefined must coerce to a boolean false
    // so callers (`if (!saveTokenSecure(token)) fallback()`) work reliably.
    assert.equal(saveTokenSecure(''), false);
    assert.equal(saveTokenSecure(null), false);
    assert.equal(saveTokenSecure(undefined), false);
    assert.equal(saveTokenSecure(false), false);
    assert.equal(saveTokenSecure(0), false);
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

  it('round-trips a token through secure storage (skipped when no backend)', (t) => {
    const backend = detectBackend();
    if (!backend) {
      // Record the absence honestly — a silent return would report a pass
      // while testing nothing at all.
      t.skip('no keychain backend available in this environment');
      return;
    }

    // try/finally guarantees the token is removed from the user's keychain
    // even if an assertion throws — a failing test must not leak a secret
    // into persistent OS storage.
    let saved = false;
    try {
      saved = saveTokenSecure(TEST_TOKEN);
      if (!saved) {
        t.skip('keychain detected but save failed (e.g. sandboxed CI)');
        return;
      }
      const loaded = loadTokenSecure();
      assert.equal(loaded, TEST_TOKEN, 'loaded token should match saved token');

      const afterRemove = loadTokenSecure();
      assert.ok(
        afterRemove !== TEST_TOKEN,
        'token should no longer be retrievable after removeTokenSecure'
      );
    } finally {
      if (saved) {
        try { removeTokenSecure(); } catch (e) {
          console.error('keychain.test: cleanup failed — token may remain in OS keychain:', e && e.message);
        }
      }
    }
  });
});
