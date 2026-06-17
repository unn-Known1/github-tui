# GitHub TUI — UI/UX Deep Review Report

**Date:** 2026-06-17  
**Reviewer:** MiMoCode Agent  
**Scope:** Full application UI/UX across all tabs, functions, and user interactions.

## Executive Summary

The GitHub TUI is a feature-rich, zero-dependency terminal client with a solid modular architecture. All core functions work correctly: authentication, repository browsing, search, file exploration, notifications, and command palette. However, the **user interface lacks professional polish** — it feels like a functional prototype rather than a refined product. The UI suffers from inconsistent spacing, weak visual hierarchy, limited use of terminal capabilities, and missing UX affordances that would make the app feel modern and intuitive.

**Key Issues (Top 5):**
1. **No visual structure** — content is flat text without boxes, panels, or visual grouping
2. **Hardcoded column widths** — breaks on different terminal sizes, no responsive layout
3. **Weak selection feedback** — `▶` arrow is the only indicator; no highlight, no background color
4. **No loading/progress feedback** — just a static "Loading..." text in header
5. **Inconsistent design language** — each tab reinvents its own layout patterns

---

## 1. Global Chrome (Header, Tab Bar, Status Bar)

### Current State
- Header: `┌─ GitHub TUI ─────────────────────────────────┐` with welcome message
- Tab bar: `[1] Dashboard  [2] Repos  [3] Analyze  [4] Settings  [5] Inbox`
- Status bar: context-sensitive key hints
- Message bar: colored toast messages

### Issues
| Issue | Severity | Description |
|-------|----------|-------------|
| No active tab highlight | High | Active tab is just `bright` text; inactive is `dim`. No underline, no background, no box drawing to distinguish. |
| Tab bar is not interactive-looking | Medium | Tabs look like plain text labels, not clickable buttons. No visual affordance for selection. |
| Header wasted space | Low | 3-line header with just title and welcome message. Could show more useful info (repo count, unread count, etc.) |
| Rate limit indicator is tiny | Low | `API 4800/5000` in top-right is easy to miss. Should be more prominent when low. |
| Loading indicator is weak | Medium | `⟳ Loading...` appears at fixed position; no animation, no progress. |

### Recommendations
- Add **background highlight** or **underline** to active tab
- Use box-drawing to create a proper tab strip with visual separation
- Add **animated spinner** (-frame cycling: `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`)
- Show **unread notification count** in header when on non-Inbox tabs
- Consider a **mini status line** below tab bar showing: `repos: 42 | stars: 1.2k | ⚠ 3 stale`

---

## 2. Dashboard Tab

### Current State
- Greeting + stat cards (5 cards in a row)
- Left column: profile, heatmap, sparkline, top repos, languages
- Right column: activity feed, recent issues, recent PRs, stale repos, trending
- Quick actions bar at bottom

### Issues
| Issue | Severity | Description |
|-------|----------|-------------|
| Stat cards are plain boxes | High | `┌─────┐` with text inside. No colors, no icons, no visual weight. |
| Heatmap is ASCII art | Medium | Uses `░▒▓█` characters. Works but looks dated compared to GitHub's green squares. |
| Sparkline is tiny | Low | Single line of `▁▂▃▄▅▆▇█`. Hard to read meaning. |
| Two-column layout is cramped | Medium | On narrow terminals (<80 cols), columns overlap or content gets cut off. |
| No visual grouping | High | Sections like "Profile", "Activity", "Trending" are just bold text headers with no visual container. |
| Quick actions bar is invisible | Low | Just dim text at bottom; doesn't look interactive. |

### Recommendations
- **Stat cards**: Add colored borders or background (using ANSI 256-color or truecolor if terminal supports). Use icons consistently.
- **Heatmap**: Use Unicode block characters with green gradient (█ with different shades). Consider `theme.color('activity')` for consistency.
- **Section headers**: Add a thin horizontal rule or box under each section title.
- **Two-column**: Make responsive — stack vertically on narrow terminals.
- **Quick actions**: Use a proper button-like appearance: `[r] Refresh │ [n] New Issue │ ...`

---

## 3. Repos Tab

