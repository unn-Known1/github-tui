// Explore tab — search any public repo, drill into rich details,
// toggle Issues/PRs sub-panes, view README, hop to Forks sub-view.
// v0.5+ polish: pushes to recent-repos list, cleaner section headings.

import { appState, render, startAsync, isStale, showMessage, pushRecentRepo } from '../state.mjs';
import {
  getRepositoryDetails,
  getRepositoryLanguages, getRepositoryContributors,
  getRepositoryReleases, getRepositoryIssues, getRepositoryPullRequests,
} from '../github.mjs';
import { startInput } from '../input.mjs';
import { shortNum, truncate, openUrl, sectionHeader, formatBytes } from '../utils.mjs';
import { color } from '../theme.mjs';
import { scrollIndicators } from '../render.mjs';
import { loadForks, loadMoreForks, renderForks, toggleForkSort } from './forks.mjs';
import * as files from './files.mjs';
import { loadLabels, renderLabelsPane } from './analyze-labels.mjs';
import { loadMilestones, renderMilestonesPane } from './analyze-milestones.mjs';
import { loadChecks, renderChecksPane } from './analyze-checks.mjs';
import { loadTraffic, renderTrafficPane } from './analyze-traffic.mjs';
import { loadReleaseAssets, downloadAsset, renderPackagesPane } from './analyze-packages.mjs';
import { renderIssuesPane, renderPRsPane, cycleIssueStateFilter } from './analyze-issues.mjs';
import { viewReadme, renderReadmePane } from './analyze-readme.mjs';
import {
  loadSecurity, renderSecurityPane,
  cycleSecurityFilter, cycleSecurityStateFilter,
  securityUp, securityDown, securityEnter, securityDismiss,
} from './analyze-security.mjs';
import {
  submitSearch, submitUserSearch, submitCodeSearch,
  loadMoreSearchResults, openUserProfile,
  renderSearchInput, renderResultsList,
  pageUp, pageDown,
} from './analyze-search.mjs';
import { openDetail as _openDetail } from './detail.mjs';
export { _openDetail as openDetail, submitSearch, submitUserSearch, submitCodeSearch };
export { loadSecurity, cycleSecurityFilter, cycleSecurityStateFilter, securityUp, securityDown, securityEnter, securityDismiss } from './analyze-security.mjs';
export { loadTraffic } from './analyze-traffic.mjs';
export { loadMilestones } from './analyze-milestones.mjs';
export { loadLabels } from './analyze-labels.mjs';
export { loadChecks } from './analyze-checks.mjs';
export { loadReleaseAssets, downloadAsset } from './analyze-packages.mjs';
export { viewReadme } from './analyze-readme.mjs';
export { cycleIssueStateFilter } from './analyze-issues.mjs';
export { pageUp, pageDown } from './analyze-search.mjs';

export async function loadRepoDetails(owner, name) {
  const gen = startAsync('analyze-details');
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
  appState.securitySubPane = 'dependabot';
  appState.securityFilter = 'all';
  appState.securityStateFilter = 'open';
  appState.securityAlertCursor = 0;
  appState.securityAlertScroll = 0;
  appState.secretScanningAlerts = [];
  appState.codeScanningAlerts = [];
  appState.securityAdvisories = [];
  appState.branchProtection = null;
  appState.dependencyManifests = [];
  render();
  try {
    const details = await getRepositoryDetails(appState.token, owner, name, gen.signal);
    if (isStale(gen, 'analyze-details')) { appState.loading = false; return; }
    appState.repoDetails = details;
    appState.analyzeView = 'details';
    // Track in recent repos.
    pushRecentRepo(details);
    render();

    const safe = (p) => p.catch(() => null);
    const issueState = appState.issueStateFilter;
    const [langs, contribs, releases, issues, prs] = await Promise.all([
      safe(getRepositoryLanguages(appState.token, owner, name, gen.signal)),
      safe(getRepositoryContributors(appState.token, owner, name, 1, 10, gen.signal)),
      safe(getRepositoryReleases(appState.token, owner, name, 1, 5, gen.signal)),
      safe(getRepositoryIssues(appState.token, owner, name, 1, 100, issueState, gen.signal)),
      safe(getRepositoryPullRequests(appState.token, owner, name, 1, 100, issueState, gen.signal)),
    ]);
    if (isStale(gen, 'analyze-details')) { appState.loading = false; return; }
    appState.repoLanguages = langs || null;
    appState.repoContributors = Array.isArray(contribs) ? contribs : [];
    appState.repoReleases = Array.isArray(releases) ? releases : [];
    appState.repoIssues = Array.isArray(issues) ? issues.filter(i => !i.pull_request) : [];
    appState.repoPullRequests = Array.isArray(prs) ? prs : [];
    showMessage('Loaded ' + owner + '/' + name, 'success');
  } catch (e) {
    if (!isStale(gen, 'analyze-details')) showMessage(e.message || 'Failed to load repository', 'error');
  }
  appState.loading = false;
  if (!isStale(gen, 'analyze-details')) render();
  // Silently pre-load release assets for overview + packages pane
  if (appState.repoReleaseAssets.length === 0 && appState.repoReleases.length > 0) {
    loadReleaseAssets(true);
  }
}


