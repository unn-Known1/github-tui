// GitHub REST API client. Zero external deps - pure node https.
// Supports any HTTP method, optional body, ETag caching, live rate-limit mirror.

import https from 'https';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { dirname } from 'path';
import { ETAG_CACHE_FILE, LAST_SYNCED_FILE } from './config.mjs';

const GITHUB_API = 'api.github.com';
const USER_AGENT = 'GitHub-TUI';

// Structured API error — carries HTTP status and endpoint for better diagnostics.
export class GitHubApiError extends Error {
  constructor(message, status, endpoint) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status || 0;
    this.endpoint = endpoint || '';
  }
}

export const lastRateLimit = { remaining: null, limit: null, reset: null };
export const lastScopes = { scopes: [], accepted: [] };

// ── Offline detection ──
export const offlineState = { isOffline: false, lastOnline: null };

// ── ETag cache with LRU eviction and disk persistence ──
const etagCache = new Map();
const ETAG_CACHE_MAX = 500;
const ETAG_TTL = 300_000; // 5 minutes
let _cacheDirty = false;
let _cacheFlushTimer = null;

// ── Last-synced timestamps ──
const lastSynced = {};
let _syncedDirty = false;

// ── Disk-backed ETag cache ──

function loadEtagCache() {
  if (!ETAG_CACHE_FILE) return;
  try {
    if (!existsSync(ETAG_CACHE_FILE)) return;
    const raw = readFileSync(ETAG_CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const now = Date.now();
    for (const entry of parsed) {
      // Support both old [key, etag, body, ts] and new { key, etag, body, ts, lastAccess } formats
      let key, etag, body, ts, lastAccess;
      if (Array.isArray(entry)) {
        [key, etag, body, ts] = entry;
        lastAccess = ts;
      } else {
        ({ key, etag, body, ts, lastAccess } = entry);
      }
      if (now - ts < ETAG_TTL * 6) { // Disk cache lives 6x longer (30 min)
        etagCache.set(key, { etag, body, ts, lastAccess: lastAccess || ts });
      }
    }
  } catch { /* corrupt cache → discard silently */ }
}

function saveEtagCache() {
  if (!ETAG_CACHE_FILE) return;
  try {
    const entries = [];
    for (const [key, entry] of etagCache) {
      entries.push({ key, etag: entry.etag, body: entry.body, ts: entry.ts, lastAccess: entry.lastAccess });
    }
    const dir = dirname(ETAG_CACHE_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(ETAG_CACHE_FILE, JSON.stringify(entries));
    try { chmodSync(ETAG_CACHE_FILE, 0o600); } catch {}
    _cacheDirty = false;
  } catch { /* non-fatal */ }
}

// Periodic cache flush — every 60s if dirty.
function scheduleCacheFlush() {
  if (_cacheFlushTimer) return;
  _cacheFlushTimer = setInterval(() => {
    if (_cacheDirty) saveEtagCache();
  }, 60_000);
  // Don't let the timer keep the process alive.
  if (_cacheFlushTimer.unref) _cacheFlushTimer.unref();
}

// LRU eviction — evict least recently accessed entries.
function evictLRU() {
  if (etagCache.size <= ETAG_CACHE_MAX) return;
  // First try expired entries.
  const now = Date.now();
  for (const [k, v] of etagCache) {
    if (now - v.ts >= ETAG_TTL) etagCache.delete(k);
  }
  // If still over limit, evict by lastAccess down to the limit (F013 fix).
  if (etagCache.size > ETAG_CACHE_MAX) {
    const entries = [...etagCache.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    const toRemove = entries.slice(0, etagCache.size - ETAG_CACHE_MAX);
    for (const [k] of toRemove) etagCache.delete(k);
  }
  _cacheDirty = true;
}

// ── Last-synced timestamps ──

function loadLastSynced() {
  if (!LAST_SYNCED_FILE) return;
  try {
    if (!existsSync(LAST_SYNCED_FILE)) return;
    const raw = readFileSync(LAST_SYNCED_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      Object.assign(lastSynced, parsed);
    }
  } catch { /* corrupt → discard */ }
}

function saveLastSynced() {
  if (!LAST_SYNCED_FILE) return;
  try {
    const dir = dirname(LAST_SYNCED_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(LAST_SYNCED_FILE, JSON.stringify(lastSynced, null, 2));
    _syncedDirty = false;
  } catch { /* non-fatal */ }
}

function recordSync(path, ts) {
  // allow caller to pass an explicit timestamp (used by cache-
  // serve paths so the sync stamp reflects data age, not "now").
  lastSynced[path] = (typeof ts === 'number') ? ts : Date.now();
  _syncedDirty = true;
}

export function getLastSynced(path) {
  return lastSynced[path] || null;
}

export function getAllLastSynced() {
  return { ...lastSynced };
}

// Load persisted data on module init.
loadEtagCache();
loadLastSynced();
scheduleCacheFlush();

// Save on exit.
process.on('exit', () => {
  if (_cacheDirty) saveEtagCache();
  if (_syncedDirty) saveLastSynced();
});
process.on('SIGINT', () => { saveEtagCache(); saveLastSynced(); });
process.on('SIGTERM', () => { saveEtagCache(); saveLastSynced(); });

// ── Cache stats ──

export function getCacheStats() {
  let totalBytes = 0;
  let oldestTs = Infinity;
  let newestTs = 0;
  for (const [, entry] of etagCache) {
    try { totalBytes += JSON.stringify(entry.body).length; } catch {}
    if (entry.ts < oldestTs) oldestTs = entry.ts;
    if (entry.ts > newestTs) newestTs = entry.ts;
  }
  return {
    entries: etagCache.size,
    maxEntries: ETAG_CACHE_MAX,
    totalBytes,
    totalKB: Math.round(totalBytes / 1024),
    oldestTs: oldestTs === Infinity ? null : oldestTs,
    newestTs: newestTs || null,
  };
}

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

// Minimum remaining API calls before we start being conservative with GETs.
const LOW_RATE_WARN = 10;

export function request(path, opts) {
  const o = opts || {};
  const token = o.token || null;
  const method = o.method || 'GET';
  const body = o.body == null ? null : o.body;
  const accept = o.accept || null;
  const timeoutMs = o.timeoutMs || 15000;
  const raw = !!o.raw;
  const bodyStr = body == null ? null : JSON.stringify(body);

  const cacheKey = `${method}:${path}`;

  // Offline mode: return cached data for GETs when offline.
  if (method === 'GET' && offlineState.isOffline) {
    const cached = etagCache.get(cacheKey);
    if (cached) {
      cached.lastAccess = Date.now();
      _cacheDirty = true;
      recordSync(path);   // keep last-synced fresh even when serving from cache
      return Promise.resolve(cached.body);
    }
    return Promise.reject(new Error('Offline — no cached data available'));
  }

  // Rate-limit-conservative mode: when budget is low, try cache before hitting the wire.
  if (method === 'GET' && lastRateLimit.remaining !== null && lastRateLimit.remaining < LOW_RATE_WARN) {
    const cached = etagCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < ETAG_TTL) {
      cached.lastAccess = Date.now();
      _cacheDirty = true;
      recordSync(path);   // same as offline path — refresh sync stamp
      return Promise.resolve(cached.body);
    }
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let req;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { if (req) req.destroy(); } catch (e) {}
      // Timeout while online → mark as potential offline.
      if (!offlineState.isOffline) {
        offlineState.isOffline = true;
      }
      reject(new Error('Request timed out'));
    }, timeoutMs);

    const options = buildOptions(path, token, method, bodyStr);
    if (accept) options.headers['Accept'] = accept;

    // Honor an external AbortSignal — when fired, kill the socket immediately
    // and reject so the caller's rate-limit budget isn't consumed by a no-op
    // wait for the response.
    const signal = o.signal;
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        return reject(new Error('Aborted'));
      }
      signal.addEventListener('abort', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { if (req) req.destroy(); } catch (e) {}
        reject(new Error('Aborted'));
      }, { once: true });
    }

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

      // We got a response — we're online.
      if (offlineState.isOffline) {
        offlineState.isOffline = false;
        offlineState.lastOnline = Date.now();
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (res.statusCode === 304) {
          const key = `${method}:${path}`;
          const cached = etagCache.get(key);
          if (cached && Date.now() - cached.ts < ETAG_TTL) {
            cached.lastAccess = Date.now();
            _cacheDirty = true;
            recordSync(path);
            return resolve(cached.body);
          }
          // Cache was stale or empty. The 304 means the server has the
          // resource — our problem, not its problem. Re-issue the GET
          // without `If-None-Match` so the server sends a fresh body,
          // then re-cache it normally. Cap at one retry so a pathological
          // server can't loop; second 304 falls through to normal error.
          etagCache.delete(key);
          if (!o._retried304) {
            return resolve(request(path, { ...o, _retried304: true }));
          }
        }
        if (res.statusCode === 403 && rr === '0') {
          const resetDate = new Date(parseInt(rs, 10) * 1000);
          return reject(new GitHubApiError(
            'Rate limited. Try again at ' + resetDate.toLocaleTimeString(),
            403, path
          ));
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          let payload;
          if (raw) payload = data;
          else if (res.statusCode === 204 || !data) payload = null;
          else {
            try { payload = JSON.parse(data); }
            catch (e) { return reject(new GitHubApiError('Invalid JSON response', res.statusCode, path)); }
          }
          if (method === 'GET' && res.headers.etag) {
            const now = Date.now();
            etagCache.set(`${method}:${path}`, { etag: res.headers.etag, body: payload, ts: now, lastAccess: now });
            evictLRU();
            _cacheDirty = true;
          }
          if (method === 'GET') recordSync(path);
          return resolve(payload);
        }
        let msg = 'GitHub API error ' + res.statusCode;
        try {
          const errBody = JSON.parse(data);
          if (errBody.message) msg += ': ' + errBody.message;
          if (errBody.errors && errBody.errors.length) {
            msg += ' (' + errBody.errors.map(e => e.message || e.code).join(', ') + ')';
          }
        } catch (e) {}
        // Invalidate ETag cache on 4xx errors (except 403 rate limit) to prevent stale data
        if (res.statusCode >= 400 && res.statusCode < 500 && res.statusCode !== 403) {
          const cacheKey = `${method}:${path}`;
          etagCache.delete(cacheKey);
        }
        reject(new GitHubApiError(msg, res.statusCode, path));
      });
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Network error → mark offline.
      offlineState.isOffline = true;
      // Try to return cached data for GETs.
      if (method === 'GET') {
        const cached = etagCache.get(cacheKey);
        if (cached) {
          cached.lastAccess = Date.now();
          _cacheDirty = true;
          recordSync(path);   // refresh sync stamp even on network-error recovery
          return resolve(cached.body);
        }
      }
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
export const getAuthenticatedUser = (token, signal) => request('/user', { token, signal });
export const getUserRepositories = (token, page, perPage, signal) =>
  request('/user/repos?page=' + (page||1) + '&per_page=' + (perPage||50) + '&sort=updated', { token, signal });
