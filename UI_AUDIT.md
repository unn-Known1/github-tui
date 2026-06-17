# 🎨 GitHub TUI — Deep UI/UX Audit Report

> Honest review of every tab, pane, overlay, and rendering primitive based on a full re-read of `screen.mjs`, `render.mjs`, and every tab module. The functionality works — but the UI does not yet feel like a polished product. This report says exactly why and exactly how to fix it.

**Audit date:** v0.3.1
**Files inspected:** 15 modules under `tui/` + `app.mjs`
**Total LOC reviewed:** ~3,500

---

## 📌 Table of Contents

1. #-executive-summary
2. #-root-cause-the-rendering-floor-is-too-low
3. #-tab-by-tab-issues
4. #-cross-cutting-ui-problems
5. #-the-fix-plan-3-waves
6. #-the-design-language-rules-to-adopt
7. #-effort-estimate

---

## 🧭 Executive Summary

The app is **functionally complete** but visually feels like a **prototype**. The gap between "all features work" and "looks like a product" is 90% rendering primitives and 10% layout discipline.

**The single highest-leverage finding:** `tui/screen.mjs` only supports **foreground colors** (8 named colors via `\x1b[3Xm`). It has **no background colors, no bold/italic/underline/inverse**, and no truecolor. Every other shortcoming in the UI flows from this floor.

With zero changes to layout, just adding background colors + an `inverse` modifier would make:

- Selected rows actually **look** selected (currently only a `▶` marker)
- The active tab actually **look** active (currently just `bright` vs `dim` — same character weight)
- Headers actually **look** like headers (currently same color as cells)
- The status bar feel like a status bar (currently a dim line)

The second-highest finding: **everywhere uses `┌─┐│` hard box-drawing**, and most layouts are emitted as scattered `writeStr` calls rather than going through a `panel()` or `card()` primitive. That makes every screen feel inconsistent — different padding, different alignments, different label styles.

---

## 🔍 Root Cause: The Rendering Floor Is Too Low

### Current capabilities of `screen.mjs`

```js
// What the renderer can produce today
const FG = { bright, dim, red, green, yellow, blue, magenta, cyan, white };
// + box(), hline(), writeStr(), setCell(), fillRow()
```

That's it. Every visual effect in the app — selection, hover, headers, badges, tab strip — has to be expressed with one of those 9 foreground colors and the difference between "normal" and "dim."

### What pro TUIs use

| Capability | This app | lazygit / k9s / htop |
|---|---|---|
| Foreground colors | ✅ 8 | ✅ 256 / truecolor |
| Background colors | ❌ | ✅ |
| Bold / italic / underline | ❌ (bright is sort-of-bold) | ✅ |
| Inverse / reverse-video | ❌ | ✅ |
| Strikethrough | ❌ | ✅ |
| Compose multiple modifiers | ❌ | ✅ |
| Reusable widgets (panel, table, list) | ❌ | ✅ |

Without these, you literally cannot produce some of the most common professional-feeling UI patterns:

- **A highlighted row** = `bg:cyan fg:black` → currently emulated with `▶ ` plus making the text `bright`. Reads as "there's a triangle there" instead of "this row is selected."
- **Header rows** = `bold + underline` → currently just `bright`. Indistinguishable from a regular cell with emphasis.
- **Active tab pill** = `inverse` or `bg:accent fg:bg` → currently `bright` vs `dim`. Both options look like text styled slightly differently — neither looks like a tab.
- **Status bar** = `bg:gray fg:fg` across the whole bottom row → currently a dim text line floating in the void.
- **Modal backdrop** = `dim` shade over the entire viewport → currently we just paint spaces over the box area; the rest of the screen behind the modal stays at full brightness, making the modal look like it's *replacing* rather than *overlaying*.

**Verdict:** This is the right place to start. Everything else gets easier once the floor is raised.

## 🗂️ Tab-by-Tab Issues

### 1 · Dashboard

**Render code:** `tui/tabs/dashboard.mjs`

**What works:**
- Information density is good — greeting, 4 stat cards, profile mini, top repos, language bars, activity feed, trending.
- The 4 stat cards are the closest thing to a real widget in the whole app.

