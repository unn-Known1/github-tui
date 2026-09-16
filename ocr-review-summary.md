# OCR review summary — github-tui

- Date: 2026-09-16 · Tool: `ocr scan` (OpenCodeReview) · Session `1c2bf41a-40cc-4dda-ba20-5879dd0b6bea`
- Scope: 86 files (~29k lines) in `app.mjs`, `tui/`, `tests/`, `tools/`. Excluded: `open-code-review/` (separate untracked project), `node_modules/`.
- Full report: `ocr-scan-report.txt` (8,256 lines, in this dir).
- Totals: **538 comments** — 15 critical, 124 high, 244 medium, 155 low · 217 bug, 156 maintainability, 93 test, 29 security, 17 perf.

## Criticals (spot-verified)

Real, confirmed in source:
- `tui/tabs/actions.mjs:228` — `/^\\d+$/` never matches digits; workflow number-pick broken.
- `tui/tabs/actions.mjs:480`, `tui/tabs/files.mjs:810` — `/\\r?\\n/` splits on literal backslash-n; log scrolling and commit subjects broken.
- `tui/screen.mjs:424` — `'\\u200B'` is a 6-char literal, not a zero-width space (cf. lines 371, 400).
- `tui/git-context.mjs:23` — shell injection via `execSync('git remote get-url ' + name)`; use `execFileSync` array form.
- `tui/recommended-features.mjs:161` — secret scrub is case-sensitive, top-level keys only.
- `tui/profiles.mjs:37` — corrupt `profiles.json` parses to `[]`, so next upsert wipes all profiles.
- `tui/keys.mjs:135` — star rollback restores the post-mutation `stargazers_count`.
- `tui/tabs/repos.mjs:883` — `repos-more` uses scope `repos-more` but workers check `repos`; can't cancel + duplicate pages.
- `tui/palette.mjs:236` — grouped-mode cursor counts headers as items; highlight mislands.
- `tui/tabs/onboarding.mjs:110` — async `onEnter` advances the wizard before login resolves.
- `tui/which-key.mjs:11` — `g`-group re-trigger bug (reported twice).
- `.gitignore` — missing `.env` entries (secret-leak risk).

False positive (verified — file parses, suite green):
- `tui/undo.mjs` "missing paren syntax error" — not real.

Test-only criticals: `tests/theme.test.mjs` NO_COLOR tests assert an inline ternary, never call `color()`.

## High-severity themes

- Unhandled rejections: `openUrl(...).then()` without `.catch` (`bookmarks.mjs:51`, `mouse.mjs:1265,1457`, `dialog.mjs:203`).
- Secrets on command lines (`keychain.mjs:117,179`); non-atomic writes (`profiles.mjs:32`, `config.mjs:87`, `store.mjs:22`).
- Stale-scope / `isStale` mismatches (`organizations.mjs:18`, `analyze-search.mjs:89`, `dashboard.mjs:89`).
- Tests mutating the shared `appState` singleton with no reset; shallow-copy mutation assertions (`repos-logic`).
