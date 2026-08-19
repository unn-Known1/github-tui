# Changelog

All notable changes to this project will be documented in this file.

## [0.7.0] - 2026-08-19

### Added — Dashboard gap closeout
- Repaired Dashboard keyboard focus, mouse selection, custom-section navigation, and page scrolling.
- Added complete Dashboard refresh behavior, loading/freshness states, partial-failure preservation, retryable Trending errors, local-repository filtering, and compact Needs Attention actions.
- Added command-palette actions for Dashboard refresh, Inbox, Actions, repository search, and issue creation.
- Added Dashboard regression coverage; **249 / 249 tests pass** with import and syntax checks clean.

### Deferred by design
- Cross-account critical security aggregation and other advanced metrics remain deferred to preserve the Dashboard’s low-complexity information budget.

## [0.6.7] - 2026-08-04

### Fixed — Audit hardening and account-safe state
- **Lifecycle cleanup** — shutdown callbacks now run through the shared state registry, including toast-timer cleanup; stdin and resize paths are guarded so terminal cleanup can complete safely.
- **Upgrade notes** — returning authenticated users now receive the version-gated “What’s new” overlay; standalone release notes open on the correct release step and close cleanly after acknowledgement.
- **Account isolation** — logout invalidates active async scopes and clears private repositories, dashboard, inbox, actions, search, files, repository-detail, security, and issue/PR detail state before returning to the signed-out UI.
- **ETag cache safety** — cached responses are partitioned by token identity and representation, preventing private data from crossing accounts and preventing JSON responses from being reused as raw file content. Legacy unpartitioned cache entries are ignored.
- **Download safety** — streamed downloads require HTTPS, never forward GitHub credentials to unrelated redirect hosts, reject malformed redirects, and remove failed partial archives.
- **Stale request prevention** — repository authentication, follower loading, starred pagination, file access, and the audited analysis flows now honor `AbortSignal` cancellation.
- **Navigation correctness** — filtered Inbox open/copy actions now use the highlighted filtered notification; Settings mouse/palette actions target the correct menu items; starred pagination stops accurately at short pages.
- **Input robustness** — Unicode cursor movement and footer rendering use consistent code-point indexing, avoiding split surrogate pairs while editing emoji and other astral characters.

### Documentation and tests
- Updated version metadata and release documentation to `0.6.7`.
- Added focused regression coverage for cache partitioning, repository path encoding, secure downloads, filtered Inbox selection, and release-note lifecycle.
- **222 / 222 passing** with import and syntax checks clean.

## [0.6.6] - 2026-07-28

### Fixed — 16 gap audit closeout (P0 + P1)
- **P0-1 Onboarding staleness** — `lastSeenVersion` persisted to `session.json`; gating predicate `shouldAutoLaunchWelcome` only fires on version upgrades instead of every run.
- **P0-2 Accessibility** — new `--accessible` CLI flag renders header, footer, toasts, heatmap, rate-limit bar, skeleton, input cursor and "Less/More" legends with ASCII (`./oO# [####..]= _`) instead of Unicode blocks (`░▒▓█`). `a11yHeatChar()` / `a11ySymbol()` exported helpers.
- **P0-3 Esc-quit trap** — Dashboard `handleBack` no longer pops the quit confirm; shows a tab-nav hint instead. Esc on Inbox falls back to Dashboard consistently.
- **P0-4 Mouse overlay routing** — `_dispatchOverlayClick` routes palette / help / bookmarks / confirm first so dispatch doesn't double-trig when overlays are stacked. Palette click now sets cursor before execution.
- **P0-5 Destructive file-op confirms** — `files.mjs runWithConfirm` wraps `save` / `zipball` / `clone` / `gh-clone` with the standard `y`/`n` confirm dialog.
- **P0-6 Retry hint** — footer reserves a `[r] to retry` suffix; global `r` consumes the active retry handler via `consumeRetryHandler()`.
- **P0-7 "Analyze" → "Explore" rename sweep** — every user-facing string in `help` / `onboarding` / `render` / 9 tab files updated. Internal IDs (`id: 'analyze'`, `analyze:` section prefix, `appState.analyzeView`) intentionally kept as routing keys.

