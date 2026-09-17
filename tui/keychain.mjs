// OS keychain abstraction — zero external dependencies.
// Uses native OS tools via child_process to store the GitHub PAT securely:
//   macOS  : Keychain Services via `security` CLI (built-in)
//   Linux  : libsecret via `secret-tool` (GNOME) or plaintext fallback
//   Windows: Credential Manager via `cmdkey` + PowerShell (built-in)

// The module never throws — every public function returns a value or null/false
// so callers can always fall back to plaintext gracefully.

import { execFileSync } from 'child_process';
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { platform, homedir } from 'os';

const PLATFORM = platform();
const SERVICE  = 'github-tui';
const ACCOUNT  = 'user';

// ── Backend detection ────────────────────────────────────────────────

/**
 * Detect which secure storage backend is available on this system.
 * Returns one of: 'macos-keychain' | 'secret-tool' | 'windows-credential' | null
 * null means no secure backend — caller should fall back to plaintext.
 */
export function detectBackend() {
  try {
    if (PLATFORM === 'darwin') {
      return _hasCommand('security') ? 'macos-keychain' : null;
    }
    if (PLATFORM === 'linux') {
      if (_hasCommand('secret-tool')) return 'secret-tool';
      return null;
    }
    if (PLATFORM === 'win32') {
      // cmdkey is built-in on all Windows; PowerShell is needed for retrieval
      return _hasCommand('cmdkey') ? 'windows-credential' : null;
    }
  } catch {
    // Ignore detection errors — fall back to plaintext
  }
  return null;
}

// Cache backend detection result so we don't shell out on every token read.
let _cachedBackend = undefined;
export function resetBackendCache() { _cachedBackend = undefined; _saveRetriedOnce = false; }
function _backend() {
  if (_cachedBackend === undefined) _cachedBackend = detectBackend();
  return _cachedBackend;
}

// A cached backend can go stale (tool uninstalled). Clear it when the
// spawn itself fails so the next call re-detects instead of failing forever.
function _noteSpawnError(e) {
  if (e && (e.code === 'ENOENT' || e.errno === 'ENOENT')) _cachedBackend = undefined;
}

