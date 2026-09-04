// Explore tab — search any public repo, drill into rich details,
// toggle Issues/PRs sub-panes, view README, hop to Forks sub-view.
// v0.5+ polish: pushes to recent-repos list, cleaner section headings.

import { appState, render, startAsync, isStale, showMessage, pushRecentRepo, beginLoading, finishLoading } from '../state.mjs';
import {
  getRepositoryDetails,
  getRepositoryLanguages, getRepositoryContributors,
  getRepositoryReleases, getRepositoryIssues, getRepositoryPullRequests,
  getRepoCheckRuns, getRepoDependabotAlerts, getBranchProtection,
} from '../github.mjs';
import { startInput } from '../input.mjs';
import { shortNum, truncate, truncateToWidth, displayWidth, padRight, openUrl, sectionHeader, formatBytes, relTime, wrapText } from '../utils.mjs';
import { color } from '../theme.mjs';
import { loadForks, loadMoreForks, renderForks, toggleForkSort } from './forks.mjs';
import * as files from './files.mjs';
import { loadChecks, renderChecksPane } from './analyze-checks.mjs';
import { loadTraffic, renderTrafficPane } from './analyze-traffic.mjs';
import { loadReleaseAssets, downloadAsset, renderPackagesPane } from './analyze-packages.mjs';
import { renderIssuesPane, renderPRsPane, cycleIssueStateFilter, loadMoreIssues } from './analyze-issues.mjs';
import { viewReadme, renderReadmePane } from './analyze-readme.mjs';
import {
  loadSecurity, renderSecurityPane,
  cycleSecurityFilter, cycleSecurityStateFilter,
  securityUp, securityDown, securityEnter, securityDismiss,
} from './analyze-security.mjs';
import {
  submitSearch, submitUserSearch, submitCodeSearch,
  loadMoreSearchResults, openUserRepos,
  renderSearchInput, renderResultsList,
  pageUp, pageDown, maxVisibleResults,
  toggleUserReposSort,
  loadExploreTrending, getExploreLanding,
  exploreUp, exploreDown,
} from './analyze-search.mjs';
import { openDetail as _openDetail } from './detail.mjs';
import { startCompare, renderComparePane } from './analyze-compare.mjs';
import { calculateRepoHealth } from '../recommended-features.mjs';
import { isStarredLocal, toggleStarRepo, trueIssueCount } from './repos.mjs';
import { renderSecurityAggregate, securityAggregateUp, securityAggregateDown, securityAggregateEnter } from '../security-aggregate.mjs';
import { renderOrganizations, organizationUp, organizationDown, organizationEnter } from '../organizations.mjs';
export { _openDetail as openDetail, submitSearch, submitUserSearch, submitCodeSearch, openUserRepos };
export { loadSecurity, cycleSecurityFilter, cycleSecurityStateFilter, securityUp, securityDown, securityEnter, securityDismiss } from './analyze-security.mjs';
export { loadTraffic } from './analyze-traffic.mjs';
export { loadChecks } from './analyze-checks.mjs';
export { loadReleaseAssets, downloadAsset } from './analyze-packages.mjs';
export { viewReadme } from './analyze-readme.mjs';
export { cycleIssueStateFilter } from './analyze-issues.mjs';
export { pageUp, pageDown } from './analyze-search.mjs';
export { getResultList, maxVisibleResults } from './analyze-search.mjs';
export { loadExploreTrending, getExploreLanding, exploreUp, exploreDown } from './analyze-search.mjs';

// Clear text-selection state whenever the user leaves a text-viewing pane
// (README / file viewer) so stale selection coordinates don't bleed into
// the next view.
function clearTextSelection() {
  appState.textSelectionMode = 'none';
  appState.textSelectStart = null;
  appState.textSelectEnd = null;
}

// ─── Overview pure helpers (exported for tests) ─────────────────────

// Status badges for the Overview title row. Each badge is { label, role }
// where role is a theme color role understood by color(). Order is stable:
// visibility first, then lifecycle flags.
export function repoStatusBadges(repo) {
  if (!repo) return [];
  const badges = [];
  if (repo.private) badges.push({ label: 'Private', role: 'warning' });
  else badges.push({ label: String(repo.visibility || 'Public'), role: 'success' });
  if (repo.fork) badges.push({ label: 'Fork', role: 'fork' });
  if (repo.archived) badges.push({ label: 'Archived', role: 'dim' });
  if (repo.is_template) badges.push({ label: 'Template', role: 'accent' });
  if (repo.disabled) badges.push({ label: 'Disabled', role: 'error' });
  return badges;
}