### Changed — Polish & minor bugs
- **P1-1 Toast `[u] undo` affordance** — header toast appends the undo hint when `undoStack` is non-empty.
- **P1-2 `getUnreadCount()`** derived helper replaces scattered inbox filters.
- **P1-3 Loading watchdog** — `Object.defineProperty` setter shim on `appState.loading` arms the watchdog on every direct write, replacing a 160-site sweep. `checkLoadingWatchdog()` aborts in-flight `startAsync` AbortControllers after 30s and toasts a recovery hint.
- **P1-4** EmptyState cards — used consistently across Inbox / Repos / Dashboard widgets.
- **P1-5 POWER-USER help category** — Ctrl-P / Ctrl-S / Ctrl-K / Ctrl-Y / `/` / `gg` are now listed under their own section in `?`.
- **P1-6 Lowercase `s` for star in files sub-pane** — guard preserves Files save shortcut.
- **P1-7 Palette `W` hint → `palette`** — `W` no longer toggles watch; the palette hint accurately reflects the only path.
- **P1-8 Single-source-of-truth starred** — `_toggleStarInner` no longer does inline `splice` / `unshift`; `upsertEntity()` is the only mutation point. Cache and visible list can't diverge.
- **P1-9 Strict footer truncate** with ellipsis (`Math.max(0, W - budget)`).
- **P1-10 ⟳ auto-refresh chip** rendered on row 2 when enabled.
- **P1-11 Recent-repos keyboard nav** — `_recentReposCursor` with `j`/`k`/`Enter` dispatch in `keys.mjs` (Explore search view).
- **P1-12 Wipe-token keychain** confirm in Settings.
- **P1-13 Ctrl-S (save search) + Ctrl-K (custom-keybindings hint) wired** — palette / onboarding / help promises are no longer lies. Ctrl-S context-gated to Explore tab.

### Internal
- `SECURITY_SUB_PANES` constant hoisted from `keys.mjs` into `state.mjs`.
- Dead `_modalBounds` / `recordModalBounds` / `readModalBounds` helpers deleted.
- `Object.defineProperty` setter shim: arms 30s watchdog automatically — see P1-3.
- `getStarredList()` exported helper for derivable starred views.

### Tests
- 208 / 208 passing (was 208 before; no regression).
- New: `tests/onboarding.test.mjs` covers `shouldAutoLaunchWelcome` predicate across all version transitions.
- `tests/state.test.mjs` expanded for `getUnreadCount`, `setLoading`, `checkLoadingWatchdog`, entity-cache round-trip, single-source-of-truth star/unstar.

### Fixed — Dashboard focus + keyboard correctness (F1, F3)
- **F1 `l` key double-binding** — global `keys.mjs` previously bound lowercase `l` on the dashboard to BOTH `rightCard()` (global handler) AND the per-tab `localRepoFilter` toggle (per-tab handler). The two dispatched together on a single press in the wrong order, so `l` both moved a stat card AND toggled the local-repo filter. Removed the global `l` → rightCard mapping; card navigation is now exclusively right arrow + uppercase `L` (vi HJKL convention), while the per-tab `l` for `localRepoFilter` is the single source of truth.
- **F3 Recent Activity zone** — the dashboard's "Recent Activity" section header advertised `[Enter] open first` but no `activity` zone was registered in `tui/focus.mjs`. Tab skipped it, and pressing Enter dispatched to whatever zone was actually focused (typically trending), so the hint lied. Registered `Recent Activity` in FOCUS_ZONES[0] with `canFocus: () => appState.events?.length > 0`, added `dashboardActivitySelected` / `dashboardActivityScroll` to `appState`, wired `dashboardUp` / `dashboardDown` / `openDashboardItem` to scroll the list, render selection state, and drill into the affected repo via Explore (`setTab(2); loadRepoDetails(owner, repo)`). Hint changed to `[Enter] open repo`.

