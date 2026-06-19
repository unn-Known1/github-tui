# GitHub TUI — Vision & Roadmap

> *The fastest way to live in GitHub without a browser tab — discovery, triage, review, and CI in one terminal.*

**Current version:** v0.5.6

---

## 🎯 Guiding Principles

| Principle | Test |
|---|---|
| **Keyboard-first** | Power user never touches the mouse |
| **Zero-dependency core** | Installable with just `node app.mjs` |
| **Fast feedback** | Renders in <100ms with 1000 repos |
| **Honest data** | Never invent data. Empty states explicit. |
| **Discoverable** | Every key in `?` help, every action in palette |
| **Safe by default** | No destructive actions without confirmation |
| **Extends the surface** | Every feature adds to what the TUI already does — not a different product |

---

## 📊 What's Built (v0.1 → v0.5.6)

| Feature | Status |
|---|---|
| **Dashboard** — greeting, stats, activity feed, trending, languages, heatmap, sparkline, followers | ✅ |
| **Repos browser** — sort, filter, paginate, density toggle, pins, aggregate stats | ✅ |
| **Analyze tab** — search → details → forks with ahead/behind comparison | ✅ |
| **Issue/PR detail popup** — rendered body, labels, comments, reviews, file diffs | ✅ |
| **Actions from TUI** — comment, react, close/reopen, merge (with confirmation) | ✅ |
| **PR diff viewer** — unified diff with syntax coloring | ✅ |
| **Inbox** — list, mark read, mark all, unsubscribe, filter cycle, pagination | ✅ |
| **Repo explorer** — tree browsing, file view, save/clone/zipball, branch picker | ✅ |
| **Actions/CI tab** — repos → runs → expandable jobs/steps, re-run, cancel | ✅ |
| **Bookmarks** — `b` toggle, `B` browse overlay, export to Markdown | ✅ |
| **Command palette** — `Ctrl-P` / `:`, fuzzy match, ~30 actions | ✅ |
| **Themes** — 8 themes: default, highContrast, dracula, solarized, nord, monokai, gruvbox, light | ✅ |
| **Mouse support** — click tabs/panes/items, scroll wheel, hover effects | ✅ |
| **Collapsible sections** — `z`/`Z`/`X` keys, disk persistence | ✅ |
| **Saved searches** — `Ctrl-P` → "Save current search" | ✅ |
| **Repo preferences** — sort, filter, density persisted to disk | ✅ |
| **ETag caching** — in-memory with auto `If-None-Match` | ✅ |
| **Clipboard** — OSC-52 copy (`y`) works over SSH/tmux | ✅ |
| **Rate limit indicator** — visual `█░` bar in header | ✅ |
| **Security pane** — Dependabot alerts with severity icons | ✅ |
| **Traffic/Milestones/Labels/Checks panes** | ✅ |
| **Modular architecture** — 23 modules, one file per tab | ✅ |
| **Zero dependencies** — just `node app.mjs` | ✅ |

---

## 🗓️ Roadmap

### v0.6 — "Cache & Offline" *(next)*

| Feature | Why |
|---|---|
| **Disk-backed ETag cache** | Survive restarts; instant reload of previously-viewed data |
| **Offline mode** | Work in trains/planes with last-synced banner |
| **Background prefetch** | Pre-fetch starred repos while idle |
| **LRU eviction** | Configurable max MB to prevent disk bloat |
| **"Last synced" timestamps** | Every tab shows when data was last refreshed |

---

### v0.7 — "CI Cockpit"

| Feature | Why |
|---|---|
| **Workflow log tail** | View logs in a pager view without leaving TUI |
| **Workflow dispatch UI** | Trigger `workflow_dispatch` with inputs from the TUI |
| **Failed-workflow aggregator** | See every red ✗ across watched repos |
| **Runner utilization** | Runner stats if available via API |

---

### v0.8 — "Discovery & Read Mode"

| Feature | Why |
|---|---|
| **Syntax-highlighted file viewer** | Read code in-TUI with highlighting for top 10 languages |
| **Topic explorer toggles** | 7d / 30d / 90d / by language facets |
| **Branch/tag comparison** | Compare two refs side-by-side |
| **Code search** | `searchCode` across orgs |
| **Blame view** | See who wrote what line |
| **File history** | Commit history per file |

---

### v0.9 — "Security & Enterprise"

