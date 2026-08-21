import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  relTime, clamp, truncate, truncateToWidth, padRight, displayWidth, shortNum, formatBytes,
  greeting, eventGlyph, notifTypeColor, notificationToHtmlUrl,
  safeCwdJoin, ghCloneUrl, wrapText, wrapTextWithMap,
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

describe('display-width helpers', () => {
  it('counts CJK and emoji as two terminal cells', () => {
    assert.equal(displayWidth('A中😀'), 5);
  });
  it('does not count combining marks as extra cells', () => {
    assert.equal(displayWidth('e\u0301'), 1);
  });
  it('truncates by terminal cells rather than UTF-16 length', () => {
    assert.equal(truncateToWidth('A中😀Z', 4), 'A中…');
  });
  it('pads wide strings to the requested cell width', () => {
    assert.equal(padRight('中', 4), '中  ');
  });
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

describe('wrapText — soft-wrap so long lines reflow', () => {
  it('returns short lines unchanged', () => {
    assert.deepEqual(wrapText('hello', 10), ['hello']);
  });

  it('returns exact-fit lines unchanged', () => {
    assert.deepEqual(wrapText('hello', 5), ['hello']);
  });

  it('wraps at the last whitespace within width', () => {
    assert.deepEqual(wrapText('hello world', 5), ['hello', 'world']);
  });

  it('hard-breaks unbreakable tokens (URLs / long identifiers)', () => {
    assert.deepEqual(wrapText('supercalifragilistic', 5),
      ['super', 'calif', 'ragil', 'istic']);
  });

  it('preserves empty source lines as empty display lines', () => {
    assert.deepEqual(wrapText('a\n\nb', 5), ['a', '', 'b']);
  });

  it('strips leading whitespace from continuation rows', () => {
    assert.deepEqual(wrapText('hello     world', 5), ['hello', 'world']);
  });

  it('handles width shorter than any word (single-cell width)', () => {
    assert.deepEqual(wrapText('a b c', 1), ['a', 'b', 'c']);
  });

  it('handles CRLF as a logical-line break', () => {
    assert.deepEqual(wrapText('one two\r\nthree', 3),
      ['one', 'two', 'thr', 'ee']);
  });

  it('handles null / undefined / empty input gracefully', () => {
    assert.deepEqual(wrapText(null, 10), ['']);
    assert.deepEqual(wrapText(undefined, 10), ['']);
    assert.deepEqual(wrapText('', 10), ['']);
  });

  it('width <= 0 returns source lines without wrapping', () => {
    assert.deepEqual(wrapText('hello world', 0), ['hello world']);
    assert.deepEqual(wrapText('a\nb', -5), ['a', 'b']);
  });

  it('keeps leading indent visible (does not lose indented content)', () => {
    // The exact wrap pattern depends on the algorithm's break-point
    // selection; assert that the indent is preserved (first row contains
    // some leading whitespace) AND every source word is present somewhere
    // in the wrapped rows.
    const result = wrapText('    indented line that wraps', 8);
    assert.match(result[0], /^\s+$/);   // first row is just indent
    assert.ok(result.length > 1);        // actually wrapped (multiple rows)
    // No content was silently dropped: joining with single spaces reproduces
    // the source words (modulo whitespace collapsing from continuation trim).
    const joined = result.join(' ').replace(/\s+/g, ' ').trim();
    assert.equal(joined, 'indented line that wraps');
  });

  it('keeps list-marker visible on the first visual row of a list item', () => {
    const result = wrapText('  - a long list item text', 6);
    // The dash (list marker) MUST appear on the first visual row so the
    // user can still tell this is a list item once it wraps.
    assert.match(result[0], /^.*-/);
    // Every source word survives the wrap:
    const joined = result.join(' ').replace(/\s+/g, ' ').trim();
    assert.equal(joined, '- a long list item text');
  });
});

describe('wrapTextWithMap — visual-row → source-line mapping', () => {
  it('maps each visual row to its source-line index', () => {
    const { lines, visualToLogical } = wrapTextWithMap(
      'short\nthis is a long line that wraps\nlast', 10);
    // First line: 1 visual row → source 0
    assert.equal(lines[0], 'short');
    assert.equal(visualToLogical[0], 0);
    // Second source line wrapped into multiple rows → all map to source 1
    const secondStart = 1;
    assert.ok(lines[secondStart].length <= 10);
    for (let i = secondStart; i < lines.length - 1; i++) {
      assert.equal(visualToLogical[i], 1, 'row ' + i + ' should map to source 1');
    }
    // Last row → source 2
    assert.equal(visualToLogical[visualToLogical.length - 1], 2);
  });

  it('width <= 0 returns one-to-one mapping', () => {
    const { lines, visualToLogical } = wrapTextWithMap('a\nb\nc', 0);
    assert.deepEqual(lines, ['a', 'b', 'c']);
    assert.deepEqual(visualToLogical, [0, 1, 2]);
  });

  it('empty source lines each get one visual row mapping back to themselves', () => {
    const { lines, visualToLogical } = wrapTextWithMap('a\n\nb', 5);
    assert.deepEqual(lines, ['a', '', 'b']);
    assert.deepEqual(visualToLogical, [0, 1, 2]);
  });
});
