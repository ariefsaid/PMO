/**
 * pmo-load.test.mjs — `pmo load` planner/executor (#796). Run: node --test scripts/pmo-load.test.mjs
 * A fake LoadApi (no HTTP, no DB). The database half is pgTAP: api_client_seed_surface.test.sql
 * (AC-CSD-013) and client_starting_data_sequence.test.sql (AC-CSD-015).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { classifyBudgetLineCategory, defaultContractLineBasis, LOAD_STAGE_PATHS, remainingPath, validateLoadFile } from './lib/pmo-load.mjs';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');

test('AC-CSD-002: validateLoadFile names every problem, row by row', () => {
  assert.deepEqual(validateLoadFile([]), ['The load file must be a JSON object with a "companies" list and/or a "projects" list']);
  const problems = validateLoadFile({
    companies: [{ name: 'A' }, { name: 'A', type: 'Vendor' }],
    projects: [
      { name: 'X', client: 'A', stage: 'Won, Pending KoM', contract_value: 10 },
      { name: 'Y', client: 'A', stage: 'Leads', status: 'Ongoing Project', contract_date: '2025-01-01' },
      { name: 'W', client: 'A', stage: 'Sold' },
      {
        code: 'C-1', name: 'Z', client: 'A', stage: 'Leads',
        budget: [
          { category: 'Food', budgeted_amount: 1.234 },
          { category: 'Labor', budgeted_amount: 5 },
          { category: 'Labor', budgeted_amount: 5 },
        ],
      },
    ],
  });
  assert.deepEqual(problems, [
    'companies[1]: unknown field "type"',
    'companies[1]: "A" appears twice',
    'projects[0] (X | A): "tax_treatment" must be "inclusive" or "exclusive" when a contract value is given',
    'projects[0] (X | A): "tax_amount" must be a non-negative amount with at most 2 decimals when a contract value is given (0 = no tax)',
    'projects[0] (X | A): "customer_contract_ref" (the client\'s contract or PO number) is required to load a won project',
    'projects[0] (X | A): "contract_date" (YYYY-MM-DD) is required to load a won project',
    'projects[1] (Y | A): unknown field "status"',
    'projects[1] (Y | A): "customer_contract_ref" and "contract_date" are recorded only when a project is won',
    `projects[2] (W | A): "stage" must be one of: ${Object.keys(LOAD_STAGE_PATHS).join(', ')}`,
    'projects[3] (C-1): budget[0]: "category" must be one of: Labor, Materials, Subcontractors, Equipment, Permits & Fees, Overheads, Contingency, Special expenses, Travel & accommodation, Vehicle',
    'projects[3] (C-1): budget[0]: "budgeted_amount" must be a non-negative amount with at most 2 decimals',
    'projects[3] (C-1): budget[2]: is identical to an earlier line — give one of them a "reference" to keep both',
  ]);
});

test('AC-TAG-003: classification fields must be text when given', () => {
  const problems = validateLoadFile({ projects: [{ name: 'X', client: 'A', stage: 'Leads', sector: 3, location: null }] });
  assert.deepEqual(problems, ['projects[0] (X | A): "sector" must be text']);
});

test('AC-CSD-002: a won project needs a value, and a date must be a real calendar date', () => {
  assert.deepEqual(
    validateLoadFile({ projects: [{ name: 'V', client: 'A', stage: 'Close Out', customer_contract_ref: 'PO', contract_date: '2025-02-30' }] }),
    [
      'projects[0] (V | A): "contract_value" is required to load a won project',
      'projects[0] (V | A): "contract_date" (YYYY-MM-DD) is required to load a won project',
    ],
  );
});

test('AC-CSD-009: remainingPath resumes from the current stage and returns null off the path', () => {
  assert.deepEqual(remainingPath('Ongoing Project', 'Leads'), ['PQ Submitted', 'Quotation Submitted', 'Won, Pending KoM', 'Ongoing Project']);
  assert.deepEqual(remainingPath('Ongoing Project', 'Quotation Submitted'), ['Won, Pending KoM', 'Ongoing Project']);
  assert.deepEqual(remainingPath('Ongoing Project', 'Ongoing Project'), []);
  assert.equal(remainingPath('Ongoing Project', 'Loss Tender'), null);
  assert.equal(remainingPath('Quotation Submitted', 'Ongoing Project'), null);
});

test('AC-CSD-014: every step of every load path is legal in the latest transition_project map', () => {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const latest = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => /create or replace function (public\.)?transition_project\(/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    .pop();
  const sql = fs.readFileSync(path.join(dir, latest), 'utf8');
  const legal = {};
  for (const m of sql.matchAll(/'([^']+)',\s+jsonb_build_array\(([^)]*)\)/g)) {
    legal[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  assert.ok(Object.keys(legal).length >= 10, `parsed the transition map from ${latest}`);
  for (const [target, steps] of Object.entries(LOAD_STAGE_PATHS)) {
    const walk = ['Leads', ...steps];
    assert.equal(walk.at(-1), target, `${target}: the path ends at the target`);
    for (let i = 1; i < walk.length; i += 1) {
      assert.ok(legal[walk[i - 1]]?.includes(walk[i]), `${target}: ${walk[i - 1]} -> ${walk[i]} is legal`);
    }
  }
});

import { applyLoad, resolveLoad } from './lib/pmo-load.mjs';

/**
 * A fake LoadApi. GETs filter `tables[t]` by the query's eq./is.null/not.is.null filters; every call is
 * recorded in `calls`. `fail(kind, target, body)` may return an error code to throw, as the CLI's
 * apiError would. The RPCs update the project row the way the database does, so a re-run sees them.
 */
function fakeApi({ tables = {}, fail } = {}) {
  const calls = [];
  const rows = (t) => (tables[t] ??= []);
  let seq = 0;
  const matches = (row, q) => {
    for (const [k, v] of q) {
      if (k === 'select' || k === 'order' || k === 'limit') continue;
      if (v === 'is.null' && row[k] != null) return false;
      if (v === 'not.is.null' && row[k] == null) return false;
      if (v.startsWith('eq.') && String(row[k]) !== v.slice(3)) return false;
    }
    return true;
  };
  const maybeFail = (kind, target, body) => {
    const code = fail?.(kind, target, body);
    if (code) throw Object.assign(new Error(`refused: ${kind} ${target}`), { code, status: 403 });
  };
  return {
    calls,
    tables,
    async get(t, q) {
      calls.push({ kind: 'get', target: t, query: q.toString() });
      return rows(t).filter((r) => matches(r, q));
    },
    async post(t, body) {
      calls.push({ kind: 'post', target: t, body });
      maybeFail('post', t, body);
      seq += 1;
      const row = { id: `${t}-${seq}`, ...body };
      if (t === 'projects') row.pmo_project_number = `PRJ-26-${String(seq).padStart(4, '0')}`;
      if (t === 'budget_versions') row.status ??= 'Draft';
      rows(t).push(row);
      return [row];
    },
    async patch(t, q, body) {
      calls.push({ kind: 'patch', target: t, query: q.toString(), body });
      maybeFail('patch', t, body);
      const hit = rows(t).filter((r) => matches(r, q));
      for (const r of hit) Object.assign(r, body);
      return hit;
    },
    async rpc(name, body) {
      calls.push({ kind: 'rpc', target: name, body });
      maybeFail('rpc', name, body);
      if (name === 'import_budget_line_v2') {
        const lines = rows('budget_line_items');
        const candidates = lines.filter((l) => l.budget_version_id === body.p_version_id);
        const conflict = candidates.find((l) => l.import_origin == null && (l.import_key === body.p_v2_key ||
          (l.import_key === body.p_legacy_key && (!body.p_has_reference || body.p_legacy_key.startsWith('fp:')))));
        if (conflict) return [{ outcome: 'conflict', line_id: conflict.id }];
        const prior = candidates.find((l) => (l.import_origin === 2 && l.import_key === body.p_v2_key) ||
          (l.import_origin == null && body.p_has_reference && l.import_key === body.p_legacy_key));
        if (prior) return [{ outcome: 'skipped', line_id: prior.id }];
        const id = `line-${++seq}`;
        lines.push({ id, budget_version_id: body.p_version_id, import_origin: 2, import_key: body.p_v2_key });
        return [{ outcome: 'created', line_id: id }];
      }
      const row = rows('projects').find((r) => r.id === body.p_id);
      if (row && name === 'transition_project') row.status = body.p_to;
      if (row && name === 'set_project_contract_value') row.contract_value = body.p_value;
      return null;
    },
  };
}

