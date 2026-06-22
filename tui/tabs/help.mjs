// Help overlay — centered modal listing every keybinding.
// v0.5+ polish: searchable filter, scannable layout with categories.

import { appState, tabState } from '../state.mjs';
import { color } from '../theme.mjs';
import { truncate } from '../utils.mjs';

// All shortcuts organized by category for the searchable help overlay.
const CATEGORIES = [
  { id: 'global',     name: 'GLOBAL',            shortcuts: [
    { key: '1-6',       desc: 'Switch tabs (Dashboard/Repos/Analyze/Actions/Inbox/Settings)' },
    { key: 'Tab',       desc: 'Next tab (or focus stat cards on Dashboard)' },
    { key: 'Shift+Tab', desc: 'Previous tab' },
    { key: 'Ctrl-P / :', desc: 'Open command palette' },
    { key: '↑↓ / j k',  desc: 'Navigate lists' },
    { key: '← / →',     desc: 'Switch between focused items (stat cards)' },
    { key: 'Enter',     desc: 'Select / drill in' },
    { key: 'Esc / Backspace', desc: 'Back to previous view' },
    { key: 'PgUp / PgDn', desc: 'Navigate pages (pagination)' },
    { key: 'g',         desc: 'Jump to top' },
    { key: 'G',         desc: 'Jump to bottom' },
    { key: 'Space',     desc: 'Page down (same as PgDn)' },
    { key: 'o',         desc: 'Open current item in browser' },
    { key: 'y',         desc: 'Copy URL to clipboard (OSC-52)' },
    { key: 'b',         desc: 'Toggle bookmark' },
    { key: 'B',         desc: 'Browse all bookmarks' },
    { key: '*',         desc: 'Toggle star on GitHub' },
    { key: 'r',         desc: 'Refresh current view' },
    { key: 'w',         desc: 'Show "What\'s new" / tour' },
    { key: '?',         desc: 'Toggle this help' },
    { key: 'q / Ctrl-C', desc: 'Quit' },
  ]},
  { id: 'dashboard',  name: 'DASHBOARD',         shortcuts: [
    { key: 'j / k',     desc: 'Navigate trending repos' },
    { key: 'n',         desc: 'Create a new issue on your first repo' },
    { key: 'Tab',       desc: 'Focus the row of stat cards' },
    { key: '← / → / H L', desc: 'Move between stat cards' },
    { key: 'Enter',     desc: 'Open the focused stat card (e.g. Stale → Repos)' },
    { key: 'Esc',       desc: 'Unfocus stat cards (back to scrolling)' },
    { key: 'PgUp / PgDn', desc: 'Navigate trending pages' },
  ]},
  { id: 'repos',      name: 'REPOS',             shortcuts: [
    { key: '/',         desc: 'Substring filter' },
    { key: 'c',         desc: 'Clear ALL filters' },
    { key: 't',         desc: 'Cycle type: all → sources → forks → archived → private → public → templates' },
    { key: 'L',         desc: 'Filter by language' },
    { key: 'x',         desc: 'Toggle stale-only (no push 6+ months)' },
    { key: 'D',         desc: 'Toggle density (compact ↔ comfortable)' },
    { key: 'P',         desc: 'Pin / unpin repo (sticky top, persisted)' },
    { key: 'n / S / f / i / u', desc: 'Sort by name / stars / forks / issues / updated' },
    { key: 'V',         desc: 'Toggle starred / own repos' },
    { key: 'g / G',     desc: 'Jump to top / bottom' },
    { key: 'PgUp / PgDn', desc: 'Navigate pages (starred repos)' },
  ]},
  { id: 'analyze',    name: 'ANALYZE',           shortcuts: [
    { key: 'i',         desc: 'Search prompt (or toggle Issues pane on details)' },
    { key: 'Enter',     desc: 'Open details (or open Forks / Issue-PR detail)' },
    { key: 'O',         desc: 'Overview pane' },
    { key: 'R',         desc: 'README pane' },
    { key: 'F',         desc: 'Files pane' },
    { key: 'P',         desc: 'PRs pane' },
    { key: 'A',         desc: 'Packages pane (release assets)' },
    { key: 'g / G',     desc: 'Jump to top / bottom' },
    { key: 'PgUp / PgDn', desc: 'Navigate pages' },
  ]},
  { id: 'files',      name: 'FILES',             shortcuts: [
    { key: 'Enter',     desc: 'Open dir / view file' },
    { key: 's',         desc: 'Save current file to CWD' },
    { key: 'S',         desc: 'Save whole folder recursively to CWD' },
    { key: 'Z',         desc: 'Download repo zipball to CWD' },
    { key: 'C',         desc: 'git clone into CWD' },
    { key: 'G',         desc: 'gh repo clone (for private repos)' },
    { key: 'B',         desc: 'Branch / tag picker' },
    { key: 'y',         desc: 'Copy raw github URL' },
    { key: 'Y',         desc: 'Copy file contents (OSC-52)' },
  ]},
  { id: 'actions',    name: 'ACTIONS',           shortcuts: [
    { key: '↑↓ / j k',  desc: 'Navigate repos or runs' },
    { key: 'Enter',     desc: 'View runs for selected repo / open run in browser' },
    { key: 'r',         desc: 'Re-run selected workflow' },
    { key: 'x',         desc: 'Cancel running workflow' },
    { key: 't',         desc: 'Back to repo list (from runs view)' },
    { key: '/',         desc: 'Filter repos' },
  ]},
  { id: 'inbox',      name: 'INBOX',             shortcuts: [
    { key: 'm',         desc: 'Mark current as read' },
    { key: 'M',         desc: 'Mark ALL as read' },
    { key: 'u',         desc: 'Unsubscribe (ignore future updates)' },
    { key: 'f',         desc: 'Cycle filter: all → unread → mentions → review' },
    { key: 'r',         desc: 'Refresh notifications' },
    { key: 'Enter / o', desc: 'Open detail popup (issues/PRs) or browser' },
  ]},
  { id: 'security',   name: 'SECURITY',          shortcuts: [
    { key: '1-6',       desc: 'Switch sub-pane: Dependabot / Secret / CodeScan / Advisories / Branch / Deps' },
    { key: 's',         desc: 'Cycle severity filter (all → critical → high → medium → low)' },
    { key: 'f',         desc: 'Cycle state filter (open → dismissed → fixed → all)' },
    { key: 'Enter',     desc: 'Open alert/advisory in browser' },
    { key: 'x',         desc: 'Dismiss Dependabot alert' },
    { key: '↑↓ / j k',  desc: 'Navigate alerts' },
    { key: 'g / G',     desc: 'Jump to top / bottom' },
  ]},
  { id: 'detail',     name: 'ISSUE / PR DETAIL', shortcuts: [
    { key: 'Enter on issue/PR', desc: 'Open detail popup' },
    { key: 'Esc / h',   desc: 'Close popup' },
    { key: '↑↓ / j k',  desc: 'Scroll content' },
    { key: 'Enter (on body)', desc: 'Cycle Body → Comments → Files' },
    { key: 'c',         desc: 'Comment on the issue/PR' },
    { key: 'r',         desc: 'React — pick an emoji' },
    { key: 'x',         desc: 'Close or Reopen' },
    { key: 'M',         desc: 'Merge PR (with confirmation)' },
    { key: 'y',         desc: 'Copy URL' },
  ]},
  { id: 'settings',   name: 'SETTINGS',          shortcuts: [
    { key: '↑↓',        desc: 'Navigate menu items' },
    { key: 'Enter',     desc: 'Select / activate the highlighted item' },
    { key: 's / S',       desc: 'Star the github-tui repo (show support!)' },
    { key: 'o',         desc: 'Open github-tui repo in browser' },
    { key: 'r',         desc: 'Refresh user data' },
    { key: 'y',         desc: 'Confirm a destructive action' },
    { key: 'n / Esc',   desc: 'Cancel a destructive action' },
  ]},
];

