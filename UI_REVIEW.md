# GitHub TUI — UI/UX Deep Review Report

> **Date:** 2026-06-17
> **Scope:** All 5 tabs, 4 overlays, rendering layer, theme system, keyboard UX
> **Goal:** Identify every UI/UX shortcoming preventing the TUI from looking and feeling professional

---

## Executive Summary

The GitHub TUI has a remarkably complete feature set for a zero-dependency Node.js TUI — dashboard with heatmap/sparkline, repos browser with filters/pins/density, full file explorer with clone/zipball, inbox triage, and a command palette. **The functionality is solid.** The problem is that the visual layer hasn't kept pace with the feature layer. Every screen looks like a developer prototype: hardcoded column positions, no background colors, emoji rendering issues, and cramped layouts. This report catalogs every issue and proposes concrete fixes.

---

## 1. Rendering Layer (`tui/screen.mjs`) — THE ROOT CAUSE

This is the single biggest bottleneck. Everything downstream inherits its limitations.

### 1.1 Color System is Severely Limited

**Current state:** Only 8 foreground colors (red/green/yellow/blue/magenta/cyan/white) plus `bright` (bold) and `dim`.

| Missing Capability | Impact |
|---|---|
| No background colors | Can't highlight selected rows, active tabs, or focused elements |
| No 256-color or truecolor | Can't create nuanced palettes (e.g., GitHub's actual colors) |
| No italic/underline | Can't distinguish links, emphasis, or code inline |
| No reverse video | Can't create proper selection highlighting |
| No strikethrough | Minor, but useful for completed items |

**Fix:** Add SGR attributes to the style map. Even adding just `bg` (background), `bold`, `underline`, and `reverse` would transform the UI:

