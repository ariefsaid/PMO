#!/usr/bin/env node
// Guard: a database-access module must read and write through the GENERATED types (ADR-0003).
//
// ⛔ WHY THIS GATE EXISTS. `database.types.ts` is the source of row and argument types, so a renamed
// column or RPC argument is supposed to fail `tsc`. Two casts remove that property, silently:
//
//   `supabase as unknown as Loose`  — the whole client is untyped, so every read and write in the
//                                     file is unchecked.
//   `supabase.rpc('x' as never)`    — the call name is unchecked, so `{ p_amount }` may be renamed
//                                     to `{ p_amt }` and `tsc` stays green.
//
// The 15-Dec build round shipped 55 `as unknown as` and 24 `as never` casts across the DAL files it
// added: the DALs were written before the types were regenerated, and the casts were never removed
// afterwards. A builder could rename an RPC argument in the next migration and the screen would
// break at runtime for every user of that feature — found by the release e2e run, the most expensive
// CI job, or by a user. `check-shadow-types.mjs` covers the nullability of hand-written row types;
// it cannot see an untyped client.
//
// WHAT IS FLAGGED: `as unknown as` and `as never` in any non-test `.ts` under `src/lib/db/`
// (`database.types.ts` excluded). Comments are stripped first, so a note ABOUT a cast is fine.
//
// THE EXEMPTIONS, in three kinds, each with its own reason:
//   • PRE_GATE_DEBT     — files that already carried a cast before this gate landed. Grouped, one
//                         shared reason. Cleaning them is ordinary work, not this gate's job.
//   • BLOCKED_ON_TYPES  — a round file whose objects are NOT in `database.types.ts` yet. ⚑ STALENESS IS
//                         DERIVED: the gate works out which objects the file calls (`rpc`/`from`/
//                         `table`/`call` + a string literal) and which of those the generated types
//                         lack. The entry expires the moment the file uses no untyped object any
//                         more, i.e. the day the types are regenerated the cast has to go. No
//                         hand-kept list of names to drift.
//   • SHAPE_NOT_IN_TYPES— a checked object whose generated type cannot carry the real contract: an
//                         RPC declared `returns jsonb`, or a `numeric` argument that this module
//                         sends as exact decimal TEXT. `until` is a regex that must STILL match the
//                         generated file; when it stops, the entry is stale and someone must look.
//
// ⚠️ WHAT THIS GATE DOES NOT CATCH: a row shape asserted with a plain `as Foo` where the generated row
// agrees structurally, and an `any`-typed VALUE (not a cast) reaching the client. It stops the two
// shapes that switch the typechecker off; it is not a proof that every DAL is well typed.
//
// Run:  node scripts/check-typed-dals.mjs
//       node scripts/check-typed-dals.mjs --self-test
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

// ⚑ pathToFileURL, NOT a hand-built `file://` string: the hand-built form silently fails to match a
// path needing percent-encoding, so main() never runs and the gate reports success having scanned
// nothing (that bug shipped once, #399).
const isRunAsMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_DIR = 'pmo-portal/src/lib/db';
const TYPES_FILE = 'pmo-portal/src/lib/supabase/database.types.ts';

const CASTS = ['as unknown as', 'as never'];

