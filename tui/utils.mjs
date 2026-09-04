// Pure helper functions used across the app. No I/O, no state, no terminal.
// Easy to unit-test in isolation.

// Format a Date / ISO string as a short relative time: "3h", "2d", "5w".
export function relTime(iso) {
  if (!iso) return '';
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return `${Math.floor(d)}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d`;
  if (d < 86400 * 365) return `${Math.floor(d / 86400 / 30)}mo`;
  return `${Math.floor(d / 86400 / 365)}y`;
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// Terminal-cell width helpers. JavaScript string length counts UTF-16 code
// units, not the cells a terminal paints. Keep these pure so every pane can
// share the same behavior without depending on the renderer.
//
// The tables below are shared with screen.mjs (imported from here) so
// measuring text (truncate, cursor math) and painting text (writeStr) can
// never disagree — that disagreement is what draws emoji UNDER following
// text. Rules:
//   - East-Asian wide ranges + emoji pictographs → 2 cells.
//   - Common status icons that modern terminals render as emoji
//     (✅ ❌ ⚠️ ⏳ ⭐ ‼ ⁉ ⌚ ⌛ Ⓜ ❓) → 2 cells even without VS16.
//   - A text-presentation symbol followed by U+FE0F (VS16, e.g. ©️ ◉️) →
//     2 cells for the pair; the VS16 itself contributes 0.
export function isCombiningCodePoint(cp) {
  return (cp >= 0x0300 && cp <= 0x036F) ||
    (cp >= 0x1AB0 && cp <= 0x1AFF) ||
    (cp >= 0x1DC0 && cp <= 0x1DFF) ||
    (cp >= 0x20D0 && cp <= 0x20FF) ||
    (cp >= 0xFE20 && cp <= 0xFE2F) || cp === 0x200D ||
    (cp >= 0xFE00 && cp <= 0xFE0F);
}

// Exported (as isWideCodePoint) for screen.mjs — the single source of truth
// for cell widths.
export function isWideCodePoint(cp) {
  return (cp >= 0x1100 && cp <= 0x115F) || cp === 0x2329 || cp === 0x232A ||
    (cp >= 0x203C && cp <= 0x203C) || // ‼
    (cp >= 0x2049 && cp <= 0x2049) || // ⁉
    (cp >= 0x231A && cp <= 0x231B) || // ⌚ ⌛
    (cp >= 0x23E9 && cp <= 0x23EC) || // ⏩ ⏪ ⏫ ⏬
    cp === 0x23F0 || cp === 0x23F3 || // ⏰ ⏳
    cp === 0x24C2 || // Ⓜ
    cp === 0x2705 || cp === 0x274C || // ✅ ❌
    (cp >= 0x2753 && cp <= 0x2755) || // ❓ ❔ ❕
    cp === 0x26A0 || // ⚠
    cp === 0x2B50 || cp === 0x2B55 || // ⭐ ⭕
    (cp >= 0x2E80 && cp <= 0x303E) ||
    (cp >= 0x3040 && cp <= 0x33BF) ||
    (cp >= 0x3400 && cp <= 0x4DBF) ||
    (cp >= 0x4E00 && cp <= 0xA4CF) ||
    (cp >= 0xAC00 && cp <= 0xD7A3) ||
    (cp >= 0xF900 && cp <= 0xFAFF) ||
    (cp >= 0xFE30 && cp <= 0xFE6F) ||
    (cp >= 0xFF01 && cp <= 0xFF60) ||
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||
    (cp >= 0x1F300 && cp <= 0x1FAFF) ||
    (cp >= 0x20000 && cp <= 0x3FFFD);
}

// Text-presentation symbols that switch to emoji (2-cell) presentation when
// followed by U+FE0F. Subset of Unicode Emoji=Yes (text-default) code points.
const VS16_RANGES = [
  [0x00A9, 0x00A9], [0x00AE, 0x00AE], [0x203C, 0x203C], [0x2049, 0x2049],
  [0x2122, 0x2122], [0x231A, 0x231B], [0x23E9, 0x23F3], [0x24C2, 0x24C2],
  [0x25B6, 0x25B6], [0x25C0, 0x25C0], [0x25FB, 0x25FE],
  [0x2600, 0x2604], [0x260E, 0x260E], [0x2611, 0x2611], [0x2614, 0x2615],
  [0x2618, 0x2618], [0x261D, 0x261D], [0x2620, 0x2620], [0x2622, 0x2623],
  [0x2626, 0x2626], [0x262A, 0x262A], [0x262E, 0x262F], [0x2638, 0x263A],
  [0x2640, 0x2640], [0x2642, 0x2642], [0x2648, 0x2653], [0x265F, 0x265F],
  [0x2660, 0x2660], [0x2663, 0x2663], [0x2665, 0x2666], [0x2668, 0x2668],
  [0x267B, 0x267B], [0x267E, 0x267F], [0x2692, 0x2697], [0x2699, 0x2699],
  [0x269B, 0x269C], [0x26A0, 0x26A1], [0x26A7, 0x26A7], [0x26AA, 0x26AB],
  [0x26B0, 0x26B1], [0x26BD, 0x26BE], [0x26C4, 0x26C5], [0x26C8, 0x26C8],
  [0x26CE, 0x26CF], [0x26D1, 0x26D1], [0x26D3, 0x26D4], [0x26E9, 0x26EA],
  [0x26F0, 0x26F5], [0x26F7, 0x26FA], [0x26FD, 0x26FD], [0x2702, 0x2702],
  [0x2705, 0x2705], [0x2708, 0x270D], [0x270F, 0x270F], [0x2712, 0x2712],
  [0x2714, 0x2714], [0x2716, 0x2716], [0x271D, 0x271D], [0x2721, 0x2721],
  [0x2728, 0x2728], [0x2733, 0x2734], [0x2744, 0x2744], [0x2747, 0x2747],
  [0x274C, 0x274C], [0x274E, 0x274E], [0x2753, 0x2755], [0x2757, 0x2757],
  [0x2763, 0x2764], [0x2795, 0x2797], [0x27A1, 0x27A1], [0x27B0, 0x27B0],
  [0x27BF, 0x27BF], [0x2B1B, 0x2B1C], [0x2B50, 0x2B50], [0x2B55, 0x2B55],
  [0x3030, 0x3030], [0x303D, 0x303D], [0x3297, 0x3297], [0x3299, 0x3299],
];

export function isEmojiPresentationBase(cp) {
  for (let i = 0; i < VS16_RANGES.length; i++) {
    if (cp >= VS16_RANGES[i][0] && cp <= VS16_RANGES[i][1]) return true;
  }
  return false;
}

const VS16 = '\uFE0F';

// Width of chars[i] in cells, with VS16 lookahead. Returns { width, units }
// where units is how many JS-string elements the cell(s) consume (a base +
// its variation selector count as one 2-cell unit so truncation never splits
// the pair). Exported for screen.mjs.
export function charCellWidth(chars, i) {
  const cp = chars[i].codePointAt(0);
  if (isCombiningCodePoint(cp)) return { width: 0, units: 1 };
  let width = isWideCodePoint(cp) ? 2 : 1;
  let units = 1;
  if (width === 1 && isEmojiPresentationBase(cp) && chars[i + 1] === VS16) {
    width = 2;
    units = 2;
  }
  return { width, units };
}

export function displayWidth(value) {
  const chars = Array.from(String(value ?? ''));
  let width = 0;
  for (let i = 0; i < chars.length; i++) {
    width += charCellWidth(chars, i).width;
  }
  return width;
}

function takeToWidth(chars, width) {
  if (width <= 0) return { text: '', count: 0 };
  let used = 0;
  let count = 0;
  while (count < chars.length) {
    const { width: w, units } = charCellWidth(chars, count);
    if (used + w > width) break;
    used += w;
    count += units;
  }
  // Always make progress for a single wide glyph in a one-cell viewport.
  if (count === 0 && chars.length > 0) count = 1;
  return { text: chars.slice(0, count).join(''), count };
}

export function truncateToWidth(s, width, ellipsis = '…') {
  if (s == null || width <= 0) return '';
  const str = String(s);
  if (displayWidth(str) <= width) return str;
  const ellipsisWidth = displayWidth(ellipsis);
  if (ellipsisWidth >= width) return takeToWidth(Array.from(ellipsis), width).text;
  return takeToWidth(Array.from(str), width - ellipsisWidth).text + ellipsis;
}

// Truncate with ellipsis. truncate('hello world', 8) → 'hello w…'
export function truncate(s, n) {
  return truncateToWidth(s, n);
}

// Slice a string using terminal-cell columns rather than UTF-16 indices.
// This is used by mouse text selection, where columns come from terminal
// coordinates and may point into CJK, emoji, or combining-mark content.
export function sliceByDisplayColumns(value, start = 0, end = Infinity) {
  const chars = Array.from(String(value ?? ''));
  const lo = Math.max(0, Number.isFinite(start) ? start : 0);
  const hi = Number.isFinite(end) ? Math.max(lo, end) : Infinity;
  let cell = 0;
  let out = '';
  for (const ch of chars) {
    const w = displayWidth(ch);
    const selected = w === 0 ? cell >= lo && cell < hi : cell < hi && cell + w > lo;
    if (selected) out += ch;
    cell += w;
  }
  return out;
}

// Word-wrap `text` so each visual line fits within `width` display cells.

// Behavior:
//   - Splits on `\r?\n` first so source-line semantics are preserved
//     (each `\n` produces a logical-line boundary).
//   - Greedy fit: for each source line, break at the LAST whitespace
//     position within the next `width` cells so words stay intact when
//     possible.
//   - For unbreakable tokens (URLs, long identifiers, code with no
//     whitespace) that exceed `width` on their own, hard-breaks at `width`.
//   - Strips leading whitespace from continuation rows so wrapped lines
//     start flush against the gutter.
//   - Empty source lines produce one empty display line (preserves blank
//     rows in READMEs / blank-line spacing in code files).
//   - `width <= 0` returns the source lines unchanged (graceful
//     degradation when the caller has no usable width).

// Used by the README pane and the file viewer so long horizontal lines
// reflow instead of being hidden past the right edge.
export function wrapTextWithMap(text, width) {
  const t = text == null ? '' : String(text);
  const logicalLines = t.split(/\r?\n/);
  if (width == null || width <= 0) {
    return { lines: logicalLines, visualToLogical: logicalLines.map((_, i) => i) };
  }
  const visualLines = [];
  const visualToLogical = [];
  for (let i = 0; i < logicalLines.length; i++) {
    let ln = logicalLines[i];
    if (ln.length === 0) {
      visualLines.push('');
      visualToLogical.push(i);
      continue;
    }
    let isContinuation = false;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (isContinuation) ln = ln.trimStart();
      if (ln.length === 0) break;
      const chars = Array.from(ln);
      if (displayWidth(ln) <= width) {
        visualLines.push(ln);
        visualToLogical.push(i);
        break;
      }
      // Find the last whitespace in the prefix that fits in `width` cells.
      const fit = takeToWidth(chars, width);
      let breakIdx = -1;
      for (let j = fit.count - 1; j >= 0; j--) {
        if (/\s/.test(chars[j])) { breakIdx = j; break; }
      }
      if (breakIdx <= 0) breakIdx = fit.count; // unbreakable token — hard-break
      visualLines.push(chars.slice(0, breakIdx).join(''));
      visualToLogical.push(i);
      ln = chars.slice(breakIdx).join('');
      isContinuation = true;
    }
  }
  return { lines: visualLines, visualToLogical };
}

