# GitHub TUI — Vision V2: The Developer Intelligence Platform

> *The terminal isn't catching up to the web — it's leapfrogging it. Every feature exploits what terminals do best: compose, script, persist, and stay out of the way. The web is for browsing. The terminal is for doing.*

**Current version:** v0.5.6 | **Target:** v3.0+

---

## 🧭 Guiding Philosophy

| Principle | Manifesto |
|---|---|
| **Terminal-first** | The terminal is the **highest-bandwidth, lowest-latency, most scriptable** development surface. We don't replicate the browser — we transcend it. |
| **Zero-dependency core** | Core stays zero-dep. Plugins may have deps; sandboxed in worker threads. Installable with `node app.mjs`. |
| **Privacy by default** | All intelligence is local-first. No telemetry, no cloud, no opt-out required. BYO-key for AI. |
| **Composable, not siloed** | Pipe TUI data to/from `jq`, `fzf`, `xargs`. The TUI is a node in the pipeline, not a destination. |
| **Opt-in complexity** | Every feature is discoverable but ignorable. Power users go deep; casual users stay surface-level. |
| **Graceful degradation** | Offline? Cached. No API key? No AI. No tmux? Standalone. Every feature degrades, never breaks. |
| **Community-powered** | Plugin-first after v2.0. Features graduate from community → core when >30% adopt them. |

---

## 🏗️ Architecture: The Three Pillars

```
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub TUI V2 Architecture                    │
├──────────────────┬──────────────────┬──────────────────────────┤
│   INTELLIGENCE   │   COLLABORATION  │      PLATFORM            │
│                  │                  │                          │
│  • AI Analysis   │  • Team Presence │  • Multi-Platform        │
│  • Predictions   │  • Shared Reviews│  • Plugin System         │
│  • Auto-Triage   │  • Review Metrics│  • IDE Bridge            │
│  • NL Interface  │  • Notifications │  • Tmux/Zellij Native    │
│  • DORA Metrics  │  • Standup Gen   │  • Data Portability      │
└──────────────────┴──────────────────┴──────────────────────────┘
```

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

## 🗓️ Roadmap V2

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

### v1.x — "First Intelligence" 🧠

> *The TUI starts thinking. Every feature is opt-in, local-first, cache-first.*

#### Intelligent PR Analysis

| Feature | Vision | Version |
|---|---|---|
| **PR Semantic Summary** | LLM-powered summary: what changed, why it matters, risk assessment. BYO-key, results cached locally. | v1.1 |
| **Dependency Impact Analyzer** | Trace how a PR affects downstream packages, consumers, and CI pipelines. Visualize the blast radius. | v1.2 |
| **Security Vulnerability Scanner** | Scan diffs for known CVE patterns, insecure defaults, credential exposure. Inline annotations. | v1.1 |
| **Performance Regression Detector** | Flag diffs that touch hot paths, add allocations, or change algorithmic complexity. | v1.3 |
| **PR Size Advisor** | Suggest splitting oversized PRs. Show optimal chunking based on file ownership graph. | v1.1 |

#### Issue Intelligence

| Feature | Vision | Version |
|---|---|---|
| **Smart Auto-Triage** | Rule-based + ML-assisted issue classification at ingestion. Rules in `.github/triage.yml`, executed locally. | v1.1 |
| **Duplicate Detection** | Fuzzy match against existing issues. Show similarity scores. One-click merge. | v1.2 |
| **Effort Estimator** | Predict story points based on issue complexity, file touch patterns, historical velocity. | v1.3 |
| **Priority Scorer** | Auto-prioritize based on: user impact, code churn, dependency count, age. | v1.1 |
| **Trend Detector** | Alert when a bug type is increasing. "Login failures up 3x this week." | v1.2 |

#### Code Insights

| Feature | Vision | Version |
|---|---|---|
| **Complexity Trends** | Track cyclomatic complexity per module over time. ASCII sparklines in repo view. | v1.2 |
| **Technical Debt Score** | Composite metric: TODO count, test coverage gaps, dependency staleness, documentation gaps. | v1.3 |
| **Knowledge Map** | Who knows what? Visualize expertise by file/module from commit history and review patterns. | v1.2 |
| **Bus Factor Analysis** | Flag modules where 1 person holds >80% of knowledge. Encourage knowledge sharing. | v1.3 |
| **Documentation Coverage** | Track README presence, JSDoc/TSDoc density, inline comment ratio per module. | v1.2 |

#### Developer Experience

