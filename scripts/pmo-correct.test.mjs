/**
 * pmo-correct.test.mjs — `pmo correct` (#1858). Run: node --test scripts/pmo-correct.test.mjs
 * A fake API (no HTTP, no DB). The database half is pgTAP: supabase/tests/0899_cli_guard_history_corrections.test.sql (AC-CLICOR-015).
 * Spec: docs/specs/cli-loader-corrections.spec.md
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { applyLoad, resolveLoad, validateLoadFile } from './lib/pmo-load.mjs';
import { encodeBudgetImportIdentity } from './lib/budget-import-identity.mjs';
import { CORRECTABLE, CORRECT_ADMIN_PATCH_TABLES, correct, parseSets, validateSets } from './lib/pmo-correct.mjs';

/** A PostgREST-ish fake: eq.<v> filters, PATCH by id, every request logged. Row-security hiding is `hidden`. */
function fakeApi(tables, { hidden = false } = {}) {
  const log = [];
  const match = (row, q) => [...q.entries()].every(([k, v]) => k === 'select' || k === 'order' || k === 'limit'
    || (v.startsWith('eq.') && String(row[k]) === v.slice(3))
    || (v.startsWith('not.is.null') && row[k] != null));
  return {
    log,
    tables,
    async get(table, q) {
      log.push({ method: 'GET', table, q: q.toString() });
      return (tables[table] ?? []).filter((r) => match(r, q)).map((r) => ({ ...r }));
    },
    // The default is the plain write header loadApi provides (scripts/pmo.mjs): a caller that adds no header of its
    // own keeps `return=representation` — what `pmo load` and the project correction have always sent. The wire
    // spelling itself is pinned by the e2e in pmo.test.mjs.
    async patch(table, q, body, headers = { prefer: 'return=representation' }) {
      log.push({ method: 'PATCH', table, q: q.toString(), body, headers });
      if (hidden) return [];
      const rows = (tables[table] ?? []).filter((r) => match(r, q));
      for (const r of rows) Object.assign(r, body);
      return rows.map((r) => ({ ...r }));
    },
    async rpc() { throw new Error('a correction never calls an RPC'); },
    async post() { throw new Error('a correction never inserts'); },
  };
}
const writes = (api) => api.log.filter((e) => e.method !== 'GET');

const CLIENT = { id: 'c-1', name: 'Client Legal A', type: 'Client', archived_at: null };
const PROJECT = (over = {}) => ({
  id: 'p-1', code: 'ORG-001', name: 'Plant upgrade', short_name: 'Plant', client_id: 'c-1', status: 'Ongoing Project',
  contract_value: 1000, currency: 'IDR', start_date: '2026-01-01', end_date: '2026-06-30', project_manager_id: null,
  service_line: null, sector: null, location: null, award_type: null, bidding_entity: null, ...over,
});
const LINE = (over = {}) => ({
  id: 'l-1', project_id: 'p-1', import_key: 'L-10', item_code: 'SVC-1', description: 'Pipe laying', unit: 'm',
  quantity: 10, rate: 100, earning_basis: 'unit_rate', line_no: 1, ...over,
});

test('AC-CLICOR-004: the correctable set is closed; stage, money, identity and archive fields are refused with a pointer', () => {
  assert.deepEqual(Object.keys(CORRECTABLE).sort(), ['budget-line', 'contract-line', 'project']);
  for (const field of ['contract_value', 'status', 'code', 'currency', 'archived_at', 'client_id', 'tax_amount']) {
    const { problems } = validateSets('project', { [field]: 'x' });
    assert.equal(problems.length, 1, field);
    assert.match(problems[0], new RegExp(`"${field}"`));
    assert.match(problems[0], /app|Project/);
  }
  for (const field of ['category', 'fiscal_year', 'actual_amount', 'import_key']) {
    assert.match(validateSets('budget-line', { [field]: '1' }).problems[0], /not correctable/);
  }
  for (const field of ['key', 'item_code', 'line_no']) {
    assert.match(validateSets('contract-line', { [field]: '1' }).problems[0], /not correctable/);
  }
});