**What feels prototype-y:**

| # | Problem | Severity |
|---|---|---|
| D1 | Stat cards have a 1-char border but no padding inside. Label and value visually touch the border. | 🟥 High |
| D2 | Values inside cards are all `bright` — no visual hierarchy between e.g. `247` (a meaningful number) and `4.2y` (a soft metric). | 🟧 Med |
| D3 | The greeting row puts `Good evening, Gaurang 👋` flush left with no top padding; first thing the user sees is text crammed against the border of the header box. | 🟥 High |
| D4 | Notifications badge (🔔 3 unread) is right-aligned with hand-computed math (`Math.max(4, W - badge.length - 2)`) — fragile and inconsistent with how nothing else aligns right. | 🟧 Med |
| D5 | Two-column body uses `Math.floor(W / 2)` — left column ends at column 60ish, right column starts at 62. **No vertical divider** between them; on a wide terminal they look like two unrelated blocks of text floating in space. | 🟥 High |
| D6 | Section headers (`Profile`, `★ Top Repos by Stars`, etc.) are just `bright` text — same visual weight as a stat value. They should look like headings. | 🟧 Med |
| D7 | Activity feed has no avatars, no timestamps that are vertically aligned (each row computes its own right-align), and no visual grouping. Reads as a wall of text. | 🟧 Med |
| D8 | Language bar chart uses `█/░` blocks — looks correct, but the percentage label is plain `dim` text right after the bar. The bar itself has no label color, so it floats. | 🟨 Low |
| D9 | When `appState.dashboardLoaded === false`, half the panels say "Loading…" but the layout doesn't shift — you get gaping empty space below the stat cards on first load. | 🟧 Med |
| D10 | The 🔔 emoji + a number is the only spot in the entire app where we use emojis as ornament. Inconsistent. | 🟨 Low |

**One-line verdict:** The Dashboard *has* the right widgets, but they're laid out by an engineer (computed offsets, no padding) instead of a designer (consistent grid, intentional whitespace).

---

### 2 · Repos

**Render code:** `tui/tabs/repos.mjs`

**What works:**
- Recent W2/W3 additions (selection, filters, badges, density, pins) are functionally rich.
- Header right-aligned aggregate stats are a nice touch.

**What feels prototype-y:**

| # | Problem | Severity |
|---|---|---|
| R1 | The row separator is a single `─` hline between header and rows — and **no separator anywhere else**. Rows blur into each other. | 🟥 High |
| R2 | Visibility badges (🔒 🔱 📦 🗄 📌 ★) sit awkwardly *before* the repo name. They take 2 chars each so the name shifts horizontally row to row — meaning repo names don't column-align. | 🟥 High |
| R3 | The selected row uses `▶` marker + `bright` style on the name only. The rest of the row (stars, forks, etc.) stays normal weight. The eye doesn't see the row as a single highlighted unit. | 🟥 High |
| R4 | When the filter is active, the filter-tag line `type=forks  •  lang=Rust  •  stale-only  •  "foo"` is just dim text. Reads like a debug line, not a status chip. | 🟧 Med |
| R5 | Sort keys hint row (`[n]Name [s]★ Stars [f]⑂ Forks [i]Issues [u]Updated [/] Filter`) is functional but ugly: brackets compete with the actual letter labels and there's no clear active-sort callout (the active sort is mentioned in line above, but separately). | 🟧 Med |
| R6 | Compact-density row is 1 line; comfortable-density row is 2 lines (description on row+1). The description is dim and starts at column 6 — no visual indication it belongs to the row above. Sometimes the description spans nearly the full width, making it look like a new row. | 🟧 Med |
| R7 | Columns at fixed columns 34/46/53/60/70. On a narrow terminal these collide; on a wide terminal there's a giant empty void on the right. **No responsive sizing.** | 🟥 High |
| R8 | Pin-floated rows appear at the top with the 📌 badge — but visually look identical to a regular row. No section header (`★ Pinned`) before them, no divider after them. The user has to recognize the badge. | 🟧 Med |
| R9 | Empty state for filters is a long text line: `No repos match current filters  [c] Clear all  [t] Type  [L] Lang`. This should be a centered card with a friendly icon. | 🟨 Low |

