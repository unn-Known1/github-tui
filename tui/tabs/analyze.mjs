// Analyze tab — search any public repo, drill into rich details,
// toggle Issues/PRs sub-panes, view README, hop to Forks sub-view.
// v0.5+ polish: pushes to recent-repos list, cleaner section headings.

import { appState, render, startAsync, isStale, showMessage, pushRecentRepo } from '../state.mjs';
import {
  searchRepositories, getRepositoryDetails,
  getRepositoryLanguages, getRepositoryContributors,
  getRepositoryReleases, getRepositoryIssues, getRepositoryPullRequests,
  getReleaseAssets, getReadme,
  getRepoTrafficViews, getRepoTrafficClones,
  getRepoTrafficPopularPaths, getRepoTrafficPopularReferrers,
  getRepoMilestones, getRepoLabels, getRepoCheckRuns, getRepoCheckSuites,
  getRepoDependabotAlerts,
  searchUsers, searchCode, getUser,
} from '../github.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import { shortNum, truncate, openUrl } from '../utils.mjs';
import { color } from '../theme.mjs';
import { emptyState, loadingIndicator, scrollIndicators } from '../render.mjs';
import { loadForks, loadMoreForks, renderForks, toggleForkSort } from './forks.mjs';
import * as files from './files.mjs';
import { openDetail as _openDetail } from './detail.mjs';
export { _openDetail as openDetail };
import { addSavedSearch } from '../store.mjs';
import { downloadToFile } from '../github.mjs';
import { safeCwdJoin } from '../utils.mjs';
import { existsSync } from 'fs';

const SEARCH_PER_PAGE = 15;

