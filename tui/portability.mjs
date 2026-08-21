// Portable configuration bundle helpers. Tokens and API caches are never
// included. The functions are usable from both the palette and CLI mode.

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { dirname, resolve, join } from 'path';
import {
  APP_VERSION, CONFIG_DIR, readJson, BOOKMARKS_FILE, SAVED_SEARCHES_FILE,
  KEYBINDINGS_FILE, SECTIONS_FILE,
} from './config.mjs';

const PINS_FILE = join(CONFIG_DIR, 'pins.json');
const REPO_PREFS_FILE = join(CONFIG_DIR, 'repo-prefs.json');
const THEME_FILE = join(CONFIG_DIR, 'theme');
const SESSION_FILE = join(CONFIG_DIR, 'session.json');

export function buildPortableConfig() {
  let theme = null;
  try { theme = readFileSync(THEME_FILE, 'utf8').trim() || null; } catch {}
  return {
    schemaVersion: 1,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    bookmarks: readJson(BOOKMARKS_FILE, []),
    savedSearches: readJson(SAVED_SEARCHES_FILE, []),
    pins: readJson(PINS_FILE, []),
    repoPreferences: readJson(REPO_PREFS_FILE, {}),
    sections: readJson(SECTIONS_FILE, []),
    keybindings: readJson(KEYBINDINGS_FILE, []),
    theme,
    // Session is navigation-only and deliberately excludes token/private API data.
    session: readJson(SESSION_FILE, {}),
  };
}

export function validatePortableConfig(bundle) {
  if (!bundle || typeof bundle !== 'object') return { ok: false, error: 'Bundle must be an object' };
  if (bundle.schemaVersion !== 1) return { ok: false, error: 'Unsupported config schema version' };
  for (const key of ['bookmarks', 'savedSearches', 'pins', 'sections', 'keybindings']) {
    if (bundle[key] != null && !Array.isArray(bundle[key])) return { ok: false, error: key + ' must be an array' };
  }
  if (bundle.theme != null && typeof bundle.theme !== 'string') return { ok: false, error: 'theme must be a string' };
  return { ok: true };
}

function writeConfigFile(path, value) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
  try { chmodSync(path, 0o600); } catch {}
}

export function exportPortableConfig(path) {
  const target = resolve(path || 'github-tui-config.json');
  writeConfigFile(target, buildPortableConfig());
  return target;
}

export function importPortableConfig(path, { merge = true } = {}) {
  const source = resolve(path);
  const bundle = JSON.parse(readFileSync(source, 'utf8'));
  const check = validatePortableConfig(bundle);
  if (!check.ok) throw new Error(check.error);
  const current = buildPortableConfig();
  const next = merge ? { ...current, ...bundle } : bundle;
  // Import is intentionally explicit and never writes token/cache files.
  writeConfigFile(BOOKMARKS_FILE, next.bookmarks || []);
  writeConfigFile(SAVED_SEARCHES_FILE, next.savedSearches || []);
  writeConfigFile(PINS_FILE, next.pins || []);
  writeConfigFile(REPO_PREFS_FILE, next.repoPreferences || {});
  writeConfigFile(SECTIONS_FILE, next.sections || []);
  writeConfigFile(KEYBINDINGS_FILE, next.keybindings || []);
  if (next.theme) writeFileSync(THEME_FILE, String(next.theme));
  if (next.session) writeConfigFile(SESSION_FILE, next.session);
  return next;
}
