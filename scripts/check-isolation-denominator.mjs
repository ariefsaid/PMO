#!/usr/bin/env node
/**
 * check-isolation-denominator — standing enumeration guard for the cross-org isolation probe (#612 item 1).
 *
 * `scripts/isolation-probe.sh` (#490) is the adversarial cross-org proof that runs against the hosted
 * project after every prod push. Its DENOMINATOR — which tables, SECURITY DEFINER functions, edge
 * functions and storage buckets it probes — used to be built ad hoc at run time, so a new `org_id`
 * table, definer function, edge function or bucket silently grew the attack surface while the
 * probe's "0 leaks" reported on a shrinking share of it.
 *
 * This guard makes the denominator a checked-in, self-cleaning contract
 * (`scripts/isolation-probe-denominator.json`) and fails the build in BOTH directions:
 *   • an actual table/definer/edge-function/bucket absent from the manifest is an UNLISTED surface;
 *   • a manifest entry absent from the real surface is STALE (the `check-e2e-skips.mjs` rule: a stale
 *     allowlist entry is itself a defect).
 *
 * Run with `--self-test` to prove it can redden on both. Same shape as check-promote-stamp.mjs /
 * check-e2e-skips.mjs.
 *
 * Usage:  node scripts/check-isolation-denominator.mjs
 *         node scripts/check-isolation-denominator.mjs --self-test
 *         node scripts/check-isolation-denominator.mjs --denominator <path>   (self-test internal)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DENOMINATOR_PATH = path.join(ROOT, 'scripts', 'isolation-probe-denominator.json');
export const FUNCTIONS_ROOT = path.join(ROOT, 'supabase', 'functions');
const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// ⚑ Non-shell-interpolated psql: bare `psql` on PATH (CI), `-v ON_ERROR_STOP=1` so a query error
// fails closed rather than emitting a partial catalog that compares "clean".
const TABLES_SQL = `
  SELECT json_build_object(
    'table', c.relname,
    'has_org', EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.oid AND a.attname = 'org_id'
        AND a.attnum > 0 AND NOT a.attisdropped
    ),
    'pk', (
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = c.oid AND i.indisprimary
      ORDER BY a.attnum
      LIMIT 1
    )
  )::text
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  ORDER BY c.relname;`;

const DEFINERS_SQL = `
  SELECT p.oid::regprocedure::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND p.prorettype <> 'trigger'::regtype
  ORDER BY p.oid::regprocedure::text;`;

const BUCKETS_SQL = `SELECT id FROM storage.buckets ORDER BY id;`;

// ⚑ Composite (multi-column) primary keys are kept, not rejected: the plan's own `pk` subquery uses
// `ORDER BY a.attnum LIMIT 1`, which yields the first key column, and that is exactly how the probe
// targets those tables today (they are in the 83-table denominator). The issue requires every public
// table enumerated, so a composite key is a valid single-column `pk`, not a blocker.

const CATEGORIES = ['tables', 'definer_functions', 'edge_functions', 'buckets'];

function parseLines(out) {
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * One-line, paste-ready rendering of a single denominator entry, in the EXACT form the manifest
 * stores it — so an `add to <category>` / `remove from <category>` line is a valid manifest line.
 * Tables render as the `{table, has_org, pk}` object; every other category is a JSON-encoded string.
 */
export function formatEntry(category, entry) {
  if (category === 'tables') return JSON.stringify({ table: entry.table, has_org: entry.has_org, pk: entry.pk });
  return JSON.stringify(entry);
}

function canonicalTable(t) {
  return `${t.table}\u0000${t.has_org}\u0000${t.pk}`;
}

/** Whether a same-named table tuple in `other` carries the same has_org/pk classification. */
function tupleOf(list, table) {
  return list.find((t) => t.table === table);
}

/**
 * Pure comparator — no fs, no psql, no disk. Returns structured findings:
 *   { kind: 'missing', category, entry, addLine }  (surfaces absent from the manifest)
 *   { kind: 'stale',   category, entry }           (manifest entries no longer real)
 */
export function compareDenominators(actual, recorded) {
  const findings = [];

  for (const category of ['definer_functions', 'edge_functions', 'buckets']) {
    const a = new Set(actual[category] ?? []);
    const r = new Set(recorded[category] ?? []);
    for (const entry of a) if (!r.has(entry)) findings.push({ kind: 'missing', category, entry, addLine: formatEntry(category, entry) });
    for (const entry of r) if (!a.has(entry)) findings.push({ kind: 'stale', category, entry });
  }

  for (const t of actual.tables) {
    // Missing unless the exact {table, has_org, pk} tuple is recorded. A same-named table whose
    // classification drifted is therefore reported as unlisted (this tuple) AND stale (the old one).
    const rec = tupleOf(recorded.tables, t.table);
    if (!rec || canonicalTable(rec) !== canonicalTable(t)) {
      findings.push({ kind: 'missing', category: 'tables', entry: t, addLine: formatEntry('tables', t) });
    }
  }
  for (const t of recorded.tables) {
    const act = tupleOf(actual.tables, t.table);
    if (!act || canonicalTable(act) !== canonicalTable(t)) {
      findings.push({ kind: 'stale', category: 'tables', entry: t });
    }
  }

  return findings;
}

