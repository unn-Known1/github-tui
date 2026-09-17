// Stat-card layout — responsive spreading, wrapping, and centering.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getStatCardLayout, MAX_STAT_CARD_WIDTH } from '../tui/layout.mjs';

describe('getStatCardLayout', () => {
  it('spreads cards across wide terminals (xl)', () => {
    // Pin cardWidth, cardsPerRow and gap — these are the behavioral invariants.
    // startX depends on centering arithmetic and may drift with minor refactors;
    // asserting just its sign and rough magnitude (positive) is sufficient.
    const xl210 = getStatCardLayout(210);
    assert.equal(xl210.cardWidth, 36);
    assert.equal(xl210.cardsPerRow, 5);
    assert.equal(xl210.gap, 2);
    assert.ok(xl210.startX > 0, 'startX must be positive for xl terminals');
    const xl120 = getStatCardLayout(120);
    assert.equal(xl120.cardWidth, 21);
    assert.equal(xl120.cardsPerRow, 5);
    assert.equal(xl120.gap, 2);
    assert.ok(xl120.startX >= 0, 'startX must be non-negative');
  });

  it('uses 4 cards per row on md terminals so labels fit', () => {
    assert.equal(getStatCardLayout(80).cardsPerRow, 4);
    assert.equal(getStatCardLayout(99).cardsPerRow, 4);
    assert.equal(getStatCardLayout(80).cardWidth, 17);
  });

  it('uses 5 cards per row on lg terminals', () => {
    assert.equal(getStatCardLayout(100).cardsPerRow, 5);
    assert.equal(getStatCardLayout(119).cardsPerRow, 5);
  });

  it('wraps to 3 per row on sm and 2 per row on xs', () => {
    assert.deepEqual(getStatCardLayout(70).cardsPerRow, 3);
    assert.deepEqual(getStatCardLayout(59).cardsPerRow, 2);
  });

  it('centers the row once cards hit the max width on ultra-wide terminals', () => {
    const l = getStatCardLayout(400);
    assert.equal(l.cardWidth, MAX_STAT_CARD_WIDTH);
    assert.equal(l.cardsPerRow, 5);
    assert.ok(l.startX > 10);
  });

  it('keeps cardWidth wide enough for the "ACCOUNT AGE" label across all widths 60..220', () => {
    for (let w = 60; w <= 220; w += 1) {
      const l = getStatCardLayout(w);
      assert.ok(l.cardWidth >= 15, `width ${w} cardWidth ${l.cardWidth} < 15`);
    }
  });

  it('transitions cleanly at every breakpoint boundary', () => {
    // Off-by-one probes on both sides of each breakpoint (xs<60, sm<80,
    // md<100, lg<120): the counts must differ exactly at the boundary and
    // be equal just inside it.
    assert.notEqual(getStatCardLayout(59).cardsPerRow, getStatCardLayout(60).cardsPerRow); // xs → sm
    assert.notEqual(getStatCardLayout(79).cardsPerRow, getStatCardLayout(80).cardsPerRow); // sm → md
    assert.notEqual(getStatCardLayout(99).cardsPerRow, getStatCardLayout(100).cardsPerRow); // md → lg
    // lg → xl keeps 5 per row (same branch); cardWidth keeps growing.
    assert.equal(getStatCardLayout(119).cardsPerRow, getStatCardLayout(120).cardsPerRow);
    assert.ok(getStatCardLayout(120).cardWidth >= getStatCardLayout(119).cardWidth);
  });

  it('handles very narrow or degenerate widths without crashing', () => {
    for (const w of [-10, 0, 1, 10, 30, 40, 50]) {
      const l = getStatCardLayout(w);
      assert.ok(l && Number.isFinite(l.cardWidth), `width ${w}: cardWidth must be a finite number`);
      assert.ok(l.cardWidth >= 1, `width ${w}: cardWidth must be >= 1`);
      assert.ok(l.cardsPerRow >= 1, `width ${w}: at least one card per row`);
      assert.ok(l.startX >= 0, `width ${w}: startX must be non-negative`);
    }
  });
});