function renderRepoDetails(screen, y, maxH) {
  const W = screen.width;
  const repo = appState.repoDetails;
  if (!repo) return;
  appState._overviewAssetBounds = null;

  // Repo name.
  screen.writeStr(2, y, repo.full_name, color('title') || { fg: 'white', bold: true });

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
    const maxW = (k === 'URL:') ? W - 4 : leftWidth - 14;
    screen.writeStr(18, y + 3 + i, truncate(String(v), maxW));
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
    if (appState.repoReleaseAssets.length > 0 && ry < y + maxH - 2) {
      sectionHeader(screen, rightX, ry++, 'RELEASE PACKAGES');
      const maxRows = Math.min(5, maxH - (ry - y) - 1);
      const bounds = [];
      for (let i = 0; i < maxRows && i < appState.repoReleaseAssets.length; i++) {
        if (ry >= y + maxH - 1) break;
        const a = appState.repoReleaseAssets[i];
        const sel = appState.selectedAsset === i;
        screen.writeStr(rightX, ry, sel ? '▶' : ' ', sel ? { fg: 'cyan' } : undefined);
        const name = truncate(a.name || '?', 20);
        screen.writeStr(rightX + 2, ry, name);
        const size = a.size ? formatBytes(a.size) : '';
        if (size) screen.writeStr(rightX + 24, ry, size, { dim: true });
        const tag = truncate(a.releaseTag || '', 8);
        if (tag) screen.writeStr(rightX + 33, ry, tag, { dim: true });
        bounds.push({ y: ry, x: rightX, idx: i });
        ry++;
      }
      appState._overviewAssetBounds = bounds;
    } else if (appState.repoReleases.length > 0 && ry < y + maxH - 2) {
      sectionHeader(screen, rightX, ry++, 'RELEASES');
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
  screen.writeStr(2, y, 'EXPLORE REPOSITORY', color('title') || { fg: 'white', bold: true });
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
    // Reset all detail-related state to avoid stale data flash
    appState.repoDetails = null;
    appState._readmeText = null;
    appState.repoLanguages = null;
    appState.repoContributors = [];
    appState.repoReleases = [];
    appState.repoReleaseAssets = [];
    appState.repoIssues = [];
    appState.repoPullRequests = [];
    appState.repoTraffic = null;
    appState.repoTrafficClones = null;
    appState.repoTrafficPopularPaths = [];
    appState.repoTrafficPopularReferrers = [];
    appState.repoMilestones = [];
    appState.repoLabels = [];
    appState.repoCheckRuns = [];
    appState.repoCheckSuites = [];
    appState.repoDependabotAlerts = [];
    appState.secretScanningAlerts = [];
    appState.codeScanningAlerts = [];
    appState.securityAdvisories = [];
    appState.branchProtection = null;
    appState.dependencyManifests = [];
    appState.analyzeView = 'results';
    render();
  } else if (v === 'results') {
    appState.searchResults = [];
    appState.userSearchResults = [];
    appState.codeSearchResults = [];
    appState.searchQuery = '';
    appState.analyzeView = 'search';
    render();
  }
}

