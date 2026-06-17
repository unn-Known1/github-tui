// GitHub REST API client. Zero external deps - pure node https.
// Supports any HTTP method, optional body, ETag caching, live rate-limit mirror.

import https from 'https';

const GITHUB_API = 'api.github.com';
const USER_AGENT = 'GitHub-TUI';

export const lastRateLimit = { remaining: null, limit: null, reset: null };
export const lastScopes = { scopes: [], accepted: [] };
const etagCache = new Map();

function buildOptions(path, token, method, body) {
  const headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'application/vnd.github.v3+json',
  };
  if (token) headers['Authorization'] = `token ${token}`;
  if (body != null) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  if (method === 'GET') {
    const cached = etagCache.get(`${method}:${path}`);
    if (cached && cached.etag) headers['If-None-Match'] = cached.etag;
  }
  return { hostname: GITHUB_API, path, method, headers };
}

export function request(path, opts) {
  const o = opts || {};
  const token = o.token || null;
  const method = o.method || 'GET';
  const body = o.body == null ? null : o.body;
  const accept = o.accept || null;
  const timeoutMs = o.timeoutMs || 15000;
  const raw = !!o.raw;
  const bodyStr = body == null ? null : JSON.stringify(body);

  return new Promise((resolve, reject) => {
    let settled = false;
    let req;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { if (req) req.destroy(); } catch (e) {}
      reject(new Error('Request timed out'));
    }, timeoutMs);

    const options = buildOptions(path, token, method, bodyStr);
    if (accept) options.headers['Accept'] = accept;

    req = https.request(options, (res) => {
      const rr = res.headers['x-ratelimit-remaining'];
      const rl = res.headers['x-ratelimit-limit'];
      const rs = res.headers['x-ratelimit-reset'];
      if (rr !== undefined) lastRateLimit.remaining = parseInt(rr, 10);
      if (rl !== undefined) lastRateLimit.limit = parseInt(rl, 10);
      if (rs !== undefined) lastRateLimit.reset = parseInt(rs, 10);
      const sc = res.headers['x-oauth-scopes'];
      const ac = res.headers['x-accepted-oauth-scopes'];
      if (sc !== undefined) lastScopes.scopes = sc.split(',').map(s => s.trim()).filter(Boolean);
      if (ac !== undefined) lastScopes.accepted = ac.split(',').map(s => s.trim()).filter(Boolean);

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (res.statusCode === 304) {
          const cached = etagCache.get(`${method}:${path}`);
          if (cached) return resolve(cached.body);
        }
        if (res.statusCode === 403 && rr === '0') {
          const resetDate = new Date(parseInt(rs, 10) * 1000);
          return reject(new Error('Rate limited. Try again at ' + resetDate.toLocaleTimeString()));
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          let payload;
          if (raw) payload = data;
          else if (res.statusCode === 204 || !data) payload = null;
          else {
            try { payload = JSON.parse(data); }
            catch (e) { return reject(new Error('Invalid JSON response')); }
          }
          if (method === 'GET' && res.headers.etag) {
            etagCache.set(`${method}:${path}`, { etag: res.headers.etag, body: payload });
          }
          return resolve(payload);
        }
        let msg = 'GitHub API error: ' + res.statusCode;
        try {
          const errBody = JSON.parse(data);
          if (errBody.message) msg += ' - ' + errBody.message;
        } catch (e) {}
        reject(new Error(msg));
      });
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    req.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('Connection closed'));
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── User & repos ───────────────────────────────────────────────────
export const getAuthenticatedUser = (token) => request('/user', { token });
export const getUserRepositories = (token, page, perPage) =>
  request('/user/repos?page=' + (page||1) + '&per_page=' + (perPage||50) + '&sort=updated', { token });
export const getUser = (token, username) => request('/users/' + username, { token });
export const searchRepositories = async (token, query, page, perPage) => {
  const r = await request('/search/repositories?q=' + encodeURIComponent(query) +
    '&page=' + (page||1) + '&per_page=' + (perPage||10), { token });
  return r.items || [];
};
export const getRepositoryDetails = (token, owner, repo) =>
  request('/repos/' + owner + '/' + repo, { token });