### Current State
- Aggregate stats header (stars, forks, issues, repo count)
- Sort controls with key hints
- Filter tags line
- Column headers: Repo, Lang, ★, ⑂, Issues, Pushed
- Row selection with `▶` indicator
- Badges (🔒🔱📦🗄📌★)
- Density toggle (compact/comfortable)
- Footer with range info

### Issues
| Issue | Severity | Description |
|-------|----------|-------------|
| Column widths are hardcoded | High | `screen.writeStr(34, ...)` etc. Breaks when terminal is narrow or repo names are long. |
| No row highlight | High | Selected row only gets `▶` prefix; no background color or reverse video. |
| Badges are cramped | Medium | Up to 3 badges before name; each is 2 chars wide. Can eat into name space. |
| Sort indicator is tiny | Low | `↑` or `↓` next to sort label. Easy to miss. |
| Filter tags are plain text | Low | `type=forks • lang=JavaScript • stale-only` — no visual distinction. |
| No empty state design | Medium | "No repos match current filters" is just dim text. |

### Recommendations
- **Responsive columns**: Calculate column positions based on terminal width. Use `screen.width` to distribute space.
- **Row highlight**: Use reverse video (`\x1b[7m`) or colored background for selected row.
- **Badges**: Move to a separate column or use consistent width. Consider a badge column.
- **Sort indicator**: Make more prominent — e.g., `★↑` or use colored arrow.
- **Filter tags**: Use colored chips or boxed text.
- **Empty state**: Add a helpful illustration (ASCII art) and action suggestions.

---

## 4. Analyze Tab

### Current State
- Search input with prompt
- Results list with selection
- Details view with pane tabs (Overview, Issues, PRs, README, Files)
- Overview: 2-column layout (metadata + languages/contributors/releases)
- Forks view with ahead/behind columns

### Issues
| Issue | Severity | Description |
|-------|----------|-------------|
| Search input is plain text | Medium | `Search: █` — no visual container, no border. |
| Pane tabs are plain text | High | `[O] Overview  [i] Issues (3)  [P] PRs (1)  [R] README  [F] Files` — no visual separation, no active indicator. |
| Details metadata is just a list | Medium | `Description: ...` `Language: ...` — no visual grouping, no labels styled differently. |
| Language bars are monotone | Low | `████████░░░░` — all same color. Could use per-language colors. |
| Contributors are plain text | Low | `● username` — no avatars, no contribution count styling. |
| Forks ahead/behind is tiny | Medium | `+3 -1` in small text. Should be more prominent. |

### Recommendations
- **Search input**: Add a border or background. Use `┌─ Search ─────────────┐` style.
- **Pane tabs**: Use a proper tab bar with active tab highlight. Consider underline or background.
- **Details metadata**: Use a two-column layout with labels in dim, values in normal. Add box around each section.
- **Language bars**: Use different colors per language (map common languages to distinct colors).
- **Contributors**: Show contribution count more prominently. Consider a small bar chart.
- **Forks ahead/behind**: Use colored indicators (green for ahead, red for behind) with larger text.

---

## 5. Files Pane (Analyze → Files)

### Current State
- Breadcrumb navigation
- File tree with icons (📁📄↩)
- File viewer with line numbers
- Branch picker overlay
- Footer with action hints

### Issues
| Issue | Severity | Description |
|-------|----------|-------------|
| Icons are inconsistent | Medium | Mix of Unicode (📁📄) and ASCII (↩). Some terminals may not render emoji. |
| No file type indicators | Low | Only shows size. Could show language, last modified, etc. |
| Line numbers are plain | Low | Just dim numbers. Could be styled per language. |
| No syntax highlighting | Medium | Only naive keyword coloring. Real highlighting would be much better. |
| Branch picker is a simple list | Low | No search, no filtering. |
| Footer is too long | Medium | `[Enter] Open  [s] Save file  [S] Save folder  [Z] Zipball  [C] git clone  [G] gh clone  [B] Branch  [y] Copy raw URL  [Esc] Back` — overwhelming. |

### Recommendations
- **Icons**: Use consistent Unicode icons. Provide fallback for terminals that don't support them.
- **File type**: Show language badge next to filename.
- **Line numbers**: Style with dim color, maybe highlight current line.
- **Syntax highlighting**: Integrate a lightweight terminal syntax highlighter (e.g., `cli-highlight` or custom tokenizer).
- **Branch picker**: Add fuzzy search, show current branch more prominently.
- **Footer**: Group actions into categories, show only relevant ones based on context.