export const getUser = (token, username, signal) => request('/users/' + username, { token, signal });
export const searchRepositories = async (token, query, page, perPage, signal) => {
  const r = await request('/search/repositories?q=' + encodeURIComponent(query) +
    '&page=' + (page||1) + '&per_page=' + (perPage||100), { token, signal });
  return r.items || [];
};
export const getRepositoryDetails = (token, owner, repo, signal) =>
  request('/repos/' + owner + '/' + repo, { token, signal });
export const getRepositoryForks = (token, owner, repo, page, perPage, signal) =>
  request('/repos/' + owner + '/' + repo + '/forks?page=' + (page||1) +
    '&per_page=' + (perPage||30) + '&sort=stargazers', { token, signal });
export const getCompare = (token, owner, repo, base, head, signal) =>
  request('/repos/' + owner + '/' + repo + '/compare/' + base + '...' + head, { token, signal });
export const getRepositoryIssues = (token, owner, repo, page, perPage, state = 'open', signal) =>
  request('/repos/' + owner + '/' + repo + '/issues?page=' + (page||1) +
    '&per_page=' + (perPage||100) + '&state=' + state, { token, signal });
export const getRepositoryPullRequests = (token, owner, repo, page, perPage, state = 'open', signal) =>
  request('/repos/' + owner + '/' + repo + '/pulls?page=' + (page||1) +
    '&per_page=' + (perPage||100) + '&state=' + state, { token, signal });
