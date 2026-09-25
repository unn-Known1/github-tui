// Error recovery helper — provides consistent error handling with recovery hints.

import { showMessage, setRetryHandler, clearRetryHandler } from './state.mjs';

// Error recovery patterns with suggested actions.
// Each entry is { pattern, recovery }: `message`/`action` fields were
// removed — nothing consumed them, and the unreachable settings-import
// inside `action` silently no-op'd on load failure.
const RECOVERY_PATTERNS = [
  {
    pattern: /401|Bad credentials|Unauthorized/i,
    recovery: 'Check your token in Settings [0] — press Enter on the sign-in step',
  },
  {
    pattern: /403|rate limit|abuse/i,
    recovery: 'Wait for rate limit reset or check permissions',
  },
  {
    pattern: /404|Not Found/i,
    recovery: 'Verify the repository or resource exists',
  },
  {
    // System error codes and specific phrases only — the old /network|fetch/i
    // matched any error text containing those English words ("Failed to fetch
    // user preferences") and produced the wrong recovery hint.
    pattern: /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|getaddrinfo|fetch failed|network request failed/i,
    recovery: 'Check your internet connection',
  },
  {
    pattern: /ETIMEDOUT|timeout/i,
    recovery: 'The server may be slow — try again',
  },
  {
    pattern: /ECONNRESET/i,
    recovery: 'Network instability — try again',
  },
  {
    pattern: /SSL|certificate/i,
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
  // Coerce safely: String(null) is "null", which broad patterns (e.g.
  // /network|fetch/i historically) could match and mislabel.
  const safeMessage = typeof message === 'string' ? message : '';

  let recoveryHint = '';
  for (const p of RECOVERY_PATTERNS) {
    // Guard the regex input (not the pattern): p.pattern.test(null)
    // coerces to "null" and risks a false-positive match.
    if (p.pattern.test(safeMessage)) {
      recoveryHint = p.recovery;
      break;
    }
  }

  const prefix = context ? context + ': ' : '';
  let fullMessage = prefix + (safeMessage || 'Unknown error');
  if (recoveryHint) {
    fullMessage += ' — ' + recoveryHint;
  }

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
      // Guard onError: if it throws, that exception must not replace the
      // original error below.
      if (options.onError) {
        try { options.onError(e); } catch { /* keep the original error */ }
      }
      // Swallow after notifying: most callers here are fire-and-forget
      // (keypress handlers awaiting an unawaited promise) — rethrowing
      // turned every notified failure into an unhandled rejection.
      // Callers that need the failure signal can pass options.onError.
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