---

## 6. Settings Tab

### Current State
- Menu items with selection indicator (`▶`)
- System info panel on right
- Help text at bottom

### Issues
| Issue | Severity | Description |
|-------|----------|-------------|
| Menu items are plain text | Medium | No icons, no visual grouping. |
| Disabled items are just dim | Low | Should have a clear "disabled" state. |
| System info panel is cramped | Low | Key-value pairs are tightly packed. |
| No confirmation for destructive actions | High | "Clear Token File" and "Logout" have no confirmation dialog. |

### Recommendations
- **Menu items**: Add icons (🔑 Login, 🚪 Logout, 🔄 Refresh, 🎨 Theme, etc.)
- **Disabled items**: Use a different style (dim + strikethrough if supported)
- **System info**: Add box around panel, use consistent spacing.
- **Confirmation**: Add a modal dialog for destructive actions.

---

## 7. Inbox Tab

### Current State
- Notification list with type, repo·title, reason, time
- Unread indicator (●)
- Filter cycle (all/unread/mentions/review)
- By-repo summary on right
- Footer with action hints

### Issues
| Issue | Severity | Description |
|-------|----------|-------------|
| No visual grouping by repo | Medium | Notifications are a flat list. Grouping by repo would improve scannability. |
| Unread indicator is tiny | Low | Just `●` character. Could be more prominent. |
| Type colors are limited | Low | Only 6 colors for 6 types. Could use more nuance. |
| No batch actions | Medium | Can only mark one at a time or mark all. No multi-select. |
| No notification detail view | High | Can only open in browser. Should show inline detail. |

### Recommendations
- **Group by repo**: Add section headers for each repo.
- **Unread indicator**: Use colored background or bold text.
- **Type colors**: Use more distinct colors, add icons per type.
- **Batch actions**: Add multi-select mode (space to toggle, `M` to mark selected).
- **Detail view**: Add an inline detail pane showing notification body.

---

## 8. Help Overlay

### Current State
- Centered modal with keybinding list
- Sections: Global, Repos, Analyze, Files, Forks, Inbox
- Plain text with dim/bright styling

### Issues
| Issue | Severity | Description |
|-------|----------|-------------|
| No search/filter | Medium | Long list; hard to find specific key. |
| No visual hierarchy | Low | All sections look the same. |
| No key icons | Low | Keys are just text like `Enter`, `Space`. |

### Recommendations
- **Search**: Add a search input at top to filter keybindings.
- **Visual hierarchy**: Use colored section headers, add separators.
- **Key icons**: Use Unicode symbols for common keys (↵ for Enter, ␣ for Space, etc.)

---

## 9. Command Palette

### Current State
- Centered modal with search input
- Fuzzy matching of actions
- List with selection indicator
- Hints on right side

### Issues
| Issue | Severity | Description |
|-------|----------|-------------|
| No action categories | Medium | All actions are flat. Grouping by tab or function would help. |
| No recent actions | Low | Could show recently used actions first. |
| No keyboard shortcuts shown | Low | Hints are shown but could be more prominent. |

### Recommendations
- **Categories**: Group actions by tab or function (e.g., "Repos", "Analyze", "Global").
- **Recent actions**: Track and show recently used actions.
- **Shortcuts**: Show keyboard shortcuts in a consistent column.

---

## 10. Cross-Cutting Issues

### Terminal Compatibility
- **No truecolor support**: Only uses 8 basic colors. Modern terminals support 24-bit color.
- **No mouse support**: Could add mouse scrolling for lists.
- **No focus indicators**: No way to tell which pane is active in multi-pane views.

### Accessibility
- **No screen reader support**: TUI is inherently inaccessible, but could add a linearized mode.
- **No high-contrast mode**: `highContrast` theme exists but is just white text.
- **No color-blind friendly**: Colors are the only differentiator in many places.

### Performance
- **Full redraw on every change**: Diff-based renderer helps, but could be smarter.
- **No virtual scrolling**: Large lists render all visible rows.
- **No lazy loading**: All content loads at once.

