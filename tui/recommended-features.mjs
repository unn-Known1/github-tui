// Pure helpers for the post-v0.7 feature set.
// No terminal, network, or global-state side effects: these functions are
// intentionally reusable from the TUI, CLI mode, and tests.

export const FEATURE_IDS = [
  'workflow-logs', 'workflow-dispatch', 'failure-queue', 'pr-review',
  'my-work', 'security-aggregate', 'compare', 'file-history', 'inbox-batching',
  'repo-health', 'focus-mode', 'custom-sections', 'config-portability',
  'cli-export', 'enterprise', 'profiles', 'organizations', 'release-actions',
  'syntax-highlighting', 'linear-accessibility', 'smart-assistance', 'plugins',
];

export const TOP_SYNTAX_LANGUAGES = [
  'javascript', 'typescript', 'python', 'go', 'rust',
  'java', 'csharp', 'cpp', 'ruby', 'shell',
];

const EXTENSIONS = new Map([
  ['js', 'javascript'], ['mjs', 'javascript'], ['cjs', 'javascript'],
  ['jsx', 'javascript'], ['ts', 'typescript'], ['tsx', 'typescript'],
  ['py', 'python'], ['go', 'go'], ['rs', 'rust'], ['java', 'java'],
  ['cs', 'csharp'], ['c', 'c'], ['h', 'c'], ['cc', 'cpp'], ['cpp', 'cpp'],
  ['hpp', 'cpp'], ['rb', 'ruby'], ['sh', 'shell'], ['bash', 'shell'],
  ['zsh', 'shell'], ['fish', 'shell'], ['json', 'json'], ['md', 'markdown'],
  ['mdx', 'markdown'], ['yaml', 'yaml'], ['yml', 'yaml'], ['toml', 'toml'],
  ['sql', 'sql'], ['css', 'css'], ['scss', 'css'], ['html', 'html'],
  ['xml', 'xml'],
]);

export function detectLanguage(path = '') {
  const name = String(path).split('/').pop().toLowerCase();
  if (name === 'dockerfile') return 'dockerfile';
  if (name === 'makefile') return 'makefile';
  if (name === '.env' || name.startsWith('.env.')) return 'env';
  if (name === '.gitignore') return 'gitignore';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? (EXTENSIONS.get(name.slice(dot + 1)) || 'text') : 'text';
}

