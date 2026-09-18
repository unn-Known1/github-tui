// Tests for tui/git-local.mjs — pure parsers for the Local tab.
// All fixtures are synthetic strings in the exact `-z` (NUL-delimited)
// format git emits; live git behavior (rename dest-first order, no quoting
// of spaces/unicode, `##` header variants) was verified against git 2.43.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBranchHeader, parsePorcelainV1Z, parseBranches, parseLog,
  statusArgs, logArgs, diffArgs, showArgs,
} from '../tui/git-local.mjs';

describe('parseBranchHeader', () => {
  it('parses a plain branch with no upstream', () => {
    assert.deepEqual(parseBranchHeader('## main'), {
      branch: 'main', upstream: null, ahead: 0, behind: 0, unborn: false, detached: false,
    });
  });
  it('strips the ## prefix when present', () => {
    const h = parseBranchHeader('## main...origin/main');
    assert.equal(h.branch, 'main');
    assert.equal(h.upstream, 'origin/main');
  });
  it('parses ahead/behind counts', () => {
    const h = parseBranchHeader('## main...origin/main [ahead 1, behind 2]');
    assert.equal(h.ahead, 1);
    assert.equal(h.behind, 2);
  });
  it('parses ahead-only and behind-only', () => {
    assert.equal(parseBranchHeader('## f...o/f [ahead 3]').ahead, 3);
    assert.equal(parseBranchHeader('## f...o/f [behind 4]').behind, 4);
  });
  it('treats [gone] as no counts but keeps upstream', () => {
    const h = parseBranchHeader('## feat...origin/feat [gone]');
    assert.equal(h.upstream, 'origin/feat');
    assert.equal(h.ahead, 0);
    assert.equal(h.behind, 0);
  });
  it('detects unborn repos', () => {
    const h = parseBranchHeader('## No commits yet on main');
    assert.equal(h.branch, 'main');
    assert.equal(h.unborn, true);
  });
  it('detects detached HEAD', () => {
    const h = parseBranchHeader('## HEAD (no branch)');
    assert.equal(h.detached, true);
    assert.equal(h.branch, 'HEAD (detached)');
  });
  it('handles branch names with slashes and dots', () => {
    const h = parseBranchHeader('## feature/foo.bar...origin/feature/foo.bar [ahead 1]');
    assert.equal(h.branch, 'feature/foo.bar');
    assert.equal(h.upstream, 'origin/feature/foo.bar');
  });
});

describe('parsePorcelainV1Z', () => {
  it('returns empty shelves for empty input', () => {
    assert.deepEqual(parsePorcelainV1Z(''), {
      branch: '', upstream: null, ahead: 0, behind: 0, unborn: false, detached: false,
      staged: [], unstaged: [], untracked: [], conflicted: [],
    });
  });
  it('parses staged, unstaged, and untracked entries', () => {
    const raw = '## main\0M  staged.txt\0 M unstaged.txt\0?? new.txt\0';
    const p = parsePorcelainV1Z(raw);
    assert.deepEqual(p.staged, [{ path: 'staged.txt', code: 'M', orig: null }]);
    assert.deepEqual(p.unstaged, [{ path: 'unstaged.txt', code: 'M', orig: undefined }]);
    assert.deepEqual(p.untracked, [{ path: 'new.txt' }]);
  });
  it('keeps spaces and unicode in paths verbatim (no unquoting)', () => {
    const raw = '## main\0A  a b.txt\0?? unicode-é.txt\0';
    const p = parsePorcelainV1Z(raw);
    assert.equal(p.staged[0].path, 'a b.txt');
    assert.equal(p.untracked[0].path, 'unicode-é.txt');
  });
  it('parses renames dest-first and swallows the origin record', () => {
    const raw = '## main\0R  sub/renamed file.txt\0sub/file.txt\0';
    const p = parsePorcelainV1Z(raw);
    assert.equal(p.staged.length, 1);
    assert.equal(p.staged[0].path, 'sub/renamed file.txt');
    assert.equal(p.staged[0].orig, 'sub/file.txt');
    // origin must not leak out as its own entry anywhere
    assert.equal(p.unstaged.length, 0);
    assert.equal(p.untracked.length, 0);
  });
  it('classifies the full conflict matrix as conflicted', () => {
    for (const code of ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']) {
      const p = parsePorcelainV1Z('## main\0' + code + ' f.txt\0');
      assert.equal(p.conflicted.length, 1, code);
      assert.equal(p.staged.length, 0, code + ' staged');
      assert.equal(p.unstaged.length, 0, code + ' unstaged');
    }
  });
  it('drops ignored (!!) entries', () => {
    const p = parsePorcelainV1Z('## main\0!! node_modules/x\0?? keep.txt\0');
    assert.equal(p.untracked.length, 1);
  });
  it('parses header with upstream + ahead/behind', () => {
    const p = parsePorcelainV1Z('## main...origin/main [ahead 1, behind 2]\0');
    assert.equal(p.branch, 'main');
    assert.equal(p.upstream, 'origin/main');
    assert.equal(p.ahead, 1);
    assert.equal(p.behind, 2);
  });
  it('handles added/deleted/typechange codes', () => {
    const p = parsePorcelainV1Z('## main\0A  new.txt\0D  gone.txt\0T  mode.txt\0');
    assert.deepEqual(p.staged.map(e => e.code), ['A', 'D', 'T']);
  });
  it('skips defensive bare records without XY prefix', () => {
    const p = parsePorcelainV1Z('## main\0M  ok.txt\0stray\0');
    assert.equal(p.staged.length, 1);
    assert.equal(p.untracked.length, 0);
  });
});

