// Persistent on-disk stores for bookmarks and saved searches.
// Anything that needs to survive a restart goes here.

import { BOOKMARKS_FILE, SAVED_SEARCHES_FILE, CONFIG_DIR, readJson, writeJson } from './config.mjs';
import { join } from 'path';
const PINS_FILE = join(CONFIG_DIR, 'pins.json');

// ── In-memory caches (loaded once, written through) ──
let _bookmarks = null;
let _savedSearches = null;
let _pins = null;

// ────────────────────────────────────────────────────────────────────────────
// Bookmarks — "read later" / private starring distinct from GitHub stars.
// Shape: [{ id, full_name, url, description, language, stars, tags:[], addedAt }]
// ────────────────────────────────────────────────────────────────────────────

export function loadBookmarks() {
  if (_bookmarks === null) _bookmarks = readJson(BOOKMARKS_FILE, []);
  return _bookmarks;
}

export function saveBookmarks(list) {
  _bookmarks = list;
  writeJson(BOOKMARKS_FILE, list);
}

export function addBookmark(repo, tags = []) {
  const list = loadBookmarks();
  // Dedup by full_name.
  if (list.some(b => b.full_name === repo.full_name)) return { added: false, list };
  list.unshift({
    id: `bm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    full_name: repo.full_name,
    url: repo.html_url,
    description: repo.description || '',
    language: repo.language || '',
    stars: repo.stargazers_count || 0,
    tags,
    addedAt: new Date().toISOString(),
  });
  saveBookmarks(list);
  return { added: true, list };
}

export function removeBookmark(idOrFullName) {
  const list = loadBookmarks().filter(
    b => b.id !== idOrFullName && b.full_name !== idOrFullName
  );
  saveBookmarks(list);
  return list;
}

export function isBookmarked(fullName) {
  return loadBookmarks().some(b => b.full_name === fullName);
}

// ────────────────────────────────────────────────────────────────────────────
// Saved searches — named query templates.
// Shape: [{ id, label, query, createdAt }]
// ────────────────────────────────────────────────────────────────────────────

export function loadSavedSearches() {
  if (_savedSearches === null) _savedSearches = readJson(SAVED_SEARCHES_FILE, []);
  return _savedSearches;
}

export function saveSavedSearches(list) {
  _savedSearches = list;
  writeJson(SAVED_SEARCHES_FILE, list);
}

export function addSavedSearch(label, query) {
  const list = loadSavedSearches();
  list.unshift({
    id: `ss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    label,
    query,
    createdAt: new Date().toISOString(),
  });
  saveSavedSearches(list);
  return list;
}

export function removeSavedSearch(id) {
  const list = loadSavedSearches().filter(s => s.id !== id);
  saveSavedSearches(list);
  return list;
}

// ────────────────────────────────────────────────────────────────────────────
// Repo preferences — sort, filter, density settings that survive restarts.
// Shape: { repoSort, repoTypeFilter, reposLangFilter, repoStaleOnly, repoDensity }
// ────────────────────────────────────────────────────────────────────────────
const REPO_PREFS_FILE = join(CONFIG_DIR, 'repo-prefs.json');

export function loadRepoPrefs() {
  return readJson(REPO_PREFS_FILE, {});
}

export function saveRepoPrefs(prefs) {
  writeJson(REPO_PREFS_FILE, prefs);
}

// ────────────────────────────────────────────────────────────────────────────
// Pins — sticky favorites that float to the top of the Repos list.
// Shape: array of full_name strings.
// ────────────────────────────────────────────────────────────────────────────

export function loadPins() {
  if (_pins === null) _pins = readJson(PINS_FILE, []);
  return _pins;
}
export function savePins(list) {
  _pins = list;
  writeJson(PINS_FILE, list);
}
export function isPinned(fullName) { return loadPins().includes(fullName); }
export function togglePin(fullName) {
  const list = loadPins();
  const i = list.indexOf(fullName);
  if (i >= 0) list.splice(i, 1); else list.unshift(fullName);
  savePins(list);
  return list;
}