export const getRepositoryContributors = (token, owner, repo, page, perPage, signal) =>
  request('/repos/' + owner + '/' + repo + '/contributors?page=' + (page||1) +
    '&per_page=' + (perPage||100), { token, signal });
export const getRepositoryLanguages = (token, owner, repo, signal) =>
  request('/repos/' + owner + '/' + repo + '/languages', { token, signal });
export const getRepositoryReleases = (token, owner, repo, page, perPage, signal) =>
  request('/repos/' + owner + '/' + repo + '/releases?page=' + (page||1) +
    '&per_page=' + (perPage||100), { token, signal });
export const getReleaseAssets = (token, owner, repo, releaseId, signal) =>
  request('/repos/' + owner + '/' + repo + '/releases/' + releaseId + '/assets', { token, signal });

// ─── Notifications ──────────────────────────────────────────────────
export const getNotifications = (token, page, perPage, signal) =>
  request('/notifications?page=' + (page||1) + '&per_page=' + (perPage||50), { token, signal });
export const markNotificationRead = (token, threadId) =>
  request('/notifications/threads/' + threadId, { token, method: 'PATCH' });
export const markAllNotificationsRead = (token) =>
  request('/notifications', { token, method: 'PUT', body: { read: true } });
export const unsubscribeNotification = (token, threadId) =>
  request('/notifications/threads/' + threadId + '/subscription', {
    token, method: 'DELETE',
  });

