const ESC = '\x1b';
const RESET = `${ESC}[0m`;

import { NO_COLOR, FORCE_COLOR as _FORCE_COLOR_CFG } from './config.mjs';

// ── Terminal capability detection (done early, used by compileStyle) ──
const TERM = process.env.TERM || '';
const COLORTERM = process.env.COLORTERM || '';
const FORCE_COLOR = (() => {
  if (NO_COLOR) return false;
  if (_FORCE_COLOR_CFG) return true;
  return undefined; // auto-detect
})();

export const TERM_CAPABILITIES = {
  supports256: TERM.includes('256color') || COLORTERM === 'truecolor' || COLORTERM === '24bit',
  supportsTrueColor: COLORTERM === 'truecolor' || COLORTERM === '24bit',
  isTmux: !!process.env.TMUX,
  isSSH: !!(process.env.SSH_CLIENT || process.env.SSH_TTY),
  isScreen: !!process.env.STY,
  isWSL: !!process.env.WSLENV,
};

// ── Named ANSI-8 color maps (fallback) ──────────────────────────────
const FG = {
  black: `${ESC}[30m`,
  red: `${ESC}[31m`, green: `${ESC}[32m`, yellow: `${ESC}[33m`,
  blue: `${ESC}[34m`, magenta: `${ESC}[35m`, cyan: `${ESC}[36m`,
  white: `${ESC}[37m`, gray: `${ESC}[90m`,
  darkGray: `${ESC}[90m`,
  brightRed: `${ESC}[91m`, brightGreen: `${ESC}[92m`, brightYellow: `${ESC}[93m`,
  brightBlue: `${ESC}[94m`, brightMagenta: `${ESC}[95m`, brightCyan: `${ESC}[96m`,
  brightWhite: `${ESC}[97m`,
};

const BG = {
  black: `${ESC}[40m`,
  red: `${ESC}[41m`, green: `${ESC}[42m`, yellow: `${ESC}[43m`,
  blue: `${ESC}[44m`, magenta: `${ESC}[45m`, cyan: `${ESC}[46m`,
  white: `${ESC}[47m`, gray: `${ESC}[100m`,
  darkGray: `${ESC}[100m`,
  brightRed: `${ESC}[101m`, brightGreen: `${ESC}[102m`, brightYellow: `${ESC}[103m`,
  brightBlue: `${ESC}[104m`, brightMagenta: `${ESC}[105m`, brightCyan: `${ESC}[106m`,
  brightWhite: `${ESC}[107m`,
};

const ATTR = {
  bold: `${ESC}[1m`, dim: `${ESC}[2m`, italic: `${ESC}[3m`,
  underline: `${ESC}[4m`, inverse: `${ESC}[7m`, strikethrough: `${ESC}[9m`,
};

// ── Color value resolver ─────────────────────────────────────────────
// Accepts:
//   'cyan'           → named ANSI color
//   '#bd93f9'        → true-color hex (falls back to 256 or named)
//   [r, g, b]        → true-color tuple
//   256:n            → 256-color index string  (e.g. '256:135')

function resolveFg(val) {
  if (!val) return '';
  if (Array.isArray(val)) return rgbFg(...val);
  if (typeof val === 'string') {
    if (val.startsWith('#')) return hexFg(val);
    if (val.startsWith('256:')) return idx256Fg(parseInt(val.slice(4), 10));
    return FG[val] || '';
  }
  return '';
}

function resolveBg(val) {
  if (!val) return '';
  if (Array.isArray(val)) return rgbBg(...val);
  if (typeof val === 'string') {
    if (val.startsWith('#')) return hexBg(val);
    if (val.startsWith('256:')) return idx256Bg(parseInt(val.slice(4), 10));
    return BG[val] || '';
  }
  return '';
}

// True-color (24-bit) sequences
function rgbFg(r, g, b) { return TERM_CAPABILITIES.supportsTrueColor ? `${ESC}[38;2;${r};${g};${b}m` : idx256Fg(rgb2idx(r, g, b)); }
function rgbBg(r, g, b) { return TERM_CAPABILITIES.supportsTrueColor ? `${ESC}[48;2;${r};${g};${b}m` : idx256Bg(rgb2idx(r, g, b)); }

// Hex shorthand
function hexFg(hex) { const [r, g, b] = hexParse(hex); return rgbFg(r, g, b); }
function hexBg(hex) { const [r, g, b] = hexParse(hex); return rgbBg(r, g, b); }

