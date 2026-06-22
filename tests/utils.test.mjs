import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  relTime, clamp, truncate, padRight, shortNum, formatBytes,
  greeting, eventGlyph, notifTypeColor, notificationToHtmlUrl,
  safeCwdJoin, ghCloneUrl,
} from '../tui/utils.mjs';

describe('relTime', () => {
  it('returns empty string for falsy input', () => {
    assert.equal(relTime(null), '');
    assert.equal(relTime(''), '');
    assert.equal(relTime(undefined), '');
  });

  it('returns seconds for < 1 min', () => {
    const now = new Date().toISOString();
    assert.match(relTime(now), /^\d+s$/);
  });

  it('returns minutes for < 1 hour', () => {
    const d = new Date(Date.now() - 5 * 60000).toISOString();
    assert.equal(relTime(d), '5m');
  });

  it('returns hours for < 1 day', () => {
    const d = new Date(Date.now() - 3 * 3600000).toISOString();
    assert.equal(relTime(d), '3h');
  });

  it('returns days for < 30 days', () => {
    const d = new Date(Date.now() - 7 * 86400000).toISOString();
    assert.equal(relTime(d), '7d');
  });

  it('returns months for < 365 days', () => {
    const d = new Date(Date.now() - 60 * 86400000).toISOString();
    assert.equal(relTime(d), '2mo');
  });

  it('returns years for >= 365 days', () => {
    const d = new Date(Date.now() - 400 * 86400000).toISOString();
    assert.equal(relTime(d), '1y');
  });
});

describe('clamp', () => {
  it('clamps below minimum', () => assert.equal(clamp(-5, 0, 10), 0));
  it('clamps above maximum', () => assert.equal(clamp(15, 0, 10), 10));
  it('passes through in range', () => assert.equal(clamp(5, 0, 10), 5));
  it('handles boundary values', () => {
    assert.equal(clamp(0, 0, 10), 0);
    assert.equal(clamp(10, 0, 10), 10);
  });
});

describe('truncate', () => {
  it('returns empty string for null', () => assert.equal(truncate(null, 5), ''));
  it('returns empty string for undefined', () => assert.equal(truncate(undefined, 5), ''));
  it('returns short strings unchanged', () => assert.equal(truncate('hi', 5), 'hi'));
  it('truncates with ellipsis', () => assert.equal(truncate('hello world', 8), 'hello w…'));
  it('handles exact length', () => assert.equal(truncate('hello', 5), 'hello'));
  it('handles n=1', () => assert.equal(truncate('hello', 1), '…'));
});

describe('padRight', () => {
  it('pads short strings', () => assert.equal(padRight('hi', 5), 'hi   '));
  it('returns long strings unchanged', () => assert.equal(padRight('hello', 3), 'hello'));
  it('handles null', () => assert.equal(padRight(null, 3), '   '));
  it('handles undefined', () => assert.equal(padRight(undefined, 3), '   '));
});

describe('shortNum', () => {
  it('returns 0 for null', () => assert.equal(shortNum(null), '0'));
  it('returns raw number < 1000', () => assert.equal(shortNum(42), '42'));
  it('formats thousands with one decimal', () => assert.equal(shortNum(1234), '1.2k'));
  it('formats large thousands without decimal', () => assert.equal(shortNum(12345), '12k'));
  it('formats millions', () => assert.equal(shortNum(1500000), '1.5M'));
  it('formats large millions', () => assert.equal(shortNum(15000000), '15M'));
});

describe('formatBytes', () => {
  it('returns ? for null', () => assert.equal(formatBytes(null), '?'));
  it('formats bytes', () => assert.equal(formatBytes(500), '500 B'));
  it('formats KB', () => assert.equal(formatBytes(1536), '1.5 KB'));
  it('formats MB', () => assert.equal(formatBytes(1048576), '1.0 MB'));
  it('formats GB', () => assert.equal(formatBytes(1073741824), '1.00 GB'));
});

describe('greeting', () => {
  it('returns Good night for 2am', () => {
    const d = new Date(); d.setHours(2, 0, 0, 0);
    assert.equal(greeting(d), 'Good night');
  });
  it('returns Good morning for 8am', () => {
    const d = new Date(); d.setHours(8, 0, 0, 0);
    assert.equal(greeting(d), 'Good morning');
  });
  it('returns Good afternoon for 14:00', () => {
    const d = new Date(); d.setHours(14, 0, 0, 0);
    assert.equal(greeting(d), 'Good afternoon');
  });
  it('returns Good evening for 20:00', () => {
    const d = new Date(); d.setHours(20, 0, 0, 0);
    assert.equal(greeting(d), 'Good evening');
  });
});

describe('eventGlyph', () => {
  it('maps PushEvent', () => {
    const [icon, color, label] = eventGlyph('PushEvent');
    assert.equal(icon, '↑');
    assert.equal(color, 'green');
    assert.equal(label, 'pushed');
  });
  it('maps PullRequestEvent', () => {
    const [, color] = eventGlyph('PullRequestEvent');
    assert.equal(color, 'cyan');
  });
  it('handles unknown event', () => {
    const [icon, color, label] = eventGlyph('UnknownEvent');
    assert.equal(icon, '•');
    assert.equal(color, 'dim');
    assert.equal(label, 'Unknown');
  });
  it('handles null type', () => {
    const [, , label] = eventGlyph(null);
    assert.equal(label, '?');
  });
});

describe('notifTypeColor', () => {
  it('returns cyan for PullRequest', () => assert.equal(notifTypeColor('PullRequest'), 'cyan'));
  it('returns yellow for Issue', () => assert.equal(notifTypeColor('Issue'), 'yellow'));
  it('returns green for Release', () => assert.equal(notifTypeColor('Release'), 'green'));
  it('returns dim for unknown', () => assert.equal(notifTypeColor('Unknown'), 'dim'));
});

describe('notificationToHtmlUrl', () => {
  it('returns null for falsy', () => assert.equal(notificationToHtmlUrl(null), null));
  it('converts api.github.com/repos to github.com', () => {
    const result = notificationToHtmlUrl('https://api.github.com/repos/owner/repo/issues/1');
    assert.equal(result, 'https://github.com/owner/repo/issues/1');
  });
  it('converts /pulls/ to /pull/', () => {
    const result = notificationToHtmlUrl('https://api.github.com/repos/owner/repo/pulls/1');
    assert.equal(result, 'https://github.com/owner/repo/pull/1');
  });
});

describe('safeCwdJoin', () => {
  it('allows normal relative paths', () => {
    const result = safeCwdJoin('foo/bar.txt');
    assert.ok(result.endsWith('foo/bar.txt'));
  });
  it('rejects paths escaping CWD via ..', () => {
    assert.throws(() => safeCwdJoin('../../etc/passwd'), /Path escapes CWD/);
  });
  it('allows current directory', () => {
    const result = safeCwdJoin('.');
    assert.ok(result);
  });
});

describe('ghCloneUrl', () => {
  it('builds HTTPS clone URL', () => {
    assert.equal(ghCloneUrl('owner', 'repo'), 'https://github.com/owner/repo.git');
  });
});
