const ESC = '\x1b';
const RESET = `${ESC}[0m`;

const FG = {
  red: `${ESC}[31m`, green: `${ESC}[32m`, yellow: `${ESC}[33m`,
  blue: `${ESC}[34m`, magenta: `${ESC}[35m`, cyan: `${ESC}[36m`,
  white: `${ESC}[37m`, gray: `${ESC}[90m`,
};

const BG = {
  red: `${ESC}[41m`, green: `${ESC}[42m`, yellow: `${ESC}[43m`,
  blue: `${ESC}[44m`, magenta: `${ESC}[45m`, cyan: `${ESC}[46m`,
  white: `${ESC}[47m`, gray: `${ESC}[100m`,
  darkGray: `${ESC}[48;5;235m`, darkBlue: `${ESC}[48;5;236m`,
};

const ATTR = {
  bold: `${ESC}[1m`, dim: `${ESC}[2m`, italic: `${ESC}[3m`,
  underline: `${ESC}[4m`, inverse: `${ESC}[7m`, strikethrough: `${ESC}[9m`,
};

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
    this.prevChar = this.charBuf.map(r => [...r]);
    this.prevStyle = this.styleBuf.map(r => [...r]);
  }

  updateSize() {
    const w = process.stdout.columns || 80;
    const h = process.stdout.rows || 24;
    if (w !== this.width || h !== this.height) {
      this.width = w;
      this.height = h;
      this._init();
      process.stdout.write(`${ESC}[2J${ESC}[H`);
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

  hline(y, ch = '─', style = null) {
    this.fillRow(y, ch, style);
  }

  box(x, y, w, h, title = '', style = { bold: true }) {
    if (h < 2 || w < 4 || y < 0 || y >= this.height) return;

    if (title) {
      const pad = Math.max(0, Math.floor((w - title.length - 4) / 2));
      const rightPad = Math.max(0, w - 2 - pad - title.length - 2);
      const top = '┌' + '─'.repeat(pad) + ' ' + title + ' ' + '─'.repeat(rightPad) + '┐';
      this.writeStr(x, y, top.substring(0, w), style);
    } else {
      this.writeStr(x, y, '┌' + '─'.repeat(w - 2) + '┐', style);
    }

    for (let i = 1; i < h - 1; i++) {
      if (y + i >= this.height) break;
      this.setCell(x, y + i, '│', style);
      this.setCell(x + w - 1, y + i, '│', style);
    }
    if (y + h - 1 < this.height) {
      this.writeStr(x, y + h - 1, '└' + '─'.repeat(w - 2) + '┘', style);
    }
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

        const compiled = compileStyle(st);
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

    this.prevChar = this.charBuf.map(r => [...r]);
    this.prevStyle = this.styleBuf.map(r => [...r]);
  }
}