export const getRepositoryForks = (token, owner, repo, page, perPage) =>
  request('/repos/' + owner + '/' + repo + '/forks?page=' + (page||1) +
    '&per_page=' + (perPage||30) + '&sort=stargazers', { token });
export const getCompare = (token, owner, repo, base, head) =>
  request('/repos/' + owner + '/' + repo + '/compare/' + base + '...' + head, { token });
export const getRepositoryIssues = (token, owner, repo, page, perPage) =>
  request('/repos/' + owner + '/' + repo + '/issues?page=' + (page||1) +
    '&per_page=' + (perPage||10), { token });
export const getRepositoryPullRequests = (token, owner, repo, page, perPage) =>
  request('/repos/' + owner + '/' + repo + '/pulls?page=' + (page||1) +
    '&per_page=' + (perPage||10), { token });
export const getRepositoryContributors = (token, owner, repo, page, perPage) =>
  request('/repos/' + owner + '/' + repo + '/contributors?page=' + (page||1) +
    '&per_page=' + (perPage||10), { token });
export const getRepositoryLanguages = (token, owner, repo) =>
  request('/repos/' + owner + '/' + repo + '/languages', { token });
export const getRepositoryReleases = (token, owner, repo, page, perPage) =>
  request('/repos/' + owner + '/' + repo + '/releases?page=' + (page||1) +
    '&per_page=' + (perPage||5), { token });

// ─── Notifications ──────────────────────────────────────────────────
export const getNotifications = (token) => request('/notifications', { token });
export const markNotificationRead = (token, threadId) =>
  request('/notifications/threads/' + threadId, { token, method: 'PATCH' });
export const markAllNotificationsRead = (token) =>
  request('/notifications', { token, method: 'PUT', body: { read: true } });
export const unsubscribeNotification = (token, threadId) =>
  request('/notifications/threads/' + threadId + '/subscription', {
    token, method: 'PUT', body: { ignored: true },
  });

// ─── Activity, trending, starred ────────────────────────────────────
export const getUserEvents = (token, username, perPage) =>
  request('/users/' + username + '/events?per_page=' + (perPage||15), { token });
export const getTrendingRepos = async (token, days, perPage) => {
  const d = days || 7;
  const pp = perPage || 5;
  const since = new Date(Date.now() - d * 86400000).toISOString().split('T')[0];
  const q = encodeURIComponent('created:>' + since);
  const r = await request('/search/repositories?q=' + q +
    '&sort=stars&order=desc&per_page=' + pp, { token });
  return r.items || [];
};
export const getStarredRepos = (token, page, perPage) =>
  request('/user/starred?page=' + (page||1) + '&per_page=' + (perPage||30), { token });
export const isStarred = async (token, owner, repo) => {
  try { await request('/user/starred/' + owner + '/' + repo, { token }); return true; }
  catch (e) { return false; }
};
export const starRepo = (token, owner, repo) =>
  request('/user/starred/' + owner + '/' + repo, { token, method: 'PUT' });
export const unstarRepo = (token, owner, repo) =>
  request('/user/starred/' + owner + '/' + repo, { token, method: 'DELETE' });

// ─── Code, READMEs, file browser ────────────────────────────────────
export const getReadme = (token, owner, repo) =>
  request('/repos/' + owner + '/' + repo + '/readme', {
    token, accept: 'application/vnd.github.raw', raw: true,
  });
export const getRepoContents = (token, owner, repo, path, ref) =>
  request('/repos/' + owner + '/' + repo + '/contents/' + (path||'') +
    (ref ? '?ref=' + ref : ''), { token });
export const getRepoFile = (token, owner, repo, path, ref) =>
  request('/repos/' + owner + '/' + repo + '/contents/' + path +
    (ref ? '?ref=' + ref : ''), {
    token, accept: 'application/vnd.github.raw', raw: true,
  });
export const getRepoCommits = (token, owner, repo, perPage) =>
  request('/repos/' + owner + '/' + repo + '/commits?per_page=' + (perPage||10), { token });

// ─── User issues / PRs (for dashboard) ─────────────────────────────
export const getUserIssues = (token, page, perPage) =>
  request('/issues?filter=created&sort=updated&direction=desc&page=' + (page||1) +
    '&per_page=' + (perPage||10), { token });
