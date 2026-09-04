// GitHub REST API client. Zero external deps - pure node https.
// Supports any HTTP method, optional body, ETag caching, live rate-limit mirror.

import https from 'https';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, unlinkSync, createWriteStream } from 'fs';
import { dirname } from 'path';
import { ETAG_CACHE_FILE, LAST_SYNCED_FILE } from './config.mjs';

let GITHUB_API = 'api.github.com';
let GITHUB_WEB = 'github.com';
const USER_AGENT = 'GitHub-TUI';

/** Configure the API/web hosts for GitHub Enterprise Server profiles. */
export function configureGitHubHosts({ apiHost, webHost } = {}) {
  if (apiHost) GITHUB_API = String(apiHost).replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (webHost) GITHUB_WEB = String(webHost).replace(/^https?:\/\//, '').replace(/\/$/, '');
  return getGitHubHosts();
}
export function getGitHubHosts() { return { apiHost: GITHUB_API, webHost: GITHUB_WEB }; }

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

// Monotonic rate-limit mirror. The app fires many requests in parallel
// (dashboard widgets, background pagination, auto-refresh), so responses
// routinely arrive out of order: a stale response carrying an older, HIGHER
// `remaining` must never push the displayed counter back up (4923 → 4924),
// and the 60s `/rate_limit` poll must not jitter it either. Rules:
//   - stale window (incoming reset < stored reset) → ignore entirely;
//   - new window (reset moved forward), changed limit, or first baseline
//     → accept wholesale (a fresh window legitimately restores remaining);
//   - same window → `remaining` only moves down (take the minimum).
// Returns lastRateLimit for convenience. All inputs are validated so a
// malformed value can never poison the counter with NaN.
export function updateRateLimit(limit, remaining, reset) {
  const limOk = Number.isFinite(limit) && limit > 0;
  const remOk = Number.isFinite(remaining);
  const resetOk = Number.isFinite(reset) && reset > 0;
  if (!limOk && !remOk && !resetOk) return lastRateLimit;
  const storedReset = lastRateLimit.reset;
  // Late arrival from a previous window — its low `remaining` belongs to an
  // expired budget and must not drag the fresh window's counter down.
  if (resetOk && Number.isFinite(storedReset) && reset < storedReset) return lastRateLimit;
  const effectiveLimit = limOk ? limit : lastRateLimit.limit;
  const clampRemaining = (v) => Number.isFinite(effectiveLimit) && effectiveLimit > 0
    ? Math.min(Math.max(v, 0), effectiveLimit)
    : Math.max(v, 0);
  const newWindow = resetOk && Number.isFinite(storedReset) && reset > storedReset;
  const limitChanged = limOk && Number.isFinite(lastRateLimit.limit) && limit !== lastRateLimit.limit;
  if (newWindow || limitChanged || lastRateLimit.remaining === null || lastRateLimit.remaining === undefined) {
    if (limOk) lastRateLimit.limit = limit;
    if (remOk) lastRateLimit.remaining = clampRemaining(remaining);
    if (resetOk) lastRateLimit.reset = reset;
    return lastRateLimit;
  }
  if (remOk) {
    const clamped = clampRemaining(remaining);
    if (!Number.isFinite(lastRateLimit.remaining) || clamped < lastRateLimit.remaining) {
      lastRateLimit.remaining = clamped;
    }
  }
  if (limOk && !Number.isFinite(lastRateLimit.limit)) lastRateLimit.limit = limit;
  if (resetOk && !Number.isFinite(lastRateLimit.reset)) lastRateLimit.reset = reset;
  return lastRateLimit;
}

// Authoritative resync from the `/rate_limit` endpoint body (ground truth
// for the current window). Unlike updateRateLimit() — which only lets the
// counter move DOWN between polls so out-of-order responses can't jitter
// it — this overwrites all three fields, so a counter that drifted or got
// pinned (stale cache, bucket flap, missed headers) self-corrects on the
// next 60s poll, in BOTH directions. Only the rate-limit poll may call
// this; per-request headers must keep using updateRateLimit(). All inputs
// are validated; a malformed payload leaves the counter untouched.
export function resyncRateLimit(limit, remaining, reset) {
  if (!Number.isFinite(limit) || limit <= 0) return lastRateLimit;
  if (!Number.isFinite(remaining)) return lastRateLimit;
  lastRateLimit.limit = limit;
  lastRateLimit.remaining = Math.min(Math.max(remaining, 0), limit);
  if (Number.isFinite(reset) && reset > 0) lastRateLimit.reset = reset;
  return lastRateLimit;
}

// ── Offline detection ──
export const offlineState = { isOffline: false, lastOnline: null };

// ── ETag cache with LRU eviction and disk persistence ──
const etagCache = new Map();
const ETAG_CACHE_MAX = 500;
const ETAG_TTL = 300_000; // 5 minutes
let _cacheDirty = false;

function tokenIdentity(token) {
  return token
    ? createHash('sha256').update(String(token)).digest('hex').slice(0, 16)
    : 'anonymous';
}

export function cacheKeyFor(method, path, accept, raw, token) {
  // Keep credentials out of the persisted key while partitioning private
  // responses between accounts. An empty identity is the anonymous cache.
  return `v2:${GITHUB_API}:${method}:${path}:${accept || ''}:${raw ? 'raw' : 'json'}:${tokenIdentity(token)}`;
}

export function encodeRepoPath(path) {
  return String(path || '').split('/').map(encodeURIComponent).join('/');
}
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
      // Entries from the pre-account-partition format are intentionally
      // ignored. They could contain another user's private response and
      // cannot be safely attributed to the current token.
      if (typeof key !== 'string' || !key.startsWith('v2:')) continue;
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

function syncKey(path, token) {
  return `v2sync:${tokenIdentity(token)}:${path}`;
}

function recordSync(path, ts, token) {
  // Keep freshness metadata account-scoped just like response bodies. Cache
  // serves preserve the cached body's original age rather than claiming now.
  lastSynced[syncKey(path, token)] = (typeof ts === 'number') ? ts : Date.now();
  _syncedDirty = true;
}

export function getLastSynced(path, token = null) {
  return lastSynced[syncKey(path, token)] || null;
}

export function getAllLastSynced(token = null) {
  const prefix = `v2sync:${tokenIdentity(token)}:`;
  return Object.fromEntries(Object.entries(lastSynced)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, value]) => [key.slice(prefix.length), value]));
}

