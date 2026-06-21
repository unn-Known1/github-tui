// Detail popup — Issue/PR detail view with rendered body, comments, and actions.
// Opens as an overlay on top of the Analyze tab.

import { appState, render, startAsync, isStale, showMessage, confirm } from '../state.mjs';
import {
  getIssue, getPullRequest, getIssueComments, getPullRequestReviews,
  getPullRequestFiles, postComment, createReaction,
  closeIssue, reopenIssue, mergePullRequest,
} from '../github.mjs';
import { startInput, registerInputHandler } from '../input.mjs';
import { truncate, relTime, copyToClipboard } from '../utils.mjs';
import { color } from '../theme.mjs';

const REACTIONS = ['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes'];

// Convert a hex color string (e.g. "d73a4a") to the nearest terminal named color.
function hexToNamedColor(hex) {
  if (!hex) return 'darkGray';
  const h = hex.replace('#', '');
  if (h.length !== 6) return 'darkGray';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // Simple nearest-color among the 8 basic ANSI colors.
  const colors = [
    ['black', 0, 0, 0], ['red', 170, 0, 0], ['green', 0, 170, 0],
    ['yellow', 170, 170, 0], ['blue', 0, 0, 170], ['magenta', 170, 0, 170],
    ['cyan', 0, 170, 170], ['white', 170, 170, 170],
    ['darkGray', 85, 85, 85], ['gray', 128, 128, 128],
  ];
  let best = 'darkGray', bestDist = Infinity;
  for (const [name, cr, cg, cb] of colors) {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bestDist) { bestDist = d; best = name; }
  }
  return best;
}

export function openDetail(type, owner, repo, number) {
  appState.showDetail = true;
  appState.detailType = type;       // 'issue' | 'pull_request'
  appState.detailOwner = owner;
  appState.detailRepo = repo;
  appState.detailNumber = number;
  appState.detailData = null;
  appState.detailComments = [];
  appState.detailReviews = [];
  appState.detailFiles = [];
  appState.detailScroll = 0;
  appState.detailTab = 'body';      // 'body' | 'comments' | 'files'
  appState.detailFileCursor = 0;
  appState.detailLoading = true;
  appState.detailReactionPicker = false;
  appState.detailReactionCursor = 0;
  render();
  loadDetail();
}

async function loadDetail() {
  const gen = startAsync();
  appState.detailLoading = true;
  render();
  try {
    const { detailType: type, detailOwner: owner, detailRepo: repo, detailNumber: number } = appState;
    let data;
    if (type === 'pull_request') {
      data = await getPullRequest(appState.token, owner, repo, number);
    } else {
      data = await getIssue(appState.token, owner, repo, number);
    }
    if (isStale(gen)) { appState.loading = false; return; }
    appState.detailData = data;

    const safe = (p) => p.catch(() => null);
    const [comments, reviews, files] = await Promise.all([
      safe(getIssueComments(appState.token, owner, repo, number)),
      type === 'pull_request' ? safe(getPullRequestReviews(appState.token, owner, repo, number)) : Promise.resolve([]),
      type === 'pull_request' ? safe(getPullRequestFiles(appState.token, owner, repo, number)) : Promise.resolve([]),
    ]);
    if (isStale(gen)) { appState.loading = false; return; }
    appState.detailComments = Array.isArray(comments) ? comments : [];
    appState.detailReviews = Array.isArray(reviews) ? reviews : [];
    appState.detailFiles = Array.isArray(files) ? files : [];
    appState.detailLoading = false;
    showMessage('Loaded #' + number, 'success');
  } catch (e) {
    if (!isStale(gen)) showMessage(e.message || 'Failed to load detail', 'error');
    appState.showDetail = false;
  }
  if (!isStale(gen)) render();
}

export function closeDetail() {
  appState.showDetail = false;
  appState.detailData = null;
  appState.detailComments = [];
  appState.detailReviews = [];
  appState.detailFiles = [];
  appState.detailReactionPicker = false;
  appState.detailDiffView = false;
  appState.detailDiffFile = null;
  appState.detailDiffContent = '';
  render();
}

export function handleBack() {
  if (appState.detailReactionPicker) {
    appState.detailReactionPicker = false;
    render();
    return;
  }
  if (appState.detailDiffView) {
    closeDiffView();
    return;
  }
  closeDetail();
}

