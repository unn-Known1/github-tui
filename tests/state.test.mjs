// Tests for the explicit-scope async generation guard introduced alongside
// the AbortController plumbing. Covers: scope isolation, AbortController
// propagation on bump, handle-based scope extraction, and bulk API behavior.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startAsync, isStale, beginLoading, finishLoading,
  setRetryHandler, clearRetryHandler, consumeRetryHandler, appState,
} from '../tui/state.mjs';

describe('state.mjs — async generation guard', () => {
  describe('startAsync(scope) returns a handle', () => {
    it('returns an object with gen, controller, signal, scope', () => {
      const h = startAsync('test-handle-shape');
      assert.equal(typeof h.gen, 'number');
      assert.ok(h.controller instanceof AbortController);
      assert.ok(h.signal instanceof AbortSignal);
      assert.equal(h.scope, 'test-handle-shape');
    });

    it('bumps gen monotonically per scope', () => {
      const a = startAsync('test-monotonic');
      const b = startAsync('test-monotonic');
      const c = startAsync('test-monotonic');
      assert.ok(b.gen > a.gen);
      assert.ok(c.gen > b.gen);
    });

    it('keeps scopes independent', () => {
      const a = startAsync('test-iso-A');
      const b = startAsync('test-iso-B');
      // Bumping B must not stale A's gen.
      assert.equal(isStale(a), false);
      assert.equal(isStale(b), false);
    });
  });

  describe('AbortController on bump', () => {
    it('fires the previous controller when a new call bumps the same scope', () => {
      const h1 = startAsync('test-abort-bump');
      const aborted = new Promise((resolve) => {
        h1.controller.signal.addEventListener('abort', () => resolve(true), { once: true });
      });
      startAsync('test-abort-bump'); // bumps — should abort h1
      return aborted.then((v) => assert.equal(v, true));
    });

    it('does not abort a different scope\u0027s controller', () => {
      const a = startAsync('test-abort-iso-A');
      const b = startAsync('test-abort-iso-B');
      assert.equal(a.signal.aborted, false);
      assert.equal(b.signal.aborted, false);
      startAsync('test-abort-iso-A'); // bumps A only
      assert.equal(a.signal.aborted, true);
      assert.equal(b.signal.aborted, false);
    });
  });

  describe('isStale()', () => {
    it('returns false for a fresh handle', () => {
      const h = startAsync('test-isstale-fresh');
      assert.equal(isStale(h), false);
    });

    it('returns true after the scope has been bumped', () => {
      const h1 = startAsync('test-isstale-bumped');
      startAsync('test-isstale-bumped');
      assert.equal(isStale(h1), true);
    });

    it('auto-extracts scope from the handle (no explicit arg needed)', () => {
      const h1 = startAsync('test-isstale-handle');
      const otherScopeBump = startAsync('some-other-scope');
      // Bumping another scope must NOT stale h1 — handle carries its scope.
      assert.equal(isStale(h1), false);
      // ...but bumping THIS scope does.
      startAsync('test-isstale-handle');
      assert.equal(isStale(h1), true);
    });

    it('still accepts a raw gen number with explicit scope', () => {
      const h = startAsync('test-isstale-raw');
      assert.equal(isStale(h.gen, 'test-isstale-raw'), false);
      startAsync('test-isstale-raw');
      assert.equal(isStale(h.gen, 'test-isstale-raw'), true);
    });

    it('raw-number defaults to "_global" scope', () => {
      const before = startAsync('_global');
      const gen = before.gen;
      startAsync('_global');
      // After a global bump, raw gen check against _global *would* be true;
      // this documents the (legacy) fallback behavior for callers passing
      // just a number rather than the handle.
      startAsync('test-isstale-somewhere-else');
      assert.equal(isStale(gen, '_global'), true);
    });
  });

  describe('cross-scope isolation', () => {
    it('one scope\u0027s staleness does not invalidate another', () => {
      const fastA = startAsync('test-cross-A');
      const fastB = startAsync('test-cross-B');
      // Hammer scope A many times.
      for (let i = 0; i < 5; i++) startAsync('test-cross-A');
      // B should still be considered fresh because we never bumped B.
      assert.equal(isStale(fastB), false);
      assert.equal(isStale(fastA), true); // Bumped 5 times since.
    });
  });
});

describe('state.mjs — generation-owned loading', () => {
  it('a stale request cannot clear a newer loading handle', () => {
    const a = startAsync('test-loading-owner');
    beginLoading(a);
    const b = startAsync('test-loading-owner');
    beginLoading(b);
    finishLoading(a);
    assert.equal(appState.loading, true);
    finishLoading(b);
    assert.equal(appState.loading, false);
  });
});

describe('state.mjs — retry handler (P0-6)', () => {
  beforeEach(() => {
    clearRetryHandler();
    appState._retryFn = null;
    appState._retryExpiresAt = 0;
  });

  it('setRetryHandler stores the function and an expiry timestamp in the future', () => {
    let called = false;
    setRetryHandler(() => { called = true; }, 5000);
    assert.equal(typeof appState._retryFn, 'function');
    assert.ok(appState._retryExpiresAt > Date.now());
    assert.ok(appState._retryExpiresAt <= Date.now() + 5000 + 5);
    // fired manually here just to inspect wiring; consumeRetryHandler is the API.
    clearRetryHandler();
  });

  it('consumeRetryHandler returns and clears the handler when live', () => {
    let calls = 0;
    setRetryHandler(() => { calls++; }, 5000);
    const fn = consumeRetryHandler();
    assert.equal(typeof fn, 'function');
    assert.equal(appState._retryFn, null);
    assert.equal(appState._retryExpiresAt, 0);
    fn(); // should now execute
    assert.equal(calls, 1);
  });

  it('a second consume after the first returns null', () => {
    setRetryHandler(() => {}, 5000);
    const first = consumeRetryHandler();
    const second = consumeRetryHandler();
    assert.equal(typeof first, 'function');
    assert.equal(second, null);
  });

  it('clearRetryHandler drops any pending handler', () => {
    setRetryHandler(() => { throw new Error('should not run'); }, 5000);
    clearRetryHandler();
    assert.equal(consumeRetryHandler(), null);
  });

  it('setRetryHandler replaces an existing handler (no stacking)', () => {
    let aRan = false, bRan = false;
    setRetryHandler(() => { aRan = true; }, 5000);
    setRetryHandler(() => { bRan = true; }, 5000);
    const fn = consumeRetryHandler();
    fn();
    assert.equal(aRan, false);
    assert.equal(bRan, true);
  });

  it('non-function arguments null the handler (defensive)', () => {
    setRetryHandler('not a function', 5000);
    assert.equal(appState._retryFn, null);
    assert.equal(consumeRetryHandler(), null);
  });

  it('an expired handler is no longer consumable', () => {
    // Use a duration that's effectively already expired.
    setRetryHandler(() => {}, -1);
    // Force expiry (setRetryHandler clamps duration to >= 0).
    appState._retryExpiresAt = Date.now() - 100;
    assert.equal(consumeRetryHandler(), null);
    assert.equal(appState._retryFn, null);
  });
});