// Short human age of the repo: '3y', '5mo', '12d', '4h', or 'N/A' when the
// timestamp is missing / unparseable. `nowMs` is injectable for tests.
export function repoAge(createdAt, nowMs) {
  if (!createdAt) return 'N/A';
  const ms = Date.parse(createdAt);
  if (Number.isNaN(ms)) return 'N/A';
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const days = Math.max(0, Math.floor((now - ms) / 86400000));
  if (days >= 730) return Math.floor(days / 365) + 'y';
  if (days >= 60) return Math.floor(days / 30) + 'mo';
  if (days >= 2) return days + 'd';
  const hours = Math.floor(Math.max(0, now - ms) / 3600000);
  if (hours >= 2) return hours + 'h';
  return 'today';
}

// GitHub reports repo.size in KiB — render via formatBytes for consistency
// with the Files pane. Guards null / NaN.
export function formatRepoSize(sizeKb) {
  if (sizeKb == null || Number.isNaN(Number(sizeKb))) return 'N/A';
  return formatBytes(Math.max(0, Number(sizeKb)) * 1024);
}

// '2024-01-01 (3d ago)' compound stamp; falls back to the raw value when
// the date is missing or unparseable.
export function dateWithRel(iso) {
  if (!iso) return 'N/A';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return String(iso);
  const rel = relTime(iso);
  const day = new Date(ms).toISOString().split('T')[0];
  return rel ? day + ' (' + rel + ' ago)' : day;
}

// Health components in stable display order with short labels for the
// Overview HEALTH section. Nulls (no permission / not loaded) are kept so
// the renderer can show '—' instead of pretending the signal is healthy.
export const HEALTH_COMPONENTS = [
  ['ci', 'CI'],
  ['freshness', 'Fresh'],
  ['issues', 'Issues'],
  ['security', 'Sec'],
  ['protection', 'Protect'],
];

export function healthComponents(health) {
  const comps = (health && health.components) || {};
  return HEALTH_COMPONENTS.map(([key, label]) => ({ key, label, value: comps[key] ?? null }));
}

// E13: single reset for ALL explore-detail fields. Used by both
// loadRepoDetails (fresh load) and handleBack (details→results) so the two
// call sites can't drift again. Keeps issueStateFilter persistent by design
// (global filter outlives any one repo); per-pane repoIssuesFilter /
// repoPRsFilter are synced to the global value here and refreshed to the
// load-time value in loadRepoDetails (E4). Keeps repoMilestones/Labels
// resets (harmless; panes removed in v0.7.1). Exported for tests.
export function resetDetailState() {
  appState.detailsPane = 'overview';
  appState.detailsScroll = 0;
  clearTextSelection();
  appState.repoDetails = null;
  appState.repoLanguages = null;
  appState.repoContributors = [];
  appState.repoReleases = [];
  appState.repoReleaseAssets = [];
  appState.selectedAsset = 0;
  appState.repoIssues = [];
  appState.repoIssuesPage = 1;
  appState.repoIssuesHasMore = false;
  appState.repoPullRequests = [];
  appState.repoPullRequestsPage = 1;
  appState.repoPullRequestsHasMore = false;
  appState._readmeText = null;
  appState.repoTraffic = null;
  appState.repoTrafficClones = null;
  appState.repoTrafficPopularPaths = [];
  appState.repoTrafficPopularReferrers = [];
  appState.repoMilestones = [];
  appState.repoMilestonesPage = 1;
  appState.repoMilestonesHasMore = false;
  appState.repoLabels = [];
  appState.repoLabelsPage = 1;
  appState.repoLabelsHasMore = false;
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
  appState.dependencyPackages = [];
  appState.compareData = null;
  appState.compareBase = '';
  appState.compareHead = '';
  appState.repoHealth = null;
  appState.filesEntries = [];
  appState.filesBranches = [];
  appState.filesPath = '';
  appState.filesSelected = 0;
  appState.filesScroll = 0;
  appState.filesFilter = '';
  appState.filesSort = 'name';
  appState.filesLastMod = {};
  appState.fileViewing = null;
  appState.fileText = '';
  appState.fileScroll = 0;
  appState.fileBinary = false;
  appState.fileHistory = [];
  appState.fileHistoryPath = '';
  appState.fileHistorySelected = 0;
  appState.fileHistoryMode = false;
  appState.fileBlame = [];
  appState.fileBlameMode = false;
  appState.filesBranchPicker = false;
  appState.filesBranchCursor = 0;
  // Per-pane filter stamps (E4): kept in sync with the global filter when no
  // data is loaded; defaults live in state.mjs.
  appState.repoIssuesFilter = appState.issueStateFilter;
  appState.repoPRsFilter = appState.issueStateFilter;
}

