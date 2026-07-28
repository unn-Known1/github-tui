// Tests for the onboarding "what's new" / first-run wizard helper logic.
// Covers:
//   - parseReleaseNotes (pure changelog parser)
//   - buildWhatsNewBody (output composition)
//   - compareVersions (semver-like comparator)
//   - shouldAutoLaunchWelcome (version-gate predicate)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseReleaseNotes, buildWhatsNewBody,
} from '../tui/tabs/onboarding.mjs';
import { compareVersions } from '../tui/state.mjs';

describe('parseReleaseNotes', () => {
  it('returns empty array for null/undefined/empty input', () => {
    assert.deepEqual(parseReleaseNotes(null), []);
    assert.deepEqual(parseReleaseNotes(undefined), []);
    assert.deepEqual(parseReleaseNotes(''), []);
  });

  it('parses a single section with date and bullets', () => {
    const text = '## [1.0.0] - 2026-01-01\n\n- First bullet\n- Second bullet\n';
    const out = parseReleaseNotes(text);
    assert.equal(out.length, 1);
    assert.equal(out[0].version, '1.0.0');
    assert.equal(out[0].date, '2026-01-01');
    assert.deepEqual(out[0].bullets, ['First bullet', 'Second bullet']);
  });

  it('parses multiple sections in order', () => {
    const text = [
      '## [0.6.4] - 2026-07-20',
      '',
      '- A',
      '- B',
      '',
      '## [0.6.5] - 2026-07-27',
      '',
      '- C',
      '- D',
      '- E',
    ].join('\n');
    const out = parseReleaseNotes(text);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map(s => s.version), ['0.6.4', '0.6.5']);
    assert.deepEqual(out[0].bullets, ['A', 'B']);
    assert.deepEqual(out[1].bullets, ['C', 'D', 'E']);
  });

  it('handles section without date', () => {
    const text = '## [1.0.0]\n\n- A\n';
    const out = parseReleaseNotes(text);
    assert.equal(out[0].version, '1.0.0');
    assert.equal(out[0].date, '');
  });

  it('ignores lines that look like bullets outside a section', () => {
    const text = '- orphan at top\n\n## [1.0.0]\n\n- real bullet\n';
    const out = parseReleaseNotes(text);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].bullets, ['real bullet']);
  });

  it('captures the first ### subheader inside a section', () => {
    const text = '## [1.0.0]\n\n### Added\n\n- new thing\n';
    const out = parseReleaseNotes(text);
    assert.equal(out[0].subheader, 'Added');
    assert.deepEqual(out[0].bullets, ['new thing']);
  });

  it('handles real CHANGELOG.md header lines with extra whitespace', () => {
    const text = '##   [2.0.0]   -   2026-12-31\n\n- Ship it\n';
    const out = parseReleaseNotes(text);
    assert.equal(out[0].version, '2.0.0');
    assert.equal(out[0].date, '2026-12-31');
    assert.deepEqual(out[0].bullets, ['Ship it']);
  });

  it('survives unicode / emoji in bullets without throwing', () => {
    const text = '## [1.0.0]\n\n- ✨ Magic\n- 中文 也行\n- 🚀 emoji\n';
    const out = parseReleaseNotes(text);
    assert.deepEqual(out[0].bullets, ['✨ Magic', '中文 也行', '🚀 emoji']);
  });
});

describe('buildWhatsNewBody', () => {
  it('returns the matching section when currentVersion matches', () => {
    const text = [
      '## [0.6.4] - 2026',
      '- a',
      '## [0.6.5] - 2026',
      '- b',
      '- c',
    ].join('\n');
    const body = buildWhatsNewBody(text, '0.6.5');
    assert.ok(body.some(l => l.includes('Current version')));
    assert.ok(body.some(l => l.includes(' • b')));
    assert.ok(body.some(l => l.includes(' • c')));
    assert.ok(!body.some(l => l.includes(' • a')));
  });

  it('falls back to the first (newest) section when currentVersion is missing', () => {
    // keep-a-changelog convention: newest at top, so sections[0] is newest.
    const text = [
      '## [0.6.5] - 2026',
      '- newest bullet',
      '',
      '## [0.6.4] - 2026',
      '- past bullet',
    ].join('\n');
    const body = buildWhatsNewBody(text, '99.0.0');
    assert.ok(body.some(l => l.includes(' • newest bullet')));
  });

  it('caps to 7 bullets and shows a "more" trailing line when truncated', () => {
    const lines = ['## [1.0.0]'];
    for (let i = 1; i <= 12; i++) lines.push('- bullet ' + i);
    const text = lines.join('\n');
    const body = buildWhatsNewBody(text, '1.0.0');
    const bullets = body.filter(l => l.trimStart().startsWith('•'));
    assert.equal(bullets.length, 7);
    assert.ok(body.some(l => l.includes('CHANGELOG.md')));
  });

  it('returns a sensible body for empty changelog text', () => {
    const body = buildWhatsNewBody('', '0.6.5');
    assert.ok(body.some(l => l.includes('Current version')));
    assert.ok(body.some(l => l.includes('No release notes')));
  });
});