test('parseSets: field=value, repeatable; a repeated field, a missing "=" and an empty value are usage errors', () => {
  assert.deepEqual(parseSets(['rate=1500.50', 'description=a=b']), { rate: '1500.50', description: 'a=b' });
  assert.throws(() => parseSets(['rate']), /field=value/);
  assert.throws(() => parseSets(['rate=1', 'rate=2']), /twice/);
  assert.throws(() => parseSets(['short_name=']), /clear/);
  assert.throws(() => parseSets([]), /--set/);
});

test('AC-CLICOR-005: every invalid value is listed, nothing is sent', async () => {
  const api = fakeApi({ projects: [PROJECT()], companies: [CLIENT] });
  const bad = validateSets('project', { end_date: '31/12/2026', start_date: '2026-02-30', project_manager_id: 'nope', name: '  ' });
  assert.equal(bad.problems.length, 4);
  const line = validateSets('contract-line', { rate: '1.234', quantity: '0', basis: 'weekly', unit: 'x'.repeat(41), description: '' });
  assert.equal(line.problems.length, 5);
  const budget = validateSets('budget-line', { budgeted_amount: '-1', description: 5 });
  assert.equal(budget.problems.length >= 1, true);
  await assert.rejects(correct('project', { code: 'ORG-001' }, { end_date: '31/12/2026' }, api, { dryRun: false }), (e) => e.exit === 2 && /end_date/.test(e.message + JSON.stringify(e.details)));
  assert.deepEqual(api.log, []);
});

test('AC-CLICOR-001/002: project dry run shows before → after and writes nothing; the real run sends one update by id with only that field', async () => {
  const api = fakeApi({ projects: [PROJECT()], companies: [CLIENT] });
  const dry = await correct('project', { code: 'ORG-001' }, { end_date: '2026-12-31' }, api, { dryRun: true });
  assert.equal(dry.dry_run, true);
  assert.deepEqual(dry.fields, [{ field: 'end_date', before: '2026-06-30', after: '2026-12-31', status: 'changed' }]);
  assert.deepEqual(writes(api), []);
  assert.equal(api.tables.projects[0].end_date, '2026-06-30');

  assert.match(dry.next, /Re-run without --dry-run/);
  const done = await correct('project', { code: 'ORG-001' }, { end_date: '2026-12-31' }, api, { dryRun: false });
  assert.equal(done.dry_run, false);
  assert.equal(done.id, 'p-1');
  assert.deepEqual(done.fields, dry.fields); // the preview shows exactly what the apply writes
  assert.equal(done.id, dry.id);
  assert.equal(done.next, undefined); // after a real apply there is nothing left to say
  assert.equal(writes(api).length, 1);
  assert.equal(writes(api)[0].table, 'projects');
  assert.equal(writes(api)[0].q, 'id=eq.p-1');
  assert.deepEqual(writes(api)[0].body, { end_date: '2026-12-31' });
  assert.deepEqual(writes(api)[0].headers, { prefer: 'return=representation' }, 'projects is not a gated table: the plain header, as before');
});

test('project is addressed by name + client when it has no code; two matches or none stop the command (AC-CLICOR-003)', async () => {
  const api = fakeApi({ projects: [PROJECT({ code: null })], companies: [CLIENT] });
  const ok = await correct('project', { name: 'Plant upgrade', client: 'Client Legal A' }, { short_name: 'PU' }, api, { dryRun: true });
  assert.equal(ok.id, 'p-1');

  const two = fakeApi({ projects: [PROJECT({ code: null }), PROJECT({ id: 'p-2', code: null })], companies: [CLIENT] });
  await assert.rejects(correct('project', { name: 'Plant upgrade', client: 'Client Legal A' }, { short_name: 'PU' }, two, { dryRun: false }), (e) => e.exit === 2 && /more than one/i.test(e.message));
  assert.deepEqual(writes(two), []);

  const none = fakeApi({ projects: [], companies: [CLIENT] });
  await assert.rejects(correct('project', { code: 'NOPE' }, { short_name: 'PU' }, none, { dryRun: false }), (e) => e.exit === 2 && /no project/i.test(e.message));
  const noClient = fakeApi({ projects: [PROJECT()], companies: [] });
  await assert.rejects(correct('project', { name: 'Plant upgrade', client: 'Ghost' }, { short_name: 'PU' }, noClient, { dryRun: false }), (e) => e.exit === 2 && /Ghost/.test(e.message));
});

