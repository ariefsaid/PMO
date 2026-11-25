#!/usr/bin/env node
/**
 * Guard: a screen's default day comes from the organisation's timezone, never the device's clock (#1126).
 * Why: a person whose device timezone differs from the organisation's sees the wrong "today" for part
 * of every day — a form starts on the wrong date, a week grid opens the wrong week. The one source is
 * `useOrgToday()` (`src/hooks/useOrgToday.ts`); pure helpers take the day as a parameter.
 *
 * Scope: pmo-portal/pages and pmo-portal/src/components, tests excluded. Two literal shapes are the
 * tell of the pattern:
 *   `toIso(new Date())`                    — the local-date helper fed the device clock;
 *   `new Date().toISOString().slice(0, 10)` — the UTC day, wrong even on a device in the org's zone.
 * Grep-level on purpose (comments blanked, nothing parsed), same as check-date-formatting.mjs.
 *
 * A place that TRULY means the device's day (and there is one) sits in
 * scripts/org-today-allowlist.json as { "<file>": { "rule", "count", "reason", "verified" } } —
 * `reason` must say why the device's day is correct there, `verified` (YYYY-MM-DD) the day someone
 * last READ the place and confirmed it. The list may only SHRINK: an uncovered offender fails, and a
 * stale entry (the code is gone) fails too — lower or delete the entry in the same change.
 *
 * Run: node scripts/check-org-today.mjs [--self-test]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '../pmo-portal');
const ALLOWLIST = join(HERE, 'org-today-allowlist.json');
const ROOTS = ['pages', 'src/components'];

export const RULES = {
  'toIso-new-date': (code) => (code.match(/(?<![\w.$])toIso\s*\(\s*new\s+Date\s*\(\s*\)\s*\)/g) ?? []).length,
  'iso-slice-0-10': (code) => (code.match(/new\s+Date\s*\(\s*\)\s*\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/g) ?? []).length,
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

/** -> human-readable failures; [] means pass. Every allowlist entry needs a non-empty reason. */
export function compare(found, allowed, fixHint = "take the day from useOrgToday() (src/hooks/useOrgToday.ts); a pure helper takes it as a parameter", allowlistName = 'scripts/org-today-allowlist.json') {
  const errors = [];
  for (const [path, entry] of Object.entries(allowed ?? {})) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) { errors.push(`${path}: allowlist entry must be { rule, count, reason, verified } — ${allowlistName}`); continue; }
    if (!String(entry.reason ?? '').trim()) errors.push(`${path}: allowlist entry needs a reason that says why the device's day is correct there — ${allowlistName}`);
    if (!/\d{4}-\d{2}-\d{2}$/.test(String(entry.verified ?? ''))) errors.push(`${path}: allowlist entry needs a verified YYYY-MM-DD — ${allowlistName}`);
    const rule = String(entry.rule ?? '');
    const have = found[path]?.[rule] ?? 0;
    const may = Number(entry.count ?? 0);
    if (have > may) errors.push(`${path}: ${have} ${rule} (allowed ${may}) — ${fixHint}`);
    else if (have < may) errors.push(`${path}: stale allowlist, ${rule} is ${have} now (entry says ${may}) — lower or delete the entry in ${allowlistName}`);
    delete found[path]?.[rule];
  }
  for (const [path, rules] of Object.entries(found)) {
    for (const [rule, n] of Object.entries(rules)) errors.push(`${path}: ${n} ${rule} — ${fixHint} (or, only if it truly means the device's day, allow-list it with a reason in ${allowlistName})`);
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
  const bad = (src) => scan({ 'pages/X.tsx': src })['pages/X.tsx'] ?? {};
  const allow = (entry) => ({ 'pages/X.tsx': entry });
  const checks = [
    ['toIso(new Date()) is flagged', bad('const d = toIso(new Date());')['toIso-new-date'] === 1],
    ['spacing variants are flagged', bad('toIso( new Date() )')['toIso-new-date'] === 1],
    ['toIso on another value is not flagged', Object.keys(bad('const d = toIso(fromIso(x));')).length === 0],
    ['a namespaced or method toIso is not flagged', Object.keys(bad('const d = week.toIso(new Date());')).length === 0],
    ['new Date().toISOString().slice(0, 10) is flagged', bad('const d = new Date().toISOString().slice(0, 10);')['iso-slice-0-10'] === 1],
    ['an ISO string without the day slice is not flagged', Object.keys(bad('const t = new Date().toISOString();')).length === 0],
    ['a slice on another Date is not flagged (the rule is the default-day literal)', Object.keys(bad('const d = d2.toISOString().slice(0, 10);')).length === 0],
    ['a comment mention is not flagged', Object.keys(bad('// was toIso(new Date())\n/* new Date().toISOString().slice(0, 10) */')).length === 0],
    ['a test file is skipped', Object.keys(scan({ 'pages/X.test.tsx': 'toIso(new Date())' })).length === 0],
    ['useOrgToday passes', Object.keys(bad("const today = useOrgToday();")).length === 0],
    ['an unlisted offender fails', compare({ 'pages/X.tsx': { 'toIso-new-date': 1 } }, {}).length === 1],
    ['a listed offender passes', compare({ 'pages/X.tsx': { 'toIso-new-date': 1 } }, allow({ rule: 'toIso-new-date', count: 1, reason: 'this widget shows the viewer\'s own device day by design', verified: '2026-11-26' })).length === 0],
    ['one more than listed fails', compare({ 'pages/X.tsx': { 'toIso-new-date': 2 } }, allow({ rule: 'toIso-new-date', count: 1, reason: 'r', verified: '2026-11-26' })).length === 1],
    ['a fixed caller leaves a stale entry that fails', compare({}, allow({ rule: 'iso-slice-0-10', count: 1, reason: 'r', verified: '2026-11-26' })).some((e) => e.includes('stale'))],
    ['an entry without a reason fails', compare({}, allow({ rule: 'toIso-new-date', count: 1, verified: '2026-11-26' })).some((e) => e.includes('reason'))],
    ['an entry without a verified day fails', compare({}, allow({ rule: 'toIso-new-date', count: 1, reason: 'r' })).some((e) => e.includes('verified'))],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length) { console.error(`✗ org-today guard self-test: ${failed.join('; ')}`); process.exit(1); }
  console.log(`✓ org-today guard self-test: ${checks.length}/${checks.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    const files = Object.assign({}, ...ROOTS.map((r) => walk(join(APP, r))));
    const allowed = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
    const errors = compare(scan(files), allowed);
    if (errors.length) { console.error(errors.map((e) => `✗ ${e}`).join('\n')); process.exit(1); }
    console.log(`✓ org today: no screen takes its default day from the device's clock beyond the allowlist (${Object.keys(allowed).length} file(s) left to fix).`);
  }
}