export function jumpTop() {
  if (isFilesPane()) files.jumpTop();
  else if (isSecurityPane()) { appState.securityAlertCursor = 0; appState.securityAlertScroll = 0; render(); }
  else if (appState.analyzeView === 'results') {
    const type = appState.searchType || 'repos';
    if (type === 'users') {
      appState.userSelectedRepo = 0;
      appState.userSearchScroll = 0;
    } else if (type === 'code') {
      appState.codeSelectedRepo = 0;
      appState.codeSearchScroll = 0;
    } else {
      appState.selectedRepo = 0;
      appState.searchScroll = 0;
    }
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
    else if (isSecurityPane()) cycleSecurityFilter();
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
      appState.codeSelectedRepo = 0;
      appState.codeSearchScroll = 0;
      render();
      startInput('Search code: ', 'code-search');
    }
  },
  'u': () => {
    if (appState.analyzeView === 'search' || appState.analyzeView === 'results') {
      appState.searchType = 'users';
      appState.analyzeView = 'search';
      appState.userSelectedRepo = 0;
      appState.userSearchScroll = 0;
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

  // Security sub-pane keys
  '1': () => { if (isSecurityPane()) { appState.securitySubPane = 'dependabot'; appState.securityAlertCursor = 0; appState.securityAlertScroll = 0; loadSecurity(); render(); } },
  '2': () => { if (isSecurityPane()) { appState.securitySubPane = 'secret'; appState.securityAlertCursor = 0; appState.securityAlertScroll = 0; loadSecurity(); render(); } },
  '3': () => { if (isSecurityPane()) { appState.securitySubPane = 'codescan'; appState.securityAlertCursor = 0; appState.securityAlertScroll = 0; loadSecurity(); render(); } },
  '4': () => { if (isSecurityPane()) { appState.securitySubPane = 'advisories'; appState.securityAlertCursor = 0; appState.securityAlertScroll = 0; loadSecurity(); render(); } },
  '5': () => { if (isSecurityPane()) { appState.securitySubPane = 'branch'; appState.securityAlertCursor = 0; appState.securityAlertScroll = 0; loadSecurity(); render(); } },
  '6': () => { if (isSecurityPane()) { appState.securitySubPane = 'deps'; appState.securityAlertCursor = 0; appState.securityAlertScroll = 0; loadSecurity(); render(); } },
  'f': () => { if (isSecurityPane()) cycleSecurityStateFilter(); },

};

function isFilesPane() {
  return appState.analyzeView === 'details' && appState.detailsPane === 'files';
}

function isSecurityPane() {
  return appState.analyzeView === 'details' && appState.detailsPane === 'security';
}

export function up(screen) {
  if (isFilesPane()) { files.up(); return; }
  if (isSecurityPane()) { securityUp(); return; }
  if (appState.analyzeView === 'details' && appState.detailsPane !== 'overview') {
    appState.detailsScroll = Math.max(0, appState.detailsScroll - 1);
    if (appState.detailsPane === 'packages') appState.selectedAsset = appState.detailsScroll;
    render(); return;
  }
  if (appState.analyzeView === 'results') {
    const type = appState.searchType || 'repos';
    if (type === 'users') {
      const list = appState.userSearchResults;
      if (list.length > 0) {
        if (appState.userSelectedRepo > appState.userSearchScroll) appState.userSelectedRepo--;
        else if (appState.userSearchScroll > 0) { appState.userSearchScroll--; appState.userSelectedRepo--; }
      }
    } else if (type === 'code') {
      const list = appState.codeSearchResults;
      if (list.length > 0) {
        if (appState.codeSelectedRepo > appState.codeSearchScroll) appState.codeSelectedRepo--;
        else if (appState.codeSearchScroll > 0) { appState.codeSearchScroll--; appState.codeSelectedRepo--; }
      }
    } else {
      const list = appState.searchResults;
      if (list.length > 0) {
        if (appState.selectedRepo > appState.searchScroll) appState.selectedRepo--;
        else if (appState.searchScroll > 0) { appState.searchScroll--; appState.selectedRepo--; }
      }
    }
    render();
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
  if (isSecurityPane()) { securityDown(screen); return; }
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
    const type = appState.searchType || 'repos';
    const maxVisible = Math.max(1, Math.min(8, screen.height - 16));
    if (type === 'users') {
      const list = appState.userSearchResults;
      if (list.length > 0) {
        if (appState.userSelectedRepo < appState.userSearchScroll + maxVisible - 1) {
          appState.userSelectedRepo = Math.min(list.length - 1, appState.userSelectedRepo + 1);
        } else if (appState.userSearchScroll + maxVisible < list.length) {
          appState.userSearchScroll++;
          appState.userSelectedRepo = Math.min(list.length - 1, appState.userSelectedRepo + 1);
        }
      }
    } else if (type === 'code') {
      const list = appState.codeSearchResults;
      if (list.length > 0) {
        if (appState.codeSelectedRepo < appState.codeSearchScroll + maxVisible - 1) {
          appState.codeSelectedRepo = Math.min(list.length - 1, appState.codeSelectedRepo + 1);
        } else if (appState.codeSearchScroll + maxVisible < list.length) {
          appState.codeSearchScroll++;
          appState.codeSelectedRepo = Math.min(list.length - 1, appState.codeSelectedRepo + 1);
        }
      }
    } else {
      const list = appState.searchResults;
      if (list.length > 0) {
        if (appState.selectedRepo < appState.searchScroll + maxVisible - 1) {
          appState.selectedRepo = Math.min(list.length - 1, appState.selectedRepo + 1);
        } else if (appState.searchScroll + maxVisible < list.length) {
          appState.searchScroll++;
          appState.selectedRepo = Math.min(list.length - 1, appState.selectedRepo + 1);
        }
      }
    }
    render();
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
  if (isSecurityPane()) { securityEnter(); return; }
  const v = appState.analyzeView;
  const type = appState.searchType || 'repos';
  if (v === 'results') {
    if (type === 'users') {
      const user = appState.userSearchResults[appState.userSelectedRepo];
      if (user && user.login) {
        openUserProfile(user.login);
      }
    } else if (type === 'code') {
      const item = appState.codeSearchResults[appState.codeSelectedRepo];
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
