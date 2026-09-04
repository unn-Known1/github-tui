// Regression tests for the live API rate-limit mirror.
// Covers: monotonic down-only, stale-window ignore, new-window restore,
// limit-mismatch isolation, NaN safety, authoritative resync, reset.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lastRateLimit, updateRateLimit, resyncRateLimit, resetRateLimit } from '../tui/github.mjs';

const T0 = 2000000000;

describe('updateRateLimit mirror', () => {
  it('baseline accepts first headers', () => {
    resetRateLimit();
    updateRateLimit(5000, 4999, T0);
    assert.equal(lastRateLimit.limit, 5000);
    assert.equal(lastRateLimit.remaining, 4999);
    assert.equal(lastRateLimit.reset, T0);
  });

  it('same window only moves down (ignores stale higher remaining)', () => {
    resetRateLimit();
    updateRateLimit(5000, 4999, T0);
    updateRateLimit(5000, 4998, T0);
    assert.equal(lastRateLimit.remaining, 4998);
    updateRateLimit(5000, 4999, T0);
    assert.equal(lastRateLimit.remaining, 4998);
  });

  it('ignores late arrival from a previous window', () => {
    resetRateLimit();
    updateRateLimit(5000, 4998, T0);
    updateRateLimit(5000, 4990, T0 - 3600);
    assert.equal(lastRateLimit.remaining, 4998);
    assert.equal(lastRateLimit.reset, T0);
  });

  it('ignores same-window response with a different limit (no bucket mixing)', () => {
    resetRateLimit();
    updateRateLimit(5000, 4998, T0);
    updateRateLimit(60, 59, T0);
    assert.equal(lastRateLimit.limit, 5000);
    assert.equal(lastRateLimit.remaining, 4998);
  });

  it('new window restores remaining upward', () => {
    resetRateLimit();
    updateRateLimit(5000, 4998, T0);
    updateRateLimit(5000, 5000, T0 + 3600);
    assert.equal(lastRateLimit.remaining, 5000);
    assert.equal(lastRateLimit.reset, T0 + 3600);
  });

  it('ignores NaN / malformed headers', () => {
    resetRateLimit();
    updateRateLimit(5000, 4999, T0);
    updateRateLimit(NaN, NaN, NaN);
    assert.equal(lastRateLimit.remaining, 4999);
    updateRateLimit(5000, NaN, T0);
    assert.equal(lastRateLimit.remaining, 4999);
  });
});

describe('resyncRateLimit authoritative poll', () => {
  it('corrects in both directions within the same window', () => {
    resetRateLimit();
    updateRateLimit(5000, 5000, T0);
    resyncRateLimit(5000, 4990, T0);
    assert.equal(lastRateLimit.remaining, 4990);
    resyncRateLimit(5000, 4995, T0);
    assert.equal(lastRateLimit.remaining, 4995);
  });

  it('ignores a poll from a different window than the live mirror', () => {
    // Observed live: poll body 5000/reset-T+60min vs core headers
    // 4594/reset-T+18min. Overwriting would pin the counter at 5000.
    resetRateLimit();
    updateRateLimit(5000, 4594, T0);
    resyncRateLimit(5000, 5000, T0 + 3600);
    assert.equal(lastRateLimit.remaining, 4594);
    assert.equal(lastRateLimit.reset, T0);
  });

  it('baseline (no stored window) still accepts the poll', () => {
    resetRateLimit();
    resyncRateLimit(5000, 4990, T0);
    assert.equal(lastRateLimit.remaining, 4990);
    assert.equal(lastRateLimit.reset, T0);
  });

  it('rejects malformed payloads', () => {
    resetRateLimit();
    updateRateLimit(5000, 4999, T0);
    resyncRateLimit(NaN, NaN, NaN);
    assert.equal(lastRateLimit.remaining, 4999);
    resyncRateLimit(-1, 10, T0);
    assert.equal(lastRateLimit.limit, 5000);
  });
});

describe('resetRateLimit', () => {
  it('clears counter and scopes for account switch', () => {
    updateRateLimit(5000, 4999, T0);
    resetRateLimit();
    assert.equal(lastRateLimit.remaining, null);
    assert.equal(lastRateLimit.limit, null);
    assert.equal(lastRateLimit.reset, null);
  });
});
