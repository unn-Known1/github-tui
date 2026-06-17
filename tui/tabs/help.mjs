// Help overlay — a centered modal listing every keybinding.
// Rendered on top of whatever tab is active when appState.showHelp is true.

import { appState } from '../state.mjs';

export function render(screen) {
  const W = screen.width;
  const H = screen.height;

  const lines = [
    'Keyboard Shortcuts',
    '',
    '── Global ─────────────────────────────────',
    '  1-5 / Tab           Switch tabs',
    '  Ctrl-P or :         Command palette (fuzzy action search)',
    '  ↑↓ or j/k           Navigate lists',
    '  Enter               Select / drill in',
    '  Esc / h             Back',
    '  Space               Load more (paginate)',
    '  o                   Open in browser',
    '  y                   Copy URL to clipboard (OSC-52)',
    '  b                   Bookmark / toggle bookmark',
    '  s                   Star / toggle star',
    '  r                   Refresh current view',
    '  ?                   Toggle this help',
    '  q / Ctrl-C          Quit',
    '',
    '── Repos tab ──────────────────────────────',
    '  /                   Filter repos',
    '  c                   Clear active filter',
    '  n s f i u           Sort: name/stars/forks/issues/updated',
    '',
    '── Analyze tab ────────────────────────────',
    '  i                   Open search / toggle Issues pane',
    '  P                   Toggle PRs pane (on details)',
    '  O                   Reset to Overview pane',
    '  R                   View README (on details)',
    '  Space               Load more (search / forks)',
    '',
    '── Forks view ─────────────────────────────',
    '  p s n               Sort: pushed/stars/name',
    '',
    '── Inbox ──────────────────────────────────',
    '  m                   Mark thread as read',
    '  M                   Mark all as read',
    '  u                   Unsubscribe thread',
    '  f                   Cycle filter (all/unread/mentions/review)',
    '',
    'Press any key to close',
  ];

  const boxW = Math.min(64, W - 4);
  const boxH = Math.min(lines.length + 4, H - 4);
  const x0 = Math.floor((W - boxW) / 2);
  const y0 = Math.floor((H - boxH) / 2);

  // Blank out behind the modal so it reads as an overlay.
  for (let yy = y0; yy < y0 + boxH; yy++) {
    for (let xx = x0; xx < x0 + boxW; xx++) {
      screen.setCell(xx, yy, ' ', null);
    }
  }
  screen.box(x0, y0, boxW, boxH, 'Help');

  for (let i = 0; i < lines.length && i < boxH - 3; i++) {
    const ln = lines[i];
    const style =
      i === 0 ? 'bright' :
      ln.startsWith('──') ? 'cyan' :
      ln.startsWith('  ') ? null : 'cyan';
    screen.writeStr(x0 + 2, y0 + 1 + i, ln.substring(0, boxW - 4), style);
  }
}

// Help has no keys of its own — handleKey in keys.mjs closes it on any keystroke.
export const keys = {};
