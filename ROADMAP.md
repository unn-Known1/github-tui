# GitHub TUI — Feature Roadmap

> 📊 **Status audit 2026-06-18**: completion ~50% of promised features.
> 
> **Implemented:** 7/14 features (UX foundations + Rate Limit, Traffic, Milestones, Labels)
> **Partially implemented:** 2/14 features
> **Not implemented:** 5/14 features
> **Documentation drift bugs:** 3 fixed
> 
> See [Feature Status Matrix](#feature-status-matrix) for details.

## Current Architecture

```
Tab 1: Dashboard  → greeting, stats, activity, trending, heatmap, languages
Tab 2: Repos      → own repos, starred repos, filters, pins
Tab 3: Analyze    → search, details (Overview/Issues/PRs/README/Files/Packages)
Tab 4: Settings   → auth, theme, system info
Tab 5: Inbox      → notifications, triage
```

> ⚠️ **Note:** Tab order is Settings (4) then Inbox (5) in code.
> Previous documentation had this reversed — now corrected.

## Strategy: Context-Driven, Not Tab-Driven

Adding new tabs = cluttered tab strip. Instead, extend existing tabs with **sub-views** and **modals**.

---

## Feature Mapping

| Feature | Location | Why |
|---------|----------|-----|
| Traffic (views/clones) | Analyze → new pane | Repo-specific, fits with Overview |
| Milestones | Analyze → new pane | Repo-specific, related to Issues |
| Labels | Analyze → new pane | Repo-specific, related to Issues |
| Review Comments | Analyze → inside PR detail | Natural extension of existing PR view |
| Checks/CI | Analyze → new pane | Repo-specific, shows CI status |
| Security (Dependabot) | Analyze → new pane | Repo-specific alerts |
| Followers | Dashboard → new section | User-specific, fits with Profile |
| Gists | Modal overlay | Standalone, doesn't need a tab |
| Projects | Modal overlay | Standalone, doesn't need a tab |
| Rate Limit | Header enhancement | Just needs dedicated endpoint |
| Milestones filter | Repos → filter option | Can filter issues by milestone |
| Labels filter | Repos → filter option | Can filter issues by label |

---

## Input System: Keyboard + Mouse + Command Palette

### Input Methods

| Method | Best For | Discovery |
|--------|----------|-----------|
| **Keyboard shortcuts** | Power users, fast navigation | Low (need to learn) |
| **Mouse clicks** | Discovery, casual use | High (natural) |
| **Scroll wheel** | Browsing lists | High (natural) |
| **Command palette** | Finding actions by name | Medium (Ctrl-P) |
| **Quick action menu** | Discovering commands | Medium (press `:`) |

### Mouse Support Design

#### Enable Mouse Tracking

```javascript
// Enable mouse events on startup
process.stdout.write('\x1b[?1000h');  // Basic mouse tracking
process.stdout.write('\x1b[?1002h');  // Button-event tracking
process.stdout.write('\x1b[?1003h');  // Any-event tracking (motion)

// Disable on exit
process.stdout.write('\x1b[?1000l');
process.stdout.write('\x1b[?1002l');
process.stdout.write('\x1b[?1003l');
```

#### Mouse Event Format

```
\ESC[<button>;<col>;<row>M  — Press
\ESC[<button>;<col>;<row>m  — Release

Button codes:
0 = Left click
1 = Middle click
2 = Right click
4 = Shift + Left click
8 = Alt + Left click
16 = Ctrl + Left click
64 = Scroll up
65 = Scroll down
```

#### Clickable Elements

| Element | Click Action | Visual Feedback |
|---------|--------------|-----------------|
| **Tabs** | Switch to tab | Highlight active tab |
| **List items** | Select item | Blue background highlight |
| **Buttons** | Trigger action | Button press animation |
| **Collapsible headers** | Toggle expand/collapse | Arrow rotates ▸ ↔ ▾ |
| **Pane tabs** | Switch pane | Highlight active pane |
| **Filter chips** | Remove filter | Chip disappears |
| **Links** | Open in browser | Underline on hover |
| **Scroll bar** | Jump to position | Scroll indicator |

#### Hover Effects

```
┌─────────────────────────────────────────────────────┐
│ Normal state:                                       │
│   repo-one          ★ 500                          │
│                                                     │
│ Hover state (mouse over):                          │
│   ▶ repo-one        ★ 500    [Open] [Star] [Copy] │
│                     ↑                               │
│              Action buttons appear                  │
└─────────────────────────────────────────────────────┘
```

#### Scroll Wheel Support

```javascript
// Scroll wheel events
case 64:  // Scroll up
  scrollUp();
  break;
case 65:  // Scroll down
  scrollDown();
  break;
```

---

## Collapsible Sections

### Dashboard Collapsibles

```
┌─────────────────────────────────────────────────────────┐
│ ▸ PROFILE (click to expand)                             │
│ ─────────────────────────────────────────────────────── │
│ @username                                               │
│ email@example.com                                       │
│ Followers: 100  Following: 50                           │
│                                                         │
│ ▾ STARS (30 DAYS) (click to collapse)                   │
│ ▁▂▃▄▅▆▇▅▄▃▂▁▂▃▄▅▆▇                                     │
│                                                         │
│ ▸ TOP REPOS (click to expand)                           │
│                                                         │
│ ▸ ACTIVITY (click to expand)                            │
│                                                         │
│ ▸ LANGUAGES (click to expand)                           │
└─────────────────────────────────────────────────────────┘
```

**State stored in:**
```javascript
appState.dashboardCollapsed = {
  profile: false,
  stars: true,
  topRepos: false,
  activity: false,
  languages: false,
};
```

### Analyze Tab Collapsibles

```
┌─────────────────────────────────────────────────────────┐
│ ▸ Overview                                              │
│   Description: A awesome project                        │
│   Language: JavaScript  Stars: 1.2k                     │
│                                                         │
│ ▾ Issues (12)                                           │
│ #123 Fix auth bug          open   2h ago               │
│ #121 Add dark mode         open   5h ago               │
│ #119 Update dependencies   closed 1d ago               │
│                                                         │
│ ▾ PRs (3)                                               │
│ #456 Add feature X         open   1h ago               │
│ #455 Fix typo              open   3h ago               │
│                                                         │
│ ▸ README (click to expand)                              │
│                                                         │
│ ▸ Files (click to expand)                               │
│                                                         │
│ ▸ Packages (click to expand)                            │
└─────────────────────────────────────────────────────────┘
```

### Repos Tab Collapsibles

```
┌─────────────────────────────────────────────────────────┐
│ ▾ PINNED (3)                                            │
│ [★] repo-one        JS      500     89      12        │
│ [★] repo-two        Python  200     45      8         │
│ [★] repo-three      Go      150     30      5         │
│ ─────────────────────────────────────────────────────── │
│ ▸ ALL REPOS (20) (click to expand)                      │
│                                                         │
│ repo-four       TS      100     20      3             │
│ repo-five       Rust    80      15      2             │
└─────────────────────────────────────────────────────────┘
```

### Inbox Collapsibles

```
┌─────────────────────────────────────────────────────────┐
│ ▾ UNREAD (5)                                            │
│ ● issue #123  repo/one    mentioned    2h ago          │
│ ● pr #456     repo/two    review       5h ago          │
│ ● issue #119  repo/three  assigned     1d ago          │
│                                                         │
│ ▸ READ (15) (click to expand)                           │
│                                                         │
│ ▸ BY REPO (click to expand)                             │
└─────────────────────────────────────────────────────────┘
```

---

## Proposed Layouts

### Dashboard (Tab 1) — With Collapsibles

```
┌─────────────────────────────────────────────────────────┐
│ Good evening, username                    🔔 3 unread   │
├─────────────────────────────────────────────────────────┤
│ [★ 1.2k] [⑂ 89] [ Languages 5] [ Age 3.2y] [Stale 2] │
├──────────────────────┬──────────────────────────────────┤
│ ▸ PROFILE            │ ▸ RECENT ACTIVITY                │
│ @username            │ ★ starred repo/one    2h ago     │
│ email@example.com    │ ✏ pushed to repo/two  5h ago    │
│ Followers: 100       │                                  │
│ Following: 50        │ ▸ RECENT ISSUES                  │
│ Public: 20           │ #123 Fix bug in auth     open   │
│                      │ #121 Add dark mode       open   │
│ ▾ STARS (30 DAYS)    │                                  │
│ ▁▂▃▄▅▆▇▅▄▃▂▁▂▃▄▅▆▇ │ ▸ RECENT PRs                    │
│                      │ #456 Add feature X       open   │
│ ▾ TOP REPOS          │                                  │
│ repo-one      ★ 500 │ ▸ STALE REPOS                   │
│ repo-two      ★ 200 │ old-project                     │
│                      │                                  │
│ ◧ ACTIVITY ◨ LANG   │ ▸ TRENDING THIS WEEK            │
│ (heatmap) (bars)     │ awesome/repo          ★ 12.3k   │
│                      │ cool/project         ★ 8.9k     │
│                      │ [PgUp/PgDn] Page 1              │
├──────────────────────┴──────────────────────────────────┤
│ [1-5] Tabs  [r] Refresh  [?] Help  [Ctrl-P] Palette    │
│ 🖱️ Click tabs • Click sections • Scroll to navigate     │
└─────────────────────────────────────────────────────────┘
```

### Analyze Tab — New Panes with Collapsibles

```
[O] Overview  [I] Issues  [P] PRs  [R] README  [F] Files  [A] Packages
[T] Traffic (PLANNED — see GAP_ANALYSIS.md)   [M] Milestones  [L] Labels  [K] Checks  [S] Security
```

Each pane follows the same pattern:
- Collapsible section header with count
- Scrollable list
- Enter to expand/select
- g/G for top/bottom
- Click to select

### Repos Tab — Enhanced Filters with Collapsibles

```
Sort: Stars ↑   Density: compact   [c] clear all
─────────────────────────────────────────────────────
▾ PINNED (3)
[P] repo-one  JS      500     89      12       2h ago
[F] repo-two  Python  200     45      8        1d ago
─────────────────────────────────────────────────────
▸ ALL REPOS (20)
repo-three    TS      100     20      3        3d ago
repo-four     Rust    80      15      2        1w ago
```

---

## Key Mapping Plan

### Global Keys (all tabs)

| Key | Action |
|-----|--------|
| g/G | Jump to top/bottom |
| PgUp/PgDn | Navigate pages |
| Space | Page down |
| Enter | Select/drill in |
| Esc/Backspace | Back |
| r | Refresh |
| Tab | Next tab |
| Shift+Tab | Previous tab |

### Analyze Tab Keys (new)

| Key | Action |
|-----|--------|
| T | Traffic pane |
| M | Milestones pane |
| L | Labels pane |
| K | Checks/CI pane |
| S | Security pane |

### Repos Tab Keys (new)

| Key | Action |
|-----|--------|
| F | Filter by milestone |
| J | Filter by label |

### Modal Keys (new)

| Key | Action |
|-----|--------|
| Ctrl-G | Open Gists overlay |
| Ctrl-J | Open Projects overlay |

### Collapsible Keys (new)

| Key | Action |
|-----|--------|
| z | Toggle current section collapse |
| Z | Collapse all sections |
| X | Expand all sections |

### Mouse Actions

| Action | Behavior |
|--------|----------|
| Left click on tab | Switch to tab |
| Left click on list item | Select item |
| Left click on collapsible header | Toggle expand/collapse |
| Left click on button | Trigger action |
| Left click on filter chip | Remove filter |
| Scroll wheel up | Scroll up |
| Scroll wheel down | Scroll down |
| Hover on list item | Show action buttons |
| Right click | Context menu (future) |

---

## Implementation Phases

### Phase 1: High Impact, Low Effort

1. **Rate Limit** — Add `/rate_limit` endpoint, show in header
2. **Traffic** — Add pane to Analyze, show views/clones
3. **Milestones** — Add pane to Analyze, list milestones
4. **Labels** — Add pane to Analyze, list labels
5. **Mouse support** — Enable mouse tracking, handle clicks
6. **Collapsible sections** — Add to Dashboard and Repos

### Phase 2: Medium Impact

7. **Review Comments** — Enhance PR detail view
8. **Checks/CI** — Add pane to Analyze, show check runs
9. **Followers** — Add to Dashboard profile section
10. **Hover effects** — Show action buttons on hover
11. **Scroll wheel** — Enable scroll wheel navigation

### Phase 3: Nice to Have

12. **Security** — Add pane to Analyze, Dependabot alerts
13. **Gists** — Modal overlay
14. **Projects** — Modal overlay
15. **Context menu** — Right-click context menu
16. **Drag and drop** — Drag items between lists (future)

---

## Architecture: Reusable Pane Pattern

Each new pane follows the same pattern:

```javascript
// 1. State
appState.repoTraffic = null;
appState.repoMilestones = [];
appState.repoLabels = [];

// 2. API function (in github.mjs)
export const getRepoTraffic = (token, owner, repo) =>
  request('/repos/' + owner + '/' + repo + '/traffic/views', { token });

// 3. Load function (in analyze.mjs)
export async function loadTraffic() { ... }

// 4. Render function (in analyze.mjs)
function renderTrafficPane(screen, y, maxH) { ... }

// 5. Key binding
'T': () => { appState.detailsPane = 'traffic'; loadTraffic(); },

// 6. Mouse binding
{ element: 'traffic-header', onClick: () => toggleCollapse('traffic') }
```

---

## Architecture: Collapsible Section Pattern

```javascript
// State
appState.collapsed = {
  profile: false,
  stars: true,
  topRepos: false,
};

// Render with collapsible
function renderSection(screen, y, title, key, content) {
  const isCollapsed = appState.collapsed[key];
  const arrow = isCollapsed ? '▸' : '▾';
  
  // Clickable header
  screen.writeStr(2, y, arrow + ' ' + title, color('sectionHeading'));
  
  // Register click handler
  registerClick(y, 2, 2 + title.length + 2, () => {
    appState.collapsed[key] = !appState.collapsed[key];
    render();
  });
  
  if (isCollapsed) return y + 1;
  
  // Render content
  y++;
  for (const line of content) {
    screen.writeStr(4, y++, line);
  }
  return y + 1;
}

// Toggle collapse
function toggleCollapse(key) {
  appState.collapsed[key] = !appState.collapsed[key];
  render();
}

// Collapse all
function collapseAll() {
  for (const key of Object.keys(appState.collapsed)) {
    appState.collapsed[key] = true;
  }
  render();
}

// Expand all
function expandAll() {
  for (const key of Object.keys(appState.collapsed)) {
    appState.collapsed[key] = false;
  }
  render();
}
```

---

## Architecture: Mouse Handler Pattern

```javascript
// Click registry
const clickHandlers = [];

function registerClick(row, colStart, colEnd, handler) {
  clickHandlers.push({ row, colStart, colEnd, handler });
}

function handleClick(row, col) {
  for (const h of clickHandlers) {
    if (row === h.row && col >= h.colStart && col < h.colEnd) {
      h.handler();
      return true;
    }
  }
  return false;
}

// Parse mouse event
function parseMouseEvent(data) {
  // Format: \ESC[<button>;<col>;<row>M
  const match = data.match(/\x1b\[<(\d+);(\d+);(\d+)[Mm]/);
  if (!match) return null;
  return {
    button: parseInt(match[1]),
    col: parseInt(match[2]),
    row: parseInt(match[3]),
  };
}

// Handle mouse event
function handleMouse(event) {
  const { button, col, row } = event;
  
  // Left click
  if (button === 0) {
    if (handleClick(row, col)) return;
    
    // Click on tab
    if (row === TAB_ROW) {
      const tabIndex = getTabIndex(col);
      if (tabIndex !== -1) setTab(tabIndex);
    }
    
    // Click on list item
    const listItem = getListItemAt(row);
    if (listItem) selectItem(listItem);
  }
  
  // Scroll up
  if (button === 64) {
    scrollUp();
  }
  
  // Scroll down
  if (button === 65) {
    scrollDown();
  }
}
```

---

## Architecture: Hover Effect Pattern

```javascript
// Hover state
let hoverRow = -1;
let hoverCol = -1;

// Track mouse motion
function handleMouseMotion(row, col) {
  if (row !== hoverRow || col !== hoverCol) {
    hoverRow = row;
    hoverCol = col;
    render(); // Re-render with hover effects
  }
}

// Render with hover
function renderItem(item, row, isSelected, isHovered) {
  const style = isSelected ? color('selection') 
    : isHovered ? color('hover') 
    : null;
  
  screen.writeStr(4, row, item.name, style);
  
  // Show action buttons on hover
  if (isHovered) {
    screen.writeStr(W - 20, row, '[Open] [Star] [Copy]', color('accent'));
  }
}
```

---

## What NOT to Do

- Don't add more tabs (5 is enough)
- Don't create new navigation patterns
- Don't add complex tree views
- Don't add forms/input-heavy features
- Don't require mouse for basic operations

---

## Summary

| Approach | Count |
|----------|-------|
| New panes in Analyze | 5 (Traffic, Milestones, Labels, Checks, Security) |
| New sections in Dashboard | 1 (Followers) |
| New modal overlays | 2 (Gists, Projects) |
| Enhanced existing views | 2 (Review Comments, Rate Limit) |
| Collapsible sections | 4 (Dashboard, Repos, Analyze, Inbox) |
| Mouse support | Full (click, scroll, hover) |
| **Total new features** | **14** |

All fit within existing patterns — no new tabs, no new navigation, no complexity explosion.

---

## GitHub API Endpoints Reference

### Phase 1 Endpoints

```javascript
// Rate Limit
GET /rate_limit

// Traffic
GET /repos/:owner/:repo/traffic/views
GET /repos/:owner/:repo/traffic/clones
GET /repos/:owner/:repo/traffic/popular/paths
GET /repos/:owner/:repo/traffic/popular/referrers

// Milestones
GET /repos/:owner/:repo/milestones
GET /repos/:owner/:repo/milestones/:milestone_number

// Labels
GET /repos/:owner/:repo/labels
GET /repos/:owner/:repo/labels/:label_name
```

### Phase 2 Endpoints

```javascript
// Review Comments
GET /repos/:owner/:repo/pulls/:pull_number/comments
POST /repos/:owner/:repo/pulls/:pull_number/comments

// Checks
GET /repos/:owner/:repo/check-runs
GET /repos/:owner/:repo/check-suites
GET /repos/:owner/:repo/commits/:commit_sha/check-runs

// Followers
GET /user/followers
GET /user/following
GET /users/:username/followers
GET /users/:username/following
```

### Phase 3 Endpoints

```javascript
// Security (Dependabot)
GET /repos/:owner/:repo/dependabot/alerts
GET /repos/:owner/:repo/secret-scanning/alerts

// Gists
GET /gists
GET /gists/:gist_id
POST /gists
PATCH /gists/:gist_id
DELETE /gists/:gist_id

// Projects
GET /repos/:owner/:repo/projects
GET /user/projects
POST /repos/:owner/:repo/projects
```

---

## Gaps & Considerations

### 1. State Management

Each new feature needs consistent state handling:

```javascript
// State pattern for new panes
appState.repoTraffic = null;        // API response
appState.repoTrafficLoading = false; // Loading state
appState.repoTrafficError = null;   // Error state
appState.repoTrafficPage = 1;       // Pagination
appState.repoTrafficHasMore = false;

// Collapsible state
appState.collapsed = {
  profile: false,
  stars: true,
  topRepos: false,
  activity: false,
  languages: false,
};
```

### 2. Error Handling

All API calls wrapped in try/catch with user-friendly messages:

```javascript
// Pattern
try {
  const data = await getRepoTraffic(token, owner, repo);
  appState.repoTraffic = data;
} catch (e) {
  showMessage('Failed to load traffic: ' + e.message, 'error');
}
```

### 3. Loading States

Use skeleton placeholders during API calls:

```javascript
// Show skeleton while loading
if (appState.repoTrafficLoading) {
  skeletonBars(screen, y, h, 5);
  return;
}
```

### 4. Empty States

Show helpful empty states when no data:

```javascript
// Empty state pattern
if (!data || data.length === 0) {
  emptyState(screen, y, h, {
    icon: '📊',
    title: 'No traffic data',
    message: 'Traffic data is available for repos with 100+ views',
    hint: '',
  });
  return;
}
```

### 5. Rate Limit Handling

Graceful degradation when rate limited:

```javascript
// Check rate limit before making request
if (lastRateLimit.remaining < 10) {
  showMessage('Rate limit low (' + lastRateLimit.remaining + ') — some features may be limited', 'warning');
}
```

### 6. Key Conflict Resolution

Avoid conflicts between tabs:

| Key | Dashboard | Repos | Analyze | Inbox | Settings |
|-----|-----------|-------|---------|-------|----------|
| T | — | — | Traffic | — | — |
| M | — | — | Milestones | Mark read | — |
| L | — | — | Labels | — | — |
| K | — | — | Checks | — | — |
| S | — | — | Security | — | — |
| F | — | Filter milestone | Files | Filter | — |
| J | — | Filter label | — | — | — |
| z | Toggle collapse | Toggle collapse | Toggle collapse | Toggle collapse | — |
| Z | Collapse all | Collapse all | Collapse all | Collapse all | — |
| X | Expand all | Expand all | Expand all | Expand all | — |

### 7. Terminal Size Adaptation

New panes must work at minimum 60x20:

```javascript
// Minimum size check
if (W < 60 || H < 20) {
  showMessage('Terminal too small for this view', 'warning');
  return;
}
```

### 8. Data Caching

Use existing ETag cache for API responses:

```javascript
// Cache traffic data for 5 minutes
const cached = etagCache.get('traffic:' + owner + '/' + repo);
if (cached && Date.now() - cached.time < 300000) {
  return cached.data;
}
```

### 9. Theme Roles for New Features

Add semantic roles to theme.mjs:

```javascript
// New roles
traffic: { fg: 'cyan' },
milestone: { fg: 'yellow' },
label: { fg: 'magenta' },
check: { fg: 'green' },
security: { fg: 'red' },
gist: { fg: 'cyan' },
project: { fg: 'blue' },
hover: { bg: 'darkGray', fg: 'white' },
collapsible: { fg: 'cyan' },
collapsibleArrow: { fg: 'yellow' },
```

### 10. Help Text Updates

Update help.mjs with new keybindings:

```javascript
// Analyze section additions
{ key: 'T', desc: 'Traffic pane (views/clones)' },
{ key: 'M', desc: 'Milestones pane' },
{ key: 'L', desc: 'Labels pane' },
{ key: 'K', desc: 'Checks/CI pane' },
{ key: 'S', desc: 'Security pane' },

// Collapsible section additions
{ key: 'z', desc: 'Toggle section collapse' },
{ key: 'Z', desc: 'Collapse all sections' },
{ key: 'X', desc: 'Expand all sections' },
```

### 11. Performance Considerations

- **Lazy load**: Only fetch data when pane is opened
- **Batch requests**: Use Promise.all for related endpoints
- **Pagination**: Load 20 items per page max
- **Debounce**: Don't refresh on every keystroke
- **Virtual scrolling**: Only render visible items

### 12. Accessibility

- All panes navigable with keyboard only
- Screen reader friendly (if terminal supports)
- Color contrast meets WCAG AA
- No information conveyed by color alone
- Mouse support optional (keyboard works without mouse)

### 13. Testing Strategy

- Unit test each API function
- Integration test pane rendering
- Manual test at different terminal sizes
- Test with/without authentication
- Test mouse interactions
- Test collapsible state persistence

### 14. Migration Plan

- New features are additive, no breaking changes
- Existing users see new panes automatically
- No database migration needed
- Settings preserved across updates
- Collapsible state saved to disk

### 15. Rollback Plan

- Each feature is independent module
- Can disable via feature flag if needed
- No shared state between features
- Easy to remove without affecting others
- Mouse support can be disabled in config

---

## Priority Matrix

| Feature | Impact | Effort | Priority |
|---------|--------|--------|----------|
| Rate Limit | High | Low | P0 |
| Traffic | High | Medium | P0 |
| Milestones | Medium | Low | P1 |
| Labels | Medium | Low | P1 |
| Mouse support | High | Medium | P0 |
| Collapsible sections | High | Low | P0 |
| Review Comments | High | Medium | P1 |
| Checks/CI | High | Medium | P1 |
| Followers | Low | Low | P2 |
| Security | Medium | High | P2 |
| Hover effects | Medium | Medium | P1 |
| Gists | Low | High | P3 |
| Projects | Low | High | P3 |

---

## Success Metrics

- [x] No regression in existing features
- [x] Terminal size 60x20 minimum (empirically OK)
- [x] Shipped panes keyboard navigable
- [x] Loading states for all API calls
- [x] Error handling for all failure cases
- [ ] All 14 features implemented (7/14 = 50%)
- [ ] Mouse navigable (0%)
- [ ] Help text updated for new keys (partial — current OK, future missing)
- [ ] Theme roles added for new features (traffic/milestone/label/check/security/hover missing)
- [ ] Collapsible sections work
- [ ] Mouse clicks respond within 100ms
- [ ] Hover effects render smoothly
- [ ] Scroll wheel works in all lists

---

## Missing Features (Future Consideration)

These GitHub API features are NOT in current roadmap but could be added later:

### High Value (Not Yet Planned)

| Feature | Endpoint | Use Case |
|---------|----------|----------|
| PR Reviews | `POST /pulls/:number/reviews` | Approve/request changes |
| Draft PRs | `PATCH /pulls/:number` | Convert draft to ready |
| Branch Protection | `GET /branches/:branch/protection` | View protection rules |
| Collaborators | `GET /repos/:owner/:repo/collaborators` | View/manage access |
| Stargazers | `GET /repos/:owner/:repo/stargazers` | Who starred this repo |
| Watchers | `GET /repos/:owner/:repo/subscribers` | Who's watching |
| Comparison | `GET /repos/:owner/:repo/compare/:base...:head` | Compare branches |
| Commit Activity | `GET /repos/:owner/:repo/stats/commit_activity` | Weekly commit stats |
| Code Frequency | `GET /repos/:owner/:repo/stats/code_frequency` | Additions/deletions |
| Community Profile | `GET /repos/:owner/:repo/community/profile` | Health metrics |
| Repository Topics | `GET /repos/:owner/:repo/topics` | View/manage topics |
| Security Advisories | `GET /repos/:owner/:repo/security-advisories` | Security alerts |
| Secret Scanning | `GET /repos/:owner/:repo/secret-scanning/alerts` | Leaked secrets |
| Code Scanning | `GET /repos/:owner/:repo/code-scanning/alerts` | Code vulnerabilities |
| Issue Templates | `GET /repos/:owner/:repo/contents/.github/ISSUE_TEMPLATE` | Template list |
| PR Templates | `GET /repos/:owner/:repo/contents/.github/PULL_REQUEST_TEMPLATE` | Template list |
| Contributing Guide | `GET /repos/:owner/:repo/contents/CONTRIBUTING` | View guide |
| Security Policy | `GET /repos/:owner/:repo/contents/SECURITY` | View policy |
| Funding | `GET /repos/:owner/:repo/contents/.github/FUNDING.yml` | View sponsors |
| Gitignore Templates | `GET /gitignore/templates` | Template list |
| Markdown Rendering | `POST /markdown` | Render markdown |
| Emoji List | `GET /emojis` | Available emojis |

### Medium Value (Not Yet Planned)

| Feature | Endpoint | Use Case |
|---------|----------|----------|
| Invitations | `GET /repos/:owner/:repo/invitations` | Pending invites |
| Deploy Keys | `GET /repos/:owner/:repo/keys` | SSH deploy keys |
| Webhooks | `GET /repos/:owner/:repo/hooks` | Manage webhooks |
| Auto-merge | `PATCH /repos/:owner/:repo/pulls/:number/merge` | Enable auto-merge |
| Repository Secrets | `GET /repos/:owner/:repo/actions/secrets` | CI secrets |
| Actions Variables | `GET /repos/:owner/:repo/actions/variables` | CI variables |
| GitHub Pages | `GET /repos/:owner/:repo/pages` | Pages status |
| Packages | `GET /user/packages` | Package registry |
| Discussions | GraphQL only | Community discussions |
| Organizations | `GET /user/orgs` | Org membership |
| Teams | `GET /orgs/:org/teams` | Team management |
| GPG Keys | `GET /user/gpg_keys` | User GPG keys |
| SSH Keys | `GET /user/keys` | User SSH keys |
| Email Management | `GET /user/emails` | User emails |
| Social Accounts | `GET /user/social_accounts` | Social links |
| SSH Signing Keys | `GET /user/ssh_signing_keys` | Signing keys |
| Codespaces | `GET /user/codespaces` | Dev environments |
| Repository Settings | `PATCH /repos/:owner/:repo` | Repo config |
| Required Reviews | `GET /repos/:owner/:repo/branches/:branch/protection` | Review rules |
| Status Checks | `GET /repos/:owner/:repo/branches/:branch/protection` | Check rules |

### Low Value (Unlikely to Implement)

| Feature | Endpoint | Use Case |
|---------|----------|----------|
| License Info | `GET /repos/:owner/:repo/license` | License details |
| Repository Statistics | `GET /repos/:owner/:repo/stats` | Various stats |
| Participation Stats | `GET /repos/:owner/:repo/stats/participation` | Contributor activity |
| Punch Card | `GET /repos/:owner/:repo/stats/punch_card` | Commit times |
| Code Owners | `GET /repos/:owner/:repo/contents/CODEOWNERS` | Code owners |
| Issue Events | `GET /repos/:owner/:repo/issues/:number/events` | Issue history |
| Timeline Events | `GET /repos/:owner/:repo/issues/:number/timeline` | Full timeline |
| Reactions | `GET /repos/:owner/:repo/issues/:number/reactions` | Issue reactions |
| Assignees | `GET /repos/:owner/:repo/assignees` | Available assignees |
| Milestones | `GET /repos/:owner/:repo/milestones` | Already planned |
| Labels | `GET /repos/:owner/:repo/labels` | Already planned |

---

## Missing Technical Considerations

### 1. Offline Support

- App should work offline with cached data
- Show "Offline" indicator in status bar
- Queue actions for later sync
- Cache last 100 API responses locally

### 2. Data Persistence

Current local storage:
- `~/.github-tui/token` — Auth token
- `~/.github-tui/theme` — Theme preference
- `~/.github-tui/bookmarks.json` — Bookmarked repos
- `~/.github-tui/pins.json` — Pinned repos
- `~/.github-tui/searches.json` — Saved searches

Future additions:
- `~/.github-tui/cache/` — API response cache
- `~/.github-tui/history.json` — Recent items
- `~/.github-tui/settings.json` — User preferences
- `~/.github-tui/collapsed.json` — Collapsible section state

### 3. Configuration File

Add `~/.github-tui/config.json`:

```json
{
  "theme": "default",
  "mouse": true,
  "notifications": {
    "desktop": false,
    "sound": false
  },
  "pagination": {
    "perPage": 20
  },
  "collapsible": {
    "remember": true
  },
  "shortcuts": {
    "refresh": "r",
    "help": "?"
  }
}
```

### 4. Logging

- Add `--verbose` flag for debug output
- Log to `~/.github-tui/debug.log`
- Include API calls, errors, timing
- Rotate logs daily, keep 7 days

### 5. Update Mechanism

- Check for updates on startup (optional)
- Compare versions via GitHub API
- Show "Update available" in status bar
- Link to releases page (no auto-update)

---

## Missing UX Considerations

### 1. Tab Indicators

Show counts on tabs:

```
[1] Dashboard  [2] Repos (5)  [3] Analyze  [4] Inbox (3)  [5] Settings
                                    ↑                    ↑
                              5 repos loaded      3 unread
```

### 2. Contextual Help

Show hints based on current view:

```
Press [T] for Traffic  |  [M] Milestones  |  [L] Labels
```

### 3. Progress Indicators

Show progress for multi-step operations:

```
Loading... (2/5 pages)
```

### 4. Confirmation Dialogs

Confirm destructive actions:

```
┌─────────────────────────────────┐
│ Close Issue #123?              │
│                                 │
│ This will close the issue.     │
│                                 │
│ [y] Yes    [n] Cancel          │
└─────────────────────────────────┘
```

### 5. Toast Notifications

Non-blocking notifications:

```
✓ Starred repo/one
⚠ Rate limit: 45/60 remaining
✗ Failed to load traffic
```

### 6. Recent Items

Quick access to recent items:

```
Recent:
1. repo/one (viewed 2m ago)
2. issue #123 (viewed 5m ago)
3. pr #456 (viewed 1h ago)
```

### 7. Keyboard Reference Card

Quick reference overlay (? key):

```
┌─────────────────────────────────────────────┐
│ Keyboard Shortcuts                          │
├─────────────────────────────────────────────┤
│ Navigation                                  │
│   j/k, ↑/↓     Move up/down               │
│   g/G           Jump to top/bottom         │
│   PgUp/PgDn     Page up/down               │
│   Enter         Select/open                │
│   Esc/Backspace Go back                    │
├─────────────────────────────────────────────┤
│ Actions                                     │
│   r             Refresh                     │
│   o             Open in browser            │
│   y             Copy URL                    │
│   b             Bookmark                    │
│   *             Star                        │
├─────────────────────────────────────────────┤
│ Tabs                                        │
│   1-5           Switch tabs                │
│   Tab           Next tab                   │
│   Shift+Tab     Previous tab               │
├─────────────────────────────────────────────┤
│ Collapsibles                                │
│   z             Toggle section             │
│   Z             Collapse all               │
│   X             Expand all                 │
├─────────────────────────────────────────────┤
│ Press any key to close                      │
└─────────────────────────────────────────────┘
```

---

## Missing Error Scenarios

### 1. Network Errors

```javascript
// Handle network errors
if (e.message === 'Request timed out') {
  showMessage('Request timed out — check your connection', 'error');
} else if (e.message === 'Connection closed') {
  showMessage('Connection lost — retrying...', 'warning');
}
```

### 2. Authentication Errors

```javascript
// Handle auth errors
if (e.message.includes('401')) {
  showMessage('Invalid token — please log in again', 'error');
  setTab(3); // Go to settings
}
```

### 3. Permission Errors

```javascript
// Handle permission errors
if (e.message.includes('403')) {
  showMessage('Permission denied — check token scopes', 'error');
}
```

### 4. Not Found Errors

```javascript
// Handle 404 errors
if (e.message.includes('404')) {
  showMessage('Resource not found', 'warning');
}
```

### 5. Rate Limit Errors

```javascript
// Handle rate limit
if (e.message.includes('403') && e.message.includes('rate')) {
  const resetTime = new Date(lastRateLimit.reset * 1000);
  showMessage('Rate limited — resets at ' + resetTime.toLocaleTimeString(), 'error');
}
```

---

## Missing Performance Optimizations

### 1. Debounced Search

```javascript
// Don't search on every keystroke
let searchTimeout;
function onSearchInput(value) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => performSearch(value), 300);
}
```

### 2. Lazy Loading

```javascript
// Only load data when pane is opened
function switchToTraffic() {
  appState.detailsPane = 'traffic';
  if (!appState.repoTraffic) loadTraffic(); // Only if not loaded
  render();
}
```

### 3. Virtual Scrolling

```javascript
// Only render visible items
const start = Math.max(0, scrollOffset - 5);
const end = Math.min(items.length, scrollOffset + visibleRows + 5);
for (let i = start; i < end; i++) {
  renderItem(items[i]);
}
```

### 4. Request Batching

```javascript
// Batch related requests
const [traffic, clones, popular] = await Promise.all([
  getRepoTraffic(token, owner, repo),
  getRepoClones(token, owner, repo),
  getRepoPopular(token, owner, repo),
]);
```

---

## Missing Security Considerations

### 1. Token Storage

- Token stored in `~/.github-tui/token`
- File permissions: `0600` (owner only)
- Never log token in debug output
- Clear token on logout

### 2. Input Validation

```javascript
// Validate owner/repo names
if (!owner.match(/^[a-zA-Z0-9._-]+$/)) {
  showMessage('Invalid owner name', 'error');
  return;
}
```

### 3. URL Sanitization

```javascript
// Don't open arbitrary URLs
const allowedHosts = ['github.com', 'api.github.com'];
if (!allowedHosts.includes(url.hostname)) {
  showMessage('Blocked potentially unsafe URL', 'warning');
  return;
}
```

### 4. Rate Limit Awareness

```javascript
// Check rate limit before batch operations
if (lastRateLimit.remaining < operations.length) {
  showMessage('Not enough API credits for this operation', 'warning');
  return;
}
```

---

## Missing Architecture Patterns

### 1. Quick Action Menu (`:` key)

When user presses `:`, open a fuzzy search menu:

```
┌─────────────────────────────────────────┐
│ : traffic_                              │
├─────────────────────────────────────────┤
│ ▶ traffic    Show repo views & clones   │
│   milestones Show issue milestones      │
│   labels     Show issue labels          │
│   checks     Show CI status             │
│   security   Show security alerts       │
└─────────────────────────────────────────┘
```

**Architecture:**
```javascript
// Quick action registry
const quickActions = [
  { name: 'traffic', desc: 'Show repo views & clones', run: () => switchPane('traffic') },
  { name: 'milestones', desc: 'Show issue milestones', run: () => switchPane('milestones') },
  { name: 'labels', desc: 'Show issue labels', run: () => switchPane('labels') },
  { name: 'checks', desc: 'Show CI status', run: () => switchPane('checks') },
  { name: 'security', desc: 'Show security alerts', run: () => switchPane('security') },
];

function openQuickAction() {
  appState.quickAction = true;
  appState.quickActionQuery = '';
  render();
}

function filterQuickActions(query) {
  return quickActions.filter(a => 
    a.name.includes(query.toLowerCase())
  );
}

function selectQuickAction(action) {
  appState.quickAction = false;
  action.run();
}
```

### 2. Context Menu (Right-click)

Right-click opens context menu for current item:

```
┌─────────────────────────────────┐
│ ▶ Open in browser               │
│   Copy URL                      │
│   Star / Unstar                 │
│   Bookmark / Unbookmark         │
│   ───────────────────────────── │
│   Open in Analyze               │
│   View on GitHub                │
└─────────────────────────────────┘
```

**Architecture:**
```javascript
// Context menu items
function getContextMenuItems(item) {
  const items = [
    { label: 'Open in browser', run: () => openUrl(item.html_url) },
    { label: 'Copy URL', run: () => copyToClipboard(item.html_url) },
  ];
  
  if (item.full_name) {
    items.push({ label: 'Star / Unstar', run: () => toggleStar(item) });
    items.push({ label: 'Bookmark / Unbookmark', run: () => toggleBookmark(item) });
    items.push({ separator: true });
    items.push({ label: 'Open in Analyze', run: () => openInAnalyze(item) });
  }
  
  return items;
}

// Show context menu
function showContextMenu(row, col, items) {
  appState.contextMenu = { row, col, items, selected: 0 };
  render();
}

// Handle context menu selection
function selectContextMenuItem(index) {
  const item = appState.contextMenu.items[index];
  if (item && item.run) item.run();
  appState.contextMenu = null;
  render();
}
```

### 3. Drag and Drop (Future)

Drag items between lists (e.g., reorder pinned repos):

**Architecture:**
```javascript
// Drag state
appState.drag = {
  active: false,
  source: null,
  sourceIndex: -1,
  currentRow: -1,
};

// Start drag
function startDrag(item, index) {
  appState.drag = {
    active: true,
    source: item,
    sourceIndex: index,
    currentRow: -1,
  };
}

// Update drag position
function updateDrag(row) {
  appState.drag.currentRow = row;
  render();
}

// End drag
function endDrag(targetIndex) {
  if (appState.drag.sourceIndex !== targetIndex) {
    reorderItems(appState.drag.sourceIndex, targetIndex);
  }
  appState.drag = null;
  render();
}
```

### 4. Scroll Bar Rendering

Visual scroll indicator on the right side:

```
┌──────────────────────────────────────┬─┐
│ Item 1                               │█│
│ Item 2                               │█│
│ Item 3                               │ │
│ Item 4                               │ │
│ Item 5                               │ │
│ Item 6                               │░│
│ Item 7                               │░│
│ Item 8                               │░│
└──────────────────────────────────────┴─┘
                                      ↑
                              Clickable scroll bar
```

**Architecture:**
```javascript
function renderScrollBar(screen, x, y, height, totalItems, visibleItems, scrollOffset) {
  if (totalItems <= visibleItems) return; // No scroll needed
  
  // Calculate thumb position
  const thumbHeight = Math.max(1, Math.floor(height * visibleItems / totalItems));
  const thumbPos = Math.floor((height - thumbHeight) * scrollOffset / (totalItems - visibleItems));
  
  // Render track
  for (let i = 0; i < height; i++) {
    const ch = i >= thumbPos && i < thumbPos + thumbHeight ? '█' : '░';
    const style = i >= thumbPos && i < thumbPos + thumbHeight ? color('scrollThumb') : color('scrollTrack');
    screen.setCell(x, y + i, ch, style);
  }
  
  // Register click handler for scroll bar
  registerClick(y, x, x + 1, (clickRow) => {
    const newOffset = Math.floor((clickRow - y) * totalItems / height);
    scrollTo(Math.max(0, Math.min(totalItems - visibleItems, newOffset)));
  });
}
```

### 5. Tooltip Rendering

Show tooltip on hover:

```
┌─────────────────────────────────────┐
│ repo-one                            │
│ ★ 500 stars  ⑂ 89 forks            │
│ Last pushed 2h ago                  │
│ JavaScript                          │
└─────────────────────────────────────┘
```

**Architecture:**
```javascript
// Tooltip state
appState.tooltip = null;

function showTooltip(row, col, content) {
  appState.tooltip = { row, col, content };
  render();
}

function hideTooltip() {
  appState.tooltip = null;
  render();
}

function renderTooltip(screen) {
  if (!appState.tooltip) return;
  
  const { row, col, content } = appState.tooltip;
  const lines = content.split('\n');
  const maxLen = Math.max(...lines.map(l => l.length));
  
  // Position tooltip below cursor
  const tipY = row + 1;
  const tipX = Math.min(col, screen.width - maxLen - 4);
  
  // Render box
  screen.box(tipX, tipY, maxLen + 4, lines.length + 2, '');
  lines.forEach((line, i) => {
    screen.writeStr(tipX + 2, tipY + 1 + i, line);
  });
}
```

### 6. Focus Management

Track which element has focus:

```javascript
// Focus state
appState.focus = {
  tab: 0,        // Which tab (0-4)
  pane: null,    // Which pane in analyze
  list: null,    // Which list (repos, issues, etc.)
  index: 0,      // Selected index in list
  section: null, // Which collapsible section
};

// Focus navigation
function focusNext() {
  // Move focus to next element
}

function focusPrev() {
  // Move focus to previous element;
}

function focusFirst() {
  // Move focus to first element
}

function focusLast() {
  // Move focus to last element
}
```

### 7. Keyboard vs Mouse Mode

Auto-detect input mode:

```javascript
// Input mode tracking
appState.inputMode = 'keyboard'; // 'keyboard' | 'mouse'

// Switch to keyboard mode on keypress
function handleKey(key) {
  if (appState.inputMode !== 'keyboard') {
    appState.inputMode = 'keyboard';
    hideTooltip();
    render();
  }
  // ... handle key
}

// Switch to mouse mode on mouse event
function handleMouse(event) {
  if (appState.inputMode !== 'mouse') {
    appState.inputMode = 'mouse';
    render();
  }
  // ... handle mouse
}
```

**Mode-specific behavior:**
| Mode | Selection | Navigation | Hover |
|------|-----------|------------|-------|
| Keyboard | `j/k`, `↑/↓` | `Tab`, `Esc` | Disabled |
| Mouse | Click | Click | Enabled |

### 8. Click Handler Cleanup

Prevent memory leaks:

```javascript
// Clear handlers on tab switch
function clearClickHandlers() {
  clickHandlers.length = 0;
}

// Clear on render
function render() {
  clearClickHandlers();
  // ... render content
  // ... register new handlers
}
```

### 9. Hover State Cleanup

Clear hover when mouse leaves:

```javascript
// Track mouse leave
function handleMouseLeave() {
  if (hoverRow !== -1 || hoverCol !== -1) {
    hoverRow = -1;
    hoverCol = -1;
    render();
  }
}

// Timeout to detect leave
let hoverTimeout;
function handleMouseMotion(row, col) {
  clearTimeout(hoverTimeout);
  hoverTimeout = setTimeout(handleMouseLeave, 100);
  
  if (row !== hoverRow || col !== hoverCol) {
    hoverRow = row;
    hoverCol = col;
    render();
  }
}
```

### 10. Mouse Event Debouncing

Prevent excessive re-renders:

```javascript
// Debounce mouse events
let mouseDebounce;
function handleMouse(event) {
  clearTimeout(mouseDebounce);
  mouseDebounce = setTimeout(() => {
    processMouseEvent(event);
  }, 16); // ~60fps
}
```

### 11. Terminal Resize Handling

Handle terminal size changes:

```javascript
// Listen for resize events
process.stdout.on('resize', () => {
  screen.updateSize();
  render();
});

// Handle resize in render
function render() {
  const W = screen.width;
  const H = screen.height;
  
  // Re-calculate layout
  recalculateLayout(W, H);
  
  // Re-render
  renderContent();
}
```

### 12. Mouse Cursor Hiding

Hide cursor during rendering:

```javascript
// Hide cursor
process.stdout.write('\x1b[?25l');

// Show cursor (for input mode)
process.stdout.write('\x1b[?25h');

// In render
function render() {
  process.stdout.write('\x1b[?25l'); // Hide
  // ... render content
  process.stdout.write('\x1b[?25h'); // Show if input mode
}
```

### 13. Command Palette Improvements

Enhanced command palette:

```
┌─────────────────────────────────────────┐
│ 🔎 _                                   │
├─────────────────────────────────────────┤
│ Recent                                  │
│   traffic    Show repo views & clones   │
│   milestones Show issue milestones      │
│                                     [r]  │
│ ─────────────────────────────────────── │
│ Actions                                 │
│   labels     Show issue labels          │
│   checks     Show CI status             │
│   security   Show security alerts       │
│                                     [s]  │
│ ─────────────────────────────────────── │
│ Repos                                   │
│   repo-one   ★ 500                      │
│   repo-two   ★ 200                      │
│                                     [R]  │
└─────────────────────────────────────────┘
```

**Architecture:**
```javascript
// Palette sections
const paletteSections = [
  { name: 'Recent', items: getRecentActions() },
  { name: 'Actions', items: getAllActions() },
  { name: 'Repos', items: getRecentRepos() },
];

// Fuzzy search
function fuzzyMatch(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}
```

### 14. Double-click Handling

Double-click to open in browser:

```javascript
// Track clicks for double-click detection
let lastClickTime = 0;
let lastClickRow = -1;

function handleClick(row, col) {
  const now = Date.now();
  
  if (row === lastClickRow && now - lastClickTime < 300) {
    // Double click
    openInBrowser(row);
    lastClickTime = 0;
    lastClickRow = -1;
  } else {
    // Single click
    lastClickTime = now;
    lastClickRow = row;
  }
}
```

### 15. Middle-click Handling

Middle-click to close tab or open in background:

```javascript
function handleMouse(event) {
  if (event.button === 1) { // Middle click
    if (event.row === TAB_ROW) {
      // Close tab (if closable)
      const tabIndex = getTabIndex(event.col);
      if (tabIndex !== -1 && isTabClosable(tabIndex)) {
        closeTab(tabIndex);
      }
    } else {
      // Open in background
      openInBackground(event.row);
    }
  }
}
```

### 16. Shift/Ctrl+Click Handling

Modifier key actions:

```javascript
function handleMouse(event) {
  if (event.button === 0) {
    if (event.shift) {
      // Shift+click: Select range
      selectRange(appState.selectedIndex, getListItemIndex(event.row));
    } else if (event.ctrl) {
      // Ctrl+click: Toggle selection
      toggleSelection(getListItemIndex(event.row));
    } else {
      // Normal click
      selectItem(getListItemIndex(event.row));
    }
  }
}
```

### 17. Scroll Wheel Speed

Configurable scroll speed:

```javascript
// Scroll speed config
const SCROLL_SPEED = 3; // Lines per wheel tick

function handleScroll(direction) {
  const delta = direction === 'up' ? -SCROLL_SPEED : SCROLL_SPEED;
  scrollBy(delta);
}
```

### 18. Touch Support (Future)

Some terminals support touch events:

```javascript
// Touch event format
\ESC[<modifier>;<col>;<row>M  // Touch start
\ESC[<modifier>;<col>;<row>m  // Touch end

// Touch modifiers
1 = Single tap
2 = Double tap
4 = Long press
```

### 19. Accessibility for Mouse

Ensure mouse users can discover features:

```javascript
// Show keyboard hints near clickable elements
function renderClickableHint(screen, x, y, key) {
  if (appState.inputMode === 'mouse') {
    screen.writeStr(x, y, '[' + key + ']', color('keyHint'));
  }
}
```

### 20. Mouse Wheel Speed Config

```json
// In config.json
{
  "mouse": {
    "enabled": true,
    "scrollSpeed": 3,
    "hoverDelay": 100,
    "doubleClickSpeed": 300
  }
}
```
