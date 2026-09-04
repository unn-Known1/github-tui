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
});

describe('summarizeChecks', () => {
  it('counts passed / failed / pending', () => {
    const runs = [
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'failure' },
      { status: 'completed', conclusion: 'neutral' },
      { status: 'in_progress', conclusion: null },
    ];
    assert.deepEqual(summarizeChecks(runs), { success: 2, failed: 1, pending: 1 });
  });

  it('handles empty / non-array input', () => {
    assert.deepEqual(summarizeChecks([]), { success: 0, failed: 0, pending: 0 });
    assert.deepEqual(summarizeChecks(null), { success: 0, failed: 0, pending: 0 });
  });
});
