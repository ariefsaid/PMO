#!/usr/bin/env node
// check-shadow-types.mjs — a hand-written row type must not silently SHADOW the generated schema.
//
// ⛔ WHY THIS GATE EXISTS. Twice in two days a migration was invisible to the typechecker because a
// hand-rolled interface declared the same columns with the wrong nullability:
//
//   • `SalesInvoiceRow` (src/lib/db/revenue.ts) never declared `currency`. `select('*')` had been
//     returning the column all along — every caller was blind to it (#529).
//   • `useMyTasks`'s own `project_id: string`. Making `tasks.project_id` NULLABLE produced ZERO type
//     errors, so the "regen first and the typechecker enumerates every site" argument enumerated
//     nothing (#525).
//
// ADR-0003 says row types come from `database.types.ts` and "typecheck fails on drift". A shadow is
// exactly the case where it does not. This restores that property as a CI failure rather than a
// habit — a one-time cleanup fixes today's list and nothing about the next migration.
//
// ⚠️ WHAT THIS GATE DOES **NOT** CATCH, stated so nobody trusts it further than it goes. It compares
// the NULLABILITY of columns a local type DECLARES. It cannot flag a column the local type simply
// OMITS — which is the #529 shape: `SalesInvoiceRow` never mentioned `currency` at all. Omission is
// indistinguishable from an ordinary subset, and most row types are subsets on purpose, so there is
// no generic rule to apply. Verified by replay: the #525 incident reddens this gate, the #529 one
// does not. Half the class, mechanically, beats all of it by habit — but only if the half is known.
//
// WHAT IS FLAGGED: a hand-written interface / type alias / inline literal whose keys are ALL columns
// of one table (≥3 of them, ≥2 snake_case, so `{id,name,status}` on a view model does not trip it),
// where the generated column is NULLABLE and the local one is not. Narrower-than-generated in the
// other direction is fine — that is an ordinary narrowing.
//
// Usage:  node scripts/check-shadow-types.mjs
//         node scripts/check-shadow-types.mjs --self-test
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ⚑ pathToFileURL, NOT `file://${process.argv[1]}` — the hand-built form silently fails to match a
// path needing percent-encoding, so main() never runs and the gate reports success having scanned
// nothing. That bug shipped once already (#399).
const isRunAsMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'pmo-portal');

/**
 * Shadows that exist today and are NOT going to be fixed by this gate landing. Each needs a reason.
 * ⚑ A STALE entry — one that no longer matches anything — is itself a failure, so the list cannot
 * quietly become "everything". Same rule as check-e2e-skips.
 * @type {Array<{file: string, name: string, reason: string}>}
 */
const ALLOW = [
  // ── Deliberate narrowings at a WRITE boundary. The DAL requires a value the column permits to be
  //    NULL, which is a product rule, not drift. They still shadow, so they are listed rather than
  //    invisible.
  { file: 'src/lib/db/tasks.ts', name: 'TaskInput',
    reason: 'FR-FCT-045 (#525): creating a task deliberately still requires a project, though the column is now nullable.' },
  { file: 'src/lib/db/incidents.ts', name: 'IncidentInput',
    reason: 'Raising an incident requires a location and a description; the columns are nullable for legacy rows.' },

  // ── FORM-STATE shapes. A controlled input holds '' for "empty", never null, so non-null here is
  //    the correct type for the STATE — it is converted at submit. ⚑ Written as plain interfaces
  //    they are indistinguishable from an accidental shadow; deriving them
  //    (`Omit<Tables<'x'>, …>`) would let this gate tell the two apart, which is the real fix.
  { file: 'components/IncidentFormModal.tsx', name: 'FormValues', reason: "form state: '' for empty, converted at submit." },
  { file: 'pages/Contacts.tsx', name: 'FormValues', reason: "form state: '' for empty, converted at submit." },
  { file: 'pages/ContactDetail.tsx', name: 'FormValues', reason: "form state: '' for empty, converted at submit." },
  { file: 'pages/project-detail/MilestoneFormModal.tsx', name: 'FormValues', reason: "form state: '' for empty, converted at submit." },
  { file: 'pages/project-detail/tabs/TasksTab.tsx', name: 'FormValues', reason: "form state: '' for empty, converted at submit." },

  // ── Not a row read at all: the shape of an inbound ClickUp webhook, which happens to share column
  //    names with the table it lands in. The payload's fields are required BY CLICKUP.
  { file: 'src/lib/adapterSeam/clickup/types.ts', name: 'ClickUpWebhookPayload',
    reason: 'inbound webhook contract, not a row read — the fields are required by the sender.' },

  // ── ClickUp's own WIRE FORMAT, which shares column names with the table it maps into but is not a
  //    row read: `start_date` is epoch milliseconds and `priority` is ClickUp's numeric scale, so
  //    the "drift" is a type difference the mapper exists to bridge. Flagged only because the
  //    majority-match rule (correctly) stopped requiring an exact column set.
  { file: 'src/lib/adapterSeam/clickup/mapping.ts', name: 'ClickUpScalarFields',
    reason: "ClickUp wire format, not a row read: start_date is epoch ms, priority is ClickUp's numeric scale." },
  { file: 'src/lib/adapterSeam/clickup/types.ts', name: 'ClickUpCreateTaskBody',
    reason: 'ClickUp request body, not a row read — same wire-format difference as ClickUpScalarFields.' },
  { file: 'src/lib/adapterSeam/clickup/types.ts', name: 'ClickUpUpdateTaskBody',
    reason: 'ClickUp request body, not a row read — same wire-format difference as ClickUpScalarFields.' },

  // ── ⚠️ A test fixture that CANNOT REPRESENT NULL, which means no test in that file ever exercises
  //    the nullable branch. Listed as a known blind spot rather than a narrowing.
  { file: 'src/lib/db/documents.storage.test.ts', name: 'MockDocRow',
    reason: 'fixture cannot express NULL, so the null branch is untested there. Known blind spot, not drift.' },
];