export function toggleReactionPicker() {
  if (!appState.showDetail) return;
  appState.detailReactionPicker = !appState.detailReactionPicker;
  appState.detailReactionCursor = 0;
  render();
}

export async function addReaction(content) {
  if (!appState.token || !appState.detailData) return;
  appState.detailReactionPicker = false;
  const { detailOwner: owner, detailRepo: repo, detailNumber: number } = appState;
  try {
    await createReaction(appState.token, owner, repo, number, content);
    showMessage('Reacted with ' + content, 'success');
    await loadDetail();
  } catch (e) { showMessage('Reaction failed: ' + e.message, 'error'); }
}

export function submitComment(value) {
  const body = (value || '').trim();
  if (!body) return;
  if (!appState.token || !appState.detailData) return;
  const { detailOwner: owner, detailRepo: repo, detailNumber: number } = appState;
  postComment(appState.token, owner, repo, number, body)
    .then(() => {
      showMessage('Comment posted', 'success');
      return loadDetail();
    })
    .catch(e => showMessage('Comment failed: ' + e.message, 'error'));
}
registerInputHandler('comment', submitComment);

export function openCommentInput() {
  if (!appState.showDetail) return;
  startInput('Comment: ', 'comment');
}

export function closeOrReopen() {
  if (!appState.token || !appState.detailData) return;
  const data = appState.detailData;
  const isClosed = data.state === 'closed';
  const action = isClosed ? 'Reopen' : 'Close';
  confirm(action + ' #' + appState.detailNumber + '?', async () => {
    const { detailOwner: owner, detailRepo: repo, detailNumber: number } = appState;
    try {
      if (isClosed) await reopenIssue(appState.token, owner, repo, number);
      else await closeIssue(appState.token, owner, repo, number);
      showMessage(action + 'd #' + number, 'success');
      await loadDetail();
    } catch (e) { showMessage(action + ' failed: ' + e.message, 'error'); }
  });
}

export function mergePR() {
  if (!appState.token || !appState.detailData || appState.detailType !== 'pull_request') return;
  const pr = appState.detailData;
  if (!pr.mergeable) {
    showMessage('PR is not mergeable', 'warning');
    return;
  }
  confirm('Merge PR #' + appState.detailNumber + ' (' + (pr.merge_method || 'merge') + ')?', async () => {
    const { detailOwner: owner, detailRepo: repo, detailNumber: number } = appState;
    try {
      await mergePullRequest(appState.token, owner, repo, number);
      showMessage('Merged #' + number, 'success');
      await loadDetail();
    } catch (e) { showMessage('Merge failed: ' + e.message, 'error'); }
  });
}

export function viewFileDiff(index) {
  if (!appState.detailFiles[index]) return;
  const file = appState.detailFiles[index];
  appState.detailDiffView = true;
  appState.detailDiffFile = file;
  appState.detailDiffContent = file.patch || '(no diff available)';
  appState.detailDiffScroll = 0;
  render();
}

export function closeDiffView() {
  appState.detailDiffView = false;
  appState.detailDiffFile = null;
  appState.detailDiffContent = '';
  appState.detailDiffScroll = 0;
  render();
}

// ─── Render ──────────────────────────────────────────────────────

