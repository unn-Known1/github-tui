import { appState, render, showMessage, confirm } from './state.mjs';
import { createRelease, updateRelease } from './github.mjs';
import { startInput, registerInputHandler } from './input.mjs';

export function startReleaseDraft() {
  if (!appState.repoDetails || !appState.token) { showMessage('Open a repository and sign in first', 'warning'); return; }
  appState._releaseDraft = {};
  startInput('Release tag (for example v1.2.0): ', 'release-tag');
}
registerInputHandler('release-tag', (value) => {
  appState._releaseDraft.tag_name = String(value || '').trim();
  if (!appState._releaseDraft.tag_name) { showMessage('Release tag is required', 'warning'); return; }
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
      appState._releaseDraft = null;
      render();
    } catch (e) { showMessage('Release failed: ' + e.message, 'error'); }
  }, 'Create draft release');
});

export function publishRelease() {
  if (!appState.repoDetails || !appState.token) { showMessage('Open a repository and sign in first', 'warning'); return; }
  startInput('Release id to publish: ', 'release-publish-id');
}
registerInputHandler('release-publish-id', (value) => {
  const id = String(value || '').trim();
  if (!id) return;
  const repo = appState.repoDetails;
  const [owner, name] = repo.full_name.split('/');
  confirm('Publish release ' + id + ' on ' + repo.full_name + '?', async () => {
    try { await updateRelease(appState.token, owner, name, id, { draft: false }); showMessage('Release published', 'success'); render(); }
    catch (e) { showMessage('Publish failed: ' + e.message, 'error'); }
  }, 'Publish release');
});

export function editRelease() {
  if (!appState.repoDetails || !appState.token) { showMessage('Open a repository and sign in first', 'warning'); return; }
  startInput('Release id and JSON patch (id|{"name":"..."}): ', 'release-edit');
}
registerInputHandler('release-edit', (value) => {
  const [id, raw] = String(value || '').split('|');
  if (!id || !raw) { showMessage('Use id|JSON patch', 'warning'); return; }
  let patch;
  try { patch = JSON.parse(raw); } catch { showMessage('Release patch must be valid JSON', 'error'); return; }
  const allowed = ['tag_name', 'target_commitish', 'name', 'body', 'draft', 'prerelease'];
  patch = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)));
  const [owner, name] = appState.repoDetails.full_name.split('/');
  confirm('Update release ' + id.trim() + ' on ' + appState.repoDetails.full_name + '?', async () => {
    try { await updateRelease(appState.token, owner, name, id.trim(), patch); showMessage('Release updated', 'success'); render(); }
    catch (e) { showMessage('Release update failed: ' + e.message, 'error'); }
  }, 'Edit release');
});
