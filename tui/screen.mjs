const ESC = '\x1b';
const RESET = `${ESC}[0m`;

const FG = {
  red: `${ESC}[31m`, green: `${ESC}[32m`, yellow: `${ESC}[33m`,
  blue: `${ESC}[34m`, magenta: `${ESC}[35m`, cyan: `${ESC}[36m`,
  white: `${ESC}[37m`, gray: `${ESC}[90m`,
  darkGray: `${ESC}[90m`, // alias used by some themes
};

const BG = {
  red: `${ESC}[41m`, green: `${ESC}[42m`, yellow: `${ESC}[43m`,
  blue: `${ESC}[44m`, magenta: `${ESC}[45m`, cyan: `${ESC}[46m`,
  white: `${ESC}[47m`, gray: `${ESC}[100m`,
  darkGray: `${ESC}[100m`,
};

const ATTR = {
  bold: `${ESC}[1m`, dim: `${ESC}[2m`, italic: `${ESC}[3m`,
  underline: `${ESC}[4m`, inverse: `${ESC}[7m`, strikethrough: `${ESC}[9m`,
};

// Box-drawing characters — fallback to ASCII on Windows.
const IS_WINDOWS = process.platform === 'win32';
const BOX = IS_WINDOWS
  ? { tl: '+', tr: '+', h: '-', v: '|', bl: '+', br: '+' }
  : { tl: '┌', tr: '┐', h: '─', v: '│', bl: '└', br: '┘' };

// Resolve a style value to a compiled escape sequence.
// Accepts: null, or { fg?, bg?, bold?, dim?, italic?, underline?, inverse?, strikethrough? }.
function compileStyle(s) {
  if (!s) return null;
  const parts = [];
  if (s.bold)      parts.push(ATTR.bold);
  if (s.dim)       parts.push(ATTR.dim);
  if (s.italic)    parts.push(ATTR.italic);
  if (s.underline) parts.push(ATTR.underline);
  if (s.inverse)   parts.push(ATTR.inverse);
  if (s.strikethrough) parts.push(ATTR.strikethrough);
  if (s.fg)        parts.push(FG[s.fg] || '');
  if (s.bg)        parts.push(BG[s.bg] || '');
  return parts.length > 0 ? parts.join('') : null;
}

// Unicode safe cell width — we treat most glyphs as width 1 to keep
// box-drawing predictable across terminals.
function strWidth(s) {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // Skip ANSI escapes that leaked in (defensive — shouldn't happen).
    if (c === 0x1b) {
      i++;
      while (i < s.length && !(s.charCodeAt(i) >= 0x40 && s.charCodeAt(i) <= 0x7e)) i++;
      continue;
    }
    w++;
  }
  return w;
}

export class Screen {
  constructor() {
    this.width = 80;
    this.height = 24;
    this.charBuf = [];
    this.styleBuf = [];
    this.prevChar = [];
    this.prevStyle = [];
    this._init();
  }

  _init() {
    this.charBuf = [];
    this.styleBuf = [];
    for (let y = 0; y < this.height; y++) {
      this.charBuf.push(new Array(this.width).fill(' '));
      this.styleBuf.push(new Array(this.width).fill(null));
    }
    // Start with prev buffers marked as different so first render draws everything.
    this.prevChar = this.charBuf.map(r => r.map(() => '\x00'));
    this.prevStyle = this.styleBuf.map(r => r.map(() => null));
  }

  updateSize() {
    const w = process.stdout.columns || 80;
    const h = process.stdout.rows || 24;
    if (w !== this.width || h !== this.height) {
      this.width = w;
      this.height = h;
      this._init();
      // Diff-based renderer handles the full redraw — no explicit clear needed.
    }
  }

