// Theme system — fully distinct palettes for every theme.
// Each theme maps semantic role names to style objects understood by screen.mjs.

// Color values accepted by screen.mjs:
//   'cyan'        → named ANSI-8 color (always works)
//   '#rrggbb'     → true-color hex  (falls back to 256-color on non-truecolor terminals)
//   [r, g, b]     → true-color tuple
//   '256:n'       → explicit xterm-256 index

// Available themes:
//   default — GitHub-inspired professional dark teal/cyan on near-black
//   light   — dark text on bright white for daylight use

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { NO_COLOR } from './config.mjs';
import { THEME_FILE } from './config.mjs';
import { appState } from './state.mjs';

// ── Palette constants ──────────────────────────────────────────────
// Named so themes read like a design spec, not a wall of hex codes.

const P = {
  // default — GitHub-inspired dark
  d_bg:      '#0d1117',
  d_fg:      '#e6edf3',
  d_fgDim:   '#8b949e',
  d_accent:  '#58a6ff',  // blue link
  d_green:   '#3fb950',
  d_yellow:  '#d29922',
  d_red:     '#f85149',
  d_orange:  '#e3b341',
  d_purple:  '#bc8cff',
  d_teal:    '#39d3c3',
  d_chrome:  '#161b22',
  d_sel:     '#1f6feb',

  // light — bright, paper-like
  lt_bg:     '#ffffff',
  lt_bg2:    '#f6f8fa',
  lt_border: '#d0d7de',
  lt_fg:     '#1f2328',
  lt_fgDim:  '#6e7781',
  lt_blue:   '#0550ae',
  lt_green:  '#1a7f37',
  lt_red:    '#cf222e',
  lt_orange: '#953800',
  lt_purple: '#8250df',
  lt_teal:   '#0969da',
  lt_sel:    '#0550ae',
};

// ── Helper: build a full theme from a spec object ──────────────────
// Every key is a semantic role. Missing keys fall back to the default theme.
function makeTheme(spec) {
  return spec;
}