/** Parse `Row:` blocks out of the generated types → table → Map(column → type text). */
export function parseGeneratedRows(src) {
  const lines = src.split('\n');
  const tables = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^ {6}(\w+): \{$/);
    if (!m || !/^ {8}Row: \{$/.test(lines[i + 1] ?? '')) continue;
    const cols = new Map();
    let j = i + 2;
    for (; j < lines.length && !/^ {8}\}$/.test(lines[j]); j++) {
      const c = lines[j].match(/^ {10}(\w+)\??: (.+)$/);
      if (c) cols.set(c[1], c[2].trim());
    }
    tables.set(m[1], cols);
    i = j;
  }
  return tables;
}

/** Pure core, so the self-test exercises the real logic without touching disk. */
export function findShadows(fileText, tables, file = '(memory)') {
  const L = fileText.split('\n');
  const out = [];
  for (let k = 0; k < L.length; k++) {
    // ⚑ DECLARATIONS ONLY — `interface X {` and `type X = {`. An earlier draft also matched inline
    // object literals (`: {`, `as unknown as {`), which made it flag test FIXTURES: the "type" it
    // read was a VALUE (`code: 'DWG-009',`), so every optional column in a mock looked like drift.
    // A gate that cries wolf gets disabled, and the two incidents this exists to prevent were both
    // named interfaces — so precision is worth more than recall here.
    const start = L[k].match(/(?:interface\s+(\w+)[^{]*|type\s+(\w+)\s*=\s*)\{\s*$/);
    if (!start) continue;
    const name = start[1] || start[2];
    const indent = L[k].search(/\S/);
    const keys = [], types = [];
    let k2 = k + 1, closed = false;
    for (; k2 < L.length && k2 < k + 80; k2++) {
      if (L[k2].search(/\S/) <= indent && /^\s*\}/.test(L[k2])) { closed = true; break; }
      const kv = L[k2].match(/^\s*(\w+)\??\s*:\s*(.+?);?\s*$/);
      if (kv) { keys.push(kv[1]); types.push(kv[2].replace(/;$/, '')); }
    }
    if (!closed || keys.length < 3) continue;
    if (keys.filter((x) => x.includes('_')).length < 2) continue;

    // ⚑ A MAJORITY of keys, not ALL of them — and this is the correction that makes the gate work
    // at all. The first draft required every key to be a column of one table, so it caught NEITHER
    // incident it was written for: `MyTask` carries a joined `project_name`, `SalesInvoiceRow`
    // carries joined payment terms, and one foreign key is enough to match no table. A gate that
    // cannot fail for its own motivating cases is worse than no gate — the exact class it exists to
    // stop. Verified by replaying both incidents against it.
    let best = null;
    for (const [t, cols] of tables) {
      const hit = keys.filter((x) => cols.has(x)).length;
      if (hit >= 3 && hit / keys.length >= 0.6) {
        const score = hit + (cols.size === hit ? 1 : 0);
        if (!best || score > best.score) best = { table: t, cols, score };
      }
    }
    if (!best) continue;

    const drift = [];
    keys.forEach((key, idx) => {
      if (!best.cols.has(key)) return;   // a joined field has no generated counterpart
      const generated = best.cols.get(key) ?? '';
      const localAllowsNull = /null|undefined/.test(types[idx]);
      if (generated.includes('null') && !localAllowsNull) {
        drift.push(`${key}: local \`${types[idx]}\` vs generated \`${generated}\``);
      }
    });
    if (drift.length) out.push({ file, line: k + 1, name, table: best.table, drift });
    k = k2;
  }
  return out;
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', 'coverage', 'playwright-report'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(e.name) && !p.endsWith('database.types.ts')) acc.push(p);
  }
  return acc;
}