### Changed — Dashboard polish (banner row, card actions, self-healing)
- **All 5 stat cards now have a sensible Enter action** — `openFocusedCard()` previously had branches only for STARS / FORKS / STALE. Added LANGUAGES (i=2) → `setTab(1)` + `appState.reposShowLangFacet = true` so the language-chip sidebar opens on the Repos tab; ACCOUNT AGE (i=3) → `openUrl(appState.user.html_url)` with success / failure toast routing (falls back to "No profile URL available" warning when the user object is missing).
- **Failure + freshness banner row** — new row at `y+2` between the `y+1` hline separator and the stat cards at `y+3` (no layout shift) renders two badges: `⚠ N widget(s) failed` (red bold, left, only when `appState.dashboardWidgetErrorCount > 0`) and `Updated Xm ago / Xh ago / just now` (dim, right-aligned, only when `appState.dashboardLastFetched` is set). Tracks per-widget failures of `Promise.allSettled` so a rate-limited or transient-erroring widget is no longer silently absent.
- **`clampList()` at the top of `renderDashboard`** — self-heals `*Selected` / `*Scroll` for events / trending / issues / PRs to `length - 1` whenever the rendered dataset shrinks between fetches (e.g. auto-refresh returning fewer events, or switching accounts). Pure state assignment with no `render()` call inside, so no render-loop risk.
- **Focus-zone Tab order reshuffled** — FOCUS_ZONES[0] re-ordered to `cards → activity → issues → prs → trending` so Tab moves top-to-bottom through the right column instead of jumping cards → trending (bottom of right column) → activity (top of right column) — a spatially confusing hop called out during the audit.

### Internal — Dashboard refactor + dead code
- **Trending fetch dedup** — replaced the ~80 lines of near-identical code in `loadMoreTrending` / `pageUp` / `pageDown` with two new helpers: `_fetchTrendingPage(page)` returns `{ stale, list, error }` and `_setTrendingPage(page, replace)` orchestrates the loading flag, appState mutation, and re-render. The three public exports are now 3-line fire-and-forget wrappers. `keys.mjs` already dispatches via `Promise.resolve().then(() => mod.keys[key]()).catch(...)`, so making them sync doesn't change the dispatch contract.
- **Custom-section loader debug** — `loadCustomSections` was previously swallowed by `try { ... } catch {}`. Now logs to stderr via `console.error` when `process.env.DEBUG || process.env.GITHUB_TUI_DEBUG` is set, so a malformed user config isn't completely invisible. Inline env check avoids a circular import through app.mjs's module-private `DEBUG` constant.
- **Dead code removal** — deleted unused `const ZONES = [...]` and `export function cycleDashboardZone()` from `tui/tabs/dashboard.mjs`. Focus is driven entirely by `tui/focus.mjs`'s `_focusState.zoneIndex` plus `focusNext` / `focusPrev`. A repo-wide audit confirmed zero callers of `cycleDashboardZone`.

### Tests
- **213 / 213 passing** (was 208 / 208 after the gap-audit closeout; +5 tests added during the audit). No regression across the original 208. New dashboard behaviour — activity zone selection state, FOCUS_ZONES ordering, banner-row rendering, `clampList` self-healing, refactored trending fetch — exercises existing test surfaces without breaking them; manual smoke-test via `tests/dashboard.test.mjs` (recommended addition) before tagging the release.

## [0.6.5] - 2026-07-27