| Feature | Why |
|---|---|
| **OAuth device-flow login** | No PAT required; just authorize in browser |
| **OS keychain integration** | macOS Keychain, libsecret, Windows Credential Manager |
| **GitHub Enterprise Server** | Configurable hostname for corporate users |
| **Token scope auditor** | Warnings for over-privileged tokens |
| **Dependabot aggregator** | Alerts across multiple repos |

---

### v1.0 — "Polish & Launch"

| Feature | Why |
|---|---|
| **Screen-reader mode** | Linearized layout for accessibility |
| **CLI subcommands** | `github-tui repos`, `github-tui inbox`, pipe-friendly output |
| **Homebrew / Scoop / AUR / Nix** | Easy install on every platform |
| **Static binary** | Optional `pkg` build for zero-install |
| **Demo GIF** | Terminal recording for README |

---

### v1.x — "Smart Helpers" 🧠

> *Extend the surfaces we already have. Every feature is opt-in, local-first, cache-first.*

#### PR & Issue Intelligence

| Feature | Vision | Version |
|---|---|---|
| **PR Semantic Summary** | LLM-powered summary: what changed, why it matters, risk assessment. BYO-key, results cached locally. | v1.1 |
| **Security Vulnerability Scanner** | Scan diffs for known CVE patterns, insecure defaults, credential exposure. Inline annotations. | v1.1 |
| **PR Size Advisor** | Suggest splitting oversized PRs. Show optimal chunking based on file ownership graph. | v1.1 |
| **Smart Auto-Triage** | Rule-based issue classification at ingestion. Rules in `.github/triage.yml`, executed locally. | v1.1 |
| **Duplicate Detection** | Fuzzy match against existing issues. Show similarity scores. One-click merge. | v1.2 |
| **Priority Scorer** | Auto-prioritize based on: user impact, code churn, dependency count, age. | v1.1 |

#### Code Insights

| Feature | Vision | Version |
|---|---|---|
| **Complexity Trends** | Track cyclomatic complexity per module over time. ASCII sparklines in repo view. | v1.2 |
| **Technical Debt Score** | Composite metric: TODO count, test coverage gaps, dependency staleness. | v1.3 |
| **Documentation Coverage** | Track README presence, JSDoc/TSDoc density, inline comment ratio per module. | v1.2 |

#### Developer Experience

| Feature | Vision | Version |
|---|---|---|
| **Focus Mode** | Hide everything except current task: assigned issues, PRs reviewing, active repo CI. | v1.1 |
| **Review Queue Prioritizer** | Reorder reviews by urgency, context-switch cost, expertise match. Not just FIFO. | v1.1 |
| **Smart Notification Batching** | Deduplicate: 3 comments on one issue = 1 notification. Batch by repo. Suppress noise in focus mode. | v1.1 |
| **Keyboard-Native Workflows** | `r c` = review-comment, `r a` = approve, `r m` = approve+merge. Compound actions, one keypress. | v1.0 |
| **Personalized Dashboard** | Learns your behavior: surfaces repos you use, hides tabs you ignore. Privacy-first, all local. | v1.3 |

---

### v2.x — "Release & Extensibility" 📈

> *Polish the release workflow, make the TUI pluggable, and let users extend it.*

#### Release Management

| Feature | Vision | Version |
|---|---|---|
| **Automated Changelog** | Generate from merged PRs grouped by type. Conventional commit parsing. Preview & edit. | v2.0 |
| **Release Draft Assistant** | Interactive: version bump → changelog → tag → GitHub Release → notify issues. Single `r release`. | v2.1 |
| **Branch Protection Visualizer** | ASCII flow diagram: "To merge: ✓ CI → ✓ 2 approvals → ✓ Up-to-date." Shows gates met/unmet. | v2.1 |

#### Code Review Intelligence

| Feature | Vision | Version |
|---|---|---|
| **Review Checklists** | Per-file-type checklists during review. API changes → "Check: input validation, rate limiting, errors." | v2.0 |
| **Reviewer Assignment Optimizer** | Match reviewers by expertise, workload, code ownership. Confidence scores. | v2.1 |
| **Auto-Review Suggestions** | LLM-assisted: "This PR modifies auth middleware — consider checking: token expiry, rate limiting." | v2.1 |

#### AI-Assisted Review (BYO-key)

| Feature | Vision | Version |
|---|---|---|
| **AI Code Review Assistant** | LLM review of diffs: security, performance, style, documentation. Results cached, streamed to TUI. | v2.0 |
| **Dependency Impact Analyzer** | Trace how a PR affects downstream packages and CI pipelines. Visualize the blast radius. | v2.1 |
| **Performance Regression Detector** | Flag diffs that touch hot paths, add allocations, or change algorithmic complexity. | v2.2 |

