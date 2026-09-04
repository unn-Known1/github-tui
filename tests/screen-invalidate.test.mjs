// Tests for Screen.invalidate() — full repaint convergence on view switches.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Screen } from '../tui/screen.mjs';

function makeScreen(w = 20, h = 6) {
  const s = new Screen();
  s.width = w; s.height = h;
  s._init();
  return s;
}

function captureRender(s) {
  let out = '';
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { out += chunk; return true; };
  try { s.render(); } finally { process.stdout.write = orig; }
  return out;
}

function positionMoves(stream) {
  const m = stream.match(/\x1b\[\d+;\d+H/g);
  return m ? m.length : 0;
}

describe('Screen.invalidate', () => {
  it('normal renders are diffs (fewer cells emitted)', () => {
    const s = makeScreen();
    s.writeStr(2, 1, 'hello', null);
    captureRender(s); // full first frame
    s.writeStr(2, 1, 'hello', null); // identical content
    s.writeStr(2, 2, 'world', null); // one new row
    const out = captureRender(s);
    // Only the new row's 5 cells emitted, not the full 120-cell frame.
    assert.ok(positionMoves(out) < 20 * 6, `expected diff, got ${positionMoves(out)} moves`);
  });

  it('invalidate forces a full-frame emission', () => {
    const s = makeScreen();
    s.writeStr(2, 1, 'hello', null);
    captureRender(s);
    s.writeStr(2, 1, 'HELLO', null);
    s.invalidate();
    const out = captureRender(s);
    // Every cell re-asserted via absolute cursor moves.
    assert.equal(positionMoves(out), 20 * 6);
  });

  it('full repaint converges a diverged terminal (ghost scenario)', () => {
    const s = makeScreen();
    s.writeStr(2, 1, '▶ old tab ★', null);
    captureRender(s);
    // New view paints different content at the same rows...
    s.writeStr(2, 1, 'Config', null);
    // ...but the terminal kept a stale glyph where the model says space
    // (e.g. wide-glyph width disagreement). Without invalidate the cell is
    // skipped (model space === prev space) and the ghost survives.
    // With invalidate the space is emitted and the ghost is cleared.
    s.invalidate();
    const out = captureRender(s);
    assert.equal(positionMoves(out), 20 * 6);
  });
});