// 256-color index sequences with fallback to 16-color ANSI
function idx256Fg(n) {
  if (TERM_CAPABILITIES.supports256) return `${ESC}[38;5;${n}m`;
  // Fallback: map 256-color index to nearest 16-color ANSI
  const ansi = idx256ToAnsi16(n);
  if (ansi === null) return '';
  // Bright colors (8-15) use 90-97 for foreground
  return ansi >= 8 ? `${ESC}[9${ansi - 8}m` : `${ESC}[3${ansi}m`;
}
function idx256Bg(n) {
  if (TERM_CAPABILITIES.supports256) return `${ESC}[48;5;${n}m`;
  const ansi = idx256ToAnsi16(n);
  if (ansi === null) return '';
  // Bright colors (8-15) use 100-107 for background
  return ansi >= 8 ? `${ESC}[10${ansi - 8}m` : `${ESC}[4${ansi}m`;
}

// Map a 256-color index to the nearest 16-color ANSI index (0-15).
function idx256ToAnsi16(n) {
  // Standard 16-color palette as RGB (approximate)
  const palette16 = [
    [0,0,0],[128,0,0],[0,128,0],[128,128,0],[0,0,128],[128,0,128],[0,128,128],[192,192,192],
    [128,128,128],[255,0,0],[0,255,0],[255,255,0],[0,0,255],[255,0,255],[0,255,255],[255,255,255],
  ];
  // Convert 256-color index to RGB
  let r, g, b;
  if (n < 16) return n; // already in 16-color range
  if (n >= 232) {
    // Grayscale ramp (232-255)
    const gray = 8 + (n - 232) * 10;
    r = g = b = gray;
  } else {
    // 6x6x6 cube (16-231)
    n -= 16;
    r = Math.floor(n / 36) * 51;
    g = Math.floor((n % 36) / 6) * 51;
    b = (n % 6) * 51;
  }
  // Find nearest in 16-color palette
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < 16; i++) {
    const dr = r - palette16[i][0];
    const dg = g - palette16[i][1];
    const db = b - palette16[i][2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) { bestDist = dist; best = i; }
  }
  return best;
}

function hexParse(hex) {
  const h = hex.replace('#', '');
  // Validate hex string and provide safe defaults for malformed input
  const parseHex = (s) => {
    const n = parseInt(s, 16);
    return isNaN(n) ? 0 : Math.max(0, Math.min(255, n));
  };
  return [parseHex(h.slice(0, 2)), parseHex(h.slice(2, 4)), parseHex(h.slice(4, 6))];
}

// Convert RGB to nearest xterm-256 color index (6x6x6 cube + grays)
function rgb2idx(r, g, b) {
  // Grayscale ramp: indices 232-255
  if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10) {
    const gray = Math.round((r + g + b) / 3);
    if (gray < 8) return 16;
    if (gray > 248) return 231;
    return Math.round((gray - 8) / 247 * 24) + 232;
  }
  // 6x6x6 cube: indices 16-231
  const ri = Math.round(r / 255 * 5);
  const gi = Math.round(g / 255 * 5);
  const bi = Math.round(b / 255 * 5);
  return 16 + 36 * ri + 6 * gi + bi;
}

// ── Box-drawing characters — fallback to ASCII on Windows ────────────
const IS_WINDOWS = process.platform === 'win32';
const BOX = IS_WINDOWS
  ? { tl: '+', tr: '+', h: '-', v: '|', bl: '+', br: '+' }
  : { tl: '┌', tr: '┐', h: '─', v: '│', bl: '└', br: '┘' };

// ── Style compiler ───────────────────────────────────────────────────
// Accepts: null, or { fg?, bg?, bold?, dim?, italic?, underline?, inverse?, strikethrough? }
// fg/bg accept: named string, '#rrggbb', [r,g,b], '256:n'
function compileStyle(s) {
  if (!s) return null;
  if (FORCE_COLOR === false) return null;
  const parts = [];
  if (s.bold)      parts.push(ATTR.bold);
  if (s.dim)       parts.push(ATTR.dim);
  if (s.italic)    parts.push(ATTR.italic);
  if (s.underline) parts.push(ATTR.underline);
  if (s.inverse)   parts.push(ATTR.inverse);
  if (s.strikethrough) parts.push(ATTR.strikethrough);
  if (s.fg)        { const r = resolveFg(s.fg); if (r) parts.push(r); }
  if (s.bg)        { const r = resolveBg(s.bg); if (r) parts.push(r); }
  return parts.length > 0 ? parts.join('') : null;
}

// Unicode safe cell width — handles CJK wide characters and ESC sequences.
// CJK Compatibility Ideographs, Hiragana, Katakana, Hangul, etc. occupy 2 cells.
function isWideCodePoint(cp) {
  return (cp >= 0x1100 && cp <= 0x115F) || // Hangul Jamo
    cp === 0x2329 || cp === 0x232A ||
    (cp >= 0x2E80 && cp <= 0x303E) || // CJK Radicals, Kangxi, Ideographic
    (cp >= 0x3040 && cp <= 0x33BF) || // Hiragana, Katakana, Bopomofo, Hangul
    (cp >= 0x3400 && cp <= 0x4DBF) || // CJK Unified Ideographs Extension A
    (cp >= 0x4E00 && cp <= 0xA4CF) || // CJK Unified, Yi
    (cp >= 0xAC00 && cp <= 0xD7A3) || // Hangul Syllables
    (cp >= 0xF900 && cp <= 0xFAFF) || // CJK Compatibility Ideographs
    (cp >= 0xFE30 && cp <= 0xFE6F) || // CJK Compatibility Forms
    (cp >= 0xFF01 && cp <= 0xFF60) || // Fullwidth Forms
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||
    (cp >= 0x20000 && cp <= 0x2FFFD) || // CJK Unified Extension B-F
    (cp >= 0x30000 && cp <= 0x3FFFD);
}