#### Plugin System & Extensibility

| Feature | Vision | Version |
|---|---|---|
| **Plugin Runtime** | Sandboxed worker threads. Load `.mjs` from `~/.github-tui/plugins/`. Lifecycle hooks. | v2.0 |
| **Plugin SDK** | TypeScript declarations for hooks: `onLoad(ctx)`, `renderTab(pane)`, `onKey(ch)`. | v2.0 |
| **Hot-Reload** | `Ctrl-P` → "Reload plugins." No restart. `--watch` mode for development. | v2.0 |
| **Custom Themes as Plugins** | Themes become plugins. Community contributions. 8 themes → 80+ via community. | v2.0 |

#### Data Portability

| Feature | Vision | Version |
|---|---|---|
| **Config Export/Import** | `github-tui config export` → `github-tui.json`. Import on new machine. | v1.1 |
| **Backup & Restore** | `github-tui backup` → `.tar.gz` of config + cache + session. Restore on laptop swap. | v1.2 |
| **`gh` CLI Import** | Import bookmarks, aliases from `~/.config/gh/`. Zero-friction onboarding. | v1.1 |
| **Team Config Sync** | Share team config (saved searches, filters) via a dotfiles repo. | v2.1 |

#### Terminal Integration

| Feature | Vision | Version |
|---|---|---|
| **Session Persistence** | Save/restore TUI state across tmux session recreation. | v2.0 |
| **tmux Hooks** | Auto-open inbox on new notifications via tmux hooks. | v2.0 |
| **Multi-Pane Layouts** | Pre-built: `github-tui-triage`, `github-tui-review`, `github-tui-ci`. | v2.1 |
| **CLI Composition** | Pipe TUI data to/from `jq`, `fzf`, `xargs` via export/import commands. | v2.0 |

---

## 💡 Killer Features — Progress

| Feature | Status |
|---|---|
| Command Palette (`Ctrl-P`) | ✅ shipped |
| PR Review Workflow in-TUI | ✅ shipped |
| Inbox actions | ✅ shipped |
| Disk cache with ETags | 🟡 in-memory only (v0.6 disk) |
| README + Markdown renderer | ✅ shipped |
| Saved searches | ✅ shipped |
| OS-keychain token storage | 🔲 v0.9 |
| Workflow runs dashboard | ✅ shipped |
| AI summarise (BYO-key) | 🎯 v1.1 |
| Themes + keybinding customisation | ✅ shipped |
| Plugin system | 🎯 v2.0 |
| Release automation | 🎯 v2.0 |
| Offline + disk cache | 🎯 v0.6 |

---

## 🧑‍🍳 Workflow Recipes

### R1 — "Morning Triage" ✅
1. Launch → Dashboard. Glance at 🔔 badge.
2. `5` → Inbox. `f` filter unread. `M` mark all read.
3. `m` clear individual; `u` mute; `o` open in browser.
4. `1` → Dashboard. Verify count dropped.

### R2 — "Maintainer Fork Hunt" ✅
1. `3` → search my repo → `Enter`.
2. `Enter` → Forks. `p` sort by last push.
3. See which forks are ahead of main.
4. `o` open best fork. `b` bookmark.

### R3 — "CI Cockpit" ✅
1. `4` → Actions tab.
2. Browse repos → view runs → expand jobs.
3. `r` re-run failed. `x` cancel.

### R4 — "OOO Recap" 🔲 v0.6
1. `Ctrl-P` → "Since I was last here".
2. Shows: merges missed, mentions waiting, new issues.

### R5 — "Security Sweep" 🔲 v0.9
1. `Ctrl-P` → "Dependabot alerts".
2. Aggregated, sorted by severity.

### R6 — "Read a Repo Like a Book" 🟡
1. Search → Enter on repo. ✅
2. `R` → README rendered. ✅
3. *Pending:* `f` → file tree → `v` view file. *(v0.8)*

### R7 — "AI-Assisted Review" 🎯 v2.0
1. Open PR → `a` for AI review.
2. LLM scans diff: security issues, performance hints, style suggestions.
3. Results appear as inline annotations.
4. `Enter` to apply suggestion. `Esc` to dismiss.