// Load persisted data on module init.
loadEtagCache();
loadLastSynced();
scheduleCacheFlush();

process.on('exit', () => {
  if (_cacheDirty) saveEtagCache();
  if (_syncedDirty) saveLastSynced();
});
process.on('SIGINT', () => { saveEtagCache(); saveLastSynced(); });
process.on('SIGTERM', () => { saveEtagCache(); saveLastSynced(); });

// ── Cache stats ──

export function clearAccountCache(token) {
  const identity = tokenIdentity(token);
  let removed = 0;
  for (const key of etagCache.keys()) {
    if (key.endsWith(':' + identity)) {
      etagCache.delete(key);
      removed++;
    }
  }
  const syncPrefix = 'v2sync:' + identity + ':';
  let syncRemoved = 0;
  for (const key of Object.keys(lastSynced)) {
    if (key.startsWith(syncPrefix)) { delete lastSynced[key]; syncRemoved++; }
  }
  if (removed > 0 || syncRemoved > 0) {
    _cacheDirty = true;
    _syncedDirty = true;
    saveEtagCache();
    saveLastSynced();
  }
  return removed;
}

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

function buildOptions(path, token, method, body, accept, raw) {
  const headers = {
    'User-Agent': USER_AGENT,
    'Accept': accept || 'application/vnd.github.v3+json',
  };
  if (token) headers['Authorization'] = `token ${token}`;
  if (body != null) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  if (method === 'GET') {
    const cached = etagCache.get(cacheKeyFor(method, path, accept, raw, token));
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
  // force: skip every cache short-circuit and go to the wire (no
  // If-None-Match). Used by the rate-limit poll: `/rate_limit` is free, and
  // a forced wire request both returns ground truth and proves the network
  // is back, clearing a latched offline flag that cached GETs never would.
  const force = !!o.force;

  const cacheKey = cacheKeyFor(method, path, accept, raw, token);

  // Offline mode: return cached data for GETs when offline.
  if (method === 'GET' && offlineState.isOffline && !force) {
    const cached = etagCache.get(cacheKey);
    if (cached) {
      cached.lastAccess = Date.now();
      _cacheDirty = true;
      recordSync(path, cached.ts, token);
      return Promise.resolve(cached.body);
    }
    return Promise.reject(new Error('Offline — no cached data available'));
  }

  // Rate-limit-conservative mode: when budget is low, try cache before hitting the wire.
  if (method === 'GET' && !force && lastRateLimit.remaining !== null && lastRateLimit.remaining < LOW_RATE_WARN) {
    const cached = etagCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < ETAG_TTL) {
      cached.lastAccess = Date.now();
      _cacheDirty = true;
      recordSync(path, cached.ts, token);
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
      // A slow endpoint is not proof that the whole connection is offline.
      // Prefer this request's cached response, if any, while preserving its
      // original age; only genuine socket errors can raise the global banner.
      if (method === 'GET') {
        const cached = etagCache.get(cacheKey);
        if (cached) {
          cached.lastAccess = Date.now();
          _cacheDirty = true;
          recordSync(path, cached.ts, token);
          return resolve(cached.body);
        }
      }
      reject(new Error('Request timed out'));
    }, timeoutMs);

    const options = buildOptions(path, token, method, bodyStr, accept, raw);
    if (accept) options.headers['Accept'] = accept;
    // Forced requests always fetch fresh: no conditional request, so the
    // server must answer 200 with current data (and fresh rate headers).
    if (force) delete options.headers['If-None-Match'];

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
      // Mirror the core rate-limit budget into lastRateLimit for the header
      // counter. Two guards matter:
      // 1. `x-ratelimit-resource` tells which bucket these headers belong to.
      //    Search/code-search endpoints carry tiny limits (e.g. 30/min) — adopting
      //    those would make the `API n/5000` indicator flicker to `n/30` after
      //    every search. Only `core` (or responses without the header, e.g.
      //    older GHES) update the counter.
      // 2. Updates go through updateRateLimit(): parallel responses arrive out
      //    of order, so a stale higher `remaining` must never push the counter
      //    back up, and malformed headers must never poison it with NaN.
      const resource = res.headers['x-ratelimit-resource'];
      if (resource === undefined || resource === 'core') {
        const rlParsed = res.headers['x-ratelimit-limit'] !== undefined
          ? parseInt(res.headers['x-ratelimit-limit'], 10) : NaN;
        const rrParsed = res.headers['x-ratelimit-remaining'] !== undefined
          ? parseInt(res.headers['x-ratelimit-remaining'], 10) : NaN;
        const rsParsed = res.headers['x-ratelimit-reset'] !== undefined
          ? parseInt(res.headers['x-ratelimit-reset'], 10) : NaN;
        // Monotonic: out-of-order responses can't push the counter back up.
        updateRateLimit(rlParsed, rrParsed, rsParsed);
      }
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
          const cached = etagCache.get(cacheKey);
          if (cached && Date.now() - cached.ts < ETAG_TTL) {
            cached.lastAccess = Date.now();
            _cacheDirty = true;
            recordSync(path, cached.ts, token);
            return resolve(cached.body);
          }
          // Cache was stale or empty. The 304 means the server has the
          // resource — our problem, not its problem. Re-issue the GET
          // without `If-None-Match` so the server sends a fresh body,
          // then re-cache it normally. Cap at one retry so a pathological
          // server can't loop; second 304 falls through to normal error.
          etagCache.delete(cacheKey);
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
            etagCache.set(cacheKey, { etag: res.headers.etag, body: payload, ts: now, lastAccess: now });
            evictLRU();
            _cacheDirty = true;
          }
          if (method === 'GET') recordSync(path, undefined, token);
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
          recordSync(path, cached.ts, token);
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
export const getUser = (token, username, signal) => request('/users/' + encodeURIComponent(username), { token, signal });
export const getUserRepos = (token, username, page, perPage, signal) =>
  request('/users/' + encodeURIComponent(username) + '/repos?page=' + (page||1) +
    '&per_page=' + (perPage||50) + '&sort=updated', { token, signal });
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
  const q = encodeURIComponent('created:>' + since + ' stars:>5');
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
  request('/repos/' + owner + '/' + repo + '/contents/' + encodeRepoPath(path) +
    (ref ? '?ref=' + encodeURIComponent(ref) : ''), { token, signal });
