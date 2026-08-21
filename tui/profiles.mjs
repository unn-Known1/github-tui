// Account/host profiles. Profile JSON contains labels and hosts only; tokens
// remain in the existing secure token store until a profile-aware keychain
// backend is selected.

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { CONFIG_DIR } from './config.mjs';
import { normalizeEnterpriseHost } from './recommended-features.mjs';
import { configureGitHubHosts } from './github.mjs';

export const PROFILES_FILE = join(CONFIG_DIR, 'profiles.json');

export function normalizeProfile(profile = {}) {
  const id = String(profile.id || profile.name || 'default').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 48) || 'default';
  const apiHost = normalizeEnterpriseHost(profile.apiHost || 'api.github.com');
  const webHost = normalizeEnterpriseHost(profile.webHost || (apiHost === 'api.github.com' ? 'github.com' : apiHost));
  if (!apiHost || !webHost) return null;
  return { id, label: String(profile.label || profile.name || id).trim().slice(0, 80), apiHost, webHost };
}

export function loadProfiles() {
  try {
    const parsed = JSON.parse(readFileSync(PROFILES_FILE, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeProfile).filter(Boolean);
  } catch { return []; }
}

export function saveProfiles(profiles) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  const safe = (profiles || []).map(normalizeProfile).filter(Boolean);
  writeFileSync(PROFILES_FILE, JSON.stringify(safe, null, 2));
  try { chmodSync(PROFILES_FILE, 0o600); } catch {}
  return safe;
}

export function upsertProfile(profile) {
  const normalized = normalizeProfile(profile);
  if (!normalized) return { ok: false, error: 'Invalid HTTPS API/web host' };
  const list = loadProfiles().filter(p => p.id !== normalized.id);
  list.push(normalized);
  return { ok: true, profile: normalized, profiles: saveProfiles(list) };
}

export function activateProfile(profile) {
  const normalized = normalizeProfile(profile);
  if (!normalized) throw new Error('Invalid profile hosts');
  configureGitHubHosts(normalized);
  return normalized;
}

export function activateProfileById(id) {
  const profile = loadProfiles().find(p => p.id === String(id || '').trim().toLowerCase());
  if (!profile) return { ok: false, error: 'Profile not found: ' + id };
  return { ok: true, profile: activateProfile(profile) };
}
