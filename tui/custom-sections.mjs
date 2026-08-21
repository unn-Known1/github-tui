// Custom user-defined sections — loaded from ~/.github-tui/sections.json.
// Each section has a title, type (prs|issues), and GitHub search query.
// Data is fetched via the search/issues endpoint and cached in appState.

import { SECTIONS_FILE, readJson, writeJson } from './config.mjs';
import { appState, render, showMessage } from './state.mjs';
import { startInput, registerInputHandler } from './input.mjs';
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
  return defs.filter(d => d && d.title && d.query).map(normalizeSectionDefinition);
}

export function normalizeSectionDefinition(definition = {}) {
  return {
    title: String(definition.title || '').trim().slice(0, 80),
    type: definition.type === 'prs' ? 'prs' : 'issues',
    query: String(definition.query || '').trim().slice(0, 500),
    limit: Math.max(1, Math.min(25, Number(definition.limit) || 10)),
    enabled: definition.enabled !== false,
  };
}

export function validateSectionDefinition(definition) {
  const d = normalizeSectionDefinition(definition);
  if (!d.title) return { ok: false, error: 'Section title is required' };
  if (!d.query) return { ok: false, error: 'GitHub search query is required' };
  return { ok: true, value: d };
}

export function saveSectionDefinitions(definitions) {
  const valid = [];
  for (const definition of definitions || []) {
    const checked = validateSectionDefinition(definition);
    if (checked.ok) valid.push(checked.value);
  }
  writeJson(SECTIONS_FILE, valid);
  return valid;
}

export function deleteSectionDefinition(index) {
  const defs = loadSectionDefinitions();
  if (index < 0 || index >= defs.length) return { ok: false, error: 'Section index out of range' };
  defs.splice(index, 1);
  return { ok: true, definitions: saveSectionDefinitions(defs) };
}

export function upsertSectionDefinition(definition, index = -1) {
  const defs = loadSectionDefinitions();
  const checked = validateSectionDefinition(definition);
  if (!checked.ok) return checked;
  if (index >= 0 && index < defs.length) defs[index] = checked.value;
  else defs.push(checked.value);
  return { ok: true, value: checked.value, definitions: saveSectionDefinitions(defs) };
}

/**
 * Fetch data for all custom sections. Returns an array of section objects
 * with populated `items` arrays.
 */
export async function loadCustomSections(token) {
  const defs = loadSectionDefinitions();
  if (defs.length === 0) return [];

  const enabled = defs.filter(def => def.enabled !== false).slice(0, 12);
  // Fetch independent sections concurrently. The hard cap keeps a malformed
  // config from becoming an unbounded rate-limit fan-out.
  const sections = await Promise.all(enabled.map(async (def) => {
    try {
      const result = await request(
        '/search/issues?q=' + encodeURIComponent(def.query) +
        '&sort=updated&order=desc&per_page=' + (def.limit || 10),
        { token }
      );
      return { title: def.title, type: def.type, query: def.query,
        items: (result && result.items) || [], selected: 0, scroll: 0, error: null };
    } catch (error) {
      return { title: def.title, type: def.type, query: def.query,
        items: [], selected: 0, scroll: 0, error: error.message || 'Load failed' };
    }
  }));
  return sections;
}

/**
 * Get cached custom sections from appState.
 */
export function getCustomSections(appState) {
  return appState.customSections || [];
}

export function startSectionEditor(index = -1) {
  const defs = loadSectionDefinitions();
  const current = index >= 0 ? defs[index] : null;
  appState._sectionDraft = { ...(current || {}), index };
  startInput('Section title: ', 'section-title');
}

export function startSectionEdit(index = 0) { startSectionEditor(index); }

export function deleteSection(index = 0) {
  const result = deleteSectionDefinition(index);
  if (!result.ok) { showMessage(result.error, 'warning'); return result; }
  appState.customSections = result.definitions.map(d => ({ ...d, items: [], selected: 0, scroll: 0 }));
  appState.customSectionsLoaded = false;
  showMessage('Deleted custom section', 'success');
  render();
  return result;
}

export async function previewSection(index = 0, token = appState.token) {
  const defs = loadSectionDefinitions();
  const def = defs[index];
  if (!def) { showMessage('No custom section at index ' + (index + 1), 'warning'); return []; }
  try {
    const result = await request('/search/issues?q=' + encodeURIComponent(def.query) + '&per_page=' + def.limit, { token });
    const items = result?.items || [];
    showMessage('Preview: ' + items.length + ' result(s) for ' + def.title, 'info', 5000);
    return items;
  } catch (e) { showMessage('Preview failed: ' + e.message, 'error'); return []; }
}

registerInputHandler('section-title', (value) => {
  appState._sectionDraft.title = String(value || '').trim();
  startInput('Type (issues/prs): ', 'section-type');
});
registerInputHandler('section-type', (value) => {
  appState._sectionDraft.type = String(value || '').trim().toLowerCase() === 'prs' ? 'prs' : 'issues';
  startInput('GitHub search query: ', 'section-query');
});
registerInputHandler('section-query', (value) => {
  appState._sectionDraft.query = String(value || '').trim();
  startInput('Result limit (1-25): ', 'section-limit');
});
registerInputHandler('section-limit', (value) => {
  const draft = { ...appState._sectionDraft, limit: Number(value) || 10 };
  const index = Number.isInteger(draft.index) ? draft.index : -1;
  delete draft.index;
  const result = upsertSectionDefinition(draft, index);
  if (!result.ok) { showMessage(result.error, 'error'); return; }
  appState.customSections = result.definitions.map(d => ({ ...d, items: [], selected: 0, scroll: 0 }));
  appState.customSectionsLoaded = false;
  appState._sectionDraft = null;
  showMessage((index >= 0 ? 'Custom section updated' : 'Custom section saved') + ' — refresh Dashboard to load it', 'success');
  render();
});