export const getUserPullRequests = (token, page, perPage) =>
  request('/search/issues?q=author:@me+type:pr&sort=updated&order=desc&page=' + (page||1) +
    '&per_page=' + (perPage||10), { token });
export const getCommitActivity = (token, owner, repo) =>
  request('/repos/' + owner + '/' + repo + '/stats/commit_activity', { token });

// ─── Searches ───────────────────────────────────────────────────────
export const searchCode = async (token, query, page, perPage) => {
  const r = await request('/search/code?q=' + encodeURIComponent(query) +
    '&page=' + (page||1) + '&per_page=' + (perPage||20), { token });
  return r.items || [];
};
export const searchUsers = async (token, query, page, perPage) => {
  const r = await request('/search/users?q=' + encodeURIComponent(query) +
    '&page=' + (page||1) + '&per_page=' + (perPage||15), { token });
  return r.items || [];
};
export const searchIssues = async (token, query, page, perPage) => {
  const r = await request('/search/issues?q=' + encodeURIComponent(query) +
    '&page=' + (page||1) + '&per_page=' + (perPage||20), { token });
  return r.items || [];
};

// ─── Actions / Workflows  (CI cockpit foundation) ──────────────────
export const getWorkflows = (token, owner, repo) =>
  request('/repos/' + owner + '/' + repo + '/actions/workflows', { token });
export const getWorkflowRuns = (token, owner, repo, perPage) =>
  request('/repos/' + owner + '/' + repo + '/actions/runs?per_page=' + (perPage||20), { token });
export const rerunWorkflow = (token, owner, repo, runId) =>
  request('/repos/' + owner + '/' + repo + '/actions/runs/' + runId + '/rerun',
    { token, method: 'POST' });
export const cancelWorkflowRun = (token, owner, repo, runId) =>
  request('/repos/' + owner + '/' + repo + '/actions/runs/' + runId + '/cancel',
    { token, method: 'POST' });

// ─── Branches, zipball, per-file commits, raw bytes ──────────────────
export const getBranches = (token, owner, repo, perPage) =>
  request('/repos/' + owner + '/' + repo + '/branches?per_page=' + (perPage||50), { token });

export const getFileCommits = (token, owner, repo, path, perPage) =>
  request('/repos/' + owner + '/' + repo + '/commits?path=' +
    encodeURIComponent(path) + '&per_page=' + (perPage||10), { token });

// Returns the *redirect URL* to the zipball without following it. Used by the
// file-tree pane to hand the URL to a streaming download routine that writes
// straight to disk (so we don't buffer a 200 MB zip in memory).
export function getZipballUrl(owner, repo, ref) {
  return 'https://codeload.github.com/' + owner + '/' + repo +
    '/zip/refs/heads/' + (ref || 'main');
}

// Download an arbitrary URL straight to a local file path, streaming.
// Used for zipballs. Requires only built-in https.
export function downloadToFile(url, destPath, token) {
  return new Promise((resolve, reject) => {
    import('https').then(httpsMod => import('fs').then(fsMod => {
      const https = httpsMod.default;
      const fs = fsMod.default;
      const out = fs.createWriteStream(destPath);
      let bytes = 0;
      function get(u, redirectsLeft) {
        const u2 = new URL(u);
        const headers = { 'User-Agent': USER_AGENT };
        if (token) headers['Authorization'] = 'token ' + token;
        const req = https.get({
          hostname: u2.hostname,
          path: u2.pathname + u2.search,
          headers,
        }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
            res.resume();
            return get(res.headers.location, redirectsLeft - 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error('Download HTTP ' + res.statusCode));
          }
          res.on('data', (chunk) => { bytes += chunk.length; });
          res.pipe(out);
          out.on('finish', () => out.close(() => resolve({ bytes, path: destPath })));
        });
        req.on('error', reject);
      }
      get(url, 5);
    }).catch(reject)).catch(reject);
  });
}

// ─── Cache utilities ────────────────────────────────────────────────
export function clearEtagCache() { etagCache.clear(); }
export function etagCacheSize() { return etagCache.size; }
