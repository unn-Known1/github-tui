// Explore tab pure-logic tests — no network, hermetic (save/restore appState).
// Covers: forks sort (E2), issue filter labels (E4), landing caps/merge order
// (E7/E8), fork sort options, state defaults + reset, compare style (guarded).

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { appState, resetAccountState } from '../tui/state.mjs';
import { sortForks, FORK_SORT_OPTIONS } from '../tui/tabs/forks.mjs';
import { filterLabel } from '../tui/tabs/analyze-issues.mjs';
import { getExploreLanding, EXPLORE_MAX_TRENDING } from '../tui/tabs/analyze-search.mjs';
import {
  repoStatusBadges, repoAge, formatRepoSize, dateWithRel,
  healthComponents, HEALTH_COMPONENTS,
} from '../tui/tabs/analyze.mjs';
import { layoutPackageColumns } from '../tui/tabs/analyze-packages.mjs';
import {
  FILES_SORTS, sortFilesEntries, filterFilesEntries, isProbablyBinary,
  getFileMeta, buildBlobUrl, buildTreeUrl, buildCommitUrl,
  lastModKey, getLastMod, setLastMod, lastModText, lastChangeLine,
} from '../tui/tabs/files.mjs';

// Keys this file mutates — restored after every test.
const TOUCHED = [
  'trending', 'savedSearches', 'recentRepos',
  'repoIssuesFilter', 'repoPRsFilter', 'exploreLandingScroll',
  'filesLastMod',
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

const filesFixture = () => ([
  { name: 'src', type: 'dir', path: 'src', size: 0 },
  { name: 'README.md', type: 'file', path: 'README.md', size: 200 },
  { name: 'app.mjs', type: 'file', path: 'app.mjs', size: 5000 },
  { name: 'docs', type: 'dir', path: 'docs', size: 0 },
  { name: 'style.css', type: 'file', path: 'style.css', size: 800 },
]);

describe('Files pane sort (name/size/type)', () => {
  it('exposes name/size/type sort options', () => {
    assert.deepEqual(FILES_SORTS.map(o => o.id), ['name', 'size', 'ext']);
  });

  it('sorts dirs-first alpha by default and does not mutate input', () => {
    const input = filesFixture();
    const out = sortFilesEntries(input, 'name');
    assert.deepEqual(out.map(e => e.name), ['docs', 'src', 'app.mjs', 'README.md', 'style.css']);
    assert.equal(input[0].name, 'src');
  });

  it('sorts files largest-first in size mode (dirs stay alpha on top)', () => {
    const out = sortFilesEntries(filesFixture(), 'size');
    assert.deepEqual(out.map(e => e.name), ['docs', 'src', 'app.mjs', 'style.css', 'README.md']);
  });

  it('sorts files by extension then name in type mode', () => {
    const out = sortFilesEntries(filesFixture(), 'ext');
    assert.deepEqual(out.map(e => e.name), ['docs', 'src', 'style.css', 'README.md', 'app.mjs']);
  });

  it('falls back to name order for unknown sort ids', () => {
    const out = sortFilesEntries(filesFixture(), 'bogus');
    assert.deepEqual(out.map(e => e.name), ['docs', 'src', 'app.mjs', 'README.md', 'style.css']);
  });
});

describe('Files pane filter', () => {
  it('returns the input unchanged for empty queries', () => {
    const input = filesFixture();
    assert.equal(filterFilesEntries(input, ''), input);
    assert.equal(filterFilesEntries(input, '   '), input);
  });

  it('matches names case-insensitively', () => {
    const out = filterFilesEntries(filesFixture(), 'read');
    assert.deepEqual(out.map(e => e.name), ['README.md']);
    assert.deepEqual(filterFilesEntries(filesFixture(), 'SRC').map(e => e.name), ['src']);
  });

  it('returns [] for non-array input', () => {
    assert.deepEqual(filterFilesEntries(null, 'x'), []);
  });
});

describe('Files pane binary guard + meta', () => {
  it('flags NUL-containing payloads as binary only', () => {
    assert.equal(isProbablyBinary('hello\nworld'), false);
    assert.equal(isProbablyBinary(''), false);
    assert.equal(isProbablyBinary(null), false);
    assert.equal(isProbablyBinary('ab\0cd'), true);
  });

  it('reports bytes, lines, and language', () => {
    const meta = getFileMeta('app.mjs', 'a\nb\nc');
    assert.equal(meta.lines, 3);
    assert.equal(meta.language, 'javascript');
    assert.ok(meta.bytes > 0);
    assert.equal(getFileMeta('x', '').lines, 0);
  });
});

describe('Files pane browser URLs', () => {
  it('builds blob/tree/commit URLs on the public host', () => {
    assert.equal(
      buildBlobUrl('o', 'r', 'main', 'src/a.mjs', 'github.com'),
      'https://github.com/o/r/blob/main/src/a.mjs');
    assert.equal(
      buildTreeUrl('o', 'r', 'dev', 'src', 'github.com'),
      'https://github.com/o/r/tree/dev/src');
    assert.equal(
      buildTreeUrl('o', 'r', 'main', '', 'github.com'),
      'https://github.com/o/r/tree/main');
    assert.equal(
      buildCommitUrl('o', 'r', 'abc123', 'github.com'),
      'https://github.com/o/r/commit/abc123');
  });

  it('encodes path segments and ref', () => {
    const url = buildBlobUrl('o', 'r', 'feat/x', 'my dir/a.mjs', 'github.com');
    assert.ok(url.includes('my%20dir/a.mjs'));
    assert.ok(url.includes('/blob/feat/x/'));
  });
});

describe('Files pane last-modified status', () => {
  it('keys cache entries per branch + path', () => {
    assert.notEqual(lastModKey('main', 'a.mjs'), lastModKey('dev', 'a.mjs'));
    assert.notEqual(lastModKey('main', 'a.mjs'), lastModKey('main', 'b.mjs'));
    assert.equal(lastModKey('main', 'a.mjs'), lastModKey('main', 'a.mjs'));
  });

  it('returns null for paths never fetched', () => {
    appState.filesLastMod = {};
    assert.equal(getLastMod('main', 'nope.mjs'), null);
  });

  it('round-trips set/get per branch', () => {
    appState.filesLastMod = {};
    setLastMod('main', 'a.mjs', { sha: 'abc', date: '2026-01-01T00:00:00Z', ts: Date.now() });
    assert.equal(getLastMod('main', 'a.mjs').sha, 'abc');
    assert.equal(getLastMod('dev', 'a.mjs'), null);
  });

  it('renders pending / failed / relative states', () => {
    assert.equal(lastModText(null), '…');
    assert.equal(lastModText({ failed: true, ts: Date.now() }), '—');
    assert.equal(lastModText({ date: null, ts: Date.now() }), '—');
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
    assert.equal(lastModText({ date: threeDaysAgo, ts: Date.now() }), '3d');
  });

  it('builds a viewer last-change line, or null without data', () => {
    appState.filesLastMod = {};
    assert.equal(lastChangeLine('main', 'a.mjs', 80), null);
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
    setLastMod('main', 'a.mjs', {
      sha: 'abc1234567', date: threeDaysAgo, author: 'octo',
      subject: 'fix it', ts: Date.now(),
    });
    const line = lastChangeLine('main', 'a.mjs', 120);
    assert.ok(line.includes('Last change 3d ago'));
    assert.ok(line.includes('abc1234'));
    assert.ok(line.includes('octo'));
    assert.ok(line.includes('fix it'));
    setLastMod('main', 'a.mjs', { failed: true, ts: Date.now() });
    assert.equal(lastChangeLine('main', 'a.mjs', 120), null);
  });
});

describe('Overview status badges', () => {
  it('returns no badges without a repo', () => {
    assert.deepEqual(repoStatusBadges(null), []);
  });

  it('badges visibility first, then lifecycle flags in stable order', () => {
    assert.deepEqual(
      repoStatusBadges({ private: false, visibility: 'public' }).map(b => b.label),
      ['public']);
    assert.deepEqual(
      repoStatusBadges({ private: true, fork: true, archived: true, is_template: true, disabled: true })
        .map(b => b.label),
      ['Private', 'Fork', 'Archived', 'Template', 'Disabled']);
  });

  it('defaults missing visibility to Public / success role', () => {
    const [badge] = repoStatusBadges({});
    assert.equal(badge.label, 'Public');
    assert.equal(badge.role, 'success');
  });
});

describe('Overview repo age', () => {
  const NOW = Date.parse('2026-09-04T00:00:00Z');
  it('bucketizes years / months / days / hours', () => {
    assert.equal(repoAge('2023-01-01T00:00:00Z', NOW), '3y');
    assert.equal(repoAge('2026-04-04T00:00:00Z', NOW), '5mo');
    assert.equal(repoAge('2026-08-25T00:00:00Z', NOW), '10d');
    assert.equal(repoAge('2026-09-03T18:00:00Z', NOW), '6h');
    assert.equal(repoAge('2026-09-03T23:00:00Z', NOW), 'today');
  });

  it('returns N/A for missing or unparseable dates', () => {
    assert.equal(repoAge(null), 'N/A');
    assert.equal(repoAge('not-a-date'), 'N/A');
  });
});

describe('Overview size + date stamps', () => {
  it('formats KiB sizes via bytes', () => {
    assert.equal(formatRepoSize(0), '0 B');
    assert.equal(formatRepoSize(2048), '2.0 MB');
    assert.equal(formatRepoSize(null), 'N/A');
    assert.equal(formatRepoSize('bogus'), 'N/A');
  });

  it('compounds absolute day with relative time', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
    const day = threeDaysAgo.split('T')[0];
    assert.equal(dateWithRel(threeDaysAgo), day + ' (3d ago)');
    assert.equal(dateWithRel(null), 'N/A');
    assert.equal(dateWithRel('bogus'), 'bogus');
  });
});