| Feature | Vision | Version |
|---|---|---|
| **Focus Mode** | Hide everything except current task: assigned issues, PRs reviewing, active repo CI. | v1.1 |
| **Review Queue Prioritizer** | Reorder reviews by urgency, context-switch cost, expertise match. Not just FIFO. | v1.1 |
| **Smart Notification Batching** | Deduplicate: 3 comments on one issue = 1 notification. Batch by repo. Suppress noise in focus mode. | v1.1 |
| **Keyboard-Native Workflows** | `r c` = review-comment, `r a` = approve, `r m` = approve+merge. Compound actions, one keypress. | v1.0 |
| **Time-Boxed Work Sessions** | Pomodoro mode: lock to one issue/PR, track time, log completion, suggest commit message. | v1.2 |
| **Personalized Dashboard** | Learns your behavior: surfaces repos you use, hides tabs you ignore. Privacy-first, all local. | v1.3 |

---

### v2.x — "Velocity & Intelligence" 📈

> *The TUI accumulates historical context. Metrics emerge. Predictions become possible.*

#### DORA Metrics & Velocity

| Feature | Vision | Version |
|---|---|---|
| **DORA Metrics Dashboard** | Lead time, cycle time, deploy frequency, change failure rate — computed from GitHub data. ASCII bar charts. | v2.0 |
| **PR Throughput Trends** | PRs merged/week, avg PR size, time-to-review, commit-to-merge. Sparklines with trend arrows. | v2.0 |
| **Burndown/Burnup Charts** | Milestone progress with predictive completion dates. ASCII art. Scope creep detection. | v2.0 |
| **Review Metrics Dashboard** | Reviewer responsiveness, turnaround, approval rate, comments/review. Team leaderboard (opt-in). | v2.1 |
| **Cross-Repo Context Bridge** | Link related issues/PRs across repos. Dependency graph visualization. | v2.1 |

#### Release Management

| Feature | Vision | Version |
|---|---|---|
| **Automated Changelog** | Generate from merged PRs grouped by type. Conventional commit parsing. Preview & edit. | v2.0 |
| **Release Draft Assistant** | Interactive: version bump → changelog → tag → GitHub Release → notify issues. Single `r release`. | v2.1 |
| **Changelog-to-Release Pipeline** | Full pipeline: edit changelog, create tag, upload assets, close milestone, notify stakeholders. | v2.2 |
| **Branch Protection Visualizer** | ASCII flow diagram: "To merge: ✓ CI → ✓ 2 approvals → ✓ Up-to-date." Shows gates met/unmet. | v2.1 |

#### Code Review Intelligence

| Feature | Vision | Version |
|---|---|---|
| **Review Checklists** | Per-file-type checklists during review. API changes → "Check: input validation, rate limiting, errors." | v2.0 |
| **Reviewer Assignment Optimizer** | Match reviewers by expertise, workload, code ownership. Confidence scores. | v2.1 |
| **Review Quality Metrics** | Track: nits caught, regressions found, approval accuracy. Improve over time. | v2.2 |
| **Auto-Review Suggestions** | LLM-assisted: "This PR modifies auth middleware — consider checking: token expiry, rate limiting." | v2.1 |

#### AI & Natural Language

| Feature | Vision | Version |
|---|---|---|
| **Natural Language Interface** | Ask: "What changed since last release?", "Who reviewed my PR?", "Show failing tests." Get answers with links. | v2.0 |
| **AI Code Review Assistant** | BYO-key LLM review: security, performance, style, documentation. Results cached, streamed to TUI. | v2.0 |
| **Conversational Triage** | Chat with your issue tracker: "Find similar bugs to #456", "What's blocking this milestone?" | v2.1 |
| **AI Cost Dashboard** | Track token usage, cost per query, cache hit rate. Stay within budget. | v2.1 |

#### Collaboration & Team

| Feature | Vision | Version |
|---|---|---|
| **Team Velocity Dashboard** | Team-level DORA metrics, sprint velocity trends, capacity forecasting. | v2.0 |
| **Workload Distribution** | Visualize: who has too many issues? Who's idle? Balance the load. | v2.1 |
| **Standup Generator** | Auto-generate standup from last 24h: commits, PRs reviewed, issues closed, blockers. | v2.0 |
| **Review Turnaround Tracker** | "PRs sit 3 days waiting for review" — identify bottlenecks in the review process. | v2.1 |
| **Mentor Matching** | New contributors matched with experienced reviewers based on code area, language, learning goals. | v2.2 |
| **Activity Digest** | Weekly digest: "You merged 5 PRs, reviewed 3, closed 12 issues. Team velocity: +15%." | v2.1 |

