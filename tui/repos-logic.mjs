// Pure business logic for repos — no global state, no I/O, fully testable.
// Imports from repos.mjs delegate here; tests import directly.

const STALE_DAYS = 180;

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
    const cutoff = Date.now() - STALE_DAYS * 86400000;
    out = out.filter(r => new Date(r.pushed_at || r.updated_at).getTime() < cutoff);
  }

  if (textFilter) {
    const q = textFilter.toLowerCase();
    out = out.filter(r =>
      (r.name||'').toLowerCase().includes(q) ||
      (r.description||'').toLowerCase().includes(q) ||
      (r.language||'').toLowerCase().includes(q)
    );
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