test('AC-CLICOR-013: a value equal to the current one is "unchanged" and never sent', async () => {
  const api = fakeApi({ projects: [PROJECT()], companies: [CLIENT] });
  const r = await correct('project', { code: 'ORG-001' }, { end_date: '2026-06-30', short_name: 'Plant2' }, api, { dryRun: false });
  assert.deepEqual(r.fields.map((f) => [f.field, f.status]), [['end_date', 'unchanged'], ['short_name', 'changed']]);
  assert.deepEqual(writes(api)[0].body, { short_name: 'Plant2' });
  const same = fakeApi({ projects: [PROJECT()], companies: [CLIENT] });
  const none = await correct('project', { code: 'ORG-001' }, { end_date: '2026-06-30' }, same, { dryRun: false });
  assert.equal(none.applied, false);
  assert.deepEqual(writes(same), []);
});

test('AC-CLICOR-012: an update that changes no row fails no_rows (row security hid it)', async () => {
  const api = fakeApi({ projects: [PROJECT()], companies: [CLIENT] }, { hidden: true });
  await assert.rejects(correct('project', { code: 'ORG-001' }, { end_date: '2026-12-31' }, api, { dryRun: false }),
    (e) => e.code === 'no_rows' && e.exit !== 2);
});

test("the database's own refusal reaches the caller unchanged (AC-CLICOR-006 server half)", async () => {
  const api = fakeApi({ projects: [PROJECT()], companies: [CLIENT] });
  const refusal = Object.assign(new Error('new row violates row-level security policy'), { code: '42501' });
  api.patch = async () => { throw refusal; };
  await assert.rejects(correct('project', { code: 'ORG-001' }, { end_date: '2026-12-31' }, api, { dryRun: false }), (e) => e === refusal);
});

test('AC-CLICOR-007: contract line — one boq_items update by id; basis is sent as earning_basis; others untouched', async () => {
  const api = fakeApi({ projects: [PROJECT()], companies: [CLIENT], boq_items: [LINE()] });
  const dry = await correct('contract-line', { code: 'ORG-001', key: 'L-10' }, { rate: '1500.50', description: 'Pipe laying, DN200' }, api, { dryRun: true });
  assert.deepEqual(dry.fields, [
    { field: 'rate', before: 100, after: 1500.5, status: 'changed' },
    { field: 'description', before: 'Pipe laying', after: 'Pipe laying, DN200', status: 'changed' },
  ]);
  assert.deepEqual(writes(api), []);
  await correct('contract-line', { code: 'ORG-001', key: 'L-10' }, { rate: '1500.50', description: 'Pipe laying, DN200' }, api, { dryRun: false });
  assert.equal(writes(api).length, 1);
  assert.equal(writes(api)[0].table, 'boq_items');
  assert.equal(writes(api)[0].q, 'id=eq.l-1');
  assert.deepEqual(writes(api)[0].body, { rate: 1500.5, description: 'Pipe laying, DN200' });
  assert.deepEqual(writes(api)[0].headers, { prefer: 'return=representation,handling=strict,max-affected=1' },
    'migration 0899: the gated boq_items PATCH asks for strict one-row semantics in the same header');
  await correct('contract-line', { code: 'ORG-001', key: 'L-10' }, { basis: 'lump_sum', quantity: '1' }, api, { dryRun: false });
  assert.deepEqual(writes(api)[1].body, { earning_basis: 'lump_sum', quantity: 1 });
});