// ─── Activity, trending, starred ────────────────────────────────────
export const getUserEvents = (token, username, perPage, signal) =>
  request('/users/' + username + '/events?per_page=' + (perPage||15), { token, signal });
export const getTrendingRepos = async (token, days, perPage, signal) => {
  const d = days || 7;
  const pp = perPage || 5;
  const since = new Date(Date.now() - d * 86400000).toISOString().split('T')[0];
  const q = encodeURIComponent('created:>' + since);
  const r = await request('/search/repositories?q=' + q +
    '&sort=stars&order=desc&per_page=' + pp, { token, signal });
  return r.items || [];
};
export const getStarredRepos = (token, page, perPage, signal) =>
  request('/user/starred?page=' + (page||1) + '&per_page=' + (perPage||30), {
    token, signal,
    accept: 'application/vnd.github.v3.star+json',
  });
export const isStarred = async (token, owner, repo) => {
  try { await request('/user/starred/' + owner + '/' + repo, { token }); return true; }
  catch (e) {
    if (e && e.status === 404) return false;
    throw e;
  }
};
export const starRepo = (token, owner, repo) =>
  request('/user/starred/' + owner + '/' + repo, { token, method: 'PUT' });
export const unstarRepo = (token, owner, repo) =>
  request('/user/starred/' + owner + '/' + repo, { token, method: 'DELETE' });

// ─── Code, READMEs, file browser ────────────────────────────────────
export const getReadme = (token, owner, repo, signal) =>
  request('/repos/' + owner + '/' + repo + '/readme', {
    token, signal, accept: 'application/vnd.github.raw', raw: true,
  });
export const getRepoContents = (token, owner, repo, path, ref, signal) =>
  request('/repos/' + owner + '/' + repo + '/contents/' + (path||'') +
    (ref ? '?ref=' + ref : ''), { token, signal });
export const getRepoFile = (token, owner, repo, path, ref, signal) =>
  request('/repos/' + owner + '/' + repo + '/contents/' + path +
    (ref ? '?ref=' + ref : ''), {
    token, signal, accept: 'application/vnd.github.raw', raw: true,
  });