// when saving, allow one re-detection in case the user installed
// `secret-tool` (Linux) or signed into macOS Keychain AFTER the first read.
// Read paths stick to the cached value (avoids per-call shell-outs).
let _saveRetriedOnce = false;
function _backendForSave() {
  if (_cachedBackend !== null || _saveRetriedOnce) return _cachedBackend;
  _saveRetriedOnce = true;
  const fresh = detectBackend();
  if (fresh) _cachedBackend = fresh;
  return _cachedBackend;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Save a token to the OS keychain.
 * Returns true on success, false if no secure backend or save failed.
 */
export function saveTokenSecure(token) {
  if (!token) return false;
  // re-detect once on save in case a backend appeared after first read.
  const backend = _backendForSave();
  try {
    if (backend === 'macos-keychain')     return _saveMacos(token);
    if (backend === 'secret-tool')        return _saveSecretTool(token);
    if (backend === 'windows-credential') return _saveWindows(token);
  } catch (e) {
    _noteSpawnError(e);
    _debug('keychain saveTokenSecure failed (' + backend + '):', e.message);
  }
  return false;
}

/**
 * Load a token from the OS keychain.
 * Returns the token string on success, or null if not found / no backend.
 */
export function loadTokenSecure() {
  const backend = _backend();
  try {
    if (backend === 'macos-keychain')     return _loadMacos();
    if (backend === 'secret-tool')        return _loadSecretTool();
    if (backend === 'windows-credential') return _loadWindows();
  } catch (e) {
    _noteSpawnError(e);
    _debug('keychain loadTokenSecure failed (' + backend + '):', e.message);
  }
  return null;
}

/**
 * Remove a token from the OS keychain.
 * Always succeeds silently even if the entry does not exist.
 */
export function removeTokenSecure() {
  const backend = _backend();
  try {
    if (backend === 'macos-keychain')     _removeMacos();
    else if (backend === 'secret-tool')   _removeSecretTool();
    else if (backend === 'windows-credential') _removeWindows();
  } catch (e) {
    _debug('keychain removeTokenSecure failed (' + backend + '):', e.message);
  }
}

// ── macOS Keychain (security CLI) ───────────────────────────────────

function _saveMacos(token) {
  // Bare `-w` reads the password from stdin — the token never appears in
  // argv, so it is invisible to `ps` / process auditors. (Older code passed
  // `-w <token>`, which leaked the PAT to the local process list.)
  execFileSync(
    'security',
    ['add-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-U', '-w'],
    { input: String(token), stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
  );
  return true;
}

function _loadMacos() {
  const out = execFileSync(
    'security',
    ['find-generic-password', '-s', SERVICE, '-w'],
    { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8', timeout: 5000 }
  ).trim();
  return out || null;
}

function _removeMacos() {
  try {
    execFileSync(
      'security',
      ['delete-generic-password', '-s', SERVICE],
      { stdio: 'pipe', timeout: 5000 }
    );
  } catch { /* entry may not exist — ignore */ }
}

// ── Linux libsecret (secret-tool) ───────────────────────────────────

function _saveSecretTool(token) {
  // secret-tool reads the secret from stdin — it never appears on a
  // command line. Attribute values are separate argv items now.
  execFileSync(
    'secret-tool',
    ['store', '--label=GitHub TUI Token', 'service', SERVICE, 'username', ACCOUNT],
    { input: token, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8', timeout: 5000 }
  );
  return true;
}

function _loadSecretTool() {
  const out = execFileSync(
    'secret-tool',
    ['lookup', 'service', SERVICE, 'username', ACCOUNT],
    { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8', timeout: 5000 }
  ).trim();
  return out || null;
}

function _removeSecretTool() {
  try {
    execFileSync(
      'secret-tool',
      ['clear', 'service', SERVICE, 'username', ACCOUNT],
      { stdio: 'pipe', timeout: 5000 }
    );
  } catch { /* entry may not exist — ignore */ }
}

// ── Windows Credential Manager (cmdkey + PowerShell) ────────────────

function _saveWindows(token) {
  // LIMITATION: cmdkey has no stdin mode — /pass: is the only way to store
  // non-interactively, so the secret is briefly visible in the process list
  // to the same user. This is an OS-tool constraint (no native dep allowed);
  // the token is never logged, never shelled, and the child lives <5s.
  // Prefer secret-tool/macOS backends where available.
  execFileSync(
    'cmdkey',
    ['/generic:' + SERVICE, '/user:' + ACCOUNT, '/pass:' + String(token)],
    { stdio: 'pipe', timeout: 5000 }
  );
  return true;
}

function _loadWindows() {
  // cmdkey cannot print the password; PowerShell's CredentialManager can
  // We use [System.Net.NetworkCredential] which is always available
  const safeService = String(SERVICE).replace(/'/g, "''");
  const ps =
    `$c = Get-StoredCredential -Target '${safeService}'; ` +
    `if ($c) { $c.GetNetworkCredential().Password }`;
  try {
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8', timeout: 5000 }
    ).trim();
    return out || null;
  } catch {
    // PowerShell CredentialManager cmdlet may not be installed on all setups
    // Fall back gracefully — caller will use plaintext
    return null;
  }
}

function _removeWindows() {
  try {
    execFileSync('cmdkey', ['/delete:' + SERVICE], { stdio: 'pipe', timeout: 5000 });
  } catch { /* entry may not exist — ignore */ }
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Check if a CLI command exists on PATH without throwing. */
function _hasCommand(cmd) {
  try {
    if (PLATFORM === 'win32') {
      execFileSync('where', [cmd], { stdio: 'pipe', timeout: 3000 });
    } else {
      // POSIX: no external binary — use the shell builtin directly.
      execFileSync('sh', ['-c', 'command -v "$1" >/dev/null 2>&1', '_', cmd],
        { stdio: 'pipe', timeout: 3000 });
    }
    return true;
  } catch {
    return false;
  }
}

/** Write debug messages when DEBUG env var is set. */
function _debug(...args) {
  if (process.env.DEBUG || process.env.GITHUB_TUI_DEBUG) {
    try {
      const dir = join(homedir(), '.github-tui');
      try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); } catch {}
      appendFileSync(
        join(dir, 'debug.log'),
        '[keychain] ' + args.join(' ') + '\n'
      );
    } catch {}
  }
}
