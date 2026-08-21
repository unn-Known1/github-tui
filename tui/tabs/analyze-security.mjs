// Security sub-pane — Dependabot, Secret Scanning, Code Scanning,
// Advisories, Branch Protection, and Dependencies views.

import { appState, render, startAsync, isStale, showMessage, confirm, beginLoading, finishLoading } from '../state.mjs';
import {
  getRepoDependabotAlerts, dismissDependabotAlert,
  getSecretScanningAlerts, getCodeScanningAlerts,
  getSecurityAdvisories, getBranchProtection, getDependencyGraphManifests,
} from '../github.mjs';
import { truncate, sectionHeader, relTime, openUrl } from '../utils.mjs';
import { color } from '../theme.mjs';
import { scrollIndicators, loadingIndicator } from '../render.mjs';

const SECURITY_SUB_PANES = ['dependabot', 'secret', 'codescan', 'advisories', 'branch', 'deps'];
const SECURITY_SUB_LABELS = {
  dependabot: 'Dependabot', secret: 'Secret Scanning', codescan: 'Code Scanning',
  advisories: 'Advisories', branch: 'Branch Protection', deps: 'Dependencies',
};
const SECURITY_SUB_KEYS = ['1', '2', '3', '4', '5', '6'];
const SECURITY_STATE_FILTERS = {
  dependabot: ['open', 'dismissed', 'fixed', 'all'],
  secret: ['open', 'resolved', 'all'],
  codescan: ['open', 'dismissed', 'fixed', 'all'],
};

export function securityStateOptions(sub = appState.securitySubPane) {
  return SECURITY_STATE_FILTERS[sub] || [];
}

export async function loadSecurity() {
  const repo = appState.repoDetails;
  if (!repo) return;
  const sub = appState.securitySubPane || 'dependabot';
  const stateOptions = securityStateOptions(sub);
  if (stateOptions.length && !stateOptions.includes(appState.securityStateFilter)) {
    appState.securityStateFilter = stateOptions[0];
  }
  const apiState = stateOptions.length && appState.securityStateFilter !== 'all'
    ? appState.securityStateFilter : undefined;
  appState.securityError = null;
  const gen = startAsync('analyze-security');
  beginLoading(gen);
  render();
  try {
    const [owner, name] = repo.full_name.split('/');
    if (sub === 'dependabot') {
      const state = apiState;
      const alerts = await getRepoDependabotAlerts(appState.token, owner, name, state, gen.signal);
      if (isStale(gen, 'analyze-security')) { finishLoading(gen); return; }
      appState.repoDependabotAlerts = Array.isArray(alerts) ? alerts : [];
    } else if (sub === 'secret') {
      const state = apiState;
      const alerts = await getSecretScanningAlerts(appState.token, owner, name, state, gen.signal);
      if (isStale(gen, 'analyze-security')) { finishLoading(gen); return; }
      appState.secretScanningAlerts = Array.isArray(alerts) ? alerts : [];
    } else if (sub === 'codescan') {
      const state = apiState;
      const alerts = await getCodeScanningAlerts(appState.token, owner, name, state, undefined, gen.signal);
      if (isStale(gen, 'analyze-security')) { finishLoading(gen); return; }
      appState.codeScanningAlerts = Array.isArray(alerts) ? alerts : [];
    } else if (sub === 'advisories') {
      const advisories = await getSecurityAdvisories(appState.token, owner, name, gen.signal);
      if (isStale(gen, 'analyze-security')) { finishLoading(gen); return; }
      appState.securityAdvisories = Array.isArray(advisories) ? advisories : [];
    } else if (sub === 'branch') {
      const branch = repo.default_branch || 'main';
      try {
        const prot = await getBranchProtection(appState.token, owner, name, branch, gen.signal);
        if (isStale(gen, 'analyze-security')) { finishLoading(gen); return; }
        appState.branchProtection = prot;
      } catch (e) {
        if (isStale(gen, 'analyze-security')) { finishLoading(gen); return; }
        appState.branchProtection = null;
        appState.securityError = 'Branch protection unavailable: ' + (e.message || 'token may lack repo administration scope');
      }
    } else if (sub === 'deps') {
      try {
        const manifests = await getDependencyGraphManifests(appState.token, owner, name, gen.signal);
        if (isStale(gen, 'analyze-security')) { finishLoading(gen); return; }
        appState.dependencyManifests = (manifests && manifests.manifests) ? manifests.manifests : [];
      } catch (e) {
        if (isStale(gen, 'analyze-security')) { finishLoading(gen); return; }
        appState.dependencyManifests = [];
        appState.securityError = 'Dependency graph unavailable: ' + (e.message || 'enable dependency graph or check token scopes');
      }
    }
  } catch (e) {
    if (!isStale(gen, 'analyze-security')) {
      appState.securityError = 'Security request failed: ' + (e.message || 'check repository access and token scopes');
      showMessage(appState.securityError, 'error');
    }
  }
  finishLoading(gen);
  if (!isStale(gen, 'analyze-security')) render();
}

