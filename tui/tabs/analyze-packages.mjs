// Packages sub-pane — load release assets and render download list.

import { appState, render, startAsync, isStale, showMessage, beginLoading, finishLoading } from '../state.mjs';
import { getReleaseAssets, downloadToFile } from '../github.mjs';
import { truncate, formatBytes, sectionHeader, safeCwdJoin } from '../utils.mjs';
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
  for (let i = 0; i < rows && start + i < assets.length; i++) {
    const a = assets[start + i];
    const row = y + 2 + i;
    const sel = start + i === appState.selectedAsset;
    if (sel) {
      for (let x = 0; x < W; x++) screen.styleBuf[row][x] = color('selection');
    }
    screen.writeStr(2, row, sel ? '▶' : '  ', sel ? color('selection') : color('dim'));
    const name = truncate(a.name || '?', 35);
    screen.writeStr(5, row, name, sel ? color('selection') : color('packageName'));
    const size = a.size ? formatBytes(a.size) : '?';
    screen.writeStr(42, row, size, sel ? color('selection') : color('packageSize'));
    const tag = truncate(a.releaseTag || '', 12);
    screen.writeStr(54, row, tag, sel ? color('selection') : color('packageTag'));
    const dl = a.download_count !== undefined ? '↓' + a.download_count : '';
    if (dl && 68 + dl.length < W) {
      screen.writeStr(68, row, dl, sel ? color('selection') : color('downloadCount'));
    }
  }
  scrollIndicators(screen, y + 2, y + 1 + rows, start, assets.length);
  const infoY = y + 2 + Math.min(rows, assets.length);
  if (infoY < y + maxH) {
    const range = (start + 1) + '-' + Math.min(start + rows, assets.length) + ' of ' + assets.length;
    screen.writeStr(2, infoY, range + '   [Enter] Download   [↑↓] Navigate', { dim: true });
  }
}
