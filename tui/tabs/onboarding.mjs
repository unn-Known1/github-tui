// Onboarding / "What's new" overlay — first-time welcome + version tour.
// Triggered when there's no saved token, or manually from Settings/Help.

import { appState, render, showMessage, setTab, confirm } from '../state.mjs';
import { color } from '../theme.mjs';
import { APP_VERSION, CONFIG_DIR, TOKEN_FILE } from '../config.mjs';
import { listThemes } from '../theme.mjs';
import { startInput } from '../input.mjs';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { submitLogin } from './settings.mjs';

const WELCOME_SEEN_FILE = join(CONFIG_DIR, '.welcome-seen');

// Steps for the first-time wizard. Each step is rendered in turn.
const STEPS = [
  {
    icon: '👋',
    title: 'Welcome to GitHub TUI',
    body: 'A zero-dependency terminal client for GitHub — read, triage, and act on your repos without leaving the keyboard.',
    hint: 'Press [Enter] to continue  ·  [Esc] to skip',
  },
  {
    icon: '🔑',
    title: 'Sign in with a Personal Access Token',
    body: [
      'You\'ll need a GitHub PAT to access your repos and notifications.',
      '',
      'To create one:',
      '  1. Open GitHub → Settings → Developer settings',
      '  2. Personal access tokens → Tokens (classic) → Generate new',
      '  3. Select scopes: repo, read:user, notifications',
      '  4. Copy the token and paste it in the next step',
    ],
    hint: 'Press [Enter] to set up your token now',
    onEnter: () => startInput('Paste your GitHub PAT: ', 'login', true),
  },
  {
    icon: '⌨',
    title: 'The keyboard is your friend',
    body: [
      'Six tabs at the top:',
      '  [1] Dashboard  · greeting, activity, stats, trending',
      '  [2] Repos     · your repos with filters, sort, pins',
      '  [3] Analyze   · search any public repo, view details',
      '  [4] Actions   · CI / workflow runs',
      '  [5] Inbox     · triage notifications',
      '  [6] Settings  · theme, login, system info',
      '',
      'Power keys (work everywhere):',
      '  [Ctrl-P]  open the command palette',
      '  [?]       show this help',
      '  [q]       quit',
    ],
    hint: 'Press [Enter] for tips  ·  [Esc] to finish',
  },
  {
    icon: '🎨',
    title: 'Pick a theme',
    body: 'GitHub TUI ships with several themes. Try one that matches your terminal:',
    showThemes: true,
    hint: 'Press [Enter] to start using GitHub TUI',
    onEnter: () => {
      appState.dismissedOnboarding = true;
      markWelcomeSeen();
      appState.showOnboarding = false;
      setTab(0);
      showMessage('✓ You\'re all set. Have fun!', 'success');
      render();
    },
  },
];

let stepIdx = 0;

export function startOnboarding() {
  stepIdx = 0;
  appState.showOnboarding = true;
  appState.dismissedOnboarding = false;
  render();
}

export function startWelcome() {
  stepIdx = 0;
  appState.showWelcome = true;
  render();
}

export function isFirstRun() {
  // First run = no token AND no welcome-seen flag.
  if (!appState.token && !existsSync(WELCOME_SEEN_FILE)) return true;
  return false;
}

export function markWelcomeSeen() {
  try {
    writeFileSync(WELCOME_SEEN_FILE, '1');
  } catch {}
}

export function handleOnboardingKey(key) {
  if (!appState.showOnboarding && !appState.showWelcome) return false;
  if (key === '\x1b' || key === 'q') {
    if (appState.showOnboarding) {
      appState.showOnboarding = false;
      markWelcomeSeen();
    }
    if (appState.showWelcome) appState.showWelcome = false;
    render();
    return true;
  }
  if (key === '\r' || key === '\n' || key === ' ') {
    const step = STEPS[stepIdx];
    if (step && step.onEnter) {
      const r = step.onEnter();
      // Move to next step unless handler returned false.
      if (r !== false) stepIdx++;
    } else {
      stepIdx++;
    }
    if (stepIdx >= STEPS.length) {
      appState.showOnboarding = false;
      markWelcomeSeen();
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

  const step = STEPS[Math.min(stepIdx, STEPS.length - 1)];
  const isLast = stepIdx >= STEPS.length - 1;

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

  // Step counter.
  if (!welcomeMode) {
    const stepText = 'Step ' + (stepIdx + 1) + ' / ' + STEPS.length;
    screen.writeStr(x0 + boxW - stepText.length - 3, y0 + 1, stepText, { dim: true });
  }

  // Icon (large).
  const iconY = y0 + 2;
  const iconText = step.icon;
  screen.writeStr(x0 + 3, iconY, iconText, { fg: 'cyan', bold: true });

  // Title.
  screen.writeStr(x0 + 7, iconY, step.title, color('title') || { fg: 'white', bold: true });

  // Body — supports either string or string[] for line-by-line.
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
    screen.writeStr(x0 + 3, bodyY, ln.substring(0, innerW), style);
    bodyY++;
  }

  // Theme picker (optional).
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

  // Hint.
  const hintY = y0 + boxH - 3;
  const hint = step.hint || '[Enter] Next   [Esc] Skip';
  screen.writeStr(x0 + 3, hintY, hint.substring(0, boxW - 6), { fg: 'cyan' });

  // Progress dots.
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
