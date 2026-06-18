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

// Truncate with ellipsis. truncate('hello world', 8) → 'hello w…'
export function truncate(s, n) {
  if (s == null) return '';
  const str = String(s);
  return str.length <= n ? str : str.slice(0, Math.max(0, n - 1)) + '…';
}

// Pad-right to width (no truncation).
export function padRight(s, n) {
  const str = String(s ?? '');
  return str.length >= n ? str : str + ' '.repeat(n - str.length);
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
    let cmd, args;
    if (platform === 'darwin') { cmd = 'open'; args = [url]; }
    else if (platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '""', url]; }
    else { cmd = 'xdg-open'; args = [url]; }
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Copy text to clipboard via OSC-52 — works over SSH and inside tmux.
// Capped at ~75KB after base64 to avoid terminal limits.
export function copyToClipboard(text) {
  if (!text) return false;
  const b64 = Buffer.from(String(text), 'utf-8').toString('base64');
  if (b64.length > 75_000) return false;
  process.stdout.write(`\x1b]52;c;${b64}\x07`);
  return true;
}

// Map a GitHub event type to icon + color + short label.
export function eventGlyph(type) {
  switch (type) {
    case 'PushEvent':              return ['↑', 'green',   'pushed'];
    case 'PullRequestEvent':       return ['⇄', 'cyan',    'PR'];
    case 'IssuesEvent':            return ['◉', 'yellow',  'issue'];
    case 'IssueCommentEvent':      return ['✎', 'dim',     'commented'];
    case 'PullRequestReviewEvent': return ['★', 'cyan',    'reviewed'];
    case 'WatchEvent':             return ['☆', 'yellow',  'starred'];
    case 'ForkEvent':              return ['⑂', 'magenta', 'forked'];
    case 'CreateEvent':            return ['+', 'green',   'created'];
    case 'DeleteEvent':            return ['−', 'red',     'deleted'];
    case 'ReleaseEvent':           return ['▶', 'cyan',    'released'];
    case 'PublicEvent':            return ['◎', 'green',   'public'];
    case 'MemberEvent':            return ['+', 'cyan',    'member'];
    case 'GollumEvent':            return ['📖', 'dim',     'wiki'];
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
    url = url.replace('/pulls/', '/pull/');
  }
  return url;
}

// ─── CWD safety + git shell-outs (added in W1 — file explorer) ─────

import { resolve, normalize, join, dirname } from 'path';
import { mkdirSync, existsSync, writeFileSync, statSync } from 'fs';

// Refuse paths that escape CWD via .. — used before writing any user-named
// file to disk so a malicious repo can't overwrite ~/.ssh/authorized_keys etc.
export function safeCwdJoin(relPath) {
  const cwd = process.cwd();
  const target = resolve(cwd, normalize(relPath));
  // Normalize both paths to forward slashes for cross-platform comparison.
  const normCwd = cwd.replace(/\\/g, '/');
  const normTarget = target.replace(/\\/g, '/');
  const suffix = normCwd.endsWith('/') ? '' : '/';
  if (!normTarget.startsWith(normCwd + suffix) && normTarget !== normCwd) {
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
