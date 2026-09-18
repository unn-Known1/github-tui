// Detect the GitHub repo from the current working directory's git remote.
// Returns { owner, repo } or null if not in a git repo or remote is not GitHub.

import { execFileSync } from 'child_process';
import { resolve as resolvePath } from 'path';
import { existsSync, statSync, readFileSync } from 'fs';

// Run a git command with argv-array form — remote names can contain shell
// metacharacters, and string-concatenated execSync would execute them.
function gitOut(args, timeoutMs = 5000) {
  return execFileSync('git', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: timeoutMs,
    maxBuffer: 64 * 1024,
    encoding: 'utf-8',
  }).trim();
}

// Local worktree metadata for the Local tab (v0.8). Independent of the
// GitHub remote: works in local-only, GitLab, and Bitbucket checkouts.
// Never throws — not-a-repo / no-git / odd states yield { isRepo: false }.
export function getLocalGitMeta() {
  const empty = { isRepo: false, root: '', gitDir: '', branch: '', upstream: null };
  try {
    const inside = gitOut(['rev-parse', '--is-inside-work-tree']);
    if (inside !== 'true') return empty;
    const root = gitOut(['rev-parse', '--show-toplevel']);
    if (!root) return empty;
    // --git-dir may print a relative path (`.git`) or, for worktrees and
    // submodules, a gitdir-pointer file. Resolve against cwd so watchers
    // and op-state checks always get a real directory.
    let gitDir = '';
    try {
      const rawDir = gitOut(['rev-parse', '--git-dir']);
      gitDir = rawDir && rawDir.startsWith('/')
        ? rawDir
        : resolvePath(process.cwd(), rawDir || '.git');
    } catch {
      gitDir = '';
    }
    // Worktrees and submodules store a `gitdir: <path>` POINTER file at
    // `<root>/.git` instead of a directory — follow it so op-state file
    // checks (MERGE_HEAD, …) land in the real git dir.
    try {
      if (gitDir && existsSync(gitDir) && statSync(gitDir).isFile()) {
        const ptr = readFileSync(gitDir, 'utf-8').trim();
        const m = ptr.match(/^gitdir:\s*(.+)$/);
        if (m) gitDir = m[1].startsWith('/') ? m[1] : resolvePath(process.cwd(), m[1]);
      }
    } catch { /* keep the unresolved path — callers treat misses as absent */ }
    let branch = '';
    try {
      branch = gitOut(['symbolic-ref', '--short', '-q', 'HEAD']);
    } catch {
      branch = '';
    }
    if (!branch) {
      // Detached HEAD (or unborn with an exotic ref): fall back to short SHA.
      try {
        const sha = gitOut(['rev-parse', '--short', 'HEAD']);
        branch = 'HEAD (detached ' + sha + ')';
      } catch {
        branch = 'HEAD (detached)';
      }
    }
    let upstream = null;
    try {
      upstream = gitOut(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']) || null;
    } catch {
      upstream = null;
    }
    return { isRepo: true, root, gitDir, branch, upstream };
  } catch {
    return empty;
  }
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