function strWidth(s) {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // Handle ESC sequences
    if (c === 0x1b) {
      i++;
      if (i < s.length) {
        const next = s.charCodeAt(i);
        if (next === 0x5B) {
          // CSI sequence: ESC [ ... final_byte
          while (i < s.length && s.charCodeAt(i) >= 0x20 && s.charCodeAt(i) <= 0x3F) i++;
          if (i < s.length && s.charCodeAt(i) >= 0x40 && s.charCodeAt(i) <= 0x7E) i++;
        } else if (next === 0x5D) {
          // OSC sequence: ESC ] ... (BEL or ST)
          while (i < s.length) {
            const ch = s.charCodeAt(i);
            if (ch === 0x07 || ch === 0x9C) { i++; break; } // BEL or ST
            if (ch === 0x1b && i + 1 < s.length && s.charCodeAt(i + 1) === 0x5C) { i += 2; break; } // ESC \
            i++;
          }
        } else {
          // Other ESC sequences: skip intermediate + final byte
          while (i < s.length && s.charCodeAt(i) >= 0x20 && s.charCodeAt(i) <= 0x2F) i++;
          if (i < s.length && s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x7E) i++;
        }
      }
      continue;
    }
    // Handle UTF-16 surrogate pairs
    let cp = c;
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
      const low = s.charCodeAt(i + 1);
      if (low >= 0xDC00 && low <= 0xDFFF) {
        cp = 0x10000 + ((c - 0xD800) << 10) + (low - 0xDC00);
        i++;
      }
    }
    w += isWideCodePoint(cp) ? 2 : 1;
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
      // Trigger scroll position recovery (imported lazily to avoid circular deps).
      try { import('./render.mjs').then(m => m.recoverScrollPositions?.()); } catch {}
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
    const chars = Array.from(str);
    let cx = x;
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const cp = ch.codePointAt(0);
      const w = isWideCodePoint(cp) ? 2 : 1;
      if (cx < 0 || cx >= this.width) break;
      this.charBuf[y][cx] = ch;
      this.styleBuf[y][cx] = style;
      // For wide characters, fill the next cell with a continuation marker
      if (w === 2 && cx + 1 < this.width) {
        this.charBuf[y][cx + 1] = '\u200B'; // zero-width space as filler
        this.styleBuf[y][cx + 1] = style;
      }
      cx += w;
    }
  }

  // Write a string without touching existing styles at each cell.
  // Useful for drawing characters over a previously-filled background.
  writeStrNoStyle(x, y, str) {
    if (y < 0 || y >= this.height) return;
    const chars = Array.from(str);
    let cx = x;
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const cp = ch.codePointAt(0);
      const w = isWideCodePoint(cp) ? 2 : 1;
      if (cx < 0 || cx >= this.width) break;
      this.charBuf[y][cx] = ch;
      if (w === 2 && cx + 1 < this.width) {
        this.charBuf[y][cx + 1] = '\u200B';
      }
      cx += w;
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
      // Truncate title to fit within box (accounting for borders + padding)
      const maxTitleLen = Math.max(0, w - 4);
      const truncatedTitle = maxTitleLen > 0 ? title.substring(0, maxTitleLen) : '';
      const titleLen = truncatedTitle.length;
      const pad = Math.max(0, Math.floor((w - titleLen - 4) / 2));
      const rightPad = Math.max(0, w - 2 - pad - titleLen - 2);
      const top = BOX.tl + BOX.h.repeat(pad) + ' ' + truncatedTitle + ' ' + BOX.h.repeat(rightPad) + BOX.tr;
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
      const fixed = strWidth(segs[0]) + sep.length + strWidth(segs[last]) + 2 * sep.length + 2; // … marker
      const remaining = maxWidth - fixed;
      if (remaining < 0) {
        // Path too long — just show last segment.
        segs = [segs[last]];
      } else {
        // Truncate middle segments evenly.
        const midCount = segs.length - 2;
        const per = Math.max(1, Math.floor(remaining / midCount));
        for (let i = 1; i < last; i++) {
          if (strWidth(segs[i]) > per) segs[i] = segs[i].slice(0, Math.max(1, per - 1)) + '…';
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
    return compileStyle(s);
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