### R8 — "Release Flow" 🎯 v2.1
1. `r release` → Release assistant opens.
2. "v2.3.0 was last release. 47 PRs since. Suggested: v2.4.0 (minor)."
3. Changelog auto-generated from merged PRs.
4. Edit → Tag → Push → GitHub Release created.

### R9 — "Plugin-Powered Workflow" 🎯 v2.0
1. `Ctrl-P` → "Install plugin" → custom dashboard widget.
2. Plugin loads: adds new panel to dashboard.
3. Extend TUI with team-specific views.

---

## 🆚 vs. Alternatives

| Need | `gh` CLI | lazygit | octobox | **GitHub TUI** |
|---|---|---|---|---|
| Interactive UI | ❌ | ✅ (git only) | ✅ (notifications) | ✅ |
| Multi-tab dashboards | ❌ | ❌ | ❌ | ✅ |
| Trending / discovery | ❌ | ❌ | ❌ | ✅ |
| README in terminal | ❌ | ❌ | ❌ | ✅ |
| Command palette | partial | ❌ | ❌ | ✅ |
| Themes | ❌ | ✅ | ❌ | ✅ |
| ETag caching | ❌ | n/a | n/a | ✅ |
| Inbox triage | ❌ | ❌ | ✅ (web) | ✅ |
| Forks ahead/behind | ❌ | ❌ | ❌ | ✅ |
| Clipboard (SSH-safe) | ❌ | partial | n/a | ✅ |
| Zero install | needs install | needs install | web app | ✅ |
| Offline + disk cache | ❌ | ❌ | ❌ | 🎯 v0.6 |
| AI summarise | ❌ | ❌ | ❌ | 🎯 v1.1 |
| Enterprise Server | ✅ | n/a | partial | 🎯 v0.9 |
| Plugin system | ❌ | ❌ | ❌ | 🎯 v2.0 |
| Release automation | ❌ | ❌ | ❌ | 🎯 v2.1 |

---

## 🔮 Stretch Ideas

- **Multi-account switching** — `Ctrl-A` to swap work/personal tokens
- **Time-travel** — `git bisect`-style for issue threads
- **Embeddable** — tmux/zellij/wezterm pane plugin
- **GitHub Wrapped** — yearly activity PDF
- **Repo health score** — composite metric (CI green %, cycle time, docs)
- **Pluggable widgets** — drop a JS file into `~/.github-tui/widgets/`
- **Story mode** — "Walk me through this repo" — README, examples, top contributors

---

## 🏛️ Version Roadmap Summary

| Phase | Version | Focus | Key Features |
|-------|---------|-------|--------------|
| Polish | v0.6–v0.9 | Foundation | Disk cache, offline, CI cockpit, security, OAuth |
| Launch | v1.0–v1.x | Smart Helpers | Accessibility, CLI, AI summaries, auto-triage, focus mode |
| Extensibility | v2.0–v2.1 | Plugins & Release | Plugin system, release automation, review intelligence, data portability |

---

## 🧬 Architectural Principles

| Principle | Rule |
|---|---|
| **Plugin-first** | Every feature after v2.0 ships as plugin first. Graduate to core if >30% adoption. |
| **Zero core deps** | Core stays zero-dep. Plugins may have deps; sandboxed in worker threads. |
| **Cache-first** | Every AI feature caches results locally. Repeated queries are free. |
| **Opt-in intelligence** | No feature runs without user consent. BYO-key, local execution, no telemetry. |
| **Terminal-native** | Use terminal primitives: ANSI, OSC-52, tmux hooks, stdin/stdout pipes. |
| **Config as code** | All config is JSON/TOML. Version-controllable. Diffable. |

---

## 🎨 The Terminal Advantage

Why the terminal beats the browser for developer tooling:

| Advantage | Terminal | Browser |
|---|---|---|
| **Composability** | Pipe to `jq`, `fzf`, `xargs`, any CLI | Siloed, copy-paste |
| **Offline** | Full cache, works on planes | Needs connection |
| **Scriptability** | Automate with shell scripts | No API |
| **Multi-session** | tmux/zellij, share sessions | One tab = one view |
| **Keyboard-first** | Zero hand movement | Mouse required |
| **Low latency** | <10ms render | Network round-trips |
| **Persistent state** | SQLite, disk cache | Tab reload = state lost |
| **Privacy** | Local-first, no telemetry | Cloud-dependent |

---

*This vision is intentionally maximalist about what the TUI can do — but disciplined about what it isn't. We extend the terminal surface. We don't build a different product.*

*License: MIT.*
