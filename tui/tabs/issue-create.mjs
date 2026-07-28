// F009 stub: Create new issue from TUI via the command palette.

// The palette action `dashboard.new-issue` references this module. Until a
// full implementation lands, this stub launches a labeled input flow that
// asks the user for title + body, then creates an issue against the
// currently open repo (if any). Errors fall back to opening the GitHub
// "new issue" page in the user's browser so they can finish there.

import { appState, showMessage, render } from '../state.mjs';
import { startInput } from '../input.mjs';
import { openUrl } from '../utils.mjs';
import { createIssue } from '../github.mjs';

// Registered via registerInputHandler in keys.mjs / settings.mjs
let _pendingBody = null;

export async function startCreateIssue() {
  if (!appState.token) {
    showMessage('Login first (Settings → Login)', 'warning');
    return;
  }
  if (!appState.repoDetails || !appState.repoDetails.full_name) {
    showMessage('Open a repo on Explore first', 'warning');
    return;
  }
  _pendingBody = null;
  startInput('New issue title: ', 'create-issue-title');
}

export async function submitTitle(title) {
  const t = (title || '').trim();
  if (!t) { showMessage('Cancelled', 'info'); return; }
  startInput('Issue body (optional, /\u00b7 to skip): ', 'create-issue-body');
  // Stash title on appState so the body handler can read it.
  appState._newIssueTitle = t;
}

export async function submitBody(body) {
  const title = appState._newIssueTitle;
  appState._newIssueTitle = null;
  const [owner, repo] = appState.repoDetails.full_name.split('/');
  try {
    const bodyText = (body && body.trim()) || '';
    const created = await createIssue(appState.token, owner, repo, title, bodyText);
    if (created && created.html_url) {
      showMessage('Created issue #' + created.number, 'success');
      render();
    } else {
      // Fall back: open browser composer.
      const fallback = 'https://github.com/' + owner + '/' + repo + '/issues/new?title=' +
        encodeURIComponent(title);
      await openUrl(fallback);
      showMessage('Opened browser to finish issue creation', 'info');
    }
  } catch (e) {
    showMessage('Create issue failed: ' + (e && e.message || 'unknown'), 'error');
    // Always offer the browser fallback so the user is never stranded.
    try {
      const fallback = 'https://github.com/' + owner + '/' + repo + '/issues/new?title=' +
        encodeURIComponent(title);
      await openUrl(fallback);
    } catch {}
    render();
  }
}
