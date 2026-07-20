// Responsive layout system — provides percentage-based sizing and adaptive columns.

/**
 * Calculate column widths based on terminal width.
 * @param {number} terminalWidth - Total terminal width
 * @param {Array<{ min: number, max: number, ratio: number }>} columns - Column definitions
 * @returns {Array<number>} Actual column widths
 */
export function calculateColumns(terminalWidth, columns) {
  const totalRatio = columns.reduce((sum, col) => sum + (col.ratio || 1), 0);
  const availableWidth = terminalWidth - (columns.length + 1); // Account for separators

  let widths = columns.map(col => Math.floor((availableWidth * (col.ratio || 1)) / totalRatio));

  // Apply min/max constraints
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (col.min && widths[i] < col.min) widths[i] = col.min;
    if (col.max && widths[i] > col.max) widths[i] = col.max;
  }

  // Distribute remaining space
  const totalUsed = widths.reduce((sum, w) => sum + w, 0);
  const remaining = availableWidth - totalUsed;
  if (remaining > 0) {
    // Add to the last column
    widths[widths.length - 1] += remaining;
  }

  return widths;
}

/**
 * Get responsive breakpoints for terminal width.
 * @param {number} width - Terminal width
 * @returns {string} Breakpoint: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
 */
export function getBreakpoint(width) {
  if (width < 60) return 'xs';
  if (width < 80) return 'sm';
  if (width < 100) return 'md';
  if (width < 120) return 'lg';
  return 'xl';
}

/**
 * Calculate layout for a split view (left/right panels).
 * @param {number} terminalWidth - Total terminal width
 * @param {number} leftRatio - Ratio for left panel (default 0.3)
 * @param {number} minWidth - Minimum width for left panel (default 20)
 * @returns {{ left: number, right: number, splitX: number }}
 */
export function splitLayout(terminalWidth, leftRatio = 0.3, minWidth = 20) {
  const leftWidth = Math.max(minWidth, Math.floor(terminalWidth * leftRatio));
  const rightWidth = terminalWidth - leftWidth - 1; // Account for separator
  return {
    left: leftWidth,
    right: rightWidth,
    splitX: leftWidth + 1,
  };
}

/**
 * Calculate visible items for a virtual list based on terminal height.
 * @param {number} terminalHeight - Total terminal height
 * @param {number} headerHeight - Height reserved for headers (default 8)
 * @param {number} footerHeight - Height reserved for footers (default 2)
 * @param {number} itemHeight - Height per item (default 1)
 * @returns {{ maxVisible: number, contentHeight: number }}
 */
export function calculateViewport(terminalHeight, headerHeight = 8, footerHeight = 2, itemHeight = 1) {
  const contentHeight = terminalHeight - headerHeight - footerHeight;
  const maxVisible = Math.max(1, Math.floor(contentHeight / itemHeight));
  return { maxVisible, contentHeight };
}

/**
 * Adaptive column visibility based on terminal width.
 * @param {number} terminalWidth - Terminal width
 * @param {Array<{ id: string, minWidth: number }>} columns - Columns with min widths
 * @returns {Array<string>} Visible column IDs
 */
export function getVisibleColumns(terminalWidth, columns) {
  const visible = [];
  let usedWidth = 0;

  for (const col of columns) {
    if (usedWidth + col.minWidth <= terminalWidth - 4) { // Leave some margin
      visible.push(col.id);
      usedWidth += col.minWidth;
    }
  }

  return visible;
}

/**
 * Calculate optimal list item width for truncation.
 * @param {number} terminalWidth - Terminal width
 * @param {number} reservedWidth - Width reserved for other elements (default 30)
 * @returns {number} Available width for list item text
 */
export function getListItemWidth(terminalWidth, reservedWidth = 30) {
  return Math.max(10, terminalWidth - reservedWidth);
}

/**
 * Responsive font scaling (not actual fonts, but column/spacing adjustments).
 * @param {number} terminalWidth - Terminal width
 * @returns {{ compact: boolean, showDetails: boolean, showMeta: boolean }}
 */
export function getResponsiveConfig(terminalWidth) {
  const bp = getBreakpoint(terminalWidth);
  return {
    compact: bp === 'xs' || bp === 'sm',
    showDetails: bp !== 'xs',
    showMeta: bp === 'lg' || bp === 'xl',
    showColumns: bp !== 'xs',
    maxLabelLength: bp === 'xs' ? 20 : bp === 'sm' ? 30 : 50,
  };
}

/**
 * Calculate stat card layout for dashboard.
 * @param {number} terminalWidth - Terminal width
 * @param {number} cardCount - Number of cards (default 5)
 * @returns {{ cardWidth: number, gap: number, cardsPerRow: number }}
 */
export function getStatCardLayout(terminalWidth, cardCount = 5) {
  const bp = getBreakpoint(terminalWidth);

  if (bp === 'xs') {
    return { cardWidth: Math.floor((terminalWidth - 12) / 2), gap: 1, cardsPerRow: 2 };
  }
  if (bp === 'sm') {
    return { cardWidth: Math.floor((terminalWidth - 16) / 3), gap: 1, cardsPerRow: 3 };
  }

  const cardWidth = Math.min(18, Math.floor((terminalWidth - 2) / cardCount) - 2);
  return { cardWidth, gap: 2, cardsPerRow: cardCount };
}

/**
 * Calculate detail popup dimensions.
 * @param {number} terminalWidth - Terminal width
 * @param {number} terminalHeight - Terminal height
 * @returns {{ width: number, height: number, x: number, y: number }}
 */
export function getDetailPopupLayout(terminalWidth, terminalHeight) {
  const bp = getBreakpoint(terminalWidth);
  const width = bp === 'xs' ? terminalWidth - 2
    : bp === 'sm' ? terminalWidth - 4
    : Math.min(100, terminalWidth - 4);
  const height = terminalHeight - 4;
  const x = Math.floor((terminalWidth - width) / 2);
  return { width, height, x, y: 2 };
}
