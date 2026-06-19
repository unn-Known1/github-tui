// Configuration constants and PAT token persistence.
// Kept dependency-free so it can be imported by any module without cycles.

import { homedir } from 'os';
import { join } from 'path';
import {
  existsSync, readFileSync, writeFileSync,
  mkdirSync, unlinkSync, chmodSync,
} from 'fs';

export const APP_VERSION = '0.5.6';

export const CONFIG_DIR = join(homedir(), '.github-tui');
export const TOKEN_FILE = join(CONFIG_DIR, 'token');
// New in v0.3 — on-disk stores for the feature roadmap.
export const BOOKMARKS_FILE = join(CONFIG_DIR, 'bookmarks.json');
export const SAVED_SEARCHES_FILE = join(CONFIG_DIR, 'saved-searches.json');
export const THEME_FILE = join(CONFIG_DIR, 'theme');
export const CACHE_DIR = join(CONFIG_DIR, 'cache');
export const ETAG_CACHE_FILE = join(CONFIG_DIR, 'etag-cache.json');

export function loadToken() {
  try {
    return readFileSync(TOKEN_FILE, 'utf-8').trim();
  } catch {
    return null;
  }
}

export function saveToken(token) {
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
  if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE);
}

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
