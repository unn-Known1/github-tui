# GitHub TUI — Vision & Roadmap

> *A living brainstorm of every realistic use case, persona, and feature that could make this app indispensable for every kind of GitHub user — from solo hackers to enterprise platform teams.*

**Current version:** v0.5.5 (complete feature set: dashboard, repos, analyze with 10 panes, inbox, settings, mouse support, collapsible sections, 8 themes).

**Next milestone:** v0.6 — "Cache & Offline" (disk-backed ETag cache, offline mode, background prefetch).

---

## 📌 Table of Contents

1. #-status-snapshot
2. #-guiding-principles
3. #-user-personas
4. #-use-cases-by-persona
5. #-feature-backlog-by-category
6. #-killer-features-the-must-have-moves
7. #-workflow-recipes
8. #-differentiators-vs-gh-lazygit-octobox
9. #-phased-roadmap
10. #-quality-dx--distribution
11. #-stretch--moonshot-ideas

---

## 📊 Status Snapshot

| Capability | State | Notes |
|---|---|---|
| Modular architecture (`tui/` split) | ✅ shipped v0.3 | 23 modules; tab modules export `render` + `keys` + dispatchers |
| Dashboard with widgets | ✅ shipped v0.4 | Greeting, stat cards, activity feed, trending, languages bar, heatmap, sparkline, followers |
| Repos browser (sort + filter + paginate) | ✅ shipped v0.3 | `/` filter, `c` clear, aggregate header stats, density toggle, pins |
| Analyze: search → details → forks | ✅ shipped v0.2 | 2-column details with languages/contributors/releases |
| Issues & PRs sub-panes | ✅ shipped v0.2 | Toggle via `i` / `P` / `O` on details |
| Issue / PR detail popup | ✅ shipped v0.5 | Full detail view with rendered body, labels, comments, reviews, file diffs |
| Comment / react / close-reopen / merge | ✅ shipped v0.5 | POST endpoints + confirmation modals |
| PR diff viewer | ✅ shipped v0.5 | Unified diff with syntax-colored additions/deletions |
| Review Comments | ✅ shipped v0.5.5 | Reviews tab in PR detail with state icons |
| README viewer pane | ✅ shipped v0.3 | `R` opens it; naive Markdown styling |
| Forks ahead/behind compares (parallel) | ✅ shipped v0.2 | 5-worker concurrent pool |
| Traffic pane | ✅ shipped v0.5.5 | Views, clones, popular paths, popular referrers |
| Milestones pane | ✅ shipped v0.5.5 | Title, state, due date, open/closed issues |
| Labels pane | ✅ shipped v0.5.5 | Color dots, name, description |
| Checks/CI pane | ✅ shipped v0.5.5 | Check runs with pass/fail/pending summary |
| Security pane | ✅ shipped v0.5.5 | Dependabot alerts with severity icons |
| Inbox: list + open in browser | ✅ shipped v0.2 | Color-coded types, by-repo summary, relative time |
| Inbox: mark-as-read / all / unsubscribe | ✅ shipped v0.3 | Keys `m`/`M`/`u` |
| Inbox: filter cycle | ✅ shipped v0.3 | `f` cycles all → unread → mentions → review |
| Inbox: pagination | ✅ shipped v0.5 | `Space` loads more notifications |
| File explorer | ✅ shipped v0.3 | Tree browsing, save/clone/zipball, branch picker |
| Settings panel with system info | ✅ shipped v0.2 | Version, paths, Node, platform, terminal |
| Token scope inspector | ✅ shipped v0.3 | `lastScopes` from `x-oauth-scopes` |
| Secure local auth (chmod 600 + masked + 401 auto-clear) | ✅ shipped v0.2 | |
| Live API rate-limit indicator | ✅ shipped v0.5.5 | Visual `█░` bar in header + explicit endpoint |
| ETag-aware caching | ✅ shipped v0.3 | In-memory; auto `If-None-Match` |
| Command palette (Ctrl-P / `:`) | ✅ shipped v0.3 | ~30 registered actions, fuzzy match |
| Themes (8 themes) | ✅ shipped v0.5.5 | default/highContrast/dracula/solarized/nord/monokai/gruvbox/light |
| Bookmarks store | ✅ shipped v0.3 | `b` toggles; `B` browse overlay; `~/.github-tui/bookmarks.json` |
| Star / unstar from anywhere | ✅ shipped v0.3 | `*` |
| OSC-52 clipboard copy | ✅ shipped v0.3 | `y` |
| Help overlay (`?`) | ✅ shipped v0.5 | Updated for all keys including detail popup |
| Mouse support | ✅ shipped v0.5.5 | Click tabs/panes/items, scroll wheel, hover effects |
| Collapsible sections | ✅ shipped v0.5.5 | `z`/`Z`/`X` keys, disk persistence |
| Saved searches | ✅ shipped v0.5.5 | `Ctrl-P` → "Save current search"; run/delete via palette |
| Repo preferences persistence | ✅ shipped v0.5.5 | Sort, filter, density saved to `~/.github-tui/repo-prefs.json` |
| Disk-backed cache (beyond ETag) | 🔲 planned v0.6 | Survives restarts; offline mode |
| Workflows / Actions CI tab | ✅ shipped v0.5.5 | `4` → Actions; repos → runs; re-run/cancel; collapsible sections |
| Code search across orgs | 🔲 planned v0.8 | `searchCode` ready |
| OAuth device-flow + OS keychain | 🔲 planned v0.9 | |
| User-editable keybindings | 🔲 planned | File path reserved: `~/.github-tui/keys.json` |
| AI summarise (BYO-key) | 🔲 planned v1.x | |

