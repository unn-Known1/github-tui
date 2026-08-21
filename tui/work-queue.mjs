// Pure cross-surface queue builder for the My Work/focus workflow.

export function buildMyWorkQueue({ notifications = [], pullRequests = [], issues = [], failures = [] } = {}) {
  const items = [];
  for (const n of notifications) {
    if (n.unread || n.reason === 'review_requested' || n.reason === 'mention') {
      items.push({ kind: n.reason === 'review_requested' ? 'review' : 'inbox', id: n.id, title: n.subject?.title || 'Notification', repo: n.repository?.full_name || '', updated_at: n.updated_at || n.last_read_at, source: n });
    }
  }
  for (const pr of pullRequests) items.push({ kind: 'authored-pr', id: pr.id || pr.number, title: pr.title || 'Pull request', repo: pr.base?.repo?.full_name || pr.repository?.full_name || '', updated_at: pr.updated_at, source: pr });
  for (const issue of issues) items.push({ kind: 'issue', id: issue.id || issue.number, title: issue.title || 'Issue', repo: issue.repository?.full_name || '', updated_at: issue.updated_at, source: issue });
  for (const run of failures) items.push({ kind: 'ci', id: run.failureKey || run.id, title: run.name || 'Failed workflow', repo: run.repo || '', updated_at: run.updated_at || run.created_at, source: run });
  const seen = new Set();
  return items.filter(item => {
    const key = item.kind + ':' + item.repo + ':' + item.id;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}