/** Files that carried a cast before this gate landed. Ordinary debt, one shared reason. */
const PRE_GATE_DEBT = [
  'src/lib/db/adminUsers.ts', 'src/lib/db/agentAttachments.ts', 'src/lib/db/approvalRoutes.ts',
  'src/lib/db/attendance.ts', 'src/lib/db/budgets.ts', 'src/lib/db/comments.ts',
  'src/lib/db/companies.ts', 'src/lib/db/companyCollections.ts', 'src/lib/db/contacts.ts',
  'src/lib/db/crews.ts', 'src/lib/db/crmActivities.ts', 'src/lib/db/dailySiteReports.ts',
  'src/lib/db/dashboard.ts', 'src/lib/db/documentExpiry.ts', 'src/lib/db/documents.ts',
  'src/lib/db/equipment.ts', 'src/lib/db/equipmentAvailability.ts', 'src/lib/db/erpSnapshots.ts',
  'src/lib/db/expenseCapture.ts', 'src/lib/db/expenseClaims.ts', 'src/lib/db/imprest.ts',
  'src/lib/db/journals.ts', 'src/lib/db/managementPack.ts', 'src/lib/db/materialRequests.ts',
  'src/lib/db/meetings.ts', 'src/lib/db/odooLedger.ts', 'src/lib/db/opportunity.ts',
  'src/lib/db/orgPlan.ts', 'src/lib/db/orgs.ts', 'src/lib/db/people.ts',
  'src/lib/db/procurementCrud.ts', 'src/lib/db/procurementFiles.ts', 'src/lib/db/procurementImportSkip.ts',
  'src/lib/db/procurementLedger.ts', 'src/lib/db/procurementLifecycle.ts', 'src/lib/db/procurementPaymentCeiling.ts',
  'src/lib/db/procurementRecords.ts', 'src/lib/db/procurements.ts', 'src/lib/db/projectStageEntries.ts',
  'src/lib/db/projects.ts', 'src/lib/db/rateCatalogue.ts', 'src/lib/db/recordReferenceSearch.ts',
  'src/lib/db/revenue.ts', 'src/lib/db/spendApprovers.ts', 'src/lib/db/stockAllowances.ts',
  'src/lib/db/stockDocuments.ts', 'src/lib/db/stockMaster.ts', 'src/lib/db/stockReorder.ts',
  'src/lib/db/stockReports.ts', 'src/lib/db/stockSiteWork.ts', 'src/lib/db/subcontracts.ts',
  'src/lib/db/tasks.ts', 'src/lib/db/threeWayMatch.ts', 'src/lib/db/timeAndMaterials.ts',
  'src/lib/db/timesheetPush.ts', 'src/lib/db/timesheetTransition.ts', 'src/lib/db/timesheets.ts',
  'src/lib/db/vendorWithholdingSlips.ts', 'src/lib/db/workOrderCostMoney.ts', 'src/lib/db/workOrderCosts.ts',
  'src/lib/db/workOrderFinance.ts', 'src/lib/db/workOrders.ts',
];

/**
 * Round files whose objects are absent from `database.types.ts`. The gate derives WHICH objects, so
 * these carry no name list to drift; the entry expires when the file no longer touches an untyped one.
 * @type {Array<{file: string, reason: string}>}
 */
const BLOCKED_ON_TYPES = [
  { file: 'src/lib/db/clearance.ts', reason: 'Migrations 1235-1237 objects were never regenerated into the types.' },
  { file: 'src/lib/db/documentCategories.ts', reason: 'Migrations 1090-1093 objects were never regenerated into the types.' },
  { file: 'src/lib/db/dsrStockIssue.ts', reason: 'Migrations 1325/1333 objects were never regenerated into the types.' },
  { file: 'src/lib/db/emailNotifications.ts', reason: 'Migrations 1220-1223 objects were never regenerated into the types.' },
  { file: 'src/lib/db/equipmentVendorResponse.ts', reason: 'Migrations 1372-1374 objects were never regenerated into the types.' },
  { file: 'src/lib/db/hidePrices.ts', reason: 'Migrations 1215-1218 objects were never regenerated into the types.' },
  { file: 'src/lib/db/leave.ts', reason: 'Migrations 1240-1242 objects were never regenerated into the types.' },
  { file: 'src/lib/db/myHome.ts', reason: 'The home and seat-report RPCs were never regenerated into the types.' },
  { file: 'src/lib/db/paymentChannels.ts', reason: 'Migrations 1355/1356 objects were never regenerated into the types.' },
  { file: 'src/lib/db/phoneCheckIn.ts', reason: 'Migrations 1212 objects were never regenerated into the types.' },
  { file: 'src/lib/db/quantityChanges.ts', reason: 'Migrations 1176 objects were never regenerated into the types.' },
  { file: 'src/lib/db/safetyDays.ts', reason: 'Migrations 1410/1411 objects were never regenerated into the types.' },
  { file: 'src/lib/db/scheduledReports.ts', reason: 'The scheduled-report table and functions were never regenerated into the types.' },
  { file: 'src/lib/db/siteCheckpoints.ts', reason: 'Migrations 1385 objects were never regenerated into the types.' },
  { file: 'src/lib/db/stockReservations.ts', reason: 'Migration 1315 objects were never regenerated into the types.' },
  { file: 'src/lib/db/stockTransfers.ts', reason: 'The transfer tables and functions were never regenerated into the types.' },
  { file: 'src/lib/db/stockWorkOrderTransfer.ts', reason: 'The work-order transfer objects were never regenerated into the types.' },
  { file: 'src/lib/db/workOrderCandidates.ts', reason: 'Migrations 1405 objects were never regenerated into the types.' },
  { file: 'src/lib/db/workOrderDailyTarget.ts', reason: 'The daily-target objects were never regenerated into the types.' },
  { file: 'src/lib/db/workOrderMaterialProgress.ts', reason: 'The work-order stock settings table was never regenerated into the types.' },
  { file: 'src/lib/db/workOrderRevenuePlan.ts', reason: 'Migrations 1415 objects were never regenerated into the types.' },
];

