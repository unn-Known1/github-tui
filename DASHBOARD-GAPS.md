# Dashboard Functional Gaps

Audit of the Dashboard tab in `github-tui`.

**Deep-audit scope:** v0.7.0 source reviewed on 2026-08-19, including `dashboard.mjs`, `state.mjs`, `focus.mjs`, `keys.mjs`, `mouse.mjs`, `repos.mjs`, `github.mjs`, `render.mjs`, `settings.mjs`, related tests, README, and CHANGELOG. The audit covers authenticated startup, refresh, auto-refresh, partial API failure, keyboard, mouse, responsive layout, and unauthenticated states.

**Executive summary:** the most important problems are not missing analytics; they are broken focus/navigation, incomplete data freshness, clipped content on short terminals, and Dashboard actions that do not reach their intended destination. The Dashboard should be stabilized and simplified before adding new widgets.

## Implementation Summary

The Dashboard gap fixes have been implemented with a low-complexity, keyboard-first approach:

- Repaired Dashboard keyboard focus, Tab/Shift+Tab navigation, Enter actions, and mouse selection.
- Added navigation for activity, issues, pull requests, Trending, stale repositories, attention items, and custom sections.
- Fixed repository, language, stale-count, heatmap, star-history, notification, and local-repository filtering behavior.
- Added complete Dashboard refresh behavior for repository metadata, widgets, notifications, and derived statistics.
- Added loading indicators, partial-failure preservation, freshness status, and retryable Trending errors.
- Fixed stat-card destinations, issue/PR duplication, filtered Trending scrolling, and Dashboard body scrolling.
- Added compact Needs Attention and command-palette quick actions without introducing new mandatory shortcuts or a permanent toolbar.
- Added regression tests for heatmap alignment, filtering, focus order, attention summaries, viewport clipping, and custom-section traversal.

Cross-account critical security aggregation and other advanced metrics remain explicitly deferred to avoid API and interaction complexity.

## High priority

### 1. Keyboard focus and navigation are effectively broken — ✅ Implemented

- **Before implementation,** `Tab` switched tabs in `tui/keys.mjs` instead of entering Dashboard focus zones.
- **Before implementation,** `dashboardFocusZone` defaulted to `trending` and was not synchronized from `tui/focus.mjs`.
- **Resolution:** Dashboard Tab/Shift+Tab now cycles cards, Needs Attention, activity, issues, PRs, custom sections, and Trending; arrow/Enter behavior follows the focused zone, and mouse focus is synchronized.

### 2. The LANGUAGES stat-card action is incomplete — ✅ Implemented

- **Before implementation,** `openFocusedCard()` only set `appState.reposShowLangFacet = true` without a Repos consumer.
- **Resolution:** `tui/tabs/repos.mjs` now consumes `reposShowLangFacet` and renders a compact inline language summary with the existing `[L]` exact-language filter. This intentionally avoids adding a separate sidebar/navigation model.

### 3. Dashboard stale/contribution data is calculated before all repositories load — ✅ Implemented

- `loadUserData()` fetches the first 30 repositories, starts `loadDashboardWidgets()`, and then loads additional repository pages in the background (`tui/tabs/repos.mjs:95-100`, `121-149`).
- **Before implementation,** `dashboardStaleCount`, `dashboardStaleRepos`, and `dashboardContributions` were calculated from `appState.repos` while background pagination was still running (`tui/tabs/dashboard.mjs`; `tui/tabs/repos.mjs`).
- The Dashboard and background repository loader initially ran concurrently, so the result depended on which requests finished first.
- Later background pages update `appState.repos`, so derived values must be recomputed whenever a page arrives.
- **Resolution:** the background repository loader now calls `recomputeDashboardDerived()` after every page, keeping stale counts, heatmap data, star history, and the attention summary aligned with the loaded repository set.

## Medium priority

### 4. The unread Dashboard badge is not loaded on startup — ✅ Implemented

- **Before implementation,** Dashboard derived its badge from `appState.notifications`, but notifications were only loaded after entering Inbox.
- **Resolution:** the initial Dashboard widget batch, Dashboard refresh, Settings refresh, manual `r`, and auto-refresh all request notifications.

