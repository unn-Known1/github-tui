// Help overlay — centered modal listing every keybinding.
// Updated through W3 with Repos selection/filters/pins and the Files pane.

import { appState } from '../state.mjs';

export function render(screen) {
  const W = screen.width;
  const H = screen.height;

  const lines = [
    'Keyboard Shortcuts',
    '',
    '── Global ─────────────────────────────────',
    '  1-5 / Tab        Switch tabs',
    '  Ctrl-P or :      Command palette (fuzzy action search)',
    '  ↑↓ or j/k        Navigate lists',
    '  Enter            Select / drill in',
    '  Esc / h          Back',
    '  Space            Load more (paginate)',
    '  G                Jump to bottom (Repos / Files)',
    '  o                Open in browser',
    '  y                Copy URL to clipboard (OSC-52)',
    '  b                Bookmark / toggle bookmark',
    '  s                Star / toggle star',
    '  r                Refresh current view',
    '  ?                Toggle this help',
    '  q / Ctrl-C       Quit',
    '',
    '── Repos tab ──────────────────────────────',
    '  /                Substring filter (name+desc+lang)',
    '  c                Clear ALL filters',
    '  t                Cycle type: all/sources/forks/archived/private/public/templates',
    '  L                Filter by language…',
    '  x                Toggle stale-only (no push 6+ months)',
    '  D                Density toggle (compact / comfortable)',
    '  P                Pin / unpin highlighted repo (sticky top)',
    '  g                Jump to top',
    '  Enter            Open repo in Analyze → details',
    '  n s f i u        Sort by name/stars/forks/issues/updated',
    '',
    '── Analyze tab ────────────────────────────',
    '  i                Open search / toggle Issues pane',
    '  P                Toggle PRs pane',
    '  O                Reset to Overview pane',
    '  R                View README pane',
    '  F                Open File explorer pane',
    '  Space            Load more (search / forks)',
    '',
    '── Files pane (Analyze → F) ───────────────',
    '  Enter            Open dir / view file',
    '  Esc / h          Up a directory / leave viewer',
    '  s                Save file to CWD',
    '  S                Save whole folder to CWD',
    '  Z                Download zipball to CWD',
    '  C                git clone into CWD',
    '  G                gh repo clone into CWD',
    '  B                Pick branch / tag',
    '  y                Copy raw github URL',
    '  Y                Copy file contents (OSC-52, ≤75KB)',
    '',
    '── Forks view ─────────────────────────────',
    '  p s n            Sort: pushed/stars/name',
    '',
    '── Inbox ──────────────────────────────────',
    '  m                Mark thread as read',
    '  M                Mark all as read',
    '  u                Unsubscribe thread',
    '  f                Cycle filter (all/unread/mentions/review)',
    '',
    'Press any key to close',
  ];

  const boxW = Math.min(68, W - 4);
  const boxH = Math.min(lines.length + 4, H - 4);
  const x0 = Math.floor((W - boxW) / 2);
  const y0 = Math.floor((H - boxH) / 2);

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

export const keys = {};
