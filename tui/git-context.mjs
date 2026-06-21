// Detect the GitHub repo from the current working directory's git remote.
// Returns { owner, repo } or null if not in a git repo or remote is not GitHub.

import { execSync } from 'child_process';

export function detectLocalRepo() {
  try {
    let url;
    try {
      url = execSync('git remote get-url origin', {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
        encoding: 'utf-8',
      }).trim();
    } catch {
      // Fallback: get the first remote name and query its URL
      const remotes = execSync('git remote', {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
        encoding: 'utf-8',
      }).trim().split(/\s+/);
      if (remotes.length > 0 && remotes[0]) {
        url = execSync('git remote get-url ' + remotes[0], {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000,
          encoding: 'utf-8',
        }).trim();
      }
    }

    if (!url) return null;

    // Clean up trailing slash if any
    const cleanUrl = url.replace(/\/$/, '');

    // Handle both SSH and HTTPS formats: github.com:owner/repo.git or github.com/owner/repo
    const match = cleanUrl.match(/github\.com[:/]([^/]+)\/(.+)$/);
    if (match) {
      const owner = match[1];
      const repo = match[2].replace(/\.git$/, '');
      return { owner, repo };
    }

    return null;
  } catch {
    // Not a git repo, or git not installed — silently return null.
    return null;
  }
}