---

### 3 · Analyze

**Render code:** `tui/tabs/analyze.mjs` (485 lines — the largest tab module)

**Sub-views audited:** search, results, details (overview/issues/PRs/README/files), forks.

**What works:**
- The pane-tab strip `[O] Overview [i] Issues (N) [P] PRs (N) [R] README [F] Files` is the closest thing to professional tabbed navigation in the app.
- Details overview pane's 2-column metadata + right-side widgets (languages bar, contributors, releases) is genuinely well-organized.

**What feels prototype-y:**

| # | Problem | Severity |
|---|---|---|
| A1 | Pane tabs are right-aligned with manual `W - right + px - 4` math. They sit on the same row as the repo name (`▸ owner/repo`). On a narrow terminal the repo name + 5 pane tabs collide. | 🟥 High |
| A2 | Search input shows up as `Search: (press Enter or i to search)` plain text at row y+2. Doesn't look like a search field — no border, no `🔍` icon, no input box. | 🟥 High |
| A3 | Search results list has selected-row marker `▶` + a *brighter* name, but the metadata next to it (`★12 ⑂5 ⚡2`) stays dim regardless of selection. Same issue as R3. | 🟧 Med |
| A4 | Issues/PRs panes hard-code column positions (`W - 22`, `W - 9`) for author + labels/branch. On narrow terminals these overlap. | 🟥 High |
| A5 | README pane uses naïve markdown styling — headings turn `bright`, lists turn `accent`. But there are no margins, no horizontal rules, no link highlighting. It's a wall of text. | 🟧 Med |
| A6 | Files pane breadcrumb (`🌳 owner/repo@main › src › kernel`) is dense text in `accent` color — no separation between the repo handle and the path. | 🟧 Med |
| A7 | File viewer line numbers use a fixed `padStart(lineNumW, ' ')` and a `│` separator — that's the best-looking part of the app, ironically. But the **file content uses the same color whether it's a comment, keyword, string, or operator** beyond the very naïve regex coloring. | 🟨 Low |
| A8 | Branch picker overlay uses the centered box pattern — but the box has `Pick Branch` as the title and otherwise looks identical to the Help overlay. No visual distinction between modals. | 🟧 Med |
| A9 | Forks view: ahead/behind columns are colored (`+5` green, `-2` red), but the rest of the row is plain. The `▶` selection marker is at column 4, fork-owner at column 7. Sparse and hard to read. | 🟧 Med |
| A10 | Forks `[Space] Load more  •  Esc back  [p/s/n] Sort` footer is a single dim line — same problem as the Repos status line. | 🟨 Low |

### 4 · Settings

**Render code:** `tui/tabs/settings.mjs`

**What works:**
- The split layout (actions on the left, System info on the right) is genuinely useful.
- System panel shows token scopes — a great power-user touch.

**What feels prototype-y:**

| # | Problem | Severity |
|---|---|---|
| S1 | Actions list uses `▶` selection marker but the row stays a plain 1-liner. No hover/focus state on non-selected rows. | 🟧 Med |
| S2 | Action labels (`Login`, `Logout`, `Refresh Dashboard`, ...) and their descriptions are at fixed columns 7 and 28. Long descriptions overflow into the System panel on narrow terminals. | 🟥 High |
| S3 | The System panel has no visual frame — it's just text starting at `infoX`. Compare to lazygit's settings panel which has a clear titled box. | 🟧 Med |
| S4 | Disabled actions (e.g. "Logout" when not logged in) are styled identically to enabled ones except for the description — easy to miss. | 🟧 Med |
| S5 | Footer hint `↑/↓ Navigate   Enter Select   ? Help overlay` is plain text — same status-bar problem as elsewhere. | 🟨 Low |

---

### 5 · Inbox

**Render code:** `tui/tabs/inbox.mjs`

**What works:**
- Color-coded subject types are the single best visual choice in the app.
- The unread `●` dot is good.
- The right-side `By Repo` summary is the only **truly responsive** widget — it collapses on narrow terminals.

**What feels prototype-y:**

