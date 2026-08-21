// Onboarding / "What's new" overlay — first-time welcome + version tour.
// the STEPS array is now dynamic. Step 1 offers GitHub CLI login
// first when `gh` is detected and falls back to PAT paste otherwise. Step 4
// pulls bullets from CHANGELOG.md so the "what's new" message stops going
// stale on every release.

import { appState, render, showMessage, setTab, compareVersions } from '../state.mjs';
// Re-export compareVersions so callers (notably the app.mjs version-gate
// and tests/onboarding.test.mjs) can import it from this module — the
// onboarding flow is the canonical consumer of "is the user's APP_VERSION
// newer than what they last saw?".
export { compareVersions };
import { color } from '../theme.mjs';
import { truncateToWidth } from '../utils.mjs';
import { APP_VERSION, CONFIG_DIR, TOKEN_FILE } from '../config.mjs';
import { listThemes } from '../theme.mjs';
import { startInput } from '../input.mjs';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { submitLogin } from './settings.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CHANGELOG_PATH = join(__dirname, '..', '..', 'CHANGELOG.md');
const WELCOME_SEEN_FILE = join(CONFIG_DIR, '.welcome-seen');

// ── Pure helpers (exported for tests) ──

// Parse a CHANGELOG.md (keep-a-changelog style) into sections.
// Each section: { version, date, bullets: string[] }.
// Lines starting with `### ` are captured as a subheader (first one only).
export function parseReleaseNotes(text) {
  if (!text || typeof text !== 'string') return [];
  const sections = [];
  let cur = null;
  for (const ln of text.split('\n')) {
    const m = /^##\s*\[([^\]]+)\]\s*-?\s*(.*)$/.exec(ln);
    if (m) {
      if (cur) sections.push(cur);
      cur = { version: m[1].trim(), date: m[2].trim(), bullets: [] };
    } else if (cur && /^\s*-\s+/.test(ln)) {
      cur.bullets.push(ln.replace(/^\s*-\s+/, '').trim());
    } else if (cur && /^\s*###\s+/.test(ln) && !cur.subheader) {
      cur.subheader = ln.replace(/^\s*###\s+/, '').trim();
    }
  }
  if (cur) sections.push(cur);
  return sections;
}

// Cached changelog content (loaded lazily on first read).
let _changelogCache = null;
function readChangelogSync() {
  if (_changelogCache !== null) return _changelogCache;
  try {
    _changelogCache = readFileSync(CHANGELOG_PATH, 'utf8');
  } catch {
    _changelogCache = '';
  }
  return _changelogCache;
}

// Build the "What's new in vX" body — picks the section matching
// `currentVersion` if present, otherwise falls back to the first (newest)
// section. Caps to 7 bullets so the box doesn't overflow on tiny terminals.
export function buildWhatsNewBody(changelogText, currentVersion) {
  const sections = parseReleaseNotes(changelogText);
  let target = sections.find(s => s.version === currentVersion);
  if (!target) target = sections[0];
  const header = target
    ? ['  Current version: v' + currentVersion, '']
    : ['  Current version: v' + currentVersion];
  if (!target) return [...header, '', '  No release notes bundled.'];
  const bullets = target.bullets.slice(0, 7).map(b => '  • ' + b);
  let body = [...header, ...bullets];
  if (target.bullets.length > 7) body.push('  …and more in CHANGELOG.md');
  return body;
}

// ── Steps cache (rebuilds when invalidated) ──
let _cachedSteps = null;
let _stepsDirty = true;
export function invalidateOnboarding() { _stepsDirty = true; }

// Async helper: probe gh CLI, set appState._ghAvailable, invalidate steps.
export async function probeGhAndInvalidate() {
  try {
    const settings = await import('./settings.mjs');
    const ok = await settings.isGhInstalled();
    appState._ghAvailable = ok === true;
  } catch {
    appState._ghAvailable = false;
  }
  _stepsDirty = true;
  render();
}

function buildLoginStep() {
  const ghAvail = appState._ghAvailable;
  let body, hint, onEnter;
  if (ghAvail === true) {
    body = [
      'Press [Enter] to log in via the GitHub CLI — no token needed.',
      '',
      '  Requires: `gh auth login` was run in your shell.',
      '  Works for private repos too (auth handled by gh).'
    ];
    hint = 'Press [Enter] to log in  ·  [Esc] to skip';
    onEnter = () => import('./settings.mjs').then(m => m.loginWithGh());
  } else if (ghAvail === false) {
    body = [
      'GitHub CLI was not detected on this machine.',
      '',
      '  Option A — install gh (https://cli.github.com), then `gh auth login`,',
      '            then restart this app.',
      '',
      '  Option B — paste a Personal Access Token below.',
      '            GitHub → Settings → Developer settings →',
      '            Personal access tokens → Tokens (classic).',
      '            Required scopes: repo, read:user, notifications.'
    ];
    hint = 'Press [Enter] to paste a PAT  ·  [Esc] to skip';
    onEnter = () => startInput('Paste your GitHub PAT: ', 'login', true);
  } else {
    body = [
      'Detecting GitHub CLI…',
      '',
      '  If `gh` is installed and authenticated, you can use it here without',
      '  setting up a Personal Access Token. Press [Enter] to check.',
    ];
    hint = 'Press [Enter] to detect  ·  [Esc] to skip';
    // CRITICAL: returning `false` here prevents the step counter from
    // advancing so the user stays on this step until the async probe
    // completes and `_stepsDirty` triggers a rebuild of STEPS. Without
    // this, pressing Enter on "Detecting…" would race the probe and could
    // show an empty Step 2 (or skip past login entirely).
    onEnter = () => { probeGhAndInvalidate(); return false; };
  }
  return { icon: '★', title: 'Sign in', body, hint, onEnter };
}

function buildSteps() {
  return [
    {
      icon: '●',
      title: 'Welcome to GitHub TUI',
      body: [
        'A zero-dependency terminal client for GitHub — read, triage, and act',
        'on your repos without leaving the keyboard.',
        '',
        'Current version: v' + APP_VERSION,
        '',
        'Created by @unn-Known1 (https://github.com/unn-Known1)'
      ],
      hint: 'Press [Enter] to continue  ·  [Esc] to skip',
    },
    buildLoginStep(),
    {
      icon: '■',
      title: 'The keyboard is your friend',
      body: [
        'Six numbered tabs at the top:',
        '  [1] Dashboard · greeting, activity, stats, trending',
        '  [2] Repos     · your repos with filters, sort, pins',
        '  [3] Explore   · search any public repo, view details',
        '  [4] Actions   · CI / workflow runs',
        '  [5] Inbox     · triage notifications',
        '  [6] Settings  · theme, login, system info',
        '',
        'Power keys (work everywhere):',
        '  [Ctrl-P]  open the command palette',
        '  [Ctrl-S]  save the current Explore search (Explore tab only)',
        '  [Ctrl-K]  edit ~/.github-tui/keybindings.json for custom bindings',
        '  [?]       show this help',
        '  [q]       quit',
        '  [r]       retry the last failed operation (when toast shows [r])',
      ],
      hint: 'Press [Enter] for tips  ·  [Esc] to finish',
    },
    {
      icon: '◆',
      title: 'New in v' + APP_VERSION,
      body: buildWhatsNewBody(readChangelogSync(), APP_VERSION),
      hint: 'Press [Enter] to choose theme  ·  [Esc] to finish',
    },
    {
      icon: '◆',
      title: 'Pick a theme',
      body: 'GitHub TUI ships with several themes. Try one that matches your terminal:',
      showThemes: true,
      hint: 'Press [Enter] to start using GitHub TUI',
      onEnter: () => {
        appState.dismissedOnboarding = true;
        markVersionSeen();
        appState.showOnboarding = false;
        setTab(0);
        showMessage('✓ You\'re all set. Have fun!', 'success');
        render();
      },
    },
  ];
}

export function getSteps() {
  if (_stepsDirty || !_cachedSteps) {
    _cachedSteps = buildSteps();
    _stepsDirty = false;
  }
  return _cachedSteps;
}

// Mark the current APP_VERSION as "seen" by the user. Updates appState
// AND writes the legacy WELCOME_SEEN_FILE so existing first-run detection
// still works. saveSession() picks up appState.lastSeenVersion on the
// next navigation and persists it to session.json.
export function markVersionSeen() {
  appState.lastSeenVersion = APP_VERSION;
  markWelcomeSeen();
}

export function startOnboarding() {
  stepIdx = 0;
  appState.showOnboarding = true;
  appState.dismissedOnboarding = false;
  _stepsDirty = true;
  render();
}

export function startWelcome() {
  // The welcome shortcut is specifically the release-notes view, not the
  // first-run wizard's generic greeting/login steps.
  stepIdx = 3;
  appState.showOnboarding = false;
  appState.showWelcome = true;
  _stepsDirty = true;
  render();
}

export function isFirstRun() {
  if (!appState.token && !existsSync(WELCOME_SEEN_FILE)) return true;
  return false;
}

export function markWelcomeSeen() {
  try {
    const dir = dirname(WELCOME_SEEN_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(WELCOME_SEEN_FILE, '1');
  } catch {}
}

// Should the "what's new" overlay auto-launch on this boot?
// True when the user has previously dismissed onboarding (lastSeenVersion
// is set) AND APP_VERSION is strictly newer.
export function shouldAutoLaunchWelcome() {
  if (!appState.lastSeenVersion) return false;
  return compareVersions(APP_VERSION, appState.lastSeenVersion) > 0;
}

let stepIdx = 0;

export function handleOnboardingKey(key) {
  if (!appState.showOnboarding && !appState.showWelcome) return false;
  const STEPS = getSteps();
  if (key === '\x1b' || key === 'q') {
    if (appState.showOnboarding) appState.showOnboarding = false;
    if (appState.showWelcome) appState.showWelcome = false;
    markVersionSeen();
    render();
    return true;
  }
  if (key === '\r' || key === '\n' || key === ' ') {
    // Standalone What's New displays only the current release notes. Do not
    // fall through into the first-run theme step when the user accepts it.
    if (appState.showWelcome) {
      appState.showWelcome = false;
      markVersionSeen();
      render();
      return true;
    }
    const step = STEPS[stepIdx];
    if (step && step.onEnter) {
      const r = step.onEnter();
      if (r !== false) stepIdx++;
    } else {
      stepIdx++;
    }
    if (stepIdx >= STEPS.length) {
      appState.showOnboarding = false;
      appState.showWelcome = false;
      markVersionSeen();
    }
    render();
    return true;
  }
  if (key === '\x1b[D' || key === 'h') {
    stepIdx = Math.max(0, stepIdx - 1);
    render();
    return true;
  }
  if (key === '\x1b[C' || key === 'l') {
    stepIdx = Math.min(STEPS.length - 1, stepIdx + 1);
    render();
    return true;
  }
  return true;
}

export function renderOnboarding(screen, opts = {}) {
  const W = screen.width;
  const H = screen.height;
  const welcomeMode = opts.welcomeMode || appState.showWelcome;

  // Dim backdrop.
  const backdropStyle = color('modalBackdrop');
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) screen.styleBuf[yy][xx] = backdropStyle;
  }

  const STEPS = getSteps();
  const step = STEPS[Math.min(stepIdx, STEPS.length - 1)];

  const boxW = Math.min(78, W - 4);
  const boxH = Math.min(22, H - 4);
  const x0 = Math.floor((W - boxW) / 2);
  const y0 = Math.floor((H - boxH) / 2);

  for (let yy = y0; yy < y0 + boxH; yy++) {
    for (let xx = x0; xx < x0 + boxW; xx++) screen.setCell(xx, yy, ' ', null);
  }
  screen.box(x0, y0, boxW, boxH,
    welcomeMode ? "What's new in v" + APP_VERSION : 'Welcome',
    { fg: 'cyan', bold: true });

  if (!welcomeMode) {
    const stepText = 'Step ' + (stepIdx + 1) + ' / ' + STEPS.length;
    screen.writeStr(x0 + boxW - stepText.length - 3, y0 + 1, stepText, { dim: true });
  }

  const iconY = y0 + 2;
  const iconText = step.icon;
  screen.writeStr(x0 + 3, iconY, iconText, { fg: 'cyan', bold: true });
  screen.writeStr(x0 + 7, iconY, step.title, color('title') || { fg: 'white', bold: true });

  // Body.
  const body = Array.isArray(step.body) ? step.body : step.body.split('\n');
  let bodyY = y0 + 4;
  const innerW = boxW - 6;
  for (const ln of body) {
    if (bodyY >= y0 + boxH - 4) break;
    let style = null;
    if (/^\s*\d+\./.test(ln)) style = { fg: 'yellow' };
    else if (/^\s*\[/.test(ln)) style = { fg: 'cyan', bold: true };
    else if (/^\s*•/.test(ln)) style = color('repoName') || { fg: 'white' };
    else if (/^\s*$/.test(ln)) { bodyY++; continue; }
    else style = null;
    screen.writeStr(x0 + 3, bodyY, truncateToWidth(ln, innerW, ''), style);
    bodyY++;
  }

  if (step.showThemes) {
    const themes = listThemes();
    bodyY++;
    const curTheme = appState.themeName;
    let cx = x0 + 3;
    for (const t of themes) {
      const text = ' ' + t + ' ';
      if (cx + text.length + 1 > x0 + boxW - 2) break;
      const style = t === curTheme
        ? { bg: 'cyan', fg: 'darkGray', bold: true }
        : { dim: true };
      screen.writeStr(cx, bodyY, text, style);
      cx += text.length + 1;
    }
    bodyY++;
    screen.writeStr(x0 + 3, bodyY, 'Change theme later with [6] Settings → Appearance.', { dim: true });
  }

  const hintY = y0 + boxH - 3;
  const hint = step.hint || '[Enter] Next   [Esc] Skip';
  screen.writeStr(x0 + 3, hintY, truncateToWidth(hint, boxW - 6, ''), { fg: 'cyan' });

  if (!welcomeMode) {
    let dx = x0 + 3;
    const dotY = y0 + boxH - 2;
    for (let i = 0; i < STEPS.length; i++) {
      const isCur = i === stepIdx;
      const isDone = i < stepIdx;
      const ch = isCur ? '●' : (isDone ? '○' : '·');
      const style = isCur ? { fg: 'cyan', bold: true } : (isDone ? { fg: 'green' } : { dim: true });
      screen.writeStr(dx, dotY, ch, style);
      dx += 2;
    }
  }
}
