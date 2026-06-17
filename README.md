# GitHub TUI

A fast, dependency-free terminal user interface for GitHub — written in plain Node.js using only the standard library. Five tabs, a real home dashboard, repo analysis, inbox, and a built-in help overlay.

![status](https://img.shields.io/badge/status-active-success) ![node](https://img.shields.io/badge/node-%E2%89%A518://img.shields.io/badge/license-MIT-blue)

## ✨ Highlights

- 🏠 **Real Dashboard, not a stat dump** — greeting row, 4 stat cards (★ stars, ⑂ forks, ◆ languages, ⏱ account age), live activity feed with icon-per-event-type, top repos by stars, language breakdown bar chart, trending-this-week, and an unread-notifications badge.
- 🔍 **Analyze any public repo** — search, drill into a 2-column detail view (metadata + languages bar + top contributors + latest releases), and toggle sub-panes for open Issues and open PRs.
- 📁 **Repos browser** — sort by name / stars / forks / issues / updated, **`/` to filter** by substring across name + description + language, header shows aggregate stars/forks/issues.
- ⑂ **Forks view** — paginated, ahead/behind commit count vs. the default branch, compares run in a 5-worker concurrent pool (not serial).
- 📥 **Inbox** — color-coded notification types, unread dots, repo-grouped summary on the right, openable in browser with `Enter` or `o`.
- 📉 **Live rate-limit indicator** — top-right of the screen, color-coded as you approach the limit; full breakdown (including reset-in time) on the Settings tab.
- ⚙️ **Settings panel** — 6 actions plus a system info pane (app version, config paths, Node version, platform, terminal size, API rate limit).
- ❓ **Built-in help overlay** — press `?` anywhere for section-grouped keybindings.
- 🔐 **Secure local auth** — Personal Access Token stored at `~/.github-tui/token` with `chmod 600`; masked while typing; auto-cleared on first 401.
- 🖥️ **Adaptive layout** — diff-based renderer, re-renders on terminal resize, minimal flicker.

## 🚀 Run

No install step. Requires Node.js 18+.

```bash
node app.mjs
```

First launch will land you on the Dashboard with a teaser. Press `4` for Settings, then `Enter` on **Login**, and paste your GitHub Personal Access Token (the input is masked).

## 🔑 Creating a GitHub Personal Access Token

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)**.
2. Click **Generate new token**.
3. Recommended scopes: `repo`, `read:user`, `notifications`.
4. Copy the token, then paste it on the Settings tab → Login.

## ⌨️ Keyboard Shortcuts

### Global

| Key | Action |
|---|---|
| `1`–`5` / `Tab` / `Shift+Tab` | Switch tabs (Dashboard / Repos / Analyze / Settings / Inbox) |
| `↑` `↓` or `j` `k` | Navigate lists |
| `Enter` | Select / drill in |
| `Esc` / `h` | Back |
| `Space` | Load more (pagination) |
| `o` | Open the selected item in your browser |
| `r` | Refresh the current view (Dashboard refreshes user data + all widgets) |
| `?` | Toggle help overlay |
| `q` / `Ctrl-C` | Quit |

### Repos tab

| Key | Action |
|---|---|
| `/` | Filter by substring (name + description + language) |
| `c` | Clear active filter |
| `n` `s` `f` `i` `u` | Sort by name / stars / forks / issues / updated (press again to reverse) |

### Analyze tab

| Key | Action |
|---|---|
| `i` | Open the search prompt (from results/details: also toggles Issues pane) |
| `Enter` | View details → from details: view Forks |
| `P` | Toggle PRs pane (on details view) |
| `O` | Reset to Overview pane (on details view) |
| `Space` | Load more search results or more forks |

### Forks view

| Key | Action |
|---|---|
| `p` `s` `n` | Sort by last push / stars / name |
| `Space` | Load next 30 forks (compares run in parallel) |

### Inbox

| Key | Action |
|---|---|
| `Enter` / `o` | Open notification's subject in browser |
| `r` | Refresh notifications |