#### Multi-Platform

| Feature | Vision | Version |
|---|---|---|
| **Platform Abstraction Layer** | Unified data model: repos, issues, PRs, CI across GitHub/GitLab/Bitbucket/Gitea. | v2.0 |
| **GitLab Driver** | Full GitLab CE/EE: merge requests, pipelines, issues, boards. OAuth2 device flow. | v2.1 |
| **Gitea/Forgejo Driver** | Self-hosted Gitea/Forgejo support. Auto-discover via config. | v2.2 |
| **Unified Inbox** | Single pane aggregating notifications from all platforms. Filter by platform, type, repo. | v2.2 |

#### Plugin System & Extensibility

| Feature | Vision | Version |
|---|---|---|
| **Plugin Runtime** | Sandboxed worker threads. Load `.mjs` from `~/.github-tui/plugins/`. Lifecycle hooks. | v2.0 |
| **Plugin SDK** | TypeScript declarations: `onLoad(ctx)`, `renderTab(pane)`, `onKey(ch)`. Autocomplete in VS Code. | v2.0 |
| **Plugin Marketplace** | Central registry: ratings, downloads, verified badges. `Ctrl-P` → "Install plugin." | v2.1 |
| **Hot-Reload** | `Ctrl-P` → "Reload plugins." No restart. `--watch` mode for development. | v2.0 |
| **Custom Themes as Plugins** | Themes become plugins. Community marketplace. 8 themes → 80+ via community. | v2.0 |

#### Data Portability

| Feature | Vision | Version |
|---|---|---|
| **Config Export/Import** | `github-tui config export` → `github-tui.json`. Import on new machine. | v1.1 |
| **Team Settings Sync** | Share team config via dotfiles repo. `github-tui config sync --repo org/team-tui-config`. | v2.0 |
| **Backup & Restore** | `github-tui backup` → `.tar.gz` of config + cache + session. Restore on laptop swap. | v1.2 |
| **`gh` CLI Import** | Import bookmarks, aliases from `~/.config/gh/`. Zero-friction onboarding. | v1.1 |
| **State Sync via Git** | Optional: `~/.github-tui/` in dotfiles repo. Auto-pull on launch, auto-push on exit. | v2.0 |

#### Terminal Integration

| Feature | Vision | Version |
|---|---|---|
| **tmux Plugin** | Hotkey binding. Auto-open inbox on notifications via tmux hooks. | v2.0 |
| **Zellij Plugin** | Native WASM plugin. Floating pane. Zellij layout integration. | v2.1 |
| **WezTerm Integration** | Lua scripting deep integration. One-keybind split pane. IPC for notifications. | v2.1 |
| **Session Persistence** | Save/restore TUI state across tmux session recreation. | v2.0 |
| **Multi-Pane Layouts** | Pre-built: `github-tui-triage`, `github-tui-review`, `github-tui-ci`. | v2.1 |

#### IDE Bridge

| Feature | Vision | Version |
|---|---|---|
| **VS Code Extension** | TUI in integrated terminal. Bidirectional: open file from TUI, open PR from editor. | v2.0 |
| **Neovim Plugin** | Lua plugin. `:GitHubTUI pr <number>` opens PR diff. Floating window. | v2.1 |
| **DAP Bridge** | Debug Adapter Protocol. Show breakpoints, call stacks in TUI pane. Trigger from failed CI. | v2.3 |

---

### v3.x — "Autonomous & Enterprise" 🚀

> *The TUI acts on your behalf. It triages, automates, and protects. The terminal becomes the command center.*

#### Automation & Self-Driving

| Feature | Vision | Version |
|---|---|---|
| **In-TUI Workflow Rules** | YAML-defined if-this-then-that rules. "If issue stale 14 days → auto-close." Local execution, full audit. | v3.0 |
| **Stale Issue Lifecycle** | 30d → label `stale`, 45d → warning, 60d → close. Configurable, logged, overridable. | v3.0 |
| **Smart Assignee Suggestions** | git blame + CODEOWNERS + workload + activity. Confidence scores. "92% match: @alice." | v3.0 |
| **Alert Correlation Engine** | Group related alerts across repos by time, dependencies, topology. One incident card, not five. | v3.0 |

#### Incident Response

| Feature | Vision | Version |
|---|---|---|
| **Incident Timeline** | Correlate deploys, CI failures, issues into unified timeline. Root-cause suggestions. | v3.0 |
| **Post-Mortem Generator** | Auto-fill post-mortem from timeline: impact, affected services, action items. Commit to `postmortems/`. | v3.0 |
| **Status Page Integration** | Show internal status page in TUI. Acknowledge incidents from terminal. | v3.1 |

