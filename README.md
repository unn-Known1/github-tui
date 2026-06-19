# GitHub TUI

A fast, zero-dependency terminal user interface for GitHub — six tabs, a command palette, an in-terminal file explorer that can clone or save anything to your CWD, an inbox triage workflow, themes, persistent bookmarks & pins, OSC-52 clipboard, ETag-aware caching, mouse support, collapsible sections, and comprehensive repo analytics. All driven by your keyboard (and mouse).

![status](https://img.shields.io/badge/status-active-success) ![node](https://img.shields.io/badge/node-%E2%89%A518-blue) ![deps](https://img.shields.io/badge/deps-0-green) ![license](https://img.shields.io/badge/license-MIT-blue)

## GitHub / User
- Remote: `https://github.com/unn-Known1/github-tui`
- Author: unn-Known1
- Email: ptelgm.yt@gmail.com

## ✨ Highlights

- 🏠 **Real Dashboard** — greeting + 5 stat cards (★ stars, ⑂ forks, ◆ languages, ⏱ account age, ⚠ stale repos), profile mini with recent followers, **contribution heatmap**, **star history sparkline**, top repos, language bar chart, live activity feed, **recent issues/PRs**, stale repos alert, trending-this-week, unread-notifications badge, **collapsible sections**.
- 📁 **Repos browser, supercharged** — row selection (`▶`), `Enter` drills into Analyze details, sortable columns, **type filter cycle** (`t`: all/sources/forks/archived/private/public/templates), **language facet** (`L`), **stale-only** toggle (`x`), **density toggle** (`D` switches between compact and comfortable), **pinned favorites** (`P` — stick to top, persisted on disk), inline visibility badges (🔒 private, 🔱 fork, 📦 archived, 🗄 template, 📌 pinned, ★ bookmarked), `g`/`G` jump-to-top/bottom.
- 🗂️ **File explorer** — `F` on Analyze details opens a real in-terminal repo browser. Walk the tree, view files with line numbers + naive syntax coloring, switch branches, **save individual files** (`s`), **save whole folders** recursively (`S`), **download zipballs** (`Z`) streamed straight to disk, **`git clone`** into your CWD (`C`), **`gh repo clone`** for private repos (`G`), copy raw URLs (`y`) or file contents (`Y`) to clipboard.
- 🔍 **Analyze any public repo** — search, 2-column detail view (metadata + languages bar + top contributors + latest releases), pane tabs `[O] Overview / [i] Issues / [P] PRs / [R] README / [F] Files / [T] Traffic / [M] Milestones / [L] Labels / [K] Checks / [S] Security`, parallel ahead/behind compares on forks.
- 📊 **Repo Analytics** — Traffic (views/clones/popular paths/referrers), Milestones (title/state/due/issues), Labels (color dots/descriptions), Checks/CI (pass/fail/pending summary), Security (Dependabot alerts with severity icons).
- 📥 **Inbox triage** — color-coded notification types, mark-as-read (`m`) / mark-all (`M`) / unsubscribe (`u`) / filter cycle (`f`: all/unread/mentions/review), repo-grouped summary.
- 🎨 **Themes** — `default`, `highContrast`, `dracula`, `solarized`, `nord`, `monokai`, `gruvbox` — persisted across sessions.
- ⚡ **Command Palette** — `Ctrl-P` or `:` opens a fuzzy-search modal listing every action.
- 📖 **README viewer** — `R` on the details pane renders the repo's README in-terminal with naive Markdown styling.
- ★ **Star anywhere** — `s` toggles a GitHub star on the highlighted repo (search results / details / forks / your repos).
- 📋 **OSC-52 clipboard** — `y` copies the current URL; works over SSH and inside tmux.
- 📉 **Live rate-limit indicator** — top-right of the screen; full breakdown (remaining/limit/reset minutes + **token scopes**) on the Settings tab.
- 💾 **ETag caching** — repeated GETs return 304 and don't cost any rate-limit budget.
- 🔐 **Secure local auth** — PAT stored at `~/.github-tui/token` with `chmod 600`; masked while typing; auto-cleared on first 401.
- 🖥️ **Diff-based renderer** — only changed cells are redrawn; resizes adaptively.
- 📝 **Issue/PR detail popup** — `Enter` on an issue or PR opens a full detail view with rendered body, labels, comments tab, **reviews tab**, and PR files tab. Comment (`c`), react (`r`), close/reopen (`x`), merge PR (`M`) — all from the TUI.
- 🔀 **PR diff viewer** — Files tab in the detail popup shows changed files with `+/-` stats. Select a file to view its unified diff with syntax-colored additions/deletions.
- 🖱️ **Mouse support** — click tabs, pane tabs, list items; scroll wheel navigation; hover effects with row highlighting.
- 📂 **Collapsible sections** — `z` toggle, `Z` collapse all, `X` expand all. State persisted to disk (`~/.github-tui/collapsed.json`).
- 📈 **Rate limit visual bar** — real-time `█░` indicator in the header showing API quota usage.

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
| `Esc` / `h` | Back |
| `Space` | Load more (pagination) |
| `G` | Jump to bottom (Repos / Files) |
| `o` | Open the current item in your browser |
| `y` | Copy the current URL to clipboard (OSC-52) |
| `b` | Bookmark / unbookmark the current repo |
| `B` | Browse all bookmarks |
| `s` | Star / unstar the current repo on GitHub |
| `r` | Refresh the current view |
| `z` | Toggle collapsible section |
| `Z` | Collapse all sections |
| `X` | Expand all sections |
| `?` | Toggle help overlay |
| `q` / `Ctrl-C` | Quit |

### Repos tab

| Key | Action |
|---|---|
| `Enter` | Open the highlighted repo in Analyze → details |
| `/` | Substring filter (name + description + language) |
| `c` | Clear **ALL** filters in one go |
| `t` | Cycle type filter: all → sources → forks → archived → private → public → templates |
| `L` | Filter by exact language… |
| `x` | Toggle stale-only (no push in last 6 months) |
| `D` | Density toggle (compact ↔ comfortable / shows description) |
| `P` | Pin / unpin highlighted repo (sticky top, persisted on disk) |
| `V` | Toggle starred / own repos |
| `g` / `G` | Jump to top / bottom |
| `n` `s` `f` `i` `u` | Sort by name / stars / forks / issues / updated (press again to reverse) |

### Analyze tab

| Key | Action |
|---|---|
| `i` | Open the search prompt (from details: toggle Issues pane) |
| `Enter` | View details → from details: view Forks / **open Issue/PR detail popup** |
| `P` | Toggle PRs pane (on details view) |
| `O` | Reset to Overview pane (on details view) |
| `R` | Open the README pane (renders Markdown in-terminal) |
| `F` | Open the **File explorer** pane |
| `T` | Open the **Traffic** pane (views/clones/popular paths) |
| `M` | Open the **Milestones** pane |
| `L` | Open the **Labels** pane |
| `K` | Open the **Checks/CI** pane |
| `S` | Open the **Security** pane (Dependabot alerts) |
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
| `Enter` | View runs for selected repo / open run in browser |
| `r` | Re-run selected workflow |
| `x` | Cancel running workflow |
| `t` | Back to repo list (from runs view) |
| `/` | Filter repos |

### Inbox

| Key | Action |
|---|---|
| `Enter` / `o` | Open notification's subject in browser |
| `m` | Mark the current thread as read |
| `M` | Mark all notifications as read |
| `u` | Unsubscribe (ignore future updates to thread) |
| `f` | Cycle filter: all → unread → mentions → review |
| `r` | Refresh notifications |

## 🗂️ Project Layout

The app is split into 23 focused modules. Adding a new tab is: create one file, register it in `state.mjs`, import it in `render.mjs` and `keys.mjs`. The command palette picks up new actions automatically when you call `palette.register({ id, label, run })`.

```
.
├── app.mjs                          # ~70-line entrypoint — lifecycle only
├── README.md
├── VISION.md                        # Roadmap + persona-driven brainstorm
└── tui/
    ├── screen.mjs                   # Diff-based terminal renderer
    ├── github.mjs                   # HTTPS client + ETag cache + 60+ endpoints + streaming downloader
    ├── config.mjs                   # Constants + token I/O + JSON store helpers
    ├── utils.mjs                    # Pure helpers (time, format, OSC-52, openUrl, safeCwdJoin, runCommand)
    ├── state.mjs                    # Single appState + async-stale guard + message bus + collapsible state
    ├── input.mjs                    # Modal text input + handler registry
    ├── theme.mjs                    # 8 themes — persisted to ~/.github-tui/theme
    ├── store.mjs                    # Bookmarks + saved searches + pins (on-disk JSON)
    ├── palette.mjs                  # Command palette (Ctrl-P) with fuzzy match
    ├── render.mjs                   # Top-level render: chrome + dispatch to tabs + hover effects
    ├── keys.mjs                     # Global key router + per-tab dispatchers + collapse handlers
    ├── mouse.mjs                    # Mouse event parsing + click/scroll/hover handlers
    └── tabs/
        ├── dashboard.mjs            # Home screen with widgets + collapsible sections
        ├── repos.mjs                # Your repositories (selection, badges, filters, pins, density)
        ├── analyze.mjs              # Search + details + Issues/PRs/README/Files/Traffic/Milestones/Labels/Checks/Security panes
        ├── detail.mjs               # Issue/PR detail popup with comments, reviews, reactions, diff viewer
        ├── files.mjs                # In-terminal file explorer with save / clone / zipball
        ├── forks.mjs                # Forks sub-view with concurrent ahead/behind
        ├── settings.mjs             # Settings + System info panel
        ├── inbox.mjs                # Notifications with triage actions
        └── help.mjs                 # Help overlay (?)
```

Every tab module exports `render(screen, y, h)`, an optional `keys` map for tab-local hotkeys, and optional `up`/`down`/`enter`/`space` dispatchers.

## 🧱 What Each Tab Shows

### 1 · Dashboard
- Time-of-day greeting (`Good morning/afternoon/evening, <you>`) with 🔔 unread badge.
- 5 stat cards: ★ Total Stars, ⑂ Total Forks, ◆ Distinct Languages, ⏱ Account Age, ⚠ Stale Repos. `Tab` to focus, `←/→` to move, `Enter` to drill in (e.g. Stale → Repos with stale filter).
- **Left:** profile mini (`@login`, email, followers/following counts, recent followers list), **contribution heatmap** (15-week grid from PushEvents), **star history sparkline** (last 30 days), top 5 repos by stars, language bar chart across all your repos.
- **Right:** Recent Activity feed (last ~10 events with colored icons per type + relative timestamps), **Recent Issues** (across your repos), **Recent Pull Requests** (across your repos), **Stale Repos Alert** (60+ days no push), 🔥 Trending This Week (top 5 public repos created in last 7 days, sorted by stars).
- **Collapsible sections** — all sections can be collapsed/expanded with `z`/`Z`/`X`.

### 2 · Repos
- Header shows aggregate **★/⑂/⚡** totals across all your repos plus archived count.
- **Dismissible filter chips** above the list — each chip has an `✕` to remove just that filter. `c` still clears all in one go.
- Sortable columns and a substring filter (`/`).
- **Type cycle (`t`)** lets you jump straight to sources / forks / archived / private / public / templates.
- **Language facet (`L`)** narrows to one language.
- **Stale-only (`x`)** surfaces side-projects with no push in 6+ months.
- **Density (`D`)** toggles between compact (1 line/row) and comfortable (description shown on row+1).
- **Pins (`P`)** float favorites to the top with a `★ PINNED` section header — persisted on disk so they survive restarts.
- Each row shows visibility badges (🔒 private, 🔱 fork, 📦 archived, 🗄 template, 📌 pinned, ★ bookmarked) and a relative push time.
- `Space` paginates beyond the first 30. `Enter` opens the repo in Analyze details.

### 3 · Analyze
- Search any public repo. `Enter` opens a 2-column detail view.
- **Pane tabs:** `[O] Overview`, `[i] Issues (N)`, `[P] PRs (N)`, `[R] README`, `[F] Files`, `[T] Traffic`, `[M] Milestones`, `[L] Labels`, `[K] Checks`, `[S] Security`.
- Overview = metadata column + (languages bar chart / top contributors / latest releases) column.
- README pane renders Markdown with naive styling (headings bold, lists in accent color, code fences dimmed).
- **Traffic pane** = views, clones, popular paths, popular referrers.
- **Milestones pane** = title, state, due date, open/closed issues.
- **Labels pane** = color dots, name, description.
- **Checks/CI pane** = check runs with pass/fail/pending summary.
- **Security pane** = Dependabot alerts with severity icons.
- **Files pane** = full in-terminal file browser + viewer with save/clone/zipball actions (see above).
- From details: `Enter` opens Forks with ahead/behind columns; `Space` paginates more.

### 4 · Settings
- **Actions:** Login, Logout, Refresh Dashboard, Refresh User Data, **Change Theme**, Clear Token File, Token display.
- **System panel:** app version, config dir, token file path, Node version, platform/arch, terminal size, **API remaining / limit / reset-in minutes**, **token scopes**.

### 5 · Inbox
- Per-row: ▶ selection, ● yellow unread dot, color-coded subject type (PR/cyan, Issue/yellow, Release/green, Discussion/magenta, Commit/blue, CheckSuite/red), repo·title, reason, relative time.
- Header shows unread/total counts + active filter (`all` / `unread` / `mentions` / `review`).
- Right-side **By Repo** widget — top 5 noisiest repos with counts.
- Triage actions: `m`/`M`/`u`/`f`.

## 🧠 Design Notes

- **Zero npm dependencies.** Only Node's built-in `https`, `fs`, `os`, `path`, `child_process`.
- **Single source of truth.** `tui/state.mjs` holds one `appState` object. ESM live bindings mean every module sees updates instantly without a pub/sub layer.
- **Stale-async guard.** Every long-running fetch grabs a generation number from `startAsync()`. If the user navigates away, `isStale(gen)` returns true and results are discarded. No "snap-back" to old state.
- **Bounded concurrency.** Fork ahead/behind compares run with a 5-worker pool. Folder-save uses a 4-worker pool. Dashboard widgets (events + trending + starred) and repo details enrichment (languages + contributors + releases + issues + PRs) fetch in parallel with per-call fault tolerance.
- **ETag cache.** Every GET response with an `ETag` header is cached; subsequent identical GETs send `If-None-Match` and a 304 returns the cached body for free (no rate-limit cost).
- **Streaming downloads.** Zipballs never buffer in memory — they pipe straight to disk via Node's `https`.
- **CWD safety.** Every disk write goes through `safeCwdJoin` which refuses any path that would escape `process.cwd()`. Clones refuse to overwrite an existing directory.
- **Diff-based renderer.** `tui/screen.mjs` keeps `prevChar`/`prevStyle` shadow buffers and only emits cursor moves + characters that actually changed.
- **Theme-aware rendering.** Tab renderers call `theme.color('star')` instead of hardcoding `'yellow'`, so new themes drop in without touching any tab.
- **Command palette.** Actions register themselves; the palette is just a fuzzy filter over the registry. New features can expose actions without touching any UI code.
- **Mouse support.** Full mouse tracking with click, scroll wheel, and hover effects. Tabs, pane tabs, and list items are all clickable.
- **Collapsible sections.** All sections across Dashboard, Repos, Analyze, and Inbox can be collapsed/expanded. State persisted to disk.

## ⚠️ Limitations

- Token is stored in plaintext on disk (locked down with file permissions; OS keychain integration is on the roadmap).
- Mostly read-only client today — actions ship in waves:
  - ✅ **shipped:** star/unstar, bookmark, pin, save file, save folder, zipball, `git clone`, `gh clone`, notification mark/unsubscribe.
  - ✅ **shipped (v0.5):** commenting on issues/PRs, reactions, close/reopen, merge PRs, PR diff viewer, review comments.
  - ✅ **shipped (v0.5.6):** rate limit indicator, traffic/milestones/labels/checks/security panes, mouse support, collapsible sections, hover effects, followers section.
- Only the GitHub REST v3 API is used (no GraphQL yet).
- Requires a true TTY — won't run when stdin is piped.
- The naive file-viewer syntax coloring is style-only — no real lexer. Adequate for reading, not editing.

## 🔭 Roadmap (from VISION.md)

**Shipped in v0.3:** Modular refactor, command palette, themes, inbox triage, README viewer pane, OSC-52 clipboard copy, bookmarks store, star/unstar, ETag cache, token-scope inspector.

**Shipped in v0.3.1:** Repos tab row selection + Enter drill-in, type/language/stale filters, density toggle, pins, visibility badges, relative-time column, jump-to-top/bottom. **File explorer** with tree browsing, file viewer (line numbers + syntax coloring), branch picker, save file / save folder / download zipball / git clone / gh clone — all CWD-safe.

**Shipped in v0.4:** Dashboard enhancements — contribution heatmap (15-week grid), star history sparkline (30-day trend), recent issues/PRs activity, stale repos alert (60+ days), quick actions bar.

**Shipped in v0.5:** Issue/PR detail popup with rendered body, labels, comments, and file diffs. Comment from TUI, emoji reactions, close/reopen, merge PRs with confirmation. PR diff viewer with unified diff and syntax coloring. Inbox notifications open detail popup for issues/PRs.

**Shipped in v0.5.6 (this release):**
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
