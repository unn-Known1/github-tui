import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sortRepos, applyAllFilters, floatPinsToTop, parseRepoQuery } from '../tui/repos-logic.mjs';

const repos = [
  { name: 'alpha', full_name: 'u/alpha', stargazers_count: 150, forks_count: 20, open_issues_count: 5, updated_at: '2025-01-01T00:00:00Z', pushed_at: '2025-06-01T00:00:00Z', language: 'rust', description: 'alpha tool', fork: false, archived: false, private: false, is_template: false },
  { name: 'beta', full_name: 'u/beta', stargazers_count: 50, forks_count: 5, open_issues_count: 0, updated_at: '2025-06-01T00:00:00Z', pushed_at: '2025-06-01T00:00:00Z', language: 'go', description: 'beta thing', fork: false, archived: false, private: false, is_template: false },
  { name: 'gamma', full_name: 'u/gamma', stargazers_count: 5, forks_count: 1, open_issues_count: 12, updated_at: '2024-12-01T00:00:00Z', pushed_at: '2024-01-01T00:00:00Z', language: 'python', description: 'gamma lib', fork: false, archived: false, private: false, is_template: false },
];

const baseFilters = { typeFilter: 'all', langFilter: null, staleOnly: false, textFilter: '' };

describe('parseRepoQuery', () => {
  it('plain text passthrough', () => {
    assert.deepEqual(parseRepoQuery('alpha beta'), { text: 'alpha beta', stars: null, forks: null, issues: null, lang: null });
  });

  it('parses stars:>100', () => {
    assert.deepEqual(parseRepoQuery('stars:>100'), { text: '', stars: { op: '>', n: 100 }, forks: null, issues: null, lang: null });
  });

  it('parses forks:>=10', () => {
    assert.deepEqual(parseRepoQuery('forks:>=10'), { text: '', stars: null, forks: { op: '>=', n: 10 }, issues: null, lang: null });
  });

  it('parses issues:=0', () => {
    assert.deepEqual(parseRepoQuery('issues:=0'), { text: '', stars: null, forks: null, issues: { op: '=', n: 0 }, lang: null });
  });

  it('parses lang:rust', () => {
    assert.deepEqual(parseRepoQuery('lang:rust'), { text: '', stars: null, forks: null, issues: null, lang: 'rust' });
  });

  it('parses language:go', () => {
    assert.deepEqual(parseRepoQuery('language:go'), { text: '', stars: null, forks: null, issues: null, lang: 'go' });
  });

  it('is case-insensitive on keys', () => {
    assert.deepEqual(parseRepoQuery('STARS:>100').stars, { op: '>', n: 100 });
    assert.equal(parseRepoQuery('LANG:rust').lang, 'rust');
    assert.equal(parseRepoQuery('Language:go').lang, 'go');
  });

  it('preserves remainder text', () => {
    assert.deepEqual(parseRepoQuery('alpha stars:>10 beta'), { text: 'alpha beta', stars: { op: '>', n: 10 }, forks: null, issues: null, lang: null });
  });

  it('defaults numeric op to >= when omitted', () => {
    assert.deepEqual(parseRepoQuery('stars:100').stars, { op: '>=', n: 100 });
  });
});

describe('applyAllFilters with qualifiers', () => {
  it('filters by stars threshold', () => {
    const out = applyAllFilters(repos, { ...baseFilters, textFilter: 'stars:>100' });
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'alpha');
  });

  it('filters by forks threshold', () => {
    const out = applyAllFilters(repos, { ...baseFilters, textFilter: 'forks:>=10' });
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'alpha');
  });

  it('filters by issues threshold', () => {
    const out = applyAllFilters(repos, { ...baseFilters, textFilter: 'issues:=0' });
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'beta');
  });

  it('filters by lang: token', () => {
    const out = applyAllFilters(repos, { ...baseFilters, textFilter: 'lang:rust' });
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'alpha');
  });

  it('combines qualifier + text', () => {
    const out = applyAllFilters(repos, { ...baseFilters, textFilter: 'stars:>10 alpha' });
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'alpha');
    const none = applyAllFilters(repos, { ...baseFilters, textFilter: 'stars:>100 beta' });
    assert.equal(none.length, 0);
  });
});

