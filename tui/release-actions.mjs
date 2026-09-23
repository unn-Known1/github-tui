import { appState, render, showMessage, confirm } from './state.mjs';
import { createRelease, updateRelease } from './github.mjs';
import { startInput, registerInputHandler } from './input.mjs';

// The release draft lives on appState so a crash mid-flow leaves no module
// state behind — but a FAILED submit must clear it too, or the next
// startReleaseDraft inherits a half-filled draft. `_cancelReleaseDraft()`
// is the single cleanup point for every early-exit path.
function _cancelReleaseDraft() {
  appState._releaseDraft = null;
}

// Single guard for every entry point: an authed repo context is required.
// Returns true when the caller may proceed.
function requireRepoAuth() {
  if (!appState.repoDetails || !appState.token) {
    showMessage('Open a repository and sign in first', 'warning');
    return false;
  }
  return true;
}

export function startReleaseDraft() {
  if (!requireRepoAuth()) return;
  appState._releaseDraft = {};
  startInput('Release tag (for example v1.2.0): ', 'release-tag');
}
registerInputHandler('release-tag', (value) => {
  const tag = String(value || '').trim();
  if (!tag) {
    // End the flow cleanly: without this the TUI sits mid-flow with an
    // empty tag_name on the draft and no way forward.
    showMessage('Release tag is required — flow cancelled', 'warning');
    _cancelReleaseDraft();
    render();
    return;
  }
  appState._releaseDraft.tag_name = tag;
  startInput('Release name: ', 'release-name');
});
registerInputHandler('release-name', (value) => {
  appState._releaseDraft.name = String(value || '').trim();
  startInput('Release notes: ', 'release-body');
});
registerInputHandler('release-body', (value) => {
  const draft = { ...appState._releaseDraft, body: String(value || ''), draft: true, prerelease: false };
  const repo = appState.repoDetails;
  confirm('Create draft release ' + draft.tag_name + ' on ' + repo.full_name + '?', async () => {
    const [owner, name] = repo.full_name.split('/');
    try {
      await createRelease(appState.token, owner, name, draft);
      showMessage('Draft release created: ' + draft.tag_name, 'success');
    } catch (e) {
      showMessage('Release failed: ' + e.message, 'error');
    } finally {
      // Drop the draft on success AND failure so a retry never inherits
      // the previous attempt's tag/name/body.
      _cancelReleaseDraft();
      render();
    }
  }, 'Create draft release');
});

export function publishRelease() {
  if (!requireRepoAuth()) return;
  startInput('Release id to publish: ', 'release-publish-id');
}
registerInputHandler('release-publish-id', (value) => {
  const id = String(value || '').trim();
  if (!id) {
    // Mirror the tag handler: warn, then close/reset the input so the TUI
    // isn't left waiting for a follow-up value that will never come.
    showMessage('Release id is required — flow cancelled', 'warning');
    render();
    return;
  }
  const repo = appState.repoDetails;
  const [owner, name] = repo.full_name.split('/');
  confirm('Publish release ' + id + ' on ' + repo.full_name + '?', async () => {
    try { await updateRelease(appState.token, owner, name, id, { draft: false }); showMessage('Release published', 'success'); render(); }
    catch (e) { showMessage('Publish failed: ' + e.message, 'error'); }
  }, 'Publish release');
});

export function editRelease() {
  if (!requireRepoAuth()) return;
  // GT-19: guided form instead of raw JSON — sequential prompts (id → title
  // → tag → notes) with per-field validation, so a typo cannot silently
  // produce invalid JSON. The legacy one-shot `id|JSON` handler below is
  // kept for backward compatibility (scripts / muscle memory).
  appState._releaseEdit = {};
  startInput('Release id to edit: ', 'release-edit-id');
}
registerInputHandler('release-edit-id', (value) => {
  const id = String(value || '').trim();
  if (!id) { showMessage('Release id is required — flow cancelled', 'warning'); appState._releaseEdit = null; render(); return; }
  appState._releaseEdit.id = id;
  startInput('New title (empty to keep): ', 'release-edit-title');
});
registerInputHandler('release-edit-title', (value) => {
  if (!appState._releaseEdit) return;
  const title = String(value ?? '').trim();
  if (title) appState._releaseEdit.name = title;
  startInput('New tag (empty to keep): ', 'release-edit-tag');
});
registerInputHandler('release-edit-tag', (value) => {
  if (!appState._releaseEdit) return;
  const tag = String(value ?? '').trim();
  if (tag) appState._releaseEdit.tag_name = tag;
  startInput('New notes (empty to keep): ', 'release-edit-body');
});
registerInputHandler('release-edit-body', (value) => {
  const draft = appState._releaseEdit;
  if (!draft || !draft.id) { showMessage('Release edit flow expired — start again', 'warning'); return; }
  const body = String(value ?? '');
  if (body.trim()) draft.body = body;
  const { id, ...patch } = draft;
  appState._releaseEdit = null;
  const allowed = ['tag_name', 'target_commitish', 'name', 'body', 'draft', 'prerelease'];
  const filtered = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)));
  if (Object.keys(filtered).length === 0) {
    showMessage('Nothing to update — all fields left empty', 'warning');
    render();
    return;
  }
  const [owner, name] = appState.repoDetails.full_name.split('/');
  confirm('Update release ' + String(id).trim() + ' on ' + appState.repoDetails.full_name + '?', async () => {
    try { await updateRelease(appState.token, owner, name, String(id).trim(), filtered); showMessage('Release updated', 'success'); render(); }
    catch (e) { showMessage('Release update failed: ' + e.message, 'error'); }
  }, 'Edit release');
});
registerInputHandler('release-edit', (value) => {
  // Legacy one-shot `id|JSON` path — kept for scripts/muscle memory.
  // Split on the FIRST pipe only — the JSON patch itself may contain '|'
  // (e.g. in a release body), and split('|') silently truncated it.
  const text = String(value || '');
  const sep = text.indexOf('|');
  const id = sep === -1 ? '' : text.slice(0, sep).trim();
  const raw = sep === -1 ? '' : text.slice(sep + 1);
  if (!id || !raw.trim()) { showMessage('Use id|JSON patch', 'warning'); return; }
  let patch;
  try { patch = JSON.parse(raw); } catch { showMessage('Release patch must be valid JSON', 'error'); return; }
  const allowed = ['tag_name', 'target_commitish', 'name', 'body', 'draft', 'prerelease'];
  const rejected = Object.keys(patch).filter(key => !allowed.includes(key));
  // Surface ignored keys — silently dropping them hides typos in an
  // explicitly typed interactive command.
  if (rejected.length) {
    showMessage('Ignored unsupported patch key(s): ' + rejected.join(', '), 'warning', 5000);
  }
  patch = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)));
  if (Object.keys(patch).length === 0) {
    showMessage('Nothing to update after filtering', 'warning');
    return;
  }
  const [owner, name] = appState.repoDetails.full_name.split('/');
  confirm('Update release ' + id.trim() + ' on ' + appState.repoDetails.full_name + '?', async () => {
    try { await updateRelease(appState.token, owner, name, id.trim(), patch); showMessage('Release updated', 'success'); render(); }
    catch (e) { showMessage('Release update failed: ' + e.message, 'error'); }
  }, 'Edit release');
});
