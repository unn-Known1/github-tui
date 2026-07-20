// Custom user keybindings — loaded from ~/.github-tui/keybindings.json.
// Each binding maps a key to a shell command with placeholder substitution.
//
// Expected format:
// [
//   { "key": "E", "command": "code .", "label": "Open in VS Code", "context": "repo" },
//   { "key": "T", "command": "gh pr view {number} --web", "label": "View PR in browser", "context": "detail" }
// ]
//
// Supported placeholders: {owner}, {repo}, {number}, {branch}

import { KEYBINDINGS_FILE, readJson } from './config.mjs';
import { appState, tabState, showMessage, render } from './state.mjs';
import { spawn } from 'child_process';

let _bindings = null;

// Valid contexts for custom keybindings.
const VALID_CONTEXTS = new Set(['any', 'detail', 'repo', 'dashboard', 'files']);

// Validate a single binding entry. Returns null if valid, or an error message.
function validateBinding(binding, index) {
  if (!binding || typeof binding !== 'object') return `Entry ${index}: must be an object`;
  if (!binding.key || typeof binding.key !== 'string' || binding.key.length !== 1) {
    return `Entry ${index}: "key" must be a single character string`;
  }
  if (!binding.command || typeof binding.command !== 'string') {
    return `Entry ${index}: "command" is required and must be a string`;
  }
  if (binding.context && !VALID_CONTEXTS.has(binding.context)) {
    return `Entry ${index}: "context" must be one of: ${[...VALID_CONTEXTS].join(', ')}`;
  }
  if (binding.label && typeof binding.label !== 'string') {
    return `Entry ${index}: "label" must be a string if provided`;
  }
  return null;
}

function loadBindings() {
  if (_bindings === null) {
    const raw = readJson(KEYBINDINGS_FILE, []);
    if (!Array.isArray(raw)) {
      _bindings = [];
    } else {
      // Validate and filter entries, warning about invalid ones.
      const valid = [];
      for (let i = 0; i < raw.length; i++) {
        const err = validateBinding(raw[i], i);
        if (err) {
          showMessage('Keybindings: ' + err, 'warning');
        } else {
          valid.push(raw[i]);
        }
      }
      _bindings = valid;
    }
  }
  return _bindings;
}

/**
 * Shell-escape a single placeholder value for the current platform.
 * - POSIX sh: wraps in single quotes and escapes embedded single quotes.
 * - Windows cmd.exe: wraps in double quotes and escapes special characters.
 * This prevents a malicious repo name like "foo; rm -rf ~" from being
 * executed as a shell command.
 */
function shellEscape(value) {
  if (!value) return "''";
  const str = String(value);
  if (process.platform === 'win32') {
    // Windows cmd.exe escaping: wrap in double quotes, escape special chars
    return '"' + str.replace(/"/g, '""').replace(/%/g, '%%').replace(/!/g, '^!') + '"';
  }
  // POSIX sh escaping: wrap in single quotes, escape embedded single quotes
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

function resolvePlaceholders(cmd) {
  let resolved = cmd;

  // From detail view
  if (appState.detailData) {
    const d = appState.detailData;
    resolved = resolved.replace(/\{number\}/g, shellEscape(String(d.number || '')));
    resolved = resolved.replace(/\{branch\}/g, shellEscape((d.head && d.head.ref) || ''));
  }

  // From repo context
  if (appState.repoDetails) {
    const r = appState.repoDetails;
    const [owner, repo] = (r.full_name || '').split('/');
    resolved = resolved.replace(/\{owner\}/g, shellEscape(owner || ''));
    resolved = resolved.replace(/\{repo\}/g, shellEscape(repo || ''));
  } else if (appState.localRepo) {
    resolved = resolved.replace(/\{owner\}/g, shellEscape(appState.localRepo.owner || ''));
    resolved = resolved.replace(/\{repo\}/g, shellEscape(appState.localRepo.repo || ''));
  }

  // Clean up any remaining unreplaced placeholders
  resolved = resolved.replace(/\{[a-zA-Z]+\}/g, "''");

  return resolved;
}

function contextMatches(binding) {
  const ctx = binding.context || 'any';
  if (ctx === 'any') return true;
  if (ctx === 'detail') return !!appState.showDetail;
  if (ctx === 'repo') return !!appState.repoDetails || !!appState.localRepo;
  if (ctx === 'dashboard') {
    return tabState.current === 0 && !appState.showDetail;
  }
  return true;
}

/**
 * Try to handle a key press via custom keybindings.
 * Returns true if a binding was matched and executed, false otherwise.
 */
export function runCustomKey(key) {
  const bindings = loadBindings();
  if (bindings.length === 0) return false;

  const binding = bindings.find(b => b.key === key && contextMatches(b));
  if (!binding) return false;

  const cmd = resolvePlaceholders(binding.command);
  showMessage('Running: ' + (binding.label || cmd), 'info');

  try {
    const child = spawn(cmd, [], { shell: true, timeout: 30000, stdio: 'ignore' });
    child.on('error', (e) => showMessage('Command failed: ' + (e.message || 'unknown'), 'error'));
    child.on('exit', (code) => {
      showMessage(
        code === 0 ? '✓ ' + (binding.label || 'Command') + ' complete'
                   : 'Command exited with code ' + code,
        code === 0 ? 'success' : 'error'
      );
      render();
    });
  } catch (e) {
    showMessage('Failed: ' + (e.message || 'unknown'), 'error');
  }

  return true;
}
