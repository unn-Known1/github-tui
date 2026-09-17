// Detect the GitHub repo from the current working directory's git remote.
// Returns { owner, repo } or null if not in a git repo or remote is not GitHub.

import { execFileSync } from 'child_process';

// Run a git command with argv-array form — remote names can contain shell
// metacharacters, and string-concatenated execSync would execute them.
function gitOut(args, timeoutMs = 5000) {
  return execFileSync('git', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: timeoutMs,
    encoding: 'utf-8',
  }).trim();
}

export function detectLocalRepo() {
  try {
    let url;
    try {
      url = gitOut(['remote', 'get-url', 'origin']);
    } catch {
      // Fallback: get the first remote name and query its URL
      const remotes = gitOut(['remote']).split(/\s+/);
      if (remotes.length > 0 && remotes[0]) {
        url = gitOut(['remote', 'get-url', remotes[0]]);
      }
    }

    if (!url) return null;

    const cleanUrl = url.replace(/\/$/, '');

    // Handle both SSH and HTTPS formats. The host must be anchored at the
    // START of the URL — an unanchored substring match misclassified any
    // remote whose PATH contained "github.com/..." (e.g.
    // https://evil.example/github.com/octocat/hello-world) as a GitHub repo.
    const httpsMatch = cleanUrl.match(/^https?:\/\/github\.com\/([^/]+)\/(.+)$/i);
    const sshMatch = httpsMatch ? null : cleanUrl.match(/^git@github\.com:([^/]+)\/(.+)$/i);
    const sshAltMatch = (httpsMatch || sshMatch) ? null : cleanUrl.match(/^ssh:\/\/git@github\.com\/([^/]+)\/(.+)$/i);
    const match = httpsMatch || sshMatch || sshAltMatch;
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