### Fixed — Warranty + UX cleanup
- **App startup crash** — fixed `ReferenceError: registerShutdownCallback is not defined` at app.mjs:117. Consolidated the duplicated `state.mjs` import block into a single top-level import that now pulls in `TABS, showMessage, loadCollapsed, loadSession, registerShutdownCallback`.
- **Boot-time `SyntaxError: Identifier 'render' has already been declared`** — both `state.mjs` and `render.mjs` export `render`. Removed the redundant import from `state.mjs` while keeping the screen-painter import from `render.mjs`. A defensive inline comment now warns future contributors not to re-import `render` from `state.mjs`.
- **Stale `_TABS` reference in `startAutoRefresh`** — once the second `import { TABS as _TABS }` line was dropped, auto-refresh would have thrown on its first tick. Renamed two call sites to plain `TABS` so the consolidated top-level import is the single source of truth.
- **Inbox detail-popup `Esc` fallback** (U004) — `openDetail(...).Esc` and bare `Esc` on a non-detail row are no longer silent no-ops; both fall through to `setTab(0)` (Dashboard) for a consistent keyboard feel across every tab.
- **Fragile `break;` fall-through in keymap switch** (U001, U006) — replaced the silent dispatch-after-switch pattern for `G`/`B`/`Z` (files-pane actions: `ghCloneIntoCwd`, `openBranchPicker`, `downloadZipball`) and `1`–`6` (Analyze security sub-pane: dependabot / secret / codescan / advisories / branch / deps) with explicit in-switch dispatch. Future tab reorderings or refactors can't silently break these shortcuts anymore.
- **Inbox `o` toast on CheckSuite / Discussion subjects** (U003) — pressing `o` on a CheckSuite notification no longer dumps the raw `/check-suites/N` URL into the success toast; the toast now reads "Opened Actions tab". Discussions say "Opened discussion in browser" instead.

### Changed — Source-of-truth hoist
- New `SECURITY_SUB_PANES` constant exported from `tui/state.mjs` (next to `TABS`). The sub-pane enum `['dependabot', 'secret', 'codescan', 'advisories', 'branch', 'deps']` was previously inlined in `keys.mjs`; now keys.mjs imports it from one place so adding/removing a sub-pane is a single-file edit and the two files can't drift.

### Internal
- **Duplicate-import shadow audit** — cross-referenced every `export X` declaration across `tui/*.mjs`, `tui/tabs/*.mjs`, and `app.mjs` against every `import { ... } from ...` block. The only live collision in the codebase was the `render` import in `app.mjs` (state.mjs + render.mjs); it is now fixed. Every other shared-looking name (`handleKey`, `up`/`down`/`enter`, `pageUp`/`pageDown`, `bottom`, `jumpTop`, `jumpBottom`, `keys`, `getSections`, `getCurrentSection`) is either single-source or accessed via a namespace import (`tabModules`, `bookmarks`, `palette`), so no further fixes were needed.

### Docs
- README: version bumped to 0.6.5 (Socket badge + System panel)
- VISION: "Current version" bumped to v0.6.5

---

## [0.6.4] - 2026-07-20

### Fixed
- Fix `formatBytes is not defined` crash in Analyze tab (missing import)
- Fix `truncate is not defined` crash in Bookmarks overlay (missing import in render.mjs)

---

## [0.6.3] - 2026-07-20

### Added — GitHub CLI Login
- New "Login (GitHub CLI)" option in Settings — uses `gh auth token` for zero-friction auth
- No PAT creation needed if user already has `gh` CLI installed and authenticated
- Graceful degradation: option is grayed out with hint if `gh` is not installed
- Async availability check with caching — no repeated process spawns
- Falls back to PAT login if `gh` is not available
- Zero npm dependencies — `gh` is an optional system tool, same as `git`

### Added — Undo/Redo System
- New `tui/undo.mjs` module with full undo/redo stack (20-entry limit)
- Supports: bookmark removal, star/unstar, unsubscribe, issue/PR close
- Keybindings: `u` for undo, `Ctrl+Y` for redo
- Convenience functions: `undoableRemoveBookmark()`, `undoableUnstar()`, `undoableUnsubscribe()`, `undoableCloseIssue()`

### Added — Virtual Scrolling Helper
- New `tui/virtual-scroll.mjs` module for standardized virtual scrolling
- `calculateViewport()` — computes visible window for large lists
- `handleScroll()` — standardizes scroll behavior (up/down/page/top/bottom)
- `handleWheel()` — mouse wheel scroll handling
- `getItemAtRow()` — maps row position to item index