export async function submitSearch(value) {
  const query = (value || '').trim();
  if (!query) return;
  const gen = startAsync();
  appState.loading = true;
  appState.searchQuery = query;
  appState.repoDetails = null;
  appState.forks = [];
  appState.selectedRepo = 0;
  appState.searchScroll = 0;
  appState.searchPage = 1;
  appState.analyzeView = 'results';
  render();
  try {
    const results = await searchRepositories(appState.token, query, 1, SEARCH_PER_PAGE);
    if (isStale(gen)) { appState.loading = false; return; }
    appState.searchResults = results;
    appState.searchHasMore = results.length >= SEARCH_PER_PAGE;
    if (results.length === 0) showMessage('No repositories found', 'warning');
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Search failed', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}
registerInputHandler('search', submitSearch);

const USER_SEARCH_PER_PAGE = 20;
const CODE_SEARCH_PER_PAGE = 15;

export async function submitUserSearch(value) {
  const query = (value || '').trim();
  if (!query) return;
  const gen = startAsync();
  appState.loading = true;
  appState.searchQuery = query;
  appState.searchType = 'users';
  appState.selectedRepo = 0;
  appState.searchScroll = 0;
  appState.userSearchPage = 1;
  appState.analyzeView = 'results';
  render();
  try {
    const results = await searchUsers(appState.token, query, 1, USER_SEARCH_PER_PAGE);
    if (isStale(gen)) { appState.loading = false; return; }
    appState.userSearchResults = results;
    appState.userSearchHasMore = results.length >= USER_SEARCH_PER_PAGE;
    if (results.length === 0) showMessage('No users found', 'warning');
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'User search failed', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

export async function submitCodeSearch(value) {
  const query = (value || '').trim();
  if (!query) return;
  const gen = startAsync();
  appState.loading = true;
  appState.searchQuery = query;
  appState.searchType = 'code';
  appState.selectedRepo = 0;
  appState.searchScroll = 0;
  appState.codeSearchPage = 1;
  appState.analyzeView = 'results';
  render();
  try {
    const results = await searchCode(appState.token, query, 1, CODE_SEARCH_PER_PAGE);
    if (isStale(gen)) { appState.loading = false; return; }
    appState.codeSearchResults = results;
    appState.codeSearchHasMore = results.length >= CODE_SEARCH_PER_PAGE;
    if (results.length === 0) showMessage('No code results found', 'warning');
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Code search failed', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

registerInputHandler('user-search', submitUserSearch);
registerInputHandler('code-search', submitCodeSearch);

async function openUserProfile(login) {
  if (!login) return;
  const gen = startAsync();
  appState.loading = true;
  render();
  try {
    const user = await getUser(appState.token, login);
    if (isStale(gen)) { appState.loading = false; return; }
    if (user && user.html_url) {
      showMessage('@' + login + ': ' + (user.name || '') + ' — ' + user.public_repos + ' repos, ' + user.followers + ' followers', 'info', 5000);
      openUrl(user.html_url).then(res => {
        if (!res.ok) showMessage(res.error || 'Open failed', 'error');
      });
    }
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to load user: ' + e.message, 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

registerInputHandler('save-search', (label) => {
  const v = (label || '').trim();
  if (!v) return;
  const query = appState.searchQuery;
  if (!query) { showMessage('No search query to save', 'warning'); return; }
  appState.savedSearches = addSavedSearch(v, query);
  showMessage('Saved search: ' + v, 'success');
});

export async function loadMoreSearchResults() {
  const type = appState.searchType || 'repos';
  const gen = startAsync();
  appState.loading = true;
  render();
  try {
    const page = type === 'users' ? appState.userSearchPage + 1
      : type === 'code' ? appState.codeSearchPage + 1
      : appState.searchPage + 1;
    let more;
    if (type === 'users') {
      if (!appState.userSearchHasMore) { appState.loading = false; render(); return; }
      more = await searchUsers(appState.token, appState.searchQuery, page, USER_SEARCH_PER_PAGE);
    } else if (type === 'code') {
      if (!appState.codeSearchHasMore) { appState.loading = false; render(); return; }
      more = await searchCode(appState.token, appState.searchQuery, page, CODE_SEARCH_PER_PAGE);
    } else {
      if (!appState.searchHasMore) { appState.loading = false; render(); return; }
      more = await searchRepositories(appState.token, appState.searchQuery, page, SEARCH_PER_PAGE);
    }
    if (isStale(gen)) { appState.loading = false; return; }
    if (type === 'users') {
      appState.userSearchResults = [...appState.userSearchResults, ...more];
      appState.userSearchPage = page;
      appState.userSearchHasMore = more.length >= USER_SEARCH_PER_PAGE;
    } else if (type === 'code') {
      appState.codeSearchResults = [...appState.codeSearchResults, ...more];
      appState.codeSearchPage = page;
      appState.codeSearchHasMore = more.length >= CODE_SEARCH_PER_PAGE;
    } else {
      appState.searchResults = [...appState.searchResults, ...more];
      appState.searchPage = page;
      appState.searchHasMore = more.length >= SEARCH_PER_PAGE;
    }
    if (more.length === 0) showMessage('No more results', 'info');
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Failed to load more', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

export function cycleIssueStateFilter() {
  if (appState.analyzeView !== 'details') return;
  if (appState.detailsPane !== 'issues' && appState.detailsPane !== 'prs') return;
  const cycle = { 'open': 'closed', 'closed': 'all', 'all': 'open' };
  appState.issueStateFilter = cycle[appState.issueStateFilter] || 'open';
  showMessage('Issues/PRs state filter: ' + appState.issueStateFilter, 'info', 1500);
  const repo = appState.repoDetails;
  if (!repo) return;
  const [owner, name] = repo.full_name.split('/');
  const gen = startAsync();
  if (appState.detailsPane === 'issues') {
    getRepositoryIssues(appState.token, owner, name, 1, 100, appState.issueStateFilter).then(issues => {
      if (isStale(gen)) { appState.loading = false; return; }
      appState.repoIssues = Array.isArray(issues) ? issues.filter(i => !i.pull_request) : [];
      appState.detailsScroll = 0;
      render();
    }).catch(e => { if (!isStale(gen)) showMessage(e.message || 'Failed to reload issues', 'error'); });
  } else {
    getRepositoryPullRequests(appState.token, owner, name, 1, 100, appState.issueStateFilter).then(prs => {
      if (isStale(gen)) { appState.loading = false; return; }
      appState.repoPullRequests = Array.isArray(prs) ? prs : [];
      appState.detailsScroll = 0;
      render();
    }).catch(e => { if (!isStale(gen)) showMessage(e.message || 'Failed to reload PRs', 'error'); });
  }
}

export function pageUp() {
  if (appState.analyzeView === 'results' && appState.searchPage > 1) {
    const page = appState.searchPage - 1;
    const gen = startAsync();
    appState.loading = true;
    render();
    searchRepositories(appState.token, appState.searchQuery, page, SEARCH_PER_PAGE).then(more => {
      if (isStale(gen)) { appState.loading = false; return; }
      if (Array.isArray(more)) {
        appState.searchResults = more;
        appState.searchPage = page;
        appState.searchHasMore = more.length >= SEARCH_PER_PAGE;
        appState.selectedRepo = 0;
        appState.searchScroll = 0;
      }
      appState.loading = false;
      render();
    }).catch(e => { if (!isStale(gen)) showMessage(e.message || 'Page up failed', 'error'); appState.loading = false; render(); });
  } else if (appState.analyzeView === 'forks') {
    loadMoreForks();
  }
}

export function pageDown() {
  if (appState.analyzeView === 'results' && appState.searchHasMore) {
    const page = appState.searchPage + 1;
    const gen = startAsync();
    appState.loading = true;
    render();
    searchRepositories(appState.token, appState.searchQuery, page, SEARCH_PER_PAGE).then(more => {
      if (isStale(gen)) { appState.loading = false; return; }
      if (Array.isArray(more) && more.length > 0) {
        appState.searchResults = more;
        appState.searchPage = page;
        appState.searchHasMore = more.length >= SEARCH_PER_PAGE;
        appState.selectedRepo = 0;
        appState.searchScroll = 0;
      } else {
        appState.searchHasMore = false;
      }
      appState.loading = false;
      render();
    }).catch(e => { if (!isStale(gen)) showMessage(e.message || 'Page down failed', 'error'); appState.loading = false; render(); });
  } else if (appState.analyzeView === 'forks') {
    loadMoreForks();
  }
}

export async function loadRepoDetails(owner, name) {
  const gen = startAsync();
  appState.loading = true;
  appState.detailsPane = 'overview';
  appState.detailsScroll = 0;
  appState.repoLanguages = null;
  appState.repoContributors = [];
  appState.repoReleases = [];
  appState.repoIssues = [];
  appState.repoPullRequests = [];
  appState._readmeText = null;
  appState.repoReleaseAssets = [];
  appState.repoTraffic = null;
  appState.repoTrafficClones = null;
  appState.repoMilestones = [];
  appState.repoLabels = [];
  appState.repoCheckRuns = [];
  appState.repoCheckSuites = [];
  appState.repoDependabotAlerts = [];
  render();
  try {
    const details = await getRepositoryDetails(appState.token, owner, name);
    if (isStale(gen)) { appState.loading = false; return; }
    appState.repoDetails = details;
    appState.analyzeView = 'details';
    // Track in recent repos.
    pushRecentRepo(details);
    render();

    const safe = (p) => p.catch(() => null);
    const issueState = appState.issueStateFilter;
    const [langs, contribs, releases, issues, prs] = await Promise.all([
      safe(getRepositoryLanguages(appState.token, owner, name)),
      safe(getRepositoryContributors(appState.token, owner, name, 1, 10)),
      safe(getRepositoryReleases(appState.token, owner, name, 1, 5)),
      safe(getRepositoryIssues(appState.token, owner, name, 1, 100, issueState)),
      safe(getRepositoryPullRequests(appState.token, owner, name, 1, 100, issueState)),
    ]);
    if (isStale(gen)) { appState.loading = false; return; }
    appState.repoLanguages = langs || null;
    appState.repoContributors = Array.isArray(contribs) ? contribs : [];
    appState.repoReleases = Array.isArray(releases) ? releases : [];
    appState.repoIssues = Array.isArray(issues) ? issues.filter(i => !i.pull_request) : [];
    appState.repoPullRequests = Array.isArray(prs) ? prs : [];
    showMessage('Loaded ' + owner + '/' + name, 'success');
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Failed to load repository', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

export async function viewReadme() {
  const repo = appState.repoDetails;
  if (!repo) return;
  const gen = startAsync();
  appState.loading = true;
  render();
  try {
    const [owner, name] = repo.full_name.split('/');
    const md = await getReadme(appState.token, owner, name);
    if (isStale(gen)) { appState.loading = false; return; }
    appState.detailsPane = 'readme';
    appState.detailsScroll = 0;
    appState._readmeText = md || '(empty README)';
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'README unavailable', 'warning');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

export async function loadReleaseAssets() {
  const repo = appState.repoDetails;
  if (!repo || !appState.repoReleases.length) return;
  const gen = startAsync();
  appState.loading = true;
  appState.repoReleaseAssets = [];
  render();
  try {
    const [owner, name] = repo.full_name.split('/');
    const allAssets = [];
    for (const rel of appState.repoReleases.slice(0, 3)) {
      const assets = await getReleaseAssets(appState.token, owner, name, rel.id);
      if (isStale(gen)) { appState.loading = false; return; }
      if (Array.isArray(assets)) {
        for (const a of assets) {
          allAssets.push({ ...a, releaseTag: rel.tag_name, releaseName: rel.name });
        }
      }
    }
    appState.repoReleaseAssets = allAssets;
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to load release assets', 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

export async function downloadAsset(asset) {
  if (!asset || !asset.browser_download_url) return;
  const fileName = asset.name || 'download';
  const dest = safeCwdJoin(fileName);
  if (existsSync(dest)) {
    showMessage('File ' + fileName + ' already exists', 'warning');
    return;
  }
  showMessage('Downloading ' + fileName + '...', 'info');
  render();
  try {
    const res = await downloadToFile(asset.browser_download_url, dest, appState.token);
    showMessage('Downloaded ' + fileName + ' (' + formatBytes(res.bytes) + ')', 'success');
  } catch (e) {
    showMessage('Download failed: ' + e.message, 'error');
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

export async function loadTraffic() {
  const repo = appState.repoDetails;
  if (!repo) return;
  const gen = startAsync();
  appState.loading = true;
  appState.repoTraffic = null;
  appState.repoTrafficClones = null;
  appState.repoTrafficPopularPaths = [];
  appState.repoTrafficPopularReferrers = [];
  render();
  try {
    const [owner, name] = repo.full_name.split('/');
    const safe = (p) => p.catch(() => null);
    const [views, clones, paths, referrers] = await Promise.all([
      safe(getRepoTrafficViews(appState.token, owner, name)),
      safe(getRepoTrafficClones(appState.token, owner, name)),
      safe(getRepoTrafficPopularPaths(appState.token, owner, name)),
      safe(getRepoTrafficPopularReferrers(appState.token, owner, name)),
    ]);
    if (isStale(gen)) { appState.loading = false; return; }
    appState.repoTraffic = views;
    appState.repoTrafficClones = clones;
    appState.repoTrafficPopularPaths = Array.isArray(paths) ? paths : [];
    appState.repoTrafficPopularReferrers = Array.isArray(referrers) ? referrers : [];
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to load traffic: ' + e.message, 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

function renderTrafficPane(screen, y, maxH) {
  const W = screen.width;
  const views = appState.repoTraffic;
  const clones = appState.repoTrafficClones;
  sectionHeader(screen, 2, y, '📊 TRAFFIC');
  y++;

  if (!views && !clones) {
    if (appState.loading) {
      loadingIndicator(screen, 2, y, 'loading traffic');
      y++;
      return;
    }
    screen.writeStr(2, y++, 'No traffic data — may require push access', { dim: true });
    return;
  }

  if (!views || (views.count === 0 && (!clones || clones.count === 0))) {
    screen.writeStr(2, y++, 'No traffic data yet — stats appear once a repo has visitors', { dim: true });
    screen.writeStr(2, y++, 'Press [T] to retry', { fg: 'cyan' });
    return;
  }

  // Views summary
  if (views) {
    screen.writeStr(2, y, 'Views:', { fg: 'cyan', bold: true });
    screen.writeStr(10, y, String(views.count || 0), { fg: 'white' });
    screen.writeStr(20, y, 'unique:', { dim: true });
    screen.writeStr(28, y, String(views.uniques || 0), { fg: 'white' });
    y++;
  }

  // Clones summary
  if (clones) {
    screen.writeStr(2, y, 'Clones:', { fg: 'cyan', bold: true });
    screen.writeStr(10, y, String(clones.count || 0), { fg: 'white' });
    screen.writeStr(20, y, 'unique:', { dim: true });
    screen.writeStr(28, y, String(clones.uniques || 0), { fg: 'white' });
    y++;
  }

  y++;

  // Popular paths
  const paths = appState.repoTrafficPopularPaths;
  if (paths.length > 0) {
    sectionHeader(screen, 2, y, 'Popular Paths');
    y++;
    const y0 = y;
    for (const p of paths.slice(0, 5)) {
      if (y >= y0 + maxH - 1) break;
      screen.writeStr(4, y, truncate(p.path || '', 30));
      screen.writeStr(36, y, String(p.count || 0), { dim: true });
      screen.writeStr(44, y, String(p.uniques || 0) + ' unique', { dim: true });
      y++;
    }
    y++;
  }

  // Popular referrers
  const referrers = appState.repoTrafficPopularReferrers;
  if (referrers.length > 0) {
    sectionHeader(screen, 2, y, 'Popular Referrers');
    y++;
    const y1 = y;
    for (const r of referrers.slice(0, 5)) {
      if (y >= y1 + maxH - 1) break;
      screen.writeStr(4, y, truncate(r.referrer || '', 30));
      screen.writeStr(36, y, String(r.count || 0), { dim: true });
      screen.writeStr(44, y, String(r.uniques || 0) + ' unique', { dim: true });
      y++;
    }
  }
}

export async function loadMilestones() {
  const repo = appState.repoDetails;
  if (!repo) return;
  const gen = startAsync();
  appState.loading = true;
  appState.repoMilestones = [];
  render();
  try {
    const [owner, name] = repo.full_name.split('/');
    const milestones = await getRepoMilestones(appState.token, owner, name);
    if (isStale(gen)) { appState.loading = false; return; }
    appState.repoMilestones = Array.isArray(milestones) ? milestones : [];
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to load milestones: ' + e.message, 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

function renderMilestonesPane(screen, y, maxH) {
  const W = screen.width;
  const milestones = appState.repoMilestones;
  sectionHeader(screen, 2, y, '📋 MILESTONES (' + milestones.length + ')');
  y++;

  if (milestones.length === 0) {
    screen.writeStr(2, y++, 'No milestones — create one on GitHub to track progress', { dim: true });
    return;
  }

  const yM = y;
  for (const m of milestones) {
    if (y >= yM + maxH - 1) break;
    const title = truncate(m.title || '', 30);
    const state = m.state === 'open' ? '○' : '●';
    const stateStyle = m.state === 'open' ? { fg: 'green' } : { dim: true };
    const due = m.due_on ? new Date(m.due_on).toISOString().split('T')[0] : 'no due date';
    const issues = (m.open_issues || 0) + '/' + ((m.open_issues || 0) + (m.closed_issues || 0));

    screen.writeStr(2, y, state, stateStyle);
    screen.writeStr(4, y, title, { fg: 'white' });
    screen.writeStr(36, y, due, { dim: true });
    screen.writeStr(52, y, issues + ' issues', { dim: true });
    y++;
  }
}

export async function loadLabels() {
  const repo = appState.repoDetails;
  if (!repo) return;
  const gen = startAsync();
  appState.loading = true;
  appState.repoLabels = [];
  render();
  try {
    const [owner, name] = repo.full_name.split('/');
    const labels = await getRepoLabels(appState.token, owner, name);
    if (isStale(gen)) { appState.loading = false; return; }
    appState.repoLabels = Array.isArray(labels) ? labels : [];
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to load labels: ' + e.message, 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

function renderLabelsPane(screen, y, maxH) {
  const W = screen.width;
  const labels = appState.repoLabels;
  sectionHeader(screen, 2, y, '🏷️  LABELS (' + labels.length + ')');
  y++;

  if (labels.length === 0) {
    screen.writeStr(2, y++, 'No labels — manage labels on GitHub to categorize issues', { dim: true });
    return;
  }

  const yL = y;
  for (const l of labels) {
    if (y >= yL + maxH - 1) break;
    const name = truncate(l.name || '', 25);
    const desc = truncate(l.description || '', 35);
    const colorHex = l.color || 'ededed';
    screen.writeStr(2, y, '██', { fg: mapLabelColor(colorHex) });
    screen.writeStr(5, y, name, { fg: 'white' });
    if (desc && 32 + desc.length < W) {
      screen.writeStr(32, y, desc, { dim: true });
    }
    y++;
  }
}

function mapLabelColor(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  if (r > 180 && g < 100 && b < 100) return 'red';
  if (r < 100 && g > 180 && b < 100) return 'green';
  if (r < 100 && g < 100 && b > 180) return 'blue';
  if (r > 180 && g > 180 && b < 100) return 'yellow';
  if (r > 180 && g < 100 && b > 180) return 'magenta';
  if (r < 100 && g > 180 && b > 180) return 'cyan';
  if (r > 200 && g > 200 && b > 200) return 'white';
  if (r < 80 && g < 80 && b < 80) return 'darkGray';
  return 'white';
}

export async function loadChecks() {
  const repo = appState.repoDetails;
  if (!repo) return;
  const gen = startAsync();
  appState.loading = true;
  appState.repoCheckRuns = [];
  appState.repoCheckSuites = [];
  render();
  try {
    const [owner, name] = repo.full_name.split('/');
    const [runs, suites] = await Promise.all([
      getRepoCheckRuns(appState.token, owner, name, repo.default_branch),
      getRepoCheckSuites(appState.token, owner, name, repo.default_branch),
    ]);
    if (isStale(gen)) { appState.loading = false; return; }
    appState.repoCheckRuns = (runs && runs.check_runs) ? runs.check_runs : [];
    appState.repoCheckSuites = (suites && suites.check_suites) ? suites.check_suites : [];
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to load checks: ' + e.message, 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

function renderChecksPane(screen, y, maxH) {
  const W = screen.width;
  const runs = appState.repoCheckRuns;
  const suites = appState.repoCheckSuites;
  sectionHeader(screen, 2, y, '✅ CHECKS/CI (' + runs.length + ' runs, ' + suites.length + ' suites)');
  y++;

  if (runs.length === 0 && suites.length === 0) {
    screen.writeStr(2, y++, 'No checks — push commits to see CI status here', { dim: true });
    return;
  }

  // Summary stats
  const completed = runs.filter(r => r.status === 'completed');
  const success = completed.filter(r => r.conclusion === 'success');
  const failed = completed.filter(r => r.conclusion === 'failure');
  const pending = runs.filter(r => r.status !== 'completed');

  if (y < y + maxH - 1) {
    const summary = '✅ ' + success.length + ' passed   ❌ ' + failed.length + ' failed   ⏳ ' + pending.length + ' pending';
    screen.writeStr(2, y, summary, { dim: true });
    y++;
    y++;
  }

  // List check runs
  const yR = y;
  for (const run of runs) {
    if (y >= yR + maxH - 1) break;
    const icon = run.status !== 'completed' ? '⏳'
      : run.conclusion === 'success' ? '✅'
      : run.conclusion === 'failure' ? '❌'
      : run.conclusion === 'cancelled' ? '⚠️'
      : '❓';
    const name = truncate(run.name || '?', 30);
    const status = run.status === 'completed' ? run.conclusion : run.status;
    screen.writeStr(2, y, icon);
    screen.writeStr(5, y, name, { fg: 'white' });
    if (37 + status.length < W) {
      screen.writeStr(37, y, status, { dim: true });
    }
    y++;
  }
}

function renderPackagesPane(screen, y, maxH) {
  const W = screen.width;
  const assets = appState.repoReleaseAssets;
  sectionHeader(screen, 2, y, '📦 RELEASE PACKAGES (' + assets.length + ')');
  if (assets.length === 0) {
    if (appState.loading) {
      loadingIndicator(screen, 2, y + 2, 'loading assets');
    } else {
      screen.writeStr(2, y + 2, '(no release packages found)', { dim: true });
    }
    return;
  }
  screen.hline(y + 1, '─', { dim: true });
  const start = appState.detailsScroll;
  const rows = Math.max(1, maxH - 4);
  for (let i = 0; i < rows && start + i < assets.length; i++) {
    const a = assets[start + i];
    const row = y + 2 + i;
    const sel = start + i === appState.selectedAsset;
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    screen.writeStr(2, row, sel ? '▶' : '  ', sel ? color('selection') : color('dim'));
    const name = truncate(a.name || '?', 35);
    screen.writeStr(5, row, name, sel ? color('selection') : color('packageName'));
    const size = a.size ? formatBytes(a.size) : '?';
    screen.writeStr(42, row, size, sel ? color('selection') : color('packageSize'));
    const tag = truncate(a.releaseTag || '', 12);
    screen.writeStr(54, row, tag, sel ? color('selection') : color('packageTag'));
    const dl = a.download_count !== undefined ? '↓' + a.download_count : '';
    if (dl && 68 + dl.length < W) {
      screen.writeStr(68, row, dl, sel ? color('selection') : color('downloadCount'));
    }
  }
  scrollIndicators(screen, y + 2, y + 1 + rows, start, assets.length);
  const infoY = y + 2 + Math.min(rows, assets.length);
  if (infoY < y + maxH) {
    const range = (start + 1) + '-' + Math.min(start + rows, assets.length) + ' of ' + assets.length;
    screen.writeStr(2, infoY, range + '   [Enter] Download   [↑↓] Navigate', { dim: true });
  }
}

export async function loadSecurity() {
  const repo = appState.repoDetails;
  if (!repo) return;
  const gen = startAsync();
  appState.loading = true;
  appState.repoDependabotAlerts = [];
  render();
  try {
    const [owner, name] = repo.full_name.split('/');
    const alerts = await getRepoDependabotAlerts(appState.token, owner, name);
    if (isStale(gen)) { appState.loading = false; return; }
    appState.repoDependabotAlerts = Array.isArray(alerts) ? alerts : [];
  } catch (e) {
    if (!isStale(gen)) showMessage('Failed to load security alerts: ' + e.message, 'error');
  }
  appState.loading = false;
  if (!isStale(gen)) render();
}

function renderSecurityPane(screen, y, maxH) {
  const W = screen.width;
  const alerts = appState.repoDependabotAlerts;
  sectionHeader(screen, 2, y, '🔒 SECURITY (' + alerts.length + ' alerts)');
  y++;

  if (alerts.length === 0) {
    screen.writeStr(2, y++, 'No Dependabot alerts — dependencies look clean', { dim: true });
    return;
  }

  const yA = y;
  for (const alert of alerts) {
    if (y >= yA + maxH - 1) break;
    const severity = alert.security_advisory?.severity || '?';
    const severityIcon = severity === 'critical' ? '🔴' : severity === 'high' ? '🟠' : severity === 'medium' ? '🟡' : '⚪';
    const pkg = alert.dependency?.package?.name || '?';
    const summary = truncate(alert.security_advisory?.summary || '?', 30);
    const state = alert.state || '?';
    screen.writeStr(2, y, severityIcon);
    screen.writeStr(5, y, truncate(pkg, 15), { fg: 'white' });
    screen.writeStr(22, y, summary, { dim: true });
    if (54 + state.length < W) {
      screen.writeStr(54, y, state, { dim: true });
    }
    y++;
  }
}

function sectionHeader(screen, x, y, text, hint) {
  screen.writeStr(x, y, text, { fg: 'cyan', bold: true });
  if (hint) {
    const hx = screen.width - hint.length - 2;
    if (hx > x + text.length + 4) screen.writeStr(hx, y, hint, { dim: true });
  }
}

function renderSearchInput(screen, y, h) {
  const W = screen.width;
  const inputY = y + 3;
  const inputW = Math.min(50, W - 12);

  sectionHeader(screen, 2, inputY - 1, '🔎 SEARCH PUBLIC REPOSITORIES');
  screen.box(2, inputY, inputW + 2, 3, '');

  if (appState.inputMode) {
    const shown = appState.inputMask
      ? '*'.repeat(appState.inputBuffer.length) : appState.inputBuffer;
    screen.writeStr(4, inputY + 1,
      (appState.inputPrompt + shown + '_').substring(0, inputW - 2), { fg: 'cyan', underline: true });
  } else {
    screen.writeStr(4, inputY + 1, 'Type a repo name or keywords...', { dim: true });
  }

  // Tips + quick examples.
  let tipY = inputY + 4;
  screen.writeStr(2, tipY, '💡 Tips', { fg: 'yellow', bold: true });
  const tips = [
    '• Search by name:    facebook/react',
    '• Search by topic:   language:rust stars:>1000',
    '• Filter orgs:       org:microsoft',
    '• Combine filters:   machine learning language:python',
  ];
  for (const t of tips) {
    screen.writeStr(2, ++tipY, t, { dim: true });
  }

  // Recent repos (if any) — quick access.
  if (appState.recentRepos.length > 0) {
    tipY += 2;
    sectionHeader(screen, 2, tipY, '🕘 RECENT');
    const recentStart = tipY;
    tipY++;
    let recentIdx = 0;
    for (const r of appState.recentRepos.slice(0, 5)) {
      screen.writeStr(2, tipY, truncate(r.full_name, W - 4), { fg: 'white' });
      if (r.description) {
        const desc = '  ' + truncate(r.description, W - 22);
        screen.writeStr(2 + 2 + truncate(r.full_name, W - 4).length, tipY, desc, { dim: true });
      }
      tipY++;
      recentIdx++;
      if (tipY > y + h - 2) break;
    }
    appState._recentReposBounds = { x: 2, y: recentStart, count: recentIdx };
  }
}

function renderResultsList(screen, y, h) {
  const W = screen.width;
  const type = appState.searchType || 'repos';
  const typeLabel = type === 'repos' ? 'REPOS' : type === 'users' ? 'USERS' : 'CODE';
  screen.writeStr(2, y + 1, 'Search ' + typeLabel + ':', { fg: 'white', bold: true });
  screen.writeStr(14 + typeLabel.length, y + 1, appState.searchQuery || '', { fg: 'cyan' });
  const hint = type === 'repos' ? '[i] Search repos   [u] Search users   [C] Search code'
    : type === 'users' ? '[i] Search repos   [u] Search users   [C] Search code'
    : '[i] Search repos   [u] Search users   [C] Search code';
  screen.writeStr(2, y + 2, hint, { dim: true });

  const listY = y + 4;
  const maxVisible = Math.max(1, Math.min(8, h - 10));

  if (type === 'users') {
    renderUserResults(screen, listY, h, W, maxVisible);
  } else if (type === 'code') {
    renderCodeResults(screen, listY, h, W, maxVisible);
  } else {
    renderRepoResults(screen, listY, h, W, maxVisible);
  }
}

function renderRepoResults(screen, listY, h, W, maxVisible) {
  const results = appState.searchResults;
  if (results.length === 0) {
    emptyState(screen, listY, h - 4, {
      icon: '○', title: 'No repos found',
      message: 'Try different keywords',
      hint: '[Esc] Back',
    });
    return;
  }
  sectionHeader(screen, 2, listY, '◫ REPOSITORIES', '[' + results.length + ']');
  screen.hline(listY + 1, '─', { dim: true });
  const start = appState.searchScroll;
  for (let i = 0; i < maxVisible && start + i < results.length; i++) {
    const repo = results[start + i];
    const row = listY + 2 + i;
    const sel = start + i === appState.selectedRepo;
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    screen.writeStr(2, row, sel ? '▶' : '  ', sel ? color('selection') : color('dim'));
    screen.writeStr(5, row, truncate(repo.full_name, 30), sel ? color('selection') : color('repoName'));
    const stats = '★' + shortNum(repo.stargazers_count) +
      '   ⑂' + shortNum(repo.forks_count) +
      '   ⚡' + shortNum(repo.open_issues_count);
    screen.writeStr(36, row, stats, sel ? color('selection') : color('dim'));
  }
  scrollIndicators(screen, listY + 2, listY + 1 + maxVisible, appState.searchScroll, results.length);

  const countY = listY + 2 + maxVisible;
  if (countY < listY + h) {
    const pageInfo = appState.searchHasMore || appState.searchPage > 1
      ? '   Page ' + appState.searchPage + '   [PgUp/PgDn]' : '';
    screen.writeStr(2, countY, results.length + ' results' + pageInfo, { dim: true });
  }
}

function renderUserResults(screen, listY, h, W, maxVisible) {
  const results = appState.userSearchResults;
  if (results.length === 0) {
    emptyState(screen, listY, h - 4, {
      icon: '○', title: 'No users found',
      message: 'Try different keywords',
      hint: '[Esc] Back',
    });
    return;
  }
  sectionHeader(screen, 2, listY, '◫ USERS', '[' + results.length + ']');
  screen.hline(listY + 1, '─', { dim: true });
  const start = appState.searchScroll;
  for (let i = 0; i < maxVisible && start + i < results.length; i++) {
    const user = results[start + i];
    const row = listY + 2 + i;
    const sel = start + i === appState.selectedRepo;
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    screen.writeStr(2, row, sel ? '▶' : '  ', sel ? color('selection') : color('dim'));
    screen.writeStr(5, row, truncate(user.login || '?', 20), sel ? color('selection') : { fg: 'cyan', bold: true });
    const type = user.type || '';
    screen.writeStr(28, row, type, sel ? color('selection') : color('dim'));
  }
  scrollIndicators(screen, listY + 2, listY + 1 + maxVisible, appState.searchScroll, results.length);

  const countY = listY + 2 + maxVisible;
  if (countY < y + h) {
    const pageInfo = appState.userSearchHasMore || appState.userSearchPage > 1
      ? '   Page ' + appState.userSearchPage + '   [PgUp/PgDn]' : '';
    screen.writeStr(2, countY, results.length + ' results' + pageInfo, { dim: true });
  }
}

function renderCodeResults(screen, listY, h, W, maxVisible) {
  const results = appState.codeSearchResults;
  if (results.length === 0) {
    emptyState(screen, listY, h - 4, {
      icon: '○', title: 'No code results found',
      message: 'Try different search terms',
      hint: '[Esc] Back',
    });
    return;
  }
  sectionHeader(screen, 2, listY, '◫ CODE', '[' + results.length + ']');
  screen.hline(listY + 1, '─', { dim: true });
  const start = appState.searchScroll;
  for (let i = 0; i < maxVisible && start + i < results.length; i++) {
    const item = results[start + i];
    const row = listY + 2 + i;
    const sel = start + i === appState.selectedRepo;
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    const path = truncate(item.path || '?', 25);
    const repo = item.repository ? item.repository.full_name : '?';
    screen.writeStr(2, row, sel ? '▶' : '  ', sel ? color('selection') : color('dim'));
    screen.writeStr(5, row, path, sel ? color('selection') : { fg: 'white' });
    screen.writeStr(32, row, truncate(repo, W - 35), sel ? color('selection') : { fg: 'cyan' });
  }
  scrollIndicators(screen, listY + 2, listY + 1 + maxVisible, appState.searchScroll, results.length);

  const countY = listY + 2 + maxVisible;
  if (countY < y + h) {
    const pageInfo = appState.codeSearchHasMore || appState.codeSearchPage > 1
      ? '   Page ' + appState.codeSearchPage + '   [PgUp/PgDn]' : '';
    screen.writeStr(2, countY, results.length + ' results' + pageInfo, { dim: true });
  }
}

function filterLabel(state) {
  return state === 'all' ? 'ALL' : state === 'closed' ? 'CLOSED' : 'OPEN';
}

function renderIssuesPane(screen, y, maxH) {
  const state = appState.issueStateFilter;
  renderIssuePRList(screen, y, maxH, {
    title: filterLabel(state) + ' ISSUES',
    items: appState.repoIssues,
    hint: '[s] ' + filterLabel(state),
    emptyMsg: state === 'all' ? '(no issues)' : '(no ' + filterLabel(state).toLowerCase() + ' issues)',
    numColor: { fg: 'yellow' },
    getCols: (W) => ({
      numW: 7, titleCol: 12,
      authorCol: Math.max(32, W - 24),
      extraCol: Math.max(46, W - 10),
    }),
    renderExtra: (screen, item, col, W, row) => {
      const labels = (item.labels || []).map(l => l.name).slice(0, 2).join(', ');
      if (col + 8 < W && labels) {
        screen.writeStr(col, row, truncate(labels, 8), { fg: 'magenta' });
      }
    },
  });
}

function renderPRsPane(screen, y, maxH) {
  const state = appState.issueStateFilter;
  renderIssuePRList(screen, y, maxH, {
    title: filterLabel(state) + ' PULL REQUESTS',
    items: appState.repoPullRequests,
    hint: '[s] ' + filterLabel(state),
    emptyMsg: state === 'all' ? '(no PRs)' : '(no ' + filterLabel(state).toLowerCase() + ' PRs)',
    numColor: { fg: 'cyan' },
    getCols: (W) => ({
      numW: 7, titleCol: 12,
      authorCol: Math.max(32, W - 24),
      extraCol: Math.max(46, W - 10),
    }),
    renderExtra: (screen, item, col, W, row) => {
      if (col + 8 < W) {
        const branch = ((item.head && item.head.ref) || '').substring(0, 8);
        screen.writeStr(col, row, branch, { fg: 'magenta' });
      }
    },
  });
}

function renderIssuePRList(screen, y, maxH, opts) {
  const W = screen.width;
  const items = opts.items;
  sectionHeader(screen, 2, y, opts.title + ' (' + items.length + ')', opts.hint);
  if (items.length === 0) { screen.writeStr(2, y + 2, opts.emptyMsg, { dim: true }); return; }
  const start = appState.detailsScroll;
  const rows = Math.max(1, maxH - 3);
  const cols = opts.getCols(W);

  for (let i = 0; i < rows && start + i < items.length; i++) {
    const item = items[start + i];
    const row = y + 2 + i;
    const num = '#' + item.number;
    screen.writeStr(2, row, num.padEnd(cols.numW), opts.numColor);
    const draft = item.draft ? '[draft] ' : '';
    screen.writeStr(cols.titleCol, row,
      truncate(draft + (item.title || '?'), cols.authorCol - cols.titleCol - 2),
      item.draft ? { dim: true } : null);
    if (cols.authorCol + 12 < W) {
      screen.writeStr(cols.authorCol, row,
        truncate((item.user && item.user.login) || '', 12), { dim: true });
    }
    opts.renderExtra(screen, item, cols.extraCol, W, row);
  }
  scrollIndicators(screen, y + 2, y + 1 + rows, start, items.length);
  if (items.length > rows) {
    screen.writeStr(2, y + 2 + rows,
      (start + 1) + '-' + Math.min(start + rows, items.length) + ' of ' + items.length +
      '   [↑↓] scroll', { dim: true });
  }
}

// Naive Markdown rendering with improved styling.
function renderReadmePane(screen, y, maxH) {
  const W = screen.width;
  sectionHeader(screen, 2, y, '📖 README');
  screen.hline(y + 1, '─', { dim: true });
  const text = appState._readmeText || '(no README loaded)';
  const lines = text.split(/\r?\n/);
  const start = appState.detailsScroll;
  const rows = Math.max(1, maxH - 4);
  for (let i = 0; i < rows && start + i < lines.length; i++) {
    const ln = lines[start + i];
    const row = y + 2 + i;
    if (/^#{1,6}\s/.test(ln)) {
      screen.writeStr(2, row, ln.replace(/^#+\s*/, ''), { bold: true });
    } else if (/^\s*[-*+]\s/.test(ln)) {
      screen.writeStr(2, row, truncate(ln, W - 6), { fg: 'cyan' });
    } else if (/^\s*```/.test(ln)) {
      screen.writeStr(2, row, truncate(ln, W - 6), { dim: true });
    } else if (/^\s*>/.test(ln)) {
      screen.writeStr(2, row, truncate(ln, W - 6), { dim: true });
    } else if (/^#{1,6}\s*[-=]+$/.test(ln)) {
      continue;
    } else {
      screen.writeStr(2, row, truncate(ln, W - 6));
    }
  }
  scrollIndicators(screen, y + 2, y + 1 + rows, start, lines.length);
  if (lines.length > rows) {
    screen.writeStr(2, y + 2 + rows,
      'Lines ' + (start + 1) + '-' + Math.min(start + rows, lines.length) +
      ' of ' + lines.length + '   [↑↓] scroll   [O] back', { dim: true });
  }
}

function renderRepoDetails(screen, y, maxH) {
  const W = screen.width;
  const repo = appState.repoDetails;
  if (!repo) return;

  // Repo name.
  screen.writeStr(2, y, repo.full_name, { fg: 'white', bold: true });

  // Pane tabs as chips.
  const panes = [
    ['overview', 'Overview',                                    'O'],
    ['issues',   'Issues (' + appState.repoIssues.length + ')',         'i'],
    ['prs',      'PRs (' + appState.repoPullRequests.length + ')',      'P'],
    ['readme',   'README',                                      'R'],
    ['files',    'Files',                                       'F'],
    ['packages', 'Packages',                                    'A'],
    ['traffic',  'Traffic',                                     'T'],
    ['milestones', 'Milestones',                                'M'],
    ['labels',   'Labels',                                      'L'],
    ['checks',   'Checks',                                      'K'],
    ['security', 'Security',                                    'S'],
  ];
  let px = 2;
  for (const [id, label, k] of panes) {
    const sel = appState.detailsPane === id;
    const text = '[' + k + '] ' + label;
    const style = sel ? { bg: 'cyan', fg: 'darkGray', bold: true } : { dim: true };
    screen.writeStr(px, y + 1, text, style);
    px += text.length + 2;
  }
  screen.hline(y + 2, '─', { dim: true });

  if (appState.detailsPane === 'issues') { renderIssuesPane(screen, y + 3, maxH - 3); return; }
  if (appState.detailsPane === 'prs')    { renderPRsPane(screen, y + 3, maxH - 3); return; }
  if (appState.detailsPane === 'readme') { renderReadmePane(screen, y + 3, maxH - 3); return; }
  if (appState.detailsPane === 'files')  { files.renderFilesPane(screen, y + 3, maxH - 3); return; }
  if (appState.detailsPane === 'packages') { renderPackagesPane(screen, y + 3, maxH - 3); return; }
  if (appState.detailsPane === 'traffic') { renderTrafficPane(screen, y + 3, maxH - 3); return; }
  if (appState.detailsPane === 'milestones') { renderMilestonesPane(screen, y + 3, maxH - 3); return; }
  if (appState.detailsPane === 'labels') { renderLabelsPane(screen, y + 3, maxH - 3); return; }
  if (appState.detailsPane === 'checks') { renderChecksPane(screen, y + 3, maxH - 3); return; }
  if (appState.detailsPane === 'security') { renderSecurityPane(screen, y + 3, maxH - 3); return; }

  // Overview pane: 2-column layout.
  const leftWidth = Math.min(48, Math.floor(W / 2));
  const details = [
    ['Description:', repo.description || 'N/A'],
    ['Language:',    repo.language || 'N/A'],
    ['Stars:',       shortNum(repo.stargazers_count || 0)],
    ['Forks:',       shortNum(repo.forks_count || 0)],
    ['Open Issues:', String(appState.repoIssues.length || repo.open_issues_count || 0)],
    ['Open PRs:',    String(appState.repoPullRequests.length || 0)],
    ['Watchers:',    shortNum(repo.watchers_count || 0)],
    ['Size:',        Math.round((repo.size || 0) / 1024) + ' MB'],
    ['License:',     (repo.license && repo.license.name) || 'N/A'],
    ['Default:',     repo.default_branch || 'main'],
    ['Created:',     new Date(repo.created_at).toISOString().split('T')[0]],
    ['Updated:',     new Date(repo.updated_at).toISOString().split('T')[0]],
    ['URL:',         repo.html_url],
  ];
  const rows = Math.min(details.length, maxH - 4);
  for (let i = 0; i < rows; i++) {
    const [k, v] = details[i];
    screen.writeStr(2, y + 3 + i, k, { dim: true });
    screen.writeStr(18, y + 3 + i, truncate(String(v), leftWidth - 14));
  }

  // Right column: languages, contributors, releases.
  const rightX = leftWidth + 6;
  if (rightX + 20 < W) {
    let ry = y + 3;
    if (appState.repoLanguages && Object.keys(appState.repoLanguages).length > 0) {
      sectionHeader(screen, rightX, ry++, 'LANGUAGES');
      const total = Object.values(appState.repoLanguages).reduce((a, b) => a + b, 0);
      const sorted = Object.entries(appState.repoLanguages).sort((a, b) => b[1] - a[1]);
      const barWidth = Math.min(30, W - rightX - 18);
      for (const [lang, bytes] of sorted.slice(0, 5)) {
        if (ry >= y + maxH - 1) break;
        const pct = total ? bytes / total : 0;
        const filled = Math.max(1, Math.round(pct * barWidth));
        const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, barWidth - filled));
        screen.writeStr(rightX, ry, lang.substring(0, 12).padEnd(13));
        screen.writeStr(rightX + 13, ry, bar, { fg: 'cyan' });
        screen.writeStr(rightX + 14 + barWidth, ry, (pct * 100).toFixed(1) + '%', { dim: true });
        ry++;
      }
      ry++;
    }
    if (appState.repoContributors.length > 0 && ry < y + maxH - 2) {
      sectionHeader(screen, rightX, ry++, 'TOP CONTRIBUTORS');
      for (const c of appState.repoContributors.slice(0, 5)) {
        if (ry >= y + maxH - 1) break;
        screen.writeStr(rightX, ry, truncate('  ' + (c.login || '?'), 24));
        screen.writeStr(rightX + 26, ry, (c.contributions || 0) + ' commits', { dim: true });
        ry++;
      }
      ry++;
    }
    if (appState.repoReleases.length > 0 && ry < y + maxH - 2) {
      sectionHeader(screen, rightX, ry++, 'LATEST RELEASES');
      for (const rel of appState.repoReleases.slice(0, 3)) {
        if (ry >= y + maxH - 1) break;
        const tag = truncate(rel.tag_name || rel.name || '?', 18);
        const when = rel.published_at ? new Date(rel.published_at).toLocaleDateString() : '';
        screen.writeStr(rightX, ry, '▶ ' + tag);
        screen.writeStr(rightX + 22, ry, when, { dim: true });
        ry++;
      }
    }
  }
}

export function renderAnalyze(screen, y, h) {
  screen.writeStr(2, y, 'ANALYZE REPOSITORY', { fg: 'white', bold: true });
  screen.hline(y + 1, '─', { dim: true });
  const v = appState.analyzeView;
  if (v === 'search')   { renderSearchInput(screen, y, h); return; }
  if (v === 'results')  { renderResultsList(screen, y, h); return; }
  if (v === 'details')  { renderRepoDetails(screen, y + 2, h - 2); return; }
  if (v === 'forks')    { renderForks(screen, y + 2, h - 2); return; }
}

export function handleBack() {
  if (appState.showDetail) {
    import('./detail.mjs').then(m => m.closeDetail());
    return;
  }
  if (isFilesPane()) {
    files.backOrLeave().then((handled) => {
      if (!handled) {
        appState.detailsPane = 'overview';
        appState.detailsScroll = 0;
        render();
      }
    });
    return;
  }
  const v = appState.analyzeView;
  if (v === 'forks') {
    appState.forks = [];
    appState.selectedFork = 0;
    appState.forkScroll = 0;
    appState.analyzeView = 'details';
    render();
  } else if (v === 'details') {
    if (appState.detailsPane !== 'overview') {
      appState.detailsPane = 'overview';
      appState.detailsScroll = 0;
      render();
      return;
    }
    appState.repoDetails = null;
    appState._readmeText = null;
    appState.analyzeView = 'results';
    render();
  } else if (v === 'results') {
    appState.searchResults = [];
    appState.searchQuery = '';
    appState.analyzeView = 'search';
    render();
  }
}

export function jumpTop() {
  if (isFilesPane()) files.jumpTop();
  else if (appState.analyzeView === 'results') {
    appState.selectedRepo = 0;
    appState.searchScroll = 0;
    render();
  } else if (appState.analyzeView === 'forks') {
    appState.selectedFork = 0;
    appState.forkScroll = 0;
    render();
  } else {
    appState.detailsScroll = 0;
    render();
  }
}
export const keys = {
  'i': () => {
    if (appState.analyzeView === 'details') {
      appState.detailsPane = appState.detailsPane === 'issues' ? 'overview' : 'issues';
      appState.detailsScroll = 0;
      render();
    } else {
      startInput('Search repos: ', 'search');
    }
  },
  'P': () => {
    if (appState.analyzeView === 'details') {
      appState.detailsPane = appState.detailsPane === 'prs' ? 'overview' : 'prs';
      appState.detailsScroll = 0;
      render();
    }
  },
  'O': () => {
    if (appState.analyzeView === 'details') {
      appState.detailsPane = 'overview';
      appState.detailsScroll = 0;
      render();
    }
  },
  'R': () => { if (appState.analyzeView === 'details') viewReadme(); },
  'F': () => { if (appState.analyzeView === 'details') files.openFilesPane(); },
  'A': () => {
    if (appState.analyzeView === 'details') {
      if (appState.detailsPane === 'packages') {
        appState.detailsPane = 'overview';
      } else {
        appState.detailsPane = 'packages';
        appState.detailsScroll = 0;
        appState.selectedAsset = 0;
        loadReleaseAssets();
      }
      render();
    }
  },
  's': () => {
    if (appState.analyzeView === 'forks') toggleForkSort('stars');
    else if (isFilesPane()) files.keys.s();
    else cycleIssueStateFilter();
  },
  'S': () => {
    if (appState.analyzeView === 'details') {
      if (appState.detailsPane === 'security') {
        appState.detailsPane = 'overview';
      } else if (isFilesPane()) {
        files.keys.S();
      } else {
        appState.detailsPane = 'security';
        appState.detailsScroll = 0;
        loadSecurity();
      }
      render();
    }
  },
  'Z': () => { if (isFilesPane()) files.keys.Z(); },
  'C': () => {
    if (isFilesPane()) files.keys.C();
    else if (appState.analyzeView === 'search' || appState.analyzeView === 'results') {
      appState.searchType = 'code';
      appState.analyzeView = 'search';
      render();
      startInput('Search code: ', 'code-search');
    }
  },
  'u': () => {
    if (appState.analyzeView === 'search' || appState.analyzeView === 'results') {
      appState.searchType = 'users';
      appState.analyzeView = 'search';
      render();
      startInput('Search users: ', 'user-search');
    }
  },
  'G': () => { if (isFilesPane()) files.keys.G(); },
  'B': () => { if (isFilesPane()) files.keys.B(); },
  'Y': () => { if (isFilesPane()) files.keys.Y(); },
  'g': () => { jumpTop(); },
  'n': () => { if (appState.analyzeView === 'forks') toggleForkSort('name'); },
  'T': () => {
    if (appState.analyzeView === 'details') {
      if (appState.detailsPane === 'traffic') {
        appState.detailsPane = 'overview';
      } else {
        appState.detailsPane = 'traffic';
        appState.detailsScroll = 0;
        loadTraffic();
      }
      render();
    }
  },
  'M': () => {
    if (appState.analyzeView === 'details') {
      if (appState.detailsPane === 'milestones') {
        appState.detailsPane = 'overview';
      } else {
        appState.detailsPane = 'milestones';
        appState.detailsScroll = 0;
        loadMilestones();
      }
      render();
    }
  },
  'L': () => {
    if (appState.analyzeView === 'details') {
      if (appState.detailsPane === 'labels') {
        appState.detailsPane = 'overview';
      } else {
        appState.detailsPane = 'labels';
        appState.detailsScroll = 0;
        loadLabels();
      }
      render();
    }
  },
  'K': () => {
    if (appState.analyzeView === 'details') {
      if (appState.detailsPane === 'checks') {
        appState.detailsPane = 'overview';
      } else {
        appState.detailsPane = 'checks';
        appState.detailsScroll = 0;
        loadChecks();
      }
      render();
    }
  },

};

function isFilesPane() {
  return appState.analyzeView === 'details' && appState.detailsPane === 'files';
}

export function up(screen) {
  if (isFilesPane()) { files.up(); return; }
  if (appState.analyzeView === 'details' && appState.detailsPane !== 'overview') {
    appState.detailsScroll = Math.max(0, appState.detailsScroll - 1);
    if (appState.detailsPane === 'packages') appState.selectedAsset = appState.detailsScroll;
    render(); return;
  }
  if (appState.analyzeView === 'results') {
    const list = getResultList();
    if (list && list.length > 0) {
      if (appState.selectedRepo > appState.searchScroll) appState.selectedRepo--;
      else if (appState.searchScroll > 0) { appState.searchScroll--; appState.selectedRepo--; }
      render();
    }
    return;
  }
  if (appState.analyzeView === 'forks' && appState.forks.length > 0) {
    if (appState.selectedFork > appState.forkScroll) appState.selectedFork--;
    else if (appState.forkScroll > 0) { appState.forkScroll--; appState.selectedFork--; }
    render();
  }
}
export function down(screen) {
  if (isFilesPane()) { files.down(screen); return; }
  if (appState.analyzeView === 'details' && appState.detailsPane !== 'overview') {
    let listLen;
    if (appState.detailsPane === 'issues') listLen = appState.repoIssues.length;
    else if (appState.detailsPane === 'prs') listLen = appState.repoPullRequests.length;
    else if (appState.detailsPane === 'packages') listLen = appState.repoReleaseAssets.length;
    else if (appState.detailsPane === 'readme')
      listLen = (appState._readmeText || '').split(/\r?\n/).length;
    else listLen = 0;
    appState.detailsScroll = Math.min(Math.max(0, listLen - 1), appState.detailsScroll + 1);
    if (appState.detailsPane === 'packages') appState.selectedAsset = appState.detailsScroll;
    render(); return;
  }
  if (appState.analyzeView === 'results') {
    const list = getResultList();
    const maxVisible = Math.max(1, Math.min(8, screen.height - 16));
    if (list && list.length > 0) {
      if (appState.selectedRepo < appState.searchScroll + maxVisible - 1) {
        appState.selectedRepo = Math.min(list.length - 1, appState.selectedRepo + 1);
      } else if (appState.searchScroll + maxVisible < list.length) {
        appState.searchScroll++;
        appState.selectedRepo = Math.min(list.length - 1, appState.selectedRepo + 1);
      }
      render();
    }
  } else if (appState.analyzeView === 'forks') {
    const maxVisible = Math.max(1, Math.min(6, screen.height - 16));
    if (appState.forks.length > 0) {
      if (appState.selectedFork < appState.forkScroll + maxVisible - 1) {
        appState.selectedFork = Math.min(appState.forks.length - 1, appState.selectedFork + 1);
      } else if (appState.forkScroll + maxVisible < appState.forks.length) {
        appState.forkScroll++;
        appState.selectedFork = Math.min(appState.forks.length - 1, appState.selectedFork + 1);
      }
      render();
    }
  }
}
export function enter() {
  if (isFilesPane()) { files.enter(); return; }
  const v = appState.analyzeView;
  const type = appState.searchType || 'repos';
  if (v === 'results') {
    if (type === 'users') {
      const user = appState.userSearchResults[appState.selectedRepo];
      if (user && user.login) {
        openUserProfile(user.login);
      }
    } else if (type === 'code') {
      const item = appState.codeSearchResults[appState.selectedRepo];
      if (item && item.html_url) {
        openUrl(item.html_url).then(res => {
          if (res.ok) showMessage('Opened in browser', 'success');
          else showMessage(res.error || 'Open failed', 'error');
        });
      }
    } else if (appState.searchResults.length > 0) {
      const repo = appState.searchResults[appState.selectedRepo];
      if (repo) {
        const [owner, name] = repo.full_name.split('/');
        loadRepoDetails(owner, name);
      }
    }
  } else if (v === 'details' && appState.repoDetails) {
    if (appState.detailsPane === 'issues') {
      const issue = appState.repoIssues[appState.detailsScroll];
      if (issue) {
        const [owner, name] = appState.repoDetails.full_name.split('/');
        openDetail('issue', owner, name, issue.number);
      }
    } else if (appState.detailsPane === 'prs') {
      const pr = appState.repoPullRequests[appState.detailsScroll];
      if (pr) {
        const [owner, name] = appState.repoDetails.full_name.split('/');
        openDetail('pull_request', owner, name, pr.number);
      }
    } else if (appState.detailsPane === 'packages') {
      const asset = appState.repoReleaseAssets[appState.selectedAsset];
      if (asset) downloadAsset(asset);
    } else {
      loadForks();
    }
  } else if (v === 'search') {
    startInput('Search repos: ', 'search');
  }
}
function getResultList() {
  const type = appState.searchType || 'repos';
  if (type === 'users') return appState.userSearchResults;
  if (type === 'code') return appState.codeSearchResults;
  return appState.searchResults;
}

export function space() {
  if (appState.analyzeView === 'results') loadMoreSearchResults();
  else if (appState.analyzeView === 'forks') loadMoreForks();
}

// ── Collapsible sections ──
const ANALYZE_SECTIONS = ['overview', 'issues', 'prs', 'readme', 'files', 'packages', 'traffic', 'milestones', 'labels', 'checks', 'security'];

export function getSections() {
  return ANALYZE_SECTIONS.map(s => 'analyze:' + s);
}

export function getCurrentSection() {
  return 'analyze:' + (appState.detailsPane || 'overview');
}