### 5. The contribution heatmap has a weekday/window bug — ✅ Implemented

- **Before implementation,** the heatmap start calculation did not match its weekday labels and omitted the current partial week.
- **Resolution:** the grid is Sunday-based, includes the current partial week, and counts only supported user-event activity types. GitHub’s public Events API remains a limited proxy for complete contribution history.

### 6. Dashboard mouse support does not cover most interactive lists — ✅ Implemented

- `dispatchDashboardClick()` handles cards, Trending, and Top Repos (`tui/mouse.mjs:777-837`).
- Previously, Recent Activity, Recent Issues, Recent PRs, and Stale Repos had no mouse selection/open behavior.
- **Resolution:** Dashboard mouse clicks now select/open activity, issue, PR, Trending, Top Repo, Stale Repo, and attention items using the same filtered data as keyboard navigation.

### 7. Trending filtering can render an incorrectly empty list — ✅ Implemented

- **Before implementation,** applying the filter reset `trendingSelected` but not `trendingScroll`.
- **Before implementation,** `renderDashboard()` clamped scroll against the unfiltered list length rather than the filtered list.
- **Resolution:** filter changes reset both selection and scroll, render-time clamping uses the filtered list, and matching includes repository metadata beyond the full name.

### 8. Recent Issues can include pull requests — ✅ Implemented

- **Before implementation,** `getUserIssues()` calls `/issues?filter=created`, whose results can include pull requests.
- **Resolution:** Dashboard filters out records with a `pull_request` property before storing `dashboardRecentIssues`, preventing duplicate PR display.

## Lower-priority gaps

- Dashboard only fetches the first 100 starred repositories, so star history is incomplete for larger accounts. — ✅ Implemented with background pagination.
- The repository background loader caps automatic loading at 300 repositories, while Dashboard cards are presented as totals across all repositories. — ✅ Implemented with full background pagination and a safety ceiling.
- Empty Recent Issues/PR sections disappear entirely instead of showing an explicit empty state. — ✅ Implemented.
- README advertises a Dashboard “quick actions bar.” — ✅ Implemented without a new toolbar: the Dashboard footer points to the existing command palette, which now exposes Refresh Dashboard, Open Inbox, Open Actions, Search repositories, and Create issue.

## Additional verified gaps

### 9. Local repository filter does not filter Dashboard data — ✅ Implemented

- `appState.localRepoFilter` is documented as filtering Dashboard/Inbox data (`tui/state.mjs:300`).
- Dashboard only displays a local-repo badge and toggles the boolean (`tui/tabs/dashboard.mjs:281`, `947-948`).
- Previously, no Dashboard widget filtered by the selected local repository.
- **Resolution:** repositories, events, issues, PRs, starred history, Trending, stale counts, the heatmap, and Inbox filtering now honor the local repository context.

### 10. Per-widget loading state is tracked but never rendered — ✅ Implemented

- `loadDashboardWidgets()` sets loading flags for events, Trending, starred repositories, issues, PRs, and followers.
- `isWidgetLoading()` previously existed without a Dashboard consumer.
- **Resolution:** the Dashboard now shows a compact loading count, preserves prior successful widget data during partial failure, and clears each widget’s loading state independently.

### 11. Trending period refresh failures are silently swallowed — ✅ Implemented

- Previously, `reloadTrending()` caught failures without displaying an error or registering a retry.
- **Resolution:** a failed period change restores the previous period, preserves the last successful list, displays an error, and registers the standard `[r]` retry handler. Page loading uses the same error/retry path.

### 12. Dashboard refresh does not refresh all Dashboard-owned data — ✅ Implemented

- **Resolution:** Dashboard refresh now reloads the first repository page before widgets, then continues background repository pagination. Notifications, repository metadata, aggregate cards, stale counts, heatmap, star history, and widget data therefore refresh through one Dashboard action. Settings refresh, manual `r`, and auto-refresh all use this path.

### 13. Custom Dashboard sections are display-only — ✅ Implemented