const writes = (api) => api.calls.filter((c) => c.kind !== 'get');

const DOC = () => ({
  companies: [{ name: 'Client Legal A', short_name: 'A' }, { name: 'Owner Legal B' }],
  projects: [
    {
      code: 'ORG-001', name: 'Plant upgrade', client: 'Client Legal A', end_client: 'Owner Legal B',
      stage: 'Ongoing Project', contract_value: 1000000, tax_treatment: 'exclusive', tax_amount: 110000,
      customer_contract_ref: 'PO-1', contract_date: '2025-02-01', start_date: '2025-02-10',
      service_line: 'Engineering', sector: 'Energy', location: 'Riau', award_type: 'direct', bidding_entity: 'Own',
      budget: [
        { category: 'Labor', description: 'Crew', budgeted_amount: 400000 },
        { category: 'Special expenses', description: 'Permits', budgeted_amount: 50000, reference: 'R-2' },
      ],
    },
    { name: 'Tank farm bid', client: 'Client Legal A', stage: 'Tender Submitted', contract_value: 250000, tax_treatment: 'exclusive', tax_amount: 27500 },
  ],
});

const COMPANIES = () => [
  { id: 'c-a', name: 'Client Legal A', short_name: 'A', archived_at: null },
  { id: 'c-b', name: 'Owner Legal B', short_name: null, archived_at: null },
];
const EXISTING = (over = {}) => ({
  id: 'p-1', code: 'ORG-001', name: 'Plant upgrade', client_id: 'c-a', status: 'Ongoing Project',
  contract_value: 1000000, pmo_project_number: 'PRJ-26-0001', ...over,
});

test('AC-CSD-005: while ERPNext owns companies, each missing company is one problem and nothing is written', async () => {
  const api = fakeApi({ tables: { external_domain_ownership: [{ domain: 'companies', external_tier: 'erpnext' }] } });
  const { problems } = await resolveLoad(DOC(), api);
  assert.equal(problems.length, 2, problems.join('\n'));
  assert.match(problems[0], /"Client Legal A" does not exist, and ERPNext owns companies/);
  assert.match(problems[0], /Companies → New/);
  assert.deepEqual(writes(api), []);
});

test('AC-CSD-010: the budget target is a new Draft, the highest Draft minus loaded keys, or nothing once a budget is active', async () => {
  const doc = { projects: [DOC().projects[0]] };
  const budgetOf = async (extra) =>
    (await resolveLoad(doc, fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING()], ...extra } }))).plan.projects[0].budget;
  assert.equal((await budgetOf({})).state, 'new');
  const attach = await budgetOf({
    budget_versions: [{ id: 'v-1', project_id: 'p-1', status: 'Draft', version: 1 }],
    budget_line_items: [{ id: 'l-1', budget_version_id: 'v-1', import_key: 'R-2' }],
  });
  assert.equal(attach.state, 'attach');
  assert.equal(attach.versionId, 'v-1');
  assert.deepEqual(attach.lines.map((l) => l.import_key), ['fp:ORG-001|Labor|Crew||400000', 'R-2']);
  for (const status of ['Active', 'Archived']) {
    assert.equal((await budgetOf({ budget_versions: [{ id: 'v-1', project_id: 'p-1', status, version: 1 }] })).state, 'skip', status);
  }
});

const load = async (api, doc = DOC(), dryRun = false) => {
  const { problems, plan } = await resolveLoad(doc, api);
  assert.deepEqual(problems, []);
  return applyLoad(plan, api, { dryRun, batchId: 'batch-1', importedAt: '2026-10-06T00:00:00.000Z' });
};

test('AC-CSD-006/007: a fresh load creates companies, projects as Leads, sets the value, then walks each stage in order', async () => {
  const api = fakeApi();
  await load(api);
  const w = writes(api);
  assert.deepEqual(w.map((c) => `${c.kind} ${c.target}`), [
    'post companies', 'post companies',
    'post projects', 'rpc set_project_contract_value',
    'rpc transition_project', 'rpc transition_project', 'rpc transition_project', 'rpc transition_project',
    'post budget_versions', 'rpc import_budget_line_v2', 'rpc import_budget_line_v2',
    'post projects', 'rpc set_project_contract_value',
    'rpc transition_project', 'rpc transition_project', 'rpc transition_project',
  ]);
  assert.deepEqual(w[0].body, { name: 'Client Legal A', type: 'Client', short_name: 'A' });
  assert.deepEqual(w[1].body, { name: 'Owner Legal B', type: 'Client' });
  assert.deepEqual(w[2].body, {
    name: 'Plant upgrade', status: 'Leads', client_id: 'companies-1', code: 'ORG-001',
    end_client_id: 'companies-2', start_date: '2025-02-10',
    service_line: 'Engineering', sector: 'Energy', location: 'Riau', award_type: 'direct', bidding_entity: 'Own',
  });
  assert.deepEqual(w[3].body, { p_id: 'projects-3', p_value: 1000000, p_tax_treatment: 'exclusive', p_tax_amount: 110000 });
  assert.deepEqual(w.slice(4, 8).map((c) => c.body), [
    { p_id: 'projects-3', p_to: 'PQ Submitted' },
    { p_id: 'projects-3', p_to: 'Quotation Submitted' },
    { p_id: 'projects-3', p_to: 'Won, Pending KoM', p_customer_contract_ref: 'PO-1', p_contract_date: '2025-02-01' },
    { p_id: 'projects-3', p_to: 'Ongoing Project' },
  ]);
  assert.deepEqual(w.slice(13).map((c) => c.body.p_to), ['PQ Submitted', 'Quotation Submitted', 'Tender Submitted']);
  assert.ok(w.slice(13).every((c) => !('p_customer_contract_ref' in c.body)), 'a bid carries no win artifacts');
});