describe('parseBranches', () => {
  it('marks current and remote branches', () => {
    const list = parseBranches('* main\n  feature/foo\n  remotes/origin/main\n');
    assert.deepEqual(list, [
      { name: 'main', current: true, remote: false },
      { name: 'feature/foo', current: false, remote: false },
      { name: 'remotes/origin/main', current: false, remote: true },
    ]);
  });
  it('skips the remote-HEAD symbolic ref', () => {
    const list = parseBranches('* main\n  remotes/origin/HEAD -> origin/main\n');
    assert.equal(list.length, 1);
  });
  it('flags detached HEAD pseudo entries', () => {
    const list = parseBranches('* (HEAD detached at a1b2c3d)\n  main\n');
    assert.equal(list[0].detached, true);
    assert.equal(list[0].current, true);
  });
});

describe('parseLog', () => {
  it('parses records split on RS/US separators', () => {
    const raw = 'abc123\x1fAlice\x1f2026-09-18\x1ffix auth\x1fbody line\x1e' +
      'def456\x1fBob\x1f2026-09-17\x1fadd tests\x1f\x1e';
    const log = parseLog(raw);
    assert.equal(log.length, 2);
    assert.deepEqual(log[0], {
      sha: 'abc123', author: 'Alice', date: '2026-09-18', subject: 'fix auth', body: 'body line',
    });
    assert.equal(log[1].body, '');
  });
  it('drops malformed records without a hex sha', () => {
    assert.deepEqual(parseLog('not-a-record\x1e'), []);
    assert.deepEqual(parseLog(''), []);
  });
  it('keeps multiline bodies intact', () => {
    const log = parseLog('abc123\x1fA\x1fd\x1fsubj\x1fline1\nline2\x1e');
    assert.equal(log[0].body, 'line1\nline2');
  });
});

describe('argv builders — arrays only, never shell strings', () => {
  it('status uses porcelain v1 -b -z', () => {
    assert.deepEqual(statusArgs(), ['status', '--porcelain=v1', '-b', '-z', '--untracked-files=all']);
  });
  it('log caps count and supports skip pagination', () => {
    const a = logArgs(50, 0);
    assert.ok(a.includes('--max-count=50'));
    assert.ok(!a.some(x => x.startsWith('--skip')));
    assert.ok(logArgs(50, 50).includes('--skip=50'));
  });
  it('diff puts user paths after --', () => {
    assert.deepEqual(diffArgs({ staged: true, path: 'a b.txt' }),
      ['diff', '--no-color', '--unified=3', '--cached', '--', 'a b.txt']);
    assert.deepEqual(diffArgs({ path: 'x' }),
      ['diff', '--no-color', '--unified=3', '--', 'x']);
  });
  it('show pins the sha as an argv element', () => {
    const a = showArgs('abc123');
    assert.ok(a.includes('abc123'));
    assert.ok(a.includes('--'));
  });
});
