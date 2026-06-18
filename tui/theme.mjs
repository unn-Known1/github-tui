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
  // Subtle, professional selection highlight.
  selection: { bg: 'blue', fg: 'white', bold: true },
  selectionDim: { bg: 'darkGray', fg: 'white' },
  header: { fg: 'white', bold: true, underline: true },
  statusBar: { bg: 'darkGray', fg: 'white' },
  // Top chrome bar
  chrome: { bg: 'darkGray', fg: 'white' },
  chromeAccent: { bg: 'darkGray', fg: 'cyan', bold: true },
  // Tab strip
  tabInactive: { fg: 'gray' },
  tabActive: { fg: 'white', bold: true },
  tabActiveBg: { bg: 'cyan', fg: 'darkGray', bold: true },
  tabBadge: { bg: 'yellow', fg: 'darkGray', bold: true },
  // Chips
  chipActive: { bg: 'cyan', fg: 'darkGray', bold: true },
  chipInactive: { dim: true },
  chipDismissible: { bg: 'darkGray', fg: 'cyan' },
  // Modal / overlay
  modalBackdrop: { bg: 'darkGray' },
  modalBorder: { fg: 'cyan', bold: true },
  // Language & data viz
  languageBar: { fg: 'cyan' },
  activity: { fg: 'green' },
  trending: { fg: 'magenta' },
  unread: { fg: 'yellow' },
  muted: { dim: true },
  tabBar: { dim: true },
  tabBarActive: { fg: 'white', bold: true, underline: true },
  // Input
  inputBox: { fg: 'cyan', underline: true },
  inputPrompt: { fg: 'cyan', bold: true },
  // Cards / sections
  cardLabel: { fg: 'gray' },
  cardValue: { fg: 'white', bold: true },
  // Breadcrumb
  breadcrumb: { fg: 'gray' },
  breadcrumbSep: { fg: 'darkGray' },
  breadcrumbActive: { fg: 'cyan', bold: true },
  // Onboarding
  welcomeTitle: { fg: 'cyan', bold: true },
  welcomeAccent: { fg: 'yellow' },
  // Key hints
  keyHint: { fg: 'cyan', bold: true },
  keyHintBracket: { fg: 'gray' },
  // Rate-limit bar
  rateOk: { fg: 'green' },
  rateWarn: { fg: 'yellow' },
  rateCrit: { fg: 'red' },
  // Toasts (used in renderConfirmDialog as well)
  toastInfo: { fg: 'cyan', bold: true },
  toastSuccess: { fg: 'green', bold: true },
  toastError: { fg: 'red', bold: true },
  toastWarning: { fg: 'yellow', bold: true },
  // Section accent
  sectionHeading: { fg: 'cyan', bold: true },
  // Repo / list items
  repoName: { fg: 'white' },
  repoNameSelected: { fg: 'white', bold: true },
  statValue: { fg: 'white', bold: true },
  date: { dim: true },
  // Packages / downloads
  packageName: { fg: 'white' },
  packageSize: { dim: true },
  packageTag: { fg: 'cyan' },
  downloadCount: { dim: true },
  // Pinned / bookmarked
  pinned: { fg: 'yellow', bold: true },
  bookmarked: { fg: 'magenta' },
  // Card
  cardBorder: { dim: true },
  cardBorderFocused: { fg: 'cyan', bold: true },
  // List item
  listItem: { fg: 'white' },
  listItemDim: { dim: true },
  // Empty state
  emptyIcon: { fg: 'cyan' },
  emptyTitle: { fg: 'white', bold: true },
  emptyMessage: { dim: true },
  // Heatmap
  heatmapLow: { fg: 'green', dim: true },
  heatmapMid: { fg: 'green' },
  heatmapHigh: { fg: 'green', bold: true },
  // New panes
  traffic: { fg: 'cyan' },
  milestone: { fg: 'yellow' },
  label: { fg: 'magenta' },
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
    tabInactive: { fg: 'gray' },
    inputBox: { fg: 'white', bold: true, underline: true },
    breadcrumb: { fg: 'gray' },
    sectionHeading: { fg: 'white', bold: true },
    pinned: { fg: 'yellow', bold: true },
    bookmarked: { fg: 'magenta', bold: true },
    packageName: { fg: 'white', bold: true },
    packageTag: { fg: 'cyan', bold: true },
    heatmapLow: { fg: 'green' },
    heatmapMid: { fg: 'green', bold: true },
    heatmapHigh: { fg: 'green', bold: true },
  }),
  dracula: O({
    heading: { fg: 'magenta', bold: true },
    accent: { fg: 'magenta' },
    issue: { fg: 'magenta' },
    pr: { fg: 'green' },
    header: { fg: 'magenta', bold: true, underline: true },
    chipActive: { bg: 'magenta', fg: 'darkGray', bold: true },
    tabActiveBg: { bg: 'magenta', fg: 'darkGray', bold: true },
    languageBar: { fg: 'magenta' },
    unread: { fg: 'magenta' },
    tabBarActive: { fg: 'magenta', bold: true, underline: true },
    inputBox: { fg: 'magenta', underline: true },
    inputPrompt: { fg: 'magenta', bold: true },
    sectionHeading: { fg: 'magenta', bold: true },
    breadcrumbActive: { fg: 'magenta', bold: true },
    welcomeTitle: { fg: 'magenta', bold: true },
    keyHint: { fg: 'magenta', bold: true },
    pinned: { fg: 'magenta', bold: true },
    bookmarked: { fg: 'green' },
    packageName: { fg: 'magenta' },
    packageTag: { fg: 'green' },
    heatmapLow: { fg: 'magenta', dim: true },
    heatmapMid: { fg: 'magenta' },
    heatmapHigh: { fg: 'magenta', bold: true },
  }),
  solarized: O({
    heading: { fg: 'yellow', bold: true },
    accent: { fg: 'blue' },
    pr: { fg: 'blue' },
    header: { fg: 'yellow', bold: true, underline: true },
    chipActive: { bg: 'blue', fg: 'darkGray', bold: true },
    tabActiveBg: { bg: 'blue', fg: 'darkGray', bold: true },
    info: { fg: 'blue' },
    languageBar: { fg: 'blue' },
    tabBarActive: { fg: 'yellow', bold: true, underline: true },
    inputBox: { fg: 'blue', underline: true },
    inputPrompt: { fg: 'blue', bold: true },
    sectionHeading: { fg: 'blue', bold: true },
    breadcrumbActive: { fg: 'blue', bold: true },
    welcomeTitle: { fg: 'yellow', bold: true },
    keyHint: { fg: 'blue', bold: true },
    pinned: { fg: 'yellow', bold: true },
    bookmarked: { fg: 'blue' },
    packageName: { fg: 'blue' },
    packageTag: { fg: 'yellow' },
    heatmapLow: { fg: 'blue', dim: true },
    heatmapMid: { fg: 'blue' },
    heatmapHigh: { fg: 'blue', bold: true },
  }),
  nord: O({
    heading: { fg: 'cyan', bold: true },
    header: { fg: 'cyan', bold: true, underline: true },
    tabBarActive: { fg: 'cyan', bold: true, underline: true },
    sectionHeading: { fg: 'cyan', bold: true },
    breadcrumbActive: { fg: 'cyan', bold: true },
    pinned: { fg: 'cyan', bold: true },
    bookmarked: { fg: 'cyan' },
    packageName: { fg: 'cyan' },
    packageTag: { fg: 'cyan' },
    heatmapLow: { fg: 'cyan', dim: true },
    heatmapMid: { fg: 'cyan' },
    heatmapHigh: { fg: 'cyan', bold: true },
  }),
  monokai: O({
    heading: { fg: 'green', bold: true },
    accent: { fg: 'yellow' },
    pr: { fg: 'magenta' },
    header: { fg: 'green', bold: true, underline: true },
    chipActive: { bg: 'yellow', fg: 'darkGray', bold: true },
    tabActiveBg: { bg: 'yellow', fg: 'darkGray', bold: true },
    languageBar: { fg: 'magenta' },
    tabBarActive: { fg: 'yellow', bold: true, underline: true },
    inputBox: { fg: 'yellow', underline: true },
    inputPrompt: { fg: 'yellow', bold: true },
    sectionHeading: { fg: 'green', bold: true },
    breadcrumbActive: { fg: 'yellow', bold: true },
    welcomeTitle: { fg: 'yellow', bold: true },
    keyHint: { fg: 'yellow', bold: true },
    pinned: { fg: 'yellow', bold: true },
    bookmarked: { fg: 'magenta' },
    packageName: { fg: 'green' },
    packageTag: { fg: 'yellow' },
    heatmapLow: { fg: 'green', dim: true },
    heatmapMid: { fg: 'green' },
    heatmapHigh: { fg: 'green', bold: true },
  }),
  gruvbox: O({
    heading: { fg: 'yellow', bold: true },
    accent: { fg: 'cyan' },
    issue: { fg: 'red' },
    pr: { fg: 'green' },
    header: { fg: 'yellow', bold: true, underline: true },
    chipActive: { bg: 'yellow', fg: 'darkGray', bold: true },
    tabActiveBg: { bg: 'yellow', fg: 'darkGray', bold: true },
    tabBarActive: { fg: 'yellow', bold: true, underline: true },
    inputBox: { fg: 'yellow', underline: true },
    inputPrompt: { fg: 'yellow', bold: true },
    sectionHeading: { fg: 'yellow', bold: true },
    breadcrumbActive: { fg: 'yellow', bold: true },
    welcomeTitle: { fg: 'yellow', bold: true },
    keyHint: { fg: 'yellow', bold: true },
    pinned: { fg: 'yellow', bold: true },
    bookmarked: { fg: 'cyan' },
    packageName: { fg: 'yellow' },
    packageTag: { fg: 'cyan' },
    heatmapLow: { fg: 'yellow', dim: true },
    heatmapMid: { fg: 'yellow' },
    heatmapHigh: { fg: 'yellow', bold: true },
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
    chrome: { bg: 'gray', fg: 'white' },
    chromeAccent: { bg: 'gray', fg: 'blue', bold: true },
    tabInactive: { fg: 'gray' },
    tabActive: { fg: 'blue', bold: true },
    tabActiveBg: { bg: 'blue', fg: 'white', bold: true },
    tabBadge: { bg: 'yellow', fg: 'gray', bold: true },
    chipActive: { bg: 'blue', fg: 'white', bold: true },
    chipInactive: { fg: 'gray' },
    chipDismissible: { bg: 'gray', fg: 'blue' },
    modalBackdrop: { bg: 'gray' },
    modalBorder: { fg: 'blue', bold: true },
    languageBar: { fg: 'cyan' },
    activity: { fg: 'green', bold: true },
    trending: { fg: 'magenta' },
    unread: { fg: 'yellow', bold: true },
    muted: { fg: 'gray' },
    tabBar: { fg: 'gray' },
    tabBarActive: { fg: 'blue', bold: true, underline: true },
    inputBox: { fg: 'blue', bold: true, underline: true },
    inputPrompt: { fg: 'blue', bold: true },
    cardLabel: { fg: 'gray' },
    cardValue: { fg: 'blue', bold: true },
    breadcrumb: { fg: 'gray' },
    breadcrumbSep: { fg: 'gray' },
    breadcrumbActive: { fg: 'blue', bold: true },
    welcomeTitle: { fg: 'blue', bold: true },
    welcomeAccent: { fg: 'yellow' },
    keyHint: { fg: 'blue', bold: true },
    keyHintBracket: { fg: 'gray' },
    rateOk: { fg: 'green' },
    rateWarn: { fg: 'yellow' },
    rateCrit: { fg: 'red' },
    toastInfo: { fg: 'cyan', bold: true },
    toastSuccess: { fg: 'green', bold: true },
    toastError: { fg: 'red', bold: true },
    toastWarning: { fg: 'yellow', bold: true },
    sectionHeading: { fg: 'blue', bold: true },
    pinned: { fg: 'yellow', bold: true },
    bookmarked: { fg: 'magenta' },
    packageName: { fg: 'blue' },
    packageTag: { fg: 'yellow' },
    packageSize: { fg: 'gray' },
    heatmapLow: { fg: 'green', dim: true },
    heatmapMid: { fg: 'green' },
    heatmapHigh: { fg: 'green', bold: true },
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
