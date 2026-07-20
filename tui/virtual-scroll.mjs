// Virtual scrolling helper — renders only visible items in large lists.
// Returns { startIndex, endIndex, offsetY } for the visible window.

/**
 * Calculate the visible window for a virtual scroll list.
 * @param {number} totalItems - Total number of items in the list
 * @param {number} selectedItem - Currently selected/highlighted item index
 * @param {number} scrollOffset - Current scroll position (items from top)
 * @param {number} viewportHeight - Available height in rows
 * @param {number} itemHeight - Height of each item in rows (default 1)
 * @param {number} overscan - Extra items to render above/below viewport (default 2)
 * @returns {{ startIndex: number, endIndex: number, offsetY: number, maxScroll: number }}
 */
export function calculateViewport(totalItems, selectedItem, scrollOffset, viewportHeight, itemHeight = 1, overscan = 2) {
  if (totalItems === 0) return { startIndex: 0, endIndex: 0, offsetY: 0, maxScroll: 0 };

  const maxScroll = Math.max(0, totalItems - Math.floor(viewportHeight / itemHeight));

  // Clamp scroll offset
  let scroll = Math.max(0, Math.min(scrollOffset, maxScroll));

  // Ensure selected item is visible
  const selectedRow = Math.floor(selectedItem / itemHeight);
  if (selectedRow < scroll) {
    scroll = selectedRow;
  } else if (selectedRow >= scroll + Math.floor(viewportHeight / itemHeight)) {
    scroll = selectedRow - Math.floor(viewportHeight / itemHeight) + 1;
  }

  // Calculate visible range with overscan
  const startItem = Math.max(0, Math.floor(scroll) - overscan);
  const visibleItems = Math.ceil(viewportHeight / itemHeight) + overscan * 2;
  const endItem = Math.min(totalItems, startItem + visibleItems);

  // Calculate Y offset for the first visible item
  const offsetY = (startItem - scroll) * itemHeight;

  return {
    startIndex: startItem,
    endIndex: endItem,
    offsetY,
    maxScroll,
    scroll: scroll,
  };
}

/**
 * Handle scroll input for a virtual list.
 * @param {string} direction - 'up' | 'down' | 'pageUp' | 'pageDown' | 'top' | 'bottom'
 * @param {{ selected: number, scroll: number }} state - Current selection state
 * @param {number} totalItems - Total number of items
 * @param {number} viewportHeight - Available height in rows
 * @param {number} itemHeight - Height of each item in rows (default 1)
 * @returns {{ selected: number, scroll: number }} - New state
 */
export function handleScroll(direction, state, totalItems, viewportHeight, itemHeight = 1) {
  if (totalItems === 0) return { selected: 0, scroll: 0 };

  const maxVisible = Math.floor(viewportHeight / itemHeight);
  const maxScroll = Math.max(0, totalItems - maxVisible);
  let { selected, scroll } = state;

  switch (direction) {
    case 'up':
      selected = Math.max(0, selected - 1);
      if (selected < scroll) scroll = selected;
      break;

    case 'down':
      selected = Math.min(totalItems - 1, selected + 1);
      if (selected >= scroll + maxVisible) scroll = selected - maxVisible + 1;
      break;

    case 'pageUp':
      selected = Math.max(0, selected - maxVisible);
      scroll = Math.max(0, scroll - maxVisible);
      break;

    case 'pageDown':
      selected = Math.min(totalItems - 1, selected + maxVisible);
      scroll = Math.min(maxScroll, scroll + maxVisible);
      break;

    case 'top':
      selected = 0;
      scroll = 0;
      break;

    case 'bottom':
      selected = totalItems - 1;
      scroll = maxScroll;
      break;
  }

  return { selected, scroll };
}

/**
 * Calculate scroll position for mouse wheel events.
 * @param {boolean} up - True for scroll up, false for scroll down
 * @param {{ selected: number, scroll: number }} state - Current state
 * @param {number} totalItems - Total number of items
 * @param {number} viewportHeight - Available height in rows
 * @param {number} itemHeight - Height of each item (default 1)
 * @param {number} scrollAmount - Number of items to scroll (default 3)
 * @returns {{ selected: number, scroll: number }}
 */
export function handleWheel(up, state, totalItems, viewportHeight, itemHeight = 1, scrollAmount = 3) {
  if (totalItems === 0) return state;

  let { selected, scroll } = state;
  const maxVisible = Math.floor(viewportHeight / itemHeight);
  const maxScroll = Math.max(0, totalItems - maxVisible);

  if (up) {
    scroll = Math.max(0, scroll - scrollAmount);
    // Keep selected item in view
    if (selected < scroll) selected = scroll;
  } else {
    scroll = Math.min(maxScroll, scroll + scrollAmount);
    // Keep selected item in view
    if (selected >= scroll + maxVisible) selected = scroll + maxVisible - 1;
  }

  return { selected, scroll: Math.max(0, Math.min(scroll, maxScroll)) };
}

/**
 * Get item at a specific row position in the viewport.
 * @param {number} row - Row position (0-based from top of viewport)
 * @param {number} scrollOffset - Current scroll position
 * @param {number} itemHeight - Height of each item (default 1)
 * @returns {number} Item index at that row, or -1 if none
 */
export function getItemAtRow(row, scrollOffset, itemHeight = 1) {
  const itemIndex = Math.floor(scrollOffset) + Math.floor(row / itemHeight);
  return itemIndex;
}