// ── Default — GitHub dark, professional ───────────────────────────
const DEFAULT = makeTheme({
  title:       { fg: P.d_fg,     bold: true },
  heading:     { fg: P.d_fg,     bold: true },
  dim:         { fg: P.d_fgDim },
  accent:      { fg: P.d_accent },
  star:        { fg: P.d_orange, bold: true },
  fork:        { fg: P.d_teal },
  issue:       { fg: P.d_yellow },
  pr:          { fg: P.d_accent },
  release:     { fg: P.d_green },
  success:     { fg: P.d_green },
  warning:     { fg: P.d_yellow },
  error:       { fg: P.d_red },
  info:        { fg: P.d_accent },
  selection:   { bg: P.d_sel,    fg: '#ffffff', bold: true },
  selectionDim:{ bg: '#21262d',  fg: P.d_fgDim },
  header:      { fg: P.d_fg,     bold: true, underline: true },
  statusBar:   { bg: P.d_chrome, fg: P.d_fgDim },
  chrome:      { bg: P.d_chrome, fg: P.d_fg },
  chromeAccent:{ bg: P.d_chrome, fg: P.d_accent, bold: true },
  tabInactive: { fg: P.d_fgDim },
  tabActive:   { bg: P.d_sel,    fg: '#ffffff', bold: true },
  tabActiveBg: { bg: P.d_sel,    fg: '#ffffff', bold: true },
  tabBadge:    { bg: P.d_orange, fg: '#000000', bold: true },
  chipActive:  { bg: P.d_sel,    fg: '#ffffff', bold: true },
  chipInactive:{ fg: P.d_fgDim },
  chipDismissible: { bg: '#21262d', fg: P.d_accent },
  modalBackdrop:   { bg: '#161b22' },
  modalBorder:     { fg: P.d_accent, bold: true },
  languageBar: { fg: P.d_teal },
  activity:    { fg: P.d_green },
  trending:    { fg: P.d_purple },
  unread:      { fg: P.d_orange, bold: true },
  muted:       { fg: P.d_fgDim },
  tabBar:      { fg: P.d_fgDim },
  tabBarActive:{ fg: P.d_accent, bold: true, underline: true },
  inputBox:    { bg: '#161b22',  fg: P.d_accent, underline: true },
  inputPrompt: { fg: P.d_accent, bold: true },
  cardLabel:   { fg: P.d_fgDim },
  cardValue:   { fg: P.d_fg,     bold: true },
  breadcrumb:  { fg: P.d_fgDim },
  breadcrumbSep:{ fg: '#30363d' },
  breadcrumbActive: { fg: P.d_accent, bold: true },
  welcomeTitle:{ fg: P.d_accent, bold: true },
  welcomeAccent:{ fg: P.d_orange },
  keyHint:     { fg: P.d_accent, bold: true },
  keyHintBracket:{ fg: P.d_fgDim },
  rateOk:      { fg: P.d_green },
  rateWarn:    { fg: P.d_yellow },
  rateCrit:    { fg: P.d_red },
  toastInfo:   { bg: '#1c2d3e', fg: P.d_accent, bold: true },
  toastSuccess:{ bg: '#1a2f1a', fg: P.d_green,  bold: true },
  toastError:  { bg: '#2d1a1a', fg: P.d_red,    bold: true },
  toastWarning:{ bg: '#2d2a1a', fg: P.d_yellow, bold: true },
  sectionHeading: { fg: P.d_accent, bold: true },
  repoName:    { fg: P.d_fg },
  repoNameSelected: { fg: P.d_accent, bold: true },
  statValue:   { fg: P.d_fg,     bold: true },
  date:        { fg: P.d_fgDim },
  packageName: { fg: P.d_fg },
  packageSize: { fg: P.d_fgDim },
  packageTag:  { fg: P.d_teal },
  downloadCount:{ fg: P.d_fgDim },
  pinned:      { fg: P.d_orange, bold: true },
  bookmarked:  { fg: P.d_purple },
  cardBorder:  { fg: '#30363d' },
  cardBorderFocused: { fg: P.d_accent, bold: true },
  listItem:    { fg: P.d_fg },
  listItemDim: { fg: P.d_fgDim },
  emptyIcon:   { fg: P.d_teal },
  emptyTitle:  { fg: P.d_fg,     bold: true },
  emptyMessage:{ fg: P.d_fgDim },
  heatmapLow:  { fg: '#2ea043' },
  heatmapMid:  { fg: '#26a641' },
  heatmapHigh: { fg: '#39d353', bold: true },
  traffic:     { fg: P.d_teal },
  milestone:   { fg: P.d_yellow },
  label:       { fg: P.d_purple },
});

