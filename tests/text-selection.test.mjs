import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appState } from '../tui/state.mjs';

describe('text selection state', () => {
  it('defaults to none mode with null start/end', () => {
    assert.equal(appState.textSelectionMode, 'none');
    assert.equal(appState.textSelectStart, null);
    assert.equal(appState.textSelectEnd, null);
  });

  it('can be set to readme mode', () => {
    appState.textSelectionMode = 'readme';
    appState.textSelectStart = { row: 0, col: 0 };
    appState.textSelectEnd = { row: 5, col: 20 };
    assert.equal(appState.textSelectionMode, 'readme');
    assert.deepEqual(appState.textSelectStart, { row: 0, col: 0 });
    assert.deepEqual(appState.textSelectEnd, { row: 5, col: 20 });
  });

  it('can be set to file mode', () => {
    appState.textSelectionMode = 'file';
    appState.textSelectStart = { row: 2, col: 0 };
    appState.textSelectEnd = { row: 10, col: 40 };
    assert.equal(appState.textSelectionMode, 'file');
    assert.deepEqual(appState.textSelectStart, { row: 2, col: 0 });
    assert.deepEqual(appState.textSelectEnd, { row: 10, col: 40 });
  });

  it('resets to none when explicitly cleared', () => {
    appState.textSelectionMode = 'readme';
    appState.textSelectStart = { row: 0, col: 0 };
    appState.textSelectEnd = { row: 3, col: 10 };
    appState.textSelectionMode = 'none';
    appState.textSelectStart = null;
    appState.textSelectEnd = null;
    assert.equal(appState.textSelectionMode, 'none');
    assert.equal(appState.textSelectStart, null);
    assert.equal(appState.textSelectEnd, null);
  });
});