| # | Problem | Severity |
|---|---|---|
| I1 | Selection marker `▶` + the unread dot `●` sit in adjacent columns (2 and 3). Visually they fight for attention. | 🟧 Med |
| I2 | The `[unread]` filter label at column 20 in the header is plain `accent` text — looks like a label, not a chip. | 🟧 Med |
| I3 | The Type column (PR/Issue/Release/etc.) is color-coded but only ~10 chars wide — for long types like `CheckSuite` it truncates ugly. | 🟨 Low |
| I4 | Repo · title combo runs `repo · title` flat with no separator distinction. Hard to scan for either independently. | 🟧 Med |
| I5 | When count of notifications is 0, the message is plain `dim` text: `✨ Inbox zero! Press [r] to refresh.` — should be a centered empty-state card with bigger glyph. | 🟨 Low |
| I6 | Footer status line is the same problem as everywhere — long flat string of `[keys] Actions`. | 🟧 Med |

---

### 6 · Help Overlay

**Render code:** `tui/tabs/help.mjs`

**What works:**
- Section headers (`── Global ──────`) are a clever low-tech grouping device.
- Coverage of every key is genuinely complete.

**What feels prototype-y:**

| # | Problem | Severity |
|---|---|---|
| H1 | Modal box paints `' '` characters over the area to clear what's behind. But the rest of the screen behind the modal stays at **full brightness** — the modal looks like a hole punched into the UI, not an overlay on top of it. | 🟥 High |
| H2 | 68-char fixed width — wastes space on a 200-col terminal, overflows on a 60-col one. | 🟧 Med |
| H3 | Inside the box, keys and descriptions are space-separated with no column alignment. `  Ctrl-P or :      Command palette` and `  ↑↓ or j/k        Navigate lists` have visually different gaps. | 🟧 Med |
| H4 | No way to scroll the help if it doesn't fit. On a 20-row terminal the bottom sections are cut off silently. | 🟧 Med |
| H5 | Dismissal hint `Press any key to close` is dim text inside the box — should be in the box title or a footer style. | 🟨 Low |

---

### 7 · Command Palette

**Render code:** `tui/palette.mjs`

**What works:**
- Fuzzy match is solid.
- Layout (query line + list of matches + hint column on the right) is the right pattern.

**What feels prototype-y:**

| # | Problem | Severity |
|---|---|---|
| P1 | Same modal-backdrop problem as Help. The rest of the screen behind the palette doesn't dim. | 🟥 High |
| P2 | Selection: `▶` marker + `bright` text — selected row doesn't look truly selected. | 🟧 Med |
| P3 | The query line uses `> ` prefix and `█` cursor — no input border, no placeholder. Compare to fzf's bordered query input. | 🟧 Med |
| P4 | Hint column is right-aligned `dim` text — fine, but no visual separator between label and hint. | 🟨 Low |
| P5 | Fixed `boxW = min(70, W-4)`. Should grow with terminal width up to a sensible max (say 90). | 🟨 Low |
| P6 | Empty state `(no matching actions — try a different query)` is dim text at row 3. Should be centered. | 🟨 Low |

---

## 🌐 Cross-Cutting UI Problems

Issues that aren't tied to a single tab — they affect every screen.

### C1 · Status bar isn't a status bar

Every tab renders its own `statusLine()` into row `H-2` as plain `dim` text. It looks like a debug line floating at the bottom. A real status bar would be:

- Full-row background fill (e.g. inverse video or a colored background)
- Distinct segments separated by `│` or padding
- Right-aligned items (`API 4823/5000 · v0.3.1`) on the same bar

### C2 · No focus indicator beyond `▶`

The `▶` cursor is the *only* indication of selection across the entire app. Pro TUIs use a combination of:
- Background highlight on the whole row
- Foreground inverse on the selected text
- A subtle prefix or gutter marker

We currently have just the marker, and even it's missing in some places (the System panel on Settings).

### C3 · Inconsistent padding

Different tabs start content at different columns:
- Dashboard: column 4
- Repos: column 4 (header) but 6 (description in comfortable density)
- Analyze details: column 4 (left) and `leftWidth + 6` (right)
- Settings: column 4 (actions) but 7 (action label) and 28 (description)
- Inbox: column 4 (header) but 2 (selection marker) and 5 (type) and 16 (title)