test('AC-CLICOR-006: a lump-sum line must have quantity 1, judged on the merged result', async () => {
  const api = fakeApi({ projects: [PROJECT()], companies: [CLIENT], boq_items: [LINE()] });
  await assert.rejects(correct('contract-line', { code: 'ORG-001', key: 'L-10' }, { basis: 'lump_sum' }, api, { dryRun: false }),
    (e) => e.exit === 2 && /lump-sum line must have quantity 1/.test(e.message + JSON.stringify(e.details)));
  assert.deepEqual(writes(api), []);
  const lump = fakeApi({ projects: [PROJECT()], companies: [CLIENT], boq_items: [LINE({ earning_basis: 'lump_sum', quantity: 1, unit: 'lot' })] });
  await assert.rejects(correct('contract-line', { code: 'ORG-001', key: 'L-10' }, { quantity: '2' }, lump, { dryRun: false }), (e) => e.exit === 2);
});

test('contract line: an unknown or repeated key stops the command', async () => {
  const api = fakeApi({ projects: [PROJECT()], companies: [CLIENT], boq_items: [LINE()] });
  await assert.rejects(correct('contract-line', { code: 'ORG-001', key: 'L-99' }, { rate: '5' }, api, { dryRun: false }), (e) => e.exit === 2 && /L-99/.test(e.message));
  const dup = fakeApi({ projects: [PROJECT()], companies: [CLIENT], boq_items: [LINE(), LINE({ id: 'l-2' })] });
  await assert.rejects(correct('contract-line', { code: 'ORG-001', key: 'L-10' }, { rate: '5' }, dup, { dryRun: false }), (e) => e.exit === 2 && /more than one/i.test(e.message));
});

// ── budget lines ────────────────────────────────────────────────────────────────────────────────────

const ROW = { category: 'Labor', description: 'Site crew', fiscal_year: '2026', budgeted_amount: 1000 };
const keyFor = (row, projectUuid = 'p-1', project = 'ORG-001') => encodeBudgetImportIdentity({
  projectUuid, project, category: row.category, rawCategory: row.category, description: row.description ?? '',
  fiscalYear: row.fiscal_year ?? '', amountText: String(row.budgeted_amount), amount: row.budgeted_amount, reference: row.reference ?? '',
});
const BLINE = (over = {}) => ({
  id: 'b-1', budget_version_id: 'v-1', category: 'Labor', description: 'Site crew', fiscal_year: '2026',
  budgeted_amount: 1000, actual_amount: 0, import_key: keyFor(ROW).v2Key, import_origin: 2, ...over,
});
const VERSION = (over = {}) => ({ id: 'v-1', project_id: 'p-1', version: 1, status: 'Draft', budget_mode: 'per_year', ...over });

test('AC-CLICOR-008: budget line found by the load row — one budget_line_items update with only the amount', async () => {
  const api = fakeApi({ projects: [PROJECT()], companies: [CLIENT], budget_versions: [VERSION()], budget_line_items: [BLINE()] });
  const dry = await correct('budget-line', { code: 'ORG-001', line: ROW }, { budgeted_amount: '1200' }, api, { dryRun: true });
  assert.deepEqual(dry.fields, [{ field: 'budgeted_amount', before: 1000, after: 1200, status: 'changed' }]);
  assert.deepEqual(writes(api), []);
  await correct('budget-line', { code: 'ORG-001', line: ROW }, { budgeted_amount: '1200', description: 'Site crew (revised)' }, api, { dryRun: false });
  assert.equal(writes(api).length, 1);
  assert.equal(writes(api)[0].table, 'budget_line_items');
  assert.equal(writes(api)[0].q, 'id=eq.b-1');
  assert.deepEqual(writes(api)[0].body, { budgeted_amount: 1200, description: 'Site crew (revised)' });
  assert.deepEqual(writes(api)[0].headers, { prefer: 'return=representation,handling=strict,max-affected=1' },
    'migration 0899: the gated budget_line_items PATCH asks for strict one-row semantics in the same header');
  for (const never of ['actual_amount', 'category', 'fiscal_year', 'import_key', 'import_origin', 'org_id', 'budget_version_id']) {
    assert.equal(Object.hasOwn(writes(api)[0].body, never), false, never);
  }
});