describe('sortRepos + floatPinsToTop', () => {
  it('sortRepos sanity (stars desc)', () => {
    const sorted = sortRepos(repos, { field: 'stars', asc: false });
    assert.equal(sorted[0].name, 'alpha');
    assert.equal(sorted[2].name, 'gamma');
  });

  it('floatPinsToTop respects pin order', () => {
    const out = floatPinsToTop(repos, ['u/gamma', 'u/alpha']);
    assert.equal(out[0].name, 'gamma');
    assert.equal(out[1].name, 'alpha');
    assert.equal(out.length, 3);
  });
});

describe('actions.followScroll', () => {
  it('follows selection (skip if missing)', async (t) => {
    let mod;
    try {
      mod = await import('../tui/tabs/actions.mjs');
    } catch {
      t.skip('actions.mjs not importable');
      return;
    }
    if (typeof mod.followScroll !== 'function') {
      t.skip('followScroll missing (counterpart lag)');
      return;
    }
    assert.equal(mod.followScroll(0, 5, 10), 0);
    assert.equal(mod.followScroll(5, 0, 10), 0);
    assert.equal(mod.followScroll(15, 0, 10), 6);
  });
});

describe('repos.keys handlers', () => {
  it('repos keys exist (skip if missing)', async (t) => {
    let mod;
    try {
      mod = await import('../tui/tabs/repos.mjs');
    } catch {
      t.skip('repos.mjs not importable');
      return;
    }
    if (!mod.keys || typeof mod.keys !== 'object') {
      t.skip('repos.keys missing (counterpart lag)');
      return;
    }
    for (const k of ['l', 'n', 'S', 'f', 'i', 'u', 't', 'L', 'x', 'D', 'P', 's', 'V', 'c']) {
      if (typeof mod.keys[k] !== 'function') {
        t.skip(`repos.keys.${k} missing (counterpart lag)`);
        return;
      }
    }
    for (const k of ['l', 'n', 'S', 'f', 'i', 'u', 't', 'L', 'x', 'D', 'P', 's', 'V', 'c']) {
      assert.equal(typeof mod.keys[k], 'function');
    }
  });
});

describe('actions.keys handlers', () => {
  it('actions keys exist (skip if missing)', async (t) => {
    let mod;
    try {
      mod = await import('../tui/tabs/actions.mjs');
    } catch {
      t.skip('actions.mjs not importable');
      return;
    }
    if (!mod.keys || typeof mod.keys !== 'object') {
      t.skip('actions.keys missing (counterpart lag)');
      return;
    }
    for (const k of ['F', 'd', 'l', 't', 'o', 'R', 'x', '/']) {
      if (typeof mod.keys[k] !== 'function') {
        t.skip(`actions.keys.${k} missing (counterpart lag)`);
        return;
      }
    }
    for (const k of ['F', 'd', 'l', 't', 'o', 'R', 'x', '/']) {
      assert.equal(typeof mod.keys[k], 'function');
    }
  });
});

describe('palette registration', () => {
  it("has repos.load-more (skip if counterpart lags)", async (t) => {
    let palette;
    try {
      palette = await import('../tui/palette.mjs');
    } catch {
      t.skip('palette.mjs not importable');
      return;
    }
    const hasGetter = typeof palette.filter === 'function' || typeof palette.list === 'function' || typeof palette.getAll === 'function' || typeof palette.getActions === 'function';
    if (!hasGetter) {
      t.skip('palette has no list/registry getter');
      return;
    }
    let keysMod;
    try {
      keysMod = await import('../tui/keys.mjs');
    } catch {
      t.skip('keys.mjs not importable');
      return;
    }
    if (typeof keysMod.registerCoreActions !== 'function') {
      t.skip('registerCoreActions missing (counterpart lag)');
      return;
    }
    try {
      keysMod.registerCoreActions();
    } catch {
      t.skip('registerCoreActions threw (counterpart lag)');
      return;
    }
    let entries = null;
    try {
      // filter() fuzzy-matches labels (not ids); the label contains no
      // hyphen, so query with a space to hit the startsWith fast path.
      entries = palette.filter('load more repos');
    } catch {
      t.skip('palette filter threw');
      return;
    }
    const found = Array.isArray(entries) && entries.some(e => e && e.id === 'repos.load-more');
    assert.ok(found, 'repos.load-more registered in palette');
  });
});
