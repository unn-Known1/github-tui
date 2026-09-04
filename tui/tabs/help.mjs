// Help overlay — centered modal listing every keybinding.
// v0.5+ polish: searchable filter, scannable layout with categories.

import { appState, tabState } from '../state.mjs';
import { color } from '../theme.mjs';
import { truncate, truncateToWidth } from '../utils.mjs';

// All shortcuts organized by category for the searchable help overlay.
const CATEGORIES = [
  { id: 'global',     name: 'GLOBAL',            shortcuts: [
    { key: '1-6',       desc: 'Switch tabs (Dashboard/Repos/Explore/Actions/Inbox/Settings)' },
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
    { key: 'y',         desc: 'Copy URL to clipboard' },
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
    { key: 'Tab',       desc: 'Cycle dashboard widgets (incl. Contributions heatmap)' },
    { key: '← / → / H L', desc: 'Move between stat cards (or heatmap days when Contributions focused)' },
    { key: '↑ / ↓',     desc: 'Move one week in Contributions heatmap (when focused)' },
    { key: 'Enter',     desc: 'Open focused widget / filter activity feed to heatmap day' },
    { key: 'x / Esc',   desc: 'Clear heatmap day filter (Esc also unfocuses cards)' },
    { key: 'Esc',       desc: 'Unfocus stat cards (back to scrolling)' },
    { key: 'PgUp / PgDn', desc: 'Scroll dashboard' },
    { key: 't',         desc: 'Cycle trending period (1/7/30d)' },
    { key: '/',         desc: 'Filter trending' },
    { key: 'l',         desc: 'Toggle local-repo filter' },
    { key: 'z / Z / X', desc: 'Collapse toggle / collapse all / expand all' },
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
    { key: 'l',         desc: 'Load more repos after background cap' },
    { key: 'g / G',     desc: 'Jump to top / bottom' },
    { key: 'PgUp / PgDn', desc: 'Navigate pages (starred repos)' },
  ]},
  { id: 'analyze',    name: 'EXPLORE',           shortcuts: [
    { key: 'i',         desc: 'Search prompt (or toggle Issues pane on details)' },
    { key: 'u',         desc: 'Search GitHub users (then Enter to browse their repos)' },
    { key: 'C',         desc: 'Search code across GitHub' },
    { key: 'Enter',     desc: 'Open details (or open Forks / Issue-PR detail)' },
    { key: 'Space',     desc: 'Load more search results / user repos' },
    { key: 'S / U',     desc: 'Sort user repos by stars / last updated' },
    { key: 'O',         desc: 'Overview pane' },
    { key: 'R',         desc: 'README pane' },
    { key: 'F',         desc: 'Files pane' },
    { key: 'P',         desc: 'PRs pane' },
    { key: 'A',         desc: 'Packages pane (release assets)' },
    { key: 'T / K / S', desc: 'Traffic / Checks / Security panes' },
    { key: 'D',         desc: 'Compare refs (details view)' },
    { key: 'p / s / n', desc: 'Sort forks by push / stars / name (forks view)' },
    { key: 'g / G',     desc: 'Jump to top / bottom' },
    { key: 'PgUp / PgDn', desc: 'Navigate pages' },
  ]},
  { id: 'files',      name: 'FILES',             shortcuts: [
    { key: 'Enter',     desc: 'Open dir / view file' },
    { key: '/',         desc: 'Filter current directory by name' },
    { key: 'c',         desc: 'Clear directory filter' },
    { key: 't',         desc: 'Cycle tree sort (name → size → type)' },
    { key: 'e',         desc: 'Go to file path...' },
    { key: 'o',         desc: 'Open file / folder / commit in browser' },
    { key: 'p',         desc: 'Copy repo-relative file path' },
    { key: 's',         desc: 'Save current file to CWD' },
    { key: 'S',         desc: 'Save whole folder recursively to CWD' },
    { key: 'Z',         desc: 'Download repo zipball to CWD' },
    { key: 'C',         desc: 'git clone into CWD' },
    { key: 'G',         desc: 'gh repo clone (for private repos)' },
    { key: 'B',         desc: 'Branch / tag picker' },
    { key: 'H',         desc: 'Per-file commit history' },
    { key: 'b',         desc: 'Local git blame for current file' },
    { key: 'r',         desc: 'Refresh tree / file in place' },
    { key: 'y',         desc: 'Copy raw github URL' },
    { key: 'Y',         desc: 'Copy entire file contents' },
    { key: 'Ctrl+A',    desc: 'Select all → copy' },
    { key: 'Ctrl+C',    desc: 'Copy selected text' },
  ]},
  { id: 'actions',    name: 'ACTIONS',           shortcuts: [
    { key: '↑↓ / j k',  desc: 'Navigate repos or runs' },
    { key: 'Enter',     desc: 'View runs for selected repo / open run in browser' },
    { key: 'r',         desc: 'Re-run selected workflow' },
    { key: 'x',         desc: 'Cancel running workflow' },
    { key: 't',         desc: 'Back to repo list (from runs view)' },
    { key: '/',         desc: 'Filter repos' },
    { key: 'F',         desc: 'Scan failure queue (up to 20 repos)' },
    { key: 'd',         desc: 'Dispatch workflow (runs view)' },
    { key: 'l',         desc: 'Open selected run log (expand first)' },
    { key: 'R',         desc: 'Rescan repos / re-run selected' },
  ]},
  { id: 'inbox',      name: 'INBOX',             shortcuts: [
    { key: 'm',         desc: 'Mark current as read' },
    { key: 'M',         desc: 'Mark ALL as read' },
    { key: 'u',         desc: 'Unsubscribe (ignore future updates)' },
    { key: 'f',         desc: 'Cycle filter: all → unread → mentions → review' },
    { key: '/',         desc: 'Search notifications (title + repo name)' },
    { key: 'H',         desc: 'Hide / show processed threads' },
    { key: 'G',         desc: 'Toggle grouping by thread' },
    { key: 'z',         desc: 'Snooze thread for 1 hour' },
    { key: 'Z',         desc: 'Unsnooze current thread' },
    { key: 'v / V',     desc: 'Save / apply named filters' },
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
    { key: 'a',         desc: 'Approve PR (review with comment prompt)' },
    { key: 'v',         desc: 'Request changes on PR (review with comment prompt)' },
    { key: 'R',         desc: 'Request reviewers for PR (username prompt)' },
    { key: 'S',         desc: 'Submit draft review comments (with confirmation)' },
    { key: 'e',         desc: 'Edit labels (comma-separated prompt)' },
    { key: 'E',         desc: 'Edit fields via JSON (title/body/labels/assignees/milestone)' },
    { key: 'C',         desc: 'Checkout PR branch locally (gh, then git fallback)' },
    { key: 'y',         desc: 'Copy URL' },
  ]},
  { id: 'settings',   name: 'SETTINGS',          shortcuts: [
    { key: '↑↓',        desc: 'Navigate menu items' },
    { key: 'Enter',     desc: 'Select / activate the highlighted item' },
    { key: 's / S',     desc: 'Star the github-tui repo (show support!)' },
    { key: 'o',         desc: 'Open github-tui repo in browser' },
    { key: 'r',         desc: 'Refresh dashboard + user data' },
  ]},
  { id: 'confirm',    name: 'CONFIRM DIALOG',    shortcuts: [
    { key: 'y / Y / Enter', desc: 'Confirm a destructive action' },
    { key: 'n / N / Esc',   desc: 'Cancel a destructive action' },
  ]},
  { id: 'power',      name: 'POWER USER',        shortcuts: [
    { key: 'Ctrl-P / :',   desc: 'Open command palette (every action)' },
    { key: 'Ctrl-S',       desc: 'Save current search (any tab with a query)' },
    { key: 'Ctrl-K',         desc: 'Show keybindings path (~/.github-tui/keybindings.json)' },
    { key: 'Ctrl-Y',         desc: 'Redo last undo' },
    { key: 'Type to filter', desc: 'Type any text to filter the help overlay' },
    { key: 'G',             desc: 'Clear help filter' },
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

  for (let yy = y0; yy < y0 + boxH; yy++) {
    for (let xx = x0; xx < x0 + boxW; xx++) {
      screen.setCell(xx, yy, ' ', null);
    }
  }

  screen.box(x0, y0, boxW, boxH, 'Help · Keyboard Shortcuts', { fg: 'cyan', bold: true });

  const searchY = y0 + 1;
  screen.writeStr(x0 + 2, searchY, '/', { fg: 'cyan' });
  const queryStr = q || 'Type to filter (Esc to close, ↑↓ to scroll)...';
  screen.writeStr(x0 + 4, searchY, truncate(queryStr, boxW - 8),
    q ? { fg: 'cyan', bold: true } : { dim: true });
  if (q) {
    screen.writeStr(x0 + boxW - 4, searchY, '✕', { fg: 'gray' });
  }
  screen.hline(searchY + 1, '─', { dim: true });

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
      const key = truncateToWidth(ln.key, 18, '').padEnd(18);
      screen.writeStr(x0 + 2, row, key, { fg: 'yellow', bold: true });
      screen.writeStr(x0 + 20, row, truncate(ln.desc, boxW - 22), color('repoName') || { fg: 'white' });
    } else if (ln.kind === 'empty') {
      screen.writeStr(x0 + 2, row, ln.text, { dim: true });
    }
  }

  const footY = y0 + boxH - 2;
  if (lines.length > maxLines) {
    const s = (scrollOffset + 1) + '-' + Math.min(scrollOffset + maxLines, lines.length) +
      ' of ' + lines.length;
    screen.writeStr(x0 + 2, footY, s, { dim: true });
  } else {
    screen.writeStr(x0 + 2, footY, lines.length + ' shortcuts · ' + CATEGORIES.length + ' categories', { dim: true });
  }
  const hint = '↑↓ scroll   / search   Esc close';
  screen.writeStr(x0 + boxW - hint.length - 2, footY, hint, { dim: true });
}

export function getHelpLines(q) {
  const lines = [];
  const query = (q || '').trim();

  const TAB_CATS = ['dashboard', 'repos', 'analyze', 'actions', 'inbox', 'settings'];
  const currentCat = TAB_CATS[tabState.current] || 'global';

  if (!query) {
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