export async function dismissAlert(alertId) {
  const repo = appState.repoDetails;
  if (!repo || !appState.token) return;
  const [owner, name] = repo.full_name.split('/');
  // Dismissing an alert with `tolerate_risk` silences the Dependabot warning
  // for the repo. Confirmation prevents accidental dismissal.
  confirm('Dismiss alert #' + alertId + ' (tolerate_risk) on ' + repo.full_name + '?', async () => {
    try {
      await dismissDependabotAlert(appState.token, owner, name, alertId, 'tolerate_risk');
      showMessage('Alert dismissed', 'success');
      loadSecurity();
    } catch (e) { showMessage('Dismiss failed: ' + e.message, 'error'); }
  }, 'Dismiss alert');
}

export function cycleSecurityFilter() {
  const cycle = ['all', 'critical', 'high', 'medium', 'low'];
  const i = cycle.indexOf(appState.securityFilter);
  appState.securityFilter = cycle[(i + 1) % cycle.length];
  appState.securityAlertCursor = 0;
  appState.securityAlertScroll = 0;
  showMessage('Severity: ' + appState.securityFilter, 'info');
  render();
}

export function cycleSecurityStateFilter() {
  const cycle = securityStateOptions();
  if (cycle.length === 0) {
    showMessage('This security view has no state filter', 'info');
    return;
  }
  const i = cycle.indexOf(appState.securityStateFilter);
  appState.securityStateFilter = cycle[(i >= 0 ? i + 1 : 0) % cycle.length];
  appState.securityAlertCursor = 0;
  appState.securityAlertScroll = 0;
  showMessage('State: ' + appState.securityStateFilter, 'info');
  loadSecurity();
}

function filterDependabot(alerts) {
  let list = alerts;
  if (appState.securityFilter !== 'all') {
    list = list.filter(a => a.security_advisory?.severity === appState.securityFilter);
  }
  return list;
}

function sevIcon(sev) {
  if (sev === 'critical') return '🔴';
  if (sev === 'high') return '🟠';
  if (sev === 'medium') return '🟡';
  return '⚪';
}

export function renderSecurityPane(screen, y, maxH) {
  const W = screen.width;

  // Sub-pane tabs
  const subPanes = SECURITY_SUB_PANES;
  let px = 2;
  const subTabBounds = [];
  for (let i = 0; i < subPanes.length; i++) {
    const sp = subPanes[i];
    const sel = appState.securitySubPane === sp;
    const label = SECURITY_SUB_LABELS[sp];
    const text = '[' + SECURITY_SUB_KEYS[i] + '] ' + label;
    screen.writeStr(px, y, text, sel ? { bg: 'cyan', fg: 'darkGray', bold: true } : { dim: true });
    subTabBounds.push({ x1: px, x2: px + text.length, pane: sp });
    px += text.length + 2;
  }
  appState._securitySubTabBounds = { y, bounds: subTabBounds };
  y++;
  screen.hline(y, '─', { dim: true });
  y++;

  // Filter chips are contextual: irrelevant controls are not rendered and
  // therefore cannot accidentally send an unsupported API value.
  const stateOptions = securityStateOptions();
  const stateChip = stateOptions.length ? 'state: ' + appState.securityStateFilter : '';
  const sevChip = appState.securitySubPane === 'dependabot' ? '   severity: ' + appState.securityFilter : '';
  if (appState.securityError && !appState.loading) {
    screen.writeStr(2, y + 1, '⚠ ' + truncate(appState.securityError, W - 6), { fg: 'yellow', bold: true });
    screen.writeStr(2, y + 2, '[r] Retry   [o] Open repository permissions', { dim: true });
  }
  screen.writeStr(2, y, stateChip + sevChip, { fg: 'cyan' });
  const hints = [];
  if (appState.securitySubPane === 'dependabot') hints.push('[s] severity');
  if (stateOptions.length) hints.push('[f] state');
  if (hints.length) screen.writeStr(Math.max(2, W - hints.join(' ').length - 2), y, hints.join(' '), { dim: true });
  y++;
  y++;

  const sub = appState.securitySubPane || 'dependabot';
  if (sub === 'dependabot') renderDependabotPane(screen, y, maxH - 4, W);
  else if (sub === 'secret') renderSecretPane(screen, y, maxH - 4, W);
  else if (sub === 'codescan') renderCodeScanPane(screen, y, maxH - 4, W);
  else if (sub === 'advisories') renderAdvisoriesPane(screen, y, maxH - 4, W);
  else if (sub === 'branch') renderBranchProtectionPane(screen, y, maxH - 4, W);
  else if (sub === 'deps') renderDepsPane(screen, y, maxH - 4, W);
}