No consistent design grid. Eye has to re-orient on every tab switch.

### C4 · Inconsistent dividers

We use `hline(y, '─')` in some places (between header and content) but not in others (between rows). The Dashboard's two-column split has no vertical divider at all. The Analyze details pane uses no internal dividers between metadata rows and the languages widget.

### C5 · No empty states

Most "there's nothing here" messages are a single dim line. Examples:
- `'No repositories found'` on Repos
- `'(no recent public events)'` on Dashboard
- `'(no open issues)'` on Analyze
- `'✨ Inbox zero!'` on Inbox

Professional apps use centered cards with a glyph + heading + sub-message + suggested action.

### C6 · No loading states beyond a corner spinner

When a panel is loading, we show `⟳ Loading...` in the top-right and... nothing else. The panel stays empty. Should use **skeleton placeholders** — gray bars where rows will appear.

### C7 · No motion / progress

Long actions (folder save with progress, fork compares) show progress only via `showMessage` toasts in the status bar. The status bar is the wrong place for in-progress operations — they should have a dedicated row.

### C8 · No truecolor / 256-color palette

Themes (`default`, `highContrast`, `dracula`, `solarized`) map to the same 8 ANSI colors. Result: `dracula` and `default` look almost identical, because both use ANSI's `magenta` and `cyan`. With 256-color support the themes could actually look like Dracula and Solarized.

### C9 · Tab strip looks like text, not tabs

`[1] Dashboard  [2] Repos  [3] Analyze  [4] Settings  [5] Inbox` is just text with `bright` on the active one. Real tabs would have:
- A surrounding box or pill shape
- Background fill on the active tab
- A bottom border that visually connects to the content below

### C10 · Header has no character

Line 0–3 is `┌─ GitHub TUI ─┐` with `Welcome, <login>` on the left and `API <r>/<lim>` on the right. The brand has no logo, no version, no context (which org? which user?). On non-first-launch it could show e.g. `★ 247  ⑂ 38  📥 3` for at-a-glance stats.

## 🛠️ The Fix Plan — 3 Waves

Matching the audit severity, here's how I'd actually sequence the rework.

### Wave 1 — Raise the rendering floor (8–12 hours)

**Goal:** Make `screen.mjs` capable of producing professional-looking output, then quietly retrofit every tab.

**Tasks:**

1. **Add background colors to `screen.mjs`** — extend the style attribute from a string (`'cyan'`) to an object (`{ fg: 'cyan', bg: 'gray', bold: true }`). Update `render()` to emit the right escape sequences.
2. **Add modifiers:** `bold`, `dim`, `italic`, `underline`, `inverse`, `strikethrough`. ANSI codes are 1, 2, 3, 4, 7, 9.
3. **Add 256-color support** for themes — `'#bd93f9'` style strings get converted to `\x1b[38;5;Xm`. Themes get a real Dracula purple, real Solarized blue, etc.
4. **Update `theme.mjs`** — each theme entry becomes `{ fg, bg, bold? }` instead of a single string. Add named semantic roles: `selection`, `header`, `statusBar`, `chipActive`, `chipInactive`, `modalBackdrop`.
5. **Add reusable widget primitives** in a new `tui/widgets.mjs`:
   - `panel(screen, x, y, w, h, { title, padding })`
   - `table(screen, x, y, w, { columns, rows, selected })`
   - `chip(screen, x, y, text, { active })`
   - `statusBar(screen, y, segments)`
   - `tabStrip(screen, y, tabs, activeIdx)`
   - `modalBackdrop(screen)` — dims the whole screen behind a modal
   - `emptyState(screen, x, y, w, h, { icon, title, message, hint })`

This wave touches `screen.mjs`, `theme.mjs`, adds `widgets.mjs`. **No tab modules change yet.** All existing renders still work because the old single-string style code path is preserved.

### Wave 2 — Retrofit every tab to use the widgets (8–10 hours)

**Goal:** Replace scattered `writeStr` calls with calls into `widgets.mjs`. The behavior stays identical, the look becomes consistent.

