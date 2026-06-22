# GitHub TUI — Corrected Gap Analysis (Verification Pass)

**Date:** 2026-06-22  
**Scope:** Verification of original gap analysis claims against source code  
**Method:** Line-by-line code review of each finding

---

## Corrections Summary

| Original Claim | Original Severity | Corrected Severity | Reason |
|----------------|-------------------|-------------------|--------|
| SIGWINCH race condition | CRITICAL | POLISH | JS is single-threaded; resize timer can't interleave with synchronous render |
| Unhandled promise rejection | CRITICAL | MODERATE | API timeouts prevent permanent stuck state |
| stdin detach handling | CRITICAL | MODERATE | Real gap but only affects SSH/tmux edge cases |
| NO_COLOR inconsistency | CRITICAL | POLISH | Both modules check same env var at load; code works correctly |
| Box-drawing UTF-8 | CRITICAL | MODERATE | Platform check is reasonable heuristic |
| Vi-bindings conflict | CRITICAL | MODERATE | UX inconsistency, not crash/data loss |
| Missing core tests | CRITICAL | MODERATE | Quality gap, not runtime bug |
| Debug logger sync I/O | CRITICAL | MODERATE | Only affects debug mode (opt-in) |
| Command injection via keybindings | CRITICAL | MODERATE | Defense-in-depth; user controls keybindings file |
| Tab key inconsistency | MODERATE | MODERATE | Verified correct |
| Windows URL escaping | MODERATE | POLISH | `windowsVerbatimArguments: true` handles most cases |
| No structured API errors | MODERATE | MODERATE | Verified correct |
| No cross-platform tests | MODERATE | MODERATE | Verified correct |

---

## Verified Findings (Confirmed Accurate)

### 1. Tab Key Behavior Inconsistent Between Dashboard and Other Tabs

**Location:** `tui/keys.mjs:299-304`

**Verified:** On Dashboard, Tab cycles focus zones (stat cards → trending). On all other tabs, Tab switches to next tab. This is a real UX inconsistency.

```javascript
case '\t':
  if (tabState.current === 0) {
    dashboard.cycleDashboardZone();  // Intra-tab focus cycling
  } else {
    setTab((tabState.current + 1) % TABS.length);  // Tab switching
  }
```

**Severity:** MODERATE (confirmed)

---

### 2. Vi-Bindings `h`/`l` Inconsistent

**Location:** `tui/keys.mjs:323-325,372-373`

**Verified:** `j`/`k` work as Vi up/down, but `h` maps to `handleBack()` (not left), and `l` maps to `dashboard.rightCard()` (not right). This hybrid approach is confusing.

```javascript
case '\x1b[A': case 'k': handleUp(); return;
case '\x1b[B': case 'j': handleDown(); return;
case '\x1b[D': case 'h': case '\x7f': handleBack(); return;
// l is at line 373: dashboard.rightCard()
```

**Severity:** MODERATE (confirmed)

---

### 3. No Structured Logging for API Errors

**Location:** `tui/github.mjs:294-299`

**Verified:** API errors are thrown as generic `Error` objects with string messages. No HTTP status code, endpoint, or rate limit context is preserved.

```javascript
let msg = 'GitHub API error: ' + res.statusCode;
try {
  const errBody = JSON.parse(data);
  if (errBody.message) msg += ' - ' + errBody.message;
} catch (e) {}
reject(new Error(msg));
```

**Severity:** MODERATE (confirmed)

---

### 4. ETag Cache Stores Full API Responses on Disk

**Location:** `tui/github.mjs:55-67`

**Verified:** Full API response bodies are serialized to `~/.github-tui/etag-cache.json` in plaintext. This includes potentially sensitive data (private repo details, user info).

```javascript
function saveEtagCache() {
  const entries = [];
  for (const [key, entry] of etagCache) {
    entries.push({ key, etag: entry.etag, body: entry.body, ts: entry.ts, lastAccess: entry.lastAccess });
  }
  writeFileSync(ETAG_CACHE_FILE, JSON.stringify(entries));
}
```

**Severity:** MODERATE (confirmed)

---

### 5. Missing Tests for Core Modules

**Location:** `tests/` directory

**Verified:** Only 4 test files exist: `utils.test.mjs`, `repos-logic.test.mjs`, `theme.test.mjs`, `keychain.test.mjs`. No tests for screen.mjs, render.mjs, keys.mjs, input.mjs, mouse.mjs, state.mjs, or github.mjs.

**Severity:** MODERATE (confirmed)

---

### 6. Debug Logger Uses Synchronous File I/O

**Location:** `app.mjs:29-35`

**Verified:** `appendFileSync` blocks the event loop when debug mode is enabled. Only affects users who set `DEBUG=1` or `GITHUB_TUI_DEBUG=1`.

```javascript
function debug(...args) {
  if (!DEBUG) return;
  try {
    const logPath = join(homedir(), '.github-tui', 'debug.log');
    appendFileSync(logPath, `[${new Date().toISOString()}] ${args.join(' ')}\n`);
  } catch {}
}
```

**Severity:** MODERATE (confirmed — only in debug mode)

---