export const getRepoFile = (token, owner, repo, path, ref, signal) =>
  request('/repos/' + owner + '/' + repo + '/contents/' + encodeRepoPath(path) +
    (ref ? '?ref=' + encodeURIComponent(ref) : ''), {
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
export const getWorkflows = (token, owner, repo, signal) =>
  request('/repos/' + owner + '/' + repo + '/actions/workflows', { token, signal });
export const getWorkflowRuns = (token, owner, repo, page, perPage, signal) =>
  request('/repos/' + owner + '/' + repo + '/actions/runs?page=' + (page || 1) +
    '&per_page=' + (perPage || 20), { token, signal });
export const rerunWorkflow = (token, owner, repo, runId) =>
  request('/repos/' + owner + '/' + repo + '/actions/runs/' + runId + '/rerun',
    { token, method: 'POST' });
export const cancelWorkflowRun = (token, owner, repo, runId) =>
  request('/repos/' + owner + '/' + repo + '/actions/runs/' + runId + '/cancel',
    { token, method: 'POST' });
export const getWorkflowJobs = (token, owner, repo, runId, signal) =>
  request('/repos/' + owner + '/' + repo + '/actions/runs/' + runId + '/jobs', { token, signal });
export const getWorkflowJobLogs = (token, owner, repo, jobId, signal) =>
  fetchTextUrl('https://' + GITHUB_API + '/repos/' + owner + '/' + repo +
    '/actions/jobs/' + jobId + '/logs', token, signal);
export const dispatchWorkflow = (token, owner, repo, workflowId, ref, inputs = {}) =>
  request('/repos/' + owner + '/' + repo + '/actions/workflows/' + encodeURIComponent(workflowId) + '/dispatches', {
    token, method: 'POST', body: { ref, inputs },
  });

// ─── Branches, zipball, per-file commits, raw bytes ──────────────────
export const getBranches = (token, owner, repo, perPage, signal) =>
  request('/repos/' + owner + '/' + repo + '/branches?per_page=' + (perPage||50), { token, signal });

export const getFileCommits = (token, owner, repo, path, perPage, signal) =>
  request('/repos/' + owner + '/' + repo + '/commits?path=' +
    encodeURIComponent(path) + '&per_page=' + (perPage||10), { token, signal });
export const getRepoCommits = (token, owner, repo, page, perPage, ref, signal) =>
  request('/repos/' + owner + '/' + repo + '/commits?page=' + (page || 1) +
    '&per_page=' + (perPage || 30) + (ref ? '&sha=' + encodeURIComponent(ref) : ''), { token, signal });
export const getFileBlame = (token, owner, repo, path, ref, signal) =>
  request('/repos/' + owner + '/' + repo + '/commits?path=' + encodeURIComponent(path) +
    '&sha=' + encodeURIComponent(ref || 'HEAD') + '&per_page=100', { token, signal });

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
  return 'https://' + GITHUB_API + '/repos/' + owner + '/' + repo +
    '/zipball/' + encodeURIComponent(r);
}

// Download an arbitrary URL straight to a local file path, streaming.
// Used for zipballs. Requires only built-in https.
export function downloadToFile(url, destPath, token) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:') throw new Error('Download URL must use HTTPS');
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error('Invalid download URL'));
  }
  return new Promise((resolve, reject) => {
    const out = createWriteStream(destPath);
    let bytes = 0;
    let settled = false;
    let cleanupRequested = false;
    const removeDestination = () => {
      // A stream can finish opening after destroy() is called. Retry removal
      // on close so failed downloads cannot recreate an empty artifact.
      try { unlinkSync(destPath); } catch {}
    };
    function cleanup() {
      cleanupRequested = true;
      try { out.destroy(); } catch {}
      // Never leave a misleading partial archive at the requested path.
      removeDestination();
    }
    function settle(fn) {
      if (settled) return;
      settled = true;
      fn();
    }
    function get(u, redirectsLeft, sendToken = true) {
      let u2;
      try {
        u2 = new URL(u);
        if (u2.protocol !== 'https:') throw new Error('Download URL must use HTTPS');
      } catch (e) {
        cleanup();
        return settle(() => reject(e instanceof Error ? e : new Error('Invalid download URL')));
      }
      const headers = { 'User-Agent': USER_AGENT };
      // Never forward a GitHub token to a different host after a redirect.
      if (token && sendToken && u2.hostname === GITHUB_API) headers['Authorization'] = 'token ' + token;
      const req = https.get({
        hostname: u2.hostname,
        path: u2.pathname + u2.search,
        headers,
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) { cleanup(); return settle(() => reject(new Error('Too many redirects'))); }
          res.resume();
          let next;
          try {
            next = new URL(res.headers.location, u2);
          } catch (e) {
            cleanup();
            return settle(() => reject(new Error('Invalid download redirect')));
          }
          return get(next.toString(), redirectsLeft - 1, next.hostname === GITHUB_API);
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
        res.on('error', (e) => { cleanup(); settle(() => reject(e)); });
      });
      req.on('error', (e) => { cleanup(); settle(() => reject(e)); });
    }
    out.on('error', (e) => { cleanup(); settle(() => reject(e)); });
    out.on('close', () => {
      if (cleanupRequested) removeDestination();
    });
    get(parsedUrl.toString(), 5, true);
  });
}

