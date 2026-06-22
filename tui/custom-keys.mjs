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
import { appState, showMessage, render } from './state.mjs';
import { spawn } from 'child_process';

let _bindings = null;

function loadBindings() {
  if (_bindings === null) {
    _bindings = readJson(KEYBINDINGS_FILE, []);
    if (!Array.isArray(_bindings)) _bindings = [];
  }
  return _bindings;
}

/**
 * Shell-escape a single placeholder value for POSIX sh.
 * Wraps the value in single quotes and escapes embedded single quotes.
 * This prevents a malicious repo name like "foo; rm -rf ~" from being
 * executed as a shell command.
 */
function shellEscape(value) {
  if (!value) return "''";
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
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
    return !appState.showDetail;
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
