// Portable configuration bundle helpers. Tokens and API caches are never
// included. The functions are usable from both the palette and CLI mode.

import {
  readFileSync, writeFileSync, mkdirSync, chmodSync, renameSync, statSync,
  existsSync, copyFileSync,
} from 'fs';
import { dirname, resolve, join } from 'path';
import {
  APP_VERSION, CONFIG_DIR, readJson, BOOKMARKS_FILE, SAVED_SEARCHES_FILE,
  KEYBINDINGS_FILE, SECTIONS_FILE,
} from './config.mjs';

const PINS_FILE = join(CONFIG_DIR, 'pins.json');
const REPO_PREFS_FILE = join(CONFIG_DIR, 'repo-prefs.json');
const THEME_FILE = join(CONFIG_DIR, 'theme');
const SESSION_FILE = join(CONFIG_DIR, 'session.json');

// Allow-list of session keys a portable bundle may carry. Mirrors the keys
// saveSession() writes (tui/state.mjs) — navigation/preferences only. The
// import path enforces this so a hostile bundle cannot smuggle arbitrary
// (potentially sensitive) values into session.json despite the comment
// above claiming the bundle is token-free.
const SESSION_KEYS = [
  'tab', 'recentRepos', 'analyzeView', 'searchQuery', 'searchType',
  'reposView', 'autoRefreshEnabled', 'autoRefreshIntervalMs',
  'inboxTextFilter', 'lastSeenVersion', 'localAutoPoll',
];

// 5MB cap on imported bundles — a few orders of magnitude above any real
// config, small enough to stop a decompression-bomb style DoS.
const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;

export function buildPortableConfig() {
  let theme = null;
  try { theme = readFileSync(THEME_FILE, 'utf8').trim() || null; } catch {}
  // Only carry allow-listed session keys so a stale/foreign key on disk can
  // never produce a bundle that validatePortableConfig() then rejects
  // (self-breaking export→import). Unknown keys are dropped here.
  let sessionRaw = {};
  try { sessionRaw = readJson(SESSION_FILE, {}); } catch {}
  const session = {};
  if (sessionRaw && typeof sessionRaw === 'object' && !Array.isArray(sessionRaw)) {
    for (const k of SESSION_KEYS) {
      if (sessionRaw[k] !== undefined) session[k] = sessionRaw[k];
    }
  }
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
    session,
  };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Element-shape sanity for the array fields: entries must be objects.
function isObjectArray(v) {
  return Array.isArray(v) && v.every(e => e !== null && typeof e === 'object');
}

export function validatePortableConfig(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    return { ok: false, error: 'Bundle must be an object' };
  }
  if (bundle.schemaVersion !== 1) return { ok: false, error: 'Unsupported config schema version' };
  for (const key of ['bookmarks', 'savedSearches', 'pins', 'sections', 'keybindings']) {
    if (bundle[key] != null && !isObjectArray(bundle[key])) {
      return { ok: false, error: key + ' must be an array of objects' };
    }
  }
  if (bundle.repoPreferences != null && !isPlainObject(bundle.repoPreferences)) {
    return { ok: false, error: 'repoPreferences must be an object' };
  }
  if (bundle.session != null && !isPlainObject(bundle.session)) {
    return { ok: false, error: 'session must be an object' };
  }
  if (bundle.theme != null && typeof bundle.theme !== 'string') {
    return { ok: false, error: 'theme must be a string' };
  }
  // Enforce the navigation-only session claim: unknown keys are rejected
  // rather than silently written to session.json.
  if (bundle.session != null) {
    for (const k of Object.keys(bundle.session)) {
      if (!SESSION_KEYS.includes(k)) {
        return { ok: false, error: `session.${k} is not an allowed session key` };
      }
    }
  }
  return { ok: true };
}