### Consistency
- **Mixed icon sets**: Some tabs use emoji (📁📄🔔), others use ASCII (★↑↓).
- **Inconsistent spacing**: Some sections start at column 4, others at 2.
- **Different selection indicators**: `▶` in some places, `▶` with space in others.

---

## 11. Priority Recommendations

### High Priority (Quick Wins)
1. **Add row highlighting** — Use reverse video or colored background for selected items
2. **Make tab bar interactive** — Add active tab underline or background
3. **Add loading spinner** — Replace static "Loading..." with animated spinner
4. **Responsive column widths** — Calculate based on terminal width
5. **Add confirmation dialogs** — For destructive actions (logout, clear token)

### Medium Priority (UX Improvements)
1. **Visual grouping** — Add boxes or separators around related content
2. **Consistent icons** — Choose one icon set (emoji or ASCII) and stick with it
3. **Better empty states** — Add helpful messages and action suggestions
4. **Search in help** — Add filter input to help overlay
5. **Notification grouping** — Group inbox by repo

### Low Priority (Polish)
1. **Truecolor support** — Use 24-bit color for richer visuals
2. **Mouse support** — Add scrolling and click support
3. **Syntax highlighting** — Integrate a real lexer for file viewer
4. **Animation** — Add subtle transitions for state changes
5. **Accessibility** — Add linearized mode for screen readers

---

## 12. Implementation Roadmap

### Phase 1: Visual Structure (1-2 days)
- Add box-drawing around major sections
- Implement row highlighting with reverse video
- Create responsive column layout system
- Add loading spinner animation

### Phase 2: Consistency (2-3 days)
- Standardize icon set across all tabs
- Unify spacing and alignment
- Add visual grouping for related content
- Implement confirmation dialogs

### Phase 3: Polish (3-5 days)
- Add truecolor support with fallback
- Implement mouse support
- Add search to help overlay
- Group notifications by repo
- Add empty state designs

### Phase 4: Advanced (1-2 weeks)
- Integrate syntax highlighter
- Add animation system
- Implement accessibility mode
- Add virtual scrolling for large lists

---

## 13. Code Examples

### Current Row Selection (repos.mjs:269)
```javascript
screen.writeStr(2, row, sel ? '▶' : ' ', sel ? 'bright' : null);
```

### Improved Row Selection
```javascript
// Use reverse video for selection highlight
const style = sel ? 'reverse' : null;
screen.writeStr(2, row, sel ? '▶' : ' ', sel ? 'bright' : null);
// Apply reverse video to entire row
for (let x = 0; x < screen.width; x++) {
  if (sel) screen.styleBuf[row][x] = 'reverse';
}
```

### Current Tab Bar (render.mjs:44-52)
```javascript
TABS.forEach((tab, i) => {
  const isActive = i === tabState.current;
  const bx = 1 + i * tabWidth;
  const label = '[' + tab.key + '] ' + tab.label;
  const pad = Math.floor((tabWidth - label.length) / 2);
  const tx = bx + Math.max(0, pad);
  screen.writeStr(tx, 5, label, isActive ? 'bright' : 'dim');
});
```

### Improved Tab Bar
```javascript
TABS.forEach((tab, i) => {
  const isActive = i === tabState.current;
  const bx = 1 + i * tabWidth;
  const label = '[' + tab.key + '] ' + tab.label;
  const pad = Math.floor((tabWidth - label.length) / 2);
  const tx = bx + Math.max(0, pad);
  
  if (isActive) {
    // Draw active tab with underline and bright text
    screen.writeStr(tx, 5, label, 'bright');
    screen.writeStr(tx, 6, '─'.repeat(label.length), 'cyan');
  } else {
    screen.writeStr(tx, 5, label, 'dim');
  }
});
```

---

## 14. Conclusion

The GitHub TUI has **excellent functionality** but **mediocre visual design**. With focused effort on the high-priority items (row highlighting, tab bar, loading states, responsive layout), the app could look **professional and modern** while maintaining its zero-dependency philosophy.

The modular architecture makes these improvements straightforward — each tab can be enhanced independently. The theme system provides a good foundation for color improvements.

**Estimated effort for high-priority fixes: 2-3 days**  
**Estimated effort for full polish: 1-2 weeks**

---

*Report generated by deep code review of all 15 modules across 5 tabs, covering ~3,500 lines of code.*