// Convenience: just the visual lines (no source-line mapping). Most callers
// only need the wrapped array; `wrapTextWithMap` is for footer text and
// per-source-line styling on continuation rows.
export function wrapText(text, width) {
  return wrapTextWithMap(text, width).lines;
}

export function padRight(s, n) {
  const str = String(s ?? '');
  const missing = Math.max(0, n - displayWidth(str));
  return str + ' '.repeat(missing);
}

// Format number with k / M suffix: 12345 → '12.3k', 1500000 → '1.5M'.
export function shortNum(n) {
  if (n == null) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
}

// Format bytes into a human string.
export function formatBytes(b) {
  if (b == null) return '?';
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

// Time-of-day greeting.
export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// Cross-platform browser open. Uses spawn (not exec) so URLs with shell
// metacharacters can't trigger command injection.
export async function openUrl(url) {
  if (!url) return { ok: false, error: 'No URL' };
  try {
    const { spawn } = await import('child_process');
    const platform = process.platform;
    let cmd, args, opts = { detached: true, stdio: 'ignore' };
    if (platform === 'darwin') {
      cmd = 'open';
      args = [url];
    } else if (platform === 'win32') {
      const cleanUrl = url.replace(/"/g, '%22');
      cmd = 'cmd.exe';
      args = ['/c', `start "" "${cleanUrl}"`];
      opts.windowsVerbatimArguments = true;
    } else {
      cmd = 'xdg-open';
      args = [url];
    }
    const child = spawn(cmd, args, opts);
    // `spawn()` can succeed synchronously and still fail asynchronously
    // (missing opener, denied desktop session, non-zero exit). Wait for the
    // child result before reporting success so the toast is trustworthy.
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      child.once('error', (error) => finish({ ok: false, error: error.message }));
      child.once('close', (code) => finish(code === 0 || code == null
        ? { ok: true } : { ok: false, error: 'Browser opener exited with code ' + code }));
      child.unref();
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Copy text to clipboard — tries multiple strategies synchronously so the
// caller can trust that the clipboard is populated before returning.
// Priority: OSC-52 → tmux load-buffer → pbcopy (macOS) → xclip/xsel (Linux X11)
//           → wl-copy (Wayland) → /tmp file.
export function copyToClipboard(text) {
  if (!text) return false;
  const str = String(text);
  globalThis._lastClipboardTempFile = null;
  globalThis._lastClipboardMethod = null;
  let success = false;

  // 1. OSC-52 — synchronous escape sequence to the terminal. Works in most
  //    modern terminals (tmux with allow-passthrough, iTerm2, kitty, foot, etc.)
  const b64 = Buffer.from(str, 'utf-8').toString('base64');
  if (b64.length <= 75_000) {
    try {
      process.stdout.write(`\x1b]52;c;${b64}\x07`);
      // stdout.flush() is not part of Node's portable stream API. The write
      // above is synchronous from the caller's perspective; avoid throwing
      // after emitting a valid OSC-52 sequence and incorrectly falling back.
      globalThis._lastClipboardMethod = 'osc52';
      success = true;
    } catch { /* fall through */ }
  }

  if (success) return true;

  // 2. Inside tmux: write directly to tmux's paste buffer. This is reliable
  //    regardless of whether OSC-52 passthrough is enabled. User accesses it
  //    via tmux copy-mode (Ctrl+B [) or `tmux show-buffer`.
  if (!success && process.env.TMUX) {
    try {
      const r = spawnSync('tmux', ['load-buffer', '-'], {
        input: str, stdio: ['pipe', 'ignore', 'ignore'], encoding: 'utf-8',
      });
      if (r.status === 0) {
        globalThis._lastClipboardMethod = 'tmux';
        return true;
      }
    } catch {}
  }

  // 3. Native clipboard tools — synchronous so paste immediately after copy works.
  if (_tryNativeClipboardSync(str)) {
    if (!globalThis._lastClipboardMethod) globalThis._lastClipboardMethod = 'native';
    return true;
  }

  globalThis._lastClipboardMethod = success ? 'osc52' : 'none';
  return success;
}

// Synchronous native clipboard helper. Tries pbcopy / xclip / xsel / wl-copy / clip.
function _tryNativeClipboardSync(str) {
  const platform = process.platform;
  let candidates = [];
  if (platform === 'darwin') {
    candidates = [['pbcopy', []]];
  } else if (platform === 'win32') {
    candidates = [['powershell', ['-Command', 'Set-Clipboard -Value (Get-Content -Raw)']], ['clip', []]];
  } else {
    candidates = [['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']], ['wl-copy', []]];
  }

  for (const [cmd, args] of candidates) {
    try {
      const result = spawnSync(cmd, args, {
        input: str, stdio: ['pipe', 'ignore', 'ignore'], encoding: 'utf-8',
      });
      if (result.status === 0) return true;
    } catch { /* not found or failed — try next */ }
  }

  // Ultimate fallback: write to a well-known temp file.
  try {
    const tmpFile = join(tmpdir(), 'github-tui-clipboard.txt');
    writeFileSync(tmpFile, str, 'utf-8');
    globalThis._lastClipboardTempFile = tmpFile;
    globalThis._lastClipboardMethod = 'temp-file';
    return true;
  } catch {
    return false;
  }
}

export function getClipboardTempFilePath() {
  return globalThis._lastClipboardTempFile || null;
}

export function getLastClipboardMethod() {
  return globalThis._lastClipboardMethod || null;
}

// Map a GitHub event type to icon + color + short label.
export function eventGlyph(type) {
  switch (type) {
    case 'PushEvent':              return ['↑', 'green',   'pushed'];
    case 'PullRequestEvent':       return ['⇄', 'cyan',    'PR'];
    case 'IssuesEvent':            return ['◉', 'yellow',  'issue'];
    case 'IssueCommentEvent':      return ['•', 'dim',     'commented'];
    case 'PullRequestReviewEvent': return ['★', 'cyan',    'reviewed'];
    case 'WatchEvent':             return ['☆', 'yellow',  'starred'];
    case 'ForkEvent':              return ['Y', 'magenta', 'forked'];
    case 'CreateEvent':            return ['+', 'green',   'created'];
    case 'DeleteEvent':            return ['-', 'red',     'deleted'];
    case 'ReleaseEvent':           return ['▶', 'cyan',    'released'];
    case 'PublicEvent':            return ['◎', 'green',   'public'];
    case 'MemberEvent':            return ['+', 'cyan',    'member'];
    case 'GollumEvent':            return ['◆', 'dim',     'wiki'];
    default:                       return ['•', 'dim', type ? type.replace('Event', '') : '?'];
  }
}

// Accessible-ASCII symbol table (U2). Pure lookup — no imports — so every
// tab can share one text-only vocabulary for `--accessible` mode without
// creating an import cycle (utils must NOT import theme; theme.mjs owns the
// isAccessible() gate via a typeof-guarded call at each paint site).
// Callers gate on appState.accessible / theme isAccessible() themselves;
// these helpers never consult global state.
export function a11ySymbol(name) {
  switch (name) {
    case 'spinner':   return '[..]';
    case 'up':        return '^';
    case 'down':      return 'v';
    case 'both':      return '!';
    case 'right':     return '>';
    case 'downArrow': return 'v';
    case 'ok':        return '[OK]';
    case 'err':       return '[ERR]';
    case 'star':      return '[*]';
    case 'dot':       return '[.]';
    case 'unread':    return '[!]';
    default:          return '[?]';
  }
}

// Accessible twin of eventGlyph(type): same labels, ASCII icons, no color.
// eventGlyph returns [icon, color, label] — its shape is load-bearing for
// callers, so it is left untouched. This helper reuses eventGlyph's label
// table verbatim (labels can't drift) and swaps only icon→ASCII, color→null.
// Dashboard wiring to select between the two is a later pass; both are
// exported here for that pass to consume.
export function eventGlyphA11y(type) {
  const label = eventGlyph(type)[2];
  switch (type) {
    case 'PushEvent':              return ['[+]',  null, label];
    case 'PullRequestEvent':       return ['[PR]', null, label];
    case 'IssuesEvent':            return ['[#]',  null, label];
    case 'IssueCommentEvent':      return ['[.]',  null, label];
    case 'PullRequestReviewEvent': return ['[*]',  null, label];
    case 'WatchEvent':             return ['[*]',  null, label];
    case 'ForkEvent':              return ['[Y]',  null, label];
    case 'CreateEvent':            return ['[+]',  null, label];
    case 'DeleteEvent':            return ['[-]',  null, label];
    case 'ReleaseEvent':           return ['[>]',  null, label];
    case 'PublicEvent':            return ['[o]',  null, label];
    case 'MemberEvent':            return ['[+]',  null, label];
    case 'GollumEvent':            return ['[W]',  null, label];
    default:                       return ['[.]',  null, label];
  }
}

// Color helper for notification subject types.
export function notifTypeColor(type) {
  switch (type) {
    case 'PullRequest':       return 'cyan';
    case 'Issue':             return 'yellow';
    case 'Release':           return 'green';
    case 'Discussion':        return 'magenta';
    case 'Commit':            return 'blue';
    case 'CheckSuite':        return 'red';
    default:                  return 'dim';
  }
}

// Convert an api.github.com notification subject URL to a browser URL.
export function notificationToHtmlUrl(apiUrl) {
  if (!apiUrl) return null;
  let url = apiUrl.replace('api.github.com/repos', 'github.com');
  // Only convert /pulls/ to /pull/ for actual PR URLs.
  if (url.includes('/pulls/')) {
    // only rewrite /pulls/<digits> → /pull/<digits>; never
    // touch URLs that merely contain the substring `/pulls/` mid-path.
    url = url.replace(/\/pulls\/(\d+)(?=#|\?|$)/, '/pull/$1');
  }
  return url;
}

// ─── CWD safety + git shell-outs (added in W1 — file explorer) ─────

import { resolve, normalize, join, dirname } from 'path';
import { mkdirSync, existsSync, writeFileSync, statSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';

// Refuse paths that escape CWD via .. — used before writing any user-named
// file to disk so a malicious repo can't overwrite ~/.ssh/authorized_keys etc.

// SECURITY: the prefix check MUST use a path-separator on CWD so a
// same-prefix sibling directory (CWD=/a/b, target=/a/b-other) is rejected.
// added regression test in tests/safe-cwd.test.mjs.
export function safeCwdJoin(relPath) {
  if (relPath == null) throw new Error('safeCwdJoin: relPath is required');
  const cwd = process.cwd();
  const target = resolve(cwd, normalize(String(relPath)));
  // Normalize both paths to forward slashes for cross-platform comparison.
  const normCwd = process.platform === 'win32' ? cwd.toLowerCase().replace(/\\/g, '/') : cwd.replace(/\\/g, '/');
  const normTarget = process.platform === 'win32' ? target.toLowerCase().replace(/\\/g, '/') : target.replace(/\\/g, '/');
  // Refuse root-walking ambiguity: if CWD is itself "/", every absolute
  // path "starts with" it; require explicit equality in that case.
  if (normCwd === '/' || normCwd === '') {
    if (normTarget !== normCwd) throw new Error('Path escapes CWD: ' + relPath);
    return target;
  }
  const sep = normCwd.endsWith('/') ? '' : '/';
  if (normTarget !== normCwd && !normTarget.startsWith(normCwd + sep)) {
    throw new Error('Path escapes CWD: ' + relPath);
  }
  return target;
}

// Write content to a CWD-relative path, creating parent dirs as needed.
export function writeFileSafe(relPath, content) {
  const target = safeCwdJoin(relPath);
  mkdirSync(dirname(target), { recursive: true });
  if (typeof content === 'string') writeFileSync(target, content, 'utf-8');
  else writeFileSync(target, content);
  return target;
}

export function dirExists(path) {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

// Run a command, streaming stdout/stderr to /dev/null (we don't redraw while
// it runs — TUI raw mode is paused by the caller). Resolves to exit code.
export function runCommand(cmd, args, opts = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      const { spawn } = await import('child_process');
      const child = spawn(cmd, args, {
        stdio: opts.inherit ? 'inherit' : 'ignore',
        cwd: opts.cwd || process.cwd(),
      });
      child.on('error', reject);
      child.on('exit', (code) => resolve(code ?? 0));
    } catch (e) { reject(e); }
  });
}

export function runCommandCapture(cmd, args, opts = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      const { spawn } = await import('child_process');
      const child = spawn(cmd, args, { cwd: opts.cwd || process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('exit', code => resolve({ code: code ?? 0, stdout, stderr }));
    } catch (e) { reject(e); }
  });
}

export function ghCloneUrl(owner, repo, webHost = 'github.com') {
  const host = String(webHost).replace(/^https?:\/\//, '').replace(/\/$/, '');
  return 'https://' + host + '/' + owner + '/' + repo + '.git';
}

export function sectionHeader(screen, x, y, text, hint) {
  screen.writeStr(x, y, text, { fg: 'cyan', bold: true });
  if (hint) {
    const hx = screen.width - hint.length - 2;
    if (hx > x + text.length + 4) screen.writeStr(hx, y, hint, { dim: true });
  }
}

export function notifReasonLabel(reason) {
  switch (reason) {
    case 'mention': return '@mentioned';
    case 'review_requested': return 'review';
    case 'assign': return 'assigned';
    case 'author': return 'own thread';
    case 'comment': return 'comment';
    case 'subscribed': return 'subscribed';
    case 'team_mention': return 'team @';
    case 'state_change': return 'state';
    case 'manual': return 'manual';
    case 'invitation': return 'invite';
    case 'security_alert': return 'security';
    default: return reason || '?';
  }
}