describe('Overview health components', () => {
  it('exposes five components in stable order with nulls preserved', () => {
    assert.deepEqual(HEALTH_COMPONENTS.map(([k]) => k),
      ['ci', 'freshness', 'issues', 'security', 'protection']);
    const out = healthComponents({ score: 80, components: { ci: 90, freshness: null } });
    assert.equal(out.length, 5);
    assert.deepEqual(out[0], { key: 'ci', label: 'CI', value: 90 });
    assert.deepEqual(out[1], { key: 'freshness', label: 'Fresh', value: null });
  });

  it('tolerates missing health', () => {
    assert.ok(healthComponents(null).every(c => c.value === null));
  });
});

describe('Packages fluid table layout', () => {
  const sizes = ['12.3 MB', '4.1 MB'];
  const tags = ['v1.10.0', 'v1.9.0'];
  const dls = ['↓1234', '↓56'];

  it('gives the file name everything left of the right-pinned columns', () => {
    const l = layoutPackageColumns(120, sizes, tags, dls);
    assert.equal(l.nameX, 5);
    assert.ok(l.sizeX > 0 && l.tagX > 0 && l.dlX > 0);
    assert.ok(l.sizeX < l.tagX && l.tagX < l.dlX);
    // name + gap ends exactly where the first meta column starts
    assert.equal(l.nameX + l.nameW + 2, Math.min(l.sizeX, l.tagX, l.dlX));
    assert.ok(l.nameW > 60);
  });

  it('never overflows the available width', () => {
    for (const W of [20, 30, 40, 60, 80, 100, 160, 250]) {
      const l = layoutPackageColumns(W, sizes, tags, dls);
      assert.ok(l.nameX + l.nameW <= W, 'W=' + W);
      for (const x of [l.sizeX, l.tagX, l.dlX]) {
        if (x >= 0) assert.ok(x < W, 'W=' + W);
      }
      // Widest dl fixture is 5 cells ('↓1234'); a shown dl column ends at rightEdge.
      assert.ok(l.dlX < 0 || l.dlX + 5 <= W, 'W=' + W);
    }
  });

  it('sheds narrowest-last columns to protect the file name', () => {
    // W=44: everything fits, name gets 12 cells.
    const roomy = layoutPackageColumns(44, sizes, tags, dls);
    assert.ok(roomy.sizeX > 0 && roomy.tagX > 0 && roomy.dlX > 0);
    assert.equal(roomy.nameW, 12);
    // W=30: the 7-wide tag no longer fits, size + downloads survive.
    const tight = layoutPackageColumns(30, sizes, tags, dls);
    assert.equal(tight.tagX, -1);
    assert.ok(tight.sizeX > 0 && tight.dlX > 0);
    // W=20: meta columns all gone, name takes the row.
    const tiny = layoutPackageColumns(20, sizes, tags, dls);
    assert.equal(tiny.dlX, -1);
    assert.equal(tiny.tagX, -1);
    assert.equal(tiny.sizeX, -1);
    assert.equal(tiny.nameW, 13);
  });

  it('handles rows without tag/downloads', () => {
    const l = layoutPackageColumns(100, ['1.0 MB'], [''], ['']);
    assert.equal(l.tagX, -1);
    assert.equal(l.dlX, -1);
    assert.ok(l.sizeX > 0);
    assert.ok(l.nameW > 70);
  });
});