test('AC-CLICOR-014: the corrected line keeps its identity — the original load file still reports it as loaded', async () => {
  const doc = { projects: [{ code: 'ORG-001', name: 'Plant upgrade', client: 'Client Legal A', stage: 'Ongoing Project', contract_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
    customer_contract_ref: 'PO-1', contract_date: '2026-01-01', budget: [ROW], contract_lines: [{ key: 'L-10', item_code: 'SVC-1', description: 'Pipe laying', unit: 'm', quantity: 10, rate: 100 }] }] };
  const tables = { companies: [CLIENT], projects: [PROJECT()], external_domain_ownership: [], budget_versions: [VERSION()], budget_line_items: [BLINE()], boq_items: [LINE()] };
  const api = fakeApi(tables);
  await correct('budget-line', { code: 'ORG-001', line: ROW }, { budgeted_amount: '1200' }, api, { dryRun: false });
  await correct('contract-line', { code: 'ORG-001', key: 'L-10' }, { rate: '1500' }, api, { dryRun: false });
  // The loader's own matching: the budget RPC answers by import key; contract lines by boq_items.import_key.
  api.rpc = async (name, args) => {
    assert.equal(name, 'import_budget_line_v2');
    const hit = tables.budget_line_items.find((l) => l.import_key === args.p_v2_key);
    return [hit ? { outcome: 'skipped', line_id: hit.id } : { outcome: 'created', line_id: 'new' }];
  };
  const { problems, plan } = await resolveLoad(doc, api);
  assert.deepEqual(problems, []);
  const actions = await applyLoad(plan, api, { dryRun: false });
  assert.ok(actions.some((a) => a.kind === 'contract_line.skip'));
  assert.ok(actions.some((a) => a.kind === 'budget.line.skipped'));
  assert.equal(actions.some((a) => a.kind === 'contract_line.create' || a.kind === 'budget.line.created'), false);
});

test('#1858: pmo load and the project correction keep the plain header; only the two gated tables ask for one row', async () => {
  const doc = { projects: [{ code: 'ORG-001', name: 'Plant upgrade', client: 'Client Legal A', stage: 'Ongoing Project', contract_value: 1000, tax_treatment: 'exclusive', tax_amount: 0, short_name: 'Plant2' }] };
  const api = fakeApi({ companies: [CLIENT], projects: [PROJECT({ short_name: null })], external_domain_ownership: [], boq_items: [LINE()] });
  const { problems, plan } = await resolveLoad(doc, api);
  assert.deepEqual(problems, []);
  const actions = await applyLoad(plan, api, { dryRun: false });
  assert.ok(actions.some((a) => a.kind === 'project.set_short_name'), 'the load took the path that PATCHes a project');
  const patches = api.log.filter((e) => e.method === 'PATCH');
  assert.deepEqual(patches.map((p) => [p.table, p.body, p.headers]), [['projects', { short_name: 'Plant2' }, { prefer: 'return=representation' }]]);
  // The same api object: correcting a gated table asks for the one-row semantics in that PATCH alone.
  await correct('contract-line', { code: 'ORG-001', key: 'L-10' }, { rate: '1500' }, api, { dryRun: false });
  const last = api.log.filter((e) => e.method === 'PATCH').at(-1);
  assert.deepEqual([last.table, last.headers], ['boq_items', { prefer: 'return=representation,handling=strict,max-affected=1' }]);
});

test('AC-CLICOR-009: a budget line outside a Draft per-year version is refused with the app reason, nothing written', async () => {
  for (const version of [VERSION({ status: 'Active' }), VERSION({ status: 'Archived' })]) {
    const api = fakeApi({ projects: [PROJECT()], companies: [CLIENT], budget_versions: [version], budget_line_items: [BLINE()] });
    await assert.rejects(correct('budget-line', { code: 'ORG-001', line: ROW }, { budgeted_amount: '1' }, api, { dryRun: false }),
      (e) => e.exit === 2 && /line-items can only change while the owning version is Draft/.test(e.message));
    assert.deepEqual(writes(api), []);
  }
  const whole = fakeApi({ projects: [PROJECT()], companies: [CLIENT], budget_versions: [VERSION({ budget_mode: 'whole_project' })], budget_line_items: [BLINE()] });
  await assert.rejects(correct('budget-line', { code: 'ORG-001', line: ROW }, { budgeted_amount: '1' }, whole, { dryRun: false }), (e) => e.exit === 2 && /whole-project/.test(e.message));
});

