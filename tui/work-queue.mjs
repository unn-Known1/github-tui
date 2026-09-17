// Pure cross-surface queue builder for the My Work/focus workflow.

export function buildMyWorkQueue({ notifications = [], pullRequests = [], issues = [], failures = [] } = {}) {
  // Guard each channel: callers pass API results straight through and a
  // single null channel (or a null arg entirely) threw `for...of null`.
  const notes = Array.isArray(notifications) ? notifications : [];
  const prs = Array.isArray(pullRequests) ? pullRequests : [];
  const iss = Array.isArray(issues) ? issues : [];
  const runs = Array.isArray(failures) ? failures : [];
  const items = [];
  for (const n of notes) {
    if (!n) continue;
    if (n.unread || n.reason === 'review_requested' || n.reason === 'mention') {
      // NOTE: no last_read_at fallback — last_read_at reflects the user's
      // reading behavior, not item activity; sorting by it would float a
      // just-glanced-at read mention above genuinely fresh activity.
      items.push({ kind: n.reason === 'review_requested' ? 'review' : 'inbox', id: n.id, title: n.subject?.title || 'Notification', repo: n.repository?.full_name || '', updated_at: n.updated_at || '', source: n });
    }
  }
  for (const pr of prs) { if (pr) items.push({ kind: 'authored-pr', id: pr.id || pr.number, title: pr.title || 'Pull request', repo: pr.base?.repo?.full_name || pr.repository?.full_name || '', updated_at: pr.updated_at, source: pr }); }
  for (const issue of iss) { if (issue) items.push({ kind: 'issue', id: issue.id || issue.number, title: issue.title || 'Issue', repo: issue.repository?.full_name || '', updated_at: issue.updated_at, source: issue }); }
  for (const run of runs) { if (run) items.push({ kind: 'ci', id: run.failureKey || run.id, title: run.name || 'Failed workflow', repo: run.repo || '', updated_at: run.updated_at || run.created_at, source: run }); }
  const seen = new Set();
  return items.filter(item => {
    const key = item.kind + ':' + item.repo + ':' + item.id;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => {
    const byDate = String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    if (byDate !== 0) return byDate;
    // Deterministic tie-breaker: items without updated_at all collapsed to
    // '' and flickered at the bottom of the queue whenever input ordering
    // varied between reloads.
    const ka = a.kind + ':' + a.repo + ':' + a.id;
    const kb = b.kind + ':' + b.repo + ':' + b.id;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}
