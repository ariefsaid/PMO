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
// THE EXEMPTIONS, in two kinds, each with its own reason:
//   • PRE_GATE_DEBT     — files that already carried a cast before this gate landed. Grouped, one
//                         shared reason. Cleaning them is ordinary work, not this gate's job.
//   • SHAPE_NOT_IN_TYPES— a checked object whose generated type cannot carry the real contract: an
//                         RPC declared `returns jsonb`, or a `numeric` argument that this module
//                         sends as exact decimal TEXT. `until` is a regex that must STILL match the
//                         generated file; when it stops, the entry is stale and someone must look.
//
// ⚑ THERE IS NO "the types are stale" EXEMPTION, on purpose. A file whose objects are missing from
// `database.types.ts` is why this gate exists: regenerate the types. The 21 round files that once
// carried such an entry are on the generated types now (ARCH-C6).
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
  'src/lib/db/crews.ts', 'src/lib/db/crmActivities.ts',
  'src/lib/db/dashboard.ts', 'src/lib/db/documentExpiry.ts', 'src/lib/db/documents.ts',
  'src/lib/db/equipment.ts', 'src/lib/db/equipmentAvailability.ts', 'src/lib/db/erpSnapshots.ts',
  'src/lib/db/expenseCapture.ts', 'src/lib/db/expenseClaims.ts', 'src/lib/db/imprest.ts',
  'src/lib/db/journals.ts', 'src/lib/db/managementPack.ts', 'src/lib/db/materialRequests.ts',
  'src/lib/db/meetings.ts', 'src/lib/db/opportunity.ts',
  'src/lib/db/orgPlan.ts', 'src/lib/db/orgs.ts', 'src/lib/db/people.ts',
  'src/lib/db/procurementCrud.ts', 'src/lib/db/procurementFiles.ts', 'src/lib/db/procurementImportSkip.ts',
  'src/lib/db/procurementLedger.ts', 'src/lib/db/procurementLifecycle.ts', 'src/lib/db/procurementPaymentCeiling.ts',
  'src/lib/db/procurementRecords.ts', 'src/lib/db/procurements.ts', 'src/lib/db/projectStageEntries.ts',
  'src/lib/db/projects.ts',
  'src/lib/db/revenue.ts', 'src/lib/db/spendApprovers.ts', 'src/lib/db/stockAllowances.ts',
  'src/lib/db/stockDocuments.ts', 'src/lib/db/stockMaster.ts', 'src/lib/db/stockReorder.ts',
  'src/lib/db/subcontracts.ts',
  'src/lib/db/tasks.ts', 'src/lib/db/threeWayMatch.ts', 'src/lib/db/timeAndMaterials.ts',
  'src/lib/db/timesheetPush.ts', 'src/lib/db/timesheetTransition.ts', 'src/lib/db/timesheets.ts',
  'src/lib/db/vendorWithholdingSlips.ts', 'src/lib/db/workOrderCostMoney.ts', 'src/lib/db/workOrderCosts.ts',
  'src/lib/db/workOrderFinance.ts', 'src/lib/db/workOrders.ts',
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
  { file: 'src/lib/db/dsrStockIssue.ts', until: 'dsr_stock_status: \\{ Args: \\{ p_report: string \\}; Returns: Json',
    reason: '`dsr_stock_status` is declared `returns jsonb`, so its lines and decimal-string quantities are stated in the module.' },
  { file: 'src/lib/db/myHome.ts', until: 'my_home: \\{ Args: never; Returns: Json',
    reason: '`my_home` and `org_seat_report` are declared `returns jsonb`, so their shapes are stated in the module.' },
  { file: 'src/lib/db/phoneCheckIn.ts', until: 'phone_check_in: \\{[\\s\\S]*?Returns: Json',
    reason: '`phone_check_in` is declared `returns jsonb`, so its status/outcome shape is stated in the module.' },
  { file: 'src/lib/db/quantityChanges.ts', until: 'record_quantity_forecast: \\{[\\s\\S]*?p_quantity: number',
    reason: 'A `numeric` quantity goes on the wire as exact decimal TEXT, which the generated argument type (`number`) cannot state.' },
  { file: 'src/lib/db/safetyDays.ts', until: 'work_order_roster: \\{[\\s\\S]*?members: Json',
    reason: '`work_order_roster.members` and `get_safety_summary_detail` are declared `jsonb`, so their shapes are stated in the module.' },
  { file: 'src/lib/db/stockReservations.ts', until: 'reserve_stock: \\{[\\s\\S]*?p_quantity: number',
    reason: 'A `numeric` quantity goes on the wire as exact decimal TEXT (NFR-STK-007), and `get_stock_free_reserved` is `returns jsonb`; the generated types can state neither.' },
  { file: 'src/lib/db/stockWorkOrderTransfer.ts', until: 'get_work_order_returnable: \\{[\\s\\S]*?Returns: Json',
    reason: '`get_work_order_returnable` is declared `returns jsonb`, so its decimal-string lines are stated in the module.' },
  { file: 'src/lib/db/workOrderRevenuePlan.ts', until: 'wo_revenue_plan_set_day: \\{[\\s\\S]*?p_amount: number',
    reason: 'A `numeric` plan amount goes on the wire as exact decimal TEXT, which the generated argument type (`number`) cannot state.' },
  { file: 'src/lib/db/workOrderLists.ts', until: 'set_boq_item_area_rate: \\{[\\s\\S]*?p_area: string; p_boq_item: string; p_rate\\?: number',
    reason: 'An area rate numeric argument goes on the wire as exact decimal TEXT to preserve all eight fractional places and large integer values.' },
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