## 🎯 Guiding Principles

Every feature we add should pass at least one of these tests:

| Principle | Smell test |
|---|---|
| **Keyboard-first** | Can a power user do it without ever touching the mouse? |
| **Zero-dependency core** | Does it stay installable with just `node app.mjs`? Optional extras are fine if isolated. |
| **Fast feedback** | Does it render in <100ms even with 1000 repos? |
| **Honest data** | We never invent data. Empty states are explicit. Errors are visible. |
| **Discoverable** | Every key is in `?` help and in the command palette. Every action has a hint in the status bar. |
| **Composable** | TUI mode is one face; the same core powers a non-interactive CLI and pipe-friendly output. |
| **Safe by default** | No destructive actions without confirmation. Tokens never leak to stdout, logs, or screenshots. |
| **Modular** | Each tab is one file. Adding a tab is: new file → register in state + render + keys. Palette picks up new actions automatically. |

---

## 👤 User Personas

### P1 — The Solo Hacker (Ada)
Maintains 30 small repos, side-projects galore, occasional issues from strangers. Wants a single place to triage stars, see what's exploding, and quickly open the right URL.

### P2 — The Open Source Maintainer (Linus)
One or two flagship repos with hundreds of forks and issues. Drowns in notifications. Wants powerful triage, fork analysis, contributor recognition.

### P3 — The Engineering Manager (Priya)
Doesn't write code daily but tracks 5 teams across 50 repos. Wants dashboards, throughput metrics, who-needs-review nudges, weekly digests.

### P4 — The Senior IC at a Big Company (Marcus)
100+ private repos in an org. Needs fast code search, PR review queue, mention triage, and "what changed since I was OOO" recap.

### P5 — The DevRel / Tech Writer (Sam)
Monitors trending repos, tracks specific topics (e.g. WebGPU), needs nice screenshots and Markdown exports.

### P6 — The Security / Platform Engineer (Reza)
Watches Dependabot, vulnerability alerts, CI failures across many repos. Needs aggregated views.

### P7 — The Student / Learner (Mei)
Explores popular repos by language, reads READMEs, follows tutorials. Wants discoverability, bookmarks, learning paths.

### P8 — The Recruiter / Talent Sourcer (Jordan)
Profiles candidates by their repos, contribution graphs, language mix, activity recency. Needs export-friendly summaries.

### P9 — The CI/CD Operator (Casey)
Focuses on Actions: which workflows are failing, queue depth, runner stats. Needs a live dashboard.