test('AC-CSD-010: a budget becomes one Draft "Imported" version; lines carry the app key and never a status, activation or actual', async () => {
  const api = fakeApi();
  await load(api);
  const [version] = writes(api).filter((c) => c.target === 'budget_versions');
  assert.deepEqual(version.body, {
    project_id: 'projects-3', version: 1, name: 'Imported', import_batch_id: 'batch-1', imported_at: '2026-10-06T00:00:00.000Z',
  });
  const lines = writes(api).filter((c) => c.target === 'import_budget_line_v2').map((c) => c.body);
  assert.deepEqual(lines.map((l) => [l.p_version_id, l.p_category, l.p_description, l.p_budgeted_amount, l.p_fiscal_year, l.p_legacy_key]), [
    ['budget_versions-4', 'Labor', 'Crew', 400000, null, 'fp:ORG-001|Labor|Crew||400000'],
    ['budget_versions-4', 'Special expenses', 'Permits', 50000, null, 'R-2'],
  ]);
  assert.equal(lines[0].p_v2_key, 'bimp2:["f","projects-3","Labor","Crew","","400000.00"]');
  assert.equal(lines[1].p_v2_key, 'bimp2:["r","R-2"]');
  assert.ok(lines.every((l) => !('actual_amount' in l) && !('status' in l)));

});

test('AC-CSD-010: an existing Draft is reused with its loaded keys skipped; an Active version skips the budget; 23505 is a skip', async () => {
  const doc = { projects: [DOC().projects[0]] };
  const draft = fakeApi({ tables: {
    companies: COMPANIES(), projects: [EXISTING()],
    budget_versions: [{ id: 'v-1', project_id: 'p-1', status: 'Draft', version: 1 }],
    budget_line_items: [{ id: 'l-1', budget_version_id: 'v-1', import_key: 'R-2' }],
  } });
  const draftActions = await load(draft, doc);
  const result = draftActions.find((a) => a.kind === 'budget.lines');
  assert.equal(result.created, 1);
  assert.equal(result.skipped, 1);
  assert.equal(writes(draft).filter((c) => c.target === 'import_budget_line_v2').length, 2);

  const active = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING()], budget_versions: [{ id: 'v-1', project_id: 'p-1', status: 'Active', version: 1 }] } });
  const actions = await load(active, doc);
  assert.deepEqual(writes(active), []);
  assert.equal(actions.find((a) => a.kind === 'budget.skip').key, 'ORG-001');

  const raced = fakeApi({ fail: (kind, target, body) => target === 'import_budget_line_v2' && body.p_legacy_key === 'R-2' && '23505' });
  await assert.rejects(load(raced), (err) => err.code === '23505' && err.loadReport.done.some((a) => a.kind === 'budget.line.created'));

});

test('AC-CSD-004: an existing company is matched by legal name; an empty short name is filled, a different one reported', async () => {
  const api = fakeApi({ tables: { companies: [
    { id: 'c-a', name: 'Client Legal A', short_name: null, archived_at: null },
    { id: 'c-b', name: 'Owner Legal B', short_name: 'OB', archived_at: null },
  ] } });
  const actions = await load(api, { companies: [{ name: 'Client Legal A', short_name: 'A' }, { name: 'Owner Legal B', short_name: 'B' }] });
  assert.deepEqual(writes(api).map((c) => [c.kind, c.target, c.query, c.body]), [['patch', 'companies', 'id=eq.c-a', { short_name: 'A' }]]);
  assert.deepEqual(actions.map((a) => a.kind), ['company.set_short_name', 'company.short_name_differs']);
});

test('AC-CSD-008: re-running a completed load writes nothing', async () => {
  const api = fakeApi();
  await load(api);
  const before = writes(api).length;
  const rerun = await load(api);
  assert.equal(writes(api).length, before + 2);
  assert.equal(rerun.filter((a) => a.kind === 'budget.line.skipped').length, 2);
  assert.equal(rerun.find((a) => a.kind === 'budget.lines').created, 0);
});

test('AC-CSD-009: a project part-way resumes; one off its path is left alone; a different value is reported', async () => {
  const doc = { projects: [DOC().projects[0]] };
  const active = [{ id: 'v-1', project_id: 'p-1', status: 'Active', version: 1 }];
  const partway = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING({ status: 'Quotation Submitted' })], budget_versions: active } });
  await load(partway, doc);
  assert.deepEqual(writes(partway).map((c) => c.body.p_to), ['Won, Pending KoM', 'Ongoing Project']);

  const lost = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING({ status: 'Loss Tender' })] } });
  const lostActions = await load(lost, doc);
  assert.deepEqual(writes(lost), []);
  assert.deepEqual(lostActions.map((a) => a.kind), ['project.diverged']);

  const repriced = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING({ contract_value: 900000 })], budget_versions: active } });
  const priced = await load(repriced, doc);
  assert.deepEqual(writes(repriced), []);
  assert.deepEqual(priced.find((a) => a.kind === 'project.contract_value_differs'),
    { kind: 'project.contract_value_differs', key: 'ORG-001', id: 'p-1', current: 900000, file: 1000000 });
});

test('AC-CSD-003: a dry run plans the same actions and writes nothing', async () => {
  const api = fakeApi();
  const actions = await load(api, DOC(), true);
  assert.deepEqual(writes(api), []);
  assert.deepEqual(actions.map((a) => a.kind), [
    'company.create', 'company.create',
    'project.create', 'project.contract_value',
    'project.transition', 'project.transition', 'project.transition', 'project.transition',
    'budget.version', 'budget.lines',
    'project.create', 'project.contract_value',
    'project.transition', 'project.transition', 'project.transition',
  ]);
});

test('AC-CSD-012: the first refusal stops the load and reports what was done and what failed', async () => {
  const api = fakeApi({ fail: (kind, target, body) => target === 'transition_project' && body.p_to === 'Won, Pending KoM' && '42501' });
  const { plan } = await resolveLoad(DOC(), api);
  await assert.rejects(applyLoad(plan, api, { dryRun: false, batchId: 'b', importedAt: 't' }), (e) => {
    assert.equal(e.code, '42501');
    assert.deepEqual(e.loadReport.failed, { kind: 'project.transition', key: 'ORG-001', to: 'Won, Pending KoM' });
    assert.deepEqual(e.loadReport.done.map((a) => a.kind), [
      'company.create', 'company.create', 'project.create', 'project.contract_value', 'project.transition', 'project.transition',
    ]);
    return true;
  });
  assert.equal(writes(api).at(-1).body.p_to, 'Won, Pending KoM', 'no write after the refusal');
});

// ── contract lines (progress billing §8, DD-CQ-7) ────────────────────────────────────────────────

const LINE = (over = {}) => ({
  key: 'L-1', item_code: 'SVC-001', description: 'Survey service', unit: 'm2', quantity: 100, rate: 25000, ...over,
});
const projectWith = (contract_lines, over = {}) => ({ code: 'ORG-001', name: 'Plant upgrade', client: 'Client Legal A', stage: 'Leads', contract_lines, ...over });

