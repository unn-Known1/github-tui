// Help overlay — centered modal listing every keybinding.

import { appState } from '../state.mjs';
import { color } from '../theme.mjs';

export function render(screen) {
  const W = screen.width;
  const H = screen.height;

  const lines = [
    'Keyboard Shortcuts',
    '',
    '--- Global ---',
    '  1-5 / Tab        Switch tabs',
    '  Ctrl-P or :      Command palette',
    '  ↑↓ or j/k        Navigate lists',
    '  Enter            Select / drill in',
    '  Esc / h          Back',
    '  Space            Load more',
    '  G                Jump to bottom',
    '  o                Open in browser',
    '  y                Copy URL',
    '  b                Toggle bookmark',
    '  *                Toggle star',
    '  r                Refresh',
    '  ?                Toggle help',
    '  q / Ctrl-C       Quit',
    '',
    '--- Repos ---',
    '  /                Substring filter',
    '  c                Clear ALL filters',
    '  t                Cycle type filter',
    '  L                Filter by language',
    '  x                Toggle stale-only',
    '  D                Toggle density',
    '  P                Pin / unpin repo',
    '  n/S/f/i/u        Sort by column',
    '',
    '--- Analyze ---',
    '  i                Search / Issues pane',
    '  P                PRs pane',
    '  O                Overview pane',
    '  R                README pane',
    '  F                Files pane',
    '',
    '--- Files ---',
    '  Enter            Open dir / view file',
    '  s                Save file',
    '  S                Save folder',
    '  Z                Download zipball',
    '  C                git clone',
    '  G                gh repo clone',
    '  B                Pick branch',
    '  y                Copy raw URL',
    '',
    '--- Inbox ---',
    '  m                Mark read',
    '  M                Mark all read',
    '  u                Unsubscribe',
    '  f                Cycle filter',
    '',
    'Press any key to close',
  ];

  // Modal backdrop: dim the entire screen.
  const backdropStyle = color('modalBackdrop');
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) {
      screen.styleBuf[yy][xx] = backdropStyle;
    }
  }

  // Scroll support: offset if content is taller than terminal.
  const contentH = lines.length;
  const boxH = Math.min(contentH + 4, H - 4);
  const boxW = Math.min(56, W - 4);
  const x0 = Math.floor((W - boxW) / 2);
  const y0 = Math.floor((H - boxH) / 2);

  // Calculate scroll offset based on content that won't fit.
  let scrollOffset = 0;
  if (contentH + 4 > boxH) {
    // Keep the "Press any key" at the bottom visible.
    scrollOffset = Math.max(0, contentH - (boxH - 4));
  }

  // Clear the box area.
  for (let yy = y0; yy < y0 + boxH; yy++) {
    for (let xx = x0; xx < x0 + boxW; xx++) {
      screen.setCell(xx, yy, ' ', null);
    }
  }

  // Box border.
  screen.box(x0, y0, boxW, boxH, 'Help');

  // Render lines with scroll offset.
  const maxLines = boxH - 3;
  for (let i = 0; i < maxLines && (i + scrollOffset) < lines.length; i++) {
    const ln = lines[i + scrollOffset];
    const style =
      i === 0 ? color('title') :
      ln.startsWith('---') ? color('accent') :
      ln.startsWith('  ') ? null : color('accent');
    // Strip the --- markers for cleaner display.
    const display = ln.replace(/^---\s*/, '').replace(/\s*---$/, '');
    screen.writeStr(x0 + 2, y0 + 1 + i, truncate(display, boxW - 4), style);
  }

  // Scroll indicator if needed.
  if (scrollOffset > 0) {
    screen.writeStr(x0 + boxW - 4, y0 + boxH - 2, '...', color('dim'));
  }
}

function truncate(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '...';
}

export const keys = {};