/** The public-schema object names `database.types.ts` knows. The gate refuses to run on zero. */
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

/** Split found casts and exemptions into what is new and what is stale. */
export function compare(found, exempt = {}) {
  const preGate = new Set(exempt.preGate ?? []);
  const shapes = new Map((exempt.shapes ?? []).map((s) => [s.file, s]));
  const fresh = found.filter((f) => !preGate.has(f.file) && !shapes.has(f.file));
  const hit = new Set(found.map((f) => f.file));

  const stale = [];
  for (const f of preGate) if (!hit.has(f)) stale.push(`${f} (no cast left — delete the exemption)`);
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
  for (const abs of walk(resolve(REPO, DB_DIR))) {
    // Key = `src/lib/db/<name>`, the form the exemptions use, so a lookup can never miss on a prefix.
    const file = relative(resolve(REPO, 'pmo-portal'), abs);
    for (const c of findCasts(readFileSync(abs, 'utf8'))) found.push({ file, ...c });
  }
  const { fresh, stale } = compare(found, {
    preGate: PRE_GATE_DEBT, shapes: SHAPE_NOT_IN_TYPES, typesText,
  });
  for (const f of fresh) {
    console.error(`UNTYPED DB ACCESS: ${f.file}:${f.line}\n  ${f.snippet}\n  call the generated type instead: drop the cast, or regenerate database.types.ts.`);
  }
  for (const s of stale) console.error(`STALE EXEMPTION: ${s}`);
  if (fresh.length || stale.length) {
    console.error(`\ncheck-typed-dals: ${fresh.length} new cast(s), ${stale.length} stale exemption(s).`);
    process.exit(1);
  }
  const exempted = PRE_GATE_DEBT.length + SHAPE_NOT_IN_TYPES.length;
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

  const at = (file) => [{ file, line: 1, snippet: 'supabase as unknown as Loose' }];
  const c1 = compare(at('a.ts'));
  t('a new cast is fresh', c1.fresh.length === 1 && c1.stale.length === 0);
  const c2 = compare(at('a.ts'), { preGate: ['a.ts'] });
  t('an exempt pre-gate file is not fresh', c2.fresh.length === 0 && c2.stale.length === 0);
  const c3 = compare([], { preGate: ['a.ts'] });
  t('a pre-gate exemption with no cast left is stale', c3.stale.length === 1);
  const shapes = [{ file: 'c.ts', reason: 'jsonb', until: 'one_liner: \\{[\\s\\S]*?Args' }];
  const c6 = compare(at('c.ts'), { shapes, typesText: 'one_liner: { Args: { p: string }; Returns: undefined }' });
  t('a shape exemption whose regex still matches is not stale', c6.fresh.length === 0 && c6.stale.length === 0);
  const c7 = compare(at('c.ts'), { shapes, typesText: 'one_liner: { Args: { p: string }; Returns: undefined } }'.replace('Args', 'XX') });
  t('a shape exemption whose regex stopped matching IS stale', c7.stale.length === 1);

  if (fails.length) {
    console.error('check-typed-dals self-test FAILED:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log('✓ check-typed-dals self-test passed');
}

if (isRunAsMain && !process.argv.includes('--self-test')) main();