// Atomic + owner-only write: temp file in the same directory, fsync-less
// rename (atomic on POSIX and Windows same-volume), then 0600 so imported
// config files are never world-readable.
function writeConfigFile(path, value) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { chmodSync(tmp, 0o600); } catch {}
  renameSync(tmp, path);
}

// GT-20: importing a bundle overwrote user config irreversibly. Snapshot a
// timestamped .bak copy of every file we are about to replace so a bad
// import can be rolled back by hand.
export function backupConfigFile(path) {
  try {
    if (!existsSync(path)) return null;
    const backup = `${path}.bak.${new Date().toISOString().replace(/[:.]/g, '-')}`;
    copyFileSync(path, backup);
    try { chmodSync(backup, 0o600); } catch {}
    return backup;
  } catch {
    return null;
  }
}

export function exportPortableConfig(path) {
  const target = resolve(path || 'github-tui-config.json');
  writeConfigFile(target, buildPortableConfig());
  return target;
}

export function importPortableConfig(path, { merge = true } = {}) {
  const source = resolve(path);
  let bundle;
  try {
    const stat = statSync(source); // throws ENOENT with a raw path for missing files
    if (stat.size > MAX_BUNDLE_BYTES) {
      throw new Error(`Config bundle is too large (${stat.size} bytes > ${MAX_BUNDLE_BYTES})`);
    }
    bundle = JSON.parse(readFileSync(source, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new Error('Config bundle not found: ' + source);
    }
    if (err instanceof SyntaxError) {
      throw new Error('Config bundle is not valid JSON: ' + source);
    }
    throw err; // size cap / permission / our own friendly Error
  }
  const check = validatePortableConfig(bundle);
  if (!check.ok) throw new Error(check.error);
  const current = buildPortableConfig();
  // Replace mode (merge=false) historically wiped every field the bundle
  // omitted (`next.x || []` wrote empty arrays). "Replace" now means
  // "replace the fields the bundle actually carries" — omitted keys keep
  // their current values.
  const next = merge
    ? { ...current, ...bundle }
    : { ...current, ...Object.fromEntries(Object.entries(bundle).filter(([, v]) => v !== undefined)) };
  // Import is intentionally explicit and never writes token/cache files.
  // GT-20: back up each existing file before overwriting it.
  if (next.bookmarks !== undefined) { backupConfigFile(BOOKMARKS_FILE); writeConfigFile(BOOKMARKS_FILE, next.bookmarks); }
  if (next.savedSearches !== undefined) { backupConfigFile(SAVED_SEARCHES_FILE); writeConfigFile(SAVED_SEARCHES_FILE, next.savedSearches); }
  if (next.pins !== undefined) { backupConfigFile(PINS_FILE); writeConfigFile(PINS_FILE, next.pins); }
  if (next.repoPreferences !== undefined) { backupConfigFile(REPO_PREFS_FILE); writeConfigFile(REPO_PREFS_FILE, next.repoPreferences); }
  if (next.sections !== undefined) { backupConfigFile(SECTIONS_FILE); writeConfigFile(SECTIONS_FILE, next.sections); }
  if (next.keybindings !== undefined) { backupConfigFile(KEYBINDINGS_FILE); writeConfigFile(KEYBINDINGS_FILE, next.keybindings); }
  // Theme is a RAW string file (theme.mjs reads it with trim(), no JSON
  // parsing) — write it as a bare string, not through writeConfigFile's
  // JSON.stringify. Same atomicity + 0600 guarantee, hand-rolled here.
  if (next.theme) {
    backupConfigFile(THEME_FILE);
    const tmp = THEME_FILE + '.tmp.' + process.pid;
    writeFileSync(tmp, String(next.theme), { encoding: 'utf8', mode: 0o600 });
    try { chmodSync(tmp, 0o600); } catch {}
    renameSync(tmp, THEME_FILE);
  }
  if (next.session) { backupConfigFile(SESSION_FILE); writeConfigFile(SESSION_FILE, next.session); }
  return next;
}