// Fetch a redirected GitHub log as bounded text. This intentionally does not
// reuse JSON request(): the Actions logs endpoint redirects to a short-lived
// plain-text URL, often on a different host, and credentials must not follow
// that redirect.
export function fetchTextUrl(url, token, signal, maxBytes = 2_000_000) {
  return new Promise((resolve, reject) => {
    let current;
    try { current = new URL(url); } catch { return reject(new Error('Invalid log URL')); }
    if (current.protocol !== 'https:') return reject(new Error('Log URL must use HTTPS'));
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; fn(value); };
    const get = (u, redirectsLeft) => {
      if (signal?.aborted) return finish(reject, new Error('Aborted'));
      const headers = { 'User-Agent': USER_AGENT };
      if (token && u.hostname === GITHUB_API) headers.Authorization = 'token ' + token;
      const req = https.get({ hostname: u.hostname, path: u.pathname + u.search, headers }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) { res.resume(); return finish(reject, new Error('Too many log redirects')); }
          let next;
          try { next = new URL(res.headers.location, u); } catch { res.resume(); return finish(reject, new Error('Invalid log redirect')); }
          if (next.protocol !== 'https:') { res.resume(); return finish(reject, new Error('Log redirect must use HTTPS')); }
          res.resume();
          return get(next, redirectsLeft - 1);
        }
        if (res.statusCode !== 200) { res.resume(); return finish(reject, new GitHubApiError('Workflow log HTTP ' + res.statusCode, res.statusCode, u.pathname)); }
        let data = '', bytes = 0;
        res.setEncoding('utf8');
        res.on('data', chunk => {
          if (bytes >= maxBytes) return;
          const remaining = maxBytes - bytes;
          data += chunk.slice(0, remaining);
          bytes += Math.min(chunk.length, remaining);
        });
        res.on('end', () => finish(resolve, { text: data, truncated: bytes >= maxBytes, bytes, url: u.toString() }));
        res.on('error', e => finish(reject, e));
      });
      req.on('error', e => finish(reject, e));
      signal?.addEventListener('abort', () => { try { req.destroy(); } catch {} finish(reject, new Error('Aborted')); }, { once: true });
    };
    get(current, 5);
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
export const getPullRequestReviewComments = (token, owner, repo, number, page, perPage, signal) =>
  request('/repos/' + owner + '/' + repo + '/pulls/' + number + '/comments?page=' +
    (page || 1) + '&per_page=' + (perPage || 50), { token, signal });