function renderDependabotPane(screen, y, maxH, W) {
  if (appState.loading) { loadingIndicator(screen, 2, y, 'loading Dependabot alerts'); return; }
  const alerts = filterDependabot(appState.repoDependabotAlerts);

  if (alerts.length === 0) {
    const msg = appState.securityFilter !== 'all'
      ? 'No ' + appState.securityFilter + ' severity alerts'
      : 'No Dependabot alerts — dependencies look clean';
    screen.writeStr(2, y++, msg, { dim: true });
    screen.writeStr(2, y++, '[f] Change state filter   [s] Change severity filter', { dim: true });
    return;
  }

  // Summary line
  const crit = alerts.filter(a => a.security_advisory?.severity === 'critical').length;
  const high = alerts.filter(a => a.security_advisory?.severity === 'high').length;
  const med = alerts.filter(a => a.security_advisory?.severity === 'medium').length;
  const low = alerts.filter(a => a.security_advisory?.severity === 'low').length;
  const summary = '🔴 ' + crit + '  🟠 ' + high + '  🟡 ' + med + '  ⚪ ' + low;
  screen.writeStr(2, y, summary, { dim: true });
  y++;

  const start = appState.securityAlertScroll;
  const rows = Math.max(1, maxH - 2);
  for (let i = 0; i < rows && start + i < alerts.length; i++) {
    const alert = alerts[start + i];
    const row = y + i;
    const sel = start + i === appState.securityAlertCursor;
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    const sev = alert.security_advisory?.severity || '?';
    const pkg = alert.dependency?.package?.name || '?';
    const summary = truncate(alert.security_advisory?.summary || '?', Math.min(35, W - 45));
    const cvss = alert.security_advisory?.cvss?.score;
    const cvssStr = cvss != null ? ' CVSS:' + cvss.toFixed(1) : '';
    screen.writeStr(2, row, sel ? '▶' : ' ', sel ? color('selection') : null);
    screen.writeStr(4, row, sevIcon(sev), sel ? color('selection') : null);
    screen.writeStr(7, row, truncate(pkg, 18), sel ? color('selection') : color('repoName'));
    screen.writeStr(27, row, summary, sel ? color('selection') : color('dim'));
    if (cvssStr && 27 + summary.length + 2 < W) {
      screen.writeStr(27 + summary.length + 2, row, cvssStr, sel ? color('selection') : { fg: 'yellow' });
    }
  }
  scrollIndicators(screen, y, y + rows - 1, appState.securityAlertScroll, alerts.length);
  if (alerts.length > rows) {
    const info = (start + 1) + '-' + Math.min(start + rows, alerts.length) + ' of ' + alerts.length;
    screen.writeStr(2, y + rows, info + '   [Enter] detail   [x] dismiss', { dim: true });
  }
}

