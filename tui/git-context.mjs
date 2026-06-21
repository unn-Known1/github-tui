// Detect the GitHub repo from the current working directory's git remote.
// Returns { owner, repo } or null if not in a git repo or remote is not GitHub.

import { execSync } from 'child_process';

export function detectLocalRepo() {
  try {
    const url = execSync('git remote get-url origin', {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
      encoding: 'utf-8',
    }).trim();

    // Handle SSH format: git@github.com:owner/repo.git
    let match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (match) {
      return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
    }

    // Handle HTTPS format: https://github.com/owner/repo.git
    match = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
    if (match) {
      return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
    }

    return null;
  } catch {
    // Not a git repo, or git not installed — silently return null.
    return null;
  }
}