export const submitPullRequestReview = (token, owner, repo, number, event, body, comments = []) =>
  request('/repos/' + owner + '/' + repo + '/pulls/' + number + '/reviews', {
    token, method: 'POST', body: { event, body: body || '', comments: Array.isArray(comments) ? comments : [] },
  });
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
export const requestReview = (token, owner, repo, number, reviewers, teamReviewers = []) =>
  request('/repos/' + owner + '/' + repo + '/pulls/' + number + '/requested_reviewers', {
    token, method: 'POST', body: { reviewers: reviewers || [], team_reviewers: teamReviewers || [] },
  });
export const updateIssue = (token, owner, repo, number, patch) =>
  request('/repos/' + owner + '/' + repo + '/issues/' + number, { token, method: 'PATCH', body: patch || {} });

// ─── Rate Limit ────────────────────────────────────────────────────
// force: always hit the wire — `/rate_limit` costs no quota, and a forced
// request doubles as an offline-recovery probe (cached GETs can never clear
// a latched offline flag or refresh ground truth).
export const getRateLimit = (token) =>
  request('/rate_limit', { token, force: true });

// ─── Traffic ────────────────────────────────────────────────────────
export const getRepoTrafficViews = (token, owner, repo, signal) =>
  request('/repos/' + owner + '/' + repo + '/traffic/views', { token, signal });