// Flatten for searching.
function allShortcuts() {
  const flat = [];
  for (const cat of CATEGORIES) {
    for (const s of cat.shortcuts) {
      flat.push({ ...s, category: cat.name });
    }
  }
  return flat;
}

function matchesQuery(s, q) {
  if (!q) return true;
  q = q.toLowerCase();
  return s.key.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q);
}

export function render(screen) {
  const W = screen.width;
  const H = screen.height;
  const q = (appState.helpQuery || '').trim();

  // Modal backdrop: dim the entire screen.
  const backdropStyle = color('modalBackdrop');
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) {
      screen.styleBuf[yy][xx] = backdropStyle;
    }
  }

  const boxW = Math.min(78, W - 4);
  const boxH = Math.min(H - 4, 28);
  const x0 = Math.floor((W - boxW) / 2);
  const y0 = Math.floor((H - boxH) / 2);

  // Clear the box area.
  for (let yy = y0; yy < y0 + boxH; yy++) {
    for (let xx = x0; xx < x0 + boxW; xx++) {
      screen.setCell(xx, yy, ' ', null);
    }
  }

  // Box border.
  screen.box(x0, y0, boxW, boxH, 'Help · Keyboard Shortcuts', { fg: 'cyan', bold: true });

  // Search bar.
  const searchY = y0 + 1;
  screen.writeStr(x0 + 2, searchY, '/', { fg: 'cyan' });
  const queryStr = q || 'Type to filter (Esc to close, ↑↓ to scroll)...';
  screen.writeStr(x0 + 4, searchY, truncate(queryStr, boxW - 8),
    q ? { fg: 'cyan', bold: true } : { dim: true });
  if (q) {
    // Show a small "x" to clear.
    screen.writeStr(x0 + boxW - 4, searchY, '✕', { fg: 'gray' });
  }
  screen.hline(searchY + 1, '─', { dim: true });

  // Build the lines to render. Filter by query.
  const lines = getHelpLines(q);

  // Pad to boxH-3 to allow for footer.
  const maxLines = boxH - 4;
  let scrollOffset = appState.helpCursor || 0;
  if (scrollOffset > lines.length - maxLines) {
    scrollOffset = Math.max(0, lines.length - maxLines);
  }
  if (scrollOffset < 0) scrollOffset = 0;

  for (let i = 0; i < maxLines && (i + scrollOffset) < lines.length; i++) {
    const ln = lines[i + scrollOffset];
    const row = y0 + 3 + i;
    if (ln.kind === 'header') {
      screen.writeStr(x0 + 2, row, ln.text, { fg: 'cyan', bold: true });
    } else if (ln.kind === 'shortcut') {
      const key = ln.key.padEnd(18).substring(0, 18);
      screen.writeStr(x0 + 2, row, key, { fg: 'yellow', bold: true });
      screen.writeStr(x0 + 20, row, truncate(ln.desc, boxW - 22), color('repoName') || { fg: 'white' });
    } else if (ln.kind === 'empty') {
      screen.writeStr(x0 + 2, row, ln.text, { dim: true });
    }
  }

  // Scroll indicator.
  const footY = y0 + boxH - 2;
  if (lines.length > maxLines) {
    const s = (scrollOffset + 1) + '-' + Math.min(scrollOffset + maxLines, lines.length) +
      ' of ' + lines.length;
    screen.writeStr(x0 + 2, footY, s, { dim: true });
  } else {
    screen.writeStr(x0 + 2, footY, lines.length + ' shortcuts · ' + CATEGORIES.length + ' categories', { dim: true });
  }
  // Footer hint pinned to right.
  const hint = '↑↓ scroll   / search   Esc close';
  screen.writeStr(x0 + boxW - hint.length - 2, footY, hint, { dim: true });
}

