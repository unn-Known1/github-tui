// Branch/tag comparison pane.

import { appState, render, startAsync, isStale, showMessage, beginLoading, finishLoading } from '../state.mjs';
import { getCompare } from '../github.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import { truncateToWidth } from '../utils.mjs';
import { color } from '../theme.mjs';

export function startCompare() {
  if (!appState.repoDetails) { showMessage('Open a repository first', 'warning'); return; }
  startInput('Compare refs (base...head): ', 'compare-refs');
}

registerInputHandler('compare-refs', async (value) => {
  const refs = String(value || '').trim().split('...');
  if (refs.length !== 2 || !refs[0] || !refs[1]) {
    showMessage('Use base...head, for example main...feature', 'warning');
    return;
  }
  await loadCompare(refs[0].trim(), refs[1].trim());
});

export async function loadCompare(base, head) {
  const repo = appState.repoDetails;
  if (!repo) return;
  const [owner, name] = repo.full_name.split('/');
  const gen = startAsync('analyze-compare');
  beginLoading(gen);
  appState.compareBase = base;
  appState.compareHead = head;
  appState.compareData = null;
  appState.detailsPane = 'compare';
  appState.detailsScroll = 0;
  render();
  try {
    const result = await getCompare(appState.token, owner, name, base, head, gen.signal);
    if (isStale(gen)) return;
    appState.compareData = result || {};
    showMessage('Compared ' + base + ' ← ' + head, 'success');
  } catch (e) {
    if (!isStale(gen)) showMessage('Compare failed: ' + e.message, 'error');
  } finally { finishLoading(gen); }
  if (!isStale(gen)) render();
}

export function renderComparePane(screen, y, maxH) {
  const data = appState.compareData;
  screen.writeStr(2, y, 'COMPARE ' + appState.compareBase + ' ← ' + appState.compareHead, color('title'));
  screen.hline(y + 1, '─', color('dim'));
  if (appState.loading && !data) { screen.writeStr(2, y + 3, 'Loading comparison…', color('dim')); return; }
  if (!data) { screen.writeStr(2, y + 3, 'No comparison loaded. Press [D] to choose refs.', color('dim')); return; }
  const summary = 'Ahead: ' + (data.ahead_by ?? '?') + '   Behind: ' + (data.behind_by ?? '?') +
    '   Commits: ' + (data.total_commits ?? data.commits?.length ?? '?') +
    '   Files: ' + (data.files?.length ?? '?');
  screen.writeStr(2, y + 2, summary, { fg: 'cyan', bold: true });
  const lines = [];
  for (const c of (data.commits || [])) {
    const subject = c.commit?.message?.split(/\r?\n/)[0] || '(no message)';
    lines.push((c.sha || '').slice(0, 8) + ' ' + subject);
  }
  for (const file of (data.files || [])) {
    lines.push((file.status || 'changed') + ' ' + file.filename +
      '  +' + (file.additions || 0) + ' -' + (file.deletions || 0));
  }
  const rows = Math.max(1, maxH - 5);
  const start = Math.max(0, Math.min(appState.detailsScroll || 0, Math.max(0, lines.length - rows)));
  appState.detailsScroll = start;
  for (let i = 0; i < rows && start + i < lines.length; i++) {
    const line = lines[start + i];
    screen.writeStr(2, y + 4 + i, truncateToWidth(line, screen.width - 4, ''),
      line.startsWith('removed') ? color('error') : line.startsWith('added') ? color('success') : null);
  }
  screen.writeStr(2, y + 4 + Math.min(rows, lines.length), '[D] Compare again  [↑↓] scroll  [Esc] back', color('dim'));
}
