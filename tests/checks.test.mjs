// Tests for Checks pane helpers (analyze-checks.mjs).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkRunIcon, summarizeChecks } from '../tui/tabs/analyze-checks.mjs';

describe('checkRunIcon', () => {
  it('shows pending icon while not completed', () => {
    assert.equal(checkRunIcon({ status: 'in_progress', conclusion: null }), '⏳');
    assert.equal(checkRunIcon({ status: 'queued', conclusion: null }), '⏳');
    assert.equal(checkRunIcon(null), '⏳');
  });

  it('maps completed conclusions', () => {
    assert.equal(checkRunIcon({ status: 'completed', conclusion: 'success' }), '✅');
    assert.equal(checkRunIcon({ status: 'completed', conclusion: 'failure' }), '❌');
    assert.equal(checkRunIcon({ status: 'completed', conclusion: 'cancelled' }), '⚠️');
  });

  it('maps non-binary conclusions instead of unknown', () => {
    assert.equal(checkRunIcon({ status: 'completed', conclusion: 'neutral' }), '➖');
    assert.equal(checkRunIcon({ status: 'completed', conclusion: 'skipped' }), '➖');
    assert.equal(checkRunIcon({ status: 'completed', conclusion: 'timed_out' }), '⏱️');
    assert.equal(checkRunIcon({ status: 'completed', conclusion: 'action_required' }), '❗');
    assert.equal(checkRunIcon({ status: 'completed', conclusion: 'stale' }), '📦');
  });

  it('falls back to unknown for unrecognized conclusions', () => {
    assert.equal(checkRunIcon({ status: 'completed', conclusion: 'weird' }), '❓');
  });

  it('handles missing fields without throwing', () => {
    assert.doesNotThrow(() => checkRunIcon(undefined));
    assert.doesNotThrow(() => checkRunIcon({}));
    assert.doesNotThrow(() => checkRunIcon({ status: 'completed' }));
  });
});

describe('summarizeChecks', () => {
  it('counts passed / failed / pending', () => {
    const runs = [
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'failure' },
      { status: 'in_progress', conclusion: null },
    ];
    assert.deepEqual(summarizeChecks(runs), { success: 2, failed: 1, pending: 1 });
  });

  it('partitions non-binary completed conclusions without counting them as pending', () => {
    // Contract: "pending" means *not completed*. A completed run with a
    // non-binary conclusion (neutral/skipped/timed_out/...) is NOT pending —
    // it is also not success/failed, so it drops out of all three buckets.
    // This test pins the contract so the buckets cannot silently drift
    // (e.g. a completed-but-neutral run being miscounted as pending).
    const runs = [
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'failure' },
      { status: 'completed', conclusion: 'neutral' },
      { status: 'completed', conclusion: 'skipped' },
      { status: 'completed', conclusion: 'timed_out' },
      { status: 'completed', conclusion: 'action_required' },
      { status: 'completed', conclusion: 'stale' },
      { status: 'in_progress', conclusion: null },
      { status: 'queued', conclusion: null },
    ];
    const summary = summarizeChecks(runs);
    // Every run is accounted for: success + failed + (completed non-binary) + pending = total.
    const nonBinaryCompleted = 5; // neutral, skipped, timed_out, action_required, stale
    assert.equal(
      summary.success + summary.failed + nonBinaryCompleted + summary.pending,
      runs.length,
      'every run must land in exactly one bucket'
    );
    assert.equal(summary.pending, 2, 'only non-completed runs are pending');
  });

  it('handles empty / non-array / malformed input', () => {
    const EMPTY = { success: 0, failed: 0, pending: 0 };
    assert.deepEqual(summarizeChecks([]), EMPTY);
    assert.deepEqual(summarizeChecks(null), EMPTY);
    assert.deepEqual(summarizeChecks(undefined), EMPTY);
    assert.deepEqual(summarizeChecks('not-an-array'), EMPTY);
    // Malformed objects must not throw and must not fabricate buckets.
    assert.deepEqual(summarizeChecks([{}]), { success: 0, failed: 0, pending: 1 });
    assert.deepEqual(summarizeChecks([{ status: 'completed' }]), { success: 0, failed: 0, pending: 0 });
  });
});
