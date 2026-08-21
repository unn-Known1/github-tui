// Safe plugin/widget foundation. Discovery validates manifests but does not
// execute arbitrary code; execution requires a future capability sandbox.

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { validatePluginManifest } from './recommended-features.mjs';

export const PLUGINS_DIR = join(homedir(), '.github-tui', 'plugins');

export function discoverPlugins(dir = PLUGINS_DIR) {
  if (!existsSync(dir)) return [];
  const result = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const manifestPath = join(dir, name.name, 'plugin.json');
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const check = validatePluginManifest(manifest);
      result.push(check.ok ? { ...check.manifest, path: join(dir, name.name), status: 'discovered' } :
        { id: name.name, path: join(dir, name.name), status: 'invalid', error: check.error });
    } catch (error) {
      result.push({ id: name.name, path: join(dir, name.name), status: 'invalid', error: error.message });
    }
  }
  return result;
}
