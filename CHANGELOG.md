# Changelog

All notable changes to this project will be documented in this file.

## [0.6.2] - 2026-07-03

### Fixed — Actions tab (8 bugs)
- Stale loading flag: `loadWorkflowRuns` cleared `appState.loading` instead of `appState.actionsLoading` on stale branch — spinner never dismissed
- Wrong repo shown when filter active: `renderRunList` used unfiltered `actionsRepos[idx]` instead of `getFilteredRepos()[idx]`
- `Esc` in repos view was a no-op — now falls through to `setTab(0)` (Dashboard)
- `↑`/`↓` while a run was expanded moved `actionsScroll` instead of `actionsSelected` — rerun/cancel/open targeted the wrong run
- `maxVisible` hard-capped at 10 rows regardless of terminal height — removed the `Math.min(10, ...)` cap
- Global `case 'r'` intercepted before per-tab `rerunSelected()` — rerun was unreachable
- Global `case 'X'` intercepted before per-tab `cancelSelected()` — cancel was unreachable
- `refreshCurrent` on the Actions tab always reset to repos list even when in runs view

### Fixed — Inbox tab (8 bugs)
- `Space` called `inbox.pageDown()` (replaced list with next server page) instead of `inbox.space()` (appends more)
- `inboxHasMore` initialized to `true` — triggered a spurious page-2 request before any notifications were loaded
- `unsubscribeNotification` used `PUT { ignored: true }` (mutes thread) instead of `DELETE` (unsubscribes)
- Mouse hover used `appState.notifications.length` for bounds — ignored active filter, selection could land out of range
- `dispatchInboxClick` always jumped scroll on every click even when the item was already visible
- `scrollDown` scroll bounds ignored `inboxTextFilter`, allowing scroll past end of a text-searched result set
- `down(screen)` called `screen.height` without a null guard — crashed if called without a screen object
- `openCurrent` had no fallback URL for Discussion/CheckSuite notifications — now falls back to `n.repository.html_url`

### Changed
- Removed stray `@anthropic-ai/claude-code` dependency — package is now truly zero-dependency
- Added `.gitignore` to exclude `package-lock.json` from the repository

### Docs
- README: added missing Actions tab section in "What Each Tab Shows"
- README: corrected tab numbering (Settings → 5, Inbox → 6)
- README: updated Actions and Inbox keyboard tables with all current bindings
- README: updated test count (90 → 128), Socket badge (0.6.0 → 0.6.2)
- README: added v0.6.1 and v0.6.2 roadmap entries

---

## [0.6.1] - 2026-07-03

### Fixed (15 bugs across 8 modules)
- `input.mjs`: falsy-zero cursor bug (`|| buf.length` → `!= null ? : buf.length`)
- `input.mjs`: emoji/astral code-point insertion — `splice` now spreads `Array.from(key)` and advances cursor by codepoint count
- `keys.mjs`: duplicate `case 'B'` — merged into single guarded case
- `keys.mjs`: left-arrow `\x1b[D` removed from `handleBack` switch; added post-switch guard
- `keys.mjs`: `toggleStar` re-entrancy guard added
- `custom-keys.mjs`: `contextMatches('dashboard')` now checks `tabState.current === 0`
- `mouse.mjs`: hover row offset for starred repos corrected
- `mouse.mjs`: `scrollDown` repos/inbox bounds use filtered counts
- `github.mjs`: `isStarred` no longer swallows non-404 errors
- `github.mjs`: `downloadToFile` double-resolve/reject fixed with `settle` guard
- `github.mjs`: `getWorkflowRuns` and `getWorkflowJobs` now accept and forward `signal`
- `keychain.mjs`: cmd.exe metacharacter escaping in `_qWin`
- `keychain.mjs`: PowerShell single-quote injection fixed in `_loadWindows`
- `tabs/repos.mjs`: `_filteredReposCount` now set during `renderRepos()`; duplicate `'L'` key renamed `'l'`; starred pagination mapping fixed; footer range corrected
- `tabs/detail.mjs`: `loadDetail` clears `detailLoading` on stale paths; `mergePR` allows `mergeable: null`
- `tabs/inbox.mjs`: `openCurrent` null URL guard added

### Changed
- `APP_VERSION` in `tui/config.mjs` unified with `package.json`

---

## [0.6.0] - 2026-06-XX

### Added
- OS keychain integration — PAT stored in macOS Keychain, Linux libsecret, or Windows Credential Manager using zero npm dependencies
- Automatic silent migration from legacy plaintext `~/.github-tui/token` to keychain on first run
- Settings tab shows active storage backend (green = secure, yellow = plaintext fallback)
- `keychain.test.mjs` — backend detection, save/load/remove contract, round-trip tests
- 90 tests total

---

## [0.5.8] - 2026-XX-XX

### Added
- Graceful shutdown — atomic signal handling, raw mode restore, unhandled rejection/crash handlers
- Debounced resize, buffer-swap renderer (zero allocation after warm-up)
- `NO_COLOR` / `FORCE_COLOR` environment variable support
- Input cursor movement — arrow keys, Home/End, Ctrl-A/E/U/W
- Context-aware help overlay (`?`)
- Mouse hover highlight on Repos, Inbox, Actions lists
- Esc on Dashboard shows quit confirmation
- `repos-logic.mjs` extracted for testability
- Windows ASCII box-drawing fallback
- 81 tests

---

## [0.5.7] - 2026-XX-XX

### Added
- Rate limit visual `█░` bar in header
- Traffic pane (views, clones, popular paths, referrers)
- Milestones pane
- Labels pane
- Checks/CI pane
- Security pane (Dependabot alerts)
- Reviews tab in PR detail popup
- Mouse support — click tabs/panes/items, scroll wheel
- Collapsible sections (`z`/`Z`/`X`), disk-persisted
- Followers section in Dashboard profile
- Light theme (8 themes total)

---

## [0.5.0] - 2026-XX-XX

### Added
- Issue/PR detail popup with rendered body, labels, comments, file diffs
- Comment from TUI, emoji reactions, close/reopen, merge PRs with confirmation
- PR diff viewer — unified diff with syntax-colored additions/deletions
- Inbox notifications open detail popup for Issues/PRs

---

## [0.4.0] - 2026-XX-XX

### Added
- Dashboard contribution heatmap (15-week grid from PushEvents)
- Star history sparkline (30-day trend)
- Recent Issues/PRs activity feed
- Stale repos alert (60+ days no push)
- Quick actions bar

---

## [0.3.1] - 2026-XX-XX

### Added
- Repos tab row selection + Enter drill-in
- Type/language/stale filters, density toggle, pins, visibility badges
- File explorer — tree browsing, file viewer, branch picker
- Save file / save folder / download zipball / git clone / gh clone — CWD-safe

---

## [0.3.0] - 2026-XX-XX

### Added
- Modular refactor
- Command palette (Ctrl-P)
- 10 themes, persisted
- Inbox triage with mark-read/unsubscribe/filter
- README viewer pane with Markdown styling
- OSC-52 clipboard copy
- Bookmarks store
- Star/unstar repos
- ETag cache (disk-backed, LRU eviction)
- Token-scope inspector