## 🗂️ Project Layout

```
.
├── app.mjs           # Main app: state, render, input handling (~2000 lines)
├── README.md         # You are here
└── tui/
    ├── github.mjs    # https-based GitHub REST client + rate-limit tracking
    └── screen.mjs    # Double-buffered terminal renderer (diff-based redraw)
```

## 🧱 What Each Tab Shows

### 1 · Dashboard
- **Greeting row** — time-of-day aware (good morning/afternoon/evening); 🔔 unread-notifications badge on the right.
- **Stat cards** — Total Stars, Total Forks, distinct Languages, Account Age.
- **Profile mini** — `@login`, email, followers/following, public/private repos.
- **Top Repos by Stars** — your 5 most-starred repos.
- **Languages across repos** — bar chart of how many repos use each primary language.
- **Recent Activity** — your last ~10 GitHub events with colored icons per type (push, PR, issue, watch, fork, create, delete, release, …) and relative timestamps.
- **Trending This Week** — top 5 public repos created in the last 7 days, sorted by stars.

### 2 · Repos
- Header: aggregate **★/⑂/⚡** totals across all your repos plus repo count.
- Sortable columns and a substring filter.
- `Space` paginates beyond the first 30.

### 3 · Analyze
- Search any public repo. From the result list, `Enter` opens a 2-column detail view:
  - **Left:** description, language, stars, forks, open issues/PRs, watchers, size, license, default branch, dates, URL.
  - **Right:** languages bar chart (bytes per language), top 5 contributors with commit counts, 3 latest releases.
- **Sub-panes:** `i` = Issues list, `P` = PRs list, `O` = back to Overview.
- From details, `Enter` opens the Forks view with ahead/behind columns; `Space` paginates more forks.

### 4 · Settings
- **Actions:** Login, Logout, Refresh Dashboard, Refresh User Data, Clear Token File, Token (hidden display).
- **System panel:** app version, config dir, token file path, Node version, platform/arch, terminal size, **API remaining / limit / reset-in minutes**.

### 5 · Inbox
- Per-row: yellow `●` unread dot, colored subject type (PR=cyan, Issue=yellow, Release=green, Discussion=magenta, Commit=blue, CheckSuite=red), repo·title, reason, relative time.
- Header shows unread/total counts.
- Right-side **By Repo** widget — top 5 noisiest repos with counts.

## 🧠 Design Notes

- **Zero npm dependencies.** Only Node's built-in `https`, `fs`, `os`, `path`, `child_process`.
- **Stale-async guard.** Every long-running fetch is keyed to a generation counter; results from cancelled flows are discarded so the UI never "jumps back" to old state.
- **Bounded concurrency.** Fork ahead/behind compares run with a 5-worker pool. Dashboard widgets (events + trending + starred) and details enrichment (languages + contributors + releases + issues + PRs) fetch in parallel.
- **Best-effort enrichment.** Every parallel fetch is independently fault-tolerant — a single 404 (e.g. disabled issues) never breaks the rest of the view.
- **Diff-based renderer.** `tui/screen.mjs` keeps a `prevChar`/`prevStyle` shadow buffer and only emits cursor moves + characters that actually changed.
- **Adaptive layouts.** Layouts adapt to terminal width (e.g. notification's "By Repo" widget collapses on narrow terminals).

## ⚠️ Limitations

- Token is stored in plaintext on disk (locked down with file permissions, but no OS keychain integration yet).
- Read-only client: no commenting, merging, closing, or marking notifications as read yet.
- Only the GitHub REST v3 API is used (no GraphQL).
- Requires a true TTY — won't run when stdin is piped.

## 🔭 Possible Next Steps

- `y` copy URL to clipboard (OSC-52 — works over SSH)
- Starred tab (data already loaded by Dashboard)
- Mark-notification-as-read (`PATCH /notifications/threads/:id`)
- Issue/PR detail popup on `Enter` inside the sub-panes
- Light/dark theme toggle
- OS keychain integration for token storage

## 📄 License

MIT.