// E4: self-contained per-pane refetch for stale-filter pane switches. When
// the user switches to a pane whose stored filter predates the global
// issueStateFilter we refetch page 1 of that pane here. Stale-guarded,
// updates the stored filter stamp, resets scroll, toasts on error.
async function refetchPane(pane) {
  const repo = appState.repoDetails;
  if (!repo || !repo.full_name) return;
  const parts = repo.full_name.split('/');
  const owner = parts[0];
  const name = parts[1];
  if (!owner || !name) return;
  const gen = startAsync('analyze-issues');
  beginLoading(gen);
  render();
  try {
    if (pane === 'issues') {
      const issues = await getRepositoryIssues(appState.token, owner, name, 1, 100, appState.issueStateFilter, gen.signal);
      if (isStale(gen, 'analyze-issues')) { finishLoading(gen); return; }
      appState.repoIssues = Array.isArray(issues) ? issues.filter(i => !i.pull_request) : [];
      appState.repoIssuesPage = 1;
      appState.repoIssuesHasMore = Array.isArray(issues) && issues.length >= 100;
      appState.repoIssuesFilter = appState.issueStateFilter;
      appState.detailsScroll = 0;
    } else {
      const prs = await getRepositoryPullRequests(appState.token, owner, name, 1, 100, appState.issueStateFilter, gen.signal);
      if (isStale(gen, 'analyze-issues')) { finishLoading(gen); return; }
      appState.repoPullRequests = Array.isArray(prs) ? prs : [];
      appState.repoPullRequestsPage = 1;
      appState.repoPullRequestsHasMore = Array.isArray(prs) && prs.length >= 100;
      appState.repoPRsFilter = appState.issueStateFilter;
      appState.detailsScroll = 0;
    }
  } catch (e) {
    if (!isStale(gen, 'analyze-issues')) showMessage(e.message || ('Failed to reload ' + pane), 'error');
  } finally {
    finishLoading(gen);
    if (!isStale(gen, 'analyze-issues')) render();
  }
}