function renderSecretPane(screen, y, maxH, W) {
  if (appState.loading) { loadingIndicator(screen, 2, y, 'loading secret scanning alerts'); return; }
  const alerts = appState.secretScanningAlerts;
  if (alerts.length === 0) {
    screen.writeStr(2, y++, 'No secret scanning alerts — no leaked credentials found', { dim: true });
    return;
  }
  const start = appState.securityAlertScroll;
  const rows = Math.max(1, maxH - 1);
  for (let i = 0; i < rows && start + i < alerts.length; i++) {
    const alert = alerts[start + i];
    const row = y + i;
    const sel = start + i === appState.securityAlertCursor;
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    const state = alert.state || '?';
    const stateIcon = state === 'open' ? '🔴' : state === 'resolved' ? '🟢' : '🟡';
    const pattern = truncate(alert.secret_type || alert.pattern_name || '?', 20);
    const loc = truncate(alert.most_recent_instance?.location?.path || '?', Math.min(30, W - 40));
    const when = alert.created_at ? relTime(alert.created_at) : '';
    screen.writeStr(2, row, sel ? '▶' : ' ', sel ? color('selection') : null);
    screen.writeStr(4, row, stateIcon);
    screen.writeStr(7, row, pattern, sel ? color('selection') : color('repoName'));
    screen.writeStr(29, row, loc, sel ? color('selection') : color('dim'));
    if (29 + 30 + 2 < W) screen.writeStr(29 + 30 + 2, row, when, sel ? color('selection') : color('dim'));
  }
  scrollIndicators(screen, y, y + rows - 1, appState.securityAlertScroll, alerts.length);
}

function renderCodeScanPane(screen, y, maxH, W) {
  if (appState.loading) { loadingIndicator(screen, 2, y, 'loading code scanning alerts'); return; }
  const alerts = appState.codeScanningAlerts;
  if (alerts.length === 0) {
    screen.writeStr(2, y++, 'No code scanning alerts — no issues found by analysis', { dim: true });
    return;
  }
  const start = appState.securityAlertScroll;
  const rows = Math.max(1, maxH - 1);
  for (let i = 0; i < rows && start + i < alerts.length; i++) {
    const alert = alerts[start + i];
    const row = y + i;
    const sel = start + i === appState.securityAlertCursor;
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    const sev = alert.rule?.security_severity_level || alert.severity || '?';
    const rule = truncate(alert.rule?.id || alert.rule?.description || '?', 25);
    const msg = truncate(alert.most_recent_instance?.message?.text || alert.message || '?', Math.min(30, W - 45));
    const loc = alert.most_recent_instance?.location?.path || '?';
    screen.writeStr(2, row, sel ? '▶' : ' ', sel ? color('selection') : null);
    screen.writeStr(4, row, sevIcon(sev));
    screen.writeStr(7, row, rule, sel ? color('selection') : color('repoName'));
    screen.writeStr(34, row, msg, sel ? color('selection') : color('dim'));
  }
  scrollIndicators(screen, y, y + rows - 1, appState.securityAlertScroll, alerts.length);
}

function renderAdvisoriesPane(screen, y, maxH, W) {
  if (appState.loading) { loadingIndicator(screen, 2, y, 'loading security advisories'); return; }
  const advisories = appState.securityAdvisories;
  if (advisories.length === 0) {
    screen.writeStr(2, y++, 'No published security advisories for this repo', { dim: true });
    return;
  }
  const start = appState.securityAlertScroll;
  const rows = Math.max(1, maxH - 1);
  for (let i = 0; i < rows && start + i < advisories.length; i++) {
    const adv = advisories[start + i];
    const row = y + i;
    const sel = start + i === appState.securityAlertCursor;
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    const sev = adv.severity || '?';
    const ghsa = adv.ghe_id || adv.github_advisory_id || '?';
    const summary = truncate(adv.summary || '?', Math.min(35, W - 30));
    const state = adv.state || '?';
    screen.writeStr(2, row, sel ? '▶' : ' ', sel ? color('selection') : null);
    screen.writeStr(4, row, sevIcon(sev));
    screen.writeStr(7, row, truncate(ghsa, 20), sel ? color('selection') : { fg: 'cyan' });
    screen.writeStr(29, row, summary, sel ? color('selection') : color('dim'));
    if (29 + 35 + 2 < W) screen.writeStr(29 + 35 + 2, row, state, sel ? color('selection') : color('dim'));
  }
  scrollIndicators(screen, y, y + rows - 1, appState.securityAlertScroll, advisories.length);
}