// Return lightweight syntax spans. A renderer can map kinds to theme roles;
// keeping text untouched makes this safe for Unicode-aware terminal layout.
export function tokenizeLine(line = '', language = 'text') {
  const text = String(line);
  if (!text) return [];
  const spans = [];
  const push = (start, end, kind) => {
    if (end > start) spans.push({ text: text.slice(start, end), kind });
  };
  // Comment detection. `#`-style comments must start at column 0 or after
  // whitespace and be followed by whitespace/EOL to count: an unanchored
  // /#.*/ used to swallow `x = "# not a comment"` or `echo "issue #123"`.
  // Same idea for `--` (SQL) and `//` (must not eat `http://…` — the second
  // slash requires a preceding word boundary so URLs stay intact).
  const comment = language === 'python' || language === 'shell' || language === 'yaml'
    ? /(^|\s)#(\s|$).*/g
    : language === 'sql' ? /(^|\s)--(\s|$).*/g
    : /(^|\s)\/\/(\s|$).*/g;
  const comments = [];
  let match;
  while ((match = comment.exec(text))) {
    // Keep the whitespace that triggered the match out of the comment span.
    const start = match.index + (match[1] ? match[1].length : 0);
    comments.push([start, match.index + match[0].length]);
  }
  const isComment = (i) => comments.some(([a, b]) => i >= a && i < b);
  let cursor = 0;
  const re = /(['"`])(?:\\.|(?!\1).)*\1|\b\d+(?:\.\d+)?\b|\b(?:async|await|class|const|def|else|export|for|fn|from|function|if|import|impl|interface|let|new|package|pub|return|static|struct|throw|try|type|var|while|yield|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|DROP|JOIN|ORDER|GROUP|BY)\b/g;
  while ((match = re.exec(text))) {
    const start = match.index;
    if (isComment(start)) break;
    push(cursor, start, 'plain');
    const value = match[0];
    const kind = /^['"`]/.test(value) ? 'string' : /^\d/.test(value) ? 'number' : 'keyword';
    push(start, start + value.length, kind);
    cursor = start + value.length;
  }
  if (cursor < text.length) {
    const commentStart = comments.find(([a]) => a >= cursor)?.[0];
    if (commentStart != null) {
      push(cursor, commentStart, 'plain');
      push(commentStart, text.length, 'comment');
    } else push(cursor, text.length, 'plain');
  }
  return spans.length ? spans : [{ text, kind: comments.length ? 'comment' : 'plain' }];
}

export function validateWorkflowInputs(workflow, ref, inputs = {}) {
  const r = String(ref || '').trim();
  if (!r) return { ok: false, error: 'A branch or tag is required' };
  if (r.length > 255) return { ok: false, error: 'The ref is too long' };
  const declared = workflow?.inputs || workflow?.workflow_dispatch?.inputs || {};
  const declaredKeys = Object.keys(declared);
  for (const key of Object.keys(inputs || {})) {
    // "No inputs block declared" means NO inputs allowed — the old
    // `declaredKeys.length &&` guard let arbitrary leftover keys through
    // to the dispatch endpoint for workflows that simply omit the block.
    if (!declaredKeys.length || !Object.prototype.hasOwnProperty.call(declared, key)) {
      return { ok: false, error: 'Unknown workflow input: ' + key };
    }
    if (String(inputs[key]).length > 1000) return { ok: false, error: 'Input is too long: ' + key };
  }
  for (const [key, spec] of Object.entries(declared)) {
    if (spec?.required && !String(inputs?.[key] ?? '').trim()) {
      return { ok: false, error: 'Required input missing: ' + key };
    }
  }
  return { ok: true, ref: r, inputs: { ...inputs } };
}

export function buildFailureQueue(repoRuns = []) {
  const failures = [];
  for (const group of repoRuns || []) {
    const repo = group.repo || group.full_name || '';
    const runs = Array.isArray(group.runs) ? group.runs : [];
    for (const run of runs) {
      const conclusion = String(run.conclusion || '').toLowerCase();
      if (['failure', 'timed_out', 'startup_failure', 'action_required'].includes(conclusion)) {
        failures.push({ ...run, repo, failureKey: repo + '#' + String(run.id ?? run.run_number ?? '') });
      }
    }
  }
  return failures.sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
}

export function groupNotifications(notifications = []) {
  const groups = new Map();
  for (const note of notifications || []) {
    const key = String(note?.subject?.url || note?.id || note?.repository?.full_name || 'unknown');
    const group = groups.get(key) || {
      key, repository: note.repository, subject: note.subject,
      unread: 0, count: 0, latest: null, notifications: [],
    };
    group.count++;
    if (note.unread) group.unread++;
    if (!group.latest || String(note.updated_at || '') > String(group.latest.updated_at || '')) group.latest = note;
    group.notifications.push(note);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => String(b.latest?.updated_at || '').localeCompare(String(a.latest?.updated_at || '')));
}

export function calculateRepoHealth(metrics = {}) {
  const checks = [
    ['ci', metrics.ciSuccessRate, 0.25],
    ['freshness', metrics.lastPushDays == null ? null : Math.max(0, 1 - metrics.lastPushDays / 365), 0.2],
    ['issues', metrics.openIssues == null ? null : Math.max(0, 1 - Math.min(metrics.openIssues, 100) / 100), 0.15],
    ['security', metrics.openSecurityAlerts == null ? null : Math.max(0, 1 - Math.min(metrics.openSecurityAlerts, 20) / 20), 0.25],
    ['protection', metrics.branchProtection == null ? null : (metrics.branchProtection ? 1 : 0), 0.15],
  ];
  let score = 0, weight = 0;
  const components = {};
  for (const [name, value, w] of checks) {
    if (value == null || Number.isNaN(Number(value))) { components[name] = null; continue; }
    const normalized = Math.max(0, Math.min(1, Number(value)));
    components[name] = Math.round(normalized * 100);
    score += normalized * w;
    weight += w;
  }
  return { score: weight ? Math.round((score / weight) * 100) : null, components, complete: weight === 1 };
}

export function normalizeEnterpriseHost(value, fallback = 'api.github.com') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const url = raw.includes('://') ? raw : 'https://' + raw;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.hostname + (parsed.port ? ':' + parsed.port : '');
  } catch { return null; }
}

const SENSITIVE_KEY_RE = /token|passwd|password|secret|api[_-]?key/i;
const SCRUB_EXACT_RE = /^(cache|etagcache)$/i;

function scrubSensitiveKeys(node, seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) scrubSensitiveKeys(item, seen);
    return;
  }
  for (const key of Object.keys(node)) {
    if (SENSITIVE_KEY_RE.test(key) || SCRUB_EXACT_RE.test(key)) delete node[key];
    else scrubSensitiveKeys(node[key], seen);
  }
}