/**
 * A checked object whose generated type cannot carry the real contract. `until` must still match the
 * generated file — when it stops matching, the exemption is stale and the cast has to go.
 * @type {Array<{file: string, reason: string, until: string}>}
 */
const SHAPE_NOT_IN_TYPES = [
  { file: 'src/lib/db/supplyRisk.ts', until: 'vendor_supply_risk_suggestion: \\{[\\s\\S]*?Returns: Json',
    reason: '`vendor_supply_risk_suggestion` is declared `returns jsonb`, so its shape is stated in the module, not by the compiler.' },
  { file: 'src/lib/db/thirdPartyInspections.ts', until: 'work_order_inspection_prerequisites: \\{[\\s\\S]*?Returns: Json',
    reason: '`work_order_inspection_prerequisites` is declared `returns jsonb`, so its shape is stated in the module, not by the compiler.' },
  { file: 'src/lib/db/subcontractCertificates.ts', until: 'bill_subcontract_certificate: \\{[\\s\\S]*?Returns: Json',
    reason: '`subcontract_certificate_view`/`bill_subcontract_certificate` are declared `returns jsonb`; their shapes are stated in the module.' },
  { file: 'src/lib/db/usageStandards.ts', until: 'cus_adjust_plan_line: \\{[\\s\\S]*?p_adjusted_qty: number',
    reason: 'A `numeric` argument goes on the wire as exact decimal TEXT (NFR-CUS-002), which the generated argument type (`number`) cannot state.' },
];

/** Strip comments so a note ABOUT a cast does not count as one. Strings are left alone. */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\w])\/\/[^\n]*/g, '$1');
}

/** Pure core: the casts in one file's text, as `line  snippet` records. */
export function findCasts(src) {
  const out = [];
  stripComments(src).split('\n').forEach((line, i) => {
    for (const c of CASTS) if (line.includes(c)) { out.push({ line: i + 1, snippet: line.trim() }); break; }
  });
  return out;
}

