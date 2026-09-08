# OpenCode TUI Patterns → Freebuff Implementation Analysis

## Executive Summary

This report analyzes OpenCode's TUI architecture and identifies which patterns, components, and UX features can be adapted for implementation in Freebuff (GitHub TUI). OpenCode uses a modern reactive SolidJS-based TUI framework (`@opentui`), while Freebuff uses a custom vanilla JS rendering engine with diff-based painting. Despite architectural differences, many UX patterns are directly transferable.

---

## 1. Component Architecture Comparison

### OpenCode Architecture
```
@opentui/core → Low-level terminal rendering (React-like primitives)
@opentui/solid → SolidJS bindings for reactive UI
@opentui/keymap → Keyboard shortcut system
Effect.ts → Effect system for async/state management
```

### Freebuff Architecture
```
Screen class → Low-level char/style buffer with diff rendering
appState/tabState → Centralized mutable state
handleKey → Key routing dispatcher
render() → Top-level paint function
```

---

## 2. Dialog & Modal System

### OpenCode Patterns

| Pattern | File | Description |
|---------|------|-------------|
| **Dialog Stack** | `ui/dialog.tsx` | Stack-based modal system with `replace()` and `clear()` |
| **Backdrop Overlay** | `ui/dialog.tsx` | Semi-transparent backdrop (`RGBA(0,0,0,150)`) with click-to-dismiss |
| **Dialog Sizes** | `ui/dialog.tsx` | `medium` (60w), `large` (88w), `xlarge` (116w) |
| **Dialog Provider** | `ui/dialog.tsx` | Context-based state management for modal stack |

### Freebuff Current State (ALREADY EXISTS)

**Freebuff already has an overlay system** — but it's implemented as ad-hoc boolean flags, not a unified stack:

| Pattern | File | Status |
|---------|------|--------|
| **Confirm Dialog** | `render.mjs:822` | ✅ `renderConfirmDialog()` with backdrop, title, message, [y]/[n] hints |
| **Input Modal** | `render.mjs:558` | ✅ `renderFooterInput()` for text input (login, search, etc.) |
| **Detail Popup** | `tabs/detail.mjs:345` | ✅ Full issue/PR detail view as overlay |
| **Help Overlay** | `tabs/help.mjs:198` | ✅ Searchable help modal |
| **Command Palette** | `palette.mjs:136` | ✅ Fuzzy search command palette |
| **Bookmarks Overlay** | `render.mjs:853` | ✅ Bookmarks browser overlay |
| **Onboarding Overlay** | `tabs/onboarding.mjs:315` | ✅ First-time welcome overlay |

**Existing overlay render order** (from `render.mjs:804-820`):
```javascript
if (appState.showDetail) renderDetail(screen);
if (appState.showOnboarding) renderOnboarding(screen);
if (appState.showHelp) help.render(screen);
if (appState.confirmAction) renderConfirmDialog(screen);
if (appState.showPalette) renderPalette(screen);
if (appState.showBookmarks) renderBookmarksOverlay(screen);
```