/** Validate a parsed manifest object; returns it normalized. Throws on an invalid shape/duplicate. */
export function validateDenominator(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`invalid denominator: expected an object with ${CATEGORIES.join(', ')} arrays`);
  }
  for (const cat of CATEGORIES) {
    if (!Array.isArray(parsed[cat])) throw new Error(`invalid denominator: "${cat}" must be an array`);
  }
  // The manifest carries EXACTLY the four enumerated categories — no other root key.
  const unexpected = Object.keys(parsed).filter((k) => !CATEGORIES.includes(k));
  if (unexpected.length) {
    throw new Error(`invalid denominator: unexpected root key(s) ${unexpected.join(', ')} — manifest holds only ${CATEGORIES.join(', ')}`);
  }
  const tableKeys = new Set();
  for (const t of parsed.tables) {
    if (!t || typeof t !== 'object' || typeof t.table !== 'string' || !t.table.trim()) {
      throw new Error('invalid denominator: each table needs a non-empty "table" string');
    }
    if (typeof t.has_org !== 'boolean') throw new Error(`invalid denominator: table ${t.table ?? '(unnamed)'} has_org must be a boolean`);
    if (typeof t.pk !== 'string' || !t.pk.trim()) throw new Error(`invalid denominator: table ${t.table} needs a non-empty "pk" string`);
    const key = canonicalTable(t);
    if (tableKeys.has(key)) throw new Error(`invalid denominator: duplicate table tuple ${formatEntry('tables', t)}`);
    tableKeys.add(key);
  }
  for (const cat of ['definer_functions', 'edge_functions', 'buckets']) {
    const seen = new Set();
    for (const entry of parsed[cat]) {
      if (typeof entry !== 'string' || !entry.trim()) throw new Error(`invalid denominator: "${cat}" entries must be non-empty strings`);
      if (seen.has(entry)) throw new Error(`invalid denominator: duplicate ${cat} entry ${entry}`);
      seen.add(entry);
    }
  }
  return parsed;
}