function main() {
  const tables = parseGeneratedRows(
    fs.readFileSync(path.join(ROOT, 'src/lib/supabase/database.types.ts'), 'utf8'),
  );
  if (tables.size === 0) {
    console.error('check-shadow-types: parsed ZERO tables — the generated-types format changed and this gate is now blind.');
    process.exit(1);
  }
  const found = [];
  for (const f of walk(ROOT)) {
    found.push(...findShadows(fs.readFileSync(f, 'utf8'), tables, path.relative(ROOT, f)));
  }
  const allowed = new Set(ALLOW.map((a) => `${a.file}::${a.name}`));
  const hit = new Set();
  const offenders = found.filter((x) => {
    const key = `${x.file}::${x.name}`;
    if (allowed.has(key)) { hit.add(key); return false; }
    return true;
  });
  // A stale allowlist entry is a failure: it means the shadow is gone and the exemption is lying.
  const stale = [...allowed].filter((k) => !hit.has(k));

  for (const o of offenders) {
    console.error(`✗ ${o.file}:${o.line}  ${o.name} shadows Tables<'${o.table}'>`);
    for (const d of o.drift) console.error(`    ${d}`);
  }
  for (const s of stale) console.error(`✗ stale allowlist entry (no such shadow any more): ${s}`);
  if (offenders.length || stale.length) {
    console.error(
      `\ncheck-shadow-types: ${offenders.length} shadow(s) with nullability drift, ${stale.length} stale exemption(s).\n` +
      'A hand-written row type that disagrees with the schema hides the NEXT migration from the\n' +
      "typechecker. Derive it (`Tables<'x'>` / `Omit<Tables<'x'>, …>`), or fix the nullability, or\n" +
      'add it to ALLOW with a reason if the narrowing is deliberate.',
    );
    process.exit(1);
  }
  console.log(`✓ no hand-written row type shadows the schema (${tables.size} tables scanned, ${ALLOW.length} documented exemption(s))`);
}

if (isRunAsMain && process.argv[2] === '--self-test') {
  const tables = new Map([['tasks', new Map([
    ['id', 'string'], ['project_id', 'string | null'], ['org_id', 'string'], ['name', 'string'],
  ])]]);
  const drifting = 'interface X {\n  id: string;\n  project_id: string;\n  org_id: string;\n}\n';
  const honest   = 'interface Y {\n  id: string;\n  project_id: string | null;\n  org_id: string;\n}\n';
  const unrelated = 'interface Z {\n  a_b: string;\n  c_d: string;\n  e_f: string;\n}\n';
  // ⚑ THE REGRESSION CASE: a row shape PLUS a joined field — the shape both real incidents had, and
  // the one the first draft silently missed. If this ever returns 0 the gate is blind again.
  const joined = 'interface J {\n  id: string;\n  project_id: string;\n  org_id: string;\n  project_name: string;\n}\n';
  const a = findShadows(drifting, tables);
  const b = findShadows(honest, tables);
  const c = findShadows(unrelated, tables);
  const d = findShadows(joined, tables);
  const ok = a.length === 1 && a[0].drift.length === 1 && b.length === 0 && c.length === 0 && d.length === 1;
  console.log(ok ? '✓ check-shadow-types self-test passed' : '✗ check-shadow-types self-test FAILED');
  console.log(`  drifting→${a.length} (want 1) · honest→${b.length} (want 0) · unrelated→${c.length} (want 0) · joined→${d.length} (want 1)`);
  process.exit(ok ? 0 : 1);
}
if (isRunAsMain) main();
