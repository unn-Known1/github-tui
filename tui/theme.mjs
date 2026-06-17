// Theme system. Each theme maps semantic role names to the screen.mjs color
// keys ('red','green','yellow','blue','magenta','cyan','white','bright','dim').
// Tab renderers should call theme.color('star') instead of hardcoding 'yellow'
// — that way new themes drop in without touching any tab.

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { THEME_FILE } from './config.mjs';

const THEMES = {
  default: {
    title: 'bright', heading: 'bright', dim: 'dim',
    accent: 'cyan', star: 'yellow', fork: 'cyan', issue: 'yellow',
    pr: 'cyan', release: 'green', success: 'green', warning: 'yellow',
    error: 'red', info: 'cyan', selection: 'bright',
    languageBar: 'cyan', activity: 'green', trending: 'magenta',
    unread: 'yellow', muted: 'dim',
  },
  highContrast: {
    title: 'bright', heading: 'bright', dim: 'white',
    accent: 'white', star: 'white', fork: 'white', issue: 'white',
    pr: 'white', release: 'white', success: 'white', warning: 'white',
    error: 'red', info: 'white', selection: 'bright',
    languageBar: 'white', activity: 'white', trending: 'white',
    unread: 'white', muted: 'dim',
  },
  dracula: {
    title: 'bright', heading: 'magenta', dim: 'dim',
    accent: 'magenta', star: 'yellow', fork: 'cyan', issue: 'magenta',
    pr: 'green', release: 'green', success: 'green', warning: 'yellow',
    error: 'red', info: 'cyan', selection: 'bright',
    languageBar: 'magenta', activity: 'green', trending: 'magenta',
    unread: 'magenta', muted: 'dim',
  },
  solarized: {
    title: 'bright', heading: 'yellow', dim: 'dim',
    accent: 'blue', star: 'yellow', fork: 'cyan', issue: 'yellow',
    pr: 'blue', release: 'green', success: 'green', warning: 'yellow',
    error: 'red', info: 'blue', selection: 'bright',
    languageBar: 'blue', activity: 'green', trending: 'magenta',
    unread: 'yellow', muted: 'dim',
  },
};

let active = 'default';

export function listThemes() { return Object.keys(THEMES); }
export function getThemeName() { return active; }

export function setTheme(name) {
  if (!THEMES[name]) return false;
  active = name;
  try { writeFileSync(THEME_FILE, name); } catch {}
  return true;
}

export function loadTheme() {
  try {
    if (existsSync(THEME_FILE)) {
      const name = readFileSync(THEME_FILE, 'utf-8').trim();
      if (THEMES[name]) active = name;
    }
  } catch {}
  return active;
}

// Resolve a semantic role → concrete screen color.
export function color(role) {
  return THEMES[active][role] ?? null;
}