### P10 — The Offline / Low-Bandwidth User (Tomás)
Works in trains, planes, cafés. Needs aggressive caching and a clear offline indicator.

## 🛠️ Use Cases by Persona

### P1 — Solo Hacker
- ✅ See a unified feed: "someone starred my repo," "new issue," "PR comment." (Dashboard activity feed + Inbox)
- ✅ Quickly open the repo I just got an email about. (`o` from Inbox)
- 🔲 Track weekly growth of stars across all my repos (sparkline).
- ✅ Bookmark interesting trending repos to read later. (`b`)
- 🔲 Spot which side-project hasn't been touched in 6 months. (sort exists; needs "stale" filter)

### P2 — OSS Maintainer
- 🔲 Triage queue: issues needing reply (no maintainer comment yet), stale PRs.
- ✅ Fork comparison: who has actually advanced beyond `main`? (Forks view with ahead/behind)
- 🔲 "Good first issue" curation — find/label/promote.
- 🟡 Identify top contributors over the last 30/90/365 days. (top contributors shown for whole-repo lifetime)
- 🔲 Detect mention-only issues vs. real bug reports.
- 🔲 Bulk-label, bulk-close, bulk-react to issues.
- 🔲 Auto-suggest reviewers from CODEOWNERS.

### P3 — Engineering Manager
- 🔲 Weekly throughput dashboard: PRs opened/merged per team, cycle time.
- 🔲 WIP / cycle-time chart per repo.
- 🔲 "Who's blocked" view — PRs waiting on review > 48h.
- 🟡 Release radar — what shipped this week across all watched repos. (Trending widget partly covers this for public)
- 🔲 Burndown of open issues by label / milestone.
- 🔲 Stuck-PR alerts: no activity in N days.

### P4 — Senior IC at Big Co.
- 🔲 PR review queue with priority sort (mentions > requested-review > team).
- 🔲 "What changed while I was on PTO": diff of merges since date X.
- 🟡 Code search across the org. (API ready in `github.mjs`; needs UI surface)
- ✅ Mention inbox separate from regular notifications. (filter `f`)
- 🔲 Quick CODEOWNERS lookup: who owns this path?
- 🟡 Saved searches ("all open PRs labeled `infra` in org X"). (store ready; needs UI)

### P5 — DevRel / Writer
- ✅ Topic explorer: trending in last 7d. (Dashboard widget)
- 🔲 Topic explorer: 30d / 90d / by language.
- 🔲 Markdown export of a curated list of repos.
- 🔲 Screenshot mode (clean, no token info on screen).
- 🔲 Compare repos side-by-side (stars, contributors, release cadence).
- 🔲 Watch for new releases of N specific repos.
- 🔲 Trending authors (most-starred new repos by user).

### P6 — Security / Platform
- 🔲 Dependabot alerts aggregated across repos.
- 🔲 Vulnerability digest with severity sort.
- 🟡 Workflow failure aggregator: every red ✗ across an org. (API ready; UI pending)
- 🔲 Secret scanning hits (where API permits).
- 🔲 Branch protection auditor: which default branches lack required reviews?

### P7 — Student / Learner
- ✅ Recommended repos by stars. (Trending; needs language facet)
- ✅ README viewer with Markdown rendering in-TUI. (`R` pane)
- 🟡 Bookmark / "read later" list. (store ready; needs dedicated tab)
- 🔲 Walkthrough: open the README, then drill into examples folder.
- 🔲 Language learning path (e.g. "top 20 Rust beginner repos").
- 🔲 Follow a curated topic and get weekly updates.

### P8 — Recruiter / Talent
- 🔲 User profile dive: language mix pie, commit frequency sparkline, top repos.
- 🔲 Public org affiliations.
- 🔲 Export profile snapshot to Markdown / PDF.
- 🔲 Compare two users side-by-side.
- 🔲 (Strict opt-in only — no scraping behaviors.)