/** The public-schema object names `database.types.ts` knows, so a call target can be looked up. */
export function parseTypeNames(src) {
  const names = new Set();
  const pub = src.split('\n  public: {')[1];
  if (!pub) return names;
  for (const section of ['Tables', 'Views', 'Functions']) {
    const start = pub.indexOf(`\n    ${section}: {`);
    if (start < 0) continue;
    const body = pub.slice(start + 1).split('\n    }')[0];
    // ⚑ `\{` and not `\{$`: the generator writes short entries on ONE line
    // (`save_idle_cost_setting: { Args: …; Returns: … }`), and a line-end anchor silently skips them.
    for (const m of body.matchAll(/^ {6}(\w+): \{/gm)) names.add(m[1]);
  }
  return names;
}

/** Every database object a DB module calls: `rpc(…)`, `from(…)`, `table(…)`, `call(…)` + a string literal. */
export function parseCalledNames(src) {
  const names = new Set();
  const re = /(?:(?:\b(?:supabase|db|client)\s*\.\s*)?\b(?:rpc|from|table|call|callRpc|rpcCall)\s*\(\s*)'([a-z][a-z0-9_]{2,})'/g;
  for (const m of stripComments(src).matchAll(re)) names.add(m[1]);
  return names;
}

/** Split found casts and exemptions into what is new and what is stale. */
export function compare(found, texts, typeNames, exempt = {}) {
  const preGate = new Set(exempt.preGate ?? []);
  const blocked = new Map((exempt.blocked ?? []).map((b) => [b.file, b]));
  const shapes = new Map((exempt.shapes ?? []).map((s) => [s.file, s]));
  const known = (file) => preGate.has(file) || blocked.has(file) || shapes.has(file);
  const fresh = found.filter((f) => !known(f.file));
  const hit = new Set(found.map((f) => f.file));

  const stale = [];
  for (const f of preGate) if (!hit.has(f)) stale.push(`${f} (no cast left — delete the exemption)`);
  for (const [file, b] of blocked) {
    if (!hit.has(file)) stale.push(`${file} (no cast left — delete the exemption)`);
    else {
      const untyped = [...parseCalledNames(texts.get(file) ?? '')].filter((n) => !typeNames.has(n));
      if (untyped.length === 0) stale.push(`${file} (${b.reason} but every object it calls is generated now — drop the cast)`);
    }
  }
  for (const [file, s] of shapes) {
    if (!hit.has(file)) stale.push(`${file} (no cast left — delete the exemption)`);
    else if (!new RegExp(s.until).test(exempt.typesText ?? '')) stale.push(`${file} (the generated contract changed; ${s.reason})`);
  }
  return { fresh, stale };
}

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p, acc); }
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && e.name !== 'database.types.ts') acc.push(p);
  }
  return acc;
}

function main() {
  const typesText = readFileSync(resolve(REPO, TYPES_FILE), 'utf8');
  const typeNames = parseTypeNames(typesText);
  if (typeNames.size === 0) {
    console.error('check-typed-dals: parsed ZERO names out of database.types.ts — the generated format changed and this gate is blind.');
    process.exit(1);
  }
  const found = [];
  const texts = new Map();
  for (const abs of walk(resolve(REPO, DB_DIR))) {
    // Key = `src/lib/db/<name>`, the form the exemptions use, so a lookup can never miss on a prefix.
    const file = relative(resolve(REPO, 'pmo-portal'), abs);
    const text = readFileSync(abs, 'utf8');
    texts.set(file, text);
    for (const c of findCasts(text)) found.push({ file, ...c });
  }
  const { fresh, stale } = compare(found, texts, typeNames, {
    preGate: PRE_GATE_DEBT, blocked: BLOCKED_ON_TYPES, shapes: SHAPE_NOT_IN_TYPES, typesText,
  });
  for (const f of fresh) {
    console.error(`UNTYPED DB ACCESS: ${f.file}:${f.line}\n  ${f.snippet}\n  call the generated type instead: drop the cast, or regenerate database.types.ts.`);
  }
  for (const s of stale) console.error(`STALE EXEMPTION: ${s}`);
  if (fresh.length || stale.length) {
    console.error(`\ncheck-typed-dals: ${fresh.length} new cast(s), ${stale.length} stale exemption(s).`);
    process.exit(1);
  }
  const exempted = PRE_GATE_DEBT.length + BLOCKED_ON_TYPES.length + SHAPE_NOT_IN_TYPES.length;
  console.log(`✓ src/lib/db reads and writes through the generated types (${typeNames.size} generated objects, 0 unexcused casts, ${exempted} documented exemption(s))`);
}