- Custom section items previously rendered as read-only rows.
- **Resolution:** custom sections now participate in focus navigation, keyboard and mouse selection, keyboard Enter opens issue/PR detail, navigation moves across every configured non-empty section, and collapse-all/expand-all includes their section keys. Pagination remains intentionally bounded to the configured 10-item query.

### 14. Trending filter only matches repository full names — ✅ Implemented

- Previously, the filter checked only `r.full_name`.
- **Resolution:** matching now includes full name, repository name, description, language, owner login, and topics while still honoring the optional local-repository context.

## Further deep-audit findings

### 15. Dashboard sections are clipped with no page-level scroll — ✅ Implemented

- Previously, `renderDashboard()` laid out the entire body vertically and stopped rendering at the terminal boundary.
- Previously, `pageUp()` and `pageDown()` changed Trending API pages rather than scrolling the Dashboard body.
- **Resolution:** the Dashboard now keeps cards fixed, clips the body to a viewport, supports `PgUp`/`PgDn`, Home/End, and mouse-wheel body scrolling, and exposes a scroll hint in the footer.

**Severity:** P1 — resolved.

### 16. Partial widget failures erase previously valid data — ✅ Implemented

- **Before implementation,** failed `Promise.allSettled()` results were converted to `null` and could replace prior values with empty states.
- **Resolution:** failed widgets now retain their last successful values and show a failure/loading banner; the standard retry path refreshes all failed widgets, while Trending period/page failures retain the prior list and register a retry.

**Severity:** P1 — resolved for widget data preservation; per-widget retry remains a follow-up refinement.

### 17. Stale-card navigation can land in the wrong Repos view — ✅ Implemented

- **Before implementation,** the STALE card set the stale filter without forcing `appState.reposView = 'own'`.
- If the user last viewed Starred Repositories, the card could open the Starred view instead of the stale own-repository list.
- **Resolution:** card and Needs Attention stale actions force `reposView = 'own'`; the Languages card opens a compact inline language facet and the Stale card opens the stale own-repository list.

**Severity:** P1 — resolved.

### 18. Custom sections are excluded from Dashboard collapse/focus management — ✅ Implemented

- Previously, custom sections received `dashboard:custom-*` keys during rendering but were not included in the static section list.
- **Resolution:** custom section keys are included dynamically in `getSections()`, focus can target every non-empty custom section, mouse selection synchronizes with keyboard focus, and `getCurrentSection()` returns the active custom section.

**Severity:** P2 — resolved.

### Severity guidance after the deep review

- **P0:** no safe or usable primary interaction path, especially keyboard focus and opening Dashboard items.
- **P1:** incorrect data, hidden content, or actions that open the wrong view.
- **P2:** degraded discoverability, optional-widget behavior, or inconsistent mouse/empty-state support.
- **P3:** documentation drift or convenience enhancements.

The original findings should be treated as follows: finding 1 is P0; findings 2, 3, 7, 9, 11, 12, 15, 16, and 17 are P1; findings 4, 5, 6, 8, 10, 13, and 18 are P2; the lower-priority documentation and coverage items are P3 unless product requirements elevate them.

## Recommended report format

For each finding, include the following fields:

```md
### GAP-ID — Short title

- **Severity:** P0/P1/P2/P3
- **Category:** Navigation / Data correctness / Loading / Interaction / API / Documentation
- **Location:** `file:line`
- **Expected behavior:** ...
- **Actual behavior:** ...
- **Reproduction:**
  1. ...
  2. ...
  3. ...
- **User impact:** ...
- **Likely fix:** ...
- **Test needed:** ...
```

The report should also include:

- **Audit scope:** version, date, files reviewed, and authenticated/unauthenticated paths.
- **Executive summary:** total P0/P1/P2/P3 findings.
- **Bug vs. enhancement distinction:** separate broken behavior from future improvements.
- **API limitations:** public-only Events data, pagination limits, and private repository visibility.
- **Test coverage gaps:** Dashboard behaviors that currently lack automated tests.
- **Acceptance criteria:** what must be true when each gap is fixed.
- **Documentation drift:** README/CHANGELOG claims that are not implemented, such as the quick-actions bar and local filtering.