describe('compareVersions', () => {
  it('returns 0 for identical versions', () => {
    assert.equal(compareVersions('0.6.5', '0.6.5'), 0);
    assert.equal(compareVersions('v1.0.0', 'v1.0.0'), 0);
  });

  it('returns 1 when a > b', () => {
    assert.equal(compareVersions('0.6.5', '0.6.4'), 1);
    assert.equal(compareVersions('1.0.0', '0.9.9'), 1);
    assert.equal(compareVersions('2.0', '1.9'), 1);
  });

  it('returns -1 when a < b', () => {
    assert.equal(compareVersions('0.6.4', '0.6.5'), -1);
    assert.equal(compareVersions('0.9.9', '1.0.0'), -1);
  });

  it('treats numeric parts as numbers, not strings', () => {
    // The classic bug: "0.6.10" vs "0.6.5" — string compare says 10 < 5.
    assert.equal(compareVersions('0.6.10', '0.6.5'), 1);
    assert.equal(compareVersions('0.6.9', '0.6.10'), -1);
  });

  it('handles missing parts as zero-padded', () => {
    assert.equal(compareVersions('1.0', '1.0.0'), 0);
    assert.equal(compareVersions('1', '1.0.0'), 0);
    assert.equal(compareVersions('1.0.1', '1.0'), 1);
  });

  it('handles pre-release tags', () => {
    // A pre-release sorts before the same released version.
    assert.equal(compareVersions('0.6.5-beta', '0.6.5'), -1);
    assert.equal(compareVersions('0.6.5', '0.6.5-beta'), 1);
    // Different pre-release tags lexicographic.
    assert.equal(compareVersions('0.6.5-alpha', '0.6.5-beta'), -1);
  });

  it('strips a leading "v"', () => {
    assert.equal(compareVersions('v0.6.5', '0.6.4'), 1);
    assert.equal(compareVersions('0.6.4', 'v0.6.5'), -1);
  });

  it('returns 0 for non-inputs gracefully', () => {
    assert.equal(compareVersions(null, null), 0);
    assert.equal(compareVersions(undefined, '0.0.0'), 0);
    assert.equal(compareVersions('1.2.3', undefined), 1);
  });
});

describe('shouldAutoLaunchWelcome (P0-1 gate)', () => {
  // Test directly against compareVersions so we don't depend on APP_VERSION
  // (which changes between releases and would make this test flakey).
  // shouldAutoLaunchWelcome() is `compareVersions(APP_VERSION, last) > 0`.
  it('returns false when no lastSeenVersion (first-ever run)', async () => {
    const onboarding = await import('../tui/tabs/onboarding.mjs');
    const { appState } = await import('../tui/state.mjs');
    const saved = appState.lastSeenVersion;
    appState.lastSeenVersion = null;
    assert.equal(onboarding.shouldAutoLaunchWelcome(), false);
    appState.lastSeenVersion = saved;
  });

  it('returns true when lastSeenVersion is strictly lower (any difference)', async () => {
    // Pick a version that is GUARANTEED to be lower than anything reasonable
    // for APP_VERSION (which is at v0.6.5+ in current package.json).
    const onboarding = await import('../tui/tabs/onboarding.mjs');
    const { appState } = await import('../tui/state.mjs');
    const saved = appState.lastSeenVersion;
    appState.lastSeenVersion = '0.0.0';
    assert.equal(onboarding.shouldAutoLaunchWelcome(), true);
    appState.lastSeenVersion = saved;
  });

  it('returns false when lastSeenVersion is strictly higher (downgrade)', async () => {
    const onboarding = await import('../tui/tabs/onboarding.mjs');
    const { appState } = await import('../tui/state.mjs');
    const saved = appState.lastSeenVersion;
    appState.lastSeenVersion = '9999.0.0';
    assert.equal(onboarding.shouldAutoLaunchWelcome(), false);
    appState.lastSeenVersion = saved;
  });

  it('returns false when lastSeenVersion equals APP_VERSION', async () => {
    const onboarding = await import('../tui/tabs/onboarding.mjs');
    const { appState } = await import('../tui/state.mjs');
    const { APP_VERSION } = await import('../tui/config.mjs');
    const saved = appState.lastSeenVersion;
    appState.lastSeenVersion = APP_VERSION;
    assert.equal(onboarding.shouldAutoLaunchWelcome(), false);
    appState.lastSeenVersion = saved;
  });
});
