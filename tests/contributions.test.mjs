// Tests for paged contribution-events loading (heatmap window fill).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContributionEvents, CONTRIB_DAYS, buildHeatmap } from '../tui/tabs/dashboard.mjs';

const dayMs = 86400000;
const isoDaysAgo = (n) => new Date(Date.now() - n * dayMs).toISOString();
const makePage = (count, newestAgeDays, stepDays = 0.2) =>
  Array.from({ length: count }, (_, i) => ({
    type: 'PushEvent',
    created_at: isoDaysAgo(newestAgeDays + i * stepDays),
    payload: { size: 1 },
  }));

describe('loadContributionEvents', () => {
  it('stops after a short (last) page', async () => {
    let calls = 0;
    const fetchPage = async () => { calls++; return makePage(20, 1); };
    const events = await loadContributionEvents('t', 'u', null, fetchPage);
    assert.equal(events.length, 20);
    assert.equal(calls, 1);
  });

  it('pages while full pages stay inside the window, caps at 3', async () => {
    let calls = 0;
    // 100 events spanning ~20 days per page — all inside the 105-day window.
    const fetchPage = async (t, u, perPage, signal, page) => {
      calls++;
      assert.equal(perPage, 100);
      return makePage(100, (page - 1) * 20);
    };
    const events = await loadContributionEvents('t', 'u', null, fetchPage);
    assert.equal(calls, 3);
    assert.equal(events.length, 300);
  });

  it('stops early once events predate the heatmap window', async () => {
    let calls = 0;
    const fetchPage = async (t, u, perPage, signal, page) => {
      calls++;
      if (page === 1) return makePage(100, 1); // recent ~7 days
      return makePage(100, CONTRIB_DAYS + 30); // all older than window
    };
    const events = await loadContributionEvents('t', 'u', null, fetchPage);
    assert.equal(calls, 2);
    assert.equal(events.length, 200);
  });

  it('returns empty for an empty feed', async () => {
    const events = await loadContributionEvents('t', 'u', null, async () => []);
    assert.deepEqual(events, []);
  });

  it('fills heatmap days beyond the first week', async () => {
    // Simulate an active user: 100 recent events + 100 older ones (~60d back).
    const fetchPage = async (t, u, perPage, signal, page) =>
      page === 1 ? makePage(100, 1) : makePage(100, 60, 0.1);
    const events = await loadContributionEvents('t', 'u', null, fetchPage);
    const heat = buildHeatmap(events, []);
    const perDay = heat.perDay;
    const activeDays = perDay.filter((v) => v > 0).length;
    assert.ok(activeDays > 7, `expected activity beyond 7 days, got ${activeDays} active days`);
    // Oldest synthetic event (~70d ago) is inside the 105-day grid.
    const oldIdx = perDay.length - 1 - Math.round(70);
    assert.ok(perDay.slice(0, oldIdx + 1).some((v) => v > 0));
  });
});
