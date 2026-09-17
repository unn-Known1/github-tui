// Safe plugin/widget foundation. Discovery validates manifests but does not
// execute arbitrary code; execution requires a future capability sandbox.

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { validatePluginManifest } from './recommended-features.mjs';

export const PLUGINS_DIR = join(homedir(), '.github-tui', 'plugins');

export function discoverPlugins(dir = PLUGINS_DIR) {
  if (!existsSync(dir)) return [];
  // existsSync does not guarantee readdirSync succeeds (permission change,
  // deletion, unmounted share between the two calls) — one throw here would
  // abort discovery of every other plugin.
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const result = [];
  for (const name of entries) {
    if (!name.isDirectory()) continue;
    // Skip symlinked directories (a symlink like `innocent -> /etc` passes
    // isDirectory() and would surface manifests from outside the plugins
    // root) and dot-directories (hidden/editor noise).
    if (name.isSymbolicLink()) continue;
    if (name.name.startsWith('.')) continue;
    const manifestPath = join(dir, name.name, 'plugin.json');
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const check = validatePluginManifest(manifest);
      result.push(check.ok ? { ...check.manifest, path: join(dir, name.name), status: 'discovered' } :
        { id: name.name, path: join(dir, name.name), status: 'invalid', error: check.error });
    } catch (error) {
      // Sanitize: raw error.message would leak absolute paths and Node
      // internals to the UI; the error code is stable and safe.
      result.push({ id: name.name, path: join(dir, name.name), status: 'invalid', error: error.code || 'read_error' });
    }
  }
  return result;
}