function renderBranchProtectionPane(screen, y, maxH, W) {
  if (appState.loading) { loadingIndicator(screen, 2, y, 'loading branch protection'); return; }
  const prot = appState.branchProtection;
  const branch = appState.repoDetails?.default_branch || 'main';
  const startY = y;

  screen.writeStr(2, y, 'Branch: ' + branch, color('title'));
  y += 2;

  if (!prot) {
    screen.writeStr(2, y++, 'No branch protection rules configured', { dim: true });
    screen.writeStr(2, y++, 'Branches are unprotected — any collaborator can push directly', { fg: 'yellow' });
    return;
  }

  const checks = [
    ['Required reviews', prot.required_pull_request_reviews ? '✅ Enabled' : '❌ Not set',
     prot.required_pull_request_reviews ? (prot.required_pull_request_reviews.required_approving_review_count || 1) + ' reviewer(s) required' : ''],
    ['Dismiss stale reviews', prot.required_pull_request_reviews?.dismiss_stale_reviews ? '✅ Yes' : '❌ No', ''],
    ['Require code owner reviews', prot.required_pull_request_reviews?.require_code_owner_reviews ? '✅ Yes' : '❌ No', ''],
    ['Status checks', prot.required_status_checks ? '✅ Enabled' : '❌ Not set',
     prot.required_status_checks ? (prot.required_status_checks.contexts || []).length + ' check(s)' : ''],
    ['Require branches up to date', prot.required_status_checks?.strict ? '✅ Yes' : '❌ No', ''],
    ['Enforce admins', prot.enforce_admins?.enabled ? '✅ Yes' : '❌ No', ''],
    ['Require signed commits', prot.required_signing_commits ? '✅ Yes' : '❌ No', ''],
    ['Require linear history', prot.required_linear_history?.enabled ? '✅ Yes' : '❌ No', ''],
    ['Allow force pushes', prot.allow_force_pushes?.enabled ? '⚠️ Yes' : '✅ No', ''],
    ['Allow deletions', prot.allow_deletions?.enabled ? '⚠️ Yes' : '✅ No', ''],
    ['Require conversation resolution', prot.required_conversation_resolution?.enabled ? '✅ Yes' : '❌ No', ''],
    ['Restrict pushes', prot.restrict_pushes?.enabled ? '🔒 Yes' : '❌ No', ''],
  ];

  for (const [label, value, detail] of checks) {
    if (y >= startY + maxH - 1) break;
    screen.writeStr(2, y, label + ':', { dim: true });
    screen.writeStr(30, y, value);
    if (detail && 30 + value.length + 2 < W) {
      screen.writeStr(30 + value.length + 2, y, detail, { dim: true });
    }
    y++;
  }

  // Show required status check contexts
  if (prot.required_status_checks?.contexts?.length > 0) {
    y++;
    screen.writeStr(2, y, 'Required checks:', color('accent'));
    y++;
    for (const ctx of prot.required_status_checks.contexts.slice(0, 5)) {
      if (y >= startY + maxH - 1) break;
      screen.writeStr(4, y++, truncate(ctx, W - 8));
    }
  }

  // Show restricted push actors
  if (prot.restrict_pushes?.apps?.length > 0 || prot.restrict_pushes?.teams?.length > 0) {
    y++;
    screen.writeStr(2, y, 'Push restrictions:', color('accent'));
    y++;
    for (const t of (prot.restrict_pushes.teams || []).slice(0, 3)) {
      if (y >= startY + maxH - 1) break;
      screen.writeStr(4, y++, 'Team: ' + truncate(t, W - 10));
    }
    for (const a of (prot.restrict_pushes.apps || []).slice(0, 3)) {
      if (y >= startY + maxH - 1) break;
      screen.writeStr(4, y++, 'App: ' + truncate(a.slug || a.name || '?', W - 10));
    }
  }
}