test('AC-CQ-016: validation returns every contract-line problem, row by row, when the project has no budget', () => {
  const doc = { projects: [projectWith([
    LINE({ key: 'A', item_code: '' }),
    LINE({ key: 'B', quantity: 0 }),
    LINE({ key: 'B', rate: 1.234 }),
    LINE({ key: 'C', unit: 'LS', quantity: 2 }),
    LINE({ key: 'D', quantity: 1.2345 }),
    LINE({ key: 'E', basis: 'per_hour' }),
    LINE({ key: 'F', extra: 1 }),
    LINE({ key: ' ' }),
    'not an object',
  ])] };
  assert.deepEqual(validateLoadFile(doc), [
    'projects[0] (ORG-001): contract_lines[0]: "item_code" (the ERP service item) is required',
    'projects[0] (ORG-001): contract_lines[1]: "quantity" must be a positive number below 100000000000 with at most 3 decimals',
    'projects[0] (ORG-001): contract_lines[2]: "key" "B" appears twice',
    'projects[0] (ORG-001): contract_lines[2]: "rate" must be a non-negative amount with at most 2 decimals',
    'projects[0] (ORG-001): contract_lines[3]: a lump-sum line must have quantity 1',
    'projects[0] (ORG-001): contract_lines[4]: "quantity" must be a positive number below 100000000000 with at most 3 decimals',
    'projects[0] (ORG-001): contract_lines[5]: "basis" must be "unit_rate" or "lump_sum"',
    'projects[0] (ORG-001): contract_lines[6]: unknown field "extra"',
    'projects[0] (ORG-001): contract_lines[7]: "key" is required',
    'projects[0] (ORG-001): contract_lines[8]: must be an object',
  ]);
});

test('AC-CQ-016: contract_lines must be a list; unknown fields, lengths and line_no are checked', () => {
  assert.deepEqual(validateLoadFile({ projects: [projectWith({})] }), ['projects[0] (ORG-001): "contract_lines" must be a list of lines']);
  assert.deepEqual(validateLoadFile({ projects: [projectWith([LINE({
    item_code: 'x'.repeat(141), description: 'd'.repeat(501), unit: 'u'.repeat(41), line_no: 1.5,
  })])] }), [
    'projects[0] (ORG-001): contract_lines[0]: "item_code" must be at most 140 characters',
    'projects[0] (ORG-001): contract_lines[0]: "description" must be at most 500 characters',
    'projects[0] (ORG-001): contract_lines[0]: "unit" must be at most 40 characters',
    'projects[0] (ORG-001): contract_lines[0]: "line_no" must be a whole number',
  ]);
  assert.deepEqual(validateLoadFile({ projects: [projectWith([LINE({ description: undefined, unit: undefined, rate: undefined, quantity: 'a' })])] }), [
    'projects[0] (ORG-001): contract_lines[0]: "description" is required',
    'projects[0] (ORG-001): contract_lines[0]: "unit" is required',
    'projects[0] (ORG-001): contract_lines[0]: "quantity" must be a positive number below 100000000000 with at most 3 decimals',
    'projects[0] (ORG-001): contract_lines[0]: "rate" must be a non-negative amount with at most 2 decimals',
  ]);
});

test('AC-CQ-016: rejects values outside database integer and import-key bounds during preflight', () => {
  const problems = validateLoadFile({ projects: [projectWith([
    LINE({ key: 'k'.repeat(501), line_no: 2147483648 }),
    LINE({ key: 'unicode-'.repeat(70) + '界'.repeat(4_501), line_no: -2147483649 }),
  ])] });
  assert.deepEqual(problems, [
    'projects[0] (ORG-001): contract_lines[0]: "key" must be at most 500 characters',
    'projects[0] (ORG-001): contract_lines[0]: "line_no" must fit a 32-bit integer',
    'projects[0] (ORG-001): contract_lines[1]: "key" must be at most 500 characters',
    'projects[0] (ORG-001): contract_lines[1]: "line_no" must fit a 32-bit integer',
  ]);
});

test('AC-CQ-016: valid lines pass, with a project that also has a budget; explicit basis wins over the unit default', () => {
  const ok = projectWith([
    LINE({ key: 'A', line_no: 1 }),
    LINE({ key: 'B', unit: 'Lump Sum', quantity: 1, rate: 5000 }),
    LINE({ key: 'C', unit: 'lot', quantity: 1, basis: 'lump_sum' }),
    LINE({ key: 'D', unit: 'lot', quantity: 3, basis: 'unit_rate' }),
    LINE({ key: 'E', quantity: 0.001 }),
  ], { budget: [{ category: 'Labor', budgeted_amount: 1 }] });
  assert.deepEqual(validateLoadFile({ projects: [ok] }), []);
});

test('AC-CQ-016: the default basis follows the unit, case-insensitively and trimmed', () => {
  for (const u of ['lot', 'LOT', ' Ls ', 'lump sum', 'Lump Sum']) assert.equal(defaultContractLineBasis(u), 'lump_sum', u);
  for (const u of ['m2', 'hari', 'unit', 'lots', '']) assert.equal(defaultContractLineBasis(u), 'unit_rate', u);
});

const LINES_DOC = (lines = [LINE({ key: 'A', line_no: 1 }), LINE({ key: 'B', unit: 'LS', quantity: 1 })], over = {}) => ({
  projects: [projectWith(lines, { stage: 'Ongoing Project', contract_value: 1000, tax_treatment: 'exclusive', tax_amount: 0, customer_contract_ref: 'PO-1', contract_date: '2025-02-01', ...over })],
});
const getsOf = (api, table) => api.calls.filter((c) => c.kind === 'get' && c.target === table);

test('AC-CQ-016: resolve plans lines on a project that does not exist yet, with no lookup and no write', async () => {
  const api = fakeApi({ tables: { companies: COMPANIES() } });
  const { problems, plan } = await resolveLoad(LINES_DOC(), api);
  assert.deepEqual(problems, []);
  const entry = plan.projects[0];
  assert.equal(entry.id, null, 'the project is planned, not yet created');
  assert.deepEqual(entry.contractLines.lines.map((l) => [l.line.key, l.exists]), [['A', false], ['B', false]]);
  assert.deepEqual(getsOf(api, 'boq_items'), [], 'a planned project has nothing to look up');
  assert.deepEqual(writes(api), []);
});

test('AC-CQ-016: resolve looks up an existing project\'s keys with one filtered GET and marks the known ones', async () => {
  const api = fakeApi({ tables: {
    companies: COMPANIES(), projects: [EXISTING()],
    boq_items: [{ id: 'b-1', project_id: 'p-1', import_key: 'A' }, { id: 'b-2', project_id: 'p-other', import_key: 'B' }, { id: 'b-3', project_id: 'p-1', import_key: null }],
  } });
  const { problems, plan } = await resolveLoad(LINES_DOC(), api);
  assert.deepEqual(problems, []);
  assert.deepEqual(plan.projects[0].contractLines.lines.map((l) => [l.line.key, l.exists]), [['A', true], ['B', false]]);
  const [get] = getsOf(api, 'boq_items');
  assert.equal(getsOf(api, 'boq_items').length, 1);
  const q = new URLSearchParams(get.query);
  assert.equal(q.get('project_id'), 'eq.p-1');
  assert.equal(q.get('select'), 'id,import_key');
  assert.deepEqual(writes(api), []);
});

test('AC-CQ-016: lines resolve on a project that has no budget in the file', async () => {
  const noBudget = await resolveLoad(LINES_DOC(), fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING()] } }));
  assert.equal(noBudget.plan.projects[0].budget, null);
  assert.equal(noBudget.plan.projects[0].contractLines.lines.length, 2);
});

