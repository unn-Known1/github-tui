// Create Issue workflow — multi-step form: pick repo → enter title → optional body.
// Extracted from keys.mjs for maintainability.

import { appState, render, showMessage } from './state.mjs';
import { startInput, registerInputHandler } from './input.mjs';
import { createIssue } from './github.mjs';

let _issueRepoIndex = 0;
let _issueTitle = '';
let _issueBody = '';

registerInputHandler('issue-title', async (value) => {
  const title = (value || '').trim();
  if (!title) { showMessage('Issue title cannot be empty', 'error'); return; }
  _issueTitle = title;
  const repos = appState.repos;
  const repoName = repos[_issueRepoIndex] ? repos[_issueRepoIndex].full_name : '?';
  startInput('Issue body for ' + repoName + ' (optional, Enter to skip): ', 'issue-body');
});

registerInputHandler('issue-body', async (value) => {
  const body = (value || '').trim();
  _issueBody = body;
  const repos = appState.repos;
  if (!repos[_issueRepoIndex]) { showMessage('No repo selected', 'error'); return; }
  const repo = repos[_issueRepoIndex];
  const [owner, name] = repo.full_name.split('/');
  try {
    const result = await createIssue(appState.token, owner, name, _issueTitle, _issueBody);
    if (result && result.html_url) {
      showMessage('✓ Created issue: "' + result.title + '" on ' + repo.full_name, 'success');
    } else {
      showMessage('Issue created on ' + repo.full_name, 'success');
    }
  } catch (e) {
    showMessage(e.message || 'Failed to create issue', 'error');
  }
  _issueTitle = '';
  _issueBody = '';
});

registerInputHandler('issue-pick-repo', (value) => {
  const idx = parseInt(value, 10);
  const repos = appState.repos;
  if (isNaN(idx) || idx < 0 || idx >= repos.length) {
    showMessage('Invalid repo number', 'error');
    _issueTitle = '';
    _issueBody = '';
    return;
  }
  _issueRepoIndex = idx;
  const repoName = repos[idx].full_name;
  showMessage('Selected: ' + repoName, 'info', 2000);
  startInput('Issue title for ' + repoName + ': ', 'issue-title');
});

export function startCreateIssue() {
  const repos = appState.repos;
  if (!appState.token) { showMessage('Login first', 'warning'); return; }
  if (repos.length === 0) { showMessage('No repos loaded', 'warning'); return; }
  const shown = repos.slice(0, 8);
  const names = shown.map((r, i) => i + ':' + r.name).join(' · ');
  const more = repos.length > 8 ? ' …+' + (repos.length - 8) + ' more' : '';
  showMessage(names + more, 'info', 6000);
  startInput('Repo number (0-' + (repos.length - 1) + '): ', 'issue-pick-repo');
}