#### Advanced AI

| Feature | Vision | Version |
|---|---|---|
| **Predictive Analytics** | "When will this PR merge?", "Which repos are at risk?", "Who's disengaging?" | v3.0 |
| **Autonomous Code Review** | AI proposes fixes, not just finds issues. One-click apply suggestions. | v3.1 |
| **Learning Mode** | New contributor onboarding: codebase walkthrough generator, architecture docs from code. | v3.0 |
| **Time-Travel Bisect** | `git bisect`-style for issue threads. Find when a bug was introduced in the conversation. | v3.1 |

#### Enterprise

| Feature | Vision | Version |
|---|---|---|
| **Azure DevOps Driver** | Azure Repos + Pipelines. Work items, PRs, build definitions. | v3.0 |
| **SSO Integration** | SAML/OIDC auth for enterprise environments. | v3.1 |
| **Audit Logging** | Track all TUI actions for compliance. Exportable logs. | v3.0 |
| **White-Label Engine** | License the TUI engine for branded internal dashboards. | v3.2 |

#### Advanced Collaboration

| Feature | Vision | Version |
|---|---|---|
| **Shared Session / Pair Mode** | Two terminals share TUI session via WebSocket. Remote pair programming. | v3.0 |
| **Real-Time Presence** | Show who's viewing what. Live cursors in PR review. | v3.1 |
| **Cross-Platform Federation** | Notifications from GitHub + GitLab + Gitea in one stream. | v3.0 |
| **Incident War Room** | Multi-user session for incident response. Shared timeline, action items, comms. | v3.2 |

#### Sustainability

| Feature | Vision | Version |
|---|---|---|
| **Open Core Model** | Core (GitHub) is MIT. Drivers (GitLab, Azure), premium themes, AI are commercial. | v2.0 |
| **Sponsorware Themes** | Premium themes for GitHub Sponsors at $5+/month. Accessibility-certified. | v2.0 |
| **Enterprise License** | Per-seat for Azure driver, SSO, audit logging, priority support, SLA. | v3.0 |
| **Community Foundation** | GitHub Sponsors + Open Collective. Transparent finances. Governance board. | v2.0 |

---

## 🆚 vs. Alternatives V2

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
| Offline + disk cache | ❌ | ❌ | ❌ | ✅ |
| AI summarise | ❌ | ❌ | ❌ | ✅ |
| Enterprise Server | ✅ | n/a | partial | ✅ |
| **DORA metrics** | ❌ | ❌ | ❌ | 🎯 v2.0 |
| **Plugin system** | ❌ | ❌ | ❌ | 🎯 v2.0 |
| **Multi-platform** | ❌ | ❌ | ❌ | 🎯 v2.0 |
| **Natural language** | ❌ | ❌ | ❌ | 🎯 v2.0 |
| **Team analytics** | ❌ | ❌ | ❌ | 🎯 v2.1 |
| **Incident response** | ❌ | ❌ | ❌ | 🎯 v3.0 |
| **IDE bridge** | partial | n/a | ❌ | 🎯 v2.0 |
| **Pair programming** | ❌ | ❌ | ❌ | 🎯 v3.0 |
| **Workflow automation** | partial | ❌ | ❌ | 🎯 v3.0 |

---

## 🎯 Workflow Recipes V2

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

### R7 — "Velocity Check" 🎯 v2.0
1. `Ctrl-P` → "DORA metrics".
2. See: lead time (2.3d), cycle time (1.8d), deploy freq (12/week), failure rate (8%).
3. Compare to last month. Trend arrows show improvement.
4. Drill down: which repos are dragging?

### R8 — "AI-Assisted Review" 🎯 v2.0
1. Open PR → `a` for AI review.
2. LLM scans diff: security issues, performance hints, style suggestions.
3. Results appear as inline annotations.
4. `Enter` to apply suggestion. `Esc` to dismiss.

### R9 — "Release Flow" 🎯 v2.1
1. `r release` → Release assistant opens.
2. "v2.3.0 was last release. 47 PRs since. Suggested: v2.4.0 (minor)."
3. Changelog auto-generated from merged PRs.
4. Edit → Tag → Push → GitHub Release created. Issues notified.

