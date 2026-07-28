// Error recovery helper — provides consistent error handling with recovery hints.

import { showMessage, setRetryHandler, clearRetryHandler } from './state.mjs';

// Error recovery patterns with suggested actions.
const RECOVERY_PATTERNS = [
  {
    pattern: /401|Bad credentials|Unauthorized/i,
    message: 'Authentication failed',
    recovery: 'Check your token in Settings [6]',
    action: () => { import('./tabs/settings.mjs').then(s => s.showLogin && s.showLogin()); },
  },
  {
    pattern: /403|rate limit|abuse/i,
    message: 'Rate limited or forbidden',
    recovery: 'Wait for rate limit reset or check permissions',
  },
  {
    pattern: /404|Not Found/i,
    message: 'Resource not found',
    recovery: 'Verify the repository or resource exists',
  },
  {
    pattern: /ENOTFOUND|ECONNREFUSED|network|fetch/i,
    message: 'Network error',
    recovery: 'Check your internet connection',
  },
  {
    pattern: /ETIMEDOUT|timeout/i,
    message: 'Request timed out',
    recovery: 'The server may be slow — try again',
  },
  {
    pattern: /ECONNRESET/i,
    message: 'Connection reset',
    recovery: 'Network instability — try again',
  },
  {
    pattern: /SSL|certificate/i,
    message: 'SSL/TLS error',
    recovery: 'Check your system certificates',
  },
];

/**
 * Show an error with contextual recovery hint.
 * @param {string} message - The error message
 * @param {string} context - What operation failed (e.g., 'load repos', 'search')
 * @param {object} options - Optional: { retry: fn, duration: number }
 */
export function showError(message, context, options = {}) {
  const { retry, duration } = options;

  // Find matching recovery pattern
  let recoveryHint = '';
  for (const p of RECOVERY_PATTERNS) {
    if (p.pattern.test(message)) {
      recoveryHint = p.recovery;
      break;
    }
  }

  // Build the full message
  const prefix = context ? context + ': ' : '';
  let fullMessage = prefix + message;
  if (recoveryHint) {
    fullMessage += ' — ' + recoveryHint;
  }

  // Show with retry hint if available
  const displayDuration = duration || (retry ? 8000 : 3000);
  showMessage(fullMessage, 'error', displayDuration);
  // surface the retry handler so the footer can render "[r] to retry"
  // and `keys.mjs` can invoke it on the user's next `r` keystroke.
  // Calls without retry clear any stale handler so an old op can't be
  // re-triggered after a fresh, unrecoverable error.
  if (typeof retry === 'function') setRetryHandler(retry, displayDuration);
  else clearRetryHandler();
}

/**
 * Wrap an async function with error recovery.
 * @param {string} context - What operation this is
 * @param {function} fn - The async function to wrap
 * @param {object} options - Optional: { retry: fn, onError: fn }
 * @returns {function} Wrapped function
 */
export function withErrorRecovery(context, fn, options = {}) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      const message = e?.message || String(e);
      showError(message, context, { retry: options.retry ? () => options.retry(...args) : undefined });
      if (options.onError) options.onError(e);
      throw e;
    }
  };
}

/**
 * Create a retry handler for a failed operation.
 * @param {string} operation - Description of the operation
 * @param {function} retryFn - Function to call on retry
 * @returns {function} Handler that shows error with retry option
 */
export function createRetryHandler(operation, retryFn) {
  return (error) => {
    const message = error?.message || String(error);
    showError(message, operation, { retry: retryFn });
  };
}
