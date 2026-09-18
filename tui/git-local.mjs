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

// ─── Numstat (per-file +added/-deleted for status rows) ─────
// Input: raw stdout of `git diff --numstat --no-renames -z [--cached]`.
// With `-z` every record is exactly `<add>\t<del>\t<path>\0` — no quoting
// games for spaces/unicode, and `--no-renames` keeps renames as plain
// delete(old)+add(new) rows so there are never two-record pairs to stitch.
// Binary files report `-` for both counts.
// Output: { [path]: { add, del, binary } }.
export function parseNumstatZ(input) {
  const out = {};
  const text = typeof input === 'string' ? input : String(input || '');
  if (!text) return out;
  // NUL written via fromCharCode so the byte survives verbatim.
  const NUL = String.fromCharCode(0);
  for (const rec of text.split(NUL)) {
    if (!rec) continue;
    // Path itself may contain literal tabs (raw under -z): the counts are
    // always the first two tab-fields, the rest re-joined is the path.
    const parts = rec.split('\t');
    if (parts.length < 3) continue;
    const [a, d, ...rest] = parts;
    const path = rest.join('\t');
    if (!path) continue;
    const binary = a === '-' || d === '-';
    out[path] = {
      add: binary ? 0 : parseInt(a, 10) || 0,
      del: binary ? 0 : parseInt(d, 10) || 0,
      binary,
    };
  }
  return out;
}

// ─── Diff file sections (navigable commit/file diffs) ──────
// Input: full text of `git show` / `git diff` output (or any preview text).
// Splits on `diff --git ` boundaries into per-file sections with add/del
// counts; everything before the first boundary (commit meta + stat block)
// becomes `summary`. Text without any boundary (untracked file content,
// binary placeholders) becomes a single pseudo-file so navigation code
// stays uniform.
// Output: { summary: [line], files: [{ path, lines: [line], add, del, binary }] }
export function parseDiffFiles(text) {
  const lines = String(text || '').split(/\r?\n/);
  const summary = [];
  const files = [];
  let cur = null;
  const push = () => {
    if (!cur) return;
    let add = 0, del = 0, binary = false;
    let plus = null, minus = null;
    for (const ln of cur.lines) {
      if (ln.startsWith('+') && !ln.startsWith('+++')) add++;
      else if (ln.startsWith('-') && !ln.startsWith('---')) del++;
      else if (ln.startsWith('Binary files ')) binary = true;
      else if (ln.startsWith('+++ ')) plus = ln.slice(4).trim();
      else if (ln.startsWith('--- ')) minus = ln.slice(4).trim();
    }
    cur.add = binary ? 0 : add;
    cur.del = binary ? 0 : del;
    cur.binary = binary;
    cur.path = pickDiffPath(cur.gitLine, plus, minus);
    files.push(cur);
    cur = null;
  };
  for (const ln of lines) {
    if (ln.startsWith('diff --git ')) {
      push();
      cur = { gitLine: ln, lines: [ln], path: '', add: 0, del: 0, binary: false };
      continue;
    }
    if (!cur) { summary.push(ln); continue; }
    cur.lines.push(ln);
  }
  push();
  if (files.length === 0) {
    // No diff markers at all — one pseudo-file over the whole text.
    return { summary: [], files: [{ path: '(content)', lines, add: 0, del: 0, binary: false }] };
  }
  return { summary, files };
}

// Resolve a display path: prefer the `+++` side, fall back to `---` for
// deletions (`+++ /dev/null`), then the `diff --git` line. Strips the
// `a/`/`b/` prefixes and surrounding quotes (core.quotePath); octal-escaped
// unicode is left raw (display quirk, never a crash).
function pickDiffPath(gitLine, plus, minus) {
  const clean = (p) => {
    let s = String(p || '').trim();
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
    if ((s.startsWith('a/') || s.startsWith('b/')) && s !== '/dev/null') s = s.slice(2);
    return s;
  };
  if (plus && plus !== '/dev/null') return clean(plus);
  if (minus && minus !== '/dev/null') return clean(minus);
  const gl = String(gitLine || '');
  const m = gl.match(/^diff --git "(.*)" "(.*)"\s*$/) || gl.match(/^diff --git (\S+) (\S+)\s*$/);
  if (m) {
    const b = clean(m[2]);
    if (b && b !== '/dev/null') return b;
    return clean(m[1]) || '(unknown)';
  }
  return '(unknown)';
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
// Per-file line stats for the status column. `--no-renames` keeps output
// to single-record rows (see parseNumstatZ); `-z` keeps odd paths raw.
export function numstatArgs(staged = false) {
  const args = ['diff', '--no-color', '--numstat', '--no-renames', '-z'];
  if (staged) args.push('--cached');
  return args;
}
export function showArgs(sha) {
  return ['show', '--no-color', '--unified=3', '--stat', sha, '--'];
}
export function headSubjectArgs() {
  return ['log', '-1', '--pretty=format:%s%x1f%b'];
}
