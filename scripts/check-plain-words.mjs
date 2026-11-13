#!/usr/bin/env node
/**
 * Guard: no locale value shown to a person spells out a code word (plain-words C20, sweep
 * `sweep-identifier-leak.md`).
 *
 * Why this exists (2026-11-13): the sweep found `project_id`, `$current_team`, `get_project_milestones`
 * and a raw ERP setting path rendered as product copy — database function names, column names and
 * enum tokens on the View Builder, the Tasks tab tooltips and the plan console. Each one was fixed by
 * hand; this gate is what keeps the next one out of the catalogue.
 *
 * Scope: every value under `pmo-portal/public/locales/en/*.json` (the English catalogue is the source
 * every other language mirrors — FR-L10N-043). Keys, `data-testid`s and developer-only surfaces are
 * out of scope by design: the sweep kept the two dev-detail disclosures and the ERP identifiers on
 * integration screens (those are the vendor's own product nouns).
 *
 * Known limits — green is NOT proof of a clean surface. This gate does not catch: camelCase tokens
 * (`teamId`, `externalRecordId`); the bare word "id"/"ID" used as a noun; or any string written
 * inline in source (a `t(key, 'default')` fallback or a plain TS/TSX message), because it reads
 * catalogue files only — so a fix in a `.ts` message must be reviewed by a person, not this run.
 *
 * Run: node scripts/check-plain-words.mjs            (the catalogue)
 *      node scripts/check-plain-words.mjs --self-test (the gate itself, planted cases)
 *
 * The pure helpers are exported so the self-test exercises the same code the CLI runs; a gate whose
 * logic is only exercised through its happy path is a gate that passes when the logic breaks.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOGUE_DIR = resolve(REPO, 'pmo-portal/public/locales/en');

/** A `snake_case` identifier: two or more word groups joined by underscores. */
export const SNAKE_CASE = /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/;
/** A bare uuid — a raw record key, never a thing a reader can act on. */
export const BARE_UUID = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/;

export const RULES = { 'snake-case': SNAKE_CASE, 'bare-uuid': BARE_UUID };

/**
 * Allowlisted exceptions. Each entry needs a `reason` — and a reason is a statement about why a
 * READER needs this token, not why it was easier to leave it. An entry that no longer matches the
 * catalogue fails as stale, so an exception can never quietly outlive its string.
 *
 * (Empty today: the C20 sweep left the English catalogue clean, and the three leaks it found are now
 * planted cases in `--self-test` instead of exceptions.)
 */
export const ALLOWLIST = [];

/** Rule hits in one display string, in rule order. */
export function findLeaks(value) {
  const hits = [];
  for (const [rule, pattern] of Object.entries(RULES)) {
    const match = value.match(pattern);
    if (match) hits.push({ rule, match: match[0] });
  }
  return hits;
}

/** Every leaf string of a catalogue, keyed by its dotted path. */
export function collectStrings(node, path = '', out = []) {
  if (typeof node === 'string') {
    out.push({ key: path, value: node });
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((child, index) => collectStrings(child, `${path}[${index}]`, out));
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) collectStrings(child, path ? `${path}.${key}` : key, out);
  }
  return out;
}

function allowlistKey(entry) {
  return `${entry.file}\u0000${entry.key}\u0000${entry.rule}`;
}

/**
 * @param {Array<{file: string, catalogues: object}>} catalogues
 * @param {Array<{file: string, key: string, rule: string, reason: string}>} allowlist
 * @returns {{failures: string[], badEntries: string[], staleEntries: string[], scanned: number}}
 */
export function evaluate(catalogues, allowlist = ALLOWLIST) {
  const failures = [];
  const badEntries = [];
  const used = new Set();
  let scanned = 0;

  const allowed = new Map();
  for (const entry of allowlist) {
    const missing = ['file', 'key', 'rule', 'reason'].filter((field) => !String(entry[field] ?? '').trim());
    if (missing.length > 0) {
      badEntries.push(`allowlist entry ${JSON.stringify(entry)} has no ${missing.join(', ')}`);
      continue;
    }
    if (!RULES[entry.rule]) {
      badEntries.push(`allowlist entry ${entry.file} :: ${entry.key} names unknown rule '${entry.rule}'`);
      continue;
    }
    if (String(entry.reason).trim().length < 20) {
      badEntries.push(`allowlist entry ${entry.file} :: ${entry.key} needs a real reason (a reader-facing one), not '${entry.reason}'`);
      continue;
    }
    allowed.set(allowlistKey(entry), entry);
  }

  for (const { file, catalogue } of catalogues) {
    for (const { key, value } of collectStrings(catalogue)) {
      scanned += 1;
      for (const hit of findLeaks(value)) {
        const id = allowlistKey({ file, key, rule: hit.rule });
        if (allowed.has(id)) {
          used.add(id);
          continue;
        }
        failures.push(
          `${file} :: ${key} :: ${hit.rule} '${hit.match}' in "${value}"\n` +
          `    a value a person reads must not carry a code word — say what it means, or allowlist it with a reason`,
        );
      }
    }
  }

  const staleEntries = [...allowed.entries()]
    .filter(([id]) => !used.has(id))
    .map(([, entry]) => `allowlist entry ${entry.file} :: ${entry.key} (${entry.rule}) matches nothing — remove it`);

  return { failures, badEntries, staleEntries, scanned };
}

export function readCatalogues(dir = CATALOGUE_DIR) {
  const files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  return files.map((file) => ({ file, catalogue: JSON.parse(readFileSync(join(dir, file), 'utf8')) }));
}