export function sanitizeExportState(state = {}) {
  const copy = JSON.parse(JSON.stringify(state));
  scrubSensitiveKeys(copy);
  return { schemaVersion: 1, exportedAt: new Date().toISOString(), state: copy };
}

export function buildSmartInsight(repo = {}, metrics = {}) {
  const findings = [];
  if ((metrics.openIssues || repo.open_issues_count || 0) > 50) findings.push('Issue backlog is large; consider triage or milestones.');
  if ((metrics.lastPushDays ?? 0) > 180) findings.push('Repository has not been pushed recently.');
  if ((metrics.ciSuccessRate ?? 1) < 0.8) findings.push('Recent CI success rate is below 80%.');
  if ((metrics.openSecurityAlerts || 0) > 0) findings.push('Open security alerts need review.');
  if (!repo.license) findings.push('No license is advertised in repository metadata.');
  return { kind: 'rule-based', advisory: true, generatedAt: new Date().toISOString(), findings };
}

export function parseBlamePorcelain(output = '') {
  const lines = String(output).split(/\r?\n/);
  const result = [];
  let current = null;
  for (const line of lines) {
    const header = line.match(/^([0-9a-f]{7,40})\s+\d+\s+(\d+)\s+\d+$/i);
    if (header) {
      if (current) result.push(current);
      current = { sha: header[1], line: Number(header[2]), author: '?', date: null, text: '' };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('author ')) current.author = line.slice(7);
    else if (line.startsWith('author-time ')) {
      const seconds = Number(line.slice(12).trim());
      if (Number.isFinite(seconds)) current.date = new Date(seconds * 1000).toISOString();
    }
    else if (line.charCodeAt(0) === 9) current.text = line.slice(1);
  }
  if (current) result.push(current);
  return result;
}

// Recipe R4 (minimal): items updated since the last session timestamp.
// Pure: callers pass arrays + lastSeenMs, get human-readable lines back.
export function sinceLastVisit({ notifications = [], issues = [], prs = [], failures = [], lastSeenMs = 0 } = {}) {
  const out = [];
  const isNew = (ts) => { const t = Date.parse(ts || ''); return Number.isFinite(t) && t > lastSeenMs; };
  for (const n of (notifications || []).slice(0, 20)) {
    if (n && n.unread && isNew(n.updated_at || n.last_read_at)) out.push('Unread: ' + (n.repository?.full_name || '?') + ' — ' + (n.subject?.title || ''));
  }
  for (const i of (issues || []).slice(0, 10)) {
    if (i && isNew(i.updated_at)) out.push('Issue: ' + (i.repository_url?.split('/').slice(-2).join('/') || i.url || '?') + ' #' + (i.number || '?'));
  }
  for (const pr of (prs || []).slice(0, 10)) {
    if (pr && isNew(pr.updated_at)) out.push('PR updated: ' + (pr.title || pr.number || '?'));
  }
  for (const f of (failures || []).slice(0, 10)) {
    if (f && isNew(f.created_at || f.updated_at)) out.push('CI failure: ' + (f.repository || f.repo || '?') + ' #' + (f.run_number || f.id || '?'));
  }
  return out;
}

export function validatePluginManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return { ok: false, error: 'Manifest must be an object' };
  if (typeof manifest.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(manifest.id)) return { ok: false, error: 'Invalid plugin id' };
  // Entry must be a relative local path: reject traversal AND absolute
  // paths (e.g. '/etc/passwd') and Windows-style separators, so a manifest
  // can never point the loader outside the plugin directory.
  if (typeof manifest.entry !== 'string' || manifest.entry.includes('..') || manifest.entry.startsWith('/') || manifest.entry.includes('\\')) {
    return { ok: false, error: 'Plugin entry must be a local path' };
  }
  if (manifest.capabilities && (!Array.isArray(manifest.capabilities) || manifest.capabilities.some(c => !['read-api', 'render'].includes(c)))) {
    return { ok: false, error: 'Unsupported plugin capability' };
  }
  return { ok: true, manifest: { ...manifest, capabilities: manifest.capabilities || [] } };
}
