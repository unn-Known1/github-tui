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
    const failures = buildFailureQueue([{ repo: 'a/r', runs: [
      { id: 1, conclusion: 'success' },
      { id: 2, conclusion: 'failure', updated_at: '2026-08-20T00:00:00Z' },
    ] }]);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].repo, 'a/r');
  });

  it('builds a deduplicated My Work queue across sources', () => {
    const queue = buildMyWorkQueue({
      notifications: [{ id: 'n1', unread: true, reason: 'review_requested', repository: { full_name: 'a/r' }, subject: { title: 'Review me' } }],
      pullRequests: [{ id: 1, title: 'Review me', base: { repo: { full_name: 'a/r' } } }],
      failures: [{ id: 2, repo: 'a/r', name: 'CI', conclusion: 'failure' }],
    });
    assert.equal(queue.length, 3);
    assert.equal(queue[0].repo, 'a/r');
  });

  it('groups notifications by thread and retains unread counts', () => {
    const groups = groupNotifications([
      { id: '1', unread: true, subject: { url: '/thread/1' }, updated_at: '2026-08-19' },
      { id: '2', unread: false, subject: { url: '/thread/1' }, updated_at: '2026-08-20' },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].count, 2);
    assert.equal(groups[0].unread, 1);
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
  });

  it('sanitizes token and cache fields from exports', () => {
    const safe = sanitizeExportState({ token: 'secret', cache: { private: true }, themeName: 'light' });
    assert.equal(safe.state.token, undefined);
    assert.equal(safe.state.cache, undefined);
    assert.equal(safe.state.themeName, 'light');
  });

  it('parses local git blame porcelain into line records', () => {
    const blame = parseBlamePorcelain('abc1234 1 1 1\nauthor Ada\nauthor-time 0\n\tfirst line\nabc1234 2 2 1\nauthor Ada\nauthor-time 0\n\tsecond line\n');
    assert.equal(blame.length, 2);
    assert.equal(blame[0].line, 1);
    assert.equal(blame[0].author, 'Ada');
    assert.equal(blame[1].text, 'second line');
  });

  it('validates plugin manifests and restricts capabilities', () => {
    assert.equal(validatePluginManifest({ id: 'health', entry: 'index.mjs', capabilities: ['render'] }).ok, true);
    assert.equal(validatePluginManifest({ id: '../bad', entry: 'index.mjs' }).ok, false);
    assert.equal(validatePluginManifest({ id: 'bad', entry: 'index.mjs', capabilities: ['exec'] }).ok, false);
  });
});
