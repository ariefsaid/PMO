#!/usr/bin/env node
/**
 * Guard: a date shown to a person is formatted by `src/lib/format.ts` and nowhere else (ux/1110 F1a).
 * Why: one screen's "Jun 14, 2026", another's "14/06/2026", a third's raw ISO. The screen rule is one
 * shape ("10 Nov 2026" / "10 Nov" / "Nov 2026"), so a page or component that formats a date itself
 * (`toLocaleDateString`, `format(` from date-fns) is the bug.
 *
 * Scope: pmo-portal/{pages,components,src/components}, tests excluded. `src/lib/**` is the formatter.
 * Existing offenders sit in scripts/date-format-allowlist.json as { "<file>": { "<rule>": <count> } }.
 * The list may only SHRINK: a count above the entry fails (new offender); a count below it fails too
 * (stale: lower or delete the entry in the same change that fixed the caller).
 * Grep-level on purpose (comments blanked, nothing parsed): ponytail, move to an AST pass if a false
 * positive ever costs more than the rule saves.
 *
 * Run: node scripts/check-date-formatting.mjs [--self-test]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '../pmo-portal');
const ALLOWLIST = join(HERE, 'date-format-allowlist.json');
const ROOTS = ['pages', 'components', 'src/components'];

export const RULES = {
  'toLocaleDateString': (code) => (code.match(/\.toLocale(?:Date|Time)String\s*\(/g) ?? []).length,
  // `format(` only counts when this file took `format` from date-fns (a local `format` helper is fine).
  'date-fns-format': (code) => {
    const imported = /import\s*\{[^}]*\bformat\b[^}]*\}\s*from\s*['"]date-fns(?:\/format)?['"]|import\s+format\s+from\s*['"]date-fns\/format['"]/.test(code);
    return imported ? Math.max(1, (code.match(/(?<![\w.$])format\s*\(/g) ?? []).length) : 0;
  },
};

const blankComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

/** files: { path: source } -> { path: { rule: count } } for every file with at least one offence. */
export function scan(files) {
  const found = {};
  for (const [path, src] of Object.entries(files)) {
    if (/\.test\.[tj]sx?$|__tests__/.test(path)) continue;
    const code = blankComments(src);
    for (const [rule, count] of Object.entries(RULES)) {
      const n = count(code);
      if (n > 0) (found[path] ??= {})[rule] = n;
    }
  }
  return found;
}

/** -> human-readable failures; [] means pass. */
export function compare(found, allowed) {
  const errors = [];
  for (const path of new Set([...Object.keys(found), ...Object.keys(allowed)])) {
    for (const rule of new Set([...Object.keys(found[path] ?? {}), ...Object.keys(allowed[path] ?? {})])) {
      const have = found[path]?.[rule] ?? 0;
      const may = allowed[path]?.[rule] ?? 0;
      if (have > may) errors.push(`${path}: ${have} ${rule} (allowed ${may}) — format dates with src/lib/format.ts (formatDay / formatDayYear / formatMonthYearShort)`);
      else if (have < may) errors.push(`${path}: stale allowlist, ${rule} is ${have} now (entry says ${may}) — lower or delete the entry in scripts/date-format-allowlist.json`);
    }
  }
  return errors;
}

function walk(dir, out = {}) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) { if (name !== 'node_modules') walk(abs, out); }
    else if (/\.[tj]sx?$/.test(name)) out[relative(APP, abs)] = readFileSync(abs, 'utf8');
  }
  return out;
}

function selfTest() {
  const bad = (src) => scan({ 'pages/X.tsx': src });
  const checks = [
    ['toLocaleDateString is flagged', bad('const s = d.toLocaleDateString("en-US");')['pages/X.tsx']?.toLocaleDateString === 1],
    ['toLocaleTimeString is flagged', bad('d.toLocaleTimeString()')['pages/X.tsx']?.toLocaleDateString === 1],
    ['date-fns format is flagged', bad("import { format } from 'date-fns/format';\nformat(d, 'PP');")['pages/X.tsx']?.['date-fns-format'] === 1],
    ['date-fns barrel format is flagged', Boolean(bad("import { format, parseISO } from 'date-fns';\nx = format(d, 'y');")['pages/X.tsx'])],
    ['a local format helper is not flagged', Object.keys(bad("const format = (n) => n;\nformat(1);")).length === 0],
    ['other date-fns imports are not flagged', Object.keys(bad("import { parseISO } from 'date-fns/parseISO';\nparseISO(x);")).length === 0],
    ['the shared formatter is clean', Object.keys(bad("import { formatDay } from '@/src/lib/format';\nformatDay(x);")).length === 0],
    ['a comment mention is not flagged', Object.keys(bad('// was d.toLocaleDateString()\n/* d.toLocaleDateString() */')).length === 0],
    ['a test file is skipped', Object.keys(scan({ 'pages/X.test.tsx': 'd.toLocaleDateString()' })).length === 0],
    ['an unlisted offender fails', compare({ 'pages/X.tsx': { 'date-fns-format': 1 } }, {}).length === 1],
    ['a listed offender passes', compare({ 'pages/X.tsx': { 'date-fns-format': 1 } }, { 'pages/X.tsx': { 'date-fns-format': 1 } }).length === 0],
    ['one more than listed fails', compare({ 'pages/X.tsx': { toLocaleDateString: 2 } }, { 'pages/X.tsx': { toLocaleDateString: 1 } }).length === 1],
    ['a fixed caller leaves a stale entry that fails', compare({}, { 'pages/X.tsx': { 'date-fns-format': 1 } }).length === 1],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length) { console.error(`✗ date guard self-test: ${failed.join('; ')}`); process.exit(1); }
  console.log(`✓ date guard self-test: ${checks.length}/${checks.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    const files = Object.assign({}, ...ROOTS.map((r) => walk(join(APP, r))));
    const errors = compare(scan(files), JSON.parse(readFileSync(ALLOWLIST, 'utf8')));
    if (errors.length) { console.error(errors.map((e) => `✗ ${e}`).join('\n')); process.exit(1); }
    console.log(`✓ date formatting: no date formatted outside src/lib/format.ts beyond the allowlist (${Object.keys(JSON.parse(readFileSync(ALLOWLIST, 'utf8'))).length} file(s) left to fix).`);
  }
}