### P9 — CI/CD Operator
- 🟡 Live Actions monitor: queued / in-progress / failed across N repos. (API ready)
- 🟡 Re-run failed workflows from the TUI. (API ready)
- 🔲 View workflow logs (paginated).
- 🔲 Runner utilization heatmap (if available via API).
- 🟡 Cancel runaway runs. (API ready)

### P10 — Offline User
- 🟡 Aggressive cache with manual "refresh" button. (ETag layer ships; disk cache pending)
- 🔲 "Last synced" timestamp visible on every tab.
- 🔲 Local search across cached data.
- 🔲 Queue: "open in browser when online."

Legend: ✅ shipped · 🟡 partial (API or store ready, UI pending) · 🔲 not started

## 🧩 Feature Backlog by Category

### A. Discovery & Search
- 🟡 Cross-repo code search (`/search/code`) — *API ready, needs UI*
- 🔲 Repo search filters: language, stars range, license, last update
- 🟡 User search — *API ready (`searchUsers`)*
- ✅ Topic explorer with trending sort *(7d default; needs 30d/90d toggles)*
- 🟡 Saved searches — *store ready; needs palette + tab UI*
- ✅ Fuzzy local filter on every list (FZF-style for command palette today)
- ✅ Command palette (`Ctrl-P` / `:`)

### B. Notifications & Inbox
- ✅ Mark-as-read (single)
- ✅ Mark-all-as-read
- ✅ Unsubscribe from a thread
- ✅ Filter by reason cycle (all / unread / mentions / review)
- 🔲 Mark-as-done (archive)
- 🔲 Filter by repo / by date
- 🔲 Group by repo / by reason / by date (visible groups; the by-repo summary is already there)
- 🔲 Mute repos
- 🔲 Desktop-notification bridge (optional, OS-specific helper)
- 🔲 Inbox-zero motivation: streak counter, daily quota

### C. PR / Issue Workflow  *(major focus for v0.4)*
- 🔲 Open PR/Issue detail popup with full body (Markdown rendered)
- 🔲 Comment from the TUI
- 🔲 React (👍 / ❤️ / 🚀 / etc)
- 🔲 Approve / Request changes / Comment review
- 🔲 Merge / squash / rebase (with confirmation)
- 🔲 Re-request review
- 🔲 Assign labels / milestone / assignee
- 🔲 Close / reopen
- 🔲 Convert issue ↔ discussion
- 🔲 Create issue / PR from a template
- 🔲 Inline diff viewer with file tree

### D. Code & Files
- 🟡 Browse repo file tree — *`getRepoContents` ready*
- 🟡 View file contents — *`getRepoFile` returns raw; needs viewer pane + tiny lexer*
- 🔲 View blame
- 🔲 View commit history per file
- 🔲 Compare two branches / two tags
- ✅ Markdown preview (rendered in-TUI) — *naive styling on README pane*
- ✅ README viewer on any repo detail page

### E. Analytics & Dashboards
- 🔲 Sparkline of stars over time (daily delta)
- 🔲 Contribution heatmap (the classic green grid) for any user
- ✅ Language pie / bar across personal repos
- 🔲 Open-vs-closed issue trend
- 🔲 PR cycle-time histogram
- 🟡 Top contributors over a chosen window (we show lifetime today)
- 🔲 Release cadence (releases per month)
- 🔲 "Time spent reviewing" estimator

### F. Actions & CI
- 🟡 List runs per workflow — *API ready (`getWorkflowRuns`)*
- 🔲 Filter by status (queued / in_progress / completed / failed)
- 🟡 Re-run / cancel runs — *API ready*
- 🔲 Tail logs in a pager view
- 🔲 Workflow file viewer
- 🔲 Dispatch `workflow_dispatch` with inputs

### G. Releases & Tags
- ✅ Latest release notes shown on details — *needs full body viewer*
- 🔲 Subscribe to release of specific repos
- 🔲 Compare two releases (changelog diff)
- 🔲 Draft a release from the TUI