function runCatalogue() {
  const catalogues = readCatalogues();
  if (catalogues.length === 0) {
    console.error(
      `ERROR: 0 catalogue files read from ${CATALOGUE_DIR}.\n` +
      '  A gate that scanned nothing must not report success.',
    );
    process.exit(1);
  }
  const { failures, badEntries, staleEntries, scanned } = evaluate(catalogues);
  if (failures.length + badEntries.length + staleEntries.length > 0) {
    for (const failure of failures) console.error(`✗ ${failure}`);
    for (const entry of badEntries) console.error(`✗ ${entry}`);
    for (const entry of staleEntries) console.error(`✗ ${entry}`);
    console.error('\nLocale values are product copy: no field, function or enum names (plain-words C20).');
    process.exit(1);
  }
  if (scanned === 0) {
    console.error('ERROR: the catalogues parsed to 0 strings — an empty catalogue must not pass.');
    process.exit(1);
  }
  console.log(`✓ plain words: ${scanned} catalogue strings carry no snake_case token or bare uuid (${catalogues.length} files)`);
}

function runSelfTest() {
  const cases = [];
  const check = (name, condition) => cases.push({ name, ok: Boolean(condition) });

  // — the rule itself, with the three shapes the sweep actually found —
  check('finds project_id in a View Builder note', findLeaks('Tasks require a project filter (column: project_id, op: eq or in)').some((h) => h.rule === 'snake-case'));
  check('finds get_project_milestones in a tooltip', findLeaks('Source: get_project_milestones.').some((h) => h.match === 'get_project_milestones'));
  check('finds a raw uuid', findLeaks('Record 3f9a1b2c-4d5e-4f60-8a7b-9c0d1e2f3a4b is unavailable').some((h) => h.rule === 'bare-uuid'));
  check('finds the value in a multilingual string too', findLeaks('Daftar tidak tersedia untuk project_id.').length === 1);

  // — and stays quiet on the copy this card ships —
  for (const clean of [
    'Tasks panels need a project filter.',
    'Version {{number}}',
    '{{count}} ledger entries',
    'List unavailable. Its saved link is kept.',
    'Daftar tidak tersedia. Tautan tersimpan tetap ada.',
    'From date — Sep 1, 2026',
    'Odoo account 4000-01',
  ]) {
    check(`clears ${JSON.stringify(clean)}`, findLeaks(clean).length === 0);
  }

  // — evaluation over a planted catalogue —
  const planted = [{
    file: 'common.json',
    catalogue: { viewBuilder: { tasksRequireProjectFilter: 'Need a project_id filter' }, nested: [{ ok: 'Export all lines' }] },
  }];
  const clean = evaluate(planted, []);
  check('reports a planted leak with its key path', clean.failures.length === 1 && clean.failures[0].includes('viewBuilder.tasksRequireProjectFilter'));
  check('counts every leaf string it scanned', clean.scanned === 2);

  // — the allowlist has to earn each exception —
  const allowed = evaluate(planted, [{ file: 'common.json', key: 'viewBuilder.tasksRequireProjectFilter', rule: 'snake-case', reason: 'The column name is the thing the reader must type into the field.' }]);
  check('an allowlisted leak with a reason passes', allowed.failures.length === 0 && allowed.staleEntries.length === 0);

  const noReason = evaluate(planted, [{ file: 'common.json', key: 'viewBuilder.tasksRequireProjectFilter', rule: 'snake-case', reason: '  ' }]);
  check('an allowlist entry without a reason fails', noReason.badEntries.length === 1 && noReason.badEntries[0].includes('reason'));

  const thinReason = evaluate(planted, [{ file: 'common.json', key: 'viewBuilder.tasksRequireProjectFilter', rule: 'snake-case', reason: 'legacy' }]);
  check('an allowlist entry with a stub reason fails', thinReason.badEntries.length === 1 && thinReason.badEntries[0].includes('real reason'));

  const stale = evaluate([{ file: 'common.json', catalogue: { ok: 'Export all lines' } }], [{ file: 'common.json', key: 'gone.key', rule: 'snake-case', reason: 'This string was removed when the screen was rewritten.' }]);
  check('a stale allowlist entry fails', stale.staleEntries.length === 1 && stale.failures.length === 0);

  const unknownRule = evaluate(planted, [{ file: 'common.json', key: 'viewBuilder.tasksRequireProjectFilter', rule: 'camel-case', reason: 'A rule name that does not exist must not silently exempt anything.' }]);
  check('an unknown rule fails instead of exempting', unknownRule.badEntries.length === 1 && unknownRule.failures.length === 1);

  // — the negative direction: a leak the gate cannot see is the failure this guards against —
  const nothing = evaluate([], []);
  check('an empty scan is visible as zero strings', nothing.scanned === 0);

  const failed = cases.filter((entry) => !entry.ok);
  for (const entry of cases) {
    if (entry.ok) continue;
    console.error(`✗ ${entry.name}`);
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length}/${cases.length} self-test cases failed — the guard is not trustworthy.`);
    process.exit(1);
  }
  console.log(`✓ plain-words self-test: ${cases.length}/${cases.length} planted cases behave`);
}

export function isRunAsMain(importMetaUrl, argv1) {
  return Boolean(argv1) && importMetaUrl === pathToFileURL(argv1).href;
}

if (isRunAsMain(import.meta.url, process.argv[1])) {
  if (process.argv.includes('--self-test')) runSelfTest();
  else runCatalogue();
}