### Added — Error Recovery System
- New `tui/error-recovery.mjs` with contextual error messages and recovery hints
- `showError()` — displays error with recovery suggestion based on pattern matching
- `withErrorRecovery()` — wraps async functions with automatic error handling
- `createRetryHandler()` — creates retry handlers for failed operations
- Recognizes 8 error patterns: 401, 403/rate limit, 404, network, timeout, connection reset, SSL
- Updated repos, inbox, dashboard, actions, and detail tabs to use error recovery

### Added — Responsive Layout System
- New `tui/layout.mjs` with percentage-based sizing and adaptive columns
- `getBreakpoint()` — returns 'xs'/'sm'/'md'/'lg'/'xl' based on terminal width
- `calculateColumns()` — ratio-based column width calculation with min/max
- `splitLayout()` — left/right panel split with configurable ratio
- `getStatCardLayout()` — responsive stat card sizing for dashboard
- `getResponsiveConfig()` — compact mode, column visibility settings
- `getDetailPopupLayout()` — adaptive popup dimensions
- Repos tab columns and dashboard stat cards now adapt to terminal width

### Added — Focus Management System
- New `tui/focus.mjs` with Tab/Shift+Tab navigation between focus zones
- Per-tab focus zones with canFocus() guards
- `focusNext()` / `focusPrev()` / `resetFocus()` for keyboard navigation
- `getFocusedSelection()` for tracking current focus state

### Added — Paste Handling
- Bracketed paste mode enabled for proper multi-line text paste
- `enableBracketedPaste()` / `disableBracketedPaste()` in `tui/input.mjs`
- Pasted content is inserted atomically instead of character-by-character

### Added — Per-Widget Loading States
- Dashboard widgets now track individual loading state
- `setWidgetLoading()` / `isWidgetLoading()` in `tui/state.mjs`
- Enables granular UI feedback during dashboard load

### Added — Custom Keybindings Validation
- `tui/custom-keys.mjs` now validates keybinding entries against schema
- Invalid entries show warnings with specific error messages
- Supports contexts: any, detail, repo, dashboard, files

### Fixed — CJK/Wide Character Support
- `strWidth()` now correctly counts CJK characters as width 2
- Handles UTF-16 surrogate pairs for emoji and extended Unicode
- Fixed ESC sequence parsing to properly skip CSI parameter/intermediate bytes

### Fixed — 16-Color/Monochrome Fallback
- `idx256Fg()` / `idx256Bg()` now fall back to nearest 16-color ANSI when 256-color isn't supported
- Added `idx256ToAnsi16()` helper for accurate color mapping

### Fixed — Confirm Dialog
- `Enter` now confirms (previously was treated as cancel)
- `Escape` / `n` / `N` cancels the dialog
- Guard against concurrent confirm dialogs

### Fixed — Render Debouncing
- `render()` now uses `queueMicrotask` batching for rapid state mutations
- Prevents render flooding during parallel operations

### Fixed — Key Repeat Debouncing
- Arrow keys held down are debounced at ~60fps
- Prevents render flooding when keys are held

### Fixed — Resize Recovery
- `recoverScrollPositions()` ensures selections stay visible after terminal resize
- Clamps selection indices and scroll offsets automatically

### Fixed — Dynamic Import Optimization
- Custom keybindings module is lazy-loaded once at startup
- No longer imports module on every unrecognized keypress

### Fixed — Mouse Coordinate Constants
- Extracted `TAB_CONTENT_Y` in `tui/render.mjs`
- Replaced hardcoded `HEADER_HEIGHT + N` values in `tui/mouse.mjs`

### Changed
- Removed `_global` scope fallback from `startAsync()` — now throws if no scope is provided
- Updated repos, inbox, dashboard, actions, and detail tabs to use error recovery

### Docs
- README: updated version to 0.6.3
- README: added new keyboard shortcuts (u for undo, Ctrl+Y for redo)
- README: updated project layout with new modules
- README: added v0.6.3 to roadmap

---

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
