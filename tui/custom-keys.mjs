// Custom user keybindings — loaded from ~/.github-tui/keybindings.json.
// Each binding maps a key to a shell command OR internal action.

// Expected format:
// [
//   { "key": "E", "command": "code .", "label": "Open in VS Code", "context": "repo" },
//   { "key": "T", "command": "gh pr view {number} --web", "label": "View PR in browser", "context": "detail" },
//   { "key": "s", "action": "star.toggle", "label": "Star repo", "context": "repo" }
// ]

// Supported placeholders: {owner}, {repo}, {number}, {branch}
// Supported actions: any registered palette action ID (e.g., 'star.toggle', 'refresh', etc.)

import { KEYBINDINGS_FILE, readJson } from './config.mjs';
import { appState, tabState, showMessage, render } from './state.mjs';
import { spawn } from 'child_process';

let _bindings = null;

// Valid contexts for custom keybindings.
const VALID_CONTEXTS = new Set(['any', 'detail', 'repo', 'dashboard', 'files', 'local', 'inbox', 'actions', 'settings']);

// Validate a single binding entry. Returns null if valid, or an error message.
function validateBinding(binding, index) {
  if (!binding || typeof binding !== 'object') return `Entry ${index}: must be an object`;
  if (!binding.key || typeof binding.key !== 'string' || binding.key.length !== 1) {
    return `Entry ${index}: "key" must be a single character string`;
  }
  // Must have either command or action
  if (!binding.command && !binding.action) {
    return `Entry ${index}: must have either "command" or "action"`;
  }
  if (binding.command && typeof binding.command !== 'string') {
    return `Entry ${index}: "command" must be a string if provided`;
  }
  if (binding.action && typeof binding.action !== 'string') {
    return `Entry ${index}: "action" must be a string if provided`;
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
export function shellEscape(value) {
  if (value == null) return "''";
  const str = String(value);
  if (str === '') return "''";
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
  // 'files' previously fell through to `return true`, so bindings scoped to
  // it fired in EVERY context. Gate it on the files pane actually rendering.
  if (ctx === 'files') {
    return appState.analyzeView === 'details' && appState.detailsPane === 'files';
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

  // Handle internal action
  if (binding.action) {
    return runInternalAction(binding);
  }

  // Handle shell command
  if (binding.command) {
    return runShellCommand(binding);
  }

  return false;
}

/**
 * Run an internal action (palette action).
 */
function runInternalAction(binding) {
  const actionId = binding.action;
  showMessage('Running: ' + (binding.label || actionId), 'info');

  // Try to find and execute the action via palette. The single outer
  // .catch covers BOTH the import and any throw from inside .then — the
  // old inner `.catch(() => { showMessage('Failed to load action module') })
  // swallowed real action errors and mislabeled them as module-load failures.
  import('./palette.mjs').then(palette => {
    const actions = palette.filter('');  // Get all actions
    const action = actions.find(a => a.id === actionId);
    if (action && action.run) {
      return Promise.resolve(action.run());
    }
    showMessage('Action not found: ' + actionId, 'error');
    return undefined;
  }).catch(e => {
    showMessage('Action failed: ' + ((e && e.message) || 'unknown'), 'error');
  });

  return true;
}

/**
 * Run a shell command.
 * TRUST BOUNDARY: the command template comes from the user's own config
 * file — it intentionally runs via `shell: true` so pipes/redirects work.
 * Untrusted data only enters through {placeholders}, which are always
 * shellEscape()d above; never interpolate repo/branch values directly.
 */
function runShellCommand(binding) {
  const cmd = resolvePlaceholders(binding.command);
  if (!cmd || !cmd.trim()) {
    showMessage('Empty command — nothing to run', 'warning');
    return true;
  }
  // Unresolved placeholders collapse to '' — a command like git checkout ''
  // would fail with a cryptic shell error, so validate the interesting
  // substitutions up front and abort with a clear message.
  if (/\{number\}|\{branch\}/.test(binding.command) && !appState.detailData) {
    showMessage('This command needs an issue/PR open in the detail view', 'warning');
    return true;
  }
  if (/\{owner\}|\{repo\}/.test(binding.command)
      && !appState.repoDetails && !appState.localRepo) {
    showMessage('This command needs an open repository', 'warning');
    return true;
  }
  showMessage('Running: ' + (binding.label || cmd), 'info');

  try {
    // stdio: pipe so failures are diagnosable (ignore previously discarded
    // stderr); kill()'d on timeout below so a SIGTERM-ignoring child can't
    // leak past the 30s window.
    const child = spawn(cmd, [], { shell: true, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', (e) => showMessage('Command failed: ' + (e.message || 'unknown'), 'error'));
    if (typeof child.kill === 'function') child.on('timeout', () => { try { child.kill('SIGKILL'); } catch {} });
    child.on('exit', (code) => {
      showMessage(
        code === 0 ? '✓ ' + (binding.label || 'Command') + ' complete'
                   : 'Command exited with code ' + code,
        code === 0 ? 'success' : 'error'
      );
    });
  } catch (e) {
    showMessage('Failed: ' + (e.message || 'unknown'), 'error');
  }

  return true;
}