test('AC-CLICOR-010: a budget row that matches no line, or two, writes nothing', async () => {
  const none = fakeApi({ projects: [PROJECT()], companies: [CLIENT], budget_versions: [VERSION()], budget_line_items: [] });
  await assert.rejects(correct('budget-line', { code: 'ORG-001', line: ROW }, { budgeted_amount: '1' }, none, { dryRun: false }), (e) => e.exit === 2 && /no budget line/i.test(e.message));
  const two = fakeApi({ projects: [PROJECT()], companies: [CLIENT], budget_versions: [VERSION(), VERSION({ id: 'v-2', version: 2 })],
    budget_line_items: [BLINE(), BLINE({ id: 'b-2', budget_version_id: 'v-2' })] });
  await assert.rejects(correct('budget-line', { code: 'ORG-001', line: ROW }, { budgeted_amount: '1' }, two, { dryRun: false }), (e) => e.exit === 2 && /more than one/i.test(e.message));
  assert.deepEqual(writes(none).concat(writes(two)), []);
  const badRow = fakeApi({ projects: [PROJECT()], companies: [CLIENT] });
  await assert.rejects(correct('budget-line', { code: 'ORG-001', line: { category: 'Food', budgeted_amount: 1 } }, { budgeted_amount: '1' }, badRow, { dryRun: false }), (e) => e.exit === 2 && /category/.test(JSON.stringify(e.details)));
});

test('AC-CLICOR-010: a budget line whose category the loader moved is matched on the moved category', async () => {
  const moved = { category: 'Special expenses', description: 'Hotel for crew', fiscal_year: '2026', budgeted_amount: 500 };
  const id = encodeBudgetImportIdentity({ projectUuid: 'p-1', project: 'ORG-001', category: 'Travel & accommodation', rawCategory: 'Special expenses',
    description: moved.description, fiscalYear: '2026', amountText: '500', amount: 500, reference: '' });
  const api = fakeApi({ projects: [PROJECT()], companies: [CLIENT], budget_versions: [VERSION()],
    budget_line_items: [BLINE({ id: 'b-9', category: 'Travel & accommodation', description: moved.description, budgeted_amount: 500, import_key: id.v2Key })] });
  const r = await correct('budget-line', { code: 'ORG-001', line: moved }, { budgeted_amount: '650' }, api, { dryRun: true });
  assert.equal(r.id, 'b-9');
});

test('AC-CLICOR-015 (CLI list half; the guard itself is pgTAP 0899_cli_guard_history_corrections.test.sql): the tables a correction PATCHes beyond the ordinary write tables are the Admin PATCH list', () => {
  assert.deepEqual([...CORRECT_ADMIN_PATCH_TABLES], ['boq_items', 'budget_line_items']);
  assert.deepEqual(Object.values(CORRECTABLE).map((s) => s.table).sort(), ['boq_items', 'budget_line_items', 'projects']);
});

const REF_ROW = { category: 'Labor', description: 'Site crew', fiscal_year: '2026', budgeted_amount: 1000, reference: 'SBP-7' };

test('AC-CLICOR-010: a line loaded before the v2 key (no import origin, key = its reference) is found by that reference', async () => {
  const api = fakeApi({ projects: [PROJECT()], companies: [CLIENT], budget_versions: [VERSION()],
    budget_line_items: [BLINE({ id: 'b-ref', import_key: 'SBP-7', import_origin: null })] });
  const r = await correct('budget-line', { code: 'ORG-001', line: REF_ROW }, { budgeted_amount: '1300' }, api, { dryRun: true });
  assert.equal(r.id, 'b-ref');
});