  clear() {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.charBuf[y][x] = ' ';
        this.styleBuf[y][x] = null;
      }
    }
  }

  writeStr(x, y, str, style = null) {
    if (y < 0 || y >= this.height) return;
    for (let i = 0; i < str.length; i++) {
      const cx = x + i;
      if (cx < 0 || cx >= this.width) break;
      this.charBuf[y][cx] = str[i];
      this.styleBuf[y][cx] = style;
    }
  }

  // Write a string without touching existing styles at each cell.
  // Useful for drawing characters over a previously-filled background.
  writeStrNoStyle(x, y, str) {
    if (y < 0 || y >= this.height) return;
    for (let i = 0; i < str.length; i++) {
      const cx = x + i;
      if (cx < 0 || cx >= this.width) break;
      this.charBuf[y][cx] = str[i];
    }
  }

  setCell(x, y, ch, style = null) {
    if (y < 0 || y >= this.height || x < 0 || x >= this.width) return;
    this.charBuf[y][x] = ch;
    this.styleBuf[y][x] = style;
  }

  fillRow(y, ch, style = null) {
    if (y < 0 || y >= this.height) return;
    for (let x = 0; x < this.width; x++) {
      this.charBuf[y][x] = ch;
      this.styleBuf[y][x] = style;
    }
  }

  // Fill a rectangle with a character and style.
  fillRect(x, y, w, h, ch, style = null) {
    for (let yy = y; yy < y + h; yy++) {
      if (yy < 0 || yy >= this.height) continue;
      for (let xx = x; xx < x + w; xx++) {
        if (xx < 0 || xx >= this.width) continue;
        this.charBuf[yy][xx] = ch;
        this.styleBuf[yy][xx] = style;
      }
    }
  }

  hline(y, ch = '─', style = null) {
    this.fillRow(y, ch, style);
  }

  // Draw a rounded box with border. Falls back to ASCII on Windows.
  box(x, y, w, h, title = '', style = { bold: true }) {
    if (h < 2 || w < 4 || y < 0 || y >= this.height) return;

    if (title) {
      const pad = Math.max(0, Math.floor((w - title.length - 4) / 2));
      const rightPad = Math.max(0, w - 2 - pad - title.length - 2);
      const top = BOX.tl + BOX.h.repeat(pad) + ' ' + title + ' ' + BOX.h.repeat(rightPad) + BOX.tr;
      this.writeStr(x, y, top.substring(0, w), style);
    } else {
      this.writeStr(x, y, BOX.tl + BOX.h.repeat(w - 2) + BOX.tr, style);
    }

    for (let i = 1; i < h - 1; i++) {
      if (y + i >= this.height) break;
      this.setCell(x, y + i, BOX.v, style);
      this.setCell(x + w - 1, y + i, BOX.v, style);
    }
    if (y + h - 1 < this.height) {
      this.writeStr(x, y + h - 1, BOX.bl + BOX.h.repeat(w - 2) + BOX.br, style);
    }
  }

  // Filled card with optional title — used for stat cards.
  // Background fills the box, title centered on the top.
  card(x, y, w, h, title = '', fillStyle = null, borderStyle = null) {
    if (h < 2 || w < 4 || y < 0 || y >= this.height) return;
    // Background fill
    if (fillStyle) {
      this.fillRect(x + 1, y + 1, w - 2, h - 2, ' ', fillStyle);
    }
    const bs = borderStyle || { dim: true };
    this.writeStr(x, y, BOX.tl + BOX.h.repeat(w - 2) + BOX.tr, bs);
    for (let i = 1; i < h - 1; i++) {
      if (y + i >= this.height) break;
      this.setCell(x, y + i, BOX.v, bs);
      this.setCell(x + w - 1, y + i, BOX.v, bs);
    }
    if (y + h - 1 < this.height) {
      this.writeStr(x, y + h - 1, BOX.bl + BOX.h.repeat(w - 2) + BOX.br, bs);
    }
    if (title) {
      const t = ' ' + title + ' ';
      const tx = x + Math.floor((w - t.length) / 2);
      this.writeStr(tx, y, t, { fg: 'gray', dim: true });
    }
  }

  // Render a chip with optional dismiss-X. Returns end-x after chip.
  // e.g. " Python ✕ " or "[Python]"
  chip(x, y, text, opts = {}) {
    const { active = false, dismissible = false, style = null, dim = false } = opts;
    const s = active ? style : (dim ? { dim: true } : { dim: true });
    const label = text;
    const dismiss = dismissible ? ' ✕' : '';
    const txt = ' ' + label + dismiss + ' ';
    this.writeStr(x, y, txt, s);
    return x + txt.length;
  }

  // Render a key hint in the canonical [key] style.
  keyHint(x, y, key, label) {
    // Caller passes through color('keyHint') / color('dim').
    this.writeStr(x, y, '[' + key + ']', { fg: 'cyan', bold: true });
    if (label) this.writeStr(x + key.length + 2, y, ' ' + label, { dim: true });
  }

  // Render a horizontal sparkline / progress bar across a fixed width.
  // ratio is 0..1. style for filled, dimStyle for empty.
  bar(x, y, width, ratio, fillStyle = null, emptyStyle = { dim: true }) {
    const filled = Math.max(0, Math.min(width, Math.round(width * ratio)));
    if (filled > 0) this.writeStr(x, y, '█'.repeat(filled), fillStyle);
    if (filled < width) this.writeStr(x + filled, y, '░'.repeat(width - filled), emptyStyle);
  }

  // Render a "breadcrumb" path string: "a › b › c" with the last segment highlighted.
  // Returns the next x.
  breadcrumb(x, y, segments, maxWidth) {
    if (!segments || segments.length === 0) return x;
    const sep = ' › ';
    const last = segments.length - 1;
    // Build the string with width limits, truncating middle segments if needed.
    let totalLen = segments.reduce((a, s) => a + strWidth(s), 0) + sep.length * (segments.length - 1);
    let segs = segments.slice();
    if (totalLen > maxWidth) {
      // Truncate each non-first/non-last segment to fit.
      const fixed = segs[0].length + sep.length + segs[last].length + 2 * sep.length + 2; // … marker
      const remaining = maxWidth - fixed;
      if (remaining < 0) {
        // Path too long — just show last segment.
        segs = [segs[last]];
      } else {
        // Truncate middle segments evenly.
        const midCount = segs.length - 2;
        const per = Math.max(1, Math.floor(remaining / midCount));
        for (let i = 1; i < last; i++) {
          if (segs[i].length > per) segs[i] = segs[i].slice(0, Math.max(1, per - 1)) + '…';
        }
      }
    }
    let cx = x;
    for (let i = 0; i < segs.length; i++) {
      const isLast = i === segs.length - 1;
      if (i > 0) {
        this.writeStr(cx, y, sep, { dim: true });
        cx += sep.length;
      }
      this.writeStr(cx, y, segs[i],
        isLast ? { fg: 'cyan', bold: true } : { dim: true });
      cx += segs[i].length;
    }
    return cx;
  }

  // Render a "badge" with rounded edges — a small label with bg color.
  badge(x, y, text, style = null) {
    const t = ' ' + text + ' ';
    this.writeStr(x, y, t, style);
    return x + t.length;
  }

  // Build a style escape sequence, or return null when colors are disabled.
  compileStyleSafe(s) {
    const compiled = compileStyle(s);
    return FORCE_COLOR === false ? null : compiled;
  }

  render() {
    const out = [];
    let curCompiled = null;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const ch = this.charBuf[y][x];
        const st = this.styleBuf[y][x];
        const pCh = this.prevChar[y] ? this.prevChar[y][x] : undefined;
        const pSt = this.prevStyle[y] ? this.prevStyle[y][x] : undefined;

        if (ch === pCh && st === pSt) continue;

        out.push(`${ESC}[${y + 1};${x + 1}H`);

        const compiled = FORCE_COLOR === false ? null : compileStyle(st);
        if (compiled !== curCompiled) {
          if (curCompiled) out.push(RESET);
          if (compiled) out.push(compiled);
          curCompiled = compiled;
        }

        out.push(ch);
      }
    }

    if (curCompiled) out.push(RESET);

    if (out.length > 0) {
      process.stdout.write(out.join(''));
    }

    // Swap buffers instead of copying — zero allocation after warm-up.
    const tmpChar = this.prevChar;
    const tmpStyle = this.prevStyle;
    this.prevChar = this.charBuf;
    this.prevStyle = this.styleBuf;
    this.charBuf = tmpChar;
    this.styleBuf = tmpStyle;
    // Clear the new buffer (was prev buffer).
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.charBuf[y][x] = ' ';
        this.styleBuf[y][x] = null;
      }
    }
  }
}

// Terminal capability detection.
const TERM = process.env.TERM || '';
const COLORTERM = process.env.COLORTERM || '';
const FORCE_COLOR = (() => {
  if (process.env.FORCE_COLOR === '0' || process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return undefined; // auto-detect
})();

export const TERM_CAPABILITIES = {
  supports256: TERM.includes('256color') || COLORTERM === 'truecolor',
  supportsTrueColor: COLORTERM === 'truecolor' || COLORTERM === '24bit',
  isTmux: !!process.env.TMUX,
  isSSH: !!(process.env.SSH_CLIENT || process.env.SSH_TTY),
  isScreen: !!process.env.STY,
  isWSL: !!process.env.WSLENV,
};