// ─── User issues / PRs (for dashboard) ─────────────────────────────
export const getUserIssues = (token, page, perPage, signal) =>
  request('/issues?filter=created&sort=updated&direction=desc&page=' + (page||1) +
    '&per_page=' + (perPage||100), { token, signal });
export const getUserPullRequests = (token, page, perPage, signal) =>
  request('/search/issues?q=author:@me+type:pr&sort=updated&order=desc&page=' + (page||1) +
    '&per_page=' + (perPage||100), { token, signal });
export const getCommitActivity = (token, owner, repo, signal) =>
  request('/repos/' + owner + '/' + repo + '/stats/commit_activity', { token, signal });

// ─── Actions / Workflows  (CI cockpit foundation) ──────────────────
export const getWorkflows = (token, owner, repo) =>
  request('/repos/' + owner + '/' + repo + '/actions/workflows', { token });
export const getWorkflowRuns = (token, owner, repo, perPage, signal) =>
  request('/repos/' + owner + '/' + repo + '/actions/runs?per_page=' + (perPage||20), { token, signal });
export const rerunWorkflow = (token, owner, repo, runId) =>
  request('/repos/' + owner + '/' + repo + '/actions/runs/' + runId + '/rerun',
    { token, method: 'POST' });
export const cancelWorkflowRun = (token, owner, repo, runId) =>
  request('/repos/' + owner + '/' + repo + '/actions/runs/' + runId + '/cancel',
    { token, method: 'POST' });
export const getWorkflowJobs = (token, owner, repo, runId, signal) =>
  request('/repos/' + owner + '/' + repo + '/actions/runs/' + runId + '/jobs', { token, signal });

// ─── Branches, zipball, per-file commits, raw bytes ──────────────────
export const getBranches = (token, owner, repo, perPage) =>
  request('/repos/' + owner + '/' + repo + '/branches?per_page=' + (perPage||50), { token });

export const getFileCommits = (token, owner, repo, path, perPage) =>
  request('/repos/' + owner + '/' + repo + '/commits?path=' +
    encodeURIComponent(path) + '&per_page=' + (perPage||10), { token });

// Returns the *redirect URL* to the zipball without following it. Used by the
// file-tree pane to hand the URL to a streaming download routine that writes
// straight to disk (so we don't buffer a 200 MB zip in memory).

// SECURITY: We use GitHub's universal archive URL
// (`/repos/{owner}/{repo}/archive/{ref}.zip`) which works for BOTH branches
// AND tags — the previous codeload.github.com heuristic
// (refs/tags vs refs/heads) mis-classified tags like `v1.10.0`, `release-2024`,
// `feature/foo`, or `v1.0.0-alpha` (F004 regression).
export function getZipballUrl(owner, repo, ref) {
  const r = ref || 'main';
  // Use the API archive endpoint — the codeload redirect heuristic was
  // unreliable for tag/branch names that don't start with "v?digits.digits".
  return 'https://api.github.com/repos/' + owner + '/' + repo +
    '/zipball/' + encodeURIComponent(r);
}

// Download an arbitrary URL straight to a local file path, streaming.
// Used for zipballs. Requires only built-in https.
import { createWriteStream } from 'fs';
export function downloadToFile(url, destPath, token) {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(destPath);
    let bytes = 0;
    let settled = false;
    function cleanup() {
      try { out.destroy(); } catch {}
    }
    function settle(fn) {
      if (settled) return;
      settled = true;
      fn();
    }
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
          if (redirectsLeft <= 0) { cleanup(); return settle(() => reject(new Error('Too many redirects'))); }
          res.resume();
          return get(res.headers.location, redirectsLeft - 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          cleanup();
          return settle(() => reject(new Error('Download HTTP ' + res.statusCode)));
        }
        res.on('data', (chunk) => { bytes += chunk.length; });
        res.pipe(out);
        out.on('finish', () => out.close(() => settle(() => resolve({ bytes, path: destPath }))));
        out.on('error', (e) => { cleanup(); settle(() => reject(e)); });
      });
      req.on('error', (e) => { cleanup(); settle(() => reject(e)); });
    }
    get(url, 5);
  });
}