test('AC-CQ-016: an ambiguous or unresolvable project is a preflight problem, never an invented parent', async () => {
  const ambiguous = await resolveLoad(LINES_DOC(), fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING(), EXISTING({ id: 'p-2' })] } }));
  assert.equal(ambiguous.problems.length, 1);
  assert.match(ambiguous.problems[0], /more than one project matches/);
  assert.deepEqual(ambiguous.plan.projects, []);

  const noClient = await resolveLoad(LINES_DOC(), fakeApi());
  assert.match(noClient.problems[0], /not a company in PMO/);
  assert.deepEqual(noClient.plan.projects, []);
});

test('AC-CQ-016: a read that fills the 1000-row cap cannot prove a key is absent — a preflight problem', async () => {
  const full = Array.from({ length: 1000 }, (_, i) => ({ id: `b-${i}`, project_id: 'p-1', import_key: `K-${i}` }));
  const { problems } = await resolveLoad(LINES_DOC(), fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING()], boq_items: full } }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /ORG-001: .*too many contract lines to check/);
});

const linesLoad = (api, doc = LINES_DOC(), dryRun = false) => load(api, doc, dryRun);

test('AC-CQ-017: each new line is POSTed to boq_items with the mapped columns, no org_id, after the project is created', async () => {
  const api = fakeApi({ tables: { companies: COMPANIES() } });
  await linesLoad(api, LINES_DOC([
    LINE({ key: 'A', line_no: 7 }),
    LINE({ key: 'B', unit: 'Lump Sum', quantity: 1, rate: 5000, description: 'Mobilisation' }),
    LINE({ key: 'C', unit: 'lot', quantity: 3, basis: 'unit_rate', line_no: null }),
  ]));
  const w = writes(api);
  assert.deepEqual(w.map((c) => c.target).filter((t) => t === 'boq_items' || t === 'projects'), ['projects', 'boq_items', 'boq_items', 'boq_items']);
  const projectIndex = w.findIndex((c) => c.target === 'projects');
  const lastRpc = w.map((c) => c.kind).lastIndexOf('rpc');
  assert.ok(lastRpc < w.findIndex((c) => c.target === 'boq_items'), 'lines come after the project stage walk');
  const pid = `projects-${1 + projectIndex}`;
  assert.deepEqual(w.filter((c) => c.target === 'boq_items').map((c) => c.body), [
    { project_id: pid, import_key: 'A', line_no: 7, item_code: 'SVC-001', description: 'Survey service', unit: 'm2', quantity: 100, rate: 25000, earning_basis: 'unit_rate' },
    { project_id: pid, import_key: 'B', line_no: null, item_code: 'SVC-001', description: 'Mobilisation', unit: 'Lump Sum', quantity: 1, rate: 5000, earning_basis: 'lump_sum' },
    { project_id: pid, import_key: 'C', line_no: null, item_code: 'SVC-001', description: 'Survey service', unit: 'lot', quantity: 3, rate: 25000, earning_basis: 'unit_rate' },
  ]);
  for (const c of w.filter((x) => x.target === 'boq_items')) assert.equal('org_id' in c.body, false);
});

test('AC-CQ-017: known keys are skipped even when the file differs; re-running writes nothing; no PATCH ever', async () => {
  const api = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING()], budget_versions: [{ id: 'v-1', project_id: 'p-1', status: 'Active', version: 1 }],
    boq_items: [{ id: 'b-1', project_id: 'p-1', import_key: 'A', quantity: 1 }] } });
  const actions = await linesLoad(api);
  assert.deepEqual(writes(api).map((c) => [c.kind, c.body.import_key]), [['post', 'B']]);
  assert.deepEqual(actions.filter((a) => a.kind.startsWith('contract_line')).map((a) => [a.kind, a.line_key]), [
    ['contract_line.skip', 'A'], ['contract_line.create', 'B'],
  ]);
  assert.match(actions.find((a) => a.kind === 'contract_line.skip').reason, /correct it in the app/);

  const before = writes(api).length;
  const rerun = await linesLoad(api);
  assert.equal(writes(api).length, before, 're-run: zero writes');
  assert.deepEqual(new Set(rerun.filter((a) => a.kind.startsWith('contract_line')).map((a) => a.kind)), new Set(['contract_line.skip']));
  assert.equal(api.calls.some((c) => c.kind === 'patch' && c.target === 'boq_items'), false);
});

test('AC-CQ-017: a raced 23505 is a skip, not an error; any other refusal stops and reports what was done', async () => {
  const raced = fakeApi({ tables: { companies: COMPANIES() }, fail: (k, t, b) => t === 'boq_items' && b.import_key === 'A' && '23505' });
  const actions = await linesLoad(raced);
  assert.deepEqual(actions.filter((a) => a.kind.startsWith('contract_line')).map((a) => [a.kind, a.line_key]), [
    ['contract_line.skip', 'A'], ['contract_line.create', 'B'],
  ]);

  const doc = LINES_DOC([LINE({ key: 'A' }), LINE({ key: 'B' }), LINE({ key: 'C' })]);
  const stopped = fakeApi({ tables: { companies: COMPANIES() }, fail: (k, t, b) => t === 'boq_items' && b.import_key === 'B' && '42501' });
  const { plan } = await resolveLoad(doc, stopped);
  await assert.rejects(applyLoad(plan, stopped, { dryRun: false, batchId: 'b', importedAt: 't' }), (e) => {
    assert.equal(e.code, '42501');
    assert.deepEqual(e.loadReport.failed, { kind: 'contract_line.create', key: 'ORG-001', line_key: 'B' });
    assert.deepEqual(e.loadReport.done.filter((a) => a.kind.startsWith('contract_line')).map((a) => [a.kind, a.line_key]), [['contract_line.create', 'A']]);
    return true;
  });
  assert.equal(writes(stopped).filter((c) => c.target === 'boq_items').length, 2, 'C is never attempted');
});

test('AC-CQ-017: a dry run lists the line actions and makes GETs only; no allocation or BAST is ever written', async () => {
  const api = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING()], budget_versions: [{ id: 'v-1', project_id: 'p-1', status: 'Active', version: 1 }] } });
  const actions = await linesLoad(api, LINES_DOC(), true);
  assert.deepEqual(writes(api), []);
  assert.deepEqual(actions.filter((a) => a.kind.startsWith('contract_line')).map((a) => [a.kind, a.line_key]), [['contract_line.create', 'A'], ['contract_line.create', 'B']]);

  const live = fakeApi({ tables: { companies: COMPANIES() } });
  await linesLoad(live);
  const targets = new Set(writes(live).map((c) => c.target));
  for (const banned of ['work_order_lines', 'work_order_acceptances', 'work_order_acceptance_lines']) assert.equal(targets.has(banned), false, banned);
});

test('AC-CQ-017: a project that diverged from the file gets no contract-line writes', async () => {
  const api = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING({ status: 'Loss Tender' })] } });
  const actions = await linesLoad(api);
  assert.deepEqual(writes(api), []);
  assert.deepEqual(actions.map((a) => a.kind), ['project.diverged']);
});

// ── #1326 AC-TVC-004: SBP travel and vehicle lines leave Special expenses ─────────────────────────────

