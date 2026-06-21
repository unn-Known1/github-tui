// Custom user-defined sections — loaded from ~/.github-tui/sections.json.
// Each section has a title, type (prs|issues), and GitHub search query.
// Data is fetched via the search/issues endpoint and cached in appState.

import { SECTIONS_FILE, readJson } from './config.mjs';
import { request } from './github.mjs';

/**
 * Load section definitions from disk.
 * Expected format:
 * [
 *   { "title": "Needs My Review", "type": "prs", "query": "is:pr is:open review-requested:@me" },
 *   { "title": "My Bugs", "type": "issues", "query": "is:issue is:open label:bug author:@me" }
 * ]
 */
export function loadSectionDefinitions() {
  const defs = readJson(SECTIONS_FILE, []);
  if (!Array.isArray(defs)) return [];
  return defs.filter(d => d && d.title && d.query);
}

/**
 * Fetch data for all custom sections. Returns an array of section objects
 * with populated `items` arrays.
 */
export async function loadCustomSections(token) {
  const defs = loadSectionDefinitions();
  if (defs.length === 0) return [];

  const sections = [];
  for (const def of defs) {
    try {
      const result = await request(
        '/search/issues?q=' + encodeURIComponent(def.query) +
        '&sort=updated&order=desc&per_page=10',
        { token }
      );
      sections.push({
        title: def.title,
        type: def.type || 'issues',
        query: def.query,
        items: (result && result.items) || [],
        selected: 0,
        scroll: 0,
      });
    } catch {
      // If a section query fails, include it with empty items.
      sections.push({
        title: def.title,
        type: def.type || 'issues',
        query: def.query,
        items: [],
        selected: 0,
        scroll: 0,
      });
    }
  }
  return sections;
}

/**
 * Get cached custom sections from appState.
 */
export function getCustomSections(appState) {
  return appState.customSections || [];
}