### 7. Custom Keybindings Use `exec()` with String Command

**Location:** `tui/custom-keys.mjs:78-79`

**Verified:** User-defined keybindings execute shell commands via `exec()` with a string. Placeholder values (`{owner}`, `{repo}`) are substituted without shell escaping. While the keybindings file is user-controlled, this is still a defense-in-depth gap.

```javascript
exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
```

**Severity:** MODERATE (confirmed — user controls the keybinding file)

---

### 8. No `stdin` Error/End Handlers

**Location:** `app.mjs:134-137`

**Verified:** No handlers for `stdin.on('error')` or `stdin.on('end')`. If stdin closes (SSH drop, tmux detach), the app may not shut down cleanly.

```javascript
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', handleKey);
// Missing: process.stdin.on('error', ...); process.stdin.on('end', ...);
```

**Severity:** MODERATE (confirmed — affects SSH/tmux users)

---

### 9. Input Modal Lacks Ctrl+Arrow Word Navigation

**Location:** `tui/input.mjs:60-141`

**Verified:** Supports Left/Right arrows, Home/End, Ctrl-A/E/U/W, but no Ctrl-Left/Right for word-by-word movement.

**Severity:** MODERATE (confirmed)

---

## Downgraded Findings (Original Was Too Severe)

### 1. SIGWINCH Race Condition — NOT A REAL RACE

**Original Claim:** "Resize during async callback corrupts screen buffer"

**Verification:** JavaScript is single-threaded. The resize handler uses a 50ms debounce (`app.mjs:142-146`). The `render()` function is synchronous. Therefore, the resize timer callback cannot interleave with a render operation. The `_init()` call in `updateSize()` will complete before any subsequent render.

**Actual Risk:** If resize fires between `doRender()` filling the buffer and calling `screen.render()`, the buffer would be reset. But this can't happen because both operations are synchronous and complete in the same event loop turn.

**Corrected Severity:** POLISH (the 50ms debounce is sufficient)

---

### 2. NO_COLOR Inconsistency — NOT A REAL BUG

**Original Claim:** "Two independent NO_COLOR checks can diverge"

**Verification:** Both `theme.mjs:338` and `screen.mjs:336` read `process.env.NO_COLOR` at module load time and store the result in `const` variables. Since both are evaluated once at startup and never updated, they will always agree. The code works correctly.

**Actual Risk:** Architectural duplication makes maintenance harder, but no runtime bug.

**Corrected Severity:** POLISH (maintenance hazard, not a bug)

---

### 3. Unhandled Promise Rejection — NOT CRITICAL

**Original Claim:** "Loading state can get stuck forever"

**Verification:** The `unhandledRejection` handler only logs (`app.mjs:220-222`). However, all API requests have a 15-second timeout (`github.mjs:193`). So even if a promise is never caught, the timeout will reject it, and the loading state will eventually clear (or the user can press `r` to refresh).

**Corrected Severity:** MODERATE (loading state may briefly persist, but not permanently)

---

### 4. Box-Drawing Characters — REASONABLE HEURISTIC

**Original Claim:** "Platform check may break on non-UTF-8 POSIX terminals"

**Verification:** The code uses `process.platform === 'win32'` to decide between ASCII and Unicode box-drawing (`screen.mjs:24-27`). While this is a heuristic, it's reasonable:
- Windows terminals historically had poor UTF-8 support
- Modern POSIX terminals almost always support UTF-8
- The `TERM_CAPABILITIES` object (`screen.mjs:341-348`) could be used for finer detection, but the current approach works for 99%+ of users

**Corrected Severity:** MODERATE (edge-case issue)

---

### 5. Windows URL Escaping — MOSTLY CORRECT

**Original Claim:** "URLs with `&` will break the command"

**Verification:** The code uses `windowsVerbatimArguments: true` (`utils.mjs:75`), which tells Node.js to pass arguments directly to Windows without shell interpretation. The `start "" "${cleanUrl}"` pattern with this flag should handle most URLs correctly. The `%22` replacement for double quotes is the main necessary escaping.

**Corrected Severity:** POLISH (edge-case issue)

---

## Revised Severity Distribution

| Severity | Count | Items |
|----------|-------|-------|
| **Critical** | 0 | (none — all original CRITICALs were downgraded) |
| **Moderate** | 10 | Tab inconsistency, Vi-bindings, missing tests, debug I/O, keybinding exec, stdin handlers, input navigation, API error structure, ETag cache security, cross-platform tests |
| **Polish** | 5 | SIGWINCH debounce, NO_COLOR duplication, Windows URL escaping, undo for destructive actions, performance benchmarks |

---

## Top 5 Priorities (Revised)

1. **Add tests for core modules** — screen.mjs, keys.mjs, input.mjs, state.mjs (MODERATE)
2. **Fix Tab key inconsistency** — use different key for intra-tab focus cycling (MODERATE)
3. **Add stdin error/end handlers** — prevent orphaned processes on SSH drop (MODERATE)
4. **Add Ctrl-Left/Right word navigation** in input modal (MODERATE)
5. **Add structured error context** to API errors (MODERATE)

---

*Verification completed 2025-01-15*