export function getHelpLines(q) {
  const lines = [];
  const query = (q || '').trim();

  // Map tab index to category id.
  const TAB_CATS = ['dashboard', 'repos', 'analyze', 'actions', 'inbox', 'settings'];
  const currentCat = TAB_CATS[tabState.current] || 'global';

  if (!query) {
    // Show current tab's shortcuts first, then global, then others.
    const current = CATEGORIES.find(c => c.id === currentCat);
    const globalCat = CATEGORIES.find(c => c.id === 'global');
    const others = CATEGORIES.filter(c => c.id !== currentCat && c.id !== 'global');

    for (const cat of [current, globalCat, ...others]) {
      if (!cat) continue;
      const isCurrent = cat.id === currentCat;
      lines.push({ kind: 'header', text: isCurrent ? cat.name + ' (current)' : cat.name });
      for (const s of cat.shortcuts) {
        lines.push({ kind: 'shortcut', key: s.key, desc: s.desc });
      }
    }
  } else {
    const matched = allShortcuts().filter(s => matchesQuery(s, query));
    if (matched.length === 0) {
      lines.push({ kind: 'empty', text: 'No matching shortcuts' });
    } else {
      // Group by category for readability.
      const grouped = {};
      for (const s of matched) {
        if (!grouped[s.category]) grouped[s.category] = [];
        grouped[s.category].push(s);
      }
      for (const cat of CATEGORIES) {
        if (grouped[cat.name]) {
          lines.push({ kind: 'header', text: cat.name });
          for (const s of grouped[cat.name]) {
            lines.push({ kind: 'shortcut', key: s.key, desc: s.desc });
          }
        }
      }
    }
  }
  return lines;
}

// Update the search query (called from keys.mjs).
export function setHelpQuery(q) {
  appState.helpQuery = q;
  appState.helpCursor = 0;
}
export function scrollHelp(delta) {
  const q = (appState.helpQuery || '').trim();
  const lines = getHelpLines(q);
  const H = process.stdout.rows || 24;
  const boxH = Math.min(H - 4, 28);
  const maxLines = boxH - 4;
  const totalLines = lines.length;
  const cur = appState.helpCursor || 0;
  const maxScroll = Math.max(0, totalLines - maxLines);
  appState.helpCursor = Math.max(0, Math.min(maxScroll, cur + delta));
}

export const keys = {};
