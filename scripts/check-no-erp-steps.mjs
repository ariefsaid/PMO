#!/usr/bin/env node
/**
 * Guard: no on-screen text tells a person to act inside the ERP (#1599, PD-ECX-5, AC-ECX-001).
 *
 * PMO does the setup work itself; a catalogue value such as "Add these people in the ERP" sends the
 * reader to another product. Scope: every string value in `pmo-portal/public/locales/{en,id}/*.json`.
 *
 * Today's matches sit on `scripts/no-erp-steps-allowlist.json`. Each entry is
 * `{ file, key, slice }`: `file` is the locale-relative path (e.g. `en/administration.json`), `key` the
 * dotted path, `slice` the plan slice (ECX-n) that removes the string — the entry's restore path.
 * The slice that removes a string deletes its entry in the same PR. An entry whose string no longer
 * matches fails as stale, so an exception cannot outlive its text.
 *
 * Known limit: reads catalogue files only; copy written inline in source is not seen.
 *
 * Run: node scripts/check-no-erp-steps.mjs            (the catalogues)
 *      node scripts/check-no-erp-steps.mjs --self-test (the guard itself)
 *      node scripts/check-no-erp-steps.mjs --allowlist <file>   (alternate allowlist, for mutation checks)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES_DIR = resolve(REPO, 'pmo-portal/public/locales');
const ALLOWLIST_PATH = resolve(REPO, 'scripts/no-erp-steps-allowlist.json');

export const PATTERNS = [
  /\b(add|open|create|set|enter|post|review|ask)\b[^.]{0,60}\b(in|inside) (the|your) ERP\b/i,
  /\b(tambahkan|buka|buat|atur|masukkan)\b[^.]{0,60}\bdi ERP\b/i,
  /\bask your accountant\b/i,
  /\bminta akuntan\b/i,
];

export function matchesErpStep(value) {
  return PATTERNS.some((pattern) => pattern.test(value));
}

export function collectStrings(node, path = '', out = []) {
  if (typeof node === 'string') out.push({ key: path, value: node });
  else if (Array.isArray(node)) node.forEach((child, i) => collectStrings(child, `${path}[${i}]`, out));
  else if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) collectStrings(child, path ? `${path}.${key}` : key, out);
  }
  return out;
}

const idOf = (file, key) => `${file}\u0000${key}`;

/**
 * @param {Array<{file: string, catalogue: object}>} catalogues file is `<lang>/<name>.json`
 * @param {Array<{file: string, key: string, slice: string}>} allowlist
 */
export function evaluate(catalogues, allowlist) {
  const failures = [];
  const badEntries = [];
  const allowed = new Map();
  const used = new Set();
  let scanned = 0;

  for (const entry of allowlist) {
    const missing = ['file', 'key', 'slice'].filter((f) => !String(entry[f] ?? '').trim());
    if (missing.length > 0) badEntries.push(`allowlist entry ${JSON.stringify(entry)} has no ${missing.join(', ')}`);
    else if (!/^ECX-\d+$|^#\d+$/.test(entry.slice)) badEntries.push(`allowlist entry ${entry.file} :: ${entry.key} slice '${entry.slice}' must name the removing slice (ECX-n or #issue)`);
    else allowed.set(idOf(entry.file, entry.key), entry);
  }

  for (const { file, catalogue } of catalogues) {
    for (const { key, value } of collectStrings(catalogue)) {
      scanned += 1;
      if (!matchesErpStep(value)) continue;
      const id = idOf(file, key);
      if (allowed.has(id)) used.add(id);
      else failures.push(`${file} :: ${key} tells a person to act in the ERP: "${value}"`);
    }
  }

  const staleEntries = [...allowed.entries()]
    .filter(([id]) => !used.has(id))
    .map(([, e]) => `allowlist entry ${e.file} :: ${e.key} (${e.slice}) matches nothing — remove it`);
  return { failures, badEntries, staleEntries, scanned };
}

export function readCatalogues(dir = LOCALES_DIR) {
  const out = [];
  for (const lang of readdirSync(dir).sort()) {
    let names;
    try { names = readdirSync(join(dir, lang)).filter((n) => n.endsWith('.json')).sort(); } catch { continue; }
    for (const name of names) out.push({ file: `${lang}/${name}`, catalogue: JSON.parse(readFileSync(join(dir, lang, name), 'utf8')) });
  }
  return out;
}

function runCatalogue() {
  const i = process.argv.indexOf('--allowlist');
  const allowlist = JSON.parse(readFileSync(i > -1 ? resolve(process.argv[i + 1]) : ALLOWLIST_PATH, 'utf8'));
  const catalogues = readCatalogues();
  const { failures, badEntries, staleEntries, scanned } = evaluate(catalogues, allowlist);
  if (scanned === 0) {
    console.error('ERROR: 0 catalogue strings scanned — a guard that read nothing must not pass.');
    process.exit(1);
  }
  const problems = [...failures, ...badEntries, ...staleEntries];
  if (problems.length > 0) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error('\nPMO does the setup itself: no copy tells a user to act in the ERP (#1599). Reword it, or allowlist it with the slice that removes it.');
    process.exit(1);
  }
  console.log(`✓ no-erp-steps: ${scanned} strings, ${allowlist.length} allowlisted pending removal (${catalogues.length} files)`);
}