```js
// Current
const FG = { bright: `${ESC}[1m`, dim: `${ESC}[2m`, red: `${ESC}[31m`, ... };

// Proposed addition
const ATTR = {
  bold: `${ESC}[1m`, italic: `${ESC}[3m`, underline: `${ESC}[4m`,
  reverse: `${ESC}[7m`, strikethrough: `${ESC}[9m`,
};
const BG = {
  red: `${ESC}[41m`, green: `${ESC}[42m`, yellow: `${ESC}[43m`,
  blue: `${ESC}[44m`, magenta: `${ESC}[45m`, cyan: `${ESC}[46m`,
  white: `${ESC}[47m`, default: `${ESC}[49m`,
};
```

### 1.2 `box()` is Too Primitive

**Current state:** Single `box()` method draws `┌─┐│└─┘` with an optional centered title. No padding control, no double borders, no rounded corners.

**Issues:**
- Dashboard `drawCard()` reimplements box-drawing manually instead of using `screen.box()` — inconsistent style
- No way to create nested boxes or bordered sections within a tab
- No shadow or depth effect

**Fix:** Add `boxStyle` parameter (`'single'` | `'double'` | `'round'`), optional `padding` parameter, and a `vline()` method for column separators.

### 1.3 No `fillRect()` for Background Regions

**Current state:** `fillRow()` fills a single row with a character. No way to fill a rectangular area.

**Impact:** Can't create colored backgrounds for stat cards, headers, or selection highlights.

**Fix:** Add `fillRect(x, y, w, h, ch, style)` that fills both `charBuf` and `styleBuf` for a rectangular region.

### 1.4 Diff-Based Renderer Doesn't Track Style Changes Properly

**Current state:** `render()` compares `prevChar[y][x]` and `prevStyle[y][x]` to decide what to redraw. Style resets use `RESET` followed by new style.

**Issue:** If two adjacent cells have different styles, each emits a full `ESC[0m` + new color sequence. This is verbose but works. However, the `prevStyle` comparison is a string equality check — if a cell's style changes from `'red'` to `color('star')` and the theme maps both to `'yellow'`, it won't detect the change.

**Impact:** Minor — mostly affects first render after theme change. Not a visual bug but a performance edge case.

---

## 2. Global Chrome (`tui/render.mjs`)

### 2.1 Header Box is Bland

**Current state:**
```
┌──────────────────────── GitHub TUI ─────────────────────────┐
│ Welcome, username                              API 4891/5000 │
└──────────────────────────────────────────────────────────────┘
```

**Issues:**
- No visual separation between the app title and the welcome message
- Rate limit indicator is plain dim text — should be more prominent when low
- Loading indicator (`⟳ Loading...`) is jammed next to the rate limit — no spacing logic

**Fix:**
- Use reverse video or background color for the header title
- Rate limit: use green when healthy, yellow when <20%, red when 0 — with a visual bar
- Loading: use a spinner animation (rotating `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) instead of static `⟳`

### 2.2 Tab Strip Has No Active Indicator

**Current state:** Active tab is `bright`, inactive is `dim`. That's it.

```
[1] Dashboard  [2] Repos  [3] Analyze  [4] Settings  [5] Inbox
```

**Issues:**
- No underline, no background, no reverse video — the active tab doesn't "pop"
- All tabs have equal visual weight except for dim/bright
- No tab count badges (e.g., unread notification count on Inbox tab)

**Fix:**
- Underline the active tab text, or use reverse video
- Add notification count badge on Inbox tab: `[5] Inbox(3)`
- Consider a bottom border on the active tab

### 2.3 Status Bar is Overcrowded

**Current state:** Single line with all key hints for the current tab/view.

**Issues:**
- Repos tab status: `[n/s/f/i/u] Sort  [/] Filter  [Space] More  [Ctrl-P] Palette  [?] Help  [q] Quit` — 65+ chars, wraps on 80-col terminals
- Analyze details: `[Enter] Forks  [i] Issues  [P] PRs  [R] README  [s] Star  [b] Bookmark` — also long
- No visual grouping of related keys

**Fix:**
- Group related keys with visual separators: `Sort: [n/s/f/i/u] | Filter: [/] | ..."
- Or use a two-line status bar when needed
- Or show only the most important 3-4 keys, with `?` for the rest

### 2.4 Message Bar is Jarring

**Current state:** When a toast message appears, it completely replaces the status bar. When the message auto-clears, the status bar snaps back.

**Issues:**
- The jump between status bar and message bar is visually disruptive
- Messages have no visual container — just raw colored text
- No way to dismiss a message manually (must wait for timeout)

**Fix:**
- Reserve a dedicated message zone (e.g., above the status bar)
- Or overlay the message on the status bar with a different background color
- Add `Esc` to dismiss messages early

---

## 3. Dashboard Tab (`tui/tabs/dashboard.mjs`)

### 3.1 Stat Cards Are Cramped

**Current state:** 5 cards in a row, each with a box border.

```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ ★ Total Stars│ │ ⑂ Total Forks│ │ ◆ Languages  │ │ ⏱ Account Age│ │ ⚠ Stale Repos│
│ 12.3k        │ │ 1.2k         │ │ 8            │ │ 5.2y         │ │ 3            │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

**Issues:**
- Cards use `drawCard()` which manually draws box borders — doesn't use `screen.box()`
- No background color to make cards stand out
- Card width is `Math.floor((W - 8 - 8) / 5)` — at 80 cols, each card is only 12 chars wide — too cramped
- Values are plain text — no visual emphasis
- On narrow terminals (<60 cols), cards disappear entirely (`if (cardY + 3 >= y + h) return`)

**Fix:**
- Use reverse video or a background color for card headers
- On narrow terminals, stack cards vertically or show as a single-line summary
- Add visual separators between cards (vertical bars)
- Make the value text brighter/bolder

### 3.2 Contribution Heatmap is Monochrome

**Current state:** Uses `░▒▓█` block characters for intensity, all in `color('success')` (green).

**Issues:**
- All non-zero cells are the same green — no visual distinction between 1 event and 5 events
- Day labels (S M T W T F S) are plain `dim` — hard to read
- The "15 weeks" label doesn't explain what the heatmap represents

**Fix:**
- Use different intensities with the same color family (e.g., dim green → bright green)
- Or use 256-color if available (e.g., ANSI 22-27 for green shades)
- Add a legend bar at the bottom: `Less ░▒▓█ More`

### 3.3 Star History Sparkline is Invisible

**Current state:** A single line of Unicode block characters (`▁▂▃▄▅▆▇█`) with a total count.

**Issues:**
- No labels on the axis (no "30 days ago" / "today")
- No baseline — the sparkline floats in space
- Monochrome — no visual emphasis on peaks

**Fix:**
- Add axis labels: `30d ago ─────────────────── today`
- Use color to highlight peak days
- Add a small legend: `█ = N stars`

### 3.4 Activity Feed Runs Into Other Sections

**Current state:** Activity, Issues, PRs, Stale Repos, and Trending are stacked vertically in the right column with no visual separators.

**Issues:**
- Sections blur together — hard to tell where "Recent Activity" ends and "Recent Issues" begins
- No spacing between sections
- Emoji icons (↑ ⇄ ◉ ✎ ★ ☆ ⑂ + − ▶ ◎) are inconsistent widths

**Fix:**
- Add a horizontal line or blank row between sections
- Use consistent icon style (all ASCII or all emoji — don't mix)
- Consider a subtle background color for section headers

### 3.5 Quick Actions Bar Overlaps Content

**Current state:** Placed at `y + h - 1` — the very last row of the content area.

**Issues:**
- On small terminals, the last content row and the quick actions bar overlap
- No visual separation from the content above
- Actions are plain dim text — not visually distinct

**Fix:**
- Add a horizontal line above the quick actions bar
- Or place it in the status bar area
- Make action keys brighter

---

## 4. Repos Tab (`tui/tabs/repos.mjs`)

### 4.1 Column Positions Are Hardcoded

**Current state:**
```js
screen.writeStr(4,  headerY, 'Repo', 'bright');     // x=4
screen.writeStr(34, headerY, 'Lang', 'bright');     // x=34
screen.writeStr(46, headerY, '★', 'bright');        // x=46
screen.writeStr(53, headerY, '⑂', 'bright');        // x=53
screen.writeStr(60, headerY, 'Issues', 'bright');   // x=60
screen.writeStr(70, headerY, 'Pushed', 'bright');   // x=70
```

**Issues:**
- At 80 columns, the "Pushed" column is at x=70, leaving only 10 chars for the date
- At 120 columns, there's wasted space on the right
- At 60 columns, columns overlap and become unreadable
- Data rows use the same hardcoded positions

**Fix:** Calculate column positions dynamically based on `screen.width`:
```js
const W = screen.width;
const colRepo = 4;
const colLang = Math.floor(W * 0.4);
const colStars = Math.floor(W * 0.5);
// etc.
```

### 4.2 Emoji Badges Cause Column Shifts

**Current state:** Badges like 🔒🔱📦🗄📌★ are prepended before the repo name.

**Issues:**
- Emoji have inconsistent display width (1 or 2 chars depending on terminal)
- Up to 3 badges are shown (`badges.slice(0, 3)`), consuming 6+ chars
- The name column width is reduced by badge width, but the column header doesn't adjust

**Fix:**
- Use ASCII badges instead: `[P]` for private, `[F]` for fork, `[A]` for archived
- Or reserve a fixed-width badge area and left-align names within it
- Or show badges in a separate column

### 4.3 Filter/Sort Status Line is Dense

**Current state:**
```
Sort: ★ Stars ↓  •  Density: compact  •  type=sources  •  "react"
```

**Issues:**
- All on one line — hard to parse at a glance
- No visual hierarchy — the active sort and the active filter have the same weight

**Fix:**
- Use two lines: one for sort, one for filters
- Or use color to distinguish active filters from inactive
- Or use icons: `↕ ★ Stars  📦 sources  🔍 "react"`

### 4.4 Keys Hint Line is Too Long

**Current state:**
```
[n]Name [S]★ Stars [f]⑂ Forks [i]Issues [u]Updated [/] Filter [t] Type [L] Lang [x] Stale [D] Density [P] Pin [s] Star [Enter] Open
```

**Issues:**
- 120+ characters — wraps on 80-col terminals
- Mixes sort keys, filter keys, and action keys — no grouping

**Fix:**
- Show only the 4-5 most important keys
- Group by category: `Sort: [n/s/f/i/u]  Filter: [/tLx]  Actions: [PD Enter]`
- Full key list available in `?` help overlay

### 4.5 No Visual Separator Between Pinned and Unpinned

**Current state:** Pinned repos float to the top via `floatPinsToTop()`, but there's no visual line or label separating them from the rest.

**Fix:** Add a dim horizontal line or a "── Pinned ──" label between pinned and unpinned repos.

### 4.6 Description Text in Comfortable Mode

**Current state:** When `repoDensity === 'comfortable'`, the description appears on row+1 in dim text.

**Issues:**
- No truncation indicator — if the description is cut off at `W-10`, there's no `…`
- The description text has no left indent relative to the repo name — it starts at x=6 regardless

**Fix:** Use `truncate()` from utils.mjs and add a `…` when truncated. Indent to align with the repo name.

---

## 5. Analyze Tab (`tui/tabs/analyze.mjs`)

### 5.1 Search Input is Sparse

**Current state:**
```
Search:
             (press Enter or i to search)

Search for any public GitHub repository to analyze.
Type owner/repo or keywords, then press Enter.
```

**Issues:**
- Most of the screen is empty — the search input area is tiny
- No visual container for the input
- No search history or recent searches
- No placeholder text showing example queries

**Fix:**
- Add a bordered input box (like the command palette)
- Show recent/saved searches below
- Show example queries: `e.g., "facebook/react", "rust-lang", "machine learning"`

### 5.2 Results List is Too Short

**Current state:** `const maxVisible = Math.max(1, Math.min(6, h - 10))` — max 6 visible results.

**Issues:**
- At 80x24, that's only 6 results visible — the user has to scroll constantly
- No visual distinction between selected and unselected rows beyond `▶`

**Fix:** Use more vertical space — the search input is already visible at the top. Or show results in a denser format (1 line per result instead of the current 1-line format).

### 5.3 Details View Column Layout

**Current state:** Left column (metadata) at `Math.min(48, W/2)`, right column (languages/contributors/releases) at `leftWidth + 6`.

**Issues:**
- On 80-col terminals: left=40, right=46 — tight but works
- On 60-col terminals: left=30, right=36 — very cramped
- On 120-col terminals: left=48, right=54 — wastes space
- The metadata label "Description:" is 12 chars but values start at x=18 — only 6 chars of overlap

**Fix:** Use percentage-based columns (e.g., 45%/55%) with minimum widths.

### 5.4 Pane Tabs Are Right-Aligned with Manual Width

**Current state:**
```js
const panes = [
  ['overview', 'Overview', 'O'],
  ['issues',   'Issues (' + count + ')', 'i'],
  ['prs',      'PRs (' + count + ')', 'P'],
  ['readme',   'README', 'R'],
  ['files',    'Files', 'F'],
];
```

**Issues:**
- Width calculated by summing label lengths — no overflow protection
- Right-aligned to `W - right` — may overlap with repo name on narrow terminals
- Active pane indicator is only bright vs dim — same problem as the tab strip

**Fix:** Left-align pane tabs after the repo name. Use underline or reverse for the active pane.

### 5.5 README Pane is Naive

**Current state:** Only handles:
- `# headings` → bright
- `- lists` → accent color
- `` ``` `` code fences → dim
- Everything else → plain

**Issues:**
- No bold/italic (can't — screen.mjs doesn't support it)
- No inline code highlighting
- No link rendering
- No table support
- No horizontal rules

**Fix:** This is fundamentally blocked by the screen.mjs color limitations. Adding `italic` and `underline` attributes would immediately improve the README viewer.

---

## 6. Files Pane (`tui/tabs/files.mjs`)

### 6.1 Emoji Icons Are Inconsistent

**Current state:** `📁` for directories, `📄` for files, `↩` for `..` entry.

**Issues:**
- Emoji have variable width across terminals — causes column misalignment
- `📁` and `📄` may render as 1 or 2 cells depending on the terminal
- The `↩` (↩) is narrower than the emoji icons

**Fix:** Use ASCII icons: `>` for dirs, `-` for files, `^` for `..`. Or use consistent-width Unicode: `▸` for dirs, `·` for files.

### 6.2 File Viewer Has No Syntax Highlighting

**Current state:** `decorateLine()` applies dim/accent based on file extension and line patterns:
- Comments (`#`, `//`) → dim
- Code fences → dim
- Markdown headings → bright, lists → accent
- Keywords (import, export, function, etc.) → accent

**Issues:**
- Very basic — only distinguishes keywords from other text
- No string highlighting, no number highlighting, no operator highlighting
- No language-specific rules (e.g., no JSX support, no Go-specific rules)

**Fix:** This is a deep feature request. A minimal improvement would be:
- Strings (quoted text) → a distinct color
- Numbers → another color
- Comments → always dim (already works)

### 6.3 Branch Picker Has No Search

**Current state:** Shows all branches in a scrollable list. User navigates with ↑↓.

**Issues:**
- Repos with 50+ branches require extensive scrolling
- No filter/search within the branch list
- No visual indicator of which branch is the default

**Fix:** Add `/` filter to the branch picker, or show the default branch first with a `(default)` label.

### 6.4 Footer Hint Line is Too Long

**Current state:**
```
[Enter] Open  [s] Save file  [S] Save folder  [Z] Zipball  [C] git clone  [G] gh clone  [B] Branch  [y] Copy raw URL  [Esc] Back
```

**Issues:**
- 130+ characters — wraps on 80-col terminals
- Mixes file operations, clone operations, and navigation

**Fix:** Group by category: `Open: [Enter]  Save: [s/S]  Download: [Z/C/G]  [B] Branch  [y] URL  [Esc] Back`

---

## 7. Forks View (`tui/tabs/forks.mjs`)

### 7.1 Column Positions Are Hardcoded

**Current state:**
```js
screen.writeStr(4, headerY, 'Fork Owner', 'bright');   // x=4
screen.writeStr(28, headerY, '★ Stars', 'bright');     // x=28
screen.writeStr(38, headerY, '⑂ Forks', 'bright');     // x=38
screen.writeStr(48, headerY, 'Last Push', 'bright');   // x=48
screen.writeStr(62, headerY, 'Ahead', 'bright');       // x=62
```

**Issues:** Same as Repos tab — hardcoded positions break on different terminal widths.

### 7.2 Ahead/Behind Display is Plain

**Current state:** `+3` in green, `-1` in red — just text.

**Fix:** Add a small visual bar: `■■■□□` for ahead/behind ratio.

### 7.3 Sort Key Conflict

**Current state:** `s` sorts forks by stars, but `s` is also the global star toggle.

**Issues:** The global `s` in `keys.mjs` fires first (line 182), so `s` on the forks view toggles a star instead of sorting. The forks sort by stars is unreachable via keyboard.

**Fix:** Change fork sort key from `s` to `S` or another unused key. Or reorder key resolution so per-tab keys fire before global `s`.

---

## 8. Inbox Tab (`tui/tabs/inbox.mjs`)

### 8.1 No Grouping by Date or Repository

**Current state:** Flat list of notifications. A "By Repo" summary widget on the right shows top 5 noisiest repos.

**Issues:**
- Long lists of notifications are hard to scan
- No date separators (e.g., "Today", "Yesterday", "This Week")
- The "By Repo" widget is useful but not interactive — can't filter by clicking

**Fix:**
- Add date group headers between notification rows
- Make the "By Repo" widget interactive (press number to filter by that repo)

### 8.2 Notification Type is Text-Only

**Current state:** Type is shown as plain text: `PullRequest`, `Issue`, `Release`, etc.

**Fix:** Add icons: `⇄` for PR, `◉` for Issue, `▶` for Release, etc. (The `notifTypeColor()` function already exists but only maps to colors, not icons.)

### 8.3 Filter Label is Hidden

**Current state:** Filter is shown as `[unread]` after the "Notifications" header.

**Issues:**
- Easy to miss — it's just a small bracketed label
- No visual emphasis on the active filter

**Fix:** Make the filter label more prominent — larger text, different color, or a separate line.

---

## 9. Settings Tab (`tui/tabs/settings.mjs`)

### 9.1 No Visual Grouping

**Current state:** 7 items in a flat list: Login, Logout, Refresh Dashboard, Refresh User Data, Change Theme, Clear Token File, Token display.

**Issues:**
- No section headers (Auth, Data, Appearance, Danger Zone)
- "Clear Token File" (dangerous action) is right next to "Change Theme" (safe action)
- No visual warning for destructive actions

**Fix:**
- Add section headers: `── Authentication ──`, `── Data ──`, `── Appearance ──`, `── Danger Zone ──`
- Make "Clear Token File" red or show a confirmation
- Group related items together

### 9.2 System Panel May Disappear

**Current state:** Right-aligned at `Math.min(W - 38, Math.floor(W * 0.55))`.

**Issues:**
- At 80 cols: x=44, leaving 36 chars for system info — works
- At 60 cols: `infoX > 30` check fails — panel disappears entirely
- No fallback for narrow terminals

**Fix:** Stack the system panel below the settings items on narrow terminals.

---

## 10. Help Overlay (`tui/tabs/help.mjs`)

### 10.1 Doesn't Scroll

**Current state:** Shows all keybindings in a centered box. If the terminal is too small, content is cut off: `for (let i = 0; i < lines.length && i < boxH - 3; i++)`.

**Issues:**
- On 80x24 terminals, the box is 24-4=20 lines tall, but the content is 70+ lines — only the first 17 lines are visible
- The bottom sections (Forks, Inbox) are never visible on small terminals
- No scroll indicator

**Fix:** Add scrolling support to the help overlay (↑↓ to scroll, or auto-fit content by using a smaller font representation).

### 10.2 Section Headers Could Be More Distinctive

**Current state:** Sections use `── Section Name ──` with cyan color.

**Fix:** Use bright cyan or add underline for section headers.

---

## 11. Command Palette (`tui/palette.mjs`)

### 11.1 No Category Grouping

**Current state:** All actions are in a flat list, sorted by fuzzy match score.

**Issues:**
- ~25+ actions in a flat list — hard to find specific ones
- No visual distinction between "Go to Dashboard" and "Sort repos by stars"

**Fix:** Group by category: `Tabs`, `Repos`, `Analyze`, `Inbox`, `Settings`. Show category headers in the list.

### 11.2 No Recent/Last-Used Actions

**Fix:** Show the 3 most recently used actions at the top of the list.

---

## 12. Input Modal (`tui/input.mjs`)

### 12.1 No Visual Container

**Current state:** Rendered as a single line at the bottom of the screen:
```
Filter: search_term█
```

**Issues:**
- No visual box or border — just raw text
- Hard to distinguish from the status bar
- No input history (can't press ↑ to recall previous filter)

**Fix:**
- Render the input in a bordered box (like the command palette but narrower)
- Add input history (store last 10 inputs per context)
- Show the context label more prominently

---

## 13. Theme System (`tui/theme.mjs`)

### 13.1 Only 4 Themes

**Current:** default, highContrast, dracula, solarized.

**Missing:** monokai, nord, gruvbox, catppuccin, one-dark, dracula-official, github-dark.

**Fix:** Add 4-6 more themes. These can be added without changing any rendering code — just add entries to the `THEMES` object.

### 13.2 High Contrast Theme is Broken

**Current state:** Maps almost everything to `'white'` — loses all semantic differentiation.

```js
highContrast: {
  accent: 'white', star: 'white', fork: 'white', issue: 'white',
  pr: 'white', release: 'white', success: 'white', warning: 'white',
  ...
}
```

**Issues:** Stars, forks, issues, PRs, and releases all look identical. The "high contrast" theme actually reduces contrast between different elements.

**Fix:** Use bright variants: `star: 'bright'`, `fork: 'cyan'`, `issue: 'yellow'`, etc. — ensure high contrast against the background while maintaining semantic distinction.

### 13.3 No Background Colors in Any Theme

**Current state:** All themes only map foreground colors. No theme can set background colors.

**Fix:** Add `bg` role to theme mapping (requires screen.mjs changes first).

---

## 14. Keyboard UX Issues

### 14.1 Key Conflict: `s` (Sort vs Star)

**Location:** `keys.mjs:182`

```js
// 5. Global star toggle — must run before per-tab keys so 's' stars
//    even when repos tab maps 's' to sort-by-stars.
if (key === 's' && currentRepoForAction()) { toggleStar(); return; }
```

**Issue:** `s` always triggers star toggle when a repo is available. Sort-by-stars from Repos tab is unreachable via keyboard.

**Fix:** Use `S` (shift-s) for star, `s` for sort. Or use a different key for star (e.g., `*`).

### 14.2 Key Conflict: `G` (gh clone vs jump to bottom)

**Location:** `keys.mjs:167-177`

The code tries to handle this with a tab-aware check, but it's fragile — the `G` key falls through to per-tab keys which may interpret it differently.

### 14.3 No Undo for Destructive Actions

**Current state:** Actions like "Mark all as read", "Clear token file", and "Unsubscribe" happen immediately with no undo.

**Fix:** Add a confirmation step (double-press or y/N prompt) for destructive actions.

---

## 15. Layout & Responsiveness

### 15.1 Magic Numbers Everywhere

**Locations:**
- `repos.mjs:182`: `Math.floor((screen.height - 18) / rowH)` — the `18` is fragile
- `dashboard.mjs:187`: `Math.floor((W - margin * 2 - gap * (cardCount - 1)) / cardCount)` — works but the margins are hardcoded
- `render.mjs:55`: `const contentY = 7; const contentH = H - 10;` — assumes header is always 7 rows and footer is always 3 rows

**Fix:** Define layout constants: `HEADER_HEIGHT = 7`, `FOOTER_HEIGHT = 3`, `CONTENT_PADDING = 4`.

### 15.2 No Minimum Terminal Size

**Current state:** The app runs at any terminal size but becomes unusable below ~60x20.

**Fix:** Show a "Terminal too small" message below 60x20 instead of rendering a broken layout.

### 15.3 Fixed Left Margin of 4

Almost every `writeStr` call uses `x=4` as the left margin. This wastes 4 columns on every line and doesn't adapt to content width.

**Fix:** Use content-aware margins — wider for code/file viewer, narrower for list views.

---

## 16. Visual Consistency Issues

### 16.1 Mixed Icon Styles

| Location | Icons Used | Style |
|---|---|---|
| Dashboard headers | 📊 ⭐ ⚡ ◆ ⚠ 🔥 📌 | Emoji |
| Repos badges | 🔒 🔱 📦 🗄 📌 ★ | Emoji |
| Files pane | 📁 📆 ↩ | Emoji |
| Forks ahead/behind | +N / -N | Text |
| Activity feed | ↑ ⇄ ◉ ✎ ★ ☆ ⑂ + − ▶ ◎ | Unicode |
| Event glyphs | Unicode arrows/symbols | Unicode |

**Issue:** Mixing emoji and Unicode symbols creates visual inconsistency. Emoji may render as 1 or 2 cells depending on the terminal.

**Fix:** Standardize on Unicode symbols (not emoji) for all icons. Reserve emoji for greeting/header only.

### 16.2 Inconsistent Selection Indicator

| Location | Selection Indicator |
|---|---|
| Repos | `▶` (bright) |
| Analyze results | ` ▶` (two spaces) |
| Files | `▶` (bright) |
| Forks | ` ▶` (two spaces) |
| Inbox | `▶` (bright) |
| Settings | ` ▶` (three spaces) |
| Help | None |
| Palette | `▶` (bright) |

**Issue:** The spacing before `▶` varies (0, 1, or 2 spaces). Some use bright, some don't.

**Fix:** Standardize to `▶` with consistent spacing everywhere.

### 16.3 Inconsistent Section Headers

| Location | Header Style |
|---|---|
| Dashboard | `"Profile"`, `"⚡ Recent Activity"` — bright text |
| Repos | `"Your Repositories"` — bright text |
| Analyze | `"Analyze Repository"` — bright text |
| Files | Breadcrumb only — accent color |
| Forks | `"Forks of repo"` — bright text |
| Inbox | `"Notifications"` — bright text + filter label |
| Settings | `"Settings"` — bright text |

**Issue:** Some section headers have emoji, some don't. Some have a horizontal line below, some don't.

**Fix:** Standardize: always use bright text + horizontal line below. Use emoji only in Dashboard (which is the "home" screen).

---

## 17. Priority Recommendations

### Tier 1: High Impact, Moderate Effort

1. **Add background colors to `screen.mjs`** — enables row highlighting, active tab indicator, card backgrounds
2. **Make column positions responsive** — calculate based on `screen.width` instead of hardcoded values
3. **Fix the `s` key conflict** — change star toggle to a different key
4. **Add underline/bold attributes** — enables proper active indicators and emphasis
5. **Standardize selection indicators** — consistent `▶` spacing everywhere

### Tier 2: High Impact, Higher Effort

6. **Redesign the tab strip** — underline active tab, add notification badges
7. **Improve the Dashboard layout** — better card spacing, section separators, heatmap legend
8. **Add confirmation for destructive actions** — mark-all-read, clear token, unsubscribe
9. **Improve the status bar** — group keys, reduce length, add visual hierarchy
10. **Make the input modal look like a proper dialog** — bordered box, not a raw line

### Tier 3: Medium Impact, Low Effort

11. **Add 4-6 more themes** — monokai, nord, gruvbox, catppuccin, github-dark, one-dark
12. **Fix high contrast theme** — maintain semantic color distinction
13. **Replace emoji icons with Unicode symbols** — consistent width
14. **Add section headers in Settings** — group by category
15. **Add `…` truncation indicator** — in repos description, file names, etc.

### Tier 4: Nice to Have

16. **Help overlay scrolling** — for terminals < 80x30
17. **Search history in Analyze** — remember last 10 queries
18. **Input history** — recall previous filter/search inputs
19. **Command palette categories** — group actions by tab
20. **Minimum terminal size check** — show error below 60x20

---

## Appendix: File-by-File Line References

| File | Lines | Issue |
|---|---|---|
| `screen.mjs` | 4-14 | Limited FG color palette — no BG, no attributes |
| `screen.mjs` | 86-106 | `box()` too primitive — no padding, no style variants |
| `render.mjs` | 29-39 | Header chrome is bland — no background, no visual weight |
| `render.mjs` | 44-53 | Tab strip has no active indicator beyond dim/bright |
| `render.mjs` | 66-84 | Status/message bar is a single overloaded line |
| `dashboard.mjs` | 136-145 | `drawCard()` duplicates box logic — should use `screen.box()` |
| `dashboard.mjs` | 187 | Card width math assumes 5 cards always fit |
| `dashboard.mjs` | 226-248 | Heatmap is monochrome — no intensity gradient |
| `dashboard.mjs` | 251-259 | Sparkline has no axis labels |
| `dashboard.mjs` | 396-408 | Quick actions bar overlaps content on small terminals |
| `repos.mjs` | 250-256 | Column headers hardcoded to pixel positions |
| `repos.mjs` | 272-294 | Data rows use same hardcoded positions |
| `repos.mjs` | 186-193 | Badge emoji causes column width inconsistency |
| `repos.mjs` | 234-237 | Keys hint line too long for 80-col terminals |
| `repos.mjs` | 93-103 | No visual separator between pinned and unpinned repos |
| `analyze.mjs` | 127-140 | Search input is sparse — no container, no history |
| `analyze.mjs` | 148 | Results list limited to 6 visible rows |
| `analyze.mjs` | 259-273 | Pane tabs right-aligned with manual width calc |
| `analyze.mjs` | 224-250 | README pane is naive — no bold/italic/links |
| `files.mjs` | 381-386 | Emoji file icons cause column misalignment |
| `files.mjs` | 408-439 | File viewer has minimal syntax highlighting |
| `files.mjs` | 457-475 | Branch picker has no search/filter |
| `files.mjs` | 399-403 | Footer hint line is 130+ chars |
| `forks.mjs` | 135-141 | Column headers hardcoded |
| `forks.mjs` | 159-164 | Ahead/behind is plain text — no visual bar |
| `inbox.mjs` | 101-116 | Filter label is hidden/small |
| `inbox.mjs` | 153-158 | Column headers hardcoded |
| `settings.mjs` | 69-94 | No visual grouping of settings items |
| `settings.mjs` | 97-124 | System panel may disappear on narrow terminals |
| `help.mjs` | 73-92 | No scroll support — content cut off on small terminals |
| `palette.mjs` | 92-123 | No category grouping of actions |
| `input.mjs` | 15-22 | Input modal has no visual container |
| `theme.mjs` | 9-42 | Only 4 themes, high contrast is broken, no BG colors |
| `keys.mjs` | 182 | `s` key conflict: star toggle fires before sort |
| `keys.mjs` | 167-177 | `G` key conflict: gh clone vs jump to bottom |

---

*This report was generated from a deep scan of all 15 source files, VISION.md, and README.md. Every line reference points to the exact location in the current codebase.*