### H. Stars, Watches, Bookmarks
- ✅ Star / unstar (`s`)
- 🔲 Watch / unwatch with custom subscription level
- ✅ Local bookmarks (`b`) — separate from GitHub stars
- 🔲 Folders / tags for bookmarks
- 🔲 Export bookmarks to Markdown
- 🔲 Dedicated Bookmarks tab (currently store-only)

### I. Profiles & Social
- 🔲 User profile view with their repos, orgs, recent activity
- 🔲 Follow / unfollow
- 🔲 Followers / following lists
- 🔲 Gists CRUD (list / view / create / edit / delete)
- 🔲 SSH key list (read-only)

### J. Orgs & Teams
- 🔲 Org switcher in the title bar
- 🔲 Org member list with role
- 🔲 Team browser
- 🔲 Org-wide PR review queue
- 🔲 CODEOWNERS resolver for any path

### K. Security
- 🔲 Dependabot alerts (per repo and aggregated)
- 🔲 Security advisories
- ✅ Token scope inspector (visible in Settings)
- 🔲 Read-only "safe mode" toggle
- 🔲 OS keychain integration (macOS Keychain, libsecret, Windows Credential Manager)
- 🔲 OAuth device-flow login (no PAT needed)

### L. Productivity & UX
- ✅ Command palette `:` / `Ctrl-P`
- 🔲 Vim-style command mode (`:repos`, `:open foo/bar`)
- 🔲 Multi-tab workspaces
- 🔲 Pinned items (always at top of a list)
- 🔲 Customisable keybindings via `~/.github-tui/keys.json` (file path reserved)
- ✅ Themes (default / highContrast / dracula / solarized)
- 🔲 More themes (monokai, nord, gruvbox, …)
- 🔲 Localization / i18n (English first, then DE / FR / JA / HI / ZH)
- 🔲 Mouse support (optional toggle)
- 🔲 Screenshot mode — hides token / private repos for clean public demos
- 🔲 Export current view to Markdown / JSON / CSV

### M. Performance & Offline
- ✅ ETag cache (in-memory)
- 🔲 Disk cache layer (persist ETag cache across runs)
- ✅ Conditional requests for every GET (automatic via ETag)
- 🔲 Offline mode with last-synced banner
- 🔲 Background prefetch of starred repos
- 🔲 Cache eviction policy (LRU, configurable max MB)

### N. Integrations
- ✅ Cross-platform browser open (`o`) via `child_process.spawn`
- ✅ OSC-52 clipboard copy (`y`)
- 🔲 `git` integration: clone selected repo, check it out, open in `$EDITOR`
- 🔲 Editor integration: `e` on a file opens it in `$EDITOR` (after clone)
- 🔲 Webhook listener mode (advanced, optional)
- 🔲 Slack / Discord webhook outbound
- 🔲 iCal export of milestones / release dates
- 🔲 GraphQL fallback for advanced queries
- 🔲 GitHub Enterprise Server support (configurable hostname)

### O. AI / Smart Helpers (opt-in, BYO-key)
- 🔲 Summarise a long PR description
- 🔲 Summarise a noisy issue thread
- 🔲 Suggest labels from issue text
- 🔲 Draft a reply / review comment
- 🔲 "Explain this diff"
- 🔲 Group similar issues
- 🔲 Daily standup auto-generator from your activity feed

### P. Accessibility
- ✅ High-contrast theme
- 🔲 Screen-reader-friendly mode (linearized layout, no fancy box-drawing)
- 🔲 Configurable font-cell width assumption
- 🔲 Reduced-motion mode (no spinners, just static `[loading]`)

Legend: ✅ shipped · 🟡 partial / wired but no UI · 🔲 not started

## 💎 Killer Features (the "must-have" moves)

Progress check on the 10 we originally listed:

