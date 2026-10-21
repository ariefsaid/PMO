/**
 * pmo-load.test.mjs — `pmo load` planner/executor (#796). Run: node --test scripts/pmo-load.test.mjs
 * A fake LoadApi (no HTTP, no DB). The database half is pgTAP: api_client_seed_surface.test.sql
 * (AC-CSD-013) and client_starting_data_sequence.test.sql (AC-CSD-015).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { defaultContractLineBasis, LOAD_STAGE_PATHS, remainingPath, validateLoadFile } from './lib/pmo-load.mjs';

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
    'projects[3] (C-1): budget[0]: "category" must be one of: Labor, Materials, Subcontractors, Equipment, Permits & Fees, Overheads, Contingency, Special expenses',
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
  assert.deepEqual(attach.lines.map((l) => l.import_key), ['fp:ORG-001|Labor|Crew||400000']);
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
    'post budget_versions', 'post budget_line_items', 'post budget_line_items',
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
  assert.deepEqual(writes(api).filter((c) => c.target === 'budget_line_items').map((c) => c.body), [
    { budget_version_id: 'budget_versions-4', category: 'Labor', description: 'Crew', budgeted_amount: 400000, fiscal_year: null,
      import_batch_id: 'batch-1', imported_at: '2026-10-06T00:00:00.000Z', import_key: 'fp:ORG-001|Labor|Crew||400000' },
    { budget_version_id: 'budget_versions-4', category: 'Special expenses', description: 'Permits', budgeted_amount: 50000, fiscal_year: null,
      import_batch_id: 'batch-1', imported_at: '2026-10-06T00:00:00.000Z', import_key: 'R-2' },
  ]);
});

test('AC-CSD-010: an existing Draft is reused with its loaded keys skipped; an Active version skips the budget; 23505 is a skip', async () => {
  const doc = { projects: [DOC().projects[0]] };
  const draft = fakeApi({ tables: {
    companies: COMPANIES(), projects: [EXISTING()],
    budget_versions: [{ id: 'v-1', project_id: 'p-1', status: 'Draft', version: 1 }],
    budget_line_items: [{ id: 'l-1', budget_version_id: 'v-1', import_key: 'R-2' }],
  } });
  await load(draft, doc);
  assert.deepEqual(writes(draft).map((c) => [c.target, c.body.budget_version_id, c.body.import_key]), [
    ['budget_line_items', 'v-1', 'fp:ORG-001|Labor|Crew||400000'],
  ]);

  const active = fakeApi({ tables: { companies: COMPANIES(), projects: [EXISTING()], budget_versions: [{ id: 'v-1', project_id: 'p-1', status: 'Active', version: 1 }] } });
  const actions = await load(active, doc);
  assert.deepEqual(writes(active), []);
  assert.equal(actions.find((a) => a.kind === 'budget.skip').key, 'ORG-001');

  const raced = fakeApi({ fail: (kind, target, body) => target === 'budget_line_items' && body.import_key === 'R-2' && '23505' });
  const lines = (await load(raced)).find((a) => a.kind === 'budget.lines');
  assert.equal(lines.created, 1);
  assert.equal(lines.skipped, 1);
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
  assert.equal(writes(api).length, before);
  assert.deepEqual(new Set(rerun.map((a) => a.kind)), new Set(['company.skip', 'project.skip', 'budget.skip']));
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
