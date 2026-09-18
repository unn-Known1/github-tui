# Local Git Workspace — Full Implementation Plan

> **Status:** Shipped as v0.8.0 · **Version:** 1.7 · **Date:** 2026-09-18
> **Implementation:** All phases landed — 501 tests, 500 pass, 0 fail. Deferred to v0.8.1+: hunk staging, `fs.watch`, commit-body editor widget, stash/rebase manager.
> **Scope:** Monitor local `git` changes, commit history, stage/commit, pull/push when `github-tui` is launched inside any git repository.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem & Opportunity](#2-problem--opportunity)
3. [Goals / Non-Goals](#3-goals--non-goals)
4. [Current Architecture Context](#4-current-architecture-context)
5. [Solution Overview](#5-solution-overview)
6. [Detailed Design](#6-detailed-design)
7. [Implementation Phases](#7-implementation-phases)
8. [File & Change Inventory](#8-file--change-inventory)
9. [Keybindings & Palette](#9-keybindings--palette)
10. [Safety & Error Handling](#10-safety--error-handling)
11. [Polling & Performance](#11-polling--performance)
12. [Testing Plan](#12-testing-plan)
13. [Risks & Mitigations](#13-risks--mitigations)
14. [Timeline & Effort](#14-timeline--effort)
15. [Open Questions](#15-open-questions)
16. [Appendix](#16-appendix)

---

## 1. Executive Summary

`github-tui` is currently a **remote-only** GitHub viewer (`tui/github.mjs:32+` → REST v3, zero `git` writes except `git clone`/`gh clone` in `tui/tabs/files.mjs:928`). When a user runs `npx github-tui` inside an existing checkout, the only local awareness is `tui/git-context.mjs:17` `detectLocalRepo()` → `appState.localRepo` (`tui/state.mjs:592`), used for `[l] scope` filtering on Dashboard/Inbox.

**Proposal:** Add a **`Local` tab (key `7`), always visible**, that when `git rev-parse` succeeds shows live **Status**, **Diff**, **Commit History**, and actions **Stage / Discard / Commit / Fetch / Pull / Push / Branch**. When not in a git repo it shows a contextual empty state (same pattern as logged-out Dashboard, `tui/tabs/dashboard.mjs:720`). Works **without a GitHub token and without a GitHub remote** — local-only, GitLab, and Bitbucket checkouts are first-class.

This turns `github-tui` into a daily driver inside repos (discover → edit → commit → push → watch CI) without forking into a full `lazygit` clone. Phased, zero-dependency, safe-by-default, ships as `v0.8.0` with writes behind confirmation gates.

---

## 2. Problem & Opportunity

### Pain today

| Persona | Pain |
|---|---|
| Maintainer (VISION R2) | Edits locally, must leave TUI to `git status / add / commit / push`, then return to watch Actions tab (`tui/tabs/actions.mjs`). Loop is broken. |
| Contributor | Forks → clones via `[C] git clone` (`tui/tabs/files.mjs:910`), but cannot stage/commit/push fixes without dropping to shell. |
| Casual | Opens TUI inside repo, expects it to "just show" dirty files and history like VS Code Source Control — sees nothing. |

### Opportunity

* Keep all **GitHub-native** strengths (Dashboard, Repos, Explore, Actions, Inbox, rate-limit/ETag `tui/github.mjs:129+`).
* Add **local working-tree** surface so the TUI is useful from `process.cwd()` outward, not just `api.github.com` inward.
* Differentiation: `lazygit` = git-only, `gh` = CLI, `github-tui` = **local ⊕ remote** bridge (commit locally → push → Actions auto-refresh `app.mjs:69`).

---

## 3. Goals / Non-Goals

### Goals (v0.8)

* **G1 Monitor:** Show dirty state (staged/unstaged/untracked/conflicted) + ahead/behind vs upstream. Works offline, no token, any remote (or none).
* **G2 History:** Browse local `git log` + commit detail + file diff, offline, paginated.
* **G3 Diff:** View staged / unstaged / HEAD diffs **and untracked file contents** with existing syntax highlighting (`tui/recommended-features.mjs:detectLanguage`). Binary/too-large guarded.
* **G4 Stage (file-level only):** Stage / unstage per-file + stage-all/unstage-all + **discard** (restore/clean, double-confirm). Hunks deferred (see Non-Goals).
* **G5 Commit (multi-line — decided):** Commit via two-prompt flow (subject, then optional body, combined as `git commit -m <subject> -m <body>`), amend support. Single-line `input.mjs` footer modal is reused twice; no multi-line editor widget needed.
* **G6 Sync:** `fetch` (read-only) + `pull --rebase --autostash` + `push` (incl. `-u` first push) with ahead/behind badge, non-interactive auth (`GIT_TERMINAL_PROMPT=0`), timeouts, abortable.
* **G7 Branches:** List / switch / create / delete branches, show current + upstream + op-state (merge/rebase in progress).
* **G8 Safety:** Never lose work — every write behind `confirm()` (`tui/state.mjs:949`); discard + force-push double-confirmed; `--force-with-lease` only, never bare `--force`.

### Non-Goals (v0.8 — deferred, with rationale)

* **Hunk-level staging** — needs `diff -U0` parse + `apply --cached` (~300 LOC); v0.8.1.
* **`fs.watch` auto-monitor** — poll-only in v0.8.0 (§11); watcher is v0.8.1 optimization.
* **External `$EDITOR` commit** — requires suspending raw mode `app.mjs:253`; input modal covers subject-only 95%.
* **Stash manager / rebase --continue / cherry-pick / bisect / submodules / worktrees (beyond detection)** — lazygit territory; show op-state, delegate resolution.
* **SSH agent / credential UI** — delegates to `git credential.helper`; TUI fails fast with actionable hint.
* **Conflict merge tool** — shows conflicted state only, delegates to editor / manual resolve.
* **External commit body editor** — `$EDITOR` suspension is v0.9+; v0.8.0 body comes from the second prompt.

---

## 4. Current Architecture Context

```
app.mjs ──► state.mjs (appState, tabState, TABS[]) ──► render.mjs ──► tabs/*.mjs
                │                    ▲
                │                palette.mjs :register
                └─ git-context.mjs:detectLocalRepo() ──execFileSync git remote get-url
                   utils.mjs:runCommand / runCommandCapture (spawn, argv-array, shell-safe)
                   keys.mjs:global router + per-tab dispatch (order §1-8)
                   screen.mjs:diff renderer + invalidate() on viewKey change render.mjs:752
```

Key constraints preserved:

* **Zero npm deps** (`package.json:12` `node >=20`, `VISION.md:10` principle). Only `https`, `fs`, `os`, `path`, `child_process`.
* **Single `appState`** ESM live bindings (`tui/state.mjs:356`), no pub/sub. **Flat keys** for local state (matches `repoSelected` style).
* **`startAsync(scope)` / `isStale(handle)`** guard (`tui/state.mjs:254`) — every git shell-out uses it **and threads `handle.signal` into the child kill path**.
* **Argv-array `execFileSync/spawn`** (`tui/git-context.mjs:6`, `tui/keychain.mjs:130`). Never `exec('<user input>')`.
* **Branch validation via `git check-ref-format --branch`** (authoritative), not hand-rolled regex.
* **Tab contract:** `render(screen,y,h)`, `keys` map, `TABS[].refresh` lazy import (`tui/state.mjs:315`).

---

## 5. Solution Overview

### Chosen shape: 7th tab `Local` (key `7`), always visible

**Alternatives considered**

| Option | Pro | Con | Verdict |
|---|---|---|---|
| **A — 7th tab `Local`, always visible** (chosen) | Clean separation, follows `state.mjs:315` pattern, no index remapping, discoverable empty-state, trivial `TAB_CONTENT_Y[6]` | Strip crowding on narrow (<70 cols) — mitigated by responsive `renderTabStrip` `tui/render.mjs:491` + compact mode `tui/render.mjs:697` | **Ship** |
| A′ — 7th tab, hidden when not a repo | Saves one slot for non-repo users | Requires a `visible` API that doesn't exist; breaks `setTab`/cycling/session/mouse; tab indices shift under muscle memory | **Rejected** — complexity exceeds one slot |
| B — Overlay inside Files pane | No new tab | Files already dense (`tui/tabs/files.mjs:149+`); mixes remote-tree with local-worktree mental models | Rejected |
| C — Replace Dashboard when localRepo | Contextual | Breaks `TABS` model | Rejected |

**Visibility and boot rules**

* Local repo detection (`getLocalGitMeta()`: `isRepo/root/gitDir/branch/upstream`) runs at boot **outside** the `if (appState.token)` gate (`app.mjs:330`). `localIsRepo/localRoot/localBranch/localUpstream` are set regardless of auth.
* GitHub-remote mapping (`detectLocalRepo()` → `localRepo:{owner,repo}`) stays separate and optional. GitHub-only actions (open commit on github.com) hide/disable when `localRepo == null` with a "no GitHub remote — local only" header note.
* Tab always registered. When `!localIsRepo`: `emptyState(...{icon:'⋄ Local Git', title:'Not a git repository', ...})` + hint `[1-7] switch tabs`. No `visible` field, no index mapping.

### Layout inside `Local` tab

2-column on `W >= 80`, stacked on `<80` (same as Dashboard `isNarrow` `tui/tabs/dashboard.mjs:846`).

```
┌─ HEADER ──────────────────────────────────────────────┐
│ branch: main → origin/main  · ↑1 ↓0  · repo: owner/repo│ (or "local only")
│ [auto 1.5s] · Updated just now              [f]etch    │
├─ LEFT (status + diff) ─┼─ RIGHT (history) ────────────┤
│ STAGED (2)              │  COMMITS  main               │
│  M  src/foo.mjs         │  * a1b2c3d 2h ago alice — fix│
│  A  src/new.mjs         │  * e4f5g6h 1d ago bob — add  │
│ UNSTAGED (3)            │  ...                         │
│  M  README.md           │  [Enter] diff  [y] copy sha  │
│  ?? notes.txt           │                              │
│ CONFLICTED (0) / OP-STATE                             │
│ ── footer: [a]stage [X]discard [c]commit [f]fetch [p]pull [P]push [B]branch ──
└───────────────────────────────────────────────────────────────┘
```

* Collapsible sections `local:staged / unstaged / untracked / conflicted / commits / branch` via `collapsibleHeader` `tui/render.mjs:305` + `appState.collapsed`.
* Cursors: `localStatusSelected/localStatusScroll` + `localHistorySelected/localHistoryScroll` (flat, cf. `repoSelected` `tui/state.mjs:368`); `localFocus: 'status'|'history'` decides which `Enter/j/k` acts on (Tab is taken for tab-nav off-Dashboard per `tui/keys.mjs:593`; use `[`/`]` or ←/→ to switch panes inside Local).

---

## 6. Detailed Design

### 6.1 New Modules

| File | Role | Key exports |
|---|---|---|
| `tui/git-local.mjs` | Pure parsers + argv builders (testable, no `appState`) | `parsePorcelainV1Z(buf)`, `parseBranchHeader(line)`, `parseBranches(text)`, `parseLog(text)`, `statusArgs()`, `logArgs(n,skip)`, `diffArgs({staged,path})` |
| `tui/tabs/local.mjs` | Tab module: loads, render, keys, refresh, commit/push/pull/branch flows | `renderLocal(screen,y,h)`, `loadLocalStatus()`, `loadLocalHistory()`, `loadLocalDiff()`, `toggleStage()`, `discardFlow()`, `commitFlow()`, `fetchFlow()`, `pushFlow()`, `pullFlow()`, `branchPicker`, `keys`, `getSections()`, `refreshLocal()` |

No `git-watcher.mjs` in v0.8.0 (poll-only; watcher is v0.8.1). No new npm deps. All git via `runGit` (`tui/utils.mjs:626` extension) with `cwd: localRoot`. Branch-name validation (`git check-ref-format --branch`) lives in the tab layer.

**Enhance existing**

* `tui/git-context.mjs` — add `getLocalGitMeta()` returning `{ isRepo, root, branch, upstream, gitDir }` via `rev-parse --show-toplevel`, `--git-dir`, `symbolic-ref --short HEAD` (fallback `rev-parse --short HEAD` for detached), `rev-parse --abbrev-ref --symbolic-full-name @{u}`. Keep `detectLocalRepo()` untouched for GH mapping. All argv-array.
* `tui/state.mjs` — flat `local*` keys (§6.2) + `TABS[6]` + `TAB_CONTENT_Y[6]` + session persist `localAutoPoll`.
* `tui/utils.mjs` — add `runGit(args, {cwd, signal, timeoutMs, env})`: wraps `runCommandCapture('git', args, …)`, injects `GIT_TERMINAL_PROMPT=0`, default timeout 30s (120s for network ops), kills child on abort. Branch/path args always after `--` where applicable.
* `tui/keys.mjs` — `case '7'`, per-tab keys, palette registrations.

### 6.2 State Additions (flat keys, `tui/state.mjs:356`)

```js
// ── Local Git (v0.8) — flat keys, local (not account-bound) ──
localIsRepo: false,       // git rev-parse success
localRoot: '',            // rev-parse --show-toplevel
localGitDir: '',          // rev-parse --git-dir (handles worktree .git files)
localBranch: '',          // symbolic-ref --short HEAD or 'HEAD (detached ab12cd)'
localUpstream: null,      // "origin/main" or null
localAhead: 0, localBehind: 0,   // rev-list --left-right --count HEAD...@{u}
localOpState: null,       // null | 'merge' | 'rebase' | 'cherry-pick' | 'revert' (from state files)
localStaged: [],          // [{path, code}]  X in {M,A,D,R,C,T}
localUnstaged: [],        // [{path, code}]  Y in {M,D,T} (+ renames)
localUntracked: [],       // [{path}]
localConflicted: [],      // [{path, code}]  DD/AU/UD/UA/DU/AA/UU
localStatusError: null,
localHistory: [],         // [{sha, author, date, subject, body}]
localHistoryHasMore: true,
localHistoryPage: 1,
localStatusSelected: 0, localStatusScroll: 0,
localHistorySelected: 0, localHistoryScroll: 0,
localFocus: 'status',     // 'status' | 'history'
localDiff: null,          // {path, staged, text} | null
localAutoPoll: true,      // persisted in session.json
localLastFetched: null,   // ms freshness badge
```

`resetAccountState()` must **not** wipe these (local ≠ account). `saveSession/loadSession` (`tui/state.mjs:1201`) persist only `localAutoPoll`.

`TABS` entry (`tui/state.mjs:315`):

```js
{ key:'7', label:'Local',
  refresh: () => import('./tabs/local.mjs').then(m=>m.refreshLocal())
    .catch(e=>showMessage('Local refresh failed: '+(e.message||e),'error')) },
```

### 6.3 UI Spec (`tui/tabs/local.mjs:renderLocal`) — clean, modern, easy to use

Goal: a VS Code Source-Control feel with GitHub-TUI chrome. One glance answers "what changed, where am I, what can I do next". All rendering goes through `color()` tokens (`tui/theme.mjs:263`) so dark/light/`--accessible`/`NO_COLOR` stay correct; never hardcode ANSI.

* Reuse: `emptyState`, `collapsibleHeader`, `loadingIndicator`, `scrollIndicators`, `truncateToWidth` `tui/render.mjs`, `color` `tui/theme.mjs`, `relTime` `tui/utils.mjs:7`, `wrapTextWithMap` `tui/utils.mjs:211`, `tokenizeLine` `tui/recommended-features.mjs`, `splitLayout`/`getResponsiveConfig`/`getBreakpoint` `tui/layout.mjs`.
* `renderLocal` delegates to status / history / diff sub-renders honoring `isCollapsed('local:…')` (`tui/state.mjs:1029`).

**Layout (3 zones, responsive)**

```
┌─ STATUS BAR CARD ─────────────────────────────────────┐
│ ⑂ main → origin/main   ↑1 ↓0   ● auto   Updated just now │
│ repo: owner/repo (or "local only")      [f] Fetch       │
├─ LEFT: CHANGES ────────┼─ RIGHT: HISTORY ───────────────┤
│ STAGED (2)  [a]         │ COMMITS  main                  │
│  ● src/foo.mjs    +12-3 │  * a1b2c3d 2h alice — fix auth │
│ UNSTAGED (1)/UNTRACKED  │  * e4f5g6h 1d bob — add tests  │
│ CONFLICTED / OP-STATE   │ ── DIFF PREVIEW (focused item) │
└─────────────────────────────────────────────────────────┘
│ [Enter] diff [a] stage [X] discard [c] commit [f] [p] [P] [B] │
```

* `W >= 100` (lg/xl): 2 columns — left 45% changes, right 55% history + diff preview below history (`splitLayout(W, 0.45)`).
* `80–99` (md): same split, tighter truncation; diff preview collapses to selected-file stat line + `Enter` expands.
* `< 80` (xs/sm): single stacked column — header card, changes, history, diff — matching Dashboard `isNarrow` (`dashboard.mjs:846`); `getResponsiveConfig().compact` hides author/date columns first.
* Header is a **status card**, not a text line: branch chip + upstream + ahead/behind pills + poll dot + freshness (see §6.7 colors). Op-state banner (`MERGE/REBASE`) renders as a full-width red-tinted row above the columns; pull/push/commit show disabled reason in toast when pressed.
* Ease-of-use rules: one focus at a time (`localFocus: 'status'|'history'`, `[`/`]` or click switches; focused pane gets `cardBorderFocused` border + footer hints swap); contextual footer (only valid keys for current focus + op-state); progressive disclosure (diff preview shows stat + first ~15 lines, `Enter` fullscreen); every destructive row action echoes the path/count in its confirm; empty states per section ("No staged changes — `a` to stage", "No commits yet", "Clean — nothing to commit ✓") instead of blank space.
* Truncation: status lists capped at 200 rendered rows + `… +N more`; history 50 + `Space` append (same as `dashboard.mjs:896`); paths truncated with `truncateToWidth` keeping basename visible.

### 6.4 Git Command Inventory (argv-array, `cwd: localRoot`, non-interactive)

| Action | Command | Parse / note |
|---|---|---|
| Detect | `git rev-parse --is-inside-work-tree`, `--show-toplevel`, `--git-dir`, `symbolic-ref --short HEAD` (fallback `rev-parse --short HEAD`), `rev-parse --abbrev-ref --symbolic-full-name @{u}` | `isRepo=false` → emptyState, no toast |
| Op-state | `existsSync(join(gitDir,'MERGE_HEAD'))` → merge; `REBASE_HEAD`/`rebase-merge/`/`rebase-apply/` → rebase; `CHERRY_PICK_HEAD` → cherry-pick; `REVERT_HEAD` → revert | disables pull/push |
| Status | `git status --porcelain=v1 -b -z --untracked-files=all` | `parsePorcelainV1Z` (NUL split; `R old\0new` pairs; `##` header incl. `No commits yet`, detached, ahead/behind) |
| Diff staged | `git diff --no-color --unified=3 --cached -- <path>` | text; binary guard |
| Diff unstaged | `git diff --no-color --unified=3 -- <path>` | text |
| Untracked content | read `<root>/<path>` from disk (containment-checked vs `root`, not CWD) | `isProbablyBinary` + `MAX_VIEW_BYTES` (`files.mjs:33,97`) |
| Commit diff | `git show --no-color --unified=3 --stat <sha> --` + file variant | — |
| Log | `git log --decorate --date=iso --pretty=format:%H%x1f%an%x1f%ad%x1f%s%x1f%b%x1e --max-count=50 --skip=N` | `parseLog`; empty repo (exit 128 "does not have any commits") → `[]` |
| Ahead/behind | `git rev-list --left-right --count HEAD...@{u}` | no-upstream error → `0/0` |
| Branches | `git branch -a --no-color` | `parseBranches` (`*` current, `remotes/` remote) |
| Validate branch | `git check-ref-format --branch -- <name>` | exit 0 = valid |
| Stage | `git add -- <path>` | index.lock → toast + `setRetryHandler` |
| Unstage | `git restore --staged -- <path>`, fallback `git reset HEAD -- <path>` on `unknown option` (git <2.23; probe `git --version` once) | — |
| Stage-all | `git add -A` (confirm, count echo) | — |
| Discard (tracked) | `git restore --source=HEAD --staged --worktree -- <path>` (fallback `git checkout HEAD -- <path>`) — **double confirm** | irreversible |
| Discard (untracked) | `git clean -f -- <path>` — **double confirm** | irreversible |
| Commit | `git commit -m <subject> [-m <body>]` (two prompts; body optional, skipped when empty) | pre-check staged non-empty; surface hook stderr; identity-error hint |
| Amend | `git commit --amend -m <subject> [-m <body>]` (prefill both from HEAD) | confirm (rewrites HEAD) |
| Fetch | `git fetch --prune` (default remote/upstream) | read-only; refreshes ahead/behind |
| Pull | `git pull --rebase --autostash` (setting for `--no-rebase` in v0.8.1) | confirm when dirty (autostash note); conflict → conflicted section |
| Push | `git push` or `git push -u origin <branch>` (no upstream) | rejected → offer `--force-with-lease` behind **second** confirm; never `--force` |
| Checkout | `git checkout <name>` (not `switch` — universal) | dirty-tree confirm |
| Create | `git checkout -b <name>` | after `check-ref-format`; exists → error toast |
| Delete | `git branch -d <name>` (`-D` only behind extra confirm, unmerged) | confirm |
| Copy/open | `copyToClipboard(sha)` (`utils.mjs:378`); `openUrl(buildCommitUrl…)` (`files.mjs:127`, only when `localRepo`) | — |

Env for all network ops: `GIT_TERMINAL_PROMPT=0` (fail fast, no `/dev/tty` hang). Timeouts: 30s local, 120s fetch/pull/push. Abort kills child (SIGTERM→SIGKILL).

### 6.5 Safety & Confirmation Gates — detailed popup per critical action, no misclicks

Through `confirm(message, action, title)` (`tui/state.mjs:949`) + `runWithConfirm` pattern (`files.mjs:247`), upgraded as below. No destructive git write runs without its popup; the popup always names the **action, target, scope, exact command, and consequence** so `y` vs `n` is an informed choice, never a reflex.

**Dialog upgrade (required — current box can't hold detail)**

`renderConfirmDialog` (`tui/render.mjs:852`) today is a fixed 60×8 box showing max 3 wrapped lines of a flat string. That fits "Are you sure?" but not an informed git confirm. Upgrade:

* Structured body: `title` (action + target, e.g. `Discard changes — src/foo.mjs`) + `summary` line + `scope` lines (file/branch/count) + `command` line (argv equivalent, e.g. `` `git push origin main` ``) + `consequence` line (reversible vs **IRREVERSIBLE**). Multi-paragraph `\n` preserved (wrap per paragraph, not one word-stream).
* Dynamic height: `boxH = min(H-4, 6 + lines)` (cap, never overflow small terminals); `boxW = min(70, W-4)`; file lists truncated with `… +N more` (max 5 names shown).
* Severity styling: normal title `modalBorder`/accent; `danger` title red-bold + `⚠ IRREVERSIBLE` banner row.
* Keys: normal popup `y`/`Y`/`Enter` confirm, `n`/`N`/`Esc` cancel (`keys.mjs:508` stays). **Danger popup: literal `y` only — `Enter` does nothing** (kills the misclick where Enter meant "open" a split-second earlier). Implemented via `confirmDanger()` wrapper setting `appState._confirmDanger=true`, cleared on settle.
* Mouse: today any click dismisses (`mouse.mjs:517`) — safe but mouse users **cannot** confirm. Add clickable `[Yes]`/`[Cancel]` buttons with published hit bounds (`appState._confirmBounds`); click Yes = same as `y` (danger still requires the Yes click, no single-pixel accidents: buttons min 10 cells wide, separated); click outside = cancel.

**Per-action popup matrix (exact content contract)**

| Action | Level | Title | Body shows | Consequence line |
|---|---|---|---|---|
| Stage-all `A` | normal | `Stage all — N files` | count + first 5 paths + `git add -A` | `Undo with unstage.` |
| Discard tracked `X` | **danger ×2** | (1) `Discard changes — <path>` / (2) `Confirm discard — IRREVERSIBLE` | (1) `git restore --source=HEAD --staged --worktree -- <path>` + diff stat `+a -b`; (2) repeats target + `Type y to destroy` | `⚠ IRREVERSIBLE — working-tree edits are lost.` |
| Discard untracked `X` | **danger ×2** | same pattern | `git clean -f -- <path>` + size | `⚠ IRREVERSIBLE — file is deleted from disk.` |
| Commit `c` | normal | `Commit — N staged` | subject + body preview (first 3 lines) + staged count/names + `git commit -m … [-m …]` | `Creates a local commit on <branch>.` |
| Amend `C` | normal+ | `Amend HEAD — <sha>` | old subject → new subject (+body) + `git commit --amend` | `Rewrites the last commit (SHA changes).` |
| Pull `p` (clean) | normal | `Pull --rebase — <upstream>` | `git pull --rebase --autostash` + ahead/behind | `Local commits will be rebased.` |
| Pull `p` (dirty) | normal+ | same + `working tree not clean` | file count + `autostash will stash/pop your changes` | `Resolve conflicts manually if it stops.` |
| Push `P` | normal | `Push — <branch> → <upstream>` | `git push` + ahead N (behind must be 0 or blocked) | `Updates the remote branch.` |
| Push `-u` (no upstream) | normal+ | `Push & set upstream — <branch>` | `git push -u origin <branch>` | `Creates the remote branch and tracks it.` |
| Push lease (rejected) | **danger ×2** | (1) `Push rejected — non-fast-forward` / (2) `Force with lease — IRREVERSIBLE RISK` | (1) server reason + behind N + `pull first?`; (2) `git push --force-with-lease` + lease semantics | `⚠ Rewrites remote history (lease-guarded). Never bare --force.` |
| Checkout (dirty) | normal+ | `Switch to <name>?` | `git checkout <name>` + dirty count `Changes will be carried.` | `Uncommitted changes move with you.` |
| Checkout (clean) | none | — (direct, no popup; low-risk) | — | — |
| Create branch | normal | `Create branch — <name>` | `git checkout -b <name>` (post-`check-ref-format`) | `Switches to the new branch.` |
| Delete `-d` | normal+ | `Delete branch — <name>?` | `git branch -d <name>` + merged status | `Recoverable via reflog for ~30 days.` |
| Delete `-D` (unmerged) | **danger ×2** | (2) `Force-delete unmerged branch?` | `git branch -D <name>` + unmerged warning | `⚠ Unmerged commits may be lost.` |

No popup (deliberately): single-file stage/unstage (undoable both ways), `fetch --prune` (read-only), clean checkout (above), `Enter` diff view, navigation. Anything irreversible or remote-touching always pops — no exceptions.

* Paths always after `--`; branch names via `check-ref-format`; subject capped (~500 chars), body capped (~4000 chars) before argv. Stacked-confirm guard (`state.mjs:952`) stays: a second critical keypress while a popup is open toasts instead of stacking.

### 6.6 Keybindings (Local tab)

| Key | Action |
|---|---|
| `Enter` | Diff selected file / commit |
| `a` | Stage / unstage selected file (toggle) |
| `A` | Stage-all / unstage-all (confirm) |
| `X` | Discard selected (double confirm) |
| `c` / `C` | Commit / amend (input modal) |
| `f` | Fetch `--prune` |
| `p` / `P` | Pull `--rebase --autostash` / push |
| `B` | Branch picker (`Enter` checkout, `n` create, `d` delete) |
| `[` / `]` | Switch status/history focus |
| `y` / `o` | Copy SHA/path; open on GitHub (remote only) |
| `b` | Branch picker alias (same as `B`; kills the dead-key warning, see §6.8) |
| `r`, `g`/`G`, `Space`, `z`/`Z` | Refresh, top/bottom (`g` = two-press via Go group), more history, collapse handling |

**Key collision note:** global `X` = expand-all (`keys.mjs:750`), but Local needs `X` for discard (lazygit parity, hard to replace). Local `X` = discard and expand-all is palette-only inside Local. Deliberate, documented here. Full overlap audit with fixes: §6.8 — no Local shortcut may be dead or hijacked when the tab is active.

Palette ids: `local.refresh/stage/unstageAll/discard/commit/amend/fetch/pull/push/branch/diff/openCommit`.

### 6.7 Visual Style Tokens & Full Mouse Support

**Color system (new `tui/theme.mjs` roles, both themes + a11y)**

Reuse base roles first; add only what git semantics need. All `color()`-gated so `--accessible`/`NO_COLOR` return null automatically:

| Token | Dark (`default`) | Light | Used for |
|---|---|---|---|
| `gitBranch` | accent `#58a6ff` bold | teal bold | branch chip `⑂ main` |
| `gitUpstream` | dim | dim | `→ origin/main` |
| `gitAhead` | green | green | `↑1` pill (bg tint on xl only) |
| `gitBehind` | yellow/orange | orange | `↓2` pill |
| `gitStaged` | green `●` | green | staged icons/counts |
| `gitUnstaged` | yellow `●` | orange | unstaged icons/counts |
| `gitUntracked` | teal `?` | teal | `??` rows (dim path, not alarming) |
| `gitConflicted` | red bold | red bold | conflicted rows + op-state banner |
| `gitDiffAdd` | green | green | `+` diff lines |
| `gitDiffDel` | red | red | `-` diff lines |
| `gitDiffHunk` | accent/cyan dim | teal dim | `@@` hunk headers |
| `gitActionBar` | chrome bg | bg2 | header status card background |
| `gitFocusRing` | `cardBorderFocused` | same | focused pane border |

* Status icons: staged `●` green, unstaged `●` yellow, untracked `?` teal-dim, conflicted `!` red-bold, renamed `R→` accent; detached HEAD amber. `--accessible` swaps to `[S]/[M]/[?]/[!]` ASCII (same pattern as `eventGlyphA11y` `utils.mjs:518`).
* Diff: `+` green / `-` red backgrounds off (foreground only, keeps contrast on light theme); hunk header dim-accent; selected commit row uses global `selection` token (same as Repos/Dashboard) so focus looks identical app-wide.
* Header pills: `↑/↓` counts only when non-zero (zero = dim `·`); poll dot `●` green-dim when on, `○` dim when off; freshness `Updated <age>` dim right-aligned (Dashboard greeting-row pattern `dashboard.mjs:775`).

**Full mouse support (`tui/mouse.mjs` — must be spec'd, not "add later")**

Publish hit geometry during render (same pattern as `_inboxListBounds`, `_reposStarBounds`, `_sectionHeaders`):

* `appState._localBounds = { statusRows:{y,x,count,startIdx}, historyRows:{...}, actionBar:{y, buttons:[{id,x1,x2}]}, diffBox:{y,h} }` — rebuilt every `renderLocal` frame, consumed by hover/click/scroll.
* Click: tab chip (auto via `TABS.length` loop `mouse.mjs:837`); status/history row = select + set `localFocus`; section arrow = `toggleCollapse` (via `local:` prefix in `handleCollapsibleClick` `mouse.mjs:910`); action-bar buttons `[Fetch][Pull][Push][Branch][Commit]` = run flow (confirm-gated same as keys); ahead/behind pill = `fetchFlow`; branch chip = branch picker; diff `Enter` affordance.
* Double-click: status row → open diff; history row → open commit diff (reuse `handleDblClick` tolerance ±2 cells `mouse.mjs:653`).
* Hover (motion events 32–63): row highlight without focus steal (Repos/Inbox pattern `mouse.mjs:327,346`); button hover = underline/bold; cursor must not move `localSelected` on hover-only — only on click.
* Scroll wheel (`button 64/65`): scrolls the pane under cursor (status vs history vs diff via x/y vs `_localBounds`), clamped like `dispatchInboxClick`; never scrolls the whole tab when cursor is over diff.
* Overlays: branch picker rows clickable; confirm dialog click-outside dismiss (`_clickConfirm`); all mouse actions respect `confirmAction`/input-modal capture order (`keys.mjs` §0–1e) — mouse must not bypass confirms.
* Touch points: `handleCollapsibleClick` prefix += `'local'`; `handleContentClick` `case 6: dispatchLocalClick`; hover branch mirrors click geometry; `recoverScrollPositions`-style clamp after poll shrinks list (reuse dashboard `clampList` pattern).

### 6.8 Shortcut Ownership — no dead keys when Local is active

Rule: **when Tab 7 is focused, every key in its footer must fire its Local action — never a global, never a which-key popup, never a stale-tab warning.** Verified against `tui/keys.mjs:317-892` dispatch order (palette → onboarding → bookmarks → help → confirm → input → detail → number-keys → globals → star → dashboard-arrows → `l`-as-Enter → per-tab step 7) with the which-key prefix check (`keys.mjs:389`, groups in `tui/which-key.mjs:10-63`) sitting **before** the globals.

**Overlap matrix (Local key → who steals it today → fix)**

| Local key | Hijacked by today | Fix (all in `tui/keys.mjs` unless noted) |
|---|---|---|
| `c` commit | which-key `c` Code prefix (`which-key.mjs:31`) opens popup; per-tab never fires | Local-owned set checked **before** the prefix check (new guard ~line 374); plus prune stub `c` group (its `run:()=>null` eats the key on every tab — also breaks Repos `c` clear) |
| `f` fetch | which-key `f` Find prefix (`which-key.mjs:56`); same dead-key pattern (also breaks Inbox `f` filter) | Same guard; prune stub `f` group |
| `z` / `Z` collapse | which-key `z` Fold prefix (`which-key.mjs:24`) eats single `z` before global collapse (`keys.mjs:717`) | Same guard for tab-owned keys; prune stub `z` group (keep collapse semantics via `getSections()` case 6) |
| `X` discard | global `X` expand-all (`keys.mjs:750`; only Actions-runs exempt) | Explicit Local dispatch before the global switch (same pattern as Inbox `z`/`Z` guards `keys.mjs:717-749` and Files `Z`/`G` guards): `if (tab===6) { local.discardFlow(); return; }` |
| `B` / `b` branch | global `B` bookmarks (`keys.mjs:674`; Files-pane exemption only) / which-key `b` Buffer prefix (`which-key.mjs:49`) | Local dispatch before global for `B`; bind lowercase `b` as picker alias (avoids dead key + spurious bookmark warning) |
| `y` copy | global `y` copy-URL (`keys.mjs:657`; Files exemption only) | Local dispatch before global: copy SHA/path when Local focused |
| `o` open | global `o` open-current (`keys.mjs:647`; Files exemption only) | Local dispatch before global: open commit on GitHub (remote only) else hint |
| `g` top | which-key `g` Go prefix → two-press (`which-key.mjs:11-17` re-injects) | Accept two-press `g g` (consistent app-wide); document in footer/help; `G` single-press bottom via `handleBottom` case 6 |
| `r` refresh | global retry-first (`keys.mjs:621`) then `refreshCurrent` | Add `case 6` to `refreshCurrent` (`keys.mjs:233`); retry priority stays (correct) |
| `Enter`/`Space`/arrows/`PgUp`/`PgDn` | generic dispatchers lack case 6 | Add case 6 to `handleEnter/handleUp/handleDown/handleSpace/handlePageUp/handlePageDown/handleTop/handleBottom` |
| `1`–`7` | number switch hardcodes `1`–`6` (`keys.mjs:545`); security-pane `1`–`6` guard | Add `case '7'`; leave security guard as-is (Local unaffected) |
| `s`/`S`/`*`/`u`/`l`/`Tab` | global star (`keys.mjs:790`) needs `currentRepoForAction()` (null on tab 6 → falls through, safe); `u` yields to per-tab else undo (Local has no `u` → undo fires, acceptable); `l` = Enter on non-Dashboard (acceptable alias); `Tab` switches tabs off-Dashboard (hence `[`/`]` for pane focus, correct) | No change; document: git discard/commit are **not** in the undo stack (`tui/undo.mjs`) — hence double-confirm; `s` free for future Local use |

**Implementation (Phase 0, +0.5d)**

1. `keys.mjs`: insert `LOCAL_OWNED = new Set(['a','A','X','c','C','f','p','P','B','b','y','o','[',']'])`; right after the `_inTextEntry` guard and **before** `whichKey.isPrefixKey` (~line 374): `if (tabState.current===6 && LOCAL_OWNED.has(key)) { dispatch to local.keys / explicit flow; return; }`. Globals that Local intentionally shares (`r/g/G/Space/z/Z/Enter/arrows`) stay in the generic path with case-6 handlers added.
2. `which-key.mjs`: delete stub groups whose bindings all `run:()=>null` (`c` Code, `b` Buffer, `f` Find, `z` Fold, `d` Debug, `w` Window) — they contribute zero actions and eat single-press keys on **every** tab. Keep `g` Go (functional two-press). This single prune fixes Local `c`/`f`/`z` **and** the latent Repos-`c`/Inbox-`f` dead keys.
3. `mouse.mjs` + `help.mjs`: footer/help/palette list the final bindings including the `b` alias and `g g` two-press so the UI never advertises a key that doesn't fire.

**Acceptance (blocks Phase 1):** automated overlap test presses every footer key with `tabState.current===6` and asserts the Local handler ran (not which-key/global); `b` opens picker (no bookmark toast); `X` discards (no expand-all); `c` commits (no popup); `f` fetches; single `z` collapses (no popup).

---

## 7. Implementation Phases

### Phase 0 — Foundation (2–3 days)

* `tui/git-context.mjs`: add `getLocalGitMeta()` (root/gitDir/branch/upstream/isRepo). Keep `detectLocalRepo()` untouched.
* `tui/git-local.mjs`: pure `parsePorcelainV1Z/parseBranchHeader/parseBranches/parseLog` + arg builders. Tests first (`tests/git-local.test.mjs`, 60+ cases incl. `-z` NUL, renames, `##` variants, detached, unicode/spaces).
* `tui/state.mjs`: flat `local*` keys + `TABS[6]` + `TAB_CONTENT_Y[6]` + session `localAutoPoll`.
* `app.mjs`: hoist detection outside token gate; populate even logged-out.
* `tui/utils.mjs`: `runGit` with `GIT_TERMINAL_PROMPT=0`, timeout, abort-kill.
* Scaffold `tui/tabs/local.mjs` read-only skeleton + all touch points (§8); implement §6.8 ownership guard + which-key prune.
* **Accept:** `7` always present; in-repo shows `branch → upstream ↑↓`; non-repo shows emptyState; works logged-out; ownership test green (no dead keys).

### Phase 1 — Read-only Monitor + Diff (3–4 days)

* Poll-only refresh (1.5s on-tab / 5s off-tab, pause on `loading`); no `fs.watch`.
* Status sections (staged/unstaged/untracked/conflicted + op-state banner), history (50 + `Space`), diff preview incl. **untracked-from-disk**, `r/g/G/y/o`, collapsible sections.
* **Accept:** `echo x >> f` visible ≤2s on-tab; commit browse offline; zero writes.

### Phase 2 — Stage / Discard / Commit (3–4 days)

* `a/A` stage/unstage (+`restore`→`reset` fallback via version probe), `X` discard via §6.5 danger double-popup, `c/C` two-prompt subject+body commit/amend with §6.5 detail popups + identity/hook error surfacing.
* **Accept:** dirty → stage → commit (with body) → history-top, all in-TUI; every popup shows action/target/scope/command/consequence; discard requires two danger confirms.

### Phase 3 — Fetch / Pull / Push / Branches (4–5 days)

* `f` fetch `--prune`; `p` pull RB+autostash (dirty confirm); `P` push (+`-u`, +lease double-confirm); `B` picker (checkout/create/delete w/ `check-ref-format`).
* Ahead/behind live after fetch/pull/push; detached/no-upstream/conflict states handled.
* **Accept:** `commit → push → Actions shows run` loop closed.

### Phase 4 — Polish, Docs & Tests (3 days)

* Style pass (§6.7): header status card, focus ring, pills, diff colors, empty states, responsive breakpoints; mouse pass (bounds, hover, wheel, double-click, overlays); help (`CATEGORIES` + `TAB_CATS`), README key tables + layout, CHANGELOG `v0.8.0`, VISION roadmap, palette, focus/custom-keys/which-key, compact+linear+breadcrumb+statusLine+`recoverScrollPositions`+`viewKey`, a11y glyphs, `check-imports` clean.
* Edge matrix (§12 manual) + version-compat tests (old git fallback).
* **Accept:** `npm test` green, all touch points hit, no hardcoded-`6` remains (`grep -n "1-6\|case [0-5]:"` clean except security sub-panes).

---

## 8. File & Change Inventory

### New files

| File | LOC est. | Tests |
|---|---|---|
| `tui/git-local.mjs` | ~260 (NUL parsers + header variants) | `tests/git-local.test.mjs` ~150 cases (NUL, renames, `##` variants, detached, unicode/spaces) |
| `tui/tabs/local.mjs` | ~1100–1400 (read + 4 write flows + picker + diff) | `tests/local-git-integration.test.mjs` (mocked `runGit`: status→history→diff chain, stale-drop, pagination, discard double-confirm, lease flow) |

No `git-watcher.mjs` in v0.8.0 (v0.8.1).

### Modified files

| File | Change |
|---|---|
| `tui/git-context.mjs:4-53` | **Add** `getLocalGitMeta()`; do not alter `detectLocalRepo()` semantics |
| `tui/state.mjs:315,356,592,1201` | Flat `local*` keys; `TABS[6]{key:'7',label:'Local',refresh}`; `TAB_CONTENT_Y[6]`; session `localAutoPoll`; `resetAccountState` preserves local |
| `tui/utils.mjs:613,577` | **Add** `runGit(args,{cwd,signal,timeoutMs})` (`GIT_TERMINAL_PROMPT=0`, abort-kill); containment helper vs `root` for untracked reads |
| `app.mjs:330-345` | **Hoist** detection outside `if (token)`; populate `local*` logged-out |
| `tui/render.mjs` | `TAB_CONTENT_Y[6]`; `buildBreadcrumb` case 6; `statusLine` case 6; `recoverScrollPositions` local cursors; compact labels (6→7); linear labels (6→7); `viewKey` += branch; case 6 dispatch; **upgrade `renderConfirmDialog` (§6.5): structured body, dynamic height, danger styling, clickable buttons** |
| `tui/keys.mjs` | `tabModules[6]`; `case '7'`; `LOCAL_OWNED` pre-which-key guard (§6.8) + explicit `X/B/y/o` Local dispatches before globals; `handleEnter/Up/Down/Space/PageUp/PageDown/Top/Bottom/refreshCurrent` case 6; security-pane `1-6` guard unchanged; palette registrations; **danger-confirm keys (§6.5): `Enter` no-op when `_confirmDanger`, `y`-only confirm** |
| `tui/mouse.mjs` | Full §6.7 spec: `_localBounds` publish; click (select/focus/collapse/action-bar/fetch/branch), double-click diff, hover highlight, per-pane wheel scroll, overlay + confirm ordering; **clickable confirm `[Yes]/[Cancel]` + `_confirmBounds` (§6.5)** |
| `tui/tabs/help.mjs` | `CATEGORIES` += LOCAL; `TAB_CATS[6]='local'` |
| `tui/focus.mjs`, `tui/custom-keys.mjs`, `tui/which-key.mjs`, `tui/quick-settings.mjs` | Focus zones + custom-key contexts for local; **prune stub which-key groups** (`c/b/f/z/d/w`, §6.8), keep `g` Go |
| `tui/theme.mjs` | Add §6.7 tokens (`gitBranch/Upstream/Ahead/Behind/Staged/Unstaged/Untracked/Conflicted/DiffAdd/DiffDel/DiffHunk/ActionBar/FocusRing`) in DARK + LIGHT; a11y/NO_COLOR via existing `color()` null path |
| `README.md`, `VISION.md`, `CHANGELOG.md`, `package.json` | Keys + layout + roadmap + `0.7.6→0.8.0` |
| `tools/check-imports.mjs` | No change expected (new modules use explicit imports) |

---

## 9. Keybindings & Palette

**Global:** `7` Local (always); `Ctrl-P` → `Local: …` (fuzzy `local.*`).

**Local tab:** see §6.6. `X` = discard inside Local (expand-all palette-only there).

**Which-key:** defer `g`-group to v0.8.1; v0.8.0 single keys only.

---

## 10. Safety & Error Handling

* Argv-only (`--` separators); `check-ref-format` for branches; subject length cap.
* Confirm gates (§6.5); stacked-confirm guard (`state.mjs:952`); discard + lease double-confirm; never `--force`.
* `setRetryHandler` for transient network ops + footer `[r]` (`render.mjs:618`).
* Network ops use dedicated long timeout + abort-kill; they do not rely on the 30s generic watchdog.
* Exit: poll interval cleared via `registerShutdownCallback` (`state.mjs:1112`).
* Identity/hook/auth errors surfaced verbatim with next-step hint (config email, credential helper, SSH).
* Commit flow: pre-check staged non-empty; pass through hook stderr verbatim on failure; detect identity error and hint `git config user.name/email`; respect `commit.gpgsign` (surface failure with hint, don't force `--no-gpg-sign`).
* Commit input is the single-line footer modal (`input.mjs:startInput`); v0.8.0 is subject-only by construction.

---

## 11. Polling & Performance

* v0.8.0: `setInterval` 1500ms (Local focused) / 5000ms (background), skipped when `appState.loading` or `!localAutoPoll` or `!localIsRepo`. Debounce 250ms after manual actions. Cost: one `status -z` (~30ms/500 files) per tick — negligible; no `fs.watch` handles, no platform quirks.
* v0.8.1 (optional): `fs.watch` on `gitDir/index|HEAD|refs/heads/<branch>` with re-arm on rename + poll fallback. Needs worktree/submodule matrix before promotion.
* Caps: 200 status rows rendered, 50 history + append, diff lazy + `MAX_VIEW_BYTES`, binary guard. Timeout 30s local / 120s network prevents hang.

---

## 12. Testing Plan

### Unit (`node --test`, zero deps)

* `tests/git-local.test.mjs` (~150): NUL-split status (staged/unstaged/`??`/conflicted full matrix `DD/AU/UD/UA/DU/AA/UU`, `R100` two-record, spaces/unicode without quoting, `##` variants: normal/ahead-behind/`No commits yet`/detached/no-upstream); `parseBranches` (current/remote/detached); `parseLog` (multiline body, empty repo); arg builders assert argv arrays (no interpolation).
* Branch validation: assert `check-ref-format` wrapper accepts `feature/foo`, rejects `..bad`/`-bad` — test the wrapper, not a regex.
* Old-git fallback: `restore unknown-option` → `reset` path (mocked `runGit`).

### Integration (mocked `runGit`)

* Status→history→diff chain, `isStale` supersede-drop, pagination append, untracked-from-disk branch, discard double-confirm gating, push-rejected→lease second-confirm, op-state disables.
* `tests/keyboard-local.test.mjs`: `a/X/c/f/p/P/B` dispatch + confirm gating + `7` switch.
* `tests/local-shortcut-ownership.test.mjs` (§6.8, blocks Phase 1): every footer key with tab 6 asserts Local handler (which-key closed, no global fired); `b` picker not bookmark toast; stub-group prune regression (Repos `c`, Inbox `f` fire).
* `tests/local-confirm.test.mjs` (§6.5, blocks Phase 2/3): every matrix row asserts title/body/command/consequence content; danger rows assert two-step flow + `Enter`-no-op + `y`-confirm; mouse Yes/Cancel hit bounds; outside-click cancels.
* `tests/local-style-mouse.test.mjs`: token presence in both themes, `_localBounds` hit-testing (row/button/pill mapping), hover-doesn't-steal-focus, wheel clamps, double-click tolerance, a11y ASCII swap.

### Manual matrix

non-repo / empty repo / dirty+untracked / spaces+unicode paths / detached / no-upstream / conflicted + MERGE/REBASE heads / large (10k) / binary / CRLF / `git` missing / git<2.23 / HTTPS-no-creds (expect fast fail, no hang) / SSH / worktree+submodule (detect only) / non-GitHub remote / logged-out.

### CI gate

`npm test` green (`check-imports` + `node --test`). Current tree reports 416 pass / 1 skipped — re-baseline at branch time. No new dep, `node >=20` unchanged.

---

## 13. Risks & Mitigations

| Risk | L | I | Mitigation |
|---|---|---|---|
| Credential confusion (PAT vs git helper) + `/dev/tty` hang | H | H | `GIT_TERMINAL_PROMPT=0` fail-fast + 403/auth hint ("git auth ≠ TUI PAT; cache via shell once"); abort-kill; long timeout |
| Watchdog cancels what it can't kill | M | H | `runGit` owns timeout+kill; watchdog not relied on for network ops |
| Raw mode vs `$EDITOR` | H if attempted | H | Never launch editor in v0.8.0 (subject-only modal); editor is v0.9 with full suspend |
| Key collision (which-key stubs eat `c/f/z/b`; globals eat `X/B/y/o`) | H | M | §6.8: pre-which-key `LOCAL_OWNED` guard + stub-group prune + explicit Local dispatches; palette disambiguates; security-pane guard extended |
| 7th tab crowding (60-col) | M | L | Responsive strip + compact/linear 7-label updates (§8); acceptable |
| Large repo perf | M | M | Caps + lazy diff + timeouts; poll skips while loading |
| Scope creep to lazygit | H | H | Hard gate: file-level + fetch/pull/push/branch only; hunks/watcher/body-editor/stash/rebase are v0.8.1+ with separate specs |
| Non-GitHub remotes treated second-class | M | M | Local-first design: GH features degrade with hint (not error) |
| Old git (<2.23, no `restore`) | M | L | Version probe + `reset`/`checkout` fallbacks; use `checkout` (not `switch`) everywhere |

---

## 14. Timeline & Effort

| Phase | Effort |
|---|---|
| Phase 0 Foundation | **2–3d** (touch points, `runGit`, hoisted boot) |
| Phase 1 Read-only | **3–4d** (untracked-disk branch, op-state, caps) |
| Phase 2 Stage/Discard/Commit | **3–4d** (discard, identity/hook surfacing) |
| Phase 3 Fetch/Pull/Push/Branches | **4–5d** (fetch, abort-kill, lease flow) |
| Phase 4 Polish/docs/tests | **3d** (help/mouse/focus/keys/a11y/docs/matrix) |
| **Total** | **~15–19d solo (~4 weeks w/ review); ~10d pair** |

---

## 15. Decisions (locked 2026-09-18)

1. Tab visibility → **always show**. 
2. Commit message → **multi-line now** (two-prompt subject + optional body in v0.8.0; no `$EDITOR`).
3. Pull strategy → **`--rebase --autostash` default**; `--no-rebase` setting in v0.8.1.
4. Hunks → **defer to v0.8.1** (file-level only in v0.8.0).
5. Force policy → **`--force-with-lease` only**, double-confirm; never `--force`.
6. `X` → **discard inside Local** (expand-all palette-only there).
7. Watching → **poll-only v0.8.0**, `fs.watch` v0.8.1.

---

## 16. Appendix

### A. State schema — flat keys (`tui/state.mjs:356`)

```js
localIsRepo:false, localRoot:'', localGitDir:'', localBranch:'', localUpstream:null,
localAhead:0, localBehind:0, localOpState:null,
localStaged:[], localUnstaged:[], localUntracked:[], localConflicted:[],
localStatusError:null, localHistory:[], localHistoryHasMore:true, localHistoryPage:1,
localStatusSelected:0, localStatusScroll:0, localHistorySelected:0, localHistoryScroll:0,
localFocus:'status', localDiff:null, localAutoPoll:true, localLastFetched:null,
```

### B. Command matrix (argv, `cwd=localRoot`, `GIT_TERMINAL_PROMPT=0`)

```
status:  ["status","--porcelain=v1","-b","-z","--untracked-files=all"]
diffU:   ["diff","--no-color","--unified=3","--",path]
diffS:   ["diff","--cached","--no-color","--unified=3","--",path]
untracked: read <root>/<path> from disk (containment-checked, binary/size guarded)
show:    ["show","--no-color","--unified=3","--stat",sha,"--"]
log:     ["log","--decorate","--date=iso","--pretty=format:%H%x1f%an%x1f%ad%x1f%s%x1f%b%x1e","--max-count=50","--skip=N"]
branches:["branch","-a","--no-color"]
ahead:   ["rev-list","--left-right","--count","HEAD...@{u}"]
checkRef:["check-ref-format","--branch","--",name]
add:     ["add","--",path] / ["add","-A"]
restore: ["restore","--staged","--",path] // fallback ["reset","HEAD","--",path]
discardT:["restore","--source=HEAD","--staged","--worktree","--",path] // fallback ["checkout","HEAD","--",path]
discardU:["clean","-f","--",path]
commit:  ["commit","-m",subject] / ["commit","--amend","-m",subject]
fetch:   ["fetch","--prune"]
pullRB:  ["pull","--rebase","--autostash"]
push:    ["push"] // or ["push","-u","origin",branch] // lease: ["push","--force-with-lease"]
checkout:["checkout",name] / ["checkout","-b",name] / ["branch","-d",name]
```

### C. Parser specs

* `parsePorcelainV1Z(buf)`: split raw stdout on `\0`; record[0] is `## …` header (parse branch/upstream/ahead-behind/`No commits yet`/detached); remaining `XY SP path` records (`??` untracked, `!!` ignored→drop, `DD/AU/UD/UA/DU/AA/UU` conflicted); `R/C` consumes **next** NUL record as new path. Output `{branch,upstream,ahead,behind,staged,unstaged,untracked,conflicted}`. No unquoting exists.
* `parseLog`: split `\x1e` records → `\x1f` fields `{sha,author,date,subject,body}`.
* `parseBranches`: `*` current, `remotes/` remote, detached `HEAD` line.

### D. Session persistence (`tui/state.mjs:1201`)

```js
{ localAutoPoll: appState.localAutoPoll }
// restore:
if (typeof s.localAutoPoll === 'boolean') appState.localAutoPoll = s.localAutoPoll;
```

### E. Palette registration (`tui/keys.mjs:1137`)

```js
for (const [id,label,run] of [
 ['local.refresh','Local: Refresh status & history',()=>local.refreshLocal()],
 ['local.stage','Local: Stage/unstage file',()=>local.toggleStage()],
 ['local.discard','Local: Discard changes…',()=>local.discardFlow()],
 ['local.commit','Local: Commit staged…',()=>local.commitFlow()],
 ['local.fetch','Local: Fetch --prune',()=>local.fetchFlow()],
 ['local.push','Local: Push',()=>local.pushFlow()],
 ['local.pull','Local: Pull --rebase',()=>local.pullFlow()],
]) palette.register({id,label,category:'Local',run});
```

---

*Next step:* Confirm §15 (7 items), then branch `feat/local-git` at Phase 0. Demo after Phase 1 (read-only, logged-out, non-GitHub remote) without waiting for write paths.
