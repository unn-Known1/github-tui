#!/usr/bin/env node
// tools/check-imports.mjs — zero-dep static audit.
//
// Catches the bug class where a module references an identifier X (exported
// by some other module) but never imports X from anywhere. Recent example:
// `tui/render.mjs` called `checkLoadingWatchdog()` and `getUnreadCount()`
// (both exported from `tui/state.mjs`) without adding them to the
// destructured import. The test suite passed because no test exercised
// render.mjs's surface — the bug was only visible at runtime.
//
// Run with: `node tools/check-imports.mjs`
// Exit code: 0 if all imports are clean, 1 if any miss is found.
// Chain into CI or pre-commit to prevent this bug class from recurring.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Modules whose exports we audit against. The state module is the main
// surface; render.mjs is included because the `render` name is exported
// from both (state.mjs exports a placeholder debounced noop to break an
// import cycle, render.mjs exports the real screen-painter).
const AUDIT_MODULES = [
  ['tui', 'state.mjs'].join(sep),
  ['tui', 'render.mjs'].join(sep),
];

// (file::name) pairs for known legitimate shadows. Add entries here
// only when the import-tracking logic genuinely cannot reason about a
// case — keep this list short.
const ALLOWLIST = new Set([
  // state.mjs and render.mjs both export `render` (different functions).
  // state.mjs deliberately does NOT import render from render.mjs (the
  // real screen-painter), so render.mjs's local `render` is bound by
  // its own export — not by importing state.mjs's. Tracking ALL imports
  // means this isn't flagged, but the allowlist is belt-and-suspenders.
  ['tui', 'render.mjs'].join(sep) + '::render',
]);

function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      const base = p.split(sep).pop();
      if (base === 'node_modules' || base === 'tests' || base === 'tools' || base === '.git') continue;
      out.push(...listJsFiles(p));
    } else if (p.endsWith('.mjs') && !p.endsWith('check-imports.mjs')) {
      out.push(p);
    }
  }
  return out;
}

// Mask comments and string literals with spaces (preserving newlines so
// line numbers in error messages stay accurate). Inside template literals,
// `${...}` interpolations are preserved verbatim so references inside
// expressions still get audited.
function stripCommentsAndStrings(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && next === '*') {
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i] === '\n' ? '\n' : ' '; i++;
      }
      out += '  '; i += 2;
    } else if (c === "'" || c === '"') {
      out += ' '; i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') { out += '  '; i += 2; }
        else { out += text[i] === '\n' ? '\n' : ' '; i++; }
      }
      if (i < text.length) { out += ' '; i++; }
    } else if (c === '`') {
      out += ' '; i++;
      while (i < text.length && text[i] !== '`') {
        if (text[i] === '\\') { out += '  '; i += 2; continue; }
        if (text[i] === '$' && text[i + 1] === '{') {
          out += '${'; i += 2;
          let depth = 1;
          while (i < text.length && depth > 0) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') { depth--; if (depth === 0) { out += '}'; i++; break; } }
            out += text[i]; i++;
          }
          continue;
        }
        out += text[i] === '\n' ? '\n' : ' '; i++;
      }
      if (i < text.length) { out += ' '; i++; }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// Collect every name that is bound in this file — by any import (from
// ANY module, not just the audit modules) or by a local declaration.
// A name that's bound anywhere is no longer "unbound" and shouldn't
// trigger the audit. This automatically handles name collisions like
// `render` being imported from render.mjs while state.mjs also exports
// it.
function findBoundNames(text) {
  const bound = new Set();

  // Static imports: `import X, { a, b as c } from '...'`.
  // Track default imports, named imports, and namespace imports.
  const importRe = /import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]+)\})?\s*(?:\*\s*as\s+(\w+))?\s*from\s*['"][^'"]+['"]/g;
  let m;
  while ((m = importRe.exec(text)) !== null) {
    if (m[1]) bound.add(m[1]); // default
    if (m[2]) {
      for (const ident of m[2].split(',')) {
        const parts = ident.trim().split(/\s+as\s+/).map(s => s.trim()).filter(Boolean);
        if (parts.length) bound.add(parts[parts.length - 1]);
      }
    }
    if (m[3]) bound.add(m[3]); // namespace
  }

  // Re-exports — treat the re-exported names as bound in the re-exporting file.
  const reRe = /export\s+(?:\{([^}]+)\}|\*\s*as\s+(\w+))\s+from\s*['"][^'"]+['"]/g;
  while ((m = reRe.exec(text)) !== null) {
    if (m[1]) {
      for (const ident of m[1].split(',')) {
        const parts = ident.trim().split(/\s+as\s+/).map(s => s.trim()).filter(Boolean);
        if (parts.length) bound.add(parts[parts.length - 1]);
      }
    }
    // Star re-exports are accessed via `ns.X` — never bare references.
  }

  // Local declarations.
  const declRe = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var|function|class|async\s+function)\s+(\w+)/g;
  while ((m = declRe.exec(text)) !== null) bound.add(m[1]);
  // Function parameters.
  const paramRe = /(?:function\s*\w*|\(\s*|=\s*)\s*\(?([A-Za-z_$][\w$]*)\s*[,)=]/g;
  while ((m = paramRe.exec(text)) !== null) bound.add(m[1]);
  // Destructured patterns.
  const destructureRe = /(?:const|let|var)\s*\{([^}]+)\}\s*=/g;
  while ((m = destructureRe.exec(text)) !== null) {
    for (const part of m[1].split(',')) {
      const trimmed = part.trim().split(/[=:]/)[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) bound.add(trimmed);
      const aliasMatch = part.match(/^[A-Za-z_$][\w$]*\s*:\s*([A-Za-z_$][\w$]*)/);
      if (aliasMatch) bound.add(aliasMatch[1]);
    }
  }
  // For-of / for-in loop vars.
  const forRe = /for\s*\(\s*(?:const|let|var)\s+(\w+)\s+(?:of|in)\s+/g;
  while ((m = forRe.exec(text)) !== null) bound.add(m[1]);

  return bound;
}

