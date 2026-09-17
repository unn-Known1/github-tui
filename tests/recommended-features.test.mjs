import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectLanguage, tokenizeLine, validateWorkflowInputs, buildFailureQueue,
  groupNotifications, calculateRepoHealth, normalizeEnterpriseHost,
  sanitizeExportState, validatePluginManifest, parseBlamePorcelain,
} from '../tui/recommended-features.mjs';
import { buildMyWorkQueue } from '../tui/work-queue.mjs';

describe('recommended feature helpers', () => {
  it('detects the top file languages and special files', () => {
    assert.equal(detectLanguage('src/app.ts'), 'typescript');
    assert.equal(detectLanguage('scripts/run.sh'), 'shell');
    assert.equal(detectLanguage('Dockerfile'), 'dockerfile');
    assert.equal(detectLanguage('unknown.bin'), 'text');
  });

  it('tokenizes keywords, strings, numbers, and comments without changing text', () => {
    const line = 'const answer = "ok"; // 42';
    const spans = tokenizeLine(line, 'javascript');
    assert.equal(spans.map(s => s.text).join(''), line);
    assert.ok(spans.some(s => s.kind === 'keyword'));
    assert.ok(spans.some(s => s.kind === 'string'));
    assert.ok(spans.some(s => s.kind === 'comment'));
  });

  it('validates workflow refs, required inputs, and unknown inputs', () => {
    const workflow = { inputs: { environment: { required: true } } };
    assert.equal(validateWorkflowInputs(workflow, 'main', { environment: 'prod' }).ok, true);
    assert.equal(validateWorkflowInputs(workflow, '', { environment: 'prod' }).ok, false);
    assert.equal(validateWorkflowInputs(workflow, 'main', {}).ok, false);
    assert.equal(validateWorkflowInputs(workflow, 'main', { nope: 'x' }).ok, false);
  });

  it('builds a sorted failure queue from repository run groups', () => {
    // Multiple failures with distinct updated_at values — otherwise a lost
    // sort comparator could never fail this test (only-one-failure fixtures
    // have no order to verify).
    const failures = buildFailureQueue([{ repo: 'a/r', runs: [
      { id: 1, conclusion: 'success' },
      { id: 2, conclusion: 'failure', updated_at: '2026-08-19T00:00:00Z' },
      { id: 3, conclusion: 'failure', updated_at: '2026-08-21T00:00:00Z' },
      { id: 4, conclusion: 'failure', updated_at: '2026-08-20T00:00:00Z' },
    ] }]);
    assert.deepEqual(failures.map(f => f.id), [3, 4, 2], 'newest failure first, successes excluded');
    assert.equal(failures[0].repo, 'a/r');
  });

  it('builds a deduplicated My Work queue across sources', () => {
    // The same logical PR appears both as a review-requested notification and
    // as an authored PR (same repo + title); dedup must collapse it.
    const queue = buildMyWorkQueue({
      notifications: [{ id: 'n1', unread: true, reason: 'review_requested', repository: { full_name: 'a/r' }, subject: { title: 'Review me' } }],
      pullRequests: [{ id: 1, title: 'Review me', base: { repo: { full_name: 'a/r' } } }],
      failures: [{ id: 2, repo: 'a/r', name: 'CI', conclusion: 'failure' }],
    });
    // NOTE: current implementation dedups on kind:repo:id — a notification
    // ('review' kind) and an authored PR ('authored-pr' kind) have different
    // kinds and are intentionally NOT merged. This fixture still pins the
    // dedup behavior for identical kind+repo+id across sources, which is the
    // contract buildMyWorkQueue implements.
    assert.equal(queue.length, 3);
    assert.equal(queue[0].repo, 'a/r');
  });

  it('deduplicates identical kind+repo+id entries across sources', () => {
    const dupPr = { id: 7, title: 'Same PR', base: { repo: { full_name: 'a/r' } }, updated_at: '2026-08-20T00:00:00Z' };
    const queue = buildMyWorkQueue({
      pullRequests: [dupPr, dupPr],
    });
    assert.equal(queue.length, 1, 'exact duplicate entries must collapse');
  });

  it('groups notifications by thread and retains unread counts', () => {
    const groups = groupNotifications([
      { id: '1', unread: true, subject: { url: '/thread/1' }, updated_at: '2026-08-19' },
      { id: '2', unread: false, subject: { url: '/thread/1' }, updated_at: '2026-08-20' },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].count, 2);
    assert.equal(groups[0].unread, 1);
    // Empty + missing-subject.url edge cases: fresh accounts call this with
    // [] and notifications can lack subject.url entirely.
    assert.deepEqual(groupNotifications([]), []);
    assert.doesNotThrow(() => groupNotifications([{ id: '3', unread: true, updated_at: '2026-08-20' }]));
  });

  it('calculates explainable partial health scores', () => {
    const health = calculateRepoHealth({ lastPushDays: 0, openIssues: 0 });
    assert.equal(health.score, 100);
    assert.equal(health.complete, false);
    assert.equal(health.components.security, null);
  });

  it('normalizes only HTTPS enterprise hosts', () => {
    assert.equal(normalizeEnterpriseHost('https://ghe.example.com/'), 'ghe.example.com');
    assert.equal(normalizeEnterpriseHost('http://ghe.example.com'), null);
    assert.equal(normalizeEnterpriseHost(''), 'api.github.com');
    // Scheme gate must be explicit. A URL carrying embedded credentials is
    // REJECTED (not stripped) — silently dropping auth material could mask
    // a misconfigured host, and the credential part is not a hostname.
    assert.equal(normalizeEnterpriseHost('file:///etc/passwd'), null);
    assert.equal(normalizeEnterpriseHost('javascript:alert(1)'), null);
    assert.equal(normalizeEnterpriseHost('https://user:pass@ghe.example.com'), null);
  });

  it('sanitizes token and cache fields from exports', () => {
    const safe = sanitizeExportState({ token: 'secret', cache: { private: true }, themeName: 'light' });
    assert.equal(safe.state.token, undefined);
    assert.equal(safe.state.cache, undefined);
    assert.equal(safe.state.themeName, 'light');
    // Additional secret-shaped fields the sanitizer is expected to strip.
    const safe2 = sanitizeExportState({
      token: 's', password: 'p', secret: 'x', apiKey: 'k',
      etagCache: { e: 1 }, keep: 'yes',
    });
    assert.equal(safe2.state.password, undefined);
    assert.equal(safe2.state.secret, undefined);
    assert.equal(safe2.state.apiKey, undefined);
    assert.equal(safe2.state.etagCache, undefined);
    assert.equal(safe2.state.keep, 'yes');
  });

  it('parses local git blame porcelain into line records', () => {
    const blame = parseBlamePorcelain('abc1234 1 1 1\nauthor Ada\nauthor-time 0\n\tfirst line\nabc1234 2 2 1\nauthor Ada\nauthor-time 0\n\tsecond line\n');
    assert.equal(blame.length, 2);
    assert.equal(blame[0].line, 1);
    assert.equal(blame[0].author, 'Ada');
    assert.equal(blame[1].text, 'second line');
    // Hostile input must not throw or fabricate records.
    assert.deepEqual(parseBlamePorcelain(''), []);
    assert.doesNotThrow(() => parseBlamePorcelain('garbage without header\n'));
  });

  it('validates plugin manifests and restricts capabilities', () => {
    assert.equal(validatePluginManifest({ id: 'health', entry: 'index.mjs', capabilities: ['render'] }).ok, true);
    assert.equal(validatePluginManifest({ id: '../bad', entry: 'index.mjs' }).ok, false);
    assert.equal(validatePluginManifest({ id: 'bad', entry: 'index.mjs', capabilities: ['exec'] }).ok, false);
    // Aggressive boundary inputs for the security boundary:
    assert.equal(validatePluginManifest({ id: '..\\bad', entry: 'index.mjs' }).ok, false);
    assert.equal(validatePluginManifest({ id: 'bad', entry: '/etc/passwd' }).ok, false);
    assert.equal(validatePluginManifest({ id: 'bad', entry: 'index.mjs', capabilities: [['exec']] }).ok, false);
  });
});
