// Tests for GitHubApiError structured error and custom-keys shellEscape logic.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubApiError } from '../tui/github.mjs';

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
});

// ── Shell-escape logic (mirrors custom-keys.mjs) ──

function shellEscape(value) {
  if (!value) return "''";
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

describe('shellEscape (custom-keys placeholder safety)', () => {
  it('wraps simple value in single quotes', () => {
    assert.equal(shellEscape('hello'), "'hello'");
  });

  it('escapes embedded single quotes', () => {
    assert.equal(shellEscape("it's"), "'it'\\''s'");
  });

  it('escapes semicolons (prevents command injection)', () => {
    // The semicolon itself is safe inside single quotes in POSIX sh
    const result = shellEscape('foo; rm -rf ~');
    assert.equal(result, "'foo; rm -rf ~'");
    // The shell will treat this as the literal string "foo; rm -rf ~"
  });

  it('escapes backticks', () => {
    const result = shellEscape('foo`whoami`');
    assert.equal(result, "'foo`whoami`'");
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