// Find every bare (free) identifier reference of `name` in `text`.
// "Bare" means NOT preceded by `.` (which would be property access).
// Returns { index, line, kind } where kind is 'use' or 'defensive'.
// `defensive` = `typeof NAME === '...'` — works even when NAME is
// undeclared, so we report it as DEFENSIVE rather than as a real bug.
function findBareReferences(text, name) {
  // Capture the preceding char to verify it's not `.` and to check for
  // `typeof ` prefix. The boundary [^.\w$] rejects property access.
  const re = new RegExp(`(^|[^.\\w$])${name}(?![\\w$])`, 'gm');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = m[1];
    const idx = m.index + before.length;

    // Skip class method definitions: `render() {`, `async load() {`,
    // `get x() {`, `set y(v) {`, `* gen() {`. These define a method on
    // `this`, NOT a reference to the imported function. We must use
    // paren-balancing (not a flat `[^)]*`) so a CALL containing a nested
    // arrow like `confirm("ok", () => {}, "label")` isn't mistaken for
    // a method def — `[^)]*` would over-match on the inner `)`.
    if (isMethodDefinition(text, idx, name)) continue;

    // Detect defensive `typeof NAME === '...'` — safe even when undeclared.
    // Look back up to 8 chars for `typeof `.
    const prefixStart = Math.max(0, idx - 8);
    const prefix = text.slice(prefixStart, idx);
    const kind = /typeof\s*$/.test(prefix) ? 'defensive' : 'use';

    out.push({ index: idx, line: lineOf(text, idx), kind });
  }
  return out;
}

// True iff `text[idx]` is the start of a class-method definition like
// `name(...) {` or `async name(...) {` or `name(...) => {`. Walks the
// argument list with proper paren balancing so nested calls/arrows don't
// fool the matcher.
function isMethodDefinition(text, idx, name) {
  let i = idx + name.length;
  // Skip whitespace and a single leading `*` (generator) — rare, but cheap.
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  if (text[i] !== '(') return false;
  // Find the matching `)` with paren balancing (also skipping strings).
  let depth = 1;
  i++;
  while (i < text.length && depth > 0) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      // Skip string/template to avoid counting parens inside strings.
      i = skipString(text, i);
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    i++;
  }
  if (depth !== 0) return false;
  // i is past the matching `)`. Look for `{` (body) or `=>` (arrow body)
  // with optional whitespace between.
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  if (text[i] === '{') return true;
  if (text[i] === '=' && text[i + 1] === '>') return true;
  return false;
}

function skipString(text, start) {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; continue; }
    if (text[i] === quote) return i + 1;
    i++;
  }
  return i;
}

function lineOf(text, idx) {
  let line = 1;
  for (let i = 0; i < idx; i++) if (text[i] === '\n') line++;
  return line;
}

function collectExports(text) {
  const re = /^\s*export\s+(?:const|let|var|function|class|async\s+function)\s+(\w+)/gm;
  const out = new Set();
  let m;
  while ((m = re.exec(text)) !== null) out.add(m[1]);
  return out;
}

function audit() {
  const auditExports = new Map(); // absPath → Set<exportName>
  for (const rel of AUDIT_MODULES) {
    const abs = resolve(ROOT, rel);
    const raw = readFileSync(abs, 'utf8');
    auditExports.set(rel, collectExports(stripCommentsAndStrings(raw)));
  }

  const files = listJsFiles(ROOT);
  let issues = 0;
  let defensive = 0;

  for (const file of files) {
    const rel = relative(ROOT, file);
    const raw = readFileSync(file, 'utf8');
    const clean = stripCommentsAndStrings(raw);
    const bound = findBoundNames(raw); // parse imports from raw so strings don't mask them
    // Also re-collect bound names from clean (locals can be hidden by strings).

    for (const [auditRel, exports] of auditExports) {
      for (const name of exports) {
        if (bound.has(name)) continue;
        const allowKey = rel + '::' + name;
        if (ALLOWLIST.has(allowKey)) continue;
        const refs = findBareReferences(clean, name);
        if (refs.length === 0) continue;

        const uses = refs.filter(r => r.kind === 'use');
        const defs = refs.filter(r => r.kind === 'defensive');
        if (uses.length === 0 && defs.length > 0) {
          const lineList = defs.slice(0, 3).map(r => r.line).join(', ');
          console.error(`${rel}: DEFENSIVE typeof check for \`${name}\` (not imported; line ${lineList})`);
          defensive++;
          continue;
        }
        const lineList = uses.slice(0, 5).map(r => r.line).join(', ');
        const more = uses.length > 5 ? ` (+${uses.length - 5} more)` : '';
        console.error(`${rel}: uses \`${name}\` from ${auditRel} but does not import it (line ${lineList}${more})`);
        issues++;
      }
    }
  }

  if (issues > 0) {
    console.error(`\n${issues} missed import${issues === 1 ? '' : 's'} found${defensive ? `, ${defensive} defensive` : ''}.`);
    process.exit(1);
  }
  if (defensive > 0) {
    console.error(`${defensive} defensive typeof check${defensive === 1 ? '' : 's'} found (consider importing or removing).`);
  }
  console.log(`check-imports: ${files.length} files audited against ${AUDIT_MODULES.length} modules, 0 issues.`);
}

audit();