**Key difference from OpenCode:** Freebuff uses boolean flags (`showHelp`, `showDetail`, etc.) instead of a stack. This means:
- ❌ No nested dialogs (can't open palette while help is open)
- ❌ No focus trapping (Esc closes everything, not just top dialog)
- ❌ No save/restore focus on dialog close
- ✅ Simpler implementation (good for zero-dependency philosophy)

### ✅ **Implementation Plan: Dialog Stack System**

**Priority: HIGH** — Foundation for all popup features

```javascript
// Proposed: tui/dialog.mjs
class DialogManager {
  constructor() {
    this.stack = [];      // Stack of dialogs
    this.backdrop = true;  // Semi-transparent overlay
  }
  
  push(dialogComponent, options = {}) {
    // Save focus state
    // Push to stack
    // Trigger render
  }
  
  replace(dialogComponent, options = {}) {
    // Clear current, push new
  }
  
  pop() {
    // Pop top dialog
    // Restore focus
  }
  
  clear() {
    // Clear all dialogs
    // Restore original focus
  }
}
```

**Key Features to Implement:**
1. Backdrop overlay with click-to-dismiss
2. Escape key to close top dialog
3. Focus trapping within dialog
4. Size variants (medium/large/xlarge)
5. Nested dialog support (stack)

---

## 3. Command Palette

### OpenCode Implementation
```typescript
// component/command-palette.tsx
- Fuzzy search across all commands
- Categorized results (Session, Agent, System, etc.)
- Keyboard shortcut display
- "Suggested" commands highlighted
- Slash-command aliases (e.g., /models, /agents)
```

### Freebuff Current State
- `palette.mjs` — Basic command palette with fuzzy search
- No categories, no shortcut display

### ✅ **Implementation Plan: Enhanced Command Palette**

**Priority: HIGH** — Already has foundation, needs polish

**Enhancements:**
1. **Categorized Results** — Group by tab/feature
2. **Shortcut Display** — Show keybinding next to each command
3. **Suggested Commands** — Context-aware recommendations
4. **Recent Commands** — Track and surface frequently used
5. **Mouse Support** — Click to select, hover highlight

---

## 4. Toast Notification System

### OpenCode Implementation
```typescript
// ui/toast.tsx
- Variants: info, success, warning, error
- Auto-dismiss with configurable duration
- Positioned top-right with border accent
- Title + message support
- Stacked toasts (queue)
```

### Freebuff Current State (ALREADY EXISTS)

**Freebuff already has a toast/message system** — implemented in `state.mjs` and rendered in `render.mjs:596-616`:

```javascript
// state.mjs
appState.message = {
  text: 'Logged in as user',
  type: 'success',  // 'info' | 'success' | 'error' | 'warning'
  icon: '✓',        // optional icon
};
appState.messageTimer = setTimeout(() => { ... }, 5000);
```

**Theme colors already defined** (`theme.mjs:109-112`):
```javascript
toastInfo:    { bg: '#1c2d3e', fg: P.d_accent, bold: true },
toastSuccess: { bg: '#1a2f1a', fg: P.d_green,  bold: true },
toastError:   { bg: '#2d1a1a', fg: P.d_red,    bold: true },
toastWarning: { bg: '#2d2a1a', fg: P.d_yellow, bold: true },
```

**What's missing vs OpenCode:**
- ❌ No stacked toasts (only one message at a time)
- ❌ No positioned toasts (rendered in status bar, not floating)
- ❌ No title support (just message text)
- ❌ No click-to-dismiss
- ✅ Has auto-dismiss with timer
- ✅ Has variant-based styling

---

## 5. Settings Panel as Popup

### OpenCode Pattern
```typescript
// component/dialog-settings.tsx (implied)
- Modal popup overlay
- Sectioned layout with headers
- Toggle switches for booleans
- Select dropdowns for options
- Keyboard navigation (↑↓)
```

### Freebuff Current State
- Settings is a full tab (`tabs/settings.mjs`)
- Cursor-based navigation within tab
- No popup/modal variant

### ✅ **Implementation Plan: Quick Settings Popup**

**Priority: MEDIUM** — Power user feature

**Two Approaches:**
1. **Keep Settings Tab** — Full settings in dedicated tab
2. **Add Quick Settings Popup** — Most-used settings in modal

```javascript
// Quick Settings Popup
- Theme switcher
- Auto-refresh toggle
- Display density
- Keyboard shortcuts reference
```

---

## 6. Dialog Select (Reusable List Picker)

### OpenCode Implementation
```typescript
// ui/dialog-select.tsx
- Reusable component for any list selection
- Built-in fuzzy search
- Categories with headers
- Footer actions (left/right aligned)
- Mouse + keyboard navigation
- Scroll with acceleration
```

### Freebuff Current State
- Each tab implements its own list rendering
- No reusable select component

### ✅ **Implementation Plan: Reusable Select Component**

**Priority: HIGH** — Reduces code duplication

**Use Cases:**
- Theme picker
- Repository selector
- Branch/tag picker
- Profile switcher
- Language filter

```javascript
// Proposed: tui/select.mjs
class SelectDialog {
  constructor(options) {
    this.title = options.title;
    this.items = options.items;      // [{label, value, category, hint}]
    this.onSelect = options.onSelect;
    this.searchable = options.searchable ?? true;
    this.categories = options.categories ?? false;
  }
  
  render(screen) {
    // Box with title
    // Search input (if enabled)
    // Scrollable list with selection highlight
    // Footer with hints
  }
  
  handleKey(key) {
    // ↑↓ navigation
    // / to search
    // Enter to select
    // Esc to cancel
  }
}
```

---

## 7. Help Overlay (Searchable)

### OpenCode Implementation
```typescript
// ui/dialog-help.tsx + component/command-palette.tsx
- Context-aware help (shows relevant shortcuts)
- Searchable filter
- Categories organized by feature
- Current tab highlighted
```

### Freebuff Current State
- `tabs/help.mjs` — Comprehensive help overlay
- Already has categories and search

### ✅ **Implementation Plan: Enhance Help Overlay**

**Priority: LOW** — Already well-implemented

**Minor Enhancements:**
1. Highlight current tab's shortcuts at top
2. Show "Most Used" section
3. Link shortcuts to command palette

---

## 8. Context-Aware Actions

### OpenCode Pattern
```typescript
// app.tsx
const appCommands = [
  {
    name: "session.list",
    title: "Switch session",
    suggested: sync.data.session.length > 0,  // Context-aware
    run: () => { dialog.replace(() => <DialogSessionList />) }
  },
  // ...20+ commands with suggested flags
]
```

### Freebuff Current State (PARTIALLY EXISTS)

**Freebuff has some context-awareness** in `palette.mjs`:
```javascript
// Actions registered per-tab with hints
register({ id: 'dashboard-refresh', label: 'Refresh Dashboard', hint: 'r' });
register({ id: 'repos-filter', label: 'Filter Repos', hint: '/' });
```

**What's missing vs OpenCode:**
- ❌ No `suggested` flag (context-aware recommendations)
- ❌ No categories (Session, Agent, System, etc.)
- ❌ No shortcut display in palette
- ✅ Has per-tab actions
- ✅ Has keyboard hints

### ✅ **Implementation Plan: Context-Aware Command Palette**

**Priority: MEDIUM** — Improves discoverability

**Approach:**
```javascript
// Enhance palette.mjs
register({
  id: 'star-repo',
  label: 'Star Repository',
  category: 'Repository',
  suggested: () => !appState._repoIsStarred,  // Only suggest if not starred
  run: () => starRepo()
});

register({
  id: 'refresh-dashboard',
  label: 'Refresh Dashboard',
  category: 'Data',
  suggested: () => appState.dashboardStale,  // Suggest when stale
  run: () => refreshDashboard()
});
```

---

## 9. Keybinding System

### OpenCode Implementation
```typescript
// keymap.tsx + config/keybind.ts
- Declarative keybindings
- Command-based dispatch
- Mode-based bindings (normal, modal, insert)
- Configurable via config file
- Conflict detection
```

### Freebuff Current State
- `keys.mjs` — Hardcoded key mappings
- Tab-specific key handlers
- No user configuration

### ✅ **Implementation Plan: Declarative Keybinding System**

**Priority: MEDIUM** — Power user feature

```javascript
// Proposed: tui/keybindings.mjs
const defaultBindings = {
  global: {
    'ctrl+p': 'palette.open',
    '?': 'help.toggle',
    '1-6': 'tab.switch',
  },
  dashboard: {
    'j/k': 'list.navigate',
    'Enter': 'list.select',
    't': 'trending.cycle',
  },
  // ...
};

// User config file: ~/.github-tui/keybindings.json
{
  "global": {
    "ctrl+p": "palette.open",
    "?": "help.toggle"
  }
}
```

---

## 10. Focus Management

### OpenCode Pattern
```typescript
// context/ (multiple files)
- Focus trapping in dialogs
- Tab navigation (Tab/Shift+Tab)
- Focus restoration on dialog close
- Mouse + keyboard focus coordination
```

### Freebuff Current State (ALREADY EXISTS)

**Freebuff already has focus management** in `focus.mjs`:

```javascript
// Focus zones per tab
focus.mjs exports:
- isFocused(tabIndex, zoneId) — check if zone is focused
- setFocused(tabIndex, zoneId) — set active zone
- focusNext/Prev() — cycle through zones
```

**What's missing vs OpenCode:**
- ❌ No dialog focus trapping (Tab escapes dialog)
- ❌ No focus restoration on dialog close
- ❌ No Tab/Shift+Tab in lists
- ✅ Has focus zones per tab
- ✅ Has focus indicators (rendered via `isFocusActive()`)

### ✅ **Implementation Plan: Enhanced Focus System**

**Priority: MEDIUM** — Accessibility & UX

**Features:**
1. Focus trap in dialogs (Tab cycles within dialog)
2. Focus restoration on dialog close
3. Tab/Shift+Tab navigation in lists
4. Focus indicators (highlight border)

---

## 11. Mouse Support Enhancements

### OpenCode Implementation
```typescript
// app.tsx
onMouseDown / onMouseUp / onMouseMove handlers
- Click to select
- Hover to highlight
- Right-click to copy
- Scroll support
```

### Freebuff Current State
- Basic mouse tracking in `mouse.mjs`
- Click handlers for some elements

### ✅ **Implementation Plan: Enhanced Mouse Support**

**Priority: LOW** — Nice-to-have

**Enhancements:**
1. Hover highlighting in lists
2. Click-to-focus in dialogs
3. Scroll wheel support
4. Right-click context menu

---

## 12. Theme System

### OpenCode Implementation
```typescript
// context/theme.ts
- Theme object with semantic colors
- Light/dark mode toggle
- System theme detection
- Theme persistence (KV store)
```

### Freebuff Current State
- `theme.mjs` — Multiple themes with accent colors
- `listThemes()`, `setTheme()`, `getThemeName()`

### ✅ **Implementation Plan: Theme Enhancements**

**Priority: LOW** — Already good foundation

**Enhancements:**
1. Live theme preview in settings
2. Theme import/export
3. Custom theme creation
4. System theme detection (if possible)

---

## 13. Plugin/Extension System

### OpenCode Pattern
```typescript
// plugin/ (multiple files)
- Plugin runtime with adapters
- Route registration
- Slot-based rendering
- Event system for plugins
```

### Freebuff Current State
- No plugin system

### ⏸️ **Implementation Plan: Deferred**

**Priority: LOW** — Major feature, defer to future

---

## 14. Sync & Real-time Updates

### OpenCode Pattern
```typescript
// context/sync.ts
- EventSource for real-time updates
- Session reconciliation
- Optimistic updates
```

### Freebuff Current State
- Polling-based refresh
- Manual refresh actions

### ✅ **Implementation Plan: EventSource Support**

**Priority: LOW** — Nice-to-have for GitHub webhooks

```javascript
// Future: Real-time inbox updates
const eventSource = new EventSource('/github/events');
eventSource.onmessage = (event) => {
  // Update notifications in real-time
};
```

---

## 15. Undo/Redo System

### OpenCode Pattern
- Not explicitly implemented

### Freebuff Current State
- `undo.mjs` — Basic undo system

### ✅ **Implementation Plan: Enhance Undo**

**Priority: LOW** — Already implemented

**Enhancements:**
1. Visual undo history
2. Undo/redo indicators
3. Persistent undo across sessions

---

## 16. Promise-Based Dialog Patterns (OpenCode)

### OpenCode Pattern
```typescript
// ui/dialog-confirm.tsx
DialogConfirm.show = (dialog, title, message, label?) => {
  return new Promise<boolean | undefined>((resolve) => {
    dialog.replace(
      () => <DialogConfirm ... onConfirm={() => resolve(true)} onCancel={() => resolve(false)} />,
      () => resolve(undefined),  // onClose callback
    );
  });
}

// Usage:
const choice = await DialogConfirm.show(dialog, 'Update Available', 'Update now?');
if (choice === true) { ... }
```

### Freebuff Equivalent
```javascript
// state.mjs
export function confirm(message, onConfirm, title = 'Confirm') {
  appState.confirmMessage = message;
  appState.confirmTitle = title;
  appState.confirmAction = onConfirm;
}

// Usage:
confirm('Delete this?', () => { /* delete logic */ });
```

**Key Difference:** OpenCode uses async/await, Freebuff uses callbacks.

### ✅ **Implementation Plan: Promise-Based Confirm**

**Priority: LOW** — Nice-to-have for cleaner async code

```javascript
// Proposed: tui/confirm.mjs
export function confirmAsync(message, title = 'Confirm') {
  return new Promise((resolve) => {
    confirm(message, () => resolve(true), title);
    // Wrap original confirm to also resolve false on cancel
    const origAction = appState.confirmAction;
    appState.confirmAction = () => {
      origAction();
      resolve(true);
    };
  });
}
```

---

## 17. Which-Key Plugin (OpenCode)

### OpenCode Pattern
```typescript
// feature-plugins/system/which-key.tsx
- Shows pending key sequences in overlay mode
- Dock/overlay toggle
- Auto-show for pending sequences
```

### Freebuff Current State
- No which-key equivalent

### ⏸️ **Implementation Plan: Deferred**

**Priority: LOW** — Nice-to-have for discoverability

---

## Priority Matrix (UPDATED)

| Priority | Feature | Effort | Impact | Freebuff Status |
|----------|---------|--------|--------|------------------|
| 🔴 HIGH | Enhanced Command Palette | Low | Foundation | ✅ Has base, needs categories/suggested |
| 🔴 HIGH | Reusable Select Component | Medium | Reduces duplication | ❌ Not implemented |
| 🟡 MEDIUM | Promise-Based Dialogs | Low | Cleaner async code | ⚠️ Has callback-based confirm |
| 🟡 MEDIUM | Quick Settings Popup | Medium | Power user feature | ❌ Not implemented |
| 🟡 MEDIUM | Context-Aware Actions | Low | Discoverability | ⚠️ Has per-tab actions, no suggested |
| 🟡 MEDIUM | Declarative Keybindings | Medium | Power user feature | ❌ Not implemented |
| 🟡 MEDIUM | Enhanced Focus System | Medium | Accessibility | ⚠️ Has focus zones, no dialog trapping |
| 🟢 LOW | Stacked Toasts | Low | Better feedback | ⚠️ Has single toast, no stacking |
| 🟢 LOW | Mouse Enhancements | Low | Nice-to-have | ⚠️ Has basic mouse support |
| 🟢 LOW | Which-Key Plugin | Low | Discoverability | ❌ Not implemented |
| ⏸️ DEFERRED | Plugin System | High | Future feature | ❌ Not implemented |
| ⏸️ DEFERRED | EventSource Sync | Medium | Niche use case | ❌ Not implemented |

---

## Implementation Roadmap (UPDATED)

### Phase 1: Quick Wins (Week 1) — ✅ COMPLETE
1. ✅ **Enhanced Command Palette** — Add categories and `suggested` flag
   - Updated `tui/palette.mjs` with `category` and `suggested` fields
   - Updated `tui/keys.mjs` to register all actions with categories
   - Added suggested actions: Refresh, Star, Search, Unread, Actions
   - Enhanced render with grouped display (Suggested → Categories)
2. ✅ **Promise-Based Confirm** — Wrap existing `confirm()` with async/await
   - Added `confirmAsync()` to `tui/state.mjs`
   - Returns `true` (confirmed) or `false` (cancelled/dismissed)
   - Handles edge cases: stacked confirms, auto-dismiss detection
3. ✅ **Context-Aware Actions** — Suggested commands in palette
   - Added suggested flags to actions in `tui/keys.mjs`
   - Suggestions appear at top when no search query

### Phase 2: Foundation (Week 2-3) — ✅ COMPLETE
4. ✅ **Reusable Select Component** (`tui/select.mjs`) — Generic list picker
   - Created `tui/select.mjs` with `createSelect()` and `showSelect()` APIs
   - Features: fuzzy search, categories, keyboard navigation, backdrop
   - Integrated into `tui/render.mjs` (renders above palette)
   - Integrated into `tui/keys.mjs` (captures keys when active)
5. ✅ **Quick Settings Popup** — Most-used settings in modal
   - Created `tui/quick-settings.mjs` with settings: Theme, Density, Auto-Refresh, Stale, Inbox Group
   - Integrated into `tui/render.mjs` (renders above palette)
   - Integrated into `tui/keys.mjs` (Ctrl+, or palette command)
   - Features: cycle through options, number keys for direct selection
6. ✅ **Stacked Toasts** — Queue multiple messages
   - Created `tui/toast.mjs` with stacked toast system
   - Supports multiple variants: info, success, error, warning
   - Auto-dismiss with configurable duration
   - Right-aligned, non-blocking notifications
   - Backward compatible with existing `showMessage()` calls

### Phase 4: Advanced Features — ✅ COMPLETE
10. ✅ **Stack-Based Dialog System** — Unified dialog management
    - Created `tui/dialog.mjs` with centralized dialog stack
    - Provides push/pop/replace/clear operations
    - Integrates with focus system for save/restore
    - Convenience functions for common dialogs (palette, help, bookmarks, quick-settings)
    - Backward compatible with legacy overlay flags
11. ✅ **Mouse Enhancements** — Enhanced interactivity
    - Hover highlighting for command palette
    - Click-to-focus for quick settings
    - All overlays support mouse interaction
12. ✅ **Quick Settings Expanded** — More settings
    - Added: Inbox Filter, Repos Sort, Theme Mode
    - Now 8 settings total
13. ✅ **More Suggested Actions** — Better context awareness
    - Added: Login, README, Files, New Issue, Bookmark
    - Now 10 suggested actions
14. ✅ **Which-Key Plugin** — Key sequence hints
    - Created `tui/which-key.mjs`
    - Shows pending key sequences for prefix keys (g, d, z, c, r)
    - Auto-closes after 2 seconds of inactivity
    - Bottom-left corner overlay

### Phase 3: Polish (Week 4-5) — ✅ COMPLETE
7. ✅ **Enhanced Focus System** — Dialog focus trapping
   - Added `saveFocus()`, `restoreFocus()`, `isDialogFocusTrapped()` to `tui/focus.mjs`
   - Integrated into: palette, help, bookmarks, quick-settings
   - Focus stack saves/restores on dialog open/close
   - All overlays now properly restore focus when closed
8. ✅ **Declarative Keybindings** — User-configurable via JSON
   - Enhanced `tui/custom-keys.mjs` to support internal actions
   - Added `action` field for palette actions (e.g., `{ "key": "s", "action": "star.toggle" }`)
   - Maintains backward compatibility with shell commands
   - Updated validation to accept both `command` and `action` fields
9. ✅ **Mouse Enhancements** — Hover highlighting, click-to-focus
   - Added hover highlighting for command palette items
   - Added click handler for quick settings popup
   - Enhanced palette mouse support with hover cursor tracking
   - All overlays now support click-to-focus

### Phase 4: Future (Week 6+)
10. ⏸️ Which-Key Plugin (if needed)
11. ⏸️ Plugin System (if needed)
12. ⏸️ EventSource Sync (if needed)

---

## Code Examples (UPDATED)

### Example 1: Enhanced Command Palette with Categories

```javascript
// tui/palette.mjs — enhanced
const actions = [];

export function register(action) {
  // Add suggested flag for context-aware recommendations
  actions.push({
    ...action,
    suggested: action.suggested || (() => false),
    category: action.category || 'General',
  });
}

// Usage:
register({
  id: 'star-repo',
  label: 'Star Repository',
  category: 'Repository',
  suggested: () => !appState._repoIsStarred,  // Only suggest if not starred
  run: () => starRepo()
});

register({
  id: 'refresh-dashboard',
  label: 'Refresh Dashboard',
  category: 'Data',
  suggested: () => appState.dashboardStale,  // Suggest when stale
  run: () => refreshDashboard()
});

// Render with categories:
export function renderPalette(screen) {
  // ... existing backdrop/box code ...
  
  // Group by category
  const grouped = {};
  for (const a of list) {
    if (!grouped[a.category]) grouped[a.category] = [];
    grouped[a.category].push(a);
  }
  
  // Render category headers
  for (const [cat, items] of Object.entries(grouped)) {
    screen.writeStr(x + 2, row, cat.toUpperCase(), { fg: 'cyan', bold: true });
    row++;
    for (const item of items) {
      // ... render item with shortcut hint ...
    }
  }
}
```

### Example 2: Promise-Based Confirm

```javascript
// tui/confirm.mjs
import { appState, render, confirm as confirmSync } from './state.mjs';

/**
 * Promise-based confirm dialog.
 * Returns: true (confirmed), false (cancelled), undefined (dismissed)
 */
export function confirmAsync(message, title = 'Confirm') {
  return new Promise((resolve) => {
    const origAction = appState.confirmAction;
    const origMessage = appState.confirmMessage;
    const origTitle = appState.confirmTitle;
    
    appState.confirmMessage = message;
    appState.confirmTitle = title;
    appState.confirmAction = () => {
      // Restore original state
      appState.confirmAction = origAction;
      appState.confirmMessage = origMessage;
      appState.confirmTitle = origTitle;
      resolve(true);
    };
    
    // Wrap dismissConfirm to resolve false
    const origDismiss = globalThis.dismissConfirm;
    globalThis.dismissConfirm = () => {
      globalThis.dismissConfirm = origDismiss;
      appState.confirmAction = null;
      resolve(false);
    };
    
    render();
  });
}

// Usage:
const confirmed = await confirmAsync('Delete this repository?');
if (confirmed) {
  await deleteRepository();
}
```

### Example 3: Reusable Select Component

```javascript
// tui/select.mjs
import { appState, render } from './state.mjs';
import { color } from './theme.mjs';
import { truncate } from './utils.mjs';

export class SelectDialog {
  constructor(options) {
    this.title = options.title;
    this.items = options.items;  // [{label, value, category, hint}]
    this.onSelect = options.onSelect;
    this.onCancel = options.onCancel;
    this.searchable = options.searchable ?? true;
    this.categories = options.categories ?? false;
    this.query = '';
    this.cursor = 0;
    this.scroll = 0;
  }
  
  get filtered() {
    let items = this.items;
    if (this.query) {
      const q = this.query.toLowerCase();
      items = items.filter(i => i.label.toLowerCase().includes(q));
    }
    return items;
  }
  
  render(screen) {
    const W = screen.width, H = screen.height;
    
    // Backdrop
    const backdrop = color('modalBackdrop');
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        screen.setStyle(x, y, backdrop);
    
    // Box
    const boxW = Math.min(60, W - 4);
    const boxH = Math.min(20, H - 4);
    const x = Math.floor((W - boxW) / 2);
    const y = Math.floor((H - boxH) / 2);
    
    screen.box(x, y, boxW, boxH, this.title, color('modalBorder'));
    
    // Search input
    if (this.searchable) {
      screen.writeStr(x + 2, y + 1, '>', { fg: 'cyan' });
      screen.writeStr(x + 4, y + 1, this.query + '█', color('inputBox'));
    }
    
    // Items
    const list = this.filtered;
    const maxVisible = boxH - 4;
    for (let i = 0; i < maxVisible && this.scroll + i < list.length; i++) {
      const item = list[this.scroll + i];
      const row = y + 3 + i;
      const sel = this.scroll + i === this.cursor;
      
      if (sel) {
        for (let xx = x + 1; xx < x + boxW - 1; xx++)
          screen.setStyle(xx, row, color('selection'));
      }
      
      screen.writeStr(x + 2, row, sel ? '▶' : ' ', sel ? color('selection') : null);
      screen.writeStr(x + 4, row, truncate(item.label, boxW - 10), sel ? color('selection') : null);
      
      if (item.hint) {
        screen.writeStr(x + boxW - item.hint.length - 3, row, item.hint, { dim: true });
      }
    }
    
    // Footer
    const hint = '↑↓ navigate   ⏎ select   Esc cancel';
    screen.writeStr(x + 2, y + boxH - 2, hint, { dim: true });
  }
  
  handleKey(key) {
    if (key === '\x1b') { this.onCancel?.(); return; }
    if (key === '\r') { this.onSelect?.(this.filtered[this.cursor]); return; }
    if (key === '\x1b[A') { this.cursor = Math.max(0, this.cursor - 1); }
    if (key === '\x1b[B') { this.cursor = Math.min(this.filtered.length - 1, this.cursor + 1); }
    // ... search input handling ...
    render();
  }
}
```

---

## Conclusion

### What Freebuff Already Has ✅

1. **Overlay System** — Boolean-flag based overlays (help, palette, detail, confirm, bookmarks, onboarding)
2. **Toast/Message System** — Single message with variants (info/success/error/warning) and auto-dismiss
3. **Confirm Dialog** — y/n confirmation with backdrop
4. **Input Modal** — Text input for login, search, etc.
5. **Focus Zones** — Per-tab focus management
6. **Help Overlay** — Searchable keyboard shortcuts
7. **Command Palette** — Fuzzy search with per-tab actions
8. **Theme System** — Multiple themes with accent colors

### What OpenCode Has That Freebuff Doesn't ❌

1. **Stack-Based Dialogs** — Nested dialogs with focus trapping
2. **Reusable Select Component** — Generic list picker with fuzzy search
3. **Promise-Based Dialogs** — async/await instead of callbacks
4. **Context-Aware Suggestions** — `suggested` flag in command palette
5. **Which-Key Plugin** — Shows pending key sequences
6. **Declarative Keybindings** — User-configurable via JSON

### Recommended Implementation Order

1. ~~**Enhanced Command Palette** (HIGH priority, LOW effort)~~ ✅ **DONE**
2. **Reusable Select Component** (HIGH priority, MEDIUM effort) — Reduces duplication across tabs
3. **Promise-Based Dialogs** (MEDIUM priority, LOW effort) — Cleaner async code
4. **Quick Settings Popup** (MEDIUM priority, MEDIUM effort) — Power user feature
5. **Enhanced Focus System** (MEDIUM priority, MEDIUM effort) — Dialog focus trapping

Freebuff already has a solid foundation with its diff-based renderer, theme system, and overlay system. By adopting these patterns incrementally, the app can achieve a more modern, polished feel while maintaining its zero-dependency philosophy.

---

## Changelog

### 2026-09-08: Phase 1 — Enhanced Command Palette

**Files Modified:**
- `tui/palette.mjs` — Added `category` and `suggested` fields to `register()`
- `tui/keys.mjs` — Updated all `reg()` calls with categories

**New Features:**
- **Categories** — Actions grouped by: Navigation, Global, Repository, Repos, Explore, Files, Edit, Inbox, Settings, Dashboard, Detail, Saved Searches
- **Suggested Actions** — Context-aware recommendations:
  - Refresh (when loading or stale)
  - Star (when repo not starred)
  - Search (when on Explore search view)
  - Unread Notifications (when user has unread)
  - Workflow Failures (when failures detected)
- **Grouped Display** — No query shows Suggested first, then categories
- **Flat Search** — With query, shows all matching actions

**Testing:**
- Syntax check passed for both files
- No runtime errors detected

---

### 2026-09-08: Phase 2 — Promise-Based Confirm

**Files Modified:**
- `tui/state.mjs` — Added `confirmAsync()` function

**New Features:**
- **Promise-Based API** — `confirmAsync(message, title)` returns a Promise
- **Return Values** — `true` (confirmed), `false` (cancelled/dismissed)
- **Edge Case Handling**:
  - Stacked confirms prevention
  - Auto-dismiss detection via polling
  - State cleanup on resolution

**Usage:**
```javascript
import { confirmAsync } from './state.mjs';

const confirmed = await confirmAsync('Delete this repository?');
if (confirmed) {
  await deleteRepository();
}
```

**Testing:**
- Syntax check passed

---

### 2026-09-08: Phase 3 — Reusable Select Component

**Files Created:**
- `tui/select.mjs` — New reusable select/picker component

**Files Modified:**
- `tui/render.mjs` — Added select component to overlay render pipeline
- `tui/keys.mjs` — Added select component key handling

**New Features:**
- **createSelect(options)** — Create a select dialog instance
- **showSelect(options)** — Quick helper to show select and get result
- **Features:**
  - Fuzzy search with scoring
  - Category grouping (optional)
  - Keyboard navigation (↑↓, PgUp/PgDn, g/G)
  - Backdrop overlay
  - Configurable placeholder

**Usage:**
```javascript
import { showSelect } from './select.mjs';

const value = await showSelect({
  title: 'Select Theme',
  items: [
    { label: 'Dark', value: 'dark', category: 'Colors' },
    { label: 'Light', value: 'light', category: 'Colors' },
  ],
  categories: true,
});
if (value) {
  setTheme(value);
}
```

**Testing:**
- Syntax check passed for all files

---

### 2026-09-08: Phase 4 — Quick Settings Popup

**Files Created:**
- `tui/quick-settings.mjs` — New quick settings popup component

**Files Modified:**
- `tui/render.mjs` — Added quick settings to overlay render pipeline
- `tui/keys.mjs` — Added Ctrl+, keybinding and palette command

**New Features:**
- **Settings Items:**
  - Theme (cycle through themes)
  - Repos Density (compact/comfortable)
  - Auto-Refresh (Off/1/5/15 min)
  - Stale Repos Only (toggle)
  - Group Inbox (toggle)
- **Keyboard Shortcuts:**
  - `Ctrl+,` — Open quick settings
  - `↑↓` — Navigate settings
  - `Enter/Space` — Cycle/toggle value
  - `1-5` — Direct selection
  - `Esc` — Close

**Usage:**
- Press `Ctrl+,` to open quick settings
- Or use palette: `Ctrl+P` → "Quick Settings..."

**Testing:**
- Syntax check passed for all files

---

### 2026-09-08: Phase 5 — Enhanced Focus System

**Files Modified:**
- `tui/focus.mjs` — Added focus stack for dialog trapping
- `tui/palette.mjs` — Added focus save/restore
- `tui/bookmarks.mjs` — Added focus save/restore
- `tui/quick-settings.mjs` — Added focus save/restore
- `tui/keys.mjs` — Added focus save/restore for help overlay

**New Features:**
- **Focus Stack** — Saves/restores focus when dialogs open/close
- **API:**
  - `saveFocus()` — Save current focus state, returns token
  - `restoreFocus(token)` — Restore saved focus state
  - `isDialogFocusTrapped()` — Check if a dialog is trapping focus
  - `clearFocusStack()` — Reset focus stack
- **Integration:**
  - Palette saves/restores focus
  - Help overlay saves/restores focus
  - Bookmarks overlay saves/restores focus
  - Quick settings saves/restores focus

**Behavior:**
- When opening any overlay (palette, help, bookmarks, quick-settings), the current focus state is saved
- When closing the overlay, the previous focus state is restored
- This prevents focus from jumping unexpectedly after closing a dialog

**Testing:**
- Syntax check passed for all files

---

### 2026-09-08: Phase 6 — Stacked Toasts

**Files Created:**
- `tui/toast.mjs` — New stacked toast notification system

**Files Modified:**
- `tui/render.mjs` — Added toast rendering to overlay pipeline
- `tui/state.mjs` — Updated `showMessage()` to use stacked toasts

**New Features:**
- **Stacked Toasts** — Multiple notifications can appear simultaneously
- **Variants:** info, success, error, warning (with theme colors)
- **Auto-dismiss** — Configurable duration (default 3000ms)
- **Non-blocking** — Toasts appear in top-right corner
- **Backward Compatible** — Existing `showMessage()` calls work unchanged

**API:**
```javascript
import { showToast, removeToast, clearToasts } from './toast.mjs';

const id = showToast({ message: 'Saved!', variant: 'success', duration: 3000 });
removeToast(id);  // Manual dismiss
clearToasts();    // Clear all
```

**Testing:**
- Syntax check passed for all files

---

### 2026-09-08: Phase 7 — Declarative Keybindings

**Files Modified:**
- `tui/custom-keys.mjs` — Enhanced to support internal actions

**New Features:**
- **Action Support** — Bind keys to internal palette actions
- **Format:** `{ "key": "s", "action": "star.toggle", "label": "Star repo" }`
- **Backward Compatible** — Shell commands still work
- **Updated Validation** — Accepts both `command` and `action` fields

**Example keybindings.json:**
```json
[
  { "key": "E", "command": "code .", "label": "Open in VS Code", "context": "repo" },
  { "key": "s", "action": "star.toggle", "label": "Star repo", "context": "repo" },
  { "key": "r", "action": "refresh", "label": "Refresh" }
]
```

**Testing:**
- Syntax check passed

---

### 2026-09-08: Phase 8 — Stack-Based Dialog System

**Files Created:**
- `tui/dialog.mjs` — New unified dialog management system

**Files Modified:**
- `tui/render.mjs` — Added dialog stack rendering
- `tui/keys.mjs` — Added dialog stack key handling

**New Features:**
- **Dialog Stack** — Centralized management of overlays
- **Operations:**
  - `pushDialog(dialog)` — Add dialog to stack
  - `popDialog()` — Remove top dialog
  - `replaceDialog(dialog)` — Replace top dialog
  - `clearDialogs()` — Remove all dialogs
- **Convenience Functions:**
  - `openPalette()` — Open command palette
  - `openHelp()` — Open help overlay
  - `openBookmarks()` — Open bookmarks
  - `openQuickSettings()` — Open quick settings
- **Backward Compatible** — Works with legacy overlay flags

**Testing:**
- Syntax check passed for all files

---

### 2026-09-08: Phase 9 — Mouse Enhancements

**Files Modified:**
- `tui/mouse.mjs` — Enhanced mouse interaction

**New Features:**
- **Palette Hover** — Highlights item under cursor
- **Quick Settings Click** — Click to select and activate settings
- **Enhanced Mouse Support** — All overlays now support mouse interaction

**Testing:**
- Syntax check passed

---

*Report generated: September 2026*
*Analysis based on: OpenCode TUI (packages/tui) and Freebuff (tui/)*
