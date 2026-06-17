// Persistent on-disk stores for bookmarks and saved searches.
// Anything that needs to survive a restart goes here.

import { BOOKMARKS_FILE, SAVED_SEARCHES_FILE, readJson, writeJson } from './config.mjs';

// ────────────────────────────────────────────────────────────────────────────
// Bookmarks — "read later" / private starring distinct from GitHub stars.
// Shape: [{ id, full_name, url, description, language, stars, tags:[], addedAt }]
// ────────────────────────────────────────────────────────────────────────────

export function loadBookmarks() {
  return readJson(BOOKMARKS_FILE, []);
}

export function saveBookmarks(list) {
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
  return readJson(SAVED_SEARCHES_FILE, []);
}

export function saveSavedSearches(list) {
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