export async function loadRepoDetails(owner, name) {
  const gen = startAsync('analyze-details');
  beginLoading(gen);
  resetDetailState();
  appState.detailsPane = 'overview';
  appState.detailsScroll = 0;
  clearTextSelection();
  render();
  try {
    const details = await getRepositoryDetails(appState.token, owner, name, gen.signal);
    if (isStale(gen, 'analyze-details')) { finishLoading(gen); return; }
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
    if (isStale(gen, 'analyze-details')) { finishLoading(gen); return; }
    appState.repoLanguages = langs || null;
    appState.repoContributors = Array.isArray(contribs) ? contribs : [];
    appState.repoReleases = Array.isArray(releases) ? releases : [];
    appState.repoIssues = Array.isArray(issues) ? issues.filter(i => !i.pull_request) : [];
    appState.repoIssuesPage = 1;
    appState.repoIssuesHasMore = Array.isArray(issues) && issues.length >= 100;
    appState.repoPullRequests = Array.isArray(prs) ? prs : [];
    appState.repoPullRequestsPage = 1;
    appState.repoPullRequestsHasMore = Array.isArray(prs) && prs.length >= 100;
    // E4: stamp which filter value each pane was loaded under so pane
    // switches can detect a stale inactive pane.
    appState.repoIssuesFilter = issueState;
    appState.repoPRsFilter = issueState;
    const ageDays = details.updated_at ? Math.max(0, Math.floor((Date.now() - Date.parse(details.updated_at)) / 86400000)) : null;
    appState.repoHealth = calculateRepoHealth({
      ciSuccessRate: null,
      lastPushDays: ageDays,
      openIssues: appState.repoIssues.length,
      openSecurityAlerts: null,
      branchProtection: null,
    });
    showMessage('Loaded ' + owner + '/' + name, 'success');
    // Complete the advisory health score with independent, permission-aware
    // signals. A denied endpoint remains null instead of being reported as
    // healthy, and the overview is refreshed when the optional metrics arrive.
    Promise.allSettled([
      getRepoCheckRuns(appState.token, owner, name, details.default_branch || 'HEAD', gen.signal),
      getRepoDependabotAlerts(appState.token, owner, name, 'open', gen.signal),
      getBranchProtection(appState.token, owner, name, details.default_branch || 'main', gen.signal),
    ]).then(results => {
      if (isStale(gen, 'analyze-details')) return;
      const checks = results[0].status === 'fulfilled' ? (results[0].value?.check_runs || []) : null;
      const security = results[1].status === 'fulfilled' ? (Array.isArray(results[1].value) ? results[1].value : results[1].value?.alerts || []) : null;
      const protection = results[2].status === 'fulfilled' ? true : null;
      const completed = checks ? checks.filter(c => c.conclusion).length : 0;
      const success = checks ? checks.filter(c => c.conclusion === 'success').length : 0;
      appState.repoHealth = calculateRepoHealth({
        ciSuccessRate: checks && completed ? success / completed : null,
        lastPushDays: ageDays,
        openIssues: appState.repoIssues.length,
        openSecurityAlerts: security ? security.length : null,
        branchProtection: protection,
      });
      render();
    }).catch(() => {});
  } catch (e) {
    if (!isStale(gen, 'analyze-details')) showMessage(e.message || 'Failed to load repository', 'error');
  }
  finishLoading(gen);
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
  appState._exploreStarBounds = null;

  // Repo name + status badges (visibility / fork / archived / template).
  // Badges stop before the right-aligned health + star button.
  const rightReserve = (appState.detailsPane === 'overview' && appState.token) ? 32 : 18;
  let nameX = 2;
  const nameMax = Math.max(8, W - rightReserve - 2);
  const shownName = truncateToWidth(repo.full_name, nameMax, '');
  screen.writeStr(nameX, y, shownName, color('title') || { fg: 'white', bold: true });
  // Advance by CELLS, not UTF-16 units — CJK/emoji names are wider than
  // .length reports, and badges would otherwise print over the name's tail.
  nameX += displayWidth(shownName);
  for (const badge of repoStatusBadges(repo)) {
    const text = ' [' + badge.label + ']';
    if (nameX + displayWidth(text) > W - rightReserve) break;
    screen.writeStr(nameX, y, text, color(badge.role));
    nameX += displayWidth(text);
  }
  const healthText = appState.repoHealth?.score != null
    ? 'Health ' + appState.repoHealth.score + (appState.repoHealth.complete ? '/100' : '/100*')
    : null;
  const healthStyle = appState.repoHealth?.score >= 70 ? { fg: 'green' }
    : appState.repoHealth?.score >= 40 ? { fg: 'yellow' } : { fg: 'red' };
  // Star / unstar button on the Overview pane title row — mirrors the [s]
  // key and matches the Repos-tab button. Click bounds stored for mouse.mjs.
  if (appState.detailsPane === 'overview' && appState.token) {
    const starred = isStarredLocal(repo.full_name);
    const starLabel = starred ? '[s] ★ Unstar' : '[s] ★ Star';
    const starX = W - starLabel.length - 2;
    screen.writeStr(starX, y, starLabel, { fg: 'yellow', bold: true });
    appState._exploreStarBounds = { y, x1: starX, x2: starX + starLabel.length };
    // Health score stays right-aligned, just left of the button.
    if (healthText) {
      const hx = Math.max(2, starX - healthText.length - 3);
      screen.writeStr(hx, y, healthText, healthStyle);
    }
  } else if (healthText) {
    screen.writeStr(Math.max(2, W - healthText.length - 2), y, healthText, healthStyle);
  }

  // Pane tabs as chips.
  const panes = [
    ['overview', 'Overview',                                    'O'],
    ['issues',   'Issues (' + appState.repoIssues.length + ')',         'i'],
    ['prs',      'PRs (' + appState.repoPullRequests.length + ')',      'P'],
    ['readme',   'README',                                      'R'],
    ['files',    'Files',                                       'F'],
    ['packages', 'Packages',                                    'A'],
    ['traffic',  'Traffic',                                     'T'],
    ['checks',   'Checks',                                      'K'],  ['security',  'Security',                                    'S'],
    ['compare',   'Compare',                                     'D'],
  ];
  let px = 2;
  // E3: compact pane tabs on narrow terminals — 10 full chips need ~130 cols
  // and clip Compare/Security on 80-col screens. Below 100 cols render
  // single-letter chips without counts (keys still match); wide keeps
  // full `[k] label` chips. Selection style, spacing, and hline unchanged.
  const narrowPanes = W < 100;
  for (const [id, label, k] of panes) {
    const sel = appState.detailsPane === id;
    const text = narrowPanes ? '[' + k + ']' : '[' + k + '] ' + label;
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
  if (appState.detailsPane === 'checks') { renderChecksPane(screen, y + 3, maxH - 3); return; }
  if (appState.detailsPane === 'security') { renderSecurityPane(screen, y + 3, maxH - 3); return; }
  if (appState.detailsPane === 'compare') { renderComparePane(screen, y + 3, maxH - 3); return; }

  // Overview pane: stat strip + 2-column layout.
  const leftWidth = Math.min(52, Math.floor(W / 2));
  // E14: honest overview counts. Issues/PRs load with per_page=100, so
  // list lengths cap at 100 — prefer the PR-excluded enrichment count
  // (trueIssueCount) over the capped length, and append '+' when the
  // hasMore flag shows the list was truncated at the 100-cap.
  // open_issues_count includes open PRs — prefer the enrichment pass.
  const trueCount = trueIssueCount(repo);
  const issuesDisplay = String(trueCount ?? appState.repoIssues.length ?? 0) + (appState.repoIssuesHasMore ? '+' : '');
  const prsDisplay = String(appState.repoPullRequests.length || 0) + (appState.repoPullRequestsHasMore ? '+' : '');

  // Stat strip: one glanceable line of headline counts + push recency.
  const stripParts = [
    { text: '★ ' + shortNum(repo.stargazers_count || 0), style: color('star') },
    { text: 'Y ' + shortNum(repo.forks_count || 0), style: color('fork') },
    { text: '◉ ' + issuesDisplay + ' issues', style: color('issue') },
    { text: '⇄ ' + prsDisplay + ' PRs', style: color('pr') },
    { text: 'pushed ' + (relTime(repo.pushed_at) ? relTime(repo.pushed_at) + ' ago' : '—'), style: color('dim') },
  ];
  let stripX = 2;
  const stripY = y + 3;
  for (let si = 0; si < stripParts.length; si++) {
    const part = stripParts[si];
    if (stripX >= W - 2) break;
    screen.writeStr(stripX, stripY, truncateToWidth(part.text, Math.max(4, W - 2 - stripX), ''), part.style);
    stripX += displayWidth(part.text);
    if (si < stripParts.length - 1 && stripX + 3 < W) {
      screen.writeStr(stripX, stripY, ' │ ', color('dim'));
      stripX += 3;
    }
  }
  screen.writeStr(2, y + 4, '─'.repeat(Math.max(0, Math.min(leftWidth, W) - 2)), { dim: true });

  // Left column: ABOUT (description, topics, homepage) + DETAILS rows.
  let ly = y + 5;
  const leftEnd = y + maxH - 2; // reserve the last line for footer hints
  const valX = 18;
  const valW = Math.max(8, leftWidth - (valX - 2) - 2);
  const writeDetailRow = (label, value, style) => {
    if (ly >= leftEnd) return;
    screen.writeStr(2, ly, label, { dim: true });
    screen.writeStr(valX, ly, truncate(String(value ?? 'N/A'), valW), style || null);
    ly++;
  };

  if (ly < leftEnd) { sectionHeader(screen, 2, ly++, 'ABOUT'); }
  const descLines = wrapText(repo.description || 'No description', Math.max(10, leftWidth - 2)).slice(0, 2);
  for (const dl of descLines) {
    if (ly >= leftEnd) break;
    screen.writeStr(2, ly++, dl || '');
  }
  // Topics as chips (accent on subtle bg), clipped to one row.
  const topics = Array.isArray(repo.topics) ? repo.topics.filter(Boolean) : [];
  if (topics.length > 0 && ly < leftEnd) {
    let tx = 2;
    const chipStyle = color('chipDismissible');
    for (const topic of topics) {
      const chip = '#' + topic + ' ';
      // Cell-based fit/advance so CJK/emoji topics can't run under the next chip.
      if (tx + displayWidth(chip) > leftWidth) break;
      screen.writeStr(tx, ly, chip, chipStyle);
      tx += displayWidth(chip);
    }
    ly++;
  }
  if (repo.homepage) {
    if (ly < leftEnd) {
      screen.writeStr(2, ly, 'Homepage:', { dim: true });
      screen.writeStr(valX, ly, truncate(String(repo.homepage), valW), color('accent'));
      ly++;
    }
  }
  if (ly < leftEnd) { sectionHeader(screen, 2, ly++, 'DETAILS'); }
  const ownerLabel = repo.owner
    ? repo.owner.login + (repo.owner.type && repo.owner.type !== 'User' ? ' (' + repo.owner.type + ')' : '')
    : 'N/A';
  writeDetailRow('Owner:', ownerLabel);
  writeDetailRow('Visibility:', repo.private ? 'Private' : String(repo.visibility || 'Public'));
  writeDetailRow('Language:', repo.language || 'N/A');
  writeDetailRow('License:', (repo.license && (repo.license.spdx_id !== 'NOASSERTION' ? (repo.license.spdx_id || repo.license.name) : repo.license.name)) || 'None');
  writeDetailRow('Watchers:', shortNum(repo.subscribers_count ?? repo.watchers_count ?? 0));
  writeDetailRow('Size:', formatRepoSize(repo.size));
  writeDetailRow('Age:', repoAge(repo.created_at));
  writeDetailRow('Default:', repo.default_branch || 'main');
  writeDetailRow('Created:', dateWithRel(repo.created_at));
  writeDetailRow('Updated:', dateWithRel(repo.updated_at));
  writeDetailRow('Pushed:', dateWithRel(repo.pushed_at));
  if (ly < leftEnd) {
    screen.writeStr(2, ly, 'URL:', { dim: true });
    screen.writeStr(valX, ly, truncate(String(repo.html_url || ''), Math.max(8, W - valX - 2)), color('accent'));
    ly++;
  }
  const leftUsedEnd = ly;

  // Right column: health, languages, contributors, releases.
  const rightX = leftWidth + 6;
  const wide = rightX + 20 < W;
  let rightUsedEnd = leftUsedEnd; // narrow terminals: footer follows the left column
  if (wide) {
    let ry = y + 3;
    if (appState.repoHealth && appState.repoHealth.score != null && ry < y + maxH - 2) {
      sectionHeader(screen, rightX, ry++, 'HEALTH');
      const barW = Math.min(12, Math.max(6, W - rightX - 26));
      for (const comp of healthComponents(appState.repoHealth)) {
        if (ry >= y + maxH - 1) break;
        screen.writeStr(rightX, ry, comp.label.padEnd(8), { dim: true });
        if (comp.value == null) {
          screen.writeStr(rightX + 8, ry, '—', { dim: true });
        } else {
          const filled = Math.round((comp.value / 100) * barW);
          const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, barW - filled));
          const barStyle = comp.value >= 70 ? { fg: 'green' }
            : comp.value >= 40 ? { fg: 'yellow' } : { fg: 'red' };
          screen.writeStr(rightX + 8, ry, bar, barStyle);
          screen.writeStr(rightX + 9 + barW, ry, String(comp.value), barStyle);
        }
        ry++;
      }
      ry++;
    }
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
        screen.writeStr(rightX, ry, padRight(truncate(lang, 12), 13));
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
        const tag = truncate(rel.tag_name || rel.name || '?', 16);
        const flag = rel.draft ? ' (draft)' : rel.prerelease ? ' (pre)' : '';
        const when = rel.published_at ? new Date(rel.published_at).toLocaleDateString() : '';
        screen.writeStr(rightX, ry, '▶ ' + tag, flag ? color('warning') : null);
        screen.writeStr(rightX + 21, ry, truncateToWidth(flag, 8, ''), color('warning'));
        screen.writeStr(rightX + 30, ry, when, { dim: true });
        ry++;
      }
    }
    rightUsedEnd = ry;
  }

  // Footer action hints (only when neither column ran into the bottom).
  const footerY = Math.max(leftUsedEnd, rightUsedEnd) + 1;
  if (footerY < y + maxH) {
    const hints = '[o] Browser  [y] Copy URL  [s] Star  [b] Bookmark  [F] Files  [R] README  [A] Packages  [Esc] Back';
    screen.writeStr(2, footerY, truncateToWidth(hints, W - 4, ''), { dim: true });
  }
}

