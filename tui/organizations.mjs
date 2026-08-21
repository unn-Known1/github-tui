// Organization/team context loader.

import { appState, render, startAsync, isStale, showMessage, setTab } from './state.mjs';
import { color } from './theme.mjs';
import { truncate } from './utils.mjs';
import { getUserOrganizations, getOrganizationRepos, getOrganizationTeams } from './github.mjs';

export async function loadOrganizations() {
  setTab(2);
  appState.analyzeView = 'organizations';
  if (!appState.token) { showMessage('Login required to list organizations', 'warning'); return []; }
  const gen = startAsync('organizations');
  try {
    const orgs = await getUserOrganizations(appState.token, 1, 50, gen.signal);
    if (isStale(gen)) return [];
    appState.organizations = Array.isArray(orgs) ? orgs : [];
    appState.organizationSelected = 0;
    if (appState.organizations[0]) await loadOrganizationContext(appState.organizations[0].login || appState.organizations[0].name);
    showMessage('Loaded ' + appState.organizations.length + ' organizations', 'success');
    render();
    return appState.organizations;
  } catch (e) {
    if (!isStale(gen)) showMessage('Organizations: ' + e.message, 'error');
    return [];
  }
}

export function renderOrganizations(screen, y, h) {
  const W = screen.width;
  screen.writeStr(2, y, 'ORGANIZATIONS & TEAMS', color('title'));
  screen.hline(y + 1, '─', color('dim'));
  const orgs = appState.organizations || [];
  if (!orgs.length) { screen.writeStr(2, y + 3, 'No organizations available or loaded.', color('dim')); return; }
  const org = orgs[appState.organizationSelected] || orgs[0];
  screen.writeStr(2, y + 2, 'Organizations', { fg: 'cyan', bold: true });
  for (let i = 0; i < Math.min(orgs.length, Math.max(1, h - 7)); i++) {
    const selected = i === appState.organizationSelected;
    if (selected) for (let x = 0; x < Math.min(34, W); x++) screen.styleBuf[y + 3 + i][x] = color('selection');
    screen.writeStr(2, y + 3 + i, (selected ? '▶ ' : '  ') + truncate(orgs[i].login || orgs[i].name || '?', 28), selected ? color('selection') : null);
  }
  const rightX = Math.min(38, Math.floor(W * 0.45));
  screen.writeStr(rightX, y + 2, (org?.login || '?') + ' repositories', { fg: 'cyan', bold: true });
  const repos = appState.organizationRepos || [];
  repos.slice(0, Math.max(1, h - 6)).forEach((repo, i) => screen.writeStr(rightX, y + 3 + i, truncate(repo.full_name || repo.name || '?', W - rightX - 2)));
  const teamY = y + 4 + Math.min(repos.length, Math.max(1, h - 7));
  screen.writeStr(rightX, Math.min(y + h - 2, teamY), 'Teams: ' + (appState.organizationTeams || []).map(t => t.name).slice(0, 4).join(', '), color('dim'));
}

export function organizationUp() { appState.organizationSelected = Math.max(0, appState.organizationSelected - 1); render(); }
export function organizationDown() { appState.organizationSelected = Math.min(Math.max(0, appState.organizations.length - 1), appState.organizationSelected + 1); render(); }
export async function organizationEnter() {
  const org = appState.organizations[appState.organizationSelected];
  if (org) await loadOrganizationContext(org.login || org.name);
}

export async function loadOrganizationContext(org) {
  if (!org || !appState.token) return;
  const gen = startAsync('organization-context');
  const [repos, teams] = await Promise.allSettled([
    getOrganizationRepos(appState.token, org, 1, 100, gen.signal),
    getOrganizationTeams(appState.token, org, 1, 100, gen.signal),
  ]);
  if (isStale(gen)) return;
  appState.organizationRepos = repos.status === 'fulfilled' && Array.isArray(repos.value) ? repos.value : [];
  appState.organizationTeams = teams.status === 'fulfilled' && Array.isArray(teams.value) ? teams.value : [];
  render();
}
