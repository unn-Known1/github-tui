// OS keychain abstraction — zero external dependencies.
// Uses native OS tools via child_process to store the GitHub PAT securely:
//   macOS  : Keychain Services via `security` CLI (built-in)
//   Linux  : libsecret via `secret-tool` (GNOME) or plaintext fallback
//   Windows: Credential Manager via `cmdkey` + PowerShell (built-in)
//
// The module never throws — every public function returns a value or null/false
// so callers can always fall back to plaintext gracefully.

import { execSync } from 'child_process';
import { appendFileSync } from 'fs';
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

// Cache backend detection result so we don't shell out on every token read
let _cachedBackend = undefined;
function _backend() {
  if (_cachedBackend === undefined) _cachedBackend = detectBackend();
  return _cachedBackend;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Save a token to the OS keychain.
 * Returns true on success, false if no secure backend or save failed.
 */
export function saveTokenSecure(token) {
  if (!token) return false;
  const backend = _backend();
  try {
    if (backend === 'macos-keychain')     return _saveMacos(token);
    if (backend === 'secret-tool')        return _saveSecretTool(token);
    if (backend === 'windows-credential') return _saveWindows(token);
  } catch (e) {
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
  // -U updates the entry if it already exists
  execSync(
    'security add-generic-password' +
    ' -s ' + _q(SERVICE) +
    ' -a ' + _q(ACCOUNT) +
    ' -w ' + _q(token) +
    ' -U',
    { stdio: 'pipe', timeout: 5000 }
  );
  return true;
}

function _loadMacos() {
  const out = execSync(
    'security find-generic-password -s ' + _q(SERVICE) + ' -w',
    { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8', timeout: 5000 }
  ).trim();
  return out || null;
}

function _removeMacos() {
  try {
    execSync(
      'security delete-generic-password -s ' + _q(SERVICE),
      { stdio: 'pipe', timeout: 5000 }
    );
  } catch { /* entry may not exist — ignore */ }
}

// ── Linux libsecret (secret-tool) ───────────────────────────────────

function _saveSecretTool(token) {
  // secret-tool reads the secret from stdin
  execSync(
    'secret-tool store --label=' + _q('GitHub TUI Token') +
    ' service ' + _q(SERVICE) +
    ' username ' + _q(ACCOUNT),
    { input: token, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8', timeout: 5000 }
  );
  return true;
}

function _loadSecretTool() {
  const out = execSync(
    'secret-tool lookup service ' + _q(SERVICE) + ' username ' + _q(ACCOUNT),
    { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8', timeout: 5000 }
  ).trim();
  return out || null;
}

function _removeSecretTool() {
  try {
    execSync(
      'secret-tool clear service ' + _q(SERVICE) + ' username ' + _q(ACCOUNT),
      { stdio: 'pipe', timeout: 5000 }
    );
  } catch { /* entry may not exist — ignore */ }
}

// ── Windows Credential Manager (cmdkey + PowerShell) ────────────────

function _saveWindows(token) {
  // cmdkey stores the password directly
  execSync(
    'cmdkey /generic:' + SERVICE + ' /user:' + ACCOUNT + ' /pass:' + _qWin(token),
    { stdio: 'pipe', timeout: 5000 }
  );
  return true;
}

function _loadWindows() {
  // cmdkey cannot print the password; PowerShell's CredentialManager can
  // We use [System.Net.NetworkCredential] which is always available
  const ps =
    `$c = Get-StoredCredential -Target '${SERVICE}'; ` +
    `if ($c) { $c.GetNetworkCredential().Password }`;
  try {
    const out = execSync(
      'powershell -NoProfile -NonInteractive -Command "' + ps + '"',
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
    execSync('cmdkey /delete:' + SERVICE, { stdio: 'pipe', timeout: 5000 });
  } catch { /* entry may not exist — ignore */ }
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Check if a CLI command exists on PATH without throwing. */
function _hasCommand(cmd) {
  try {
    const probe = PLATFORM === 'win32'
      ? 'where ' + cmd
      : 'command -v ' + cmd + ' 2>/dev/null';
    execSync(probe, { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Shell-escape a string for POSIX shells.
 * Wraps the value in single quotes and escapes embedded single quotes.
 */
function _q(str) {
  return "'" + String(str).replace(/'/g, "'\\''") + "'";
}

/**
 * Escape a string for Windows cmd.exe — wrap in double quotes,
 * escape embedded double quotes with backslash.
 */
function _qWin(str) {
  return '"' + String(str).replace(/"/g, '\\"') + '"';
}

/** Write debug messages when DEBUG env var is set. */
function _debug(...args) {
  if (process.env.DEBUG || process.env.GITHUB_TUI_DEBUG) {
    try {
      appendFileSync(
        join(homedir(), '.github-tui', 'debug.log'),
        '[keychain] ' + args.join(' ') + '\n'
      );
    } catch {}
  }
}
