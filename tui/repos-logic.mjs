// Pure business logic for repos — no global state, no I/O, fully testable.
// Imports from repos.mjs delegate here; tests import directly.

// Single source of truth for "stale repo" cutoff. Used by both the Repos tab
// (filter) and the Dashboard stale-count tile so the two never disagree.
export const STALE_DAYS = 90;
const _STALE_DAYS = STALE_DAYS;  // back-compat alias if anyone imported the old name

export function sortRepos(repos, sort) {
  const sorted = [...repos];
  sorted.sort((a, b) => {
    let va, vb;
    switch (sort.field) {
      case 'name':    va = (a.name||'').toLowerCase(); vb = (b.name||'').toLowerCase(); break;
      case 'stars':   va = a.stargazers_count || 0; vb = b.stargazers_count || 0; break;
      case 'forks':   va = a.forks_count || 0; vb = b.forks_count || 0; break;
      case 'issues':  va = a.open_issues_count || 0; vb = b.open_issues_count || 0; break;
      case 'updated': va = new Date(a.updated_at).getTime(); vb = new Date(b.updated_at).getTime(); break;
      default: va = 0; vb = 0;
    }
    if (va < vb) return sort.asc ? -1 : 1;
    if (va > vb) return sort.asc ? 1 : -1;
    return 0;
  });
  return sorted;
}

export function parseRepoQuery(q) {
  const out = { text: '', stars: null, forks: null, issues: null, lang: null };
  if (q == null) return out;
  const s = String(q);
  if (!s.trim()) return out;
  const tokens = s.split(/\s+/).filter(t => t.length > 0);
  const rest = [];
  for (const tok of tokens) {
    let m = tok.match(/^(stars|forks|issues):(>=?|<=?|=)?(\d+)$/i);
    if (m) {
      const key = m[1].toLowerCase();
      const op = m[2] || '>=';
      const n = Number(m[3]);
      const val = { op, n };
      if (key === 'stars') out.stars = val;
      else if (key === 'forks') out.forks = val;
      else if (key === 'issues') out.issues = val;
      continue;
    }
    m = tok.match(/^lang(?:uage)?:(.+)$/i);
    if (m) {
      out.lang = m[1];
      continue;
    }
    rest.push(tok);
  }
  out.text = rest.join(' ');
  return out;
}

function _cmpCount(v, op, n) {
  switch (op) {
    case '>': return v > n;
    case '>=': return v >= n;
    case '<': return v < n;
    case '<=': return v <= n;
    case '=': return v === n;
    default: return v >= n;
  }
}

export function applyAllFilters(repos, filters) {
  let out = [...repos];
  const { typeFilter, langFilter, staleOnly, textFilter } = filters;

  switch (typeFilter) {
    case 'sources':   out = out.filter(r => !r.fork); break;
    case 'forks':     out = out.filter(r => r.fork); break;
    case 'archived':  out = out.filter(r => r.archived); break;
    case 'private':   out = out.filter(r => r.private); break;
    case 'public':    out = out.filter(r => !r.private); break;
    case 'templates': out = out.filter(r => r.is_template); break;
  }

  if (langFilter) {
    out = out.filter(r => (r.language || '') === langFilter);
  }

  if (staleOnly) {
    const cutoff = Date.now() - _STALE_DAYS * 86400000;
    out = out.filter(r => new Date(r.pushed_at || r.updated_at).getTime() < cutoff);
  }

  if (textFilter) {
    const parsed = parseRepoQuery(textFilter);
    const hasQualifiers = !!(parsed.stars || parsed.forks || parsed.issues || parsed.lang);
    if (!hasQualifiers) {
      const q = textFilter.toLowerCase();
      out = out.filter(r =>
        (r.name||'').toLowerCase().includes(q) ||
        (r.description||'').toLowerCase().includes(q) ||
        (r.language||'').toLowerCase().includes(q)
      );
    } else {
      if (parsed.stars) out = out.filter(r => _cmpCount(r.stargazers_count || 0, parsed.stars.op, parsed.stars.n));
      if (parsed.forks) out = out.filter(r => _cmpCount(r.forks_count || 0, parsed.forks.op, parsed.forks.n));
      if (parsed.issues) out = out.filter(r => _cmpCount(r.open_issues_count || 0, parsed.issues.op, parsed.issues.n));
      if (parsed.lang) out = out.filter(r => (r.language || '') === parsed.lang);
      if (parsed.text) {
        const q = parsed.text.toLowerCase();
        out = out.filter(r =>
          (r.name||'').toLowerCase().includes(q) ||
          (r.description||'').toLowerCase().includes(q) ||
          (r.language||'').toLowerCase().includes(q)
        );
      }
    }
  }

  return out;
}

export function floatPinsToTop(repos, pins) {
  if (!pins || pins.length === 0) return repos;
  const pinSet = new Set(pins);
  const pinned = [];
  const rest = [];
  for (const r of repos) (pinSet.has(r.full_name) ? pinned : rest).push(r);
  pinned.sort((a, b) => pins.indexOf(a.full_name) - pins.indexOf(b.full_name));
  return [...pinned, ...rest];
}