1. ✅ **Command Palette (`Ctrl-P`)** — every action discoverable.
2. 🔲 **PR Review Workflow in-TUI** — comment, approve, merge. *(v0.4 focus)*
3. ✅ **Inbox actions** — mark read / mark all / unsubscribe / filter cycle.
4. 🟡 **Disk cache with ETags** — ETag layer ships in v0.3; disk persistence planned v0.6.
5. ✅ **README + Markdown renderer** — `R` pane on details.
6. 🟡 **Saved searches** — store ready; needs UI surface.
7. 🔲 **OS-keychain token storage** — *v0.9*.
8. 🔲 **Workflow runs dashboard** — *v0.7; API already wired*.
9. 🔲 **AI summarise (BYO-key)** — *v1.x; opt-in so no dep bloat*.
10. ✅ **Themes + keybinding customisation** — themes shipped; keybinding customisation planned v0.5.

**Score so far: 4 fully shipped, 3 partial, 3 ahead.**

---

## 🧑‍🍳 Workflow Recipes

Real sequences a user runs through, end-to-end. Status reflects today.

### R1 — "Morning Triage" ✅ *fully supported*
1. Launch → Dashboard auto-loads. Glance at 🔔 badge.
2. `5` → Inbox. `f` to filter `unread`. `M` to mark stale ones read.
3. `m` to clear individual threads; `u` to mute noisy ones; `o` to open the important one in browser.
4. `1` → Dashboard. Verify unread count dropped.
5. `q` quit.

### R2 — "Find Something to Work On" 🟡 *mostly supported*
1. `3` → Analyze. `Ctrl-P` → "Search public repositories". Enter.
2. Browse list, `o` to open in browser, `b` to bookmark for later.
3. On a chosen repo, `i` → Issues pane.
4. *Pending:* `Enter` on an issue → in-TUI detail. Comment from here. *(v0.4)*

### R3 — "Maintainer Fork Hunt" ✅ *fully supported*
1. `3` → search my repo → `Enter`.
2. `Enter` again → Forks. Sort by `p` (last push).
3. See which forks have actual commits ahead of main.
4. `o` to open the most promising fork. `b` to bookmark.
5. `Space` if there are more than 30 forks.

### R4 — "Standup Generator" 🔲 *v1.x*
1. `Ctrl-P` → "Generate standup".
2. App pulls my events from the last 24h, dedups, summarises.
3. Output rendered in a pop-up, copy with `y` (OSC-52). *(`y` already works for URLs)*

### R5 — "CI Cockpit" ✅ *shipped v0.5.5*
1. `4` → Actions tab.
2. Browse repos → view workflow runs → see status.
3. `r` re-run failed. `x` cancel.

### R6 — "OOO Recap" 🔲 *v0.5*
1. `Ctrl-P` → "Since I was last here".
2. App shows: merges I missed, mentions waiting, new issues on my repos.

### R7 — "Bookmark Sprint" ✅ *partially shipped*
1. Trending → `b` to bookmark repos. ✅
2. `B` → Browse bookmarks overlay. `d` delete, `y` copy URL. ✅
3. `Ctrl-P` → "Export bookmarks to Markdown". ✅

### R8 — "Stuck PR Audit" 🔲 *v0.4*
1. `Ctrl-P` → "Stuck PRs > 7d".
2. List of PRs with no activity. `n` to nudge (auto-comment with template).

### R9 — "Security Sweep" 🔲 *v0.9*
1. `Ctrl-P` → "Dependabot alerts".
2. Aggregated, sorted by severity.
3. `Enter` → details and remediation PR if available.

### R10 — "Read a Repo Like a Book" 🟡 *partial*
1. Search → Enter on a repo. ✅
2. `R` → README rendered. ✅
3. *Pending:* `f` → file tree. Navigate. `v` view file with syntax highlight. *(v0.8)*

---

## 🆚 Differentiators vs. `gh`, lazygit, octobox

