// Packages sub-pane — load release assets and render download list.

import { appState, render, startAsync, isStale, showMessage, beginLoading, finishLoading } from '../state.mjs';
import { getReleaseAssets, downloadToFile } from '../github.mjs';
import { truncate, truncateToWidth, displayWidth, formatBytes, sectionHeader, safeCwdJoin } from '../utils.mjs';
import { color } from '../theme.mjs';
import { loadingIndicator, scrollIndicators } from '../render.mjs';
import { existsSync } from 'fs';

export async function loadReleaseAssets(silent = false) {
  const repo = appState.repoDetails;
  if (!repo || !appState.repoReleases.length) return;
  const gen = startAsync('analyze-packages');
  if (!silent) {
    beginLoading(gen);
    appState.repoReleaseAssets = [];
    render();
  }
  try {
    const [owner, name] = repo.full_name.split('/');
    const allAssets = [];
    for (const rel of appState.repoReleases.slice(0, 3)) {
      const assets = await getReleaseAssets(appState.token, owner, name, rel.id, gen.signal);
      if (isStale(gen, 'analyze-packages')) { finishLoading(gen); return; }
      if (Array.isArray(assets)) {
        for (const a of assets) {
          allAssets.push({ ...a, releaseTag: rel.tag_name, releaseName: rel.name });
        }
      }
    }
    appState.repoReleaseAssets = allAssets;
  } catch (e) {
    if (!isStale(gen, 'analyze-packages')) showMessage('Failed to load release assets', 'error');
  }
  if (!silent) finishLoading(gen);
  if (!isStale(gen, 'analyze-packages')) render();
}

export async function downloadAsset(asset) {
  if (!asset || !asset.browser_download_url) return;
  const fileName = asset.name || 'download';
  const dest = safeCwdJoin(fileName);
  if (existsSync(dest)) {
    showMessage('File ' + fileName + ' already exists', 'warning');
    return;
  }
  showMessage('Downloading ' + fileName + '...', 'info');
  render();
  try {
    const res = await downloadToFile(asset.browser_download_url, dest, appState.token);
    showMessage('Downloaded ' + fileName + ' (' + formatBytes(res.bytes) + ')', 'success');
  } catch (e) {
    showMessage('Download failed: ' + e.message, 'error');
  }
}

// Fluid table layout for the asset list. Measures the visible rows, pins
// size / tag / downloads to the right edge, and hands every remaining cell
// to the file name (which used to be hard-capped at 35). Narrow columns are
// dropped left-to-right (downloads, tag, size) before the name ever shrinks
// below minName. Hidden columns come back as -1. Exported for tests.
export function layoutPackageColumns(W, sizeTexts, tagTexts, dlTexts, opts = {}) {
  const nameX = 5;
  const minName = opts.minName ?? 8;
  const rightEdge = W - 2; // 2-cell right margin
  const sizeW = Math.max(0, ...sizeTexts.map(displayWidth));
  const tagW = Math.max(0, ...tagTexts.map(displayWidth));
  const dlW = Math.min(14, Math.max(0, ...dlTexts.map(displayWidth)));
  let cursor = rightEdge;
  let dlX = -1, tagX = -1, sizeX = -1;
  if (dlTexts.some(Boolean) && cursor - dlW - 2 - nameX >= minName) {
    dlX = cursor - dlW;
    cursor = dlX - 2;
  }
  if (tagTexts.some(Boolean) && cursor - tagW - 2 - nameX >= minName) {
    tagX = cursor - tagW;
    cursor = tagX - 2;
  }
  if (sizeTexts.some(Boolean) && cursor - sizeW - nameX >= minName) {
    sizeX = cursor - sizeW;
    cursor = sizeX - 2;
  }
  const firstCol = Math.min(...[sizeX, tagX, dlX].filter(x => x >= 0), rightEdge);
  const nameW = Math.max(4, firstCol - (firstCol === rightEdge ? 0 : 2) - nameX);
  return { nameX, nameW, sizeX, tagX, dlX };
}

export function renderPackagesPane(screen, y, maxH) {
  const W = screen.width;
  const assets = appState.repoReleaseAssets;
  sectionHeader(screen, 2, y, '📦 RELEASE PACKAGES (' + assets.length + ')');
  if (assets.length === 0) {
    if (appState.loading) {
      loadingIndicator(screen, 2, y + 2, 'loading assets');
    } else if (appState.repoReleases.length > 0) {
      screen.writeStr(2, y + 2, 'No downloadable assets in recent releases', { dim: true });
      screen.writeStr(2, y + 3, '(releases exist but have no uploaded binaries)', { dim: true });
    } else {
      screen.writeStr(2, y + 2, '(no release packages found)', { dim: true });
    }
    return;
  }
  screen.hline(y + 1, '─', { dim: true });
  const start = appState.detailsScroll;
  const rows = Math.max(1, maxH - 4);
  const visible = [];
  for (let i = 0; i < rows && start + i < assets.length; i++) visible.push(assets[start + i]);

  // Preformat one display string per cell, then lay out fluidly.
  const sizeTexts = visible.map(a => (a.size ? formatBytes(a.size) : '?'));
  const tagTexts = visible.map(a => truncate(a.releaseTag || '', 16));
  const dlTexts = visible.map(a => (a.download_count !== undefined ? '↓' + a.download_count : ''));
  const { nameX, nameW, sizeX, tagX, dlX } = layoutPackageColumns(W, sizeTexts, tagTexts, dlTexts);

  for (let i = 0; i < visible.length; i++) {
    const a = visible[i];
    const row = y + 2 + i;
    const sel = start + i === appState.selectedAsset;
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    screen.writeStr(2, row, sel ? '▶' : '  ', sel ? color('selection') : color('dim'));
    screen.writeStr(nameX, row, truncateToWidth(a.name || '?', nameW, ''), sel ? color('selection') : color('packageName'));
    if (sizeX >= 0) screen.writeStr(sizeX, row, sizeTexts[i], sel ? color('selection') : color('packageSize'));
    if (tagX >= 0) screen.writeStr(tagX, row, tagTexts[i], sel ? color('selection') : color('packageTag'));
    if (dlX >= 0 && dlTexts[i]) {
      screen.writeStr(dlX, row, truncateToWidth(dlTexts[i], W - 2 - dlX, ''), sel ? color('selection') : color('downloadCount'));
    }
  }
  scrollIndicators(screen, y + 2, y + 1 + rows, start, assets.length);
  const infoY = y + 2 + Math.min(rows, assets.length);
  if (infoY < y + maxH) {
    const range = (start + 1) + '-' + Math.min(start + rows, assets.length) + ' of ' + assets.length;
    screen.writeStr(2, infoY, range + '   [Enter] Download   [↑↓] Navigate', { dim: true });
  }
}
