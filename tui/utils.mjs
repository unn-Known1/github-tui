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

// Clamp number into [lo, hi].
export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// Terminal-cell width helpers. JavaScript string length counts UTF-16 code
// units, not the cells a terminal paints. Keep these pure so every pane can
// share the same behavior without depending on the renderer.
function isCombining(cp) {
  return (cp >= 0x0300 && cp <= 0x036F) ||
    (cp >= 0x1AB0 && cp <= 0x1AFF) ||
    (cp >= 0x1DC0 && cp <= 0x1DFF) ||
    (cp >= 0x20D0 && cp <= 0x20FF) ||
    (cp >= 0xFE20 && cp <= 0xFE2F) || cp === 0x200D ||
    (cp >= 0xFE00 && cp <= 0xFE0F);
}

function isWide(cp) {
  return (cp >= 0x1100 && cp <= 0x115F) || cp === 0x2329 || cp === 0x232A ||
    (cp >= 0x2E80 && cp <= 0x303E) || (cp >= 0x3040 && cp <= 0x33BF) ||
    (cp >= 0x3400 && cp <= 0x4DBF) || (cp >= 0x4E00 && cp <= 0xA4CF) ||
    (cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0xF900 && cp <= 0xFAFF) ||
    (cp >= 0xFE30 && cp <= 0xFE6F) || (cp >= 0xFF01 && cp <= 0xFF60) ||
    (cp >= 0xFFE0 && cp <= 0xFFE6) || (cp >= 0x1F300 && cp <= 0x1FAFF) ||
    (cp >= 0x20000 && cp <= 0x3FFFD);
}

export function displayWidth(value) {
  const chars = Array.from(String(value ?? ''));
  let width = 0;
  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    if (isCombining(cp)) continue;
    width += isWide(cp) ? 2 : 1;
  }
  return width;
}

function takeToWidth(chars, width) {
  if (width <= 0) return { text: '', count: 0 };
  let used = 0;
  let count = 0;
  while (count < chars.length) {
    const w = displayWidth(chars[count]);
    if (used + w > width) break;
    used += w;
    count++;
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

// Pad-right to width (no truncation).
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
  let success = false;

  // 1. OSC-52 — synchronous escape sequence to the terminal. Works in most
  //    modern terminals (tmux with allow-passthrough, iTerm2, kitty, foot, etc.)
  const b64 = Buffer.from(str, 'utf-8').toString('base64');
  if (b64.length <= 75_000) {
    try {
      process.stdout.write(`\x1b]52;c;${b64}\x07`);
      process.stdout.flush();
      success = true;
    } catch { /* fall through */ }
  }

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
    globalThis._lastClipboardMethod = 'native';
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
    return true;
  } catch {
    return false;
  }
}

// Return the path of the last temp-file fallback, or null.
export function getClipboardTempFilePath() {
  return globalThis._lastClipboardTempFile || null;
}

// Return which method was last used to copy text, or null.
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

export function ghCloneUrl(owner, repo) {
  return 'https://github.com/' + owner + '/' + repo + '.git';
}

export function sectionHeader(screen, x, y, text, hint) {
  screen.writeStr(x, y, text, { fg: 'cyan', bold: true });
  if (hint) {
    const hx = screen.width - hint.length - 2;
    if (hx > x + text.length + 4) screen.writeStr(hx, y, hint, { dim: true });
  }
}
