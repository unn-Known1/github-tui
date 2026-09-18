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

  it('updateSize repaints fully even when dimensions are unchanged', async () => {
    const s = makeScreen();
    // Pin stdout dims to the fixture size so updateSize sees no change.
    // (Font-size changes fire resize events with identical cell counts
    // while the terminal reflows underneath us.)
    const colsDesc = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
    const rowsDesc = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
    Object.defineProperty(process.stdout, 'columns', { value: 20, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: 6, configurable: true });
    try {
      s.writeStr(2, 1, 'footer here', null);
      captureRender(s); // full first frame
      s.writeStr(2, 1, 'footer here', null);
      captureRender(s); // diff — footer row skipped
      s.updateSize(); // same dims, but the grid may have reflowed
      const out = captureRender(s);
      assert.equal(positionMoves(out), 20 * 6, 'same-size resize must repaint everything');
    } finally {
      if (colsDesc) Object.defineProperty(process.stdout, 'columns', colsDesc);
      if (rowsDesc) Object.defineProperty(process.stdout, 'rows', rowsDesc);
    }
  });

  it('every Nth render self-heals a diverged static row', async () => {
    const { SCREEN_FULL_REPAINT_EVERY } = await import('../tui/screen.mjs');
    const s = makeScreen();
    s.writeStr(2, 1, 'footer here', null);
    captureRender(s); // frame 1: full
    // Static footer for the next N-2 frames: diffs stay silent...
    for (let i = 2; i < SCREEN_FULL_REPAINT_EVERY; i++) {
      s.writeStr(2, 1, 'footer here', null);
      const out = captureRender(s);
      assert.equal(positionMoves(out), 0, 'frame ' + i + ' must stay a silent diff');
    }
    // ...until the periodic full repaint re-asserts every cell, so a
    // terminal that lost the row (reflow/clear/reattach) converges.
    s.writeStr(2, 1, 'footer here', null);
    const out = captureRender(s);
    assert.equal(positionMoves(out), 20 * 6, 'Nth frame must repaint everything');
  });
});

describe('terminal size probe + override', () => {
  it('parseSizeReport extracts rows/cols and preserves glued keys', async () => {
    const { parseSizeReport } = await import('../tui/screen.mjs');
    assert.deepEqual(parseSizeReport('\x1b[8;40;100t'), { rows: 40, cols: 100, rest: '' });
    assert.deepEqual(parseSizeReport('q\x1b[8;24;80t'), { rows: 24, cols: 80, rest: 'q' });
    assert.equal(parseSizeReport('plain keys'), null);
    assert.equal(parseSizeReport('\x1b[8;0;80t'), null, 'zero rows rejected');
    assert.equal(parseSizeReport('\x1b[8;24;9999t'), null, 'absurd cols rejected');
    assert.equal(parseSizeReport('\x1b[8;40'), null, 'truncated report is not a match');
  });

  it('env override beats pty dimensions', async () => {
    const colsDesc = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
    const rowsDesc = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
    const prevCols = process.env.GITHUB_TUI_COLS;
    const prevRows = process.env.GITHUB_TUI_ROWS;
    Object.defineProperty(process.stdout, 'columns', { value: 80, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: 24, configurable: true });
    process.env.GITHUB_TUI_COLS = '120';
    process.env.GITHUB_TUI_ROWS = '40';
    try {
      const { Screen } = await import('../tui/screen.mjs');
      const s = new Screen();
      s.updateSize();
      assert.equal(s.width, 120);
      assert.equal(s.height, 40);
    } finally {
      if (colsDesc) Object.defineProperty(process.stdout, 'columns', colsDesc);
      if (rowsDesc) Object.defineProperty(process.stdout, 'rows', rowsDesc);
      if (prevCols === undefined) delete process.env.GITHUB_TUI_COLS; else process.env.GITHUB_TUI_COLS = prevCols;
      if (prevRows === undefined) delete process.env.GITHUB_TUI_ROWS; else process.env.GITHUB_TUI_ROWS = prevRows;
    }
  });

  it('handleKey adopts a size report without dispatching keys', async () => {
    const colsDesc = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
    const rowsDesc = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
    Object.defineProperty(process.stdout, 'columns', { value: 80, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: 24, configurable: true });
    try {
      const state = await import('../tui/state.mjs');
      const render = await import('../tui/render.mjs');
      const keys = await import('../tui/keys.mjs');
      const screen = render.initScreen();
      screen.updateSize();
      assert.equal(screen.width, 80);
      state.tabState.current = 0;
      for (const f of ['showPalette', 'showHelp', 'showBookmarks', 'showDetail',
        'showOnboarding', 'showWelcome']) state.appState[f] = false;
      state.appState.confirmAction = null;
      state.appState.inputMode = null;
      keys.handleKey('\x1b[8;40;100t');
      assert.equal(screen.width, 100, 'cols adopted from the live report');
      assert.equal(screen.height, 40, 'rows adopted from the live report');
      assert.equal(state.tabState.current, 0, 'no tab switch from report bytes');
    } finally {
      if (colsDesc) Object.defineProperty(process.stdout, 'columns', colsDesc);
      if (rowsDesc) Object.defineProperty(process.stdout, 'rows', rowsDesc);
    }
  });

  it('split size replies reassemble across input events', async () => {
    const render = await import('../tui/render.mjs');
    const keys = await import('../tui/keys.mjs');
    const screen = render.getScreen() || render.initScreen();
    keys.handleKey('\x1b[8;4');
    assert.equal(screen.width, 100, 'fragment alone changes nothing');
    keys.handleKey('2;90t');
    assert.equal(screen.width, 90, 'reassembled report applies');
    assert.equal(screen.height, 42, 'reassembled rows apply');
  });

  it('pasted text never triggers a resize', async () => {
    const render = await import('../tui/render.mjs');
    const keys = await import('../tui/keys.mjs');
    const screen = render.getScreen() || render.initScreen();
    const w = screen.width, h = screen.height;
    // A raw paste containing the byte pattern must flow to normal handling.
    keys.handleKey('\x1b[200~\x1b[8;5;5t pasted\x1b[201~');
    assert.equal(screen.width, w, 'paste must not resize cols');
    assert.equal(screen.height, h, 'paste must not resize rows');
  });
});
