// Local git helpers — pure parsers + argv builders for the Local tab.
// Zero appState here: everything takes strings/arrays and returns data.
// All parsers target the NUL-delimited (`-z`) git output so quoted paths,
// spaces, and unicode never need unquoting (see parsePorcelainV1Z).

// ─── Porcelain v1 -z status ─────────────────────────────────────
// Input: raw stdout of `git status --porcelain=v1 -b -z --untracked-files=all`.
// Records are NUL-separated. The first record is the `## ...` branch header.
// Rename/copy records are `R  <NEW>\0<OLD>\0` — destination FIRST, the origin
// follows as a BARE record (no XY prefix). Verified live against git 2.43.
//
// Output: { branch, upstream, ahead, behind, unborn, detached,
//           staged:[{path,code}], unstaged:[{path,code}],
//           untracked:[{path}], conflicted:[{path,code}] }
export function parseBranchHeader(line) {
  const out = { branch: '', upstream: null, ahead: 0, behind: 0, unborn: false, detached: false };
  let s = String(line || '');
  if (s.startsWith('## ')) s = s.slice(3);
  // Unborn repo: `No commits yet on main` (some versions: `Initial commit on X`).
  let m = s.match(/^(?:No commits yet on|Initial commit on) (.+)$/);
  if (m) {
    out.branch = m[1];
    out.unborn = true;
    return out;
  }
  // Detached HEAD: `HEAD (no branch)` (older: `HEAD (no branch, rebasing ...)`).
  if (s === 'HEAD (no branch)' || s.startsWith('HEAD (no branch')) {
    out.branch = 'HEAD (detached)';
    out.detached = true;
    return out;
  }
  // `branch...upstream [ahead N][, behind M][gone]`
  const dots = s.indexOf('...');
  if (dots === -1) {
    out.branch = s.trim();
    return out;
  }
  out.branch = s.slice(0, dots);
  let rest = s.slice(dots + 3);
  // Upstream ends at ' [' or end of string.
  const brk = rest.indexOf(' [');
  if (brk === -1) {
    out.upstream = rest.trim() || null;
    return out;
  }
  out.upstream = rest.slice(0, brk).trim() || null;
  const flags = rest.slice(brk);
  const am = flags.match(/ahead (\d+)/);
  const bm = flags.match(/behind (\d+)/);
  if (am) out.ahead = parseInt(am[1], 10) || 0;
  if (bm) out.behind = parseInt(bm[1], 10) || 0;
  return out;
}

// Unmerged (conflicted) XY pairs in porcelain v1.
function isConflictPair(x, y) {
  if (x === 'U' || y === 'U') return true;
  if (x === 'A' && y === 'A') return true;
  if (x === 'D' && y === 'D') return true;
  return false;
}

export function parsePorcelainV1Z(input) {
  const out = {
    branch: '', upstream: null, ahead: 0, behind: 0, unborn: false, detached: false,
    staged: [], unstaged: [], untracked: [], conflicted: [],
  };
  const text = typeof input === 'string' ? input : String(input || '');
  if (!text) return out;
  // Split on NUL; the stream always ends with a trailing NUL producing a
  // final empty element — drop empties (a tracked path can never be '').
  const records = text.split('\0').filter(r => r !== '');
  if (records.length === 0) return out;
  let i = 0;
  if (records[0].startsWith('## ')) {
    Object.assign(out, parseBranchHeader(records[0]));
    i = 1;
  }
  for (; i < records.length; i++) {
    const rec = records[i];
    // Bare record without an XY prefix: origin half of a rename/copy pair
    // (already consumed via lookahead below) — skip defensively.
    if (rec.length < 4 || rec[2] !== ' ') continue;
    const x = rec[0];
    const y = rec[1];
    let path = rec.slice(3);
    // Rename/copy: destination is THIS record; origin follows as the next
    // bare record — consume it so it never becomes a phantom entry.
    let orig = null;
    if ((x === 'R' || x === 'C') && i + 1 < records.length) {
      orig = records[i + 1];
      i++;
    }
    if (x === '?' && y === '?') {
      out.untracked.push({ path });
      continue;
    }
    if (x === '!' && y === '!') continue; // ignored — never shown
    if (isConflictPair(x, y)) {
      out.conflicted.push({ path, code: x + y });
      continue;
    }
    if (x !== ' ' && x !== '?' && x !== '!') {
      out.staged.push({ path, code: x, orig });
    }
    if (y !== ' ' && y !== '?' && y !== '!') {
      // For unstaged renames the working-tree name is what matters.
      out.unstaged.push({ path, code: y, orig: y === 'R' || y === 'C' ? orig : undefined });
    }
  }
  return out;
}

// ─── Branch list ────────────────────────────────────────────────
// Input: stdout of `git branch -a --no-color`.
// Output: [{ name, current, remote }]. `name` keeps the `remotes/` prefix
// for remote branches so checkout logic can distinguish them.
export function parseBranches(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Detached-HEAD pseudo entry: `* (HEAD detached at a1b2c3d)` — not a
    // branch, but callers need to know we are detached.
    if (/^\(HEAD detached/.test(line.replace(/^\*\s*/, ''))) {
      out.push({ name: 'HEAD (detached)', current: true, remote: false, detached: true });
      continue;
    }
    // Symbolic remote HEAD: `remotes/origin/HEAD -> origin/main` — skip.
    if (line.includes(' -> ')) continue;
    const current = raw.startsWith('*');
    const name = current ? raw.slice(1).trim() : line;
    if (!name) continue;
    out.push({ name, current, remote: name.startsWith('remotes/') });
  }
  return out;
}

// ─── Log ────────────────────────────────────────────────────────
// Input: stdout of `git log --pretty=format:%H%x1f%an%x1f%ad%x1f%s%x1f%b%x1e ...`.
// Output: [{ sha, author, date, subject, body }].
export function parseLog(text) {
  const out = [];
  for (const rec of String(text || '').split('\x1e')) {
    if (!rec || !rec.trim()) continue;
    // Leading newline before %H when the format doesn't start the line —
    // our format starts with %H so trim only surrounding whitespace.
    const fields = rec.split('\x1f');
    if (fields.length < 4) continue;
    const sha = (fields[0] || '').trim();
    if (!/^[0-9a-f]{4,}$/i.test(sha)) continue;
    out.push({
      sha,
      author: (fields[1] || '').trim() || '?',
      date: (fields[2] || '').trim(),
      subject: (fields[3] || '').trim() || '(no message)',
      body: (fields[4] || '').trim(),
    });
  }
  return out;
}

// ─── Argv builders (argv arrays only — never shell strings) ────
export function statusArgs() {
  return ['status', '--porcelain=v1', '-b', '-z', '--untracked-files=all'];
}
export function logArgs(maxCount = 50, skip = 0) {
  const args = ['log', '--decorate', '--date=iso',
    '--pretty=format:%H%x1f%an%x1f%ad%x1f%s%x1f%b%x1e',
    '--max-count=' + Math.max(1, maxCount | 0)];
  if (skip > 0) args.push('--skip=' + (skip | 0));
  return args;
}
export function diffArgs({ staged = false, path = null } = {}) {
  const args = ['diff', '--no-color', '--unified=3'];
  if (staged) args.push('--cached');
  if (path) args.push('--', path);
  return args;
}
export function showArgs(sha) {
  return ['show', '--no-color', '--unified=3', '--stat', sha, '--'];
}
export function headSubjectArgs() {
  return ['log', '-1', '--pretty=format:%s%x1f%b'];
}
