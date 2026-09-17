// Configuration constants and PAT token persistence.
// Kept dependency-free so it can be imported by any module without cycles.

// Token storage priority (v0.6.1+):
//   1. OS keychain  — macOS Keychain, Linux libsecret, Windows Credential Manager
//   2. Plaintext    — ~/.github-tui/token (chmod 600) — fallback when no keychain available

// Existing plaintext tokens are silently migrated to the keychain on first save.

import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  existsSync, readFileSync, writeFileSync,
  mkdirSync, unlinkSync, chmodSync, renameSync, openSync, writeSync, closeSync,
} from 'fs';
import {
  saveTokenSecure, loadTokenSecure, removeTokenSecure, detectBackend,
} from './keychain.mjs';

// Shared terminal capability flags — evaluated once at startup.
// Both theme.mjs and screen.mjs import from here to stay in sync.
export const NO_COLOR   = !!process.env.NO_COLOR;
export const FORCE_COLOR = process.env.FORCE_COLOR !== '0' && !!process.env.FORCE_COLOR;

// Read version dynamically from package.json — single source of truth.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const APP_VERSION = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version;

export const CONFIG_DIR = join(homedir(), '.github-tui');
export const TOKEN_FILE = join(CONFIG_DIR, 'token');
// New in v0.3 — on-disk stores for the feature roadmap.
export const BOOKMARKS_FILE = join(CONFIG_DIR, 'bookmarks.json');
export const SAVED_SEARCHES_FILE = join(CONFIG_DIR, 'saved-searches.json');
export const THEME_FILE = join(CONFIG_DIR, 'theme');
export const CACHE_DIR = join(CONFIG_DIR, 'cache');
export const ETAG_CACHE_FILE = join(CONFIG_DIR, 'etag-cache.json');
export const LAST_SYNCED_FILE = join(CONFIG_DIR, 'last-synced.json');
export const SECTIONS_FILE = join(CONFIG_DIR, 'sections.json');
export const KEYBINDINGS_FILE = join(CONFIG_DIR, 'keybindings.json');

// Track which storage backend is actually in use (set during loadToken / saveToken).
// Exposed so the Settings UI can display the storage method. Accessor pair
// instead of `export let`: reassignment from concurrent loadToken/saveToken/
// migration paths previously raced the raw binding (torn/stale reads in the
// Settings UI mid-migration). Reads/writes now go through one variable with
// no intermediate publication.
let _tokenStorageBackend = detectBackend() || 'plaintext';
export function getTokenStorageBackend() { return _tokenStorageBackend; }
export function setTokenStorageBackend(v) { _tokenStorageBackend = String(v || 'plaintext'); }

// One-shot guard for the background plaintext→keychain migration. Without
// it, every concurrent loadToken() scheduled its own migration: duplicate
// keychain writes plus a race on unlinkSync(TOKEN_FILE) — and if a NEW token
// was saved between scheduling and execution, the migration could delete the
// freshly written plaintext file for a token that was never migrated.
let _migrationScheduled = false;

export function loadToken() {
  const secure = loadTokenSecure();
  if (secure) {
    setTokenStorageBackend(detectBackend() || 'plaintext');
    return secure;
  }

  // 2. Fall back to legacy plaintext file (backwards compatibility)
  try {
    const legacy = readFileSync(TOKEN_FILE, 'utf-8').trim();
    if (legacy) {
      setTokenStorageBackend('plaintext');
      // Silently migrate to keychain in the background — non-blocking, once.
      if (!_migrationScheduled) {
        _migrationScheduled = true;
        setImmediate(() => {
          try {
            // Re-read: the file may have been rewritten by saveToken() in
            // the meantime — migrate what is on disk NOW, not the stale copy.
            const current = readFileSync(TOKEN_FILE, 'utf-8').trim();
            if (current && saveTokenSecure(current)) {
              try { unlinkSync(TOKEN_FILE); } catch {}
              setTokenStorageBackend(detectBackend() || 'plaintext');
            }
          } catch {}
        });
      }
      return legacy;
    }
  } catch {}

  return null;
}

export function saveToken(token) {
  if (!token) return removeToken();

  const saved = saveTokenSecure(token);
  if (saved) {
    setTokenStorageBackend(detectBackend() || 'plaintext');
    // Remove legacy plaintext file if it exists (clean migration)
    try { if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE); } catch {}
    return tokenStorageBackend;
  }

  // 2. Fall back to plaintext with strict permissions
  setTokenStorageBackend('plaintext');
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  // Atomic write with permissions set BEFORE the file becomes visible at its
  // final path: the old write-then-chmod order left a world-readable (umask)
  // secret on disk for a window between the two calls.
  const tmpToken = TOKEN_FILE + '.tmp';
  try { unlinkSync(tmpToken); } catch {}
  const fd = openSync(tmpToken, 'w', 0o600);
  try {
    writeSync(fd, token);
  } finally {
    closeSync(fd);
  }
  try { chmodSync(tmpToken, 0o600); } catch {}
  renameSync(tmpToken, TOKEN_FILE);
  // Lock down permissions so other users on a shared machine can't read the PAT.
  // chmod is a no-op on Windows but harmless.
  try {
    chmodSync(CONFIG_DIR, 0o700);
  } catch {
    // Best-effort; ignore on platforms that don't support POSIX modes.
  }
  return tokenStorageBackend;
}

export function removeToken() {
  // Remove from keychain (no-op if not stored there)
  removeTokenSecure();
  // Always also remove plaintext file for clean state
  try { if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE); } catch {}
  setTokenStorageBackend(detectBackend() || 'plaintext');
}

// Re-export detectBackend so settings UI can call it without importing keychain directly
export { detectBackend };

// Generic JSON store helpers — used by bookmarks, saved searches, keybinding overrides.
export function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return fallback;
  }
}

export function writeJson(path, value) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  // Atomic write (temp + rename): a crash mid-write must never leave a
  // truncated JSON file — bookmarks/pins/searches would be silently wiped
  // or quarantined on the next load.
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  try { chmodSync(tmp, 0o600); } catch {}
  renameSync(tmp, path);
}