| Need | `gh` CLI | lazygit | octobox | **GitHub TUI (this)** |
|---|---|---|---|---|
| Interactive, navigable UI | ❌ | ✅ (git-focused) | ✅ (notifications only) | ✅ |
| Multi-tab dashboards | ❌ | ❌ | ❌ | ✅ |
| Trending / discovery | ❌ | ❌ | ❌ | ✅ |
| README rendered in terminal | ❌ | ❌ | ❌ | ✅ (v0.3) |
| Command palette | partial | ❌ | ❌ | ✅ (v0.3) |
| Themes (multi) | ❌ | ✅ | ❌ | ✅ (v0.3) |
| ETag caching (cheap reloads) | ❌ | n/a | n/a | ✅ (v0.3) |
| Inbox triage in-TUI | ❌ | ❌ | ✅ (web) | ✅ (v0.3) |
| Forks ahead/behind in one view | ❌ | ❌ | ❌ | ✅ |
| OSC-52 clipboard | ❌ | partial | n/a | ✅ (v0.3) |
| Zero install (just `node app.mjs`) | needs install | needs install | web app | ✅ |
| Persistent disk cache + offline | ❌ | ❌ | ❌ | 🎯 v0.6 |
| BYO-key AI summarise | ❌ | ❌ | ❌ | 🎯 v1.x |
| GH Enterprise Server | ✅ | n/a | partial | 🎯 v0.9 |

**Positioning statement:** *The fastest way to live in GitHub without a browser tab — discovery, triage, review, and CI in one terminal, with everything one fuzzy search away.*

## 🗓️ Phased Roadmap

### v0.3 — "Modular foundations + power-user inbox" ✅ SHIPPED
- Modular refactor: 22 focused modules under `tui/` with one file per tab.
- Command palette (`Ctrl-P` / `:`) with fuzzy match and self-registering actions.
- Themes: `default`, `highContrast`, `dracula`, `solarized`, `nord`, `monokai`, `gruvbox` — persisted to disk.
- Inbox triage: `m` mark read, `M` mark all, `u` unsubscribe, `f` filter cycle, `Space` load more.
- README viewer pane (`R`) with naive Markdown styling.
- OSC-52 clipboard copy (`y`) — works over SSH and tmux.
- Bookmarks store (`b`) — `~/.github-tui/bookmarks.json` with chmod 600.
- Star / unstar (`*`) on currently-pointed-at repo.
- ETag-aware caching — automatic `If-None-Match` for free 304s.
- Token-scope inspector in Settings system panel.
- File explorer with tree browsing, save/clone/zipball, branch picker.
- Dashboard enhancements: contribution heatmap, star history sparkline, recent issues/PRs.
- New API endpoints ready for next milestones: workflows, code/user/issue search.

### v0.4 / v0.5 — "Review from terminal + Customisation" ✅ SHIPPED
- In-TUI Issue/PR detail popup with rendered body, labels, comments, file diffs.
- Comment / react (emoji picker) / close-reopen / merge actions (with confirmation modal).
- PR diff viewer (file list + unified diff with syntax coloring).
- Inbox notifications open detail popup for issues/PRs.
- 7 themes (added nord, monokai, gruvbox).
- Help overlay updated for all new keybindings.

### v0.5.5 — "Repo Analytics + Input Systems" ✅ SHIPPED
- **Rate limit indicator** — visual `█░` bar in header + explicit `/rate_limit` endpoint.
- **Traffic pane** — views, clones, popular paths, popular referrers.
- **Milestones pane** — title, state, due date, open/closed issues.
- **Labels pane** — color dots, name, description.
- **Checks/CI pane** — check runs with pass/fail/pending summary.
- **Security pane** — Dependabot alerts with severity icons.
- **Review Comments** — Reviews tab in PR detail view with state icons.
- **Mouse support** — click tabs/panes/items, scroll wheel, hover effects.
- **Collapsible sections** — `z`/`Z`/`X` keys, disk persistence.
- **Followers section** — recent followers in Dashboard profile.
- **8 themes** — added light theme.

### v0.6 — "Cache & Offline" *(next)*
- Disk-backed ETag cache (survives restarts).
- Offline banner; "last-synced" timestamps per tab.
- Background prefetch of starred repos.
- Hard rate-limit-budget mode.
- LRU eviction with configurable max MB.

### v0.7 — "CI Cockpit"
- Actions tab: runs, statuses, re-run, cancel. (API already wired.)
- Workflow log tail with paging.
- Workflow dispatch UI (`workflow_dispatch` with inputs).
- Failed-workflow aggregator across watched repos.