export function renderDetail(screen) {
  if (!appState.showDetail) return;
  const W = screen.width;
  const H = screen.height;
  const data = appState.detailData;

  // Backdrop.
  const backdropStyle = color('modalBackdrop');
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) screen.styleBuf[yy][xx] = backdropStyle;
  }

  const boxW = Math.min(100, W - 4);
  const boxH = H - 4;
  const bx = Math.floor((W - boxW) / 2);
  const by = 2;

  for (let yy = by; yy < by + boxH; yy++) {
    for (let xx = bx; xx < bx + boxW; xx++) screen.setCell(xx, yy, ' ', null);
  }

  const typeName = appState.detailType === 'pull_request' ? 'PR' : 'Issue';
  const title = typeName + ' #' + (appState.detailNumber || '?');
  screen.box(bx, by, boxW, boxH, title);

  if (appState.detailLoading || !data) {
    screen.writeStr(bx + 2, by + 2, 'Loading...', color('dim'));
    return;
  }

  const innerW = boxW - 4;
  const innerX = bx + 2;

  // Header line: state + title + author + date
  const stateStyle = data.state === 'closed' ? color('error') : color('success');
  screen.writeStr(innerX, by + 1, data.state.toUpperCase(), stateStyle);
  const author = (data.user && data.user.login) || '?';
  const when = data.created_at ? relTime(data.created_at) : '';
  const authorBlock = author + ' ' + when;
  const titleMaxW = innerW - data.state.length - 2 - authorBlock.length - 3;
  const hdrText = '  ' + truncate(data.title || '', Math.max(10, titleMaxW));
  screen.writeStr(innerX + data.state.length + 2, by + 1, hdrText);
  screen.writeStr(bx + boxW - authorBlock.length - 3, by + 1, authorBlock, color('dim'));

  // Labels
  if (data.labels && data.labels.length > 0) {
    let lx = innerX;
    for (const lb of data.labels.slice(0, 6)) {
      const lbText = ' ' + lb.name + ' ';
      const bgColor = hexToNamedColor(lb.color);
      screen.writeStr(lx, by + 2, lbText, { bg: bgColor, fg: 'white' });
      lx += lbText.length + 1;
      if (lx > bx + boxW - 6) break;
    }
  }

  // Pane tabs
  const tabs = [
    ['body', 'Body'],
    ['comments', 'Comments (' + appState.detailComments.length + ')'],
  ];
  if (appState.detailType === 'pull_request') {
    tabs.push(['reviews', 'Reviews (' + appState.detailReviews.length + ')']);
    tabs.push(['files', 'Files (' + appState.detailFiles.length + ')']);
  }
  let tx = innerX;
  const tabY = by + 3;
  for (const [id, label] of tabs) {
    const sel = appState.detailTab === id;
    const text = sel ? ' [' + label + '] ' : '  ' + label + '  ';
    screen.writeStr(tx, tabY, text, sel ? color('chipActive') : color('chipInactive'));
    tx += text.length;
  }
  // Action bar — only show actions that fit.
  const actionY = tabY;
  const allActions = ['c Comment', 'r React'];
  if (appState.detailType === 'pull_request' && data.mergeable) allActions.push('M Merge');
  if (appState.detailType === 'pull_request') allActions.push('C Checkout');
  if (data.state === 'open') allActions.push('x Close');
  else allActions.push('x Reopen');
  // Only render actions that fit before the tab labels end.
  const actions = [];
  let actionWidth = 0;
  for (const a of allActions) {
    if (actionWidth + a.length + 1 > innerW * 0.45) break;
    actions.push(a);
    actionWidth += a.length + 1;
  }
  let ax = bx + boxW - 2;
  for (let i = actions.length - 1; i >= 0; i--) {
    ax -= actions[i].length + 1;
    screen.writeStr(ax, actionY, actions[i], color('accent'));
  }

  screen.hline(tabY + 1, '─', color('dim'));

  // Content area
  const contentY = tabY + 2;
  const contentH = boxH - 6;
  const scroll = appState.detailScroll;

  if (appState.detailTab === 'body') {
    renderBody(screen, data, innerX, contentY, innerW, contentH, scroll);
  } else if (appState.detailTab === 'comments') {
    renderComments(screen, innerX, contentY, innerW, contentH, scroll);
  } else if (appState.detailTab === 'reviews') {
    renderReviews(screen, innerX, contentY, innerW, contentH, scroll);
  } else if (appState.detailTab === 'files') {
    if (appState.detailDiffView) {
      renderDiffView(screen, innerX, contentY, innerW, contentH);
    } else {
      renderFiles(screen, innerX, contentY, innerW, contentH, scroll);
    }
  }

  // Reaction picker overlay
  if (appState.detailReactionPicker) {
    renderReactionPicker(screen, bx, by + boxH - 5, boxW);
  }

  // Scroll indicator
  const hintParts = ['[↑↓] scroll', '[Esc] close', '[c] comment', '[r] react'];
  if (appState.detailType === 'pull_request') hintParts.push('[C] checkout');
  screen.writeStr(bx + 2, by + boxH - 1, hintParts.join('  '), color('dim'));
}

