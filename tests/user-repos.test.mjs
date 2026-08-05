// Explore user-repos flow — search users, then list a user's public repos.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appState } from '../tui/state.mjs';
import {
  getResultList, maxVisibleResults,
  applyUserReposSort, toggleUserReposSort,
  USER_REPOS_SORT_LABELS,
} from '../tui/tabs/analyze-search.mjs';

describe('Explore user search', () => {
  it('searchType defaults to repos', () => {
    assert.equal(appState.searchType, 'repos');
  });

  it('getResultList returns user repos for user-repos type', () => {
    appState.searchType = 'user-repos';
    appState.userRepos = [{ full_name: 'torvalds/linux' }];
    assert.deepEqual(getResultList(), [{ full_name: 'torvalds/linux' }]);
  });

  it('getResultList returns users for users type', () => {
    appState.searchType = 'users';
    appState.userSearchResults = [{ login: 'torvalds' }];
    assert.deepEqual(getResultList(), [{ login: 'torvalds' }]);
  });

  it('getResultList returns code results for code type', () => {
    appState.searchType = 'code';
    appState.codeSearchResults = [{ path: 'main.c' }];
    assert.deepEqual(getResultList(), [{ path: 'main.c' }]);
  });

  it('getResultList returns repo search results for repos type', () => {
    appState.searchType = 'repos';
    appState.searchResults = [{ full_name: 'facebook/react' }];
    assert.deepEqual(getResultList(), [{ full_name: 'facebook/react' }]);
  });

  it('user-repos state fields are present and sane', () => {
    assert.ok(Array.isArray(appState.userRepos));
    assert.equal(typeof appState.userReposHasMore, 'boolean');
    assert.equal(appState.userReposSelected, 0);
    assert.equal(appState.userReposScroll, 0);
    assert.equal(appState.userReposPage, 1);
  });

  it('maxVisibleResults fills the available window height', () => {
    assert.equal(maxVisibleResults(32), 24); // typical 40-row terminal
    assert.equal(maxVisibleResults(40), 32); // taller terminal uses all space
    assert.equal(maxVisibleResults(24), 16); // small terminal still fits
  });

  it('maxVisibleResults never drops below one row', () => {
    assert.equal(maxVisibleResults(0), 1);
    assert.equal(maxVisibleResults(1), 1);
    assert.equal(maxVisibleResults(5), 1);
  });

  it('userReposSort defaults to last updated descending', () => {
    assert.deepEqual(appState.userReposSort, { field: 'updated', asc: false });
  });

  it('applyUserReposSort sorts by stars descending', () => {
    appState.userReposSort = { field: 'stars', asc: false };
    appState.userRepos = [
      { name: 'b', stargazers_count: 1 },
      { name: 'a', stargazers_count: 500 },
    ];
    applyUserReposSort();
    assert.deepEqual(appState.userRepos.map(r => r.name), ['a', 'b']);
  });

  it('applyUserReposSort sorts by name ascending and resets scroll', () => {
    appState.userReposSort = { field: 'name', asc: true };
    appState.userRepos = [
      { name: 'zeta' },
      { name: 'alpha' },
    ];
    appState.userReposScroll = 3;
    applyUserReposSort();
    assert.deepEqual(appState.userRepos.map(r => r.name), ['alpha', 'zeta']);
    assert.equal(appState.userReposScroll, 0);
  });

  it('toggleUserReposSort switches field and reverses direction on repeat', () => {
    appState.userReposSort = { field: 'updated', asc: false };
    toggleUserReposSort('stars');
    assert.equal(appState.userReposSort.field, 'stars');
    assert.equal(appState.userReposSort.asc, false);
    toggleUserReposSort('stars');
    assert.equal(appState.userReposSort.asc, true);
  });

  it('user repo sort labels cover stars/updated/name', () => {
    assert.equal(USER_REPOS_SORT_LABELS.stars, 'Stars');
    assert.equal(USER_REPOS_SORT_LABELS.updated, 'Last updated');
    assert.equal(USER_REPOS_SORT_LABELS.name, 'Name');
  });
});