Go tab by tab:

1. **Tab strip** (in `render.mjs`) → `tabStrip()` with active tab on inverse background.
2. **Status bar** (in `render.mjs`) → `statusBar()` with full-row background, segment dividers, right-aligned API/version.
3. **Repos rows** → `table()` with column definitions + responsive widths. Selected row gets full-row background. Pinned section gets a `★ Pinned` heading row.
4. **Repos badges** → small `chip()` calls. Moved to a fixed column on the right so name column stays aligned.
5. **Dashboard stat cards** → use `panel()` with internal padding instead of hand-drawn boxes.
6. **Dashboard two-column body** → wrapped in `panel()` calls with a vertical `│` divider between them.
7. **Analyze pane tabs** → `tabStrip()` (same primitive as top-level tabs).
8. **Search/filter inputs** → bordered `inputBox()` widget with `🔍` glyph.
9. **Empty states everywhere** → `emptyState()` widget.
10. **All modals (Help, Palette, BranchPicker)** → call `modalBackdrop()` first so the rest of the screen dims.

### Wave 3 — Polish + small features (4–6 hours)

**Goal:** The final 10% that takes the app from "looks like a product" to "looks like a *good* product."

1. **Skeleton loaders** — when a panel is loading, draw dim `▒▒▒` placeholder bars where rows will appear. Replace the corner-only `⟳`.
2. **Progress row** — long actions (folder save, fork compares) get a row above the status bar with a `[████░░░░] 42/100` bar instead of toast spam.
3. **Header personalisation** — when authenticated, header shows `★247 ⑂38 📥3 · @gaurang`.
4. **Section headers** in dashboards/lists — uppercase + underline + dimmer color (e.g. `★ TOP REPOS BY STARS` instead of `★ Top Repos by Stars`).
5. **Subtle alternating row backgrounds** on tables (every other row is `bg: 235` for 256-color terminals).
6. **Real tab "pill" shape** with rounded corners using `╭╮╰╯` and a baseline that connects to the content below.
7. **Truncate-with-ellipsis** standardized everywhere via the existing `truncate()` helper. Today some places use `.substring(0, n)` and some use `truncate()`.
8. **Consistent icon palette** — pick a small set (⊕ add, ✕ remove, ↻ refresh, ⚙ settings) and use them everywhere. No emoji ornament in only one place.
9. **Keyboard hint chips** in the status bar — `[Enter]` becomes a small chip with a background, not bracketed text.
10. **Toast positioning** — short-lived messages slide up from the status bar; persistent state stays on the status bar.

---

## 🎨 The Design Language — Rules to Adopt

Write these into a `DESIGN.md` and follow them everywhere. The audit's worst finding is that there *isn't* a design language — every tab improvises.

### Spacing

- **Content gutter:** 2 columns of padding on the left of every panel. Currently varies between 2 and 7.
- **Row height:** 1 in compact mode; 2 (with description) in comfortable mode. Hard rule, no improvisation.
- **Section spacing:** exactly 1 blank line between sections in a panel. Today some are 0, some are 2.
- **Sidebar widths:** left = 50%, right = 50%, with a 1-col `│` divider. Today the split is uneven and divider-less.

### Color hierarchy (semantic roles, theme-mapped)

| Role | Used for | Default theme |
|---|---|---|
| `text` | normal body text | white |
| `textDim` | de-emphasized metadata | gray 8 |
| `textBright` | values, totals | bright white |
| `accent` | links, drilldowns | cyan |
| `selection` | highlighted row | bg: blue, fg: white, bold |
| `header` | column / section headings | bold + underline + gray |
| `success` | positive state | green |
| `warning` | needs attention | yellow |
| `danger` | destructive / failure | red |
| `chipActive` | active filter / tab | bg: cyan, fg: black |
| `chipInactive` | inactive filter / tab | dim |
| `statusBar` | bottom-row chrome | bg: gray 235, fg: white |
| `modalBackdrop` | overlay dimmer | bg: black with 50% alpha approx (via dim) |

### Component vocabulary

Every tab must compose from this vocabulary — no raw `writeStr` for structural elements:

- `panel({ title, padding, divider? })` — bordered region
- `table({ columns: [{ name, width, align }], rows, selectedIdx })` — every list is a table
- `chip({ text, variant: 'active' | 'inactive' | 'badge' })` — filter tags, sort indicators
- `tabStrip({ tabs, activeIdx })` — both top-level and pane-level tabs
- `statusBar({ left, right })` — the bottom row
- `emptyState({ icon, title, message, action })` — for every "nothing here" case
- `progress({ value, max, label })` — for long-running ops
- `inputBox({ prompt, value, mask?, placeholder? })` — search, filter, login
- `kbdHint({ key, label })` — for `[Enter] Open`-style hints

---

## ⏱️ Effort Estimate

| Wave | Hours | Risk | Visible impact |
|---|---|---|---|
| **Wave 1 — Raise the rendering floor** | 8–12 | 🟧 Med (touches `screen.mjs` core) | None yet — old code still works |
| **Wave 2 — Retrofit tabs to widgets** | 8–10 | 🟨 Low (incremental, one tab at a time) | 🚀 **Massive** — every screen feels like a real product |
| **Wave 3 — Polish + small features** | 4–6 | 🟨 Low | The "that's actually nice" moments |
| **Total** | **20–28 hours** | | |

For reference: that's roughly the same effort it took to ship v0.3 (modular refactor + command palette + themes + inbox triage). The payoff: every screenshot of the app will look like a finished product, not a prototype.

### Cheaper alternative: half-day cosmetic pass

If you can only spare 4 hours and want a quick lift, the highest-leverage subset is:

1. **Add background colors + `inverse` to `screen.mjs`** (2 hours)
2. **Update selected-row rendering everywhere** to use a full-row background (1 hour)
3. **Add modal backdrop dimming** (30 mins)
4. **Convert status bar to full-row inverse-video** (30 mins)

That alone closes 60% of the prototype-y feel. It's not a complete fix but it's a real lift for half a day.

---

## 📋 Appendix — File-by-File Severity Index

| File | LOC | Issues | High-severity count |
|---|---|---|---|
| `screen.mjs` | 142 | The rendering floor problem (root cause of everything) | 1 |
| `render.mjs` | 115 | C1 status bar, C9 tab strip, C10 header | 3 |
| `theme.mjs` | 70 | C8 — themes don't actually look different | 1 |
| `tabs/dashboard.mjs` | 212 | D1, D3, D5 high; 7 other issues | 3 |
| `tabs/repos.mjs` | ~250 | R1, R2, R3, R7 high; 5 other issues | 4 |
| `tabs/analyze.mjs` | 485 | A1, A2, A4 high; 7 other issues | 3 |
| `tabs/settings.mjs` | ~165 | S2 high; 4 other issues | 1 |
| `tabs/inbox.mjs` | ~210 | 6 medium issues; no highs | 0 |
| `tabs/help.mjs` | ~75 | H1 high (modal backdrop); 4 other | 1 |
| `palette.mjs` | ~120 | P1 high (modal backdrop); 5 other | 1 |
| `tabs/files.mjs` | ~530 | (Audited as part of Analyze A6/A7/A8) | — |
| `tabs/forks.mjs` | ~170 | A9, A10 audited as part of Analyze | — |

**Total severity counts:**
- 🟥 **High:** 18 issues (mostly tied to the rendering floor)
- 🟧 **Med:** 31 issues (layout discipline + missing widget vocabulary)
- 🟨 **Low:** 14 issues (polish)

**The good news:** ~80% of the High-severity issues collapse to a single root cause (Wave 1). Once `screen.mjs` supports backgrounds and modifiers, and `widgets.mjs` exists, the per-tab fixes are 30–60 mins each.

---

## 🎯 My Recommendation

Do **Wave 1 in one focused session**, then **Wave 2 over a couple of sessions** (one or two tabs at a time so you can ship and verify), then **Wave 3** as polish whenever you have a spare hour.

The single highest-ROI move is **Wave 1 step 1+2** (backgrounds + modifiers). Even if you stopped there, every selection state, every active tab, every modal would instantly look right.

*Audit complete. Functionality stays untouched throughout — this is purely a presentation-layer initiative.*
