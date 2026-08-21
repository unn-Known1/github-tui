// Bounded cross-repository security aggregation.

import { appState, render, startAsync, isStale, showMessage, setTab } from './state.mjs';
import { color } from './theme.mjs';
import { truncate, relTime, openUrl } from './utils.mjs';
import {
  getRepoDependabotAlerts, getSecretScanningAlerts, getCodeScanningAlerts,
} from './github.mjs';

const MAX_REPOS = 20;

export async function loadSecurityAggregate() {
  setTab(2);
  appState.analyzeView = 'security-aggregate';
  appState.securityAggregateVisible = true;
  appState.securityAggregateLoading = true;
  appState.securityAggregateErrors = [];
  appState.securityAggregate = [];
  render();
  if (!appState.token) { appState.securityAggregateLoading = false; showMessage('Login required for security aggregation', 'warning'); render(); return []; }
  const repos = (appState.securityAggregateWatchlist?.length
    ? appState.securityAggregateWatchlist
    : appState.repos).slice(0, MAX_REPOS);
  if (!repos.length) { appState.securityAggregateLoading = false; showMessage('Load repositories before scanning security alerts', 'warning'); render(); return []; }
  const gen = startAsync('security-aggregate');
  const alerts = [];
  for (const repo of repos) {
    if (isStale(gen)) return alerts;
    const [owner, name] = String(repo.full_name || '').split('/');
    if (!owner || !name) continue;
    const calls = [
      ['dependabot', getRepoDependabotAlerts(appState.token, owner, name, 'open', gen.signal)],
      ['secret', getSecretScanningAlerts(appState.token, owner, name, 'open', gen.signal)],
      ['codescan', getCodeScanningAlerts(appState.token, owner, name, 'open', 50, gen.signal)],
    ];
    const results = await Promise.allSettled(calls.map(([, promise]) => promise));
    results.forEach((result, index) => {
      if (result.status !== 'fulfilled') {
        appState.securityAggregateErrors.push(repo.full_name + ': ' + (result.reason?.message || 'permission or API error'));
        return;
      }
      const list = Array.isArray(result.value) ? result.value : result.value?.alerts || [];
      for (const alert of list) alerts.push({ ...alert, source: calls[index][0], repository: repo.full_name });
    });
  }
  if (!isStale(gen)) {
    appState.securityAggregate = alerts.sort((a, b) => {
      const rank = { critical: 4, high: 3, medium: 2, low: 1 };
      return (rank[String(b.severity || b.rule?.security_severity_level || '').toLowerCase()] || 0) -
        (rank[String(a.severity || a.rule?.security_severity_level || '').toLowerCase()] || 0);
    });
    appState.securityAggregateLoading = false;
    appState.securityAggregateCursor = 0;
    appState.securityAggregateScroll = 0;
    showMessage('Found ' + alerts.length + ' open security alerts' + (appState.securityAggregateErrors.length ? ' with partial errors' : ''), appState.securityAggregateErrors.length ? 'warning' : alerts.length ? 'warning' : 'success');
    render();
  }
  return alerts;
}

export function renderSecurityAggregate(screen, y, h) {
  const W = screen.width;
  screen.writeStr(2, y, 'SECURITY AGGREGATE', color('title'));
  screen.writeStr(2, y + 1, 'Open alerts across the bounded repository watchlist', color('dim'));
  screen.hline(y + 2, '─', color('dim'));
  if (appState.securityAggregateLoading) {
    screen.writeStr(2, y + 4, 'Scanning repositories…', { fg: 'yellow' });
    return;
  }
  const errors = appState.securityAggregateErrors || [];
  if (errors.length) screen.writeStr(2, y + 3, 'Partial failures: ' + truncate(errors.join(' | '), W - 4), { fg: 'yellow' });
  const listY = y + (errors.length ? 5 : 4);
  const alerts = appState.securityAggregate || [];
  if (!alerts.length) {
    screen.writeStr(2, listY, 'No open alerts found (or the selected repositories denied access).', color('dim'));
    return;
  }
  const rows = Math.max(1, h - (listY - y) - 2);
  appState.securityAggregateCursor = Math.max(0, Math.min(appState.securityAggregateCursor, alerts.length - 1));
  appState.securityAggregateScroll = Math.max(0, Math.min(appState.securityAggregateScroll, Math.max(0, alerts.length - rows)));
  if (appState.securityAggregateCursor < appState.securityAggregateScroll) appState.securityAggregateScroll = appState.securityAggregateCursor;
  if (appState.securityAggregateCursor >= appState.securityAggregateScroll + rows) appState.securityAggregateScroll = appState.securityAggregateCursor - rows + 1;
  for (let i = 0; i < rows && i + appState.securityAggregateScroll < alerts.length; i++) {
    const idx = i + appState.securityAggregateScroll, alert = alerts[idx], row = listY + i;
    const selected = idx === appState.securityAggregateCursor;
    if (selected) for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    const severity = String(alert.severity || alert.rule?.security_severity_level || 'unknown').toUpperCase();
    screen.writeStr(2, row, (selected ? '▶ ' : '  ') + severity.padEnd(8), selected ? color('selection') : { fg: severity === 'CRITICAL' || severity === 'HIGH' ? 'red' : 'yellow' });
    screen.writeStr(13, row, truncate(alert.repository || '?', 28), selected ? color('selection') : color('repoName'));
    screen.writeStr(43, row, truncate(alert.dependency?.package?.name || alert.rule?.description || alert.secret_type_display_name || alert.number || 'alert', Math.max(10, W - 58)), selected ? color('selection') : null);
    screen.writeStr(Math.max(45, W - 12), row, relTime(alert.created_at || alert.updated_at), selected ? color('selection') : color('dim'));
  }
  screen.writeStr(2, listY + rows, '[Enter] open alert   [Esc] back   [r] rescan', color('dim'));
}

export function securityAggregateUp() {
  appState.securityAggregateCursor = Math.max(0, appState.securityAggregateCursor - 1); render();
}
export function securityAggregateDown() {
  appState.securityAggregateCursor = Math.min(Math.max(0, appState.securityAggregate.length - 1), appState.securityAggregateCursor + 1); render();
}
export async function securityAggregateEnter() {
  const alert = appState.securityAggregate[appState.securityAggregateCursor];
  const url = alert?.html_url || alert?.url;
  if (!url) { showMessage('No browser URL for this alert', 'warning'); return; }
  const result = await openUrl(url);
  showMessage(result.ok ? 'Opened alert in browser' : result.error || 'Open failed', result.ok ? 'success' : 'error');
}
