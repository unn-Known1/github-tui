// Minimal debug sink shared by modules that swallow IO errors and would
// otherwise be undiagnosable (e.g. onboarding's changelog/marker writes).
// Appends to ~/.github-tui/debug.log; every failure — including a missing
// home dir or read-only filesystem — is itself swallowed so logging can
// never propagate out of an error/cleanup path. Gated behind
// GITHUB_TUI_DEBUG so the TUI and hot paths are unaffected by default.
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const _dir = join(homedir(), '.github-tui');
const _path = join(_dir, 'debug.log');

export function debugLog(...args) {
  if (!process.env.GITHUB_TUI_DEBUG) return;
  try {
    mkdirSync(_dir, { recursive: true });
    const line = `[${new Date().toISOString()}] ${args.map(a => (a && a.stack) || String(a)).join(' ')}\n`;
    appendFileSync(_path, line);
  } catch { /* never throw from a debug sink */ }
}