export function readDenominator(filePath) {
  return validateDenominator(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

/**
 * Read the live surface from the local catalog (psql) and the filesystem. Pure discovery — the
 * comparator stays separate so it is unit-tested without touching a database.
 */
export function readActualCatalog({
  databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  functionsRoot = FUNCTIONS_ROOT,
  execFile = execFileSync,
} = {}) {
  const run = (sql) => execFile('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' });

  const tables = parseLines(run(TABLES_SQL)).map((line) => {
    const raw = JSON.parse(line);
    return { table: String(raw.table), has_org: !!raw.has_org, pk: raw.pk == null ? null : String(raw.pk) };
  });

  const noPk = tables.filter((t) => !t.pk);
  if (noPk.length) {
    throw new Error(`table(s) have no primary key — make the probe's key strategy explicit: ${noPk.map((t) => t.table).join(', ')}`);
  }

  const definer_functions = parseLines(run(DEFINERS_SQL));
  const buckets = parseLines(run(BUCKETS_SQL));

  let edge_functions = [];
  if (!fs.existsSync(functionsRoot)) throw new Error(`edge functions root not found: ${functionsRoot}`);
  edge_functions = fs.readdirSync(functionsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== '_shared')
    .map((e) => e.name)
    .sort();

  return { tables, definer_functions, edge_functions, buckets };
}

/** Render the denominator object with stable category order, sorted arrays, one entry per line. */
export function formatDenominator(d) {
  const lines = ['{'];
  CATEGORIES.forEach((cat, i) => {
    const entries = cat === 'tables'
      ? d[cat].map((t) => formatEntry('tables', t)).sort()
      : d[cat].map((e) => JSON.stringify(e)).sort();
    lines.push(`  "${cat}": [`);
    entries.forEach((e, j) => lines.push(`    ${e}${j < entries.length - 1 ? ',' : ''}`));
    const isLast = i === CATEGORIES.length - 1;
    lines.push(`  ]${isLast ? '' : ','}`);
  });
  lines.push('}');
  return lines.join('\n');
}

/** Reads + compares a single denominator file against the live catalog. Returns exit code. */
export function runCli(denominatorPath) {
  let recorded;
  try {
    recorded = readDenominator(denominatorPath);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    return 1;
  }
  let actual;
  try {
    actual = readActualCatalog({});
  } catch (err) {
    console.error(`✗ ${err.message}`);
    return 1;
  }
  const findings = compareDenominators(actual, recorded);
  if (findings.length) {
    for (const f of findings) {
      const tag = f.kind === 'missing' ? 'MISSING' : 'STALE';
      console.error(`✗ ${tag} ${f.category}: ${formatEntry(f.category, f.entry)}`);
      if (f.kind === 'missing') console.error(`    add to ${f.category}: ${f.addLine}`);
      else console.error(`    remove from ${f.category}: ${formatEntry(f.category, f.entry)}`);
    }
    return 1;
  }
  console.log(`PASS isolation denominator: tables=${actual.tables.length} definers=${actual.definer_functions.length} edge_functions=${actual.edge_functions.length} buckets=${actual.buckets.length}`);
  return 0;
}

function selfTest() {
  const child = (args) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { encoding: 'utf8' });

  // Control: the shipped manifest must pass the live catalog before we trust the mutations.
  const control = child([]);
  if (control.status !== 0) {
    throw new Error('self-test: shipped manifest does not pass the live catalog — fix the baseline before self-testing');
  }

  // Extract the exact diagnostic lines (the `✗ …` and `add to / remove from …` lines) a child CLI
  // printed, so the self-test ECHOES what it caught rather than only summarising it.
  const diagnosticsOf = (res) =>
    (res.stderr ?? '').split('\n').filter((l) => /^\s*[✗→]|add to |remove from /.test(l));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-denom-self-test-'));
  try {
    const base = JSON.parse(fs.readFileSync(DENOMINATOR_PATH, 'utf8'));

    // Defect 1 — MISSING: remove an existing table from a copy of the manifest. The live catalog
    // still has it, so the guard must report it as unlisted surface.
    const missing = JSON.parse(JSON.stringify(base));
    const removed = missing.tables.pop();
    const missingPath = path.join(dir, 'missing.json');
    fs.writeFileSync(missingPath, JSON.stringify(missing));
    const m = child(['--denominator', missingPath]);
    if (m.status === 0 || !m.stderr.includes('MISSING') || !m.stderr.includes(removed.table)) {
      throw new Error(`self-test: missing-table defect NOT caught (status=${m.status})`);
    }
    console.log('✓ self-test caught MISSING surface (diagnostics echoed from the child CLI):');
    for (const line of diagnosticsOf(m)) console.log(`    ${line.trim()}`);

    // Defect 2 — STALE: add a fake definer function to a copy. It is not in the catalog, so the
    // guard must report it as a stale manifest entry.
    const stale = JSON.parse(JSON.stringify(base));
    const fake = 'public.__isolation_denominator_self_test__()';
    stale.definer_functions.push(fake);
    const stalePath = path.join(dir, 'stale.json');
    fs.writeFileSync(stalePath, JSON.stringify(stale));
    const s = child(['--denominator', stalePath]);
    if (s.status === 0 || !s.stderr.includes('STALE') || !s.stderr.includes(fake)) {
      throw new Error(`self-test: stale-definer defect NOT caught (status=${s.status})`);
    }
    console.log('✓ self-test caught STALE entry (diagnostics echoed from the child CLI):');
    for (const line of diagnosticsOf(s)) console.log(`    ${line.trim()}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('✓ self-test: both missing and stale defects were caught.');
  return 0;
}

const isRunAsMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isRunAsMain) {
  const args = process.argv.slice(2);
  if (args[0] === '--self-test') {
    if (args.length !== 1) { console.error('usage: check-isolation-denominator.mjs --self-test'); process.exit(2); }
    try { process.exit(selfTest()); } catch (err) { console.error(`✗ ${err.message}`); process.exit(1); }
  }
  if (args[0] === '--write') {
    // Regenerate the manifest from the live catalog — the fix path when the guard reports MISSING/STALE.
    if (args.length !== 1) { console.error('usage: check-isolation-denominator.mjs --write'); process.exit(2); }
    fs.writeFileSync(DENOMINATOR_PATH, `${formatDenominator(readActualCatalog({}))}\n`);
    console.log(`wrote ${path.relative(ROOT, DENOMINATOR_PATH)} from the live catalog — review the diff, then commit it with the surface it names`);
    process.exit(0);
  }
  if (args[0] === '--denominator') {
    if (args.length !== 2) { console.error('usage: check-isolation-denominator.mjs --denominator <path>'); process.exit(2); }
    process.exit(runCli(args[1]));
  }
  if (args.length !== 0) { console.error('usage: check-isolation-denominator.mjs [--self-test | --write | --denominator <path>]'); process.exit(2); }
  process.exit(runCli(DENOMINATOR_PATH));
}