// ─── Issue / PR detail, comments, actions ──────────────────────────
export const getIssue = (token, owner, repo, number, signal) =>
  request('/repos/' + owner + '/' + repo + '/issues/' + number, { token, signal });
export const getPullRequest = (token, owner, repo, number, signal) =>
  request('/repos/' + owner + '/' + repo + '/pulls/' + number, { token, signal });
export const getIssueComments = (token, owner, repo, number, page, perPage, signal) =>
  request('/repos/' + owner + '/' + repo + '/issues/' + number +
    '/comments?page=' + (page||1) + '&per_page=' + (perPage||20), { token, signal });
export const getPullRequestReviews = (token, owner, repo, number, signal) =>
  request('/repos/' + owner + '/' + repo + '/pulls/' + number + '/reviews', { token, signal });
export const getPullRequestFiles = (token, owner, repo, number, page, perPage, signal) =>
  request('/repos/' + owner + '/' + repo + '/pulls/' + number +
    '/files?page=' + (page||1) + '&per_page=' + (perPage||30), { token, signal });
export const postComment = (token, owner, repo, number, body) =>
  request('/repos/' + owner + '/' + repo + '/issues/' + number + '/comments', {
    token, method: 'POST', body: { body },
  });
export const createReaction = (token, owner, repo, issueNumber, content) =>
  request('/repos/' + owner + '/' + repo + '/issues/' + issueNumber +
    '/reactions', { token, method: 'POST', body: { content },
    accept: 'application/vnd.github.squirrel-girl-preview+json',
  });
export const closeIssue = (token, owner, repo, number) =>
  request('/repos/' + owner + '/' + repo + '/issues/' + number, {
    token, method: 'PATCH', body: { state: 'closed' },
  });
export const reopenIssue = (token, owner, repo, number) =>
  request('/repos/' + owner + '/' + repo + '/issues/' + number, {
    token, method: 'PATCH', body: { state: 'open' },
  });
export const mergePullRequest = (token, owner, repo, number, mergeMethod) =>
  request('/repos/' + owner + '/' + repo + '/pulls/' + number + '/merge', {
    token, method: 'PUT', body: { merge_method: mergeMethod || 'merge' },
  });
export const requestReview = (token, owner, repo, number, reviewers) =>
  request('/repos/' + owner + '/' + repo + '/pulls/' + number + '/requested_reviewers', {
    token, method: 'POST', body: { reviewers },
  });

// ─── Rate Limit ────────────────────────────────────────────────────
export const getRateLimit = (token) =>
  request('/rate_limit', { token });

// ─── Traffic ────────────────────────────────────────────────────────
export const getRepoTrafficViews = (token, owner, repo) =>
  request('/repos/' + owner + '/' + repo + '/traffic/views', { token });
export const getRepoTrafficClones = (token, owner, repo) =>
  request('/repos/' + owner + '/' + repo + '/traffic/clones', { token });
export const getRepoTrafficPopularPaths = (token, owner, repo) =>
  request('/repos/' + owner + '/' + repo + '/traffic/popular/paths', { token });
export const getRepoTrafficPopularReferrers = (token, owner, repo) =>
  request('/repos/' + owner + '/' + repo + '/traffic/popular/referrers', { token });

// ─── Milestones ─────────────────────────────────────────────────────
export const getRepoMilestones = (token, owner, repo, page, perPage) =>
  request('/repos/' + owner + '/' + repo + '/milestones?page=' + (page||1) +
    '&per_page=' + (perPage||20), { token });

// ─── Labels ─────────────────────────────────────────────────────────
export const getRepoLabels = (token, owner, repo, page, perPage) =>
  request('/repos/' + owner + '/' + repo + '/labels?page=' + (page||1) +
    '&per_page=' + (perPage||100), { token });

// ─── Checks/CI ─────────────────────────────────────────────────────
export const getRepoCheckRuns = (token, owner, repo, ref) =>
  request('/repos/' + owner + '/' + repo + '/commits/' + (ref || 'HEAD') + '/check-runs', { token });

