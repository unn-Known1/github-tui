// Configuration constants and PAT token persistence.
// Kept dependency-free so it can be imported by any module without cycles.
//
// Token storage priority (v0.6.1+):
//   1. OS keychain  — macOS Keychain, Linux libsecret, Windows Credential Manager
//   2. Plaintext    — ~/.github-tui/token (chmod 600) — fallback when no keychain available
//
// Existing plaintext tokens are silently migrated to the keychain on first save.

import { homedir } from 'os';
import { join } from 'path';
import {
  existsSync, readFileSync, writeFileSync,
  mkdirSync, unlinkSync, chmodSync,
} from 'fs';
import {
  saveTokenSecure, loadTokenSecure, removeTokenSecure, detectBackend,
} from './keychain.mjs';

export const APP_VERSION = '0.6.0';

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
// Exposed so the Settings UI can display the storage method.
export let tokenStorageBackend = detectBackend() || 'plaintext';

export function loadToken() {
  // 1. Try OS keychain first
  const secure = loadTokenSecure();
  if (secure) {
    tokenStorageBackend = detectBackend() || 'plaintext';
    return secure;
  }

  // 2. Fall back to legacy plaintext file (backwards compatibility)
  try {
    const legacy = readFileSync(TOKEN_FILE, 'utf-8').trim();
    if (legacy) {
      tokenStorageBackend = 'plaintext';
      // Silently migrate to keychain in the background — non-blocking
      setImmediate(() => {
        try {
          if (saveTokenSecure(legacy)) {
            // Migration succeeded — remove plaintext file
            try { unlinkSync(TOKEN_FILE); } catch {}
            tokenStorageBackend = detectBackend() || 'plaintext';
          }
        } catch {}
      });
      return legacy;
    }
  } catch {}

  return null;
}

export function saveToken(token) {
  if (!token) return removeToken();

  // 1. Try OS keychain first
  const saved = saveTokenSecure(token);
  if (saved) {
    tokenStorageBackend = detectBackend() || 'plaintext';
    // Remove legacy plaintext file if it exists (clean migration)
    try { if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE); } catch {}
    return;
  }

  // 2. Fall back to plaintext with strict permissions
  tokenStorageBackend = 'plaintext';
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, token);
  // Lock down permissions so other users on a shared machine can't read the PAT.
  // chmod is a no-op on Windows but harmless.
  try {
    chmodSync(CONFIG_DIR, 0o700);
    chmodSync(TOKEN_FILE, 0o600);
  } catch {
    // Best-effort; ignore on platforms that don't support POSIX modes.
  }
}

export function removeToken() {
  // Remove from keychain (no-op if not stored there)
  removeTokenSecure();
  // Always also remove plaintext file for clean state
  try { if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE); } catch {}
  tokenStorageBackend = detectBackend() || 'plaintext';
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
  writeFileSync(path, JSON.stringify(value, null, 2));
  try { chmodSync(path, 0o600); } catch {}
}