test('AC-TVC-004: SBP travel, hotel, ticket and per-diem lines classify as Travel & accommodation', () => {
  for (const description of [
    'Travel & lodging (SBP: ticket + hotel, accommodation, MCU, travel expenses)',
    'Hotel', 'Flight tickets', 'Per diem', 'per-diem site team', 'Accommodation', 'Uang harian', 'Tiket pesawat', 'Penginapan',
  ]) {
    assert.equal(classifyBudgetLineCategory('Special expenses', description), 'Travel & accommodation', description);
  }
});

test('AC-TVC-004: SBP vehicle rental and fuel lines classify as Vehicle', () => {
  for (const description of ['Vehicle (SBP: rental + fuel)', 'Vehicle rental', 'Sewa kendaraan', 'BBM mobil operasional', 'Fuel for site trucks', 'Rental + fuel']) {
    assert.equal(classifyBudgetLineCategory('Special expenses', description), 'Vehicle', description);
  }
});

test('AC-TVC-004: fuel without a vehicle word stays in Special expenses (a generator is not a vehicle)', () => {
  for (const description of ['BBM genset', 'Fuel', 'BBM', 'Bahan bakar generator']) {
    assert.equal(classifyBudgetLineCategory('Special expenses', description), 'Special expenses', description);
  }
});

test('AC-TVC-004: everything else keeps its category — no guess on other, ambiguous or non-Special lines', () => {
  assert.equal(classifyBudgetLineCategory('Special expenses', 'Special expenses (SBP section 4: user / Migas / social / other / GoI)'), 'Special expenses');
  assert.equal(classifyBudgetLineCategory('Special expenses', 'Travel and fuel'), 'Special expenses', 'both kinds: never guess');
  assert.equal(classifyBudgetLineCategory('Special expenses', 'Hotelier fees'), 'Special expenses', 'whole words only');
  assert.equal(classifyBudgetLineCategory('Special expenses', undefined), 'Special expenses');
  assert.equal(classifyBudgetLineCategory('Labor', 'Travel crew'), 'Labor', 'only Special expenses lines are reclassified');
  assert.equal(classifyBudgetLineCategory('Overheads', 'Fuel for generator'), 'Overheads');
  assert.equal(classifyBudgetLineCategory('Vehicle', 'Hotel'), 'Vehicle', 'a category the file already chose stands');
});

test('AC-TVC-004: the new categories are valid in a load file', () => {
  assert.deepEqual(validateLoadFile({ projects: [{ name: 'X', client: 'A', stage: 'Leads', budget: [
    { category: 'Travel & accommodation', budgeted_amount: 1 }, { category: 'Vehicle', budgeted_amount: 2 },
  ] }] }), []);
});

const SBP_DOC = () => ({ projects: [{
  code: 'ORG-001', name: 'Plant upgrade', client: 'Client Legal A', stage: 'Leads',
  budget: [
    { category: 'Special expenses', description: 'Travel & lodging (SBP: ticket + hotel)', budgeted_amount: 300 },
    { category: 'Special expenses', description: 'Vehicle (SBP: rental + fuel)', budgeted_amount: 200 },
    { category: 'Special expenses', description: 'Special expenses (SBP section 4)', budgeted_amount: 100 },
  ],
}] });

test('AC-TVC-004: a load writes SBP travel/vehicle lines under the new categories, keyed by the file line so re-runs match', async () => {
  const api = fakeApi({ tables: { companies: COMPANIES() } });
  await load(api, SBP_DOC());
  assert.deepEqual(writes(api).filter((c) => c.target === 'import_budget_line_v2').map((c) => [c.body.p_category, c.body.p_budgeted_amount, c.body.p_legacy_key]), [
    ['Travel & accommodation', 300, 'fp:ORG-001|Special expenses|Travel & lodging (SBP: ticket + hotel)||300'],
    ['Vehicle', 200, 'fp:ORG-001|Special expenses|Vehicle (SBP: rental + fuel)||200'],
    ['Special expenses', 100, 'fp:ORG-001|Special expenses|Special expenses (SBP section 4)||100'],
  ]);
});

test('AC-TVC-004: a Draft loaded before #1326 (lines still Special expenses) is not loaded twice', async () => {
  const api = fakeApi({ tables: {
    companies: COMPANIES(), projects: [EXISTING({ status: 'Leads', contract_value: 0 })],
    budget_versions: [{ id: 'v-1', project_id: 'p-1', status: 'Draft', version: 1 }],
    budget_line_items: [
      { id: 'l-1', budget_version_id: 'v-1', category: 'Special expenses', import_key: 'fp:ORG-001|Special expenses|Travel & lodging (SBP: ticket + hotel)||300' },
      { id: 'l-2', budget_version_id: 'v-1', category: 'Special expenses', import_key: 'fp:ORG-001|Special expenses|Vehicle (SBP: rental + fuel)||200' },
      { id: 'l-3', budget_version_id: 'v-1', category: 'Special expenses', import_key: 'fp:ORG-001|Special expenses|Special expenses (SBP section 4)||100' },
    ],
  } });
  await assert.rejects(load(api, SBP_DOC()), /ambiguous identity.*line l-1/);
  assert.equal(api.tables.budget_line_items.length, 3);
});

test('AC-TVC-004: the load output lists each reclassified line and each fuel line kept in Special expenses', async () => {
  const api = fakeApi({ tables: { companies: COMPANIES() } });
  const doc = { projects: [{
    code: 'ORG-001', name: 'Plant upgrade', client: 'Client Legal A', stage: 'Leads',
    budget: [
      { category: 'Labor', description: 'Crew', budgeted_amount: 10 },
      { category: 'Special expenses', description: 'BBM genset', budgeted_amount: 20 },
      { category: 'Special expenses', description: 'BBM mobil operasional', budgeted_amount: 30 },
      { category: 'Special expenses', description: 'Migas permits', budgeted_amount: 40 },
    ],
  }] };
  for (const dryRun of [true, false]) {
    const actions = await load(dryRun ? fakeApi({ tables: { companies: COMPANIES() } }) : api, doc, dryRun);
    assert.deepEqual(actions.filter((a) => a.kind === 'budget.category'), [
      { kind: 'budget.category', key: 'ORG-001', row: 1, description: 'BBM genset', from: 'Special expenses', to: 'Special expenses',
        reason: 'fuel with no vehicle word — kept in Special expenses' },
      { kind: 'budget.category', key: 'ORG-001', row: 2, description: 'BBM mobil operasional', from: 'Special expenses', to: 'Vehicle',
        reason: 'vehicle' },
    ], dryRun ? 'dry run' : 'load');
  }
  assert.deepEqual(writes(api).filter((c) => c.target === 'import_budget_line_v2').map((c) => [c.body.p_description, c.body.p_category]), [
    ['Crew', 'Labor'], ['BBM genset', 'Special expenses'], ['BBM mobil operasional', 'Vehicle'], ['Migas permits', 'Special expenses'],
  ]);
});

test('AC-004 #1325: project aliases validate as optional text and creation sends the trimmed alias separately', async () => {
  const doc = { projects: [{ name: 'Legal project name', short_name: '  Depot  ', client: 'Client Legal A', stage: 'Leads' }] };
  assert.deepEqual(validateLoadFile(doc), []);
  assert.match(validateLoadFile({ projects: [{ ...doc.projects[0], short_name: 7 }] })[0], /"short_name" must be text/);
  const api = fakeApi({ tables: { companies: COMPANIES() } });
  await load(api, doc);
  const created = writes(api).find((call) => call.kind === 'post' && call.target === 'projects');
  assert.equal(created.body.name, 'Legal project name');
  assert.equal(created.body.short_name, 'Depot');
  assert.ok(api.calls.some((call) => call.kind === 'get' && call.target === 'projects' && call.query.includes('short_name')));
});