export const getRepoCheckSuites = (token, owner, repo, ref) =>
  request('/repos/' + owner + '/' + repo + '/commits/' + (ref || 'HEAD') + '/check-suites', { token });

// ─── Followers ─────────────────────────────────────────────────────
export const getUserFollowers = (token, page, perPage) =>
  request('/user/followers?page=' + (page||1) + '&per_page=' + (perPage||30), { token });

export const getUserFollowing = (token, page, perPage) =>
  request('/user/following?page=' + (page||1) + '&per_page=' + (perPage||30), { token });

// ─── Security (Dependabot) ────────────────────────────────────────
export const getRepoDependabotAlerts = (token, owner, repo, state) =>
  request('/repos/' + owner + '/' + repo + '/dependabot/alerts' + (state ? '?state=' + state : ''), { token });
export const getDependabotAlert = (token, owner, repo, alertId) =>
  request('/repos/' + owner + '/' + repo + '/dependabot/alerts/' + alertId, { token });
export const dismissDependabotAlert = (token, owner, repo, alertId, dismissedReason, comment) =>
  request('/repos/' + owner + '/' + repo + '/dependabot/alerts/' + alertId, {
    token, method: 'PATCH', body: { dismissed_reason: dismissedReason, dismissed_comment: comment || '' },
  });

// ─── Security (Secret Scanning) ───────────────────────────────────

export const getSecretScanningAlerts = (token, owner, repo, state, signal) =>
  request('/repos/' + owner + '/' + repo + '/secret-scanning/alerts' +
    (state ? '?state=' + state : ''), { token, signal });

// ─── Security (Code Scanning) ─────────────────────────────────────
export const getCodeScanningAlerts = (token, owner, repo, state, perPage) =>
  request('/repos/' + owner + '/' + repo + '/code-scanning/alerts' +
    (state ? '?state=' + state : '') +
    (perPage ? (state ? '&' : '?') + 'per_page=' + perPage : ''), { token });

// ─── Security Advisories ──────────────────────────────────────────
export const getSecurityAdvisories = (token, owner, repo) =>
  request('/repos/' + owner + '/' + repo + '/security-advisories', { token });

// ─── Branch Protection ────────────────────────────────────────────
export const getBranchProtection = (token, owner, repo, branch) =>
  request('/repos/' + owner + '/' + repo + '/branches/' + encodeURIComponent(branch) + '/protection', { token });

// ─── Dependency Graph ─────────────────────────────────────────────
export const getDependencyGraphManifests = (token, owner, repo) =>
  request('/repos/' + owner + '/' + repo + '/dependency-graph/manifests', {
    token, accept: 'application/vnd.github.hawthorn-preview+json',
  });

// ─── User search ──────────────────────────────────────────────────
export async function searchUsers(token, query, page, perPage) {
  const r = await request('/search/users?q=' + encodeURIComponent(query) +
    '&page=' + (page||1) + '&per_page=' + (perPage||20), { token });
  return r.items || [];
}

// ─── Code search ──────────────────────────────────────────────────
export async function searchCode(token, query, page, perPage) {
  const r = await request('/search/code?q=' + encodeURIComponent(query) +
    '&page=' + (page||1) + '&per_page=' + (perPage||20), { token });
  return r.items || [];
}

// ─── Repo subscription (watch/unwatch) ─────────────────────────────
export const getSubscription = (token, owner, repo) =>
  request('/repos/' + owner + '/' + repo + '/subscription', { token });
export const setSubscription = (token, owner, repo, subscribed, ignored) =>
  request('/repos/' + owner + '/' + repo + '/subscription', {
    token, method: 'PUT', body: { subscribed, ignored: ignored || false },
  });
export const deleteSubscription = (token, owner, repo) =>
  request('/repos/' + owner + '/' + repo + '/subscription', { token, method: 'DELETE' });

// ─── Create issue ─────────────────────────────────────────────────
export const createIssue = (token, owner, repo, title, body, labels, assignees) =>
  request('/repos/' + owner + '/' + repo + '/issues', {
    token, method: 'POST',
    body: { title, body: body || '', labels: labels || [], assignees: assignees || [] },
  });