if (isRunAsMain && process.argv.includes('--self-test')) {
  const fails = [];
  const t = (name, cond) => { if (!cond) fails.push(name); };
  const src = [
    'const db = supabase as unknown as Loose;',
    "const x = await supabase.rpc('thing' as never);",
    '// the table is not in the types yet: supabase.from(t as never)',
    '/* supabase as unknown as Loose — see the note */',
    "const ok = await supabase.from('companies').select('id');",
  ].join('\n');
  const casts = findCasts(src);
  t('catches a Loose client cast', casts.length === 2);
  t('ignores a cast in a line comment', !casts.some((c) => c.line === 3));
  t('ignores a cast in a block comment', !casts.some((c) => c.line === 4));
  t('ignores a typed call', !casts.some((c) => c.line === 5));

  const types = parseTypeNames([
    'export type Database = {',
    '  public: {',
    '    Tables: {',
    '      companies: {',
    '        Row: { id: string }',
    '      }',
    '    }',
    '    Views: {',
    '      [_ in never]: never',
    '    }',
    '    Functions: {',
    '      get_thing: {',
    '        Args: { p_id: string }',
    '      }',
    '      one_liner: { Args: { p: string }; Returns: undefined }',
    '    }',
    '    Enums: {',
    '      [_ in never]: never',
    '    }',
    '  }',
    '}',
  ].join('\n'));
  t('parses a table name', types.has('companies'));
  t('parses a multi-line function name', types.has('get_thing'));
  t('parses a ONE-LINE function name', types.has('one_liner'));
  t('does not invent names', types.size === 3);

  const called = parseCalledNames("await supabase.rpc('leave_request_submit', {}); await from('leave_types'); const t = table('x1'); await call('person_clearance_items');");
  t('reads the call target of each helper', ['leave_request_submit', 'leave_types', 'person_clearance_items'].every((n) => called.has(n)));

  const at = (file) => [{ file, line: 1, snippet: 'supabase as unknown as Loose' }];
  const untyped = 'await supabase.rpc(\'missing_thing\');';
  const typed = "await supabase.from('companies');";
  const c1 = compare(at('a.ts'), new Map(), types);
  t('a new cast is fresh', c1.fresh.length === 1 && c1.stale.length === 0);
  const c2 = compare(at('a.ts'), new Map(), types, { preGate: ['a.ts'] });
  t('an exempt pre-gate file is not fresh', c2.fresh.length === 0 && c2.stale.length === 0);
  const c3 = compare([], new Map(), types, { preGate: ['a.ts'] });
  t('a pre-gate exemption with no cast left is stale', c3.stale.length === 1);
  const blocked = [{ file: 'b.ts', reason: 'not generated yet' }];
  const c4 = compare(at('b.ts'), new Map([['b.ts', untyped]]), types, { blocked });
  t('a blocked file that still calls an untyped object is not stale', c4.fresh.length === 0 && c4.stale.length === 0);
  const c5 = compare(at('b.ts'), new Map([['b.ts', typed]]), types, { blocked });
  t('a blocked file whose objects are all generated IS stale', c5.stale.length === 1);
  const shapes = [{ file: 'c.ts', reason: 'jsonb', until: 'one_liner: \\{[\\s\\S]*?Args' }];
  const c6 = compare(at('c.ts'), new Map([['c.ts', typed]]), types, { shapes, typesText: 'one_liner: { Args: { p: string }; Returns: undefined }' });
  t('a shape exemption whose regex still matches is not stale', c6.fresh.length === 0 && c6.stale.length === 0);
  const c7 = compare(at('c.ts'), new Map([['c.ts', typed]]), types, { shapes, typesText: 'one_liner: { Args: { p: string }; Returns: undefined } }'.replace('Args', 'XX') });
  t('a shape exemption whose regex stopped matching IS stale', c7.stale.length === 1);

  if (fails.length) {
    console.error('check-typed-dals self-test FAILED:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log('✓ check-typed-dals self-test passed');
}

if (isRunAsMain && !process.argv.includes('--self-test')) main();
