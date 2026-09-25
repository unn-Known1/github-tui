// Minimal debug sink shared by modules that swallow IO errors and would
// otherwise be undiagnosable (e.g. onboarding's changelog/marker writes).
// Appends to $GITHUB_TUI_HOME/debug.log (or ~/.github-tui/debug.log);
// every failure — including a missing home dir or read-only filesystem — is
// itself swallowed so logging can never propagate out of an error/cleanup
// path. Gated behind DEBUG || GITHUB_TUI_DEBUG (same gate as app.mjs) so the
// TUI and hot paths are unaffected by default. Rotated: capped at 2MB, oldest
// half truncated on overflow so a long session can't fill the disk.
import { appendFileSync, mkdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

function debugDir() {
  return process.env.GITHUB_TUI_HOME || join(homedir(), '.github-tui');
}

function debugPath() {
  return join(debugDir(), 'debug.log');
}

const MAX_DEBUG_BYTES = 2 * 1024 * 1024;

function rotateDebugLog(path) {
  try {
    const st = statSync(path);
    if (!st || st.size < MAX_DEBUG_BYTES) return;
    const raw = readFileSync(path, 'utf8');
    const half = raw.slice(Math.floor(raw.length / 2));
    const nl = half.indexOf('\n');
    writeFileSync(path, nl >= 0 ? half.slice(nl + 1) : half);
  } catch { /* never throw from a debug sink */ }
}

export function isDebugEnabled() {
  return !!(process.env.DEBUG || process.env.GITHUB_TUI_DEBUG);
}

export function debugLog(...args) {
  if (!isDebugEnabled()) return;
  try {
    const dir = debugDir();
    const path = debugPath();
    mkdirSync(dir, { recursive: true });
    rotateDebugLog(path);
    const line = `[${new Date().toISOString()}] ${args.map(a => (a && a.stack) || String(a)).join(' ')}\n`;
    appendFileSync(path, line);
  } catch { /* never throw from a debug sink */ }
}

// Crash logs must never be traceless: always written even when DEBUG is off.
export function crashLog(...args) {
  try {
    const dir = debugDir();
    const path = debugPath();
    mkdirSync(dir, { recursive: true });
    rotateDebugLog(path);
    const line = `[${new Date().toISOString()}] [CRASH] ${args.map(a => (a && a.stack) || String(a)).join(' ')}\n`;
    appendFileSync(path, line);
  } catch { /* never throw from a debug sink */ }
}
