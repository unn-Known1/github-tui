const ESC = '\x1b';
const RESET = `${ESC}[0m`;

const FG = {
  bright: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  blue: `${ESC}[34m`,
  magenta: `${ESC}[35m`,
  cyan: `${ESC}[36m`,
  white: `${ESC}[37m`,
};

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

  fillRow(y, ch) {
    if (y < 0 || y >= this.height) return;
    for (let x = 0; x < this.width; x++) {
      this.charBuf[y][x] = ch;
      this.styleBuf[y][x] = null;
    }
  }

  hline(y, ch = '─') {
    this.fillRow(y, ch);
  }

  box(x, y, w, h, title = '') {
    if (h < 2 || w < 4 || y < 0 || y >= this.height) return;

    if (title) {
      const pad = Math.max(0, Math.floor((w - title.length - 4) / 2));
      const rightPad = Math.max(0, w - 2 - pad - title.length - 2);
      const top = '┌' + '─'.repeat(pad) + ' ' + title + ' ' + '─'.repeat(rightPad) + '┐';
      this.writeStr(x, y, top.substring(0, w), 'bright');
    } else {
      this.writeStr(x, y, '┌' + '─'.repeat(w - 2) + '┐', 'bright');
    }

    for (let i = 1; i < h - 1; i++) {
      if (y + i >= this.height) break;
      this.setCell(x, y + i, '│', 'bright');
      this.setCell(x + w - 1, y + i, '│', 'bright');
    }
    if (y + h - 1 < this.height) {
      this.writeStr(x, y + h - 1, '└' + '─'.repeat(w - 2) + '┘', 'bright');
    }
  }

  render() {
    const out = [];
    let curStyle = null;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const ch = this.charBuf[y][x];
        const st = this.styleBuf[y][x];
        const pCh = this.prevChar[y] ? this.prevChar[y][x] : undefined;
        const pSt = this.prevStyle[y] ? this.prevStyle[y][x] : undefined;

        if (ch === pCh && st === pSt) continue;

        out.push(`${ESC}[${y + 1};${x + 1}H`);

        if (st !== curStyle) {
          if (curStyle) out.push(RESET);
          if (st) out.push(FG[st] || '');
          curStyle = st;
        }

        out.push(ch);
      }
    }

    if (curStyle) out.push(RESET);

    if (out.length > 0) {
      process.stdout.write(out.join(''));
    }

    this.prevChar = this.charBuf.map(r => [...r]);
    this.prevStyle = this.styleBuf.map(r => [...r]);
  }
}