function renderBody(screen, data, x, y, w, h, scroll) {
  const body = data.body || '(no description)';
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < h && (i + scroll) < lines.length; i++) {
    const ln = lines[i + scroll];
    const row = y + i;
    if (/^#{1,6}\s/.test(ln)) {
      screen.writeStr(x, row, truncate(ln.replace(/^#+\s*/, ''), w), { bold: true });
    } else if (/^\s*[-*+]\s/.test(ln)) {
      screen.writeStr(x, row, truncate(ln, w), color('accent'));
    } else if (/^\s*```/.test(ln)) {
      screen.writeStr(x, row, truncate(ln, w), color('dim'));
    } else if (/^\s*>/.test(ln)) {
      screen.writeStr(x, row, truncate(ln, w), color('dim'));
    } else {
      screen.writeStr(x, row, truncate(ln, w));
    }
  }
  if (lines.length > h) {
    screen.writeStr(x, y + h, (scroll + 1) + '-' + Math.min(scroll + h, lines.length) +
      ' of ' + lines.length, color('dim'));
  }
}

function renderComments(screen, x, y, w, h, scroll) {
  const comments = appState.detailComments;
  if (comments.length === 0) {
    screen.writeStr(x, y, '(no comments yet)', color('dim'));
    return;
  }
  let row = y;
  let lineIdx = 0;
  let commentNum = 0;
  for (const c of comments) {
    commentNum++;
    if (lineIdx >= scroll + h) break;
    if (lineIdx >= scroll) {
      const author = (c.user && c.user.login) || '?';
      const when = c.created_at ? relTime(c.created_at) : '';
      const header = '── Comment #' + commentNum + ' ── ' + author + ' ' + when;
      screen.writeStr(x, row, truncate(header, w), color('accent'));
      row++;
      if (row >= y + h) break;
    }
    lineIdx++;
    const bodyLines = (c.body || '').split(/\r?\n/);
    for (const bl of bodyLines) {
      if (lineIdx >= scroll + h) break;
      if (lineIdx >= scroll) {
        screen.writeStr(x + 2, row, truncate(bl, w - 2));
        row++;
        if (row >= y + h) break;
      }
      lineIdx++;
    }
    if (lineIdx >= scroll + h) break;
    if (lineIdx >= scroll) {
      screen.hline(row, '──', color('dim'));
      row++;
      if (row >= y + h) break;
    }
    lineIdx++;
  }
}

function renderReviews(screen, x, y, w, h, scroll) {
  const reviews = appState.detailReviews;
  if (reviews.length === 0) {
    screen.writeStr(x, y, '(no reviews yet)', color('dim'));
    return;
  }
  let row = y;
  let lineIdx = 0;
  for (const r of reviews) {
    if (lineIdx >= scroll + h) break;
    if (lineIdx >= scroll) {
      const author = (r.user && r.user.login) || '?';
      const state = r.state || '?';
      const stateIcon = state === 'APPROVED' ? '✓' : state === 'CHANGES_REQUESTED' ? '✗' : state === 'COMMENTED' ? '✎' : '?';
      const header = stateIcon + ' ' + author + ' ' + state;
      screen.writeStr(x, row, truncate(header, w), color('accent'));
      row++;
      if (row >= y + h) break;
    }
    lineIdx++;
    if (r.body) {
      const bodyLines = r.body.split(/\r?\n/);
      for (const bl of bodyLines) {
        if (lineIdx >= scroll + h) break;
        if (lineIdx >= scroll) {
          screen.writeStr(x + 2, row, truncate(bl, w - 2));
          row++;
          if (row >= y + h) break;
        }
        lineIdx++;
      }
    }
    if (lineIdx >= scroll + h) break;
    if (lineIdx >= scroll) {
      screen.hline(row, '──', color('dim'));
      row++;
      if (row >= y + h) break;
    }
    lineIdx++;
  }
}

function renderFiles(screen, x, y, w, h, scroll) {
  const files = appState.detailFiles;
  if (files.length === 0) {
    screen.writeStr(x, y, '(no files changed)', color('dim'));
    return;
  }
  for (let i = 0; i < h && (i + scroll) < files.length; i++) {
    const f = files[i + scroll];
    const row = y + i;
    const idx = i + scroll;
    const sel = idx === appState.detailFileCursor;
    const status = f.status === 'added' ? '+' : f.status === 'removed' ? '-' : '~';
    const statusColor = f.status === 'added' ? color('success')
      : f.status === 'removed' ? color('error') : color('dim');
    if (sel) {
      for (let xx = x - 1; xx < x + w + 1; xx++) screen.styleBuf[row][xx] = color('selection');
    }
    screen.writeStr(x, row, sel ? '>' : ' ', sel ? color('selection') : null);
    screen.writeStr(x + 2, row, status, statusColor);
    screen.writeStr(x + 4, row, truncate(f.filename || '?', w - 22));
    const changes = '+' + (f.additions || 0) + ' -' + (f.deletions || 0);
    screen.writeStr(x + w - changes.length, row, changes, color('dim'));
  }
  if (files.length > h) {
    screen.writeStr(x, y + h, (scroll + 1) + '-' + Math.min(scroll + h, files.length) +
      ' of ' + files.length + ' files  [Enter] view diff', color('dim'));
  } else {
    screen.writeStr(x, y + h, '[Enter] view diff', color('dim'));
  }
}

function renderDiffView(screen, x, y, w, h) {
  const file = appState.detailDiffFile;
  const diff = appState.detailDiffContent;
  // Header
  screen.writeStr(x, y, (file && file.filename) || 'Diff', color('title'));
  screen.writeStr(x, y + 1, '[Esc] back to files', color('dim'));
  screen.hline(y + 2, '─', color('dim'));

  const lines = diff.split(/\r?\n/);
  const scroll = appState.detailDiffScroll;
  const startY = y + 3;
  const maxLines = h - 4;
  appState.detailDiffVisibleH = maxLines;
  for (let i = 0; i < maxLines && (i + scroll) < lines.length; i++) {
    const ln = lines[i + scroll];
    const row = startY + i;
    let style = null;
    if (ln.startsWith('+')) style = color('success');
    else if (ln.startsWith('-')) style = color('error');
    else if (ln.startsWith('@@')) style = color('accent');
    screen.writeStr(x, row, truncate(ln, w), style);
  }
  if (lines.length > maxLines) {
    screen.writeStr(x, startY + maxLines,
      'Lines ' + (scroll + 1) + '-' + Math.min(scroll + maxLines, lines.length) +
      ' of ' + lines.length, color('dim'));
  }
}

function renderReactionPicker(screen, bx, by, bw) {
  const pw = Math.min(REACTIONS.length * 6 + 4, bw - 4);
  const px = bx + Math.floor((bw - pw) / 2);
  for (let xx = px; xx < px + pw; xx++) screen.setCell(xx, by, ' ', null);
  screen.box(px, by, pw, 3, 'React');
  let rx = px + 2;
  for (let i = 0; i < REACTIONS.length; i++) {
    const r = REACTIONS[i];
    const sel = i === appState.detailReactionCursor;
    const text = sel ? '>' + r : ' ' + r;
    screen.writeStr(rx, by + 1, text, sel ? color('selection') : color('accent'));
    rx += r.length + 2;
  }
}

// ─── Key handlers ───────────────────────────────────────────────

export const keys = {
  'c': openCommentInput,
  'r': toggleReactionPicker,
  'M': () => { if (appState.detailType === 'pull_request') mergePR(); },
  'x': closeOrReopen,
  'C': async () => {
    if (appState.detailType !== 'pull_request' || !appState.detailData) return;
    const pr = appState.detailData;
    const branch = pr.head && pr.head.ref;
    if (!branch) { showMessage('No branch info available', 'warning'); return; }

    const baseRepo = pr.base && pr.base.repo && pr.base.repo.full_name;
    const localFullName = appState.localRepo ? (appState.localRepo.owner + '/' + appState.localRepo.repo).toLowerCase() : '';
    if (!appState.localRepo || !baseRepo || baseRepo.toLowerCase() !== localFullName) {
      showMessage('Not inside the local git repository for this PR', 'error');
      return;
    }

    confirm('Checkout branch "' + branch + '"?', async () => {
      try {
        const { execSync } = await import('child_process');
        let success = false;
        try {
          // 1. Try github-cli first, which is the most robust and sets up correct remotes
          execSync('gh pr checkout ' + pr.number, { stdio: 'pipe', timeout: 30000 });
          success = true;
        } catch {
          // 2. Fall back to manual fetch from PR head ref and checkout-reset branch
          execSync('git fetch origin pull/' + pr.number + '/head && git checkout -B ' + branch + ' FETCH_HEAD',
            { stdio: 'pipe', timeout: 30000 });
          success = true;
        }
        if (success) {
          showMessage('Checked out ' + branch, 'success');
        }
      } catch (e) {
        showMessage('Checkout failed: ' + (e.message || 'unknown'), 'error');
      }
    });
  },
  'y': () => {
    if (!appState.detailData) return;
    const url = appState.detailData.html_url;
    if (url && copyToClipboard(url)) showMessage('Copied to clipboard', 'success');
  },
  'g': () => { appState.detailScroll = 0; render(); },
  'G': () => {
    const lines = getBodyLines();
    appState.detailScroll = Math.max(0, lines - 1);
    render();
  },
};

export function up() {
  if (appState.detailReactionPicker) {
    appState.detailReactionCursor =
      (appState.detailReactionCursor - 1 + REACTIONS.length) % REACTIONS.length;
    render();
    return;
  }
  if (appState.detailDiffView) {
    appState.detailDiffScroll = Math.max(0, appState.detailDiffScroll - 1);
    render();
    return;
  }
  if (appState.detailTab === 'files' && !appState.detailDiffView) {
    appState.detailFileCursor = Math.max(0, appState.detailFileCursor - 1);
    render();
    return;
  }
  appState.detailScroll = Math.max(0, appState.detailScroll - 1);
  render();
}

export function down() {
  if (appState.detailReactionPicker) {
    appState.detailReactionCursor =
      (appState.detailReactionCursor + 1) % REACTIONS.length;
    render();
    return;
  }
  if (appState.detailDiffView) {
    const maxScroll = Math.max(0, appState.detailDiffContent.split(/\r?\n/).length - appState.detailDiffVisibleH);
    appState.detailDiffScroll = Math.min(maxScroll, appState.detailDiffScroll + 1);
    render();
    return;
  }
  if (appState.detailTab === 'files' && !appState.detailDiffView) {
    const max = Math.max(0, appState.detailFiles.length - 1);
    appState.detailFileCursor = Math.min(max, appState.detailFileCursor + 1);
    render();
    return;
  }
  const maxScroll = Math.max(0, getBodyLines() - 1);
  appState.detailScroll = Math.min(maxScroll, appState.detailScroll + 1);
  render();
}

export function enter() {
  if (appState.detailReactionPicker) {
    const r = REACTIONS[appState.detailReactionCursor];
    if (r) addReaction(r);
    return;
  }
  if (appState.detailDiffView) {
    closeDiffView();
    return;
  }
  if (appState.detailTab === 'files' && !appState.detailDiffView) {
    viewFileDiff(appState.detailFileCursor);
    return;
  }
  // Cycle tabs
  const tabs = ['body', 'comments'];
  if (appState.detailType === 'pull_request') {
    tabs.push('reviews');
    tabs.push('files');
  }
  const idx = tabs.indexOf(appState.detailTab);
  const nextTab = tabs[(idx + 1) % tabs.length];
  appState.detailTab = nextTab;
  appState.detailScroll = 0;
  appState.detailFileCursor = 0;
  showMessage(nextTab.charAt(0).toUpperCase() + nextTab.slice(1), 'info', 1000);
  render();
}

function getBodyLines() {
  if (appState.detailTab === 'body') {
    return (appState.detailData && appState.detailData.body || '').split(/\r?\n/).length;
  } else if (appState.detailTab === 'comments') {
    let count = 0;
    for (const c of appState.detailComments) {
      count += 1 + (c.body ? c.body.split(/\r?\n/).length : 0) + 1;
    }
    return count;
  } else if (appState.detailTab === 'reviews') {
    let count = 0;
    for (const r of appState.detailReviews) {
      count += 1 + (r.body ? r.body.split(/\r?\n/).length : 0) + 1;
    }
    return count;
  } else if (appState.detailTab === 'files') {
    return appState.detailFiles.length;
  }
  return 0;
}
