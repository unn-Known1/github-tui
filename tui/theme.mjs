// Theme system. Each theme maps semantic role names to style objects
// { fg?, bg?, bold?, dim?, underline?, inverse? } that screen.mjs understands.
// Base theme + per-theme overrides — only the keys that differ are listed.

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { THEME_FILE } from './config.mjs';

const B = {
  title: { fg: 'white', bold: true },
  heading: { fg: 'white', bold: true },
  dim: { dim: true },
  accent: { fg: 'cyan' },
  star: { fg: 'yellow' },
  fork: { fg: 'cyan' },
  issue: { fg: 'yellow' },
  pr: { fg: 'cyan' },
  release: { fg: 'green' },
  success: { fg: 'green' },
  warning: { fg: 'yellow' },
  error: { fg: 'red' },
  info: { fg: 'cyan' },
  selection: { bg: 'blue', fg: 'white', bold: true },
  selectionDim: { bg: 'darkGray', fg: 'white' },
  header: { fg: 'white', bold: true, underline: true },
  statusBar: { bg: 'darkGray', fg: 'white' },
  chipActive: { bg: 'cyan', fg: 'darkGray', bold: true },
  chipInactive: { dim: true },
  modalBackdrop: { bg: 'darkGray' },
  languageBar: { fg: 'cyan' },
  activity: { fg: 'green' },
  trending: { fg: 'magenta' },
  unread: { fg: 'yellow' },
  muted: { dim: true },
  tabBar: { dim: true },
  tabBarActive: { fg: 'white', bold: true, underline: true },
  inputBox: { fg: 'cyan', underline: true },
};

const O = (o) => ({ ...B, ...o });

const THEMES = {
  default: B,
  highContrast: O({
    heading: { fg: 'white', bold: true, underline: true },
    dim: { fg: 'gray' },
    accent: { fg: 'white', bold: true },
    star: { fg: 'yellow', bold: true },
    fork: { fg: 'cyan', bold: true },
    issue: { fg: 'yellow', bold: true },
    pr: { fg: 'cyan', bold: true },
    release: { fg: 'green', bold: true },
    success: { fg: 'green', bold: true },
    warning: { fg: 'yellow', bold: true },
    error: { fg: 'red', bold: true },
    info: { fg: 'cyan', bold: true },
    chipInactive: { fg: 'gray' },
    languageBar: { fg: 'cyan', bold: true },
    activity: { fg: 'green', bold: true },
    trending: { fg: 'magenta', bold: true },
    unread: { fg: 'yellow', bold: true },
    muted: { fg: 'gray' },
    tabBar: { fg: 'gray' },
    inputBox: { fg: 'white', bold: true, underline: true },
  }),
  dracula: O({
    heading: { fg: 'magenta', bold: true },
    accent: { fg: 'magenta' },
    issue: { fg: 'magenta' },
    pr: { fg: 'green' },
    header: { fg: 'magenta', bold: true, underline: true },
    chipActive: { bg: 'magenta', fg: 'darkGray', bold: true },
    languageBar: { fg: 'magenta' },
    unread: { fg: 'magenta' },
    tabBarActive: { fg: 'magenta', bold: true, underline: true },
    inputBox: { fg: 'magenta', underline: true },
  }),
  solarized: O({
    heading: { fg: 'yellow', bold: true },
    accent: { fg: 'blue' },
    pr: { fg: 'blue' },
    header: { fg: 'yellow', bold: true, underline: true },
    chipActive: { bg: 'blue', fg: 'darkGray', bold: true },
    info: { fg: 'blue' },
    languageBar: { fg: 'blue' },
    tabBarActive: { fg: 'yellow', bold: true, underline: true },
    inputBox: { fg: 'blue', underline: true },
  }),
  nord: O({
    heading: { fg: 'cyan', bold: true },
    header: { fg: 'cyan', bold: true, underline: true },
    tabBarActive: { fg: 'cyan', bold: true, underline: true },
  }),
  monokai: O({
    heading: { fg: 'green', bold: true },
    accent: { fg: 'yellow' },
    pr: { fg: 'magenta' },
    header: { fg: 'green', bold: true, underline: true },
    chipActive: { bg: 'yellow', fg: 'darkGray', bold: true },
    languageBar: { fg: 'magenta' },
    tabBarActive: { fg: 'yellow', bold: true, underline: true },
    inputBox: { fg: 'yellow', underline: true },
  }),
  gruvbox: O({
    heading: { fg: 'yellow', bold: true },
    accent: { fg: 'cyan' },
    issue: { fg: 'red' },
    pr: { fg: 'green' },
    header: { fg: 'yellow', bold: true, underline: true },
    chipActive: { bg: 'yellow', fg: 'darkGray', bold: true },
    tabBarActive: { fg: 'yellow', bold: true, underline: true },
    inputBox: { fg: 'yellow', underline: true },
  }),
  light: {
    title: { fg: 'blue', bold: true },
    heading: { fg: 'blue', bold: true },
    dim: { fg: 'gray' },
    accent: { fg: 'cyan' },
    star: { fg: 'yellow', bold: true },
    fork: { fg: 'cyan' },
    issue: { fg: 'yellow', bold: true },
    pr: { fg: 'cyan' },
    release: { fg: 'green', bold: true },
    success: { fg: 'green', bold: true },
    warning: { fg: 'yellow', bold: true },
    error: { fg: 'red', bold: true },
    info: { fg: 'cyan' },
    selection: { bg: 'blue', fg: 'white', bold: true },
    selectionDim: { bg: 'gray', fg: 'white' },
    header: { fg: 'blue', bold: true, underline: true },
    statusBar: { bg: 'gray', fg: 'white' },
    chipActive: { bg: 'blue', fg: 'white', bold: true },
    chipInactive: { fg: 'gray' },
    modalBackdrop: { bg: 'gray' },
    languageBar: { fg: 'cyan' },
    activity: { fg: 'green', bold: true },
    trending: { fg: 'magenta' },
    unread: { fg: 'yellow', bold: true },
    muted: { fg: 'gray' },
    tabBar: { fg: 'gray' },
    tabBarActive: { fg: 'blue', bold: true, underline: true },
    inputBox: { fg: 'blue', bold: true, underline: true },
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

export function color(role) {
  return THEMES[active][role] ?? null;
}