### R10 — "Incident Response" 🎯 v3.0
1. Alert fires → TUI correlates: deploy at 14:32, CI fail at 14:35, issue at 14:38.
2. Timeline view: PR #891 merged → CI failed → issue #892 created.
3. Root cause suggested: PR #891 (auth module change).
4. `w` → War room: invite team, shared timeline, action items.
5. `p` → Post-mortem generated from timeline.

### R11 — "Cross-Platform Triage" 🎯 v2.2
1. Unified inbox: GitHub + GitLab + Gitea notifications.
2. Filter by platform, type, repo.
3. Mark read across all platforms.
4. One command resolves across ecosystems.

### R12 — "Plugin-Powered Dashboard" 🎯 v2.0
1. `Ctrl-P` → "Install plugin" → `jira-sync`.
2. Plugin loads: adds Jira panel to dashboard.
3. Shows Jira issues alongside GitHub issues.
4. Cross-reference: link GitHub PR to Jira ticket.

---

## 💡 Killer Features — Progress V2

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
| **DORA metrics** | 🎯 v2.0 |
| **Plugin system** | 🎯 v2.0 |
| **Multi-platform** | 🎯 v2.0 |
| **Natural language interface** | 🎯 v2.0 |
| **Team analytics** | 🎯 v2.1 |
| **IDE bridge** | 🎯 v2.0 |
| **Incident response** | 🎯 v3.0 |
| **Pair programming** | 🎯 v3.0 |
| **Workflow automation** | 🎯 v3.0 |

---

## 🔮 Stretch Ideas

- **Multi-account switching** — `Ctrl-A` to swap work/personal tokens *(v1.1)*
- **Pair-mode** — two terminals, shared cursor for code review *(v3.0)*
- **Time-travel** — `git bisect`-style for issue threads *(v3.1)*
- **Embeddable** — tmux/zellij/wezterm pane plugin *(v2.0)*
- **Voice mode** — "open my repos" → switches tabs *(v3.1)*
- **GitHub Wrapped** — yearly activity PDF *(v3.0)*
- **Bring-your-own-data** — Linear, Jira, GitLab adapters *(v2.0)*
- **Repo health score** — composite metric (CI green %, cycle time, docs) *(v2.1)*
- **Pluggable widgets** — drop a JS file into `~/.github-tui/widgets/` *(v2.0)*
- **Multi-user collaboration** — shared sessions, real-time cursors *(v3.0)*
- **Incident war room** — multi-user incident response with shared timeline *(v3.2)*
- **White-label engine** — license for branded internal dashboards *(v3.2)*
- **Autonomous fixes** — AI proposes PR fixes, not just finds issues *(v3.1)*
- **Knowledge graph** — org-wide expertise visualization *(v3.0)*
- **Predictive capacity** — "At current velocity, milestone slips 5 days" *(v3.0)*

---

## 🏛️ Version Roadmap Summary

| Phase | Version | Theme | Key Features |
|-------|---------|-------|--------------|
| Foundation | v0.6-v0.9 | Polish | Disk cache, offline, CI cockpit, security, OAuth |
| Launch | v1.0-v1.x | First Intelligence | Accessibility, CLI, AI triage, PR summaries, focus mode, notifications |
| Velocity | v2.0-v2.2 | Platform & Plugins | DORA metrics, plugin system, multi-platform, IDE bridge, team analytics |
| Enterprise | v2.3 | Dev Tools Deep | Bitbucket, LSP, Docker, advanced linting |
| Autonomous | v3.0+ | Self-Driving | Workflow rules, incident response, pair mode, enterprise SSO, white-label |

---

## 🧬 Architectural Principles

| Principle | Rule |
|---|---|
| **Plugin-first** | Every feature after v2.0 ships as plugin first. Graduate to core if >30% adoption. |
| **Driver isolation** | Platform drivers are independent modules — crash one, others survive. |
| **Zero core deps** | Core stays zero-dep. Plugins may have deps; sandboxed in worker threads. |
| **Cache-first** | Every AI/ML feature caches results locally. Repeated queries are free. |
| **Opt-in intelligence** | No feature runs without user consent. BYO-key, local execution, no telemetry. |
| **Terminal-native** | Use terminal primitives: ANSI, OSC-52, tmux hooks, stdin/stdout pipes. |
| **Config as code** | All config is JSON/TOML. Version-controllable. Diffable. Team-shareable. |

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

*This vision is intentionally maximalist. The point isn't to ship everything — it's to make every "what about…" question land in one of these buckets so we can sequence the next move with confidence.*

*The terminal isn't a relic. It's the future of developer tooling. And GitHub TUI is leading the charge.*

*License: MIT.*
