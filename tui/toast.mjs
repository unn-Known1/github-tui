// Stacked Toast Notification System
// Supports multiple toasts, auto-dismiss, and different variants.

import { render as appRender } from './state.mjs';
import { color } from './theme.mjs';
import { truncate, truncateToWidth } from './utils.mjs';

// Toast variants with theme colors
const VARIANT_STYLES = {
  info:    { icon: 'ⓘ', color: 'toastInfo' },
  success: { icon: '✓', color: 'toastSuccess' },
  error:   { icon: '✗', color: 'toastError' },
  warning: { icon: '⚠', color: 'toastWarning' },
};

// Toast storage
const toasts = [];
let toastIdCounter = 0;

/**
 * Show a toast notification.
 * @param {Object} options
 * @param {string} options.message - Toast message
 * @param {string} [options.variant='info'] - 'info' | 'success' | 'error' | 'warning'
 * @param {number} [options.duration=3000] - Auto-dismiss duration in ms (0 = no auto-dismiss)
 * @param {string} [options.title] - Optional title
 * @returns {number} Toast ID (for manual dismissal)
 */
export function showToast({ message, variant = 'info', duration = 3000, title }) {
  const id = ++toastIdCounter;
  const toast = {
    id,
    message,
    variant,
    title,
    createdAt: Date.now(),
    duration,
  };

  toasts.push(toast);

  // Auto-dismiss
  if (duration > 0) {
    setTimeout(() => {
      removeToast(id);
    }, duration);
  }

  appRender();
  return id;
}

/**
 * Remove a toast by ID.
 */
export function removeToast(id) {
  const idx = toasts.findIndex(t => t.id === id);
  if (idx !== -1) {
    toasts.splice(idx, 1);
    appRender();
  }
}

/**
 * Clear all toasts.
 */
export function clearToasts() {
  toasts.length = 0;
  appRender();
}

/**
 * Get current toasts (for rendering).
 */
export function getToasts() {
  return toasts;
}

/**
 * Render toasts on screen.
 * @param {Object} screen - Screen object
 */
export function renderToasts(screen) {
  if (toasts.length === 0) return;

  const W = screen.width;
  const startY = 2;  // Start below header
  const startX = W - 42;  // Right-aligned
  const maxVisible = Math.min(5, toasts.length);  // Max 5 visible toasts

  for (let i = 0; i < maxVisible; i++) {
    const toast = toasts[i];
    const y = startY + i * 3;  // 3 rows per toast
    const style = VARIANT_STYLES[toast.variant] || VARIANT_STYLES.info;
    const toastStyle = color(style.color);

    // Toast box background
    const boxW = Math.min(40, W - startX - 2);
    for (let xx = startX; xx < startX + boxW && xx < W; xx++) {
      screen.styleBuf[y][xx] = toastStyle;
      if (y + 1 < screen.height) screen.styleBuf[y + 1][xx] = toastStyle;
    }

    // Icon
    screen.writeStr(startX + 1, y, style.icon, toastStyle);

    // Title (if present)
    if (toast.title) {
      screen.writeStr(startX + 3, y, truncate(toast.title, boxW - 6), toastStyle);
      screen.writeStr(startX + 3, y + 1, truncate(toast.message, boxW - 6), toastStyle);
    } else {
      screen.writeStr(startX + 3, y, truncate(toast.message, boxW - 6), toastStyle);
    }

    // Dismiss hint (right side)
    const dismissText = '✕';
    screen.writeStr(startX + boxW - 2, y, dismissText, { ...toastStyle, dim: true });
  }

  // Show count if more than visible
  if (toasts.length > maxVisible) {
    const countText = '+' + (toasts.length - maxVisible) + ' more';
    screen.writeStr(startX, startY + maxVisible * 3, countText, { dim: true });
  }
}

/**
 * Compatibility wrapper - shows a single toast (replaces old showMessage behavior).
 * For backward compatibility with existing code.
 */
export function showMessageCompat(text, type = 'info', durationMs = 3000) {
  showToast({ message: text, variant: type, duration: durationMs });
}