function renderDepsPane(screen, y, maxH, W) {
  if (appState.loading) { loadingIndicator(screen, 2, y, 'loading dependency manifests'); return; }
  const manifests = appState.dependencyManifests;
  if (manifests.length === 0) {
    screen.writeStr(2, y++, 'No dependency manifests found', { dim: true });
    screen.writeStr(2, y++, 'Enable dependency graph in repo settings', { dim: true });
    return;
  }

  const start = appState.securityAlertScroll;
  const rows = Math.max(1, maxH - 2);

  // Summary
  let totalDeps = 0;
  let totalVuln = 0;
  for (const m of manifests) {
    totalDeps += m.total_dependency_count || 0;
    totalVuln += m.vulnerabilities_count || 0;
  }
  const summary = totalDeps + ' dependencies across ' + manifests.length + ' manifest(s)' +
    (totalVuln > 0 ? '   🔴 ' + totalVuln + ' with vulnerabilities' : '   ✅ all clean');
  screen.writeStr(2, y, summary, totalVuln > 0 ? { fg: 'yellow' } : { fg: 'green' });
  y += 2;

  for (let i = 0; i < rows && start + i < manifests.length; i++) {
    const m = manifests[start + i];
    const row = y + i;
    const sel = start + i === appState.securityAlertCursor;
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    const filename = truncate(m.filename || '?', Math.min(25, W - 40));
    const deps = m.total_dependency_count || 0;
    const vulns = m.vulnerabilities_count || 0;
    const vulnStr = vulns > 0 ? ' 🔴 ' + vulns + ' vuln' : ' ✅';
    screen.writeStr(2, row, sel ? '▶' : ' ', sel ? color('selection') : null);
    screen.writeStr(4, row, filename, sel ? color('selection') : color('repoName'));
    screen.writeStr(30, row, deps + ' deps', sel ? color('selection') : color('dim'));
    if (30 + 8 + vulnStr.length < W) {
      screen.writeStr(38, row, vulnStr, vulns > 0 ? (sel ? color('selection') : { fg: 'red' }) : (sel ? color('selection') : { fg: 'green' }));
    }
  }
  scrollIndicators(screen, y, y + rows - 1, appState.securityAlertScroll, manifests.length);
}

// ─── Security key handlers ───────────────────────────────────────

export function securityUp() {
  if (appState.securityAlertCursor > 0) {
    appState.securityAlertCursor--;
    if (appState.securityAlertCursor < appState.securityAlertScroll) appState.securityAlertScroll--;
  }
  render();
}

export function securityDown(screen) {
  const sub = appState.securitySubPane || 'dependabot';
  let len = 0;
  if (sub === 'dependabot') len = filterDependabot(appState.repoDependabotAlerts).length;
  else if (sub === 'secret') len = appState.secretScanningAlerts.length;
  else if (sub === 'codescan') len = appState.codeScanningAlerts.length;
  else if (sub === 'advisories') len = appState.securityAdvisories.length;
  else if (sub === 'deps') len = appState.dependencyManifests.length;
  if (len === 0) return;
  const maxVisible = Math.max(1, (screen ? screen.height : 24) - 16);
  appState.securityAlertCursor = Math.min(len - 1, appState.securityAlertCursor + 1);
  if (appState.securityAlertCursor >= appState.securityAlertScroll + maxVisible) {
    appState.securityAlertScroll++;
  }
  render();
}

export function securityEnter() {
  const sub = appState.securitySubPane || 'dependabot';
  if (sub === 'dependabot') {
    const alerts = filterDependabot(appState.repoDependabotAlerts);
    const alert = alerts[appState.securityAlertCursor];
    if (alert && alert.html_url) openUrl(alert.html_url).then(r => r.ok
      ? showMessage('Opened in browser', 'success')
      : showMessage(r.error || 'Open failed', 'error'));
  } else if (sub === 'secret') {
    const alert = appState.secretScanningAlerts[appState.securityAlertCursor];
    if (alert && alert.html_url) openUrl(alert.html_url).then(r => r.ok
      ? showMessage('Opened in browser', 'success')
      : showMessage(r.error || 'Open failed', 'error'));
  } else if (sub === 'codescan') {
    const alert = appState.codeScanningAlerts[appState.securityAlertCursor];
    if (alert && alert.html_url) openUrl(alert.html_url).then(r => r.ok
      ? showMessage('Opened in browser', 'success')
      : showMessage(r.error || 'Open failed', 'error'));
  } else if (sub === 'advisories') {
    const adv = appState.securityAdvisories[appState.securityAlertCursor];
    if (adv && adv.html_url) openUrl(adv.html_url).then(r => r.ok
      ? showMessage('Opened in browser', 'success')
      : showMessage(r.error || 'Open failed', 'error'));
  }
}

export function securityDismiss() {
  const sub = appState.securitySubPane || 'dependabot';
  if (sub !== 'dependabot') return;
  const alerts = filterDependabot(appState.repoDependabotAlerts);
  const alert = alerts[appState.securityAlertCursor];
  if (alert) dismissAlert(alert.id);
}
