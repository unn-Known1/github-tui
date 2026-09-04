# GitHub TUI

A fast, zero-dependency terminal user interface for GitHub — six tabs, a command palette, an in-terminal file explorer that can clone or save anything to your CWD, an inbox triage workflow, themes, persistent bookmarks & pins, OSC-52 clipboard, ETag-aware caching, mouse support, collapsible sections, and comprehensive repo analytics. All driven by your keyboard (and mouse).

![status](https://img.shields.io/badge/status-active-success) ![node](https://img.shields.io/badge/node-%E2%89%A518-blue) ![deps](https://img.shields.io/badge/deps-0-green) [![Socket Badge](https://badge.socket.dev/npm/package/github-tui/0.7.2)](https://badge.socket.dev/npm/package/github-tui/0.7.2) ![license](https://img.shields.io/badge/license-MIT-blue)

![GitHub TUI Screenshot](https://raw.githubusercontent.com/unn-Known1/github-tui/main/Screenshot.png)

## GitHub / User
- Remote: `https://github.com/unn-Known1/github-tui`
- Author: unn-Known1
- Email: ptelgm.yt@gmail.com

## ✨ Highlights

- 🏠 **Real Dashboard** — greeting + 5 stat cards (★ stars, ⑂ forks, ◆ languages, ⏱ account age, ⚠ stale repos), profile mini with recent followers, **recent public activity heatmap** (public events only), **starred-activity sparkline** (repos you starred), top repos, language bar chart, live activity feed, **recent issues/PRs**, stale repos alert, trending-this-week, unread-notifications badge, **collapsible sections**.
- 📁 **Repos browser, supercharged** — row selection (`▶`), `Enter` drills into Analyze details, sortable columns, **type filter cycle** (`t`: all/sources/forks/archived/private/public/templates), **language facet** (`L`), **stale-only** toggle (`x`), **density toggle** (`D` switches between compact and comfortable), **pinned favorites** (`P` — stick to top, persisted on disk), inline visibility badges (🔒 private, 🔱 fork, 📦 archived, 🗄 template, 📌 pinned, ★ bookmarked), `g`/`G` jump-to-top/bottom.
- 🗂️ **File explorer** — `F` on Explore details opens a real in-terminal repo browser. Walk the tree, view files with line numbers + syntax highlighting for the supported top languages, browse per-file commit history and local blame, switch branches, **save individual files** (`s`), **save whole folders** recursively (`S`), **download zipballs** (`Z`) streamed straight to disk, **`git clone`** into your CWD (`C`), **`gh repo clone`** for private repos (`G`), copy raw URLs (`y`) or file contents (`Y`) to clipboard.
- 🔍 **Explore any public repo** — search, 2-column detail view (metadata + languages bar + top contributors + latest releases), pane tabs `[O] Overview / [i] Issues / [P] PRs / [R] README / [F] Files / [A] Packages / [T] Traffic / [K] Checks / [S] Security / [D] Compare`, branch/ref comparison, file history, local blame, and parallel ahead/behind compares on forks.
- 📊 **Repo Analytics** — Traffic (views/clones/popular paths/referrers), Checks/CI (pass/fail/pending summary), Security (Dependabot alerts with severity icons), cross-repository security aggregation, health scoring, and branch comparison.
- 📥 **Inbox triage** — color-coded notification types, grouping, snoozing, saved filters, mark-as-read (`m`) / mark-all (`M`) / unsubscribe (`u`) / filter cycle (`f`: all/unread/mentions/review), repo-grouped summary.
- 🎨 **Themes** — `light` (default) and `default` (dark) — each with a fully distinct palette using true-color (24-bit) and 256-color rendering. Persisted across sessions.
- ⚡ **Command Palette** — `Ctrl-P` or `:` opens a fuzzy-search modal listing every action.
- 📖 **README viewer** — `R` on the details pane renders the repo's README in-terminal with naive Markdown styling.
- ★ **Star anywhere** — `s` toggles a GitHub star on the highlighted repo (search results / details / forks / your repos).
- 📋 **OSC-52 clipboard** — `y` copies the current URL; works over SSH and inside tmux.
- 📉 **Live rate-limit indicator** — top-right of the screen; full breakdown (remaining/limit/reset minutes + **token scopes**) on the Settings tab.
- 💾 **ETag caching** — repeated GETs return 304 (saves bandwidth; authenticated 304s don't count against primary quota per GitHub docs). Disk-backed with LRU eviction, survives restarts.
- 🛡️ **Offline mode** — shows cached data with `⚠ OFFLINE` banner when network is unavailable.
- 📡 **Last-synced timestamps** — every tab shows when data was last refreshed.
- 📦 **Cache stats** — header shows cache size in KB; Settings → System shows full breakdown.
- 🔐 **Secure local auth** — PAT stored in the **OS keychain** (macOS Keychain, Linux libsecret, Windows Credential Manager); falls back to `~/.github-tui/token` with `chmod 600` when no keychain is available. Existing plaintext tokens are auto-migrated on first run. Masked while typing; auto-cleared on first 401.
- 🐙 **GitHub CLI login** — if `gh` CLI is installed, log in with one click (reads `gh auth token`). No PAT creation needed. Falls back to PAT login if `gh` is not available. Zero npm dependencies.
- 🖥️ **Diff-based renderer** — only changed cells are redrawn; resizes adaptively.
- 📝 **Issue/PR detail popup** — `Enter` on an issue or PR opens a full detail view with rendered body, labels, comments tab, **reviews tab**, and PR files tab. Comment (`c`), react (`r`), close/reopen (`x`), merge PR (`M`) — all from the TUI.
- 🔀 **PR diff viewer** — Files tab in the detail popup shows changed files with `+/-` stats. Select a file to view its unified diff with syntax-colored additions/deletions.
- 🖱️ **Mouse support** — click tabs, pane tabs, list items; scroll wheel navigation; hover effects with row highlighting on all list views.
- 📂 **Collapsible sections** — `z` toggle, `Z` collapse all, `X` expand all. State persisted to disk (`~/.github-tui/collapsed.json`).
- 📈 **Rate limit visual bar** — real-time `█░` indicator in the header showing API quota usage.
- 🎯 **Context-aware help** — `?` shows current tab's shortcuts first.
- ✏️ **Input cursor movement** — arrow keys, Home/End, Ctrl-A/E/U/W in all text inputs.
- 🛡️ **Graceful shutdown** — atomic signal handling, raw mode restored, debug logging on crash.

## 🚀 Run

Requires Node.js 18+.

### Quick start (no install)

```bash
npx github-tui
```

### Global install

```bash
npm install -g github-tui
github-tui
```

### From source

```bash
git clone https://github.com/unn-Known1/github-tui.git
cd github-tui
node app.mjs
```

### Update

```bash
npm update -g github-tui
```

### Run tests

```bash
npm test
```

First launch lands you on the Dashboard. Press `6` for Settings, then `Enter` on **Login**, and paste your GitHub Personal Access Token (the input is masked).

## 🔑 Creating a GitHub Personal Access Token

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)**.
2. Click **Generate new token**.
3. Recommended scopes: `repo`, `read:user`, `notifications`.
4. Copy the token, then paste it on the Settings tab → Login.

Your current token scopes are shown in the Settings → System panel so you can audit them at any time.

## ⌨️ Keyboard Shortcuts

### Global

| Key | Action |
|---|---|
| `1`–`6` / `Tab` / `Shift+Tab` | Switch tabs (Dashboard / Repos / Analyze / Actions / Inbox / Settings) |
| `Ctrl-P` or `:` | Open the command palette (fuzzy search every action) |
| `↑` `↓` or `j` `k` | Navigate lists |
| `Enter` | Select / drill in |
| `Esc` / `h` | Back (on Dashboard: quit confirmation) |
| `Space` | Load more (pagination) |
| `G` | Jump to bottom (Repos / Files) |
| `o` | Open the current item in your browser |
| `y` | Copy the current URL to clipboard (OSC-52) |
| `b` | Bookmark / unbookmark the current repo |
| `B` | Browse all bookmarks |
| `s` | Star / unstar the current repo on GitHub |
| `r` | Refresh the current view |
| `u` | Undo last destructive action |
| `Ctrl-Y` | Redo last undone action |
| `z` | Toggle collapsible section |
| `Z` | Collapse all sections |
| `X` | Expand all sections |
| `?` | Toggle help overlay |
| `q` / `Ctrl-C` | Quit |

### Repos tab

| Key | Action |
|---|---|
| `Enter` | Open the highlighted repo in Analyze → details (**double-click** a repo row does the same) |
| `/` | Substring filter (name + description + language) with qualifiers (`stars:>100`, `lang:rust`) |
| `c` | Clear **ALL** filters in one go |
| `t` | Cycle type filter: all → sources → forks → archived → private → public → templates |
| `L` | Filter by exact language… |
| `x` | Toggle stale-only (no push in last 6 months) |
| `D` | Density toggle (compact ↔ comfortable / shows description) |
| `P` | Pin / unpin highlighted repo (sticky top, persisted on disk) |
| `s` | Star / unstar highlighted repo — click the `[s] ★ Star` button too |
| `V` | Toggle starred / own repos |
| `g` / `G` | Jump to top / bottom |
| `n` `s` `f` `i` `u` | Sort by name / stars / forks / issues / updated (press again to reverse) |

### Analyze tab

| Key | Action |
|---|---|
| `i` | Open the search prompt (from details: toggle Issues pane) |
| `u` | Search GitHub users — `Enter` on a result lists all their public repos |
| `C` | Search code across GitHub |
| `S` / `U` | On a user's repo list: sort by **stars** / **last updated** (press again to reverse) |
| `Enter` | View details → from details: view Forks / **open Issue/PR detail popup** |
| `P` | Toggle PRs pane (on details view) |
| `O` | Reset to Overview pane (on details view) |
| `s` (Overview pane) | Star / unstar the open repo — also click the `[s] ★ Star` button in the title row |
| `R` | Open the README pane (renders Markdown in-terminal) |
| `F` | Open the **File explorer** pane |
| `T` | Open the **Traffic** pane (views/clones/popular paths) |
| `K` | Open the **Checks/CI** pane |
| `S` | Open the **Security** pane (Dependabot alerts) |
| `D` | Compare refs (`base...head`) on the **Compare** pane |
| `p` / `s` / `n` | On the Forks view: sort by last push / stars / name |
| `Enter` (code result) | Drill into the containing repo's file at the result path (`o` opens in browser) |
| `Space` | Load more search results or more forks |

### Issue/PR Detail Popup

| Key | Action |
|---|---|
| `Enter` on issue/PR | Open detail popup |
| `Esc` / `h` | Close popup (or back from diff view) |
| `↑↓` `j`/`k` | Scroll content |
| `Enter` (on body tab) | Cycle to next tab (Body → Comments → Reviews → Files) |
| `c` | **Comment** on the issue/PR |
| `r` | **React** — pick an emoji reaction |
| `x` | **Close** or **Reopen** the issue/PR |
| `M` | **Merge** the PR (with confirmation) |
| `y` | Copy the issue/PR URL to clipboard |
| `g` / `G` | Jump to top / bottom |

### Files pane (Analyze → `F`)

| Key | Action |
|---|---|
| `Enter` | Open dir / view file |
| `Esc` / `h` | Up a directory / leave viewer |
| `s` | **Save current file** to your CWD |
| `S` | **Save whole folder** recursively to your CWD (4-worker concurrent fetch) |
| `Z` | **Download repo zipball** to CWD (streamed straight to disk) |
| `C` | **`git clone`** repo into your CWD |
| `G` | **`gh repo clone`** (auth handled by `gh`, works for private repos) |
| `B` | Branch / tag picker overlay — switch the tree view |
| `y` | Copy raw github URL |
| `Y` | Copy file contents to clipboard (OSC-52, capped at ~75 KB) |
| `↑↓` `g` / end | Scroll / jump |

**Safety guarantees:** every disk write goes through `safeCwdJoin` which refuses any path that would escape your CWD. Clones refuse to overwrite an existing directory. Folder-save aborts at 500 files and suggests the zipball instead. The zipball downloader streams to disk without ever buffering the full archive in RAM.

### Forks view

| Key | Action |
|---|---|
| `p` `s` `n` | Sort by last push / stars / name |
| `Space` | Load the next 30 forks (compares run in parallel) |

### Actions tab

| Key | Action |
|---|---|
| `↑↓` `j` `k` | Navigate repos or runs |
| `Enter` | View runs for selected repo / expand or collapse job details |
| `r` / `R` | Re-run selected workflow (runs view) — in the repo list, `R` rescans for repos with workflows |
| `x` / `X` | Cancel selected running workflow (runs view) |
| `o` | Open selected run in browser |
| `t` / `Esc` | Back to repo list (from runs view) |
| `/` | Filter repos by name |

### Inbox

| Key | Action |
|---|---|
| `Enter` | Open Issue/PR inline detail popup; other notification types open the thread in the browser (falls back to the repo in Explore if no browser is available) |
| `Enter` (popup) | If the issue/PR failed to load, the popup stays open with the error — `r` retries, `Esc` closes |
| `o` | Open notification subject in browser |
| `m` | Mark the current thread as read |
| `M` | Mark all notifications as read |
| `u` | Unsubscribe from thread (DELETE subscription) |
| `f` | Cycle filter: all → unread → mentions → review |
| `/` | Text search across title and repo name |
| `G` | Toggle grouping by thread |
| `z` | Snooze thread for 1 hour |
| `Z` | Unsnooze current thread |
| `v` / `V` | Save / apply named filters |
| `Space` | Load more notifications (append next page) |
| `r` | Refresh notifications |

### Settings

| Key | Action |
|---|---|
| `↑↓` | Navigate menu items |
| `Enter` | Select / activate the highlighted item |
| `s` / `S` | Star the github-tui repo (show support!) |
| `o` | Open github-tui repo in browser |
| `r` | Refresh dashboard + user data |

## 🗂️ Project Layout

The app is split into focused zero-dependency modules. Adding a new tab is: create one file, register it in `state.mjs`, import it in `render.mjs` and `keys.mjs`. The command palette picks up new actions automatically when you call `palette.register({ id, label, run })`.

```
.
├── app.mjs                          # Entrypoint — lifecycle, CLI, and terminal wiring
├── README.md
├── VISION.md                        # Roadmap + persona-driven brainstorm
├── tests/                           # 329 tests (Node built-in test runner, zero deps)
│   ├── utils.test.mjs
│   ├── repos-logic.test.mjs
│   ├── theme.test.mjs
│   └── keychain.test.mjs
└── tui/
    ├── screen.mjs                   # Diff-based terminal renderer + buffer swap + FORCE_COLOR + CJK support
    ├── github.mjs                   # HTTPS client + ETag cache + 60+ endpoints + streaming downloader
    ├── config.mjs                   # Constants + token I/O (delegates to keychain.mjs) + JSON store helpers
    ├── keychain.mjs                 # OS keychain abstraction (macOS / Linux / Windows, zero deps)
    ├── utils.mjs                    # Pure helpers (time, format, OSC-52, openUrl, safeCwdJoin, runCommand)
    ├── state.mjs                    # Single appState + async-stale guard + message bus + collapsible state
    ├── input.mjs                    # Modal text input + cursor movement + handler registry + paste support
    ├── theme.mjs                    # 10 themes — persisted to ~/.github-tui/theme + NO_COLOR support
    ├── store.mjs                    # Bookmarks + saved searches + pins (on-disk JSON)
    ├── palette.mjs                  # Command palette (Ctrl-P) with fuzzy match
    ├── render.mjs                   # Top-level render: chrome + dispatch to tabs + hover effects
    ├── keys.mjs                     # Global key router + per-tab dispatchers + collapse handlers
    ├── mouse.mjs                    # Mouse event parsing + click/scroll/hover handlers (all tabs)
    ├── repos-logic.mjs              # Pure business logic — testable without global state
    ├── undo.mjs                     # Undo/redo system for destructive actions
    ├── virtual-scroll.mjs           # Virtual scrolling helper for large lists
    ├── error-recovery.mjs           # Error handling with contextual recovery hints
    ├── layout.mjs                   # Responsive layout system with percentage-based sizing
    ├── focus.mjs                    # Focus management with Tab/Shift+Tab navigation
    ├── custom-keys.mjs              # Custom user keybindings with schema validation
    ├── recommended-features.mjs     # Feature helpers: syntax, health, workflow, export, plugin validation
    ├── work-queue.mjs               # My Work queue aggregation
    ├── security-aggregate.mjs       # Cross-repository security alert aggregation
    ├── portability.mjs               # Safe JSON/Markdown configuration export/import
    ├── profiles.mjs                 # Account and GitHub Enterprise host profiles
    ├── organizations.mjs            # Organization, team, and repository context
    ├── plugins.mjs                  # Validated plugin discovery without execution
    ├── release-actions.mjs          # Draft, publish, and edit release workflows
    └── tabs/
        ├── dashboard.mjs            # Home screen with widgets + collapsible sections
        ├── repos.mjs                # Your repositories (selection, badges, filters, pins, density)
        ├── analyze.mjs              # Search + details + Issues/PRs/README/Files/Traffic/Checks/Security panes
        ├── detail.mjs               # Issue/PR detail popup with comments, reviews, reactions, diff viewer
        ├── files.mjs                # File explorer with history, blame, highlighting, save / clone / zipball
        ├── analyze-compare.mjs      # Branch and ref comparison pane
        ├── forks.mjs                # Forks sub-view with concurrent ahead/behind
        ├── settings.mjs             # Settings + System info panel
        ├── inbox.mjs                # Notifications with triage actions
        └── help.mjs                 # Help overlay (?) — context-aware
```

Every tab module exports `render(screen, y, h)`, an optional `keys` map for tab-local hotkeys, and optional `up`/`down`/`enter`/`space` dispatchers.

## 🧱 What Each Tab Shows

### 1 · Dashboard
- Time-of-day greeting (`Good morning/afternoon/evening, <you>`) with 🔔 unread badge.
- 5 stat cards: ★ Total Stars, ⑂ Total Forks, ◆ Distinct Languages, ⏱ Account Age, ⚠ Stale Repos. `Tab` to focus, `←/→` to move, `Enter` to drill in (e.g. Stale → Repos with stale filter).
- **Left:** profile mini (`@login`, email, followers/following counts, recent followers list), **recent public activity heatmap** (15-week grid from PushEvents; public events only, private contributions need GraphQL), **starred-activity sparkline** (repos you starred, last 30 days), top 5 repos by stars, language bar chart across all your repos.
- **Right:** Recent Activity feed (last ~10 events with colored icons per type + relative timestamps), **Recent Issues** (across your repos), **Recent Pull Requests** (across your repos), **Stale Repos Alert** (60+ days no push), 🔥 Trending This Week (top 5 public repos created in last 7 days, sorted by stars).
- **Collapsible sections** — all sections can be collapsed/expanded with `z`/`Z`/`X`.
- **Freshness + keys + layout:** per-widget freshness badges, `t` period / `/` filter / `l` local-repo keys, Top Repos + Stale keyboard zones (`Tab`/`Enter`), responsive single-column on <80 cols, SECURITY/MY WORK sections when data exists, `dashboard.json` prefs (hidden widgets + quick-actions toggle).

### 2 · Repos
- Header shows aggregate **★/⑂/⚡** totals across all your repos plus archived count.
- **Dismissible filter chips** above the list — each chip has an `✕` to remove just that filter. `c` still clears all in one go.
- Sortable columns and a substring filter (`/`) with qualifiers (`stars:>100`, `forks:>=10`, `issues:=0`, `lang:rust`, `language:go`).
- **Type cycle (`t`)** lets you jump straight to sources / forks / archived / private / public / templates.
- **Language facet (`L`)** narrows to one language.
- **Stale-only (`x`)** surfaces side-projects with no push in 6+ months.
- **Density (`D`)** toggles between compact (1 line/row) and comfortable (description shown on row+1).
- **Pins (`P`)** float favorites to the top with a `★ PINNED` section header — persisted on disk so they survive restarts.
- Each row shows visibility badges (🔒 private, 🔱 fork, 📦 archived, 🗄 template, 📌 pinned, ★ bookmarked) and a relative push time.
- **Real issue counts** — GitHub's `open_issues_count` combines issues *and* PRs, so the ISSUES column (and header total) subtracts each repo's open PR count (probed lazily via `/pulls`, cached 10 min) to show true open issues. The Analyze detail's "Open Issues" row uses the same value.
- `Space` paginates beyond the first 30 (`l` / palette `repos.load-more` continues a capped background fetch). `Enter` opens the repo in Analyze details.

### 3 · Analyze
- Search any public repo. `Enter` opens a 2-column detail view.
- `u` searches GitHub users; `Enter` on a user lists all their public repos (paginated with `Space`), and `Enter` on a repo drills into full details.
- `C` searches code across GitHub.
- **Pane tabs:** `[O] Overview`, `[i] Issues (N)`, `[P] PRs (N)`, `[R] README`, `[F] Files`, `[A] Packages`, `[T] Traffic`, `[K] Checks`, `[S] Security`, `[D] Compare`.
- Overview = metadata column + (languages bar chart / top contributors / latest releases) column.
- README pane renders Markdown with naive styling (headings bold, lists in accent color, code fences dimmed).
- **Traffic pane** = views, clones, popular paths, popular referrers.
- **Checks/CI pane** = check runs with pass/fail/pending summary.
- **Security pane** = Dependabot alerts with severity icons.
- **Files pane** = full in-terminal file browser + viewer with save/clone/zipball actions (see above).
- From details: `Enter` opens Forks with ahead/behind columns; `Space` paginates more.

### 4 · Actions (CI)
- The repo list shows **only repositories that have GitHub Actions workflows** — detected once per session by probing each repo's `/actions/workflows` endpoint (bounded 5-way concurrency; repos that can't be probed stay visible). Press `R` in the repo list to rescan, e.g. after adding a workflow.
- Select a repo from the list to browse its workflow runs.
- Each run row shows: status icon (`✓`/`✗`/`~`/`ø`), run number, workflow name, branch, trigger event, and relative age.
- `Enter` expands a run to show its jobs and steps inline; press `Enter` again to collapse.
- `r`/`R` re-queues the selected run; `X` cancels it if in-progress.
- `/` filters the repo list; `t`/`Esc` returns from runs view to repo list.
- `r` refreshes the current view (repo list or runs list).

### 5 · Settings
- **Authentication:** Login (GitHub CLI) — uses `gh auth token` if `gh` is installed; Login (PAT) — paste a Personal Access Token; Logout.
- **Actions:** Refresh Dashboard, Refresh User Data (`r` refreshes both), Auto-Refresh (interval persists across restarts), **Change Theme**, Clear Token File, Token display.
- **Integrations:** Enterprise host, profiles list/switch, organizations, config export/import.
- **Data management:** Clear Local Data (bookmarks/pins/searches/filters/sections/cache) with per-store counts in the System panel.
- **System panel:** app version (`0.7.2`), config dir, token file path, Node version, platform/arch, terminal size, **API remaining / limit / reset-in minutes**, **token scopes**, active keychain backend.

### 6 · Inbox
- Per-row: ▶ selection, ● yellow unread dot, color-coded subject type (PR/cyan, Issue/yellow, Release/green, Discussion/magenta, Commit/blue, CheckSuite/red), repo·title, reason, relative time.
- Header shows unread/total counts + active filter (`all` / `unread` / `mentions` / `review`).
- Right-side **By Repo** widget — top 5 noisiest repos with counts.
- `/` text search filters by title and repo name simultaneously.
- `Space` appends the next page of notifications without replacing the current list.
- `u` unsubscribes from the thread (calls DELETE on the GitHub subscription endpoint).
- Triage actions: `m`/`M`/`u`/`f`.

## 🧠 Design Notes

- **Zero npm dependencies.** Only Node's built-in `https`, `fs`, `os`, `path`, `child_process`. Tests use Node's built-in test runner.
- **Secure token storage.** PAT is stored in the OS keychain (macOS Keychain / Linux libsecret / Windows Credential Manager) using only built-in CLI tools — no npm packages. Falls back to `chmod 600` plaintext when no keychain is available. Existing plaintext tokens are silently migrated.
- **Single source of truth.** `tui/state.mjs` holds one `appState` object. ESM live bindings mean every module sees updates instantly without a pub/sub layer.
- **Pure business logic.** `repos-logic.mjs` contains testable functions decoupled from global state — `sortRepos`, `applyAllFilters`, `floatPinsToTop` accept parameters, not globals.
- **Stale-async guard.** Every long-running fetch grabs a generation number from `startAsync()`. If the user navigates away, `isStale(gen)` returns true and results are discarded. No "snap-back" to old state.
- **Bounded concurrency.** Fork ahead/behind compares run with a 5-worker pool. Folder-save uses a 4-worker pool. Dashboard widgets and repo details enrichment fetch in parallel with per-call fault tolerance.
- **ETag cache.** Every GET response with an `ETag` header is cached; subsequent identical GETs send `If-None-Match` and a 304 returns the cached body (saves bandwidth; authenticated 304s don't count against primary quota per GitHub docs).
- **Streaming downloads.** Zipballs never buffer in memory — they pipe straight to disk via Node's `https`.
- **CWD safety.** Every disk write goes through `safeCwdJoin` which refuses any path that would escape `process.cwd()`. Clones refuse to overwrite an existing directory.
- **Diff-based renderer.** `tui/screen.mjs` uses buffer swapping (zero allocation after warm-up) and only emits cursor moves + characters that actually changed. CJK/wide character support for proper alignment.
- **Cross-platform rendering.** Box-drawing characters fall back to ASCII on Windows. `FORCE_COLOR`/`NO_COLOR` env vars respected. 16-color fallback for terminals without 256-color support.
- **Theme-aware rendering.** Tab renderers call `theme.color('star')` instead of hardcoding `'yellow'`, so new themes drop in without touching any tab.
- **Command palette.** Actions register themselves; the palette is just a fuzzy filter over the registry. New features can expose actions without touching any UI code.
- **Mouse support.** Full mouse tracking with click, scroll wheel, and hover effects on all list views.
- **Collapsible sections.** All sections across Dashboard, Repos, Analyze, and Inbox can be collapsed/expanded. State persisted to disk.
- **Graceful shutdown.** Single atomic handler restores raw mode, disables mouse, clears screen — no double-calls, no broken terminals.
- **Undo/redo.** Destructive actions (bookmark removal, star/unstar, unsubscribe, issue close) are undoable with `u`/`Ctrl-Y`. Stack persists for the session.
- **Error recovery.** Contextual error messages with recovery hints and retry support. Recognizes common error patterns (auth, rate limit, network, etc.).
- **Responsive layout.** Terminal width breakpoints (xs/sm/md/lg/xl) adapt column widths, card layouts, and detail popups.
- **Focus management.** Tab/Shift+Tab navigation between focus zones per tab.
- **Paste handling.** Bracketed paste mode for proper multi-line text insertion.
- **Render debouncing.** Microtask batching prevents render flooding during rapid state changes.
- **Resize recovery.** Scroll positions and selection indices are automatically adjusted after terminal resize.

## ⚠️ Limitations

- Token is stored in the OS keychain where available (macOS Keychain, Linux libsecret, Windows Credential Manager). On systems without a supported keychain tool, it falls back to plaintext with `chmod 600` file permissions.
- **Optional system dependency:** GitHub CLI (`gh`) for one-click login. Not required — PAT login always works. Install from [cli.github.com](https://cli.github.com).
- Read/write actions are confirmation-protected and ship in waves:
  - ✅ **shipped:** star/unstar, bookmark, pin, save file, save folder, zipball, `git clone`, `gh clone`, notification mark/unsubscribe.
  - ✅ **shipped (v0.5):** commenting on issues/PRs, reactions, close/reopen, merge PRs, PR diff viewer, review comments.
  - ✅ **shipped (v0.5.8):** rate limit indicator, traffic/milestones/labels/checks/security panes, mouse support, collapsible sections, hover effects, followers section, Windows and terminal icon compatibility, File Explorer selection fixes, help overlay scroll clamping.
  - ✅ **shipped (v0.6.2):** Actions tab full rewrite (rerun, cancel, expand jobs/steps, correct key bindings), Inbox triage fixes (append-more, true unsubscribe, filtered scroll bounds, fallback URLs).
  - ✅ **shipped (v0.7.0):** workflow logs/dispatch/failure queue, PR review submission, issue metadata updates, release actions, security aggregation, repository health, compare/history/blame, Inbox grouping/snoozing/saved filters, configuration portability, Enterprise profiles, organization context, CLI output, and linear accessibility.
- Only the GitHub REST v3 API is used (no GraphQL yet).
- Requires a true TTY — won't run when stdin is piped.
- File syntax highlighting is intentionally lightweight and read-only; it tokenizes common constructs for the supported top languages rather than providing a full compiler-grade lexer.

## 🔭 Roadmap (from VISION.md)

**Shipped in v0.3:** Modular refactor, command palette, themes, inbox triage, README viewer pane, OSC-52 clipboard copy, bookmarks store, star/unstar, ETag cache, token-scope inspector.

**Shipped in v0.3.1:** Repos tab row selection + Enter drill-in, type/language/stale filters, density toggle, pins, visibility badges, relative-time column, jump-to-top/bottom. **File explorer** with tree browsing, file viewer (line numbers + syntax coloring), branch picker, save file / save folder / download zipball / git clone / gh clone — all CWD-safe.

**Shipped in v0.4:** Dashboard enhancements — contribution heatmap (15-week grid), star history sparkline (30-day trend), recent issues/PRs activity, stale repos alert (60+ days), quick-actions hint bar under stat cards ([r]/[t]/[/]/[l]/[Tab]).

**Shipped in v0.5:** Issue/PR detail popup with rendered body, labels, comments, and file diffs. Comment from TUI, emoji reactions, close/reopen, merge PRs with confirmation. PR diff viewer with unified diff and syntax coloring. Inbox notifications open detail popup for issues/PRs.

**Shipped in v0.7.0:**
- **Dashboard and interaction hardening** — repaired keyboard/mouse focus, custom-section navigation, page scrolling, refresh freshness, local filtering, partial-failure handling, retryable Trending errors, and compact Needs Attention actions.
- **CI cockpit** — added workflow logs, workflow dispatch with validated inputs, failed-run aggregation, pagination, and corrected Actions shortcuts.
- **Review and repository workflows** — added PR review submission and reviewer requests, issue metadata updates, release draft/publish/edit actions, branch comparison, repository health scoring, security aggregation, per-file history, local blame, and syntax-highlighted file viewing.
- **Inbox and portability** — added grouping, snoozing, saved filters, custom Dashboard section editing, Enterprise/account profiles, organization context, JSON/Markdown config export/import, read-only CLI commands, linear accessibility, and validated plugin discovery.
- **Cleanup and regression coverage** — removed confirmed dead imports and duplicate tests; **269 / 269 tests pass** with import and syntax checks clean.

**Shipped in v0.7.1:**
- **Inbox** — Enter opens issue/PR popups (retryable inline errors instead of silent close), other notification types open the actual thread in the browser with an Explore fallback, empty-state diagnostics reveal hidden filters, `/` search prefills the active filter, `G`/`z` keys dispatch, stale-scroll self-healing, snoozed-count indicators.
- **Repos** — true open-issue counts (ISSUES column excludes pull requests), double-click opens a row like Enter with ±2-cell jitter tolerance, starring from Explore details.
- **Actions** — lists only repositories with GitHub workflows (`R` rescans).
- **Dashboard** — trending fills the window and single-click highlight is reliable.
- **Detail popup** — key routing and overlay layering fixed; inline load errors with retry.
- **Removed** the Milestones/Labels detail panes and their modules.
- **269 / 269 tests pass** with import and syntax checks clean.

**Shipped in v0.7.2:**
- **Dashboard** — honest freshness (per-widget badges stamp only on success), starred-activity sparkline relabel + `--accessible` fix, CI attention from the failures queue, expanded-by-default sections, Top Repos + Stale keyboard zones, single-column layout under 80 cols, per-widget TTL + memoized derived caches, SECURITY/MY WORK sections, `dashboard.json` prefs + quick-actions hint bar.
- **Explore** — footer/help no longer advertise removed panes, compact pane chips on narrow terminals, per-pane Issues/PRs filters with auto-refetch, honest fork ahead/behind (`?` on failure) + compare cache, scrollable landing, append-model paging, code-result drill-in to the Files pane, `stars:`/`forks:`/`issues:`/`lang:` search qualifiers.
- **Settings + Inbox** — danger-row mouse routing fixed, disabled-row guards, INTEGRATIONS menu rows (Enterprise/profiles/export/import), store counts + Clear Local Data, persisted auto-refresh; Inbox viewport math unified, mark-group-read, durable snooze + `Z` unsnooze, visible-scoped mark-all, reason labels, memoized filter pipeline.
- **Repos + Actions** — `repos.load-more` palette action, append-model paging, isolated starred async scope, ordered background prefetch, `activeRepo()` snapshot so filter-then-act can't hit the wrong repo, rerun confirm, preserved expansion across refreshes, bounded progressive workflow scan, honest failure-queue coverage.
- **329 / 329 tests pass** with import and syntax checks clean.

**Shipped in v0.6.7:**
- **Audit hardening** — fixed lifecycle cleanup, upgrade-note gating, account-safe logout/reset, token-partitioned ETag caching, secure streamed downloads, stale-request cancellation, filtered Inbox actions, Settings navigation, starred pagination, and Unicode input cursor handling.
- **Regression coverage** — focused tests cover cache isolation, repository path encoding, HTTPS download enforcement, filtered Inbox selection, and release-note lifecycle. **222 / 222 tests pass.**

**Shipped in v0.6.6:**
- **Gap-audit closeout** — full P0 + P1 sweep (see [CHANGELOG.md](CHANGELOG.md) for the 7 P0 + 13 P1 entries). Highlights: `--accessible` mode for screen readers, automatic loading watchdog via `Object.defineProperty` setter, retry-hint footer, contextual empty-state cards, POWER-USER help category (Ctrl-P / Ctrl-S / Ctrl-K / Ctrl-Y), `Analyze → Explore` rename sweep.
- **Dashboard follow-up polish:**
  - **F1 `l`-key double-binding fixed** — global `keys.mjs` no longer shadows the per-tab `localRepoFilter` toggle; card navigation now stays on Right arrow + uppercase `L`.
  - **F3 Recent Activity zone added** — Tab reaches the activity list; `[Enter] open repo` drills into the affected repository via Explore.
  - **All 5 stat cards now have a sensible action** — `LANGUAGES` (i=2) → Repos + language-chip sidebar; `ACCOUNT AGE` (i=3) → user profile in browser; `STARS` / `FORKS` / `STALE` unchanged.
  - **Failure + freshness banner row** at the header right — red `⚠ N widget(s) failed` (left) surfaces silent `Promise.allSettled` rejections; dim `Updated Xm ago` (right) shows freshness.
  - **`clampList()` self-heals stale selection/scroll** when a refresh shrinks a list (events / trending / issues / PRs).
  - **FOCUS_ZONES re-ordered** to `cards → activity → issues → prs → trending` for top-to-bottom Tab flow through the right column.
- **Internal:** trending-pagination fetch dedup (~80 lines removed into `_fetchTrendingPage` + `_setTrendingPage`), dead `ZONES` const + `cycleDashboardZone` export removed, custom-section loader now logs to stderr under `DEBUG`.
- **Tests:** 213 / 213 passing (was 208 / 208).

**Shipped in v0.6.3:**
- **GitHub CLI login** — new "Login (GitHub CLI)" option in Settings. Uses `gh auth token` for zero-friction auth — no PAT creation needed if `gh` is installed. Graceful degradation: option grayed out if `gh` not available. Zero npm dependencies.
- **Undo/Redo system** — destructive actions (bookmark removal, star/unstar, unsubscribe, issue close) are now undoable with `u`/`Ctrl-Y`. Full 20-entry undo stack with convenience functions.
- **Virtual scrolling helper** — standardized module for efficient rendering of large lists with viewport calculation, scroll handling, and mouse wheel support.
- **Error recovery system** — contextual error messages with recovery hints and retry support. Recognizes 8 error patterns (auth, rate limit, network, timeout, SSL) and suggests appropriate actions.
- **Responsive layout system** — terminal width breakpoints adapt column widths, card layouts, and detail popups. Repos tab and dashboard stat cards now scale gracefully.
- **Focus management** — Tab/Shift+Tab navigation between focus zones per tab with canFocus() guards.
- **Paste handling** — bracketed paste mode for proper multi-line text insertion. Pasted content is inserted atomically.
- **Per-widget loading states** — dashboard widgets track individual loading state for granular UI feedback.
- **Custom keybindings validation** — invalid entries now show warnings with specific error messages.
- **CJK/wide character support** — strWidth() now correctly counts CJK characters as width 2 with proper ESC sequence handling.
- **16-color fallback** — terminals without 256-color support get nearest ANSI color mapping.
- **Confirm dialog fix** — Enter now confirms, Escape/cancel works correctly.
- **Render debouncing** — microtask batching prevents render flooding.
- **Key repeat debouncing** — arrow keys held down are debounced at ~60fps.
- **Resize recovery** — scroll positions and selection indices automatically adjusted after terminal resize.
- **Dynamic import optimization** — custom keybindings module lazy-loaded once at startup.
- **Mouse coordinate constants** — extracted TAB_CONTENT_Y for consistent layout.
- **Removed _global scope fallback** — startAsync() now requires explicit scope string.
- **30 modules** — codebase expanded from 24 to 30 focused modules.

**Shipped in v0.6.2:**
- **Actions tab overhaul** — fixed 8 bugs: stale loading flag, wrong repo shown under filter, Esc no-op in repos view, up/down moving wrong cursor when expanded, maxVisible capped at 10 rows, `r`/`X` keys shadowed by globals (rerun/cancel never fired), refresh always reset to repos list instead of reloading runs.
- **Inbox tab overhaul** — fixed 8 bugs: Space was loading the next server page (replacing list) instead of appending; `inboxHasMore` initialized to `true` causing a spurious page-2 request; `unsubscribeNotification` was muting (PUT) instead of unsubscribing (DELETE); mouse hover and scroll used unfiltered count instead of filtered; click always jumped scroll even when item was visible; `down()` crashed without a screen object; `openCurrent` had no fallback URL for Discussion/CheckSuite notifications.
- **Zero dependencies** — removed stray `@anthropic-ai/claude-code` entry from `package.json`; added `.gitignore` to exclude `package-lock.json`.
- **128 tests** — all passing.

**Shipped in v0.6.1:**
- **15 bug fixes** across input, keys, mouse, github, keychain, repos, detail, and inbox modules — falsy-zero cursor, emoji code-point insertion, duplicate case labels, left-arrow back nav, toggleStar re-entrancy, custom-keys context check, hover offsets, scroll bounds, `isStarred` error swallowing, workflow signal support, cmd.exe metachar escaping, `_filteredReposCount`, starred pagination mapping, footer range, `loadDetail` stale paths, `mergePR` null-check, and null URL crash.
- **Version string** unified — `APP_VERSION` in `tui/config.mjs` now matches `package.json`.

**Shipped in v0.6.0:**
- **OS keychain integration** — PAT stored in macOS Keychain, Linux libsecret, or Windows Credential Manager using zero npm dependencies. Automatic silent migration from legacy plaintext file. Falls back to `chmod 600` plaintext when no keychain tool is available. Settings tab shows active storage backend in green (secure) or yellow (plaintext fallback).
- **90 tests** — added `keychain.test.mjs` covering backend detection, save/load/remove contract, and round-trip behaviour.

**Shipped in v0.5.8:**
- **Graceful shutdown** — atomic signal handling, raw mode restore, unhandled rejection/crash handlers, debug logging.
- **Terminal lifecycle** — debounced resize, buffer-swap renderer (zero allocation), NO_COLOR/FORCE_COLOR support, terminal multiplexer detection.
- **Input cursor movement** — arrow keys, Home/End, Ctrl-A/E/U/W in all text inputs.
- **Context-aware help** — `?` shows current tab's shortcuts first.
- **Mouse hover on all lists** — Repos, Inbox, Actions tabs now highlight on hover.
- **Esc on Dashboard** — shows quit confirmation dialog.
- **Pure business logic** — `repos-logic.mjs` extracted for testability.
- **81 tests** — Node built-in test runner, zero dependencies.
- **Windows compatibility** — ASCII box-drawing fallback, platform-aware cursor handling.

**Shipped in v0.5.7:**
- **Rate limit indicator** — visual `█░` bar in header + explicit `/rate_limit` endpoint
- **Traffic pane** — views, clones, popular paths, popular referrers
- **Milestones pane** — title, state, due date, open/closed issues
- **Labels pane** — color dots, name, description
- **Checks/CI pane** — check runs with pass/fail/pending summary
- **Security pane** — Dependabot alerts with severity icons
- **Review Comments** — Reviews tab in PR detail view with state icons
- **Mouse support** — click tabs/panes/items, scroll wheel, hover effects
- **Collapsible sections** — `z`/`Z`/`X` keys, disk persistence
- **Followers section** — recent followers in Dashboard profile
- **8 themes** — added light theme

See **VISION.md** for the full multi-version plan, 10 user personas, 16 feature categories, and 10 named workflow recipes.

## 📄 License

MIT.