test('AC-004 #1325: alias backfill is resumable, fills empty only, and reports conflicting nonblank values', async () => {
  const doc = { projects: [{ name: 'Plant upgrade', short_name: 'Depot', client: 'Client Legal A', stage: 'Leads' }] };
  const api = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING({ status: 'Leads', contract_value: 0, short_name: '  ' })] } });
  await load(api, doc);
  assert.deepEqual(writes(api).filter((call) => call.target === 'projects'), [
    { kind: 'patch', target: 'projects', query: 'id=eq.p-1', body: { short_name: 'Depot' } },
  ]);
  const count = writes(api).length;
  const retry = await load(api, doc);
  assert.equal(writes(api).length, count);
  assert.ok(retry.some((action) => action.kind === 'project.skip'));

  const conflictApi = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING({ status: 'Leads', contract_value: 0, short_name: 'Existing alias' })] } });
  const conflict = await load(conflictApi, doc);
  assert.deepEqual(writes(conflictApi), []);
  assert.ok(conflict.some((action) => action.kind === 'project.short_name_differs' && action.current === 'Existing alias' && action.file === 'Depot'));
});

test('AC-004 #1325: dry-run and zero-row refusal preserve alias-only write semantics; diverged stages remain skipped', async () => {
  const doc = { projects: [{ name: 'Plant upgrade', short_name: 'Depot', client: 'Client Legal A', stage: 'Leads' }] };
  const dry = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING({ status: 'Leads', contract_value: 0 })] } });
  const dryActions = await load(dry, doc, true);
  assert.deepEqual(writes(dry), []);
  assert.ok(dryActions.some((action) => action.kind === 'project.set_short_name'));

  const zeroRows = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING({ status: 'Leads', contract_value: 0 })] } });
  const patch = zeroRows.patch.bind(zeroRows);
  zeroRows.patch = async (...args) => args[0] === 'projects' ? [] : patch(...args);
  const { plan } = await resolveLoad(doc, zeroRows);
  await assert.rejects(applyLoad(plan, zeroRows, { dryRun: false, batchId: 'b', importedAt: 't' }), /short name.*database did not allow it/i);

  const diverged = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING({ status: 'Loss Tender', contract_value: 0 })] } });
  const divergedActions = await load(diverged, doc);
  assert.deepEqual(writes(diverged), []);
  assert.ok(divergedActions.some((action) => action.kind === 'project.diverged'));
});

const SHORT_NAME_TAKEN = () => Object.assign(
  new Error('duplicate key value violates unique constraint "projects_org_short_name_uidx"'), { code: '23505', status: 409 });

test('AC-004 #1325: a short name already used in the org is reported as a conflict on backfill, not a failed load', async () => {
  const doc = { projects: [{ name: 'Plant upgrade', short_name: 'Depot', client: 'Client Legal A', stage: 'Leads' }] };
  const api = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING({ status: 'Leads', contract_value: 0 })] } });
  api.patch = async (t, q, body) => { api.calls.push({ kind: 'patch', target: t, query: q.toString(), body }); throw SHORT_NAME_TAKEN(); };
  const actions = await load(api, doc);
  assert.ok(actions.some((a) => a.kind === 'project.short_name_conflict'));
  assert.ok(!actions.some((a) => a.kind === 'project.set_short_name'));
});

test('AC-004 #1325: creating a project whose short name is taken still creates it, without the alias, and reports the conflict', async () => {
  const doc = { projects: [{ name: 'Legal project name', short_name: 'Depot', client: 'Client Legal A', stage: 'Leads' }] };
  const api = fakeApi({ tables: { companies: COMPANIES() } });
  const post = api.post.bind(api);
  api.post = async (t, body) => { if (t === 'projects' && body.short_name) { api.calls.push({ kind: 'post', target: t, body }); throw SHORT_NAME_TAKEN(); } return post(t, body); };
  const actions = await load(api, doc);
  const created = api.calls.filter((c) => c.kind === 'post' && c.target === 'projects');
  assert.equal(created.length, 2);
  assert.equal(created[1].body.short_name, undefined);
  assert.equal(created[1].body.name, 'Legal project name');
  assert.ok(actions.some((a) => a.kind === 'project.short_name_conflict' && a.file === 'Depot'));
});

test('#1316: a Client and a Vendor with one legal name resolve to the Client, for client and end_client', async () => {
  const both = (name, id) => [
    { id: `${id}-v`, name, type: 'Vendor', short_name: null, archived_at: null },
    { id: `${id}-c`, name, type: 'Client', short_name: null, archived_at: null },
  ];
  const api = fakeApi({ tables: { companies: [...both('Client Legal A', 'a'), ...both('Owner Legal B', 'b')] } });
  const { problems, plan } = await resolveLoad({ projects: [DOC().projects[0]] }, api);
  assert.deepEqual(problems, []);
  assert.ok(api.calls.some((c) => c.kind === 'get' && c.target === 'companies' && /type/.test(c.query)));
  const [p] = plan.projects;
  assert.equal(p.client.id, 'a-c');
  assert.equal(p.endClient.id, 'b-c');
});

test('#1316: two Clients with one legal name stay ambiguous, for client and end_client', async () => {
  const twin = (name, id) => [1, 2].map((n) => ({ id: `${id}-${n}`, name, type: 'Client', short_name: null, archived_at: null }));
  const api = fakeApi({ tables: { companies: [...twin('Client Legal A', 'a'), ...twin('Owner Legal B', 'b')], projects: [EXISTING()] } });
  const { problems } = await resolveLoad({ projects: [DOC().projects[0]] }, api);
  assert.equal(problems.length, 2, problems.join('\n'));
  assert.match(problems[0], /more than one company is named "Client Legal A"/);
  assert.match(problems[1], /more than one company is named "Owner Legal B"/);
});

test('#1316: a name held only by a Vendor still resolves as before, and two Vendors stay ambiguous', async () => {
  const vendor = (id) => ({ id, name: 'Client Legal A', type: 'Vendor', short_name: null, archived_at: null });
  const one = await resolveLoad({ projects: [DOC().projects[1]] }, fakeApi({ tables: { companies: [vendor('v-1')] } }));
  assert.deepEqual(one.problems, []);
  assert.equal(one.plan.projects[0].client.id, 'v-1');
  const two = await resolveLoad({ projects: [DOC().projects[1]] }, fakeApi({ tables: { companies: [vendor('v-1'), vendor('v-2')] } }));
  assert.match(two.problems[0], /more than one company is named/);
});

test('budget planning retains rows for transactional classification and reports conflict', async () => {
  const api = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING()],
    budget_versions: [{ id: 'v-1', project_id: 'p-1', status: 'Draft', version: 1 }],
    budget_line_items: [{ budget_version_id: 'v-1', import_key: 'R-2' }] } });
  const { problems, plan } = await resolveLoad({ projects: [DOC().projects[0]] }, api);
  assert.deepEqual(problems, []);
  assert.equal(plan.projects[0].budget.lines.length, 2);
  api.rpc = async (name, body) => {
    assert.equal(name, 'import_budget_line_v2');
    assert.match(body.p_v2_key, /^bimp2:/);
    return [{ outcome: 'conflict', line_id: 'old-line' }];
  };
  await assert.rejects(applyLoad(plan, api, { dryRun: false }), /old-line/);
});