export function renderAnalyze(screen, y, h) {
  screen.writeStr(2, y, 'EXPLORE REPOSITORY', color('title') || { fg: 'white', bold: true });
  screen.hline(y + 1, '─', { dim: true });
  const v = appState.analyzeView;
  if (v === 'security-aggregate') { renderSecurityAggregate(screen, y + 2, h - 2); return; }
  if (v === 'organizations') { renderOrganizations(screen, y + 2, h - 2); return; }
  if (v === 'search')   { loadExploreTrending(); renderSearchInput(screen, y, h); return; }
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
  if (v === 'security-aggregate' || v === 'organizations') { appState.analyzeView = 'search'; appState.securityAggregateVisible = false; render(); return; }
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
      clearTextSelection();
      render();
      return;
    }
    // Reset all detail-related state to avoid stale data flash (E13).
    // resetDetailState covers compare/health/selectedAsset/detailsPane/
    // security cursor + Files viewer state that the old inline list missed.
    resetDetailState();
    appState.analyzeView = 'results';
    render();
  } else if (v === 'results') {
    if (appState.searchType === 'user-repos') {
      // Back from a user's repos → return to the user-search results.
      appState.searchType = 'users';
      appState.userRepos = [];
      appState.selectedUser = null;
      appState.userSelectedRepo = 0;
      appState.userSearchScroll = 0;
      render();
      return;
    }
    appState.searchResults = [];
    appState.userSearchResults = [];
    appState.codeSearchResults = [];
    appState.userRepos = [];
    appState.selectedUser = null;
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
    } else if (type === 'user-repos') {
      appState.userReposSelected = 0;
      appState.userReposScroll = 0;
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
// Star / unstar the repo currently open in the details Overview pane.
// Backs both the [s] key (Overview pane only — other panes keep their own
// 's' bindings) and the clickable star button in the title row.
export function toggleStarDetails() {
  if (appState.analyzeView !== 'details' || !appState.repoDetails) return;
  toggleStarRepo(appState.repoDetails);
}

export function startSearchInputFor(type) {
  if (type === 'users') {
    appState.searchType = 'users';
    appState.analyzeView = 'search';
    appState.userSelectedRepo = 0;
    appState.userSearchScroll = 0;
    render();
    startInput('Search users: ', 'user-search');
  } else if (type === 'code') {
    appState.searchType = 'code';
    appState.analyzeView = 'search';
    appState.codeSelectedRepo = 0;
    appState.codeSearchScroll = 0;
    render();
    startInput('Search code: ', 'code-search');
  } else {
    appState.searchType = 'repos';
    appState.analyzeView = 'search';
    appState.selectedRepo = 0;
    appState.searchScroll = 0;
    render();
    startInput('Search repos: ', 'search');
  }
}

export const keys = {
  'i': () => {
    if (appState.analyzeView === 'details') {
      const next = appState.detailsPane === 'issues' ? 'overview' : 'issues';
      appState.detailsPane = next;
      appState.detailsScroll = 0;
      if (next !== 'issues' && next !== 'prs') clearTextSelection();
      // E4: the inactive pane may predate the shared filter — refetch when
      // its stored stamp mismatches the global filter.
      if (next === 'issues' && (appState.repoIssuesFilter || appState.issueStateFilter) !== appState.issueStateFilter) {
        render();
        refetchPane('issues');
        return;
      }
      render();
    } else {
      startSearchInputFor('repos');
    }
  },
  'P': () => {
    if (appState.analyzeView === 'details') {
      const next = appState.detailsPane === 'prs' ? 'overview' : 'prs';
      appState.detailsPane = next;
      appState.detailsScroll = 0;
      if (next !== 'issues' && next !== 'prs') clearTextSelection();
      // E4: same stale-filter guard as 'i' but for the PRs pane.
      if (next === 'prs' && (appState.repoPRsFilter || appState.issueStateFilter) !== appState.issueStateFilter) {
        render();
        refetchPane('prs');
        return;
      }
      render();
    }
  },
  'O': () => {
    if (appState.analyzeView === 'details') {
      appState.detailsPane = 'overview';
      appState.detailsScroll = 0;
      clearTextSelection();
      render();
    }
  },
  'R': () => { if (appState.analyzeView === 'details') viewReadme(); },
  'F': () => { if (appState.analyzeView === 'details') files.openFilesPane(); },
  'A': () => {
    if (appState.analyzeView === 'details') {
      if (appState.detailsPane === 'packages') {
        appState.detailsPane = 'overview';
        clearTextSelection();
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
    // On the details Overview pane the issue-state filter is a no-op, so
    // 's' stars / unstars the open repo (mirrors the Repos tab button).
    else if (appState.analyzeView === 'details' && appState.detailsPane === 'overview') toggleStarDetails();
    else cycleIssueStateFilter();
  },
  'S': () => {
    if (appState.searchType === 'user-repos') {
      toggleUserReposSort('stars');
    } else if (appState.analyzeView === 'details') {
      if (appState.detailsPane === 'security') {
        appState.detailsPane = 'overview';
        clearTextSelection();
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
  'U': () => {
    if (appState.searchType === 'user-repos') toggleUserReposSort('updated');
  },
  'Z': () => { if (isFilesPane()) files.keys.Z(); },
  'C': () => {
    if (isFilesPane()) files.keys.C();
    else if (appState.analyzeView === 'search' || appState.analyzeView === 'results') {
      startSearchInputFor('code');
    }
  },
  'D': () => { if (appState.analyzeView === 'details') startCompare(); },
  'u': () => {
    if (appState.analyzeView === 'search' || appState.analyzeView === 'results') {
      startSearchInputFor('users');
    }
  },
  'G': () => { if (isFilesPane()) files.keys.G(); },
  'B': () => { if (isFilesPane()) files.keys.B(); },
  'H': () => { if (isFilesPane()) files.keys.H(); },
  'Y': () => { if (isFilesPane()) files.keys.Y(); },
  '/': () => { if (isFilesPane()) files.keys['/'](); },
  't': () => { if (isFilesPane()) files.keys.t(); },
  'e': () => { if (isFilesPane()) files.keys.e(); },
  'c': () => { if (isFilesPane()) files.keys.c(); },
  'g': () => { jumpTop(); },
  'n': () => { if (appState.analyzeView === 'forks') toggleForkSort('name'); },
  'p': () => { if (isFilesPane()) files.keys.p(); else if (appState.analyzeView === 'forks') toggleForkSort('pushed'); },
  'T': () => {
    if (appState.analyzeView === 'details') {
      if (appState.detailsPane === 'traffic') {
        appState.detailsPane = 'overview';
        clearTextSelection();
      } else {
        appState.detailsPane = 'traffic';
        appState.detailsScroll = 0;
        loadTraffic();
      }
      render();
    }
  },
  'K': () => {
    if (appState.analyzeView === 'details') {
      if (appState.detailsPane === 'checks') {
        appState.detailsPane = 'overview';
        clearTextSelection();
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
  if (appState.analyzeView === 'security-aggregate') { securityAggregateUp(); return; }
  if (appState.analyzeView === 'organizations') { organizationUp(); return; }
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
    } else if (type === 'user-repos') {
      const list = appState.userRepos;
      if (list.length > 0) {
        if (appState.userReposSelected > appState.userReposScroll) appState.userReposSelected--;
        else if (appState.userReposScroll > 0) { appState.userReposScroll--; appState.userReposSelected--; }
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
  if (appState.analyzeView === 'security-aggregate') { securityAggregateDown(); return; }
  if (appState.analyzeView === 'organizations') { organizationDown(); return; }
  if (isFilesPane()) { files.down(screen); return; }
  if (isSecurityPane()) { securityDown(screen); return; }
  if (appState.analyzeView === 'details' && appState.detailsPane !== 'overview') {
    let listLen;
    if (appState.detailsPane === 'issues') listLen = appState.repoIssues.length;
    else if (appState.detailsPane === 'prs') listLen = appState.repoPullRequests.length;
    else if (appState.detailsPane === 'packages') listLen = appState.repoReleaseAssets.length;
    else if (appState.detailsPane === 'readme')
      listLen = (appState._readmeText || '').split(/\r?\n/).length;
    // E10: make Checks/Traffic panes scrollable via detailsScroll. Checks
    // rows = runs + suites; Traffic rows = popular paths + referrers. When
    // both are empty listLen is 0 and the clamp below keeps scroll at 0.
    else if (appState.detailsPane === 'checks') listLen = appState.repoCheckRuns.length + appState.repoCheckSuites.length;
    else if (appState.detailsPane === 'traffic') listLen = (appState.repoTrafficPopularPaths || []).length + (appState.repoTrafficPopularReferrers || []).length;
    else listLen = 0;
    appState.detailsScroll = Math.min(Math.max(0, listLen - 1), appState.detailsScroll + 1);
    if (appState.detailsPane === 'packages') appState.selectedAsset = appState.detailsScroll;
    render(); return;
  }
  if (appState.analyzeView === 'results') {
    const type = appState.searchType || 'repos';
    const maxVisible = maxVisibleResults(screen.height - 8);
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
    } else if (type === 'user-repos') {
      const list = appState.userRepos;
      if (list.length > 0) {
        if (appState.userReposSelected < appState.userReposScroll + maxVisible - 1) {
          appState.userReposSelected = Math.min(list.length - 1, appState.userReposSelected + 1);
        } else if (appState.userReposScroll + maxVisible < list.length) {
          appState.userReposScroll++;
          appState.userReposSelected = Math.min(list.length - 1, appState.userReposSelected + 1);
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
export function exploreEnter() {
  // exploreSel is absolute over the full landing (renderExploreLanding keeps
  // _exploreVisibleItems as the scrolled window with _exploreBounds.startIdx).
  const all = getExploreLanding();
  const visible = appState._exploreVisibleItems || all;
  const item = all[appState.exploreSel] || visible[appState.exploreSel];
  if (!item) return;
  if (item.kind === 'trending' || item.kind === 'recent') {
    const repo = item.repo;
    if (repo && repo.full_name) {
      const [owner, name] = repo.full_name.split('/');
      loadRepoDetails(owner, name);
    }
  } else if (item.kind === 'saved' && item.search && item.search.query) {
    submitSearch(item.search.query);
  }
}

export function enter() {
  if (appState.analyzeView === 'security-aggregate') { securityAggregateEnter(); return; }
  if (appState.analyzeView === 'organizations') { organizationEnter(); return; }
  if (isFilesPane()) { files.enter(); return; }
  if (isSecurityPane()) { securityEnter(); return; }
  const v = appState.analyzeView;
  if (v === 'search') { exploreEnter(); return; }
  const type = appState.searchType || 'repos';
  if (v === 'results') {
    if (type === 'users') {
      const user = appState.userSearchResults[appState.userSelectedRepo];
      if (user && user.login) {
        openUserRepos(user);
      }
    } else if (type === 'code') {
      const item = appState.codeSearchResults[appState.codeSelectedRepo];
      if (item) {
        // E15 MVP: in-TUI drill-in — open the containing repo's Files pane
        // at the result path. `o` (browser) is handled separately in keys.mjs.
        const full = item.repository && item.repository.full_name;
        const path = item.path;
        if (full && path) {
          const parts = full.split('/');
          const owner = parts[0];
          const name = parts[1];
          showMessage('Opening ' + full + ' → ' + path, 'info');
          Promise.resolve().then(async () => {
            try {
              await loadRepoDetails(owner, name);
              if (typeof files.openFilePath === 'function') {
                await files.openFilePath(path).catch(() => {});
              } else {
                await files.openFilesPane();
              }
            } catch (e) {
              showMessage((e && e.message) || 'Failed to open file', 'error');
            }
          });
        } else if (item.html_url) {
          openUrl(item.html_url).then(res => {
            if (res.ok) showMessage('Opened in browser', 'success');
            else showMessage(res.error || 'Open failed', 'error');
          });
        }
      }
    } else if (type === 'user-repos') {
      const repo = appState.userRepos[appState.userReposSelected];
      if (repo) {
        const [owner, name] = repo.full_name.split('/');
        loadRepoDetails(owner, name);
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
    startSearchInputFor(appState.searchType || 'repos');
  }
}

export function space() {
  if (appState.analyzeView === 'results') loadMoreSearchResults();
  else if (appState.analyzeView === 'forks') loadMoreForks();
  else if (appState.analyzeView === 'details') {
    if (appState.detailsPane === 'issues' || appState.detailsPane === 'prs') loadMoreIssues();
  }
}

// ── Collapsible sections ──
const ANALYZE_SECTIONS = ['overview', 'issues', 'prs', 'readme', 'files', 'packages', 'traffic', 'checks', 'security', 'compare'];

export function getSections() {
  return ANALYZE_SECTIONS.map(s => 'analyze:' + s);
}

export function getCurrentSection() {
  return 'analyze:' + (appState.detailsPane || 'overview');
}