export const getRepoTrafficClones = (token, owner, repo, signal) =>
  request('/repos/' + owner + '/' + repo + '/traffic/clones', { token, signal });
export const getRepoTrafficPopularPaths = (token, owner, repo, signal) =>
  request('/repos/' + owner + '/' + repo + '/traffic/popular/paths', { token, signal });
export const getRepoTrafficPopularReferrers = (token, owner, repo, signal) =>
  request('/repos/' + owner + '/' + repo + '/traffic/popular/referrers', { token, signal });

// ─── Milestones ─────────────────────────────────────────────────────
export const getRepoMilestones = (token, owner, repo, page, perPage, signal) =>
  request('/repos/' + owner + '/' + repo + '/milestones?page=' + (page||1) +
    '&per_page=' + (perPage||20), { token, signal });

// ─── Labels ─────────────────────────────────────────────────────────
export const getRepoLabels = (token, owner, repo, page, perPage, signal) =>
  request('/repos/' + owner + '/' + repo + '/labels?page=' + (page||1) +
    '&per_page=' + (perPage||100), { token, signal });

// ─── Checks/CI ─────────────────────────────────────────────────────
export const getRepoCheckRuns = (token, owner, repo, ref, signal) =>
  request('/repos/' + owner + '/' + repo + '/commits/' + encodeURIComponent(ref || 'HEAD') + '/check-runs', { token, signal });

export const getRepoCheckSuites = (token, owner, repo, ref, signal) =>
  request('/repos/' + owner + '/' + repo + '/commits/' + encodeURIComponent(ref || 'HEAD') + '/check-suites', { token, signal });

// ─── Followers ─────────────────────────────────────────────────────
export const getUserFollowers = (token, page, perPage, signal) =>
  request('/user/followers?page=' + (page||1) + '&per_page=' + (perPage||30), { token, signal });

export const getUserFollowing = (token, page, perPage, signal) =>
  request('/user/following?page=' + (page||1) + '&per_page=' + (perPage||30), { token, signal });

// ─── Security (Dependabot) ────────────────────────────────────────
export const getRepoDependabotAlerts = (token, owner, repo, state, signal) =>
  request('/repos/' + owner + '/' + repo + '/dependabot/alerts' + (state ? '?state=' + encodeURIComponent(state) : ''), { token, signal });