// ── Light — GitHub light, daylight-optimised ──────────────────────
const LIGHT = makeTheme({
  title:       { fg: P.lt_fg,     bold: true },
  heading:     { fg: P.lt_teal,   bold: true },
  dim:         { fg: P.lt_fgDim },
  accent:      { fg: P.lt_teal },
  star:        { fg: P.lt_orange },
  fork:        { fg: P.lt_teal },
  issue:       { fg: P.lt_orange },
  pr:          { fg: P.lt_blue },
  release:     { fg: P.lt_green },
  success:     { fg: P.lt_green },
  warning:     { fg: P.lt_orange },
  error:       { fg: P.lt_red },
  info:        { fg: P.lt_blue },
  selection:   { bg: P.lt_sel,    fg: '#ffffff', bold: true },
  selectionDim:{ bg: P.lt_border, fg: P.lt_fg },
  header:      { fg: P.lt_fg,     bold: true, underline: true },
  statusBar:   { bg: P.lt_bg2,    fg: P.lt_fgDim },
  chrome:      { bg: P.lt_bg2,    fg: P.lt_fg },
  chromeAccent:{ bg: P.lt_bg2,    fg: P.lt_teal, bold: true },
  tabInactive: { fg: P.lt_fgDim },
  tabActive:   { bg: P.lt_sel,    fg: '#ffffff', bold: true },
  tabActiveBg: { bg: P.lt_sel,    fg: '#ffffff', bold: true },
  tabBadge:    { bg: P.lt_orange, fg: '#ffffff', bold: true },
  chipActive:  { bg: P.lt_sel,    fg: '#ffffff', bold: true },
  chipInactive:{ fg: P.lt_fgDim },
  chipDismissible: { bg: P.lt_bg2, fg: P.lt_teal },
  modalBackdrop:   { bg: P.lt_border },
  modalBorder:     { fg: P.lt_teal, bold: true },
  languageBar: { fg: P.lt_blue },
  activity:    { fg: P.lt_green },
  trending:    { fg: P.lt_purple },
  unread:      { fg: P.lt_orange, bold: true },
  muted:       { fg: P.lt_fgDim },
  tabBar:      { fg: P.lt_fgDim },
  tabBarActive:{ fg: P.lt_teal,   bold: true, underline: true },
  inputBox:    { bg: '#f0f3f6',   fg: P.lt_teal, underline: true },
  inputPrompt: { fg: P.lt_teal,   bold: true },
  cardLabel:   { fg: P.lt_fgDim },
  cardValue:   { fg: P.lt_fg,     bold: true },
  breadcrumb:  { fg: P.lt_fgDim },
  breadcrumbSep:{ fg: P.lt_border },
  breadcrumbActive: { fg: P.lt_teal, bold: true },
  welcomeTitle:{ fg: P.lt_teal,   bold: true },
  welcomeAccent:{ fg: P.lt_orange },
  keyHint:     { fg: P.lt_teal,   bold: true },
  keyHintBracket:{ fg: P.lt_fgDim },
  rateOk:      { fg: P.lt_green },
  rateWarn:    { fg: P.lt_orange },
  rateCrit:    { fg: P.lt_red },
  toastInfo:   { bg: '#ddf4ff',   fg: P.lt_blue,   bold: true },
  toastSuccess:{ bg: '#dcffe4',   fg: P.lt_green,  bold: true },
  toastError:  { bg: '#ffebe9',   fg: P.lt_red,    bold: true },
  toastWarning:{ bg: '#fff8c5',   fg: P.lt_orange, bold: true },
  sectionHeading: { fg: P.lt_teal, bold: true },
  repoName:    { fg: P.lt_fg },
  repoNameSelected: { fg: P.lt_teal, bold: true },
  statValue:   { fg: P.lt_fg,     bold: true },
  date:        { fg: P.lt_fgDim },
  packageName: { fg: P.lt_blue },
  packageSize: { fg: P.lt_fgDim },
  packageTag:  { fg: P.lt_teal },
  downloadCount:{ fg: P.lt_fgDim },
  pinned:      { fg: P.lt_orange, bold: true },
  bookmarked:  { fg: P.lt_purple },
  cardBorder:  { fg: P.lt_border },
  cardBorderFocused: { fg: P.lt_teal, bold: true },
  listItem:    { fg: P.lt_fg },
  listItemDim: { fg: P.lt_fgDim },
  emptyIcon:   { fg: P.lt_teal },
  emptyTitle:  { fg: P.lt_fg,     bold: true },
  emptyMessage:{ fg: P.lt_fgDim },
  heatmapLow:  { fg: '#d0e9c0' },
  heatmapMid:  { fg: P.lt_green },
  heatmapHigh: { fg: '#1a7f37', bold: true },
  traffic:     { fg: P.lt_blue },
  milestone:   { fg: P.lt_orange },
  label:       { fg: P.lt_purple },
});

// ── Theme registry ────────────────────────────────────────────────
const THEMES = {
  default: DEFAULT,
  light:   LIGHT,
};

let active = 'default';

// ── Accessible-mode flag (U1) ───────────────────────────────────────
// Module-local so theme.mjs keeps its minimal imports (config + fs +
// state only) and stays import-cycle safe. Set once from app.mjs flag
// parsing; consumed by color() here and isAccessible() elsewhere.
let _accessible = false;
export function setAccessible(v) { _accessible = !!v; }
export function isAccessible() { return _accessible; }
// NO_COLOR is imported from config.mjs — single source of truth

export function listThemes() { return Object.keys(THEMES); }
export function getThemeName() { return active; }

export function setTheme(name) {
  if (!THEMES[name]) return false;
  active = name;
  appState.themeName = name;
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
  if (NO_COLOR) return null;
  if (_accessible) return null;
  const style = THEMES[active][role];
  if (!style) return null;
  // Return a shallow copy to prevent accidental mutation of theme objects
  return { ...style };
}
