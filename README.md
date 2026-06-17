# GitHub TUI

A fast, dependency-free terminal user interface for GitHub — written in plain Node.js using only the standard library.

## Features

- 🔐 **Secure local auth** — Personal Access Token stored at `~/.github-tui/token` with `chmod 600`. Invalid tokens are auto-cleared on first 401.
- 📊 **Dashboard** — account snapshot + recent repositories at a glance.
- 📁 **Repos browser** — paginated list of your repos, sortable by name / stars / forks / issues / updated.
- 🔍 **Analyze** — search any public repository and drill into a rich detail view that shows:
  - core metadata (description, license, default branch, sizes, dates)
  - a **languages bar chart** (bytes per language)
  - **top contributors** with commit counts
  - **latest releases**
  - **open issues** and **open PRs** (counts shown in the detail view)
  - **forks** with ahead/behind commit count vs. the default branch (compares run in parallel)
- 📥 **Inbox** — your GitHub notifications, openable in the browser with `Enter` or `o`.
- 📉 **Live rate-limit indicator** — top-right of the screen, color-coded as you approach the limit.
- ❓ **Built-in help overlay** — press `?` anytime.
- 🖥️ **Adaptive layout** — re-renders on terminal resize using a diff-based renderer (minimal flicker).

## Run

No install step. Requires Node.js 18+.

```bash
node app.mjs
```

## Creating a GitHub Personal Access Token

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)**.
2. Click **Generate new token**.
3. Recommended scopes: `repo`, `read:user`, `notifications`.
4. Copy the token. In the TUI, press `4` for Settings, then `Enter` on **Login** and paste it (it's masked while you type).

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `1`–`5` / `Tab` / `Shift+Tab` | Switch tabs |
| `↑` `↓` or `j` `k` | Navigate lists |
| `Enter` | Select / drill in |
| `Esc` / `h` | Back |
| `Space` | Load more (pagination) |
| `o` | Open the selected item in your browser |
| `r` | Refresh the current view |
| `?` | Toggle help overlay |
| `q` / `Ctrl-C` | Quit |

### Sort keys

- **Repos tab:** `n`=name, `s`=stars, `f`=forks, `i`=issues, `u`=updated (press again to reverse).
- **Forks view:** `p`=last push, `s`=stars, `n`=name.

## Project Layout

```
.
├── app.mjs           # Main app: state, render, input handling
├── README.md
└── tui/
    ├── github.mjs    # https-based GitHub API client + rate-limit tracking
    └── screen.mjs    # Double-buffered terminal renderer (diff-based redraw)
```

## Design Notes

- **Zero npm dependencies.** Only Node's built-in `https`, `fs`, `os`, `path`, `child_process`.
- **Stale-async guard.** Every long-running fetch is keyed to a generation counter; results from cancelled flows are discarded so the UI never "jumps back" to old state.
- **Bounded concurrency.** Fork ahead/behind comparisons run with a 5-worker pool instead of serially.
- **Best-effort enrichment.** When loading repo details, languages/contributors/releases/issues/PRs are fetched in parallel and each is independently fault-tolerant.

## Limitations

- Token is stored in plaintext on disk (locked down with file permissions, but no OS keychain integration yet).
- No write actions: this is a read-only client (no commenting, no merging, no closing).
- Only the GitHub REST v3 API is used (no GraphQL).

## License

MIT.