export const getDependabotAlert = (token, owner, repo, alertId) =>
  request('/repos/' + owner + '/' + repo + '/dependabot/alerts/' + alertId, { token });
export const dismissDependabotAlert = (token, owner, repo, alertId, dismissedReason, comment) =>
  request('/repos/' + owner + '/' + repo + '/dependabot/alerts/' + alertId, {
    token, method: 'PATCH', body: { dismissed_reason: dismissedReason, dismissed_comment: comment || '' },
  });

// ─── Security (Secret Scanning) ───────────────────────────────────

export const getSecretScanningAlerts = (token, owner, repo, state, signal) =>
  request('/repos/' + owner + '/' + repo + '/secret-scanning/alerts' +
    (state ? '?state=' + encodeURIComponent(state) : ''), { token, signal });

// ─── Security (Code Scanning) ─────────────────────────────────────
export const getCodeScanningAlerts = (token, owner, repo, state, perPage, signal) =>
  request('/repos/' + owner + '/' + repo + '/code-scanning/alerts' +
    (state ? '?state=' + encodeURIComponent(state) : '') +
    (perPage ? (state ? '&' : '?') + 'per_page=' + perPage : ''), { token, signal });

// ─── Security Advisories ──────────────────────────────────────────
// Global GitHub Advisory Database feed — readable by ANY authenticated
// user, no repo write access needed. The repo-scoped endpoint
// (/repos/{o}/{r}/security-advisories) requires write access and 403s
// on read-only repos.
export const getGlobalSecurityAdvisories = (token, signal) =>
  request('/advisories?type=reviewed&per_page=30', { token, signal });

// ─── Branch Protection ────────────────────────────────────────────
export const getBranchProtection = (token, owner, repo, branch, signal) =>
  request('/repos/' + owner + '/' + repo + '/branches/' + encodeURIComponent(branch) + '/protection', { token, signal });

// ─── Dependency Graph (SBOM) ──────────────────────────────────────
// Export SBOM for a repo — read-accessible (public repos need no
// permissions). The old /dependency-graph/manifests preview endpoint was
// retired and 404s unconditionally.
export const getDependencyGraphSBOM = (token, owner, repo, signal) =>
  request('/repos/' + owner + '/' + repo + '/dependency-graph/sbom', {
    token, signal, accept: 'application/vnd.github+json',
  });

// ─── User search ──────────────────────────────────────────────────
export async function searchUsers(token, query, page, perPage, signal) {
  const r = await request('/search/users?q=' + encodeURIComponent(query) +
    '&page=' + (page||1) + '&per_page=' + (perPage||20), { token, signal });
  return r.items || [];
}

// ─── Code search ──────────────────────────────────────────────────
export async function searchCode(token, query, page, perPage, signal) {
  const r = await request('/search/code?q=' + encodeURIComponent(query) +
    '&page=' + (page||1) + '&per_page=' + (perPage||20), { token, signal });
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
export const getUserOrganizations = (token, page, perPage, signal) =>
  request('/user/orgs?page=' + (page || 1) + '&per_page=' + (perPage || 50), { token, signal });
export const getOrganizationRepos = (token, org, page, perPage, signal) =>
  request('/orgs/' + encodeURIComponent(org) + '/repos?page=' + (page || 1) +
    '&per_page=' + (perPage || 50) + '&sort=updated', { token, signal });
export const getOrganizationTeams = (token, org, page, perPage, signal) =>
  request('/orgs/' + encodeURIComponent(org) + '/teams?page=' + (page || 1) +
    '&per_page=' + (perPage || 50), { token, signal });
export const getRelease = (token, owner, repo, releaseId, signal) =>
  request('/repos/' + owner + '/' + repo + '/releases/' + releaseId, { token, signal });
export const createRelease = (token, owner, repo, payload) =>
  request('/repos/' + owner + '/' + repo + '/releases', { token, method: 'POST', body: payload || {} });
export const updateRelease = (token, owner, repo, releaseId, payload) =>
  request('/repos/' + owner + '/' + repo + '/releases/' + releaseId, { token, method: 'PATCH', body: payload || {} });
