// Tests for GitHubApiError structured error and custom-keys shellEscape logic.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubApiError } from '../tui/github.mjs';
import { shellEscape } from '../tui/custom-keys.mjs';

describe('GitHubApiError', () => {
  it('is an instance of Error', () => {
    const e = new GitHubApiError('test', 404, '/repos/foo/bar');
    assert.ok(e instanceof Error);
    assert.ok(e instanceof GitHubApiError);
  });

  it('has correct name', () => {
    const e = new GitHubApiError('msg', 422, '/repos');
    assert.equal(e.name, 'GitHubApiError');
  });

  it('carries status code', () => {
    const e = new GitHubApiError('Not found', 404, '/repos/foo/bar');
    assert.equal(e.status, 404);
  });

  it('carries endpoint', () => {
    const e = new GitHubApiError('Not found', 404, '/repos/foo/bar');
    assert.equal(e.endpoint, '/repos/foo/bar');
  });

  it('message is accessible', () => {
    const e = new GitHubApiError('GitHub API error 404: Not Found', 404, '/x');
    assert.ok(e.message.includes('404'));
  });

  it('defaults status to 0 and endpoint to empty string', () => {
    const e = new GitHubApiError('oops');
    assert.equal(e.status, 0);
    assert.equal(e.endpoint, '');
  });

  it('preserves stack and name for diagnostics and IPC', () => {
    const e = new GitHubApiError('boom', 404, '/x');
    assert.equal(e.name, 'GitHubApiError');
    assert.equal(e.constructor.name, 'GitHubApiError');
    assert.ok(typeof e.stack === 'string' && e.stack.includes('GitHubApiError'));
  });
});

// ── Shell-escape logic — imported from custom-keys.mjs so these tests
// guard the LIVE implementation, not a copy that silently drifts.

describe('shellEscape (custom-keys placeholder safety)', () => {
  it('wraps simple value in single quotes', () => {
    assert.equal(shellEscape('hello'), "'hello'");
  });

  it('escapes embedded single quotes', () => {
    assert.equal(shellEscape("it's"), "'it'\\''s'");
  });

  it('wraps values containing shell metacharacters so they are treated as literals', () => {
    // Wraps a payload containing ';' so POSIX sh treats it as a literal,
    // not a command separator. Single-quote wrapping neutralizes ALL
    // metacharacters; name the test after the mechanism, not one case.
    const result = shellEscape('foo; rm -rf ~');
    assert.equal(result, "'foo; rm -rf ~'");
    // Confirms backticks and $() are also neutralized (same wrapping).
    const result2 = shellEscape('foo`whoami`');
    assert.equal(result2, "'foo`whoami`'");
    // Newlines would break the prompt line; wrapping keeps them literal.
    const result3 = shellEscape('a\nb');
    assert.equal(result3, "'a\nb'");
    // $() substitution is prevented by wrapping.
    const result4 = shellEscape('a$(id)b');
    assert.equal(result4, "'a$(id)b'");
  });

  it('returns empty string literal for null', () => {
    assert.equal(shellEscape(null), "''");
  });

  it('returns empty string literal for empty string', () => {
    assert.equal(shellEscape(''), "''");
  });

  it('handles repo names with hyphens and dots', () => {
    assert.equal(shellEscape('my-repo.js'), "'my-repo.js'");
  });
});
