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
 * Second rule set (ux/1110 F1b), same scope, own baseline scripts/header-subtitle-allowlist.json: no sentence
 * under a title. Fails on `<PageHeader subtitle=`, `<ListPage description=` / `subtitle=` and
 * `<EntityFormModal subtitle=`. The props still exist as typed no-ops so the baseline callers compile;
 * a screen sweep deletes the prop and lowers the entry, and a new caller fails here.
 *
 * Run: node scripts/check-date-formatting.mjs [--self-test]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '../pmo-portal');
const ALLOWLIST = join(HERE, 'date-format-allowlist.json');
const SUBTITLE_ALLOWLIST = join(HERE, 'header-subtitle-allowlist.json');
const ROOTS = ['pages', 'components', 'src/components'];

export const RULES = {
  'toLocaleDateString': (code) => (code.match(/\.toLocale(?:Date|Time)String\s*\(/g) ?? []).length,
  // `format(` only counts when this file took `format` from date-fns (a local `format` helper is fine).
  'date-fns-format': (code) => {
    const imported = /import\s*\{[^}]*\bformat\b[^}]*\}\s*from\s*['"]date-fns(?:\/format)?['"]|import\s+format\s+from\s*['"]date-fns\/format['"]/.test(code);
    return imported ? Math.max(1, (code.match(/(?<![\w.$])format\s*\(/g) ?? []).length) : 0;
  },
};

/** Number of `<Tag ... attr=` openings in `code` for any of `attrs`. Brace-aware so `a={b > c}` does not end the tag early. */
function countJsxAttr(code, tag, attrs) {
  let n = 0;
  for (const m of code.matchAll(new RegExp(`<${tag}(?=[\\s/>])`, 'g'))) {
    let depth = 0;
    let end = m.index + m[0].length;
    for (; end < code.length; end++) {
      const c = code[end];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0 && code[end - 1] !== '=') break;
    }
    const opening = code.slice(m.index + m[0].length, end);
    // Only top-level attributes: blank every {...} so a prop name inside an expression is not counted.
    let flat = '';
    depth = 0;
    for (const c of opening) { if (c === '{') depth++; else if (c === '}') depth--; else if (depth === 0) flat += c; }
    if (attrs.some((a) => new RegExp(`(^|\\s)${a}=`).test(flat))) n++;
  }
  return n;
}

export const SUBTITLE_RULES = {
  'PageHeader-subtitle': (code) => countJsxAttr(code, 'PageHeader', ['subtitle']),
  'ListPage-description': (code) => countJsxAttr(code, 'ListPage', ['description', 'subtitle']),
  'EntityFormModal-subtitle': (code) => countJsxAttr(code, 'EntityFormModal', ['subtitle']),
};

const blankComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

/** files: { path: source } -> { path: { rule: count } } for every file with at least one offence. */
export function scan(files, rules = RULES) {
  const found = {};
  for (const [path, src] of Object.entries(files)) {
    if (/\.test\.[tj]sx?$|__tests__/.test(path)) continue;
    const code = blankComments(src);
    for (const [rule, count] of Object.entries(rules)) {
      const n = count(code);
      if (n > 0) (found[path] ??= {})[rule] = n;
    }
  }
  return found;
}

/** -> human-readable failures; [] means pass. */
export function compare(found, allowed, fixHint = 'format dates with src/lib/format.ts (formatDay / formatDayYear / formatMonthYearShort)', allowlistName = 'scripts/date-format-allowlist.json') {
  const errors = [];
  for (const path of new Set([...Object.keys(found), ...Object.keys(allowed)])) {
    for (const rule of new Set([...Object.keys(found[path] ?? {}), ...Object.keys(allowed[path] ?? {})])) {
      const have = found[path]?.[rule] ?? 0;
      const may = allowed[path]?.[rule] ?? 0;
      if (have > may) errors.push(`${path}: ${have} ${rule} (allowed ${may}) — ${fixHint}`);
      else if (have < may) errors.push(`${path}: stale allowlist, ${rule} is ${have} now (entry says ${may}) — lower or delete the entry in ${allowlistName}`);
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

function subtitleChecks() {
  const sub = (src) => scan({ 'pages/X.tsx': src }, SUBTITLE_RULES)['pages/X.tsx'] ?? {};
  return [
    ['PageHeader with a subtitle is flagged', sub('<PageHeader title="A" subtitle="Words." />')['PageHeader-subtitle'] === 1],
    ['PageHeader without one passes', Object.keys(sub('<PageHeader title="A" action={<b />} />')).length === 0],
    ['a multi-line ListPage description is flagged', sub('<ListPage\n  title="A"\n  description={t("x", "Words")}\n  count={n > 1 ? 2 : 3}\n>')['ListPage-description'] === 1],
    ['an EntityFormModal subtitle is flagged', sub('<EntityFormModal open title="A" subtitle="Words">x</EntityFormModal>')['EntityFormModal-subtitle'] === 1],
    ['a "subtitle" inside an expression is not a prop', Object.keys(sub('<PageHeader title={subtitle=="a"?1:2} />')).length === 0],
    ['an unrelated component with description= passes', Object.keys(sub('<Card description="x" />')).length === 0],
    ['two offending openings count two', sub('<ListPage description="a" />\n<ListPage description="b" />')['ListPage-description'] === 2],
    ['a new subtitle caller fails against an empty baseline', compare({ 'pages/X.tsx': { 'PageHeader-subtitle': 1 } }, {}).length === 1],
  ];
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
    ...subtitleChecks(),
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length) { console.error(`✗ date guard self-test: ${failed.join('; ')}`); process.exit(1); }
  console.log(`✓ date guard self-test: ${checks.length}/${checks.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    const files = Object.assign({}, ...ROOTS.map((r) => walk(join(APP, r))));
    const subtitleAllowed = JSON.parse(readFileSync(SUBTITLE_ALLOWLIST, 'utf8'));
    const errors = [
      ...compare(scan(files), JSON.parse(readFileSync(ALLOWLIST, 'utf8'))),
      ...compare(scan(files, SUBTITLE_RULES), subtitleAllowed, 'no sentence under a title: delete the subtitle / description / subtitle prop', 'scripts/header-subtitle-allowlist.json'),
    ];
    if (errors.length) { console.error(errors.map((e) => `✗ ${e}`).join('\n')); process.exit(1); }
    console.log(`✓ date formatting: no date formatted outside src/lib/format.ts beyond the allowlist (${Object.keys(JSON.parse(readFileSync(ALLOWLIST, 'utf8'))).length} file(s) left to fix).`);
    console.log(`✓ header subtitles: no new sentence under a title beyond the allowlist (${Object.keys(subtitleAllowed).length} file(s) left to fix).`);
  }
}