### v0.8 — "Discovery & Read Mode"
- Topic explorer with language facet + 7d/30d/90d toggles.
- Syntax-highlighted file view (tiny lexer for the top 10 languages).
- Compare branches/tags.
- Code search using `searchCode`.

### v0.9 — "Security & Enterprise"
- Token-scope auditor with warnings for over-privileged tokens.
- GitHub Enterprise Server configurable host.
- OS keychain integration (mac/linux/windows).
- OAuth device-flow login (no PAT required).

### v1.0 — "Polish & Launch"
- Accessibility pass (screen-reader-friendly mode).
- Comprehensive `--help` and standalone CLI subcommands.
- Static binary via `pkg` (optional install path).
- Homebrew / Scoop / AUR / Nix packaging.
- Demo gif on README, marketing site stub.

### v1.x+ — "Smart Helpers"
- BYO-key AI summarise / draft.
- Standup generator (recipe R4).
- Smart triage hints (suggest labels, flag duplicates).

---

## 🧪 Quality, DX & Distribution

### Testing
- Snapshot tests for tab renderers — feed in a fixed `appState` clone, assert exact char buffer.
- API client tests with a hand-rolled fake `https` server.
- Property tests for sort / filter / fuzzy-score / scroll math.
- Visual regression: take a printable screen dump, diff vs. golden file.
- The modular layout makes most of `tui/*.mjs` testable without an actual terminal.

### Telemetry (opt-in, anonymised)
- Most-used commands (helps prune dead keys).
- Average session length.
- Error rates by API call.
- Strictly opt-in via a Settings toggle; plaintext disclosure of what's sent.

### Logging
- `~/.github-tui/log` rotating debug log (off by default).
- `--verbose` flag.
- Redact tokens automatically before logging.

### Distribution
- npm: `npx github-tui` zero-install.
- Homebrew: `brew install gaurang/tap/github-tui`.
- Scoop / Chocolatey for Windows.
- AUR for Arch.
- Nix flake.
- Static binaries on GitHub Releases (via `pkg` or `nexe`).

### Docs
- Animated terminal demo (GIF via `vhs` or `asciinema`).
- Per-feature short docs in `docs/`.
- A keybinding cheatsheet printable PDF.
- The `?` overlay links to `docs/` URLs.

---

## 🚀 Stretch / Moonshot Ideas

- **Multi-account switching** (`Ctrl-A` to swap between work / personal tokens).
- **Pair-mode** — two terminals connected, shared cursor for code review.
- **Time-travel snapshot** — `git bisect`-style for issue threads ("what did the discussion look like Tuesday?").
- **Embeddable** — expose the TUI as a tmux/zellij/wezterm pane plugin.
- **Voice mode** (opt-in, BYO STT) — "open my repos" → switches tabs.
- **Personal analytics dashboard** — generate a yearly "GitHub Wrapped" PDF.
- **Bring-your-own-data** import — Linear, Jira, GitLab adapters.
- **Repo health score** — composite metric (CI green %, PR cycle time, doc coverage).
- **Pluggable widgets** — drop a JS file into `~/.github-tui/widgets/` and it appears on the Dashboard. *(Easier now that tab modules already expose a `render(screen, y, h)` contract.)*
- **Story mode** — "Walk me through this repo" — README, examples, recent commits, top contributors, in sequence.

---

## 📦 v0.3 Release Notes

The single biggest leap since v0.2. Headlines:

- **App is no longer a 1978-line file.** It is one ~60-line entrypoint + 14 focused modules. Every future feature lands in a small file with a clear job.
- **Command palette + themes.** Two killer-feature UX moves shipped at once.
- **Inbox triage.** The most-requested feature for any GitHub client.
- **README pane.** Read a repo without leaving the terminal.
- **Star, bookmark, copy URL from anywhere.** Three different verbs, three single keys.
- **ETag cache.** Repeated views cost zero rate-limit budget.

---

*This vision is intentionally maximalist. The point isn't to ship everything — it's to make every "what about…" question land in one of these buckets so we can sequence the next move with confidence.*

*License: MIT.*