test('budget validation keeps distinct references and collision-shaped source rows', () => {
  const project = { name: 'X', client: 'A', stage: 'Leads', budget: [
    { category: 'Labor', description: 'A|B', fiscal_year: 'C', budgeted_amount: 1 },
    { category: 'Labor', description: 'A', fiscal_year: 'B|C', budgeted_amount: 1 },
    { category: 'Labor', description: 'A|B', fiscal_year: 'C', budgeted_amount: 1, reference: 'fp:X | A|Labor|A|B|C|1' },
  ] };
  assert.deepEqual(validateLoadFile({ projects: [project] }), []);
});

test('budget retry preserves successful rows, resolves a new project id, and normalizes amounts', async () => {
  const doc = { projects: [{ code: 'NEW', name: 'New', client: 'Client Legal A', stage: 'Leads', budget: [
    { category: 'Labor', budgeted_amount: 0.30000000000000004, reference: 'A' },
    { category: 'Labor', budgeted_amount: 1, reference: 'B' },
    { category: 'Labor', budgeted_amount: 2, reference: 'C' },
  ] }] };
  let failSecond = true;
  const api = fakeApi({ tables: { companies: COMPANIES() }, fail: (_kind, target, body) =>
    target === 'import_budget_line_v2' && body.p_legacy_key === 'B' && failSecond && '23505' });
  await assert.rejects(load(api, doc), (err) => {
    assert.equal(err.code, '23505');
    assert.equal(err.status, 403);
    assert.equal(err.loadReport.failed.key, 'NEW');
    assert.equal(err.loadReport.failed.row, 2);
    assert.ok(err.loadReport.done.some((a) => a.kind === 'budget.line.created' && a.row === 1));
    return true;
  });
  assert.equal(api.calls.filter((c) => c.target === 'import_budget_line_v2').length, 2);
  const first = api.calls.find((c) => c.target === 'import_budget_line_v2');
  assert.equal(first.body.p_budgeted_amount, 0.3);
  assert.equal(first.body.p_v2_key, 'bimp2:["r","A"]');
  assert.equal(api.tables.budget_line_items.length, 1);
  failSecond = false;
  const report = await load(api, doc);
  assert.equal(report.find((a) => a.kind === 'budget.lines').created, 2);
  assert.equal(report.find((a) => a.kind === 'budget.lines').skipped, 1);
  assert.equal(api.tables.budget_line_items.length, 3);
});

test('new project fingerprint uses resolved project id and classified category', async () => {
  const api = fakeApi({ tables: { companies: COMPANIES() } });
  await load(api, SBP_DOC());
  const project = api.tables.projects[0];
  const first = api.calls.find((c) => c.target === 'import_budget_line_v2').body;
  assert.equal(first.p_v2_key, `bimp2:${JSON.stringify(['f', project.id.toLowerCase(), 'Travel & accommodation', 'Travel & lodging (SBP: ticket + hotel)', '', '300.00'])}`);
  assert.equal(first.p_legacy_key, 'fp:ORG-001|Special expenses|Travel & lodging (SBP: ticket + hotel)||300');
});

test('budget authority responses without a line id fail the load', async () => {
  const api = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING()],
    budget_versions: [{ id: 'v-1', project_id: 'p-1', status: 'Draft', version: 1 }] } });
  const doc = { projects: [DOC().projects[0]] };
  api.rpc = async () => [{ outcome: 'created', line_id: null }];
  await assert.rejects(load(api, doc), /Unexpected budget import result/);
});

test('loader preserves its accepted sub-cent floating noise at validation and apply', async () => {
  const doc = { projects: [{ name: 'X', client: 'Client Legal A', stage: 'Leads', budget: [{ category: 'Labor', budgeted_amount: 1.000000005 }] }] };
  assert.deepEqual(validateLoadFile(doc), []);
  const api = fakeApi({ tables: { companies: COMPANIES() } });
  await load(api, doc);
  const body = api.calls.find((c) => c.target === 'import_budget_line_v2').body;
  assert.equal(body.p_budgeted_amount, 1);
  assert.equal(body.p_legacy_key, 'fp:X | Client Legal A|Labor|||1.000000005');
});

test('loader reports a historical key equal to the new identity as a conflict', async () => {
  const doc = { projects: [{ code: 'ORG-001', name: 'Plant upgrade', client: 'Client Legal A', stage: 'Ongoing Project',
    budget: [{ category: 'Labor', budgeted_amount: 1, reference: 'R' }] }] };
  const api = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING()],
    budget_versions: [{ id: 'v-1', project_id: 'p-1', status: 'Draft', version: 1 }],
    budget_line_items: [{ id: 'old-line', budget_version_id: 'v-1', import_key: 'bimp2:["r","R"]' }] } });
  await assert.rejects(load(api, doc), /row 1.*old-line/);
  assert.equal(api.tables.budget_line_items.length, 1);
});

test('loader reports a legacy fp-prefixed reference as ambiguous', async () => {
  const doc = { projects: [{ code: 'ORG-001', name: 'Plant upgrade', client: 'Client Legal A', stage: 'Ongoing Project',
    budget: [{ category: 'Labor', budgeted_amount: 1, reference: 'fp:ambiguous' }] }] };
  const api = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING()],
    budget_versions: [{ id: 'v-1', project_id: 'p-1', status: 'Draft', version: 1 }],
    budget_line_items: [{ id: 'old-line', budget_version_id: 'v-1', import_key: 'fp:ambiguous' }] } });
  await assert.rejects(load(api, doc), /row 1.*old-line/);
  assert.equal(api.tables.budget_line_items.length, 1);
});


test('budget malformed and uncertain transport failures identify the row and preserve completed work', async () => {
  for (const mode of ['malformed', 'transport']) {
    const doc = { projects: [DOC().projects[0]] };
    const api = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING()],
      budget_versions: [{ id: 'v-1', project_id: 'p-1', status: 'Draft', version: 1 }] } });
    const rpc = api.rpc.bind(api);
    let n = 0;
    const transport = Object.assign(new Error('connection lost; outcome unknown'), { code: 'NETWORK' });
    api.rpc = async (...args) => {
      n += 1;
      const result = await rpc(...args);
      if (n === 2) {
        if (mode === 'transport') throw transport;
        return [];
      }
      return result;
    };
    await assert.rejects(load(api, doc), (err) => {
      if (mode === 'transport') assert.equal(err, transport);
      else assert.match(err.message, /Unexpected budget import result/);
      assert.equal(err.loadReport.failed.key, 'ORG-001');
      assert.equal(err.loadReport.failed.row, 2);
      assert.ok(err.loadReport.done.some((a) => a.kind === 'budget.line.created' && a.row === 1));
      return true;
    });
    assert.equal(api.tables.budget_line_items.length, 2); // The server committed before the response was lost or malformed.
    const retry = await load(api, doc);
    assert.equal(retry.find((a) => a.kind === 'budget.lines').skipped, 2);
  }
});