## Recommended Dashboard Features — low-complexity approach

The Dashboard should remain a quick-glance home screen, not become a second Inbox, Actions tab, or Repos tab.

### UX guardrails

- Keep the default Dashboard to the existing stat cards plus a small number of high-value widgets.
- Do not add new mandatory navigation modes or require users to learn more global shortcuts.
- Reuse existing destinations: open Inbox for notifications, Actions for workflow runs, Explore for repositories, and issue/PR detail for work items.
- Prefer one compact “Needs attention” summary over several new full-size lists.
- Use progressive disclosure: show a count/status first, then open the detailed existing tab on Enter.
- Give each widget one obvious primary action.
- Keep advanced widgets optional, collapsed by default, or available through the command palette.
- Do not add a feature unless its data freshness, loading state, failure state, and empty state are explicit.

### Highest-value additions

#### 1. Fix Dashboard interaction before adding more widgets — ✅ Implemented

Complete keyboard and mouse navigation for the existing cards, Recent Activity, Issues, PRs, and Trending sections.

**Acceptance criteria:** Tab/focus behavior is predictable, every highlighted item opens with Enter, mouse selection matches keyboard selection, and all actions have visible hints.

#### 2. Compact “Needs attention” summary — ✅ Implemented

Add one small summary row or card containing only the most actionable counts already available without extra API surfaces:

- Unread mentions/review requests
- Failed CI runs already loaded in Actions
- Stale repositories

Each item opens the relevant existing tab or detail view with a filter applied. Overdue assigned work remains an optional follow-up because it requires a separate assigned-issues query and due-date/milestone policy; it is intentionally not added to the default Dashboard.

**Acceptance criteria:** the summary is hidden when there is nothing actionable, uses no more than one or two rows by default, and never duplicates the full Inbox or Actions UI.

#### 3. Real local-repository context filter — ✅ Implemented

Make the existing local-repository toggle actually filter Dashboard widgets. Keep it as one optional toggle rather than adding multiple repository filters.

**Acceptance criteria:** the active repository is clearly shown, affected widgets visibly change, the filter can be cleared with one key, and unavailable local context produces a clear message.

#### 4. Small quick-action row using existing commands — ✅ Implemented

Expose only the most common actions, preferably through the existing command palette or a compact footer hint:

- Refresh Dashboard
- Open Inbox
- Open Actions
- Search repositories
- Create issue

Avoid adding a large permanent toolbar or assigning new single-letter shortcuts where existing bindings already exist.

**Acceptance criteria:** actions reuse current commands, have no duplicate bindings, and are hidden or disabled when unavailable.

#### 5. Lightweight freshness and error controls — ✅ Implemented

Improve the existing banner without adding visual complexity:

- Show a small per-widget loading marker only while a widget is loading.
- Show one aggregate failure indicator when needed.
- Let `r` retry the failed widget or all failed widgets.
- Keep “updated X ago” visible only when useful.

**Acceptance criteria:** stale data is distinguishable from loading data, partial failures do not blank unrelated widgets, and retry behavior is discoverable.

#### 6. One compact repository-health indicator — ⚠ Partial by design

The current Needs Attention summary covers the low-cost, high-signal statuses already available:

- Stale repository count
- Failed CI count already loaded in Actions

Critical security-alert aggregation is intentionally deferred. GitHub exposes it per repository, so fetching it across an account would add many requests, permissions failures, and another freshness/error model—contrary to the Dashboard complexity guardrails. The existing Analyze → Security pane remains the destination for security details.

**Acceptance criteria for the implemented subset:** only actionable warnings are shown, zero-warning states stay quiet, and every warning has one clear destination.

### Optional, progressive-disclosure features — ⏸ Deferred by design

These should not appear in the default layout. Make them available through collapsed sections, the command palette, or user configuration:

- PR review queue
- Assigned issues and milestone due dates
- Release and dependency alerts
- Personal contribution/review metrics
- Dashboard-wide repository/language/date filters
- Configurable widget visibility and order
- Offline/cache details and rate-limit cost information

Each optional feature should reuse an existing tab or detail view wherever possible.