function runSelfTest() {
  const cases = [];
  const check = (name, ok) => cases.push({ name, ok: Boolean(ok) });
  const cat = (value) => [{ file: 'en/x.json', catalogue: { x: value } }];
  const entry = (slice = 'ECX-6') => ({ file: 'en/x.json', key: 'x', slice });

  check('fails on "Add these people in the ERP."', evaluate(cat('Add these people in the ERP.'), []).failures.length === 1);
  check('passes "Synced from the ERP."', evaluate(cat('Synced from the ERP.'), []).failures.length === 0);
  check('fails on "Ask your accountant to ..."', evaluate(cat('Ask your accountant to add an account'), []).failures.length === 1);
  check('fails on the id form (di ERP)', evaluate(cat('Tambahkan orang ini di ERP.'), []).failures.length === 1);
  check('fails on the id accountant form', evaluate(cat('Minta akuntan Anda menambah akun'), []).failures.length === 1);
  check('passes a value that merely names the ERP', evaluate(cat('No enabled Asset accounts in the ERP chart.'), []).failures.length === 0);
  check('reads nested and array values', evaluate([{ file: 'en/x.json', catalogue: { a: [{ b: 'Open it in the ERP' }] } }], []).failures[0]?.includes('a[0].b'));

  const ok = evaluate(cat('Add these people in the ERP.'), [entry()]);
  check('an allowlisted entry passes', ok.failures.length === 0 && ok.staleEntries.length === 0);
  const stale = evaluate(cat('Synced from the ERP.'), [entry()]);
  check('an entry whose text no longer matches fails as stale', stale.staleEntries.length === 1);
  check('an entry with no slice fails', evaluate(cat('Add these people in the ERP.'), [{ file: 'en/x.json', key: 'x' }]).badEntries.length === 1);
  check('an entry with a non-slice name fails', evaluate(cat('Add these people in the ERP.'), [entry('later')]).badEntries.length === 1);
  check('an empty scan is visible as zero strings', evaluate([], []).scanned === 0);
  check('an exception does not allow a different key', evaluate([{ file: 'en/x.json', catalogue: { x: 'Add this in the ERP', y: 'Add that in the ERP' } }], [entry()]).failures.length === 1);
  check('an exception does not allow a different file', evaluate([{ file: 'id/x.json', catalogue: { x: 'Add this in the ERP' } }], [entry()]).failures.length === 1);
  check('missing file and key fail validation', evaluate([], [{ slice: 'ECX-6' }]).badEntries.length === 1);
  check('scans every string, including non-matches', evaluate([{ file: 'en/x.json', catalogue: { a: 'Safe', b: ['Also safe'] } }], []).scanned === 2);
  check('case-insensitive instructions fail', evaluate(cat('ADD this IN THE ERP'), []).failures.length === 1);
  check('issue-number restore paths are accepted', evaluate(cat('Add this in the ERP'), [entry('#123')]).badEntries.length === 0);

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`✗ ${c.name}`);
  if (failed.length > 0) {
    console.error(`\n${failed.length}/${cases.length} self-test cases failed — the guard is not trustworthy.`);
    process.exit(1);
  }
  console.log(`✓ no-erp-steps self-test: ${cases.length}/${cases.length} planted cases behave`);
}

export function isRunAsMain(importMetaUrl, argv1) {
  return Boolean(argv1) && importMetaUrl === pathToFileURL(argv1).href;
}

if (isRunAsMain(import.meta.url, process.argv[1])) {
  if (process.argv.includes('--self-test')) runSelfTest();
  else runCatalogue();
}
