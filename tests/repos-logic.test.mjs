import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sortRepos, applyAllFilters, floatPinsToTop } from '../tui/repos-logic.mjs';

const repos = [
  { name: 'alpha', full_name: 'user/alpha', stargazers_count: 100, forks_count: 10, open_issues_count: 5, updated_at: '2025-01-01T00:00:00Z', language: 'JavaScript', fork: false, archived: false, private: false, is_template: false, pushed_at: '2025-06-01T00:00:00Z', description: 'Alpha project' },
  { name: 'beta', full_name: 'user/beta', stargazers_count: 50, forks_count: 20, open_issues_count: 15, updated_at: '2025-06-01T00:00:00Z', language: 'Python', fork: true, archived: false, private: false, is_template: false, pushed_at: '2025-06-01T00:00:00Z', description: 'Beta fork' },
  { name: 'gamma', full_name: 'user/gamma', stargazers_count: 200, forks_count: 5, open_issues_count: 2, updated_at: '2024-12-01T00:00:00Z', language: 'Go', fork: false, archived: true, private: false, is_template: false, pushed_at: '2024-01-01T00:00:00Z', description: 'Gamma archived' },
  { name: 'delta', full_name: 'user/delta', stargazers_count: 10, forks_count: 1, open_issues_count: 0, updated_at: '2025-03-01T00:00:00Z', language: 'JavaScript', fork: false, archived: false, private: true, is_template: false, pushed_at: '2025-03-01T00:00:00Z', description: 'Delta private' },
  { name: 'epsilon', full_name: 'user/epsilon', stargazers_count: 0, forks_count: 0, open_issues_count: 0, updated_at: '2025-01-01T00:00:00Z', language: 'Rust', fork: false, archived: false, private: false, is_template: true, pushed_at: '2025-01-01T00:00:00Z', description: 'Epsilon template' },
];

describe('sortRepos', () => {
  it('sorts by name ascending', () => {
    const sorted = sortRepos(repos, { field: 'name', asc: true });
    assert.equal(sorted[0].name, 'alpha');
    assert.equal(sorted[4].name, 'gamma');
  });

  it('sorts by name descending', () => {
    const sorted = sortRepos(repos, { field: 'name', asc: false });
    assert.equal(sorted[0].name, 'gamma');
  });

  it('sorts by stars descending', () => {
    const sorted = sortRepos(repos, { field: 'stars', asc: false });
    assert.equal(sorted[0].name, 'gamma'); // 200 stars
    assert.equal(sorted[1].name, 'alpha'); // 100 stars
  });

  it('sorts by forks', () => {
    const sorted = sortRepos(repos, { field: 'forks', asc: false });
    assert.equal(sorted[0].name, 'beta'); // 20 forks
  });

  it('sorts by issues', () => {
    const sorted = sortRepos(repos, { field: 'issues', asc: false });
    assert.equal(sorted[0].name, 'beta'); // 15 issues
  });

  it('does not mutate original array', () => {
    const original = [...repos];
    sortRepos(repos, { field: 'name', asc: true });
    assert.deepEqual(repos, original);
  });

  it('handles empty array', () => {
    assert.deepEqual(sortRepos([], { field: 'name', asc: true }), []);
  });

  it('handles unknown field', () => {
    const sorted = sortRepos(repos, { field: 'unknown', asc: true });
    assert.equal(sorted.length, repos.length);
  });
});

describe('applyAllFilters', () => {
  const baseFilters = { typeFilter: 'all', langFilter: null, staleOnly: false, textFilter: '' };

  it('returns all repos with no filters', () => {
    assert.equal(applyAllFilters(repos, baseFilters).length, 5);
  });

  it('filters by type: sources', () => {
    const result = applyAllFilters(repos, { ...baseFilters, typeFilter: 'sources' });
    assert.equal(result.length, 4); // alpha, gamma, delta, epsilon (not fork)
  });

  it('filters by type: forks', () => {
    const result = applyAllFilters(repos, { ...baseFilters, typeFilter: 'forks' });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'beta');
  });

  it('filters by type: archived', () => {
    const result = applyAllFilters(repos, { ...baseFilters, typeFilter: 'archived' });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'gamma');
  });

  it('filters by type: private', () => {
    const result = applyAllFilters(repos, { ...baseFilters, typeFilter: 'private' });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'delta');
  });

  it('filters by type: public', () => {
    const result = applyAllFilters(repos, { ...baseFilters, typeFilter: 'public' });
    assert.equal(result.length, 4); // all except delta
  });

  it('filters by type: templates', () => {
    const result = applyAllFilters(repos, { ...baseFilters, typeFilter: 'templates' });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'epsilon');
  });

  it('filters by language', () => {
    const result = applyAllFilters(repos, { ...baseFilters, langFilter: 'Python' });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'beta');
  });

  it('filters by text in name', () => {
    const result = applyAllFilters(repos, { ...baseFilters, textFilter: 'alph' });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'alpha');
  });

  it('filters by text in description', () => {
    const result = applyAllFilters(repos, { ...baseFilters, textFilter: 'private' });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'delta');
  });

  it('filters by text in language', () => {
    const result = applyAllFilters(repos, { ...baseFilters, textFilter: 'rust' });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'epsilon');
  });

  it('combines multiple filters', () => {
    const result = applyAllFilters(repos, {
      ...baseFilters,
      typeFilter: 'public',
      langFilter: 'JavaScript',
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'alpha');
  });

  it('does not mutate original array', () => {
    const original = [...repos];
    applyAllFilters(repos, { ...baseFilters, typeFilter: 'forks' });
    assert.deepEqual(repos, original);
  });
});

describe('floatPinsToTop', () => {
  it('returns repos unchanged when no pins', () => {
    const result = floatPinsToTop(repos, []);
    assert.equal(result.length, 5);
    assert.equal(result[0].name, 'alpha');
  });

  it('returns repos unchanged when pins is null', () => {
    const result = floatPinsToTop(repos, null);
    assert.equal(result.length, 5);
  });

  it('floats pinned repos to top in pin order', () => {
    const result = floatPinsToTop(repos, ['user/gamma', 'user/alpha']);
    assert.equal(result[0].name, 'gamma');
    assert.equal(result[1].name, 'alpha');
    assert.equal(result.length, 5);
  });

  it('preserves order of unpinned repos', () => {
    const result = floatPinsToTop(repos, ['user/gamma']);
    const unpinned = result.filter(r => r.name !== 'gamma');
    assert.equal(unpinned[0].name, 'alpha');
    assert.equal(unpinned[1].name, 'beta');
  });

  it('does not mutate original array', () => {
    const original = [...repos];
    floatPinsToTop(repos, ['user/alpha']);
    assert.deepEqual(repos, original);
  });
});