### Features to avoid for now

These are likely to increase cognitive and API complexity without improving the core Dashboard workflow enough:

- AI-generated recommendations
- Personalized social/trending algorithms
- Large activity charts and yearly summaries
- A second full PR/issue browser inside Dashboard
- A second full CI browser inside Dashboard
- Plugin-defined widgets before widget lifecycle and failure behavior are stable

**Recommended product priority:** fix existing navigation and data correctness first, then keep the compact Needs Attention summary, real local filtering, lightweight freshness/retry controls, and minimal command-palette quick actions. Do not add assigned-work or cross-account security aggregation until their API cost and failure behavior can be made explicit without enlarging the default view.

## Dashboard information architecture and space budget

The Dashboard should not attempt to show every metric at the same time. It should present a small, stable default view and use drill-down for details.

The layout below is a **target design**, not a description of the original implementation. The current renderer provides page-level Dashboard scrolling, defaults secondary sections to collapsed, and places the compact Needs Attention summary before the other right-column lists. A full single-column responsive redesign remains optional.

### Default view

At normal terminal widths, the target design should show only:

1. **Header status** — greeting, unread count, freshness, and failure indicator.
2. **Existing stat cards** — keep the five cards, with responsive wrapping.
3. **Needs attention** — one compact widget with at most four actionable rows:
   - review/mention work,
   - failed workflow runs,
   - stale repository warnings.

Overdue assigned work and cross-account critical security counts remain progressive-disclosure candidates rather than default rows.
4. **Recent Activity** — a short list of at most five rows.

This keeps the primary view to two working widgets and avoids duplicating the Inbox, Actions, or Repos tabs.

### Secondary information

Keep these sections collapsed by default or available through drill-down:

- Trending
- Top repositories
- Stale repository details
- Languages
- Contribution heatmap
- Star history
- Followers
- Detailed review queue
- Detailed repository health

A collapsed section should show only its title and a count/status summary. Enter should expand it or open the existing specialized tab. It should not introduce a second full browser inside Dashboard.

### Responsive behavior

- **Wide terminals:** two columns — Needs attention and Recent Activity on the right; compact profile/context information on the left.
- **Medium terminals:** one primary column with Needs attention first, followed by Recent Activity; secondary sections remain collapsed.
- **Small terminals:** show header, cards, and Needs attention only; hide or defer secondary widgets until the user expands them.
- **Accessible mode:** use a linear order and omit decorative/low-priority widgets unless explicitly requested.

### Interaction budget

- No new mandatory top-level navigation.
- No more than one primary action per widget.
- No new single-letter shortcuts when an existing shortcut or command-palette action already exists.
- Maximum four actionable rows in the default Needs attention widget.
- Every detailed item opens an existing Inbox, Actions, Explore, or issue/PR detail view.
- Users should be able to understand the default Dashboard without scrolling or memorizing new keys.

### Implementation priority — current status

1. Repair existing keyboard/mouse focus and data correctness. — ✅ Complete
2. Reduce the default layout to the information budget above. — ✅ Secondary sections collapse by default; full primary-layout redesign remains optional.
3. Add one compact Needs attention widget. — ✅ Complete
4. Make secondary sections progressive-disclosure sections. — ✅ Complete for registered sections, including custom sections.
5. Add optional metrics only after measuring whether the default view remains glanceable. — ⏸ Deferred.

## Validation

- `npm test`: **249 passed, 0 failed**
- Dashboard-related modules passed `node --check` and imported successfully.
- Implemented across `dashboard.mjs`, `focus.mjs`, `screen.mjs`, `state.mjs`, `keys.mjs`, `mouse.mjs`, `render.mjs`, `repos.mjs`, `inbox.mjs`, `settings.mjs`, plus `tests/dashboard.test.mjs`.
- Dashboard regression coverage now includes focus order, local filtering, attention summaries, heatmap alignment, viewport clipping, and traversal across multiple custom sections.
- Remaining automated coverage gaps include mocked API failure/pagination flows, full mouse double-click routing, terminal-level visual snapshots, and command-palette rendering snapshots.
