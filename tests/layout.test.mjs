// Stat-card layout — responsive spreading, wrapping, and centering.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getStatCardLayout, MAX_STAT_CARD_WIDTH } from '../tui/layout.mjs';

describe('getStatCardLayout', () => {
  it('spreads cards across wide terminals (xl)', () => {
    assert.deepEqual(getStatCardLayout(210), { cardWidth: 36, gap: 2, cardsPerRow: 5, startX: 11 });
    assert.deepEqual(getStatCardLayout(120), { cardWidth: 21, gap: 2, cardsPerRow: 5, startX: 3 });
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

  it('keeps cardWidth wide enough for the "ACCOUNT AGE" label at all sane widths', () => {
    for (let w = 60; w <= 220; w += 10) {
      const l = getStatCardLayout(w);
      assert.ok(l.cardWidth >= 15, `width ${w} cardWidth ${l.cardWidth} < 15`);
    }
  });
});