test('AC-CLICOR-010: the legacy key matches only a line with no import origin; a v2-origin line carrying that text is not it', async () => {
  const api = fakeApi({ projects: [PROJECT()], companies: [CLIENT], budget_versions: [VERSION()],
    budget_line_items: [BLINE({ id: 'b-v2', import_key: 'SBP-7', import_origin: 2 })] });
  await assert.rejects(correct('budget-line', { code: 'ORG-001', line: REF_ROW }, { budgeted_amount: '1300' }, api, { dryRun: true }), (e) => e.exit === 2 && /no budget line/i.test(e.message));
});

test('AC-CLICOR-010: a pre-v2 line without a reference ("fp:" key) of a project with no code is found by the file key: name | client legal name', async () => {
  const row = { category: 'Labor', description: 'Site crew', fiscal_year: '2026', budgeted_amount: 1000 };
  const legacy = encodeBudgetImportIdentity({ projectUuid: 'p-1', project: 'Plant upgrade | Client Legal A', category: 'Labor', rawCategory: 'Labor',
    description: 'Site crew', fiscalYear: '2026', amountText: '1000', amount: 1000, reference: '' }).legacyKey;
  assert.match(legacy, /^fp:/);
  const api = fakeApi({ projects: [PROJECT({ code: null })], companies: [CLIENT], budget_versions: [VERSION()],
    budget_line_items: [BLINE({ id: 'b-fp', import_key: legacy, import_origin: null })] });
  const r = await correct('budget-line', { name: 'Plant upgrade', client: 'Client Legal A', line: row }, { budgeted_amount: '1300' }, api, { dryRun: true });
  assert.equal(r.id, 'b-fp');
});

// ── QUALITY 4/5/6: the preview agrees with the app and the database ───────────────────────────────

test('AC-CLICOR-005: text is trimmed like the app does, so the preview shows what is stored; a blank is refused', async () => {
  const api = fakeApi({ projects: [PROJECT()], companies: [CLIENT] });
  const r = await correct('project', { code: 'ORG-001' }, { short_name: '  PU  ' }, api, { dryRun: false });
  assert.deepEqual(r.fields, [{ field: 'short_name', before: 'Plant', after: 'PU', status: 'changed' }]);
  assert.deepEqual(writes(api)[0].body, { short_name: 'PU' });
  const same = fakeApi({ projects: [PROJECT()], companies: [CLIENT] });
  assert.equal((await correct('project', { code: 'ORG-001' }, { short_name: ' Plant ' }, same, { dryRun: false })).applied, false);
});

test('AC-CLICOR-005: award_type and bidding_entity take only the database values (tender|direct, alone|consortium)', () => {
  assert.equal(validateSets('project', { award_type: 'tender', bidding_entity: 'consortium' }).problems.length, 0);
  const bad = validateSets('project', { award_type: 'Tender', bidding_entity: 'solo' }).problems;
  assert.equal(bad.length, 2);
  assert.match(bad[0], /award_type.*tender, direct/);
  assert.match(bad[1], /bidding_entity.*alone, consortium/);
});

test('AC-CLICOR-003: a project of an archived client can still be corrected by name + client (a correction creates nothing)', async () => {
  const api = fakeApi({ projects: [PROJECT({ code: null })], companies: [{ ...CLIENT, archived_at: '2026-01-01T00:00:00Z' }] });
  const r = await correct('project', { name: 'Plant upgrade', client: 'Client Legal A' }, { short_name: 'PU' }, api, { dryRun: true });
  assert.equal(r.id, 'p-1');
});

test('AC-CLICOR-005: the contract-line limits and messages are the loader\'s own, not a second copy', () => {
  const loader = validateLoadFile({ projects: [{ code: 'C', name: 'P', client: 'A', stage: 'Leads',
    contract_lines: [{ key: 'k', item_code: 'S', description: 'd'.repeat(501), unit: 'u'.repeat(41), quantity: 0, rate: 1.234 }] }] }).join('\n');
  const ours = validateSets('contract-line', { description: 'd'.repeat(501), unit: 'u'.repeat(41), quantity: '0', rate: '1.234' }).problems;
  assert.equal(ours.length, 4);
  for (const m of ours) assert.ok(loader.includes(m), `loader says the same: ${m}`);
});
