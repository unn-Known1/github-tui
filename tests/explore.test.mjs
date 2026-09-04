// Explore tab pure-logic tests — no network, hermetic (save/restore appState).
// Covers: forks sort (E2), issue filter labels (E4), landing caps/merge order
// (E7/E8), fork sort options, state defaults + reset, compare style (guarded).

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { appState, resetAccountState } from '../tui/state.mjs';
import { sortForks, FORK_SORT_OPTIONS } from '../tui/tabs/forks.mjs';
import { filterLabel } from '../tui/tabs/analyze-issues.mjs';
import { getExploreLanding, EXPLORE_MAX_TRENDING } from '../tui/tabs/analyze-search.mjs';

// Keys this file mutates — restored after every test.
const TOUCHED = [
  'trending', 'savedSearches', 'recentRepos',
  'repoIssuesFilter', 'repoPRsFilter', 'exploreLandingScroll',
];
const saved = {};
for (const k of TOUCHED) saved[k] = appState[k];

afterEach(() => {
  for (const k of TOUCHED) appState[k] = saved[k];
});

const forksFixture = () => ([
  { full_name: 'o/b-repo', stargazers_count: 5, pushed_at: '2024-01-01T00:00:00Z' },
  { full_name: 'o/a-repo', stargazers_count: 50, pushed_at: '2026-08-01T00:00:00Z' },
  { full_name: 'o/c-repo', stargazers_count: 20, pushed_at: '2025-06-01T00:00:00Z' },
]);

describe('Explore forks sort (E2)', () => {
  it('sorts by stars descending by default', () => {
    const out = sortForks(forksFixture(), { field: 'stars', asc: false });
    assert.deepEqual(out.map(f => f.full_name), ['o/a-repo', 'o/c-repo', 'o/b-repo']);
  });

  it('sorts by name ascending', () => {
    const out = sortForks(forksFixture(), { field: 'name', asc: true });
    assert.deepEqual(out.map(f => f.full_name), ['o/a-repo', 'o/b-repo', 'o/c-repo']);
  });

  it('sorts by push recency and does not mutate the input', () => {
    const input = forksFixture();
    const out = sortForks(input, { field: 'pushed', asc: false });
    assert.deepEqual(out.map(f => f.full_name), ['o/a-repo', 'o/c-repo', 'o/b-repo']);
    assert.equal(input[0].full_name, 'o/b-repo');
  });

  it('FORK_SORT_OPTIONS exposes p/s/n keys for pushed/stars/name', () => {
    const byKey = Object.fromEntries(FORK_SORT_OPTIONS.map(o => [o.key, o.field]));
    assert.equal(byKey.p, 'pushed');
    assert.equal(byKey.s, 'stars');
    assert.equal(byKey.n, 'name');
  });
});

describe('Explore issue filter labels (E4)', () => {
  it('maps open/closed/all to labels', () => {
    assert.equal(filterLabel('open'), 'OPEN');
    assert.equal(filterLabel('closed'), 'CLOSED');
    assert.equal(filterLabel('all'), 'ALL');
  });
});

describe('Explore landing merge order and caps (E7/E8)', () => {
  it('merges trending then saved then recent', () => {
    appState.trending = [{ full_name: 't/one' }];
    appState.savedSearches = [{ id: 's1', label: 'mine', query: 'q' }];
    appState.recentRepos = [{ full_name: 'r/one' }];
    const kinds = getExploreLanding().map(i => i.kind);
    assert.deepEqual(kinds, ['trending', 'saved', 'recent']);
  });

  it('caps trending at EXPLORE_MAX_TRENDING and bounds saved/recent', () => {
    assert.ok(Number.isInteger(EXPLORE_MAX_TRENDING) && EXPLORE_MAX_TRENDING > 0);
    appState.trending = Array.from({ length: EXPLORE_MAX_TRENDING + 4 }, (_, i) => ({ full_name: 't/' + i }));
    appState.savedSearches = Array.from({ length: 10 }, (_, i) => ({ id: 's' + i, label: 'l' + i, query: 'q' }));
    appState.recentRepos = Array.from({ length: 10 }, (_, i) => ({ full_name: 'r/' + i }));
    const items = getExploreLanding();
    assert.equal(items.filter(i => i.kind === 'trending').length, EXPLORE_MAX_TRENDING);
    assert.ok(items.filter(i => i.kind === 'saved').length <= 5);
    assert.ok(items.filter(i => i.kind === 'recent').length <= 5);
  });
});

describe('Explore state defaults and reset', () => {
  it('defaults per-pane filters to open and landing scroll to 0', () => {
    assert.equal(appState.repoIssuesFilter, 'open');
    assert.equal(appState.repoPRsFilter, 'open');
    assert.equal(appState.exploreLandingScroll, 0);
  });

  it('resetAccountState restores the Explore defaults', () => {
    appState.repoIssuesFilter = 'closed';
    appState.repoPRsFilter = 'all';
    appState.exploreLandingScroll = 7;
    resetAccountState();
    assert.equal(appState.repoIssuesFilter, 'open');
    assert.equal(appState.repoPRsFilter, 'open');
    assert.equal(appState.exploreLandingScroll, 0);
  });
});

describe('Explore compare status style (E12, guarded)', () => {
  it('colors known file statuses when the helper exists', async (t) => {
    let mod = null;
    try {
      mod = await import('../tui/tabs/analyze-compare.mjs');
    } catch (e) {
      t.skip('analyze-compare.mjs not importable: ' + (e && e.message));
      return;
    }
    if (typeof mod.compareStatusStyle !== 'function') {
      t.skip('compareStatusStyle export missing (counterpart-owned file)');
      return;
    }
    const style = mod.compareStatusStyle('added');
    assert.equal(style, 'success');
    assert.equal(mod.compareStatusStyle('removed'), 'error');
    assert.equal(mod.compareStatusStyle('modified'), 'warning');
    assert.equal(mod.compareStatusStyle('renamed'), 'info');
    assert.equal(mod.compareStatusStyle('bogus'), null);
  });
});
