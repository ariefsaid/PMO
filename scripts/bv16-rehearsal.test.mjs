import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateConfig,
  createRoutedFetch,
  assertBaselineBudgets,
  assertRevisionBudgets,
  cleanupPlan,
  sanitizeEvidence,
  parseArgs,
} from './bv16-rehearsal.mjs';

const config = () => ({
  localApi: 'http://127.0.0.1:54321',
  localServiceKey: 'local-service-key',
  localAnonKey: 'local-anon-key',
  firstActorJwt: 'first-actor-jwt',
  secondActorJwt: 'second-actor-jwt',
  rehearsalOrigin: 'https://v16-rehearsal.example.test',
  rehearsalSite: 'isolated-v16-copy',
  erpAuthorization: 'token local-fixture:local-fixture-secret',
  company: 'Example Co',
  salaryAccount: 'Salary - EX',
  cogsAccount: 'COGS - EX',
  fiscalYear: '2026',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
});

test('AC-BV16-008 CLI accepts only the plan-specified FD3 config and optional retain flag', () => {
  assert.deepEqual(parseArgs(['--config-fd', '3']), { retainRun: false, configFd: 3 });
  assert.deepEqual(parseArgs(['--config-fd', '3', '--retain-run']), { retainRun: true, configFd: 3 });
  for (const args of [['--config-fd', '4'], ['--config-fd'], ['3'], ['--config-fd', '3', '--config-fd', '3']]) {
    assert.throws(() => parseArgs(args), /arguments/i);
  }
});

test('AC-BV16-008 guard accepts an explicit isolated local-to-HTTPS rehearsal config', () => {
  assert.equal(validateConfig(config()).rehearsalOrigin, 'https://v16-rehearsal.example.test');
});

test('AC-BV16-008 guard rejects every unsafe or incomplete target/configuration', () => {
  const invalid = [
    { localApi: 'https://127.0.0.1:54321' },
    { localApi: 'http://192.168.1.4:54321' },
    { localApi: 'http://localhost:54321' },
    { rehearsalSite: '' },
    { rehearsalSite: 'frontend' },
    { rehearsalOrigin: 'http://v16-rehearsal.example.test' },
    { rehearsalOrigin: 'https://v16-rehearsal.example.test/path' },
    { rehearsalOrigin: 'https://user@v16-rehearsal.example.test' },
    { firstActorJwt: 'same-actor', secondActorJwt: 'same-actor' },
    { cogsAccount: 'Salary - EX' },
    { fiscalYear: 'not-a-year' },
    { startDate: '2026-12-31', endDate: '2026-01-01' },
    { localServiceKey: '' },
    { localAnonKey: '' },
    { erpAuthorization: '' },
    { company: '' },
  ];
  for (const patch of invalid) {
    assert.throws(() => validateConfig({ ...config(), ...patch }), /rehearsal configuration/i, JSON.stringify(patch));
  }
  for (const field of Object.keys(config())) {
    assert.throws(() => validateConfig(Object.fromEntries(Object.entries(config()).filter(([key]) => key !== field))), /rehearsal configuration/i, `missing ${field}`);
  }
});

test('AC-BV16-008 routed HTTP follows neither redirects nor non-allowlisted origins and forbids harness Budget writes', async () => {
  const seen = [];
  const routed = createRoutedFetch(validateConfig(config()), async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response('ok', { status: 200 });
  });
  await routed('http://127.0.0.1:54321/rest/v1/projects', { method: 'GET' });
  await routed('https://v16-rehearsal.example.test/api/resource/Project', { method: 'POST', body: '{}' });
  await assert.rejects(routed('https://other.example.test/api/resource/Project'), /outside the rehearsal allowlist/);
  await assert.rejects(routed('https://v16-rehearsal.example.test/api/resource/Budget', { method: 'POST', body: '{}' }), /Budget writes are forbidden/);
  assert.deepEqual(seen.map(({ url }) => new URL(url).origin), [config().localApi, config().rehearsalOrigin]);
  assert.ok(seen.every(({ init }) => init.redirect === 'manual'));
});

const controls = { action_if_accumulated_monthly_budget_exceeded: 'Warn', action_if_annual_budget_exceeded: 'Warn', action_if_annual_budget_exceeded_on_mr: 'Warn', action_if_accumulated_monthly_budget_exceeded_on_mr: 'Warn', action_if_annual_budget_exceeded_on_po: 'Warn', action_if_accumulated_monthly_budget_exceeded_on_po: 'Warn', applicable_on_material_request: 0, applicable_on_purchase_order: 0, applicable_on_booking_actual_expenses: 1 };
const baseline = [
  { ...controls, name: 'SAL-1', account: 'Salary - EX', budget_amount: 50000, from_fiscal_year: '2026', to_fiscal_year: '2026', docstatus: 1, distribution_frequency: 'Monthly', distribute_equally: 1, modified: '2026-10-01 00:00:00' },
  { ...controls, name: 'COGS-1', account: 'COGS - EX', budget_amount: 25000, from_fiscal_year: '2026', to_fiscal_year: '2026', docstatus: 1, distribution_frequency: 'Monthly', distribute_equally: 1, modified: '2026-10-01 00:00:00' },
];

test('AC-BV16-008 baseline oracle requires exactly two correct submitted account Budgets', () => {
  assert.equal(assertBaselineBudgets(baseline, config()), 2);
  assert.throws(() => assertBaselineBudgets([...baseline, { ...baseline[0], name: 'duplicate' }], config()), /exactly two/i);
  assert.throws(() => assertBaselineBudgets([{ ...baseline[0], docstatus: 0 }, baseline[1]], config()), /submitted/i);
  assert.throws(() => assertBaselineBudgets([{ ...baseline[0], fiscal_year: '2026' }, baseline[1]], config()), /fiscal_year/i);
});

test('AC-BV16-008 revision oracle proves only Salary amended and replay is a no-op', () => {
  const revision = {
    before: baseline,
    after: [
      { ...baseline[0], docstatus: 2 },
      baseline[1],
      { ...baseline[0], name: 'SAL-2', amended_from: 'SAL-1', budget_amount: 60000 },
    ],
    replay: [
      { ...baseline[0], docstatus: 2 }, baseline[1],
      { ...baseline[0], name: 'SAL-2', amended_from: 'SAL-1', budget_amount: 60000 },
    ],
  };
  assert.equal(assertRevisionBudgets(revision, config()), 3);
  assert.throws(() => assertRevisionBudgets({ ...revision, after: [...revision.after, { ...baseline[1], name: 'COGS-2' }] }, config()), /COGS.*unchanged/i);
  assert.throws(() => assertRevisionBudgets({ ...revision, replay: [...revision.replay, { ...baseline[1], name: 'extra' }] }, config()), /replay/i);
});

test('AC-BV16-008 cleanup plan is restricted to snapshotted local rows and named run-owned ERP documents', () => {
  const plan = cleanupPlan({ runToken: 'run-opaque-1', localRows: [{ table: 'budget_versions', id: 'v1' }], projectName: 'ERP-PROJ-1', budgetNames: ['SAL-1', 'COGS-1'] });
  assert.deepEqual(plan.erpBudgetNames, ['SAL-1', 'COGS-1']);
  assert.throws(() => cleanupPlan({ runToken: 'x', localRows: [{ table: 'budget_versions', id: '*' }], projectName: 'ERP-PROJ-1', budgetNames: ['SAL-1'] }), /wildcard/i);
  assert.throws(() => cleanupPlan({ runToken: 'x', localRows: [], projectName: 'ERP-PROJ-1', budgetNames: ['*'] }), /wildcard/i);
});

test('AC-BV16-008 evidence sanitizer excludes credentials, coordinates, account labels, and document names', () => {
  const safe = sanitizeEvidence({ localServiceKey: 'secret1', firstActorJwt: 'jwt1', rehearsalOrigin: 'https://private.test', salaryAccount: 'Salary - EX', documentNames: ['SAL-1'], counts: { created: 2 }, amounts: [50000, 25000], runToken: 'opaque-run' });
  assert.deepEqual(safe, { counts: { created: 2 }, amounts: [50000, 25000], runToken: 'opaque-run' });
  assert.doesNotMatch(JSON.stringify(safe), /secret1|jwt1|private|Salary|SAL-1/);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Tasks 42–44: the harness flow, driven against an in-memory simulation of local PMO + the rehearsal
// ERP. ⚑ These tests prove the HARNESS (routing, ordering, oracles, cleanup scoping, honest failure).
// They are NOT the AC-BV16-008 owner result — that is the Director's real run (plan tasks 45–46).
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runRehearsal,
  budgetAccountIdentity,
  budgetAccountPushKey,
  assertLocalWitnesses,
  pollUntil,
  BUDGET_LIST_FIELDS,
} from './bv16-rehearsal.mjs';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTIONS = ['action_if_annual_budget_exceeded', 'action_if_accumulated_monthly_budget_exceeded', 'action_if_annual_budget_exceeded_on_mr', 'action_if_accumulated_monthly_budget_exceeded_on_mr', 'action_if_annual_budget_exceeded_on_po', 'action_if_accumulated_monthly_budget_exceeded_on_po'];
const SECRETS = () => [config().localServiceKey, config().localAnonKey, config().firstActorJwt, config().secondActorJwt, config().erpAuthorization, 'local-fixture-secret'];

/** A simulated world: local PMO (auth, PostgREST, RPCs, the served adapter-dispatch) + the rehearsal ERP.
 *  The dispatch emulation stands in for the shipped edge function, so its ERP writes are NOT harness calls. */
function fakeWorld(knobs = {}) {
  const cfg = config();
  const calls = [];
  const priorMap = [
    { org_id: ORG, category: 'Labor', erp_account: 'Old Labor - EX', is_push_target: true },
    { org_id: ORG, category: 'Travel', erp_account: 'COGS - EX', is_push_target: true },
  ];
  const db = {
    binding: {
      org_id: ORG, external_tier: 'erpnext', site_url: cfg.rehearsalOrigin, version_major: 16,
      activated_at: '2026-10-01T00:00:00+00:00',
      config: { company: cfg.company, project_map: { 'other-project': 'OTHER-ERP' }, keep: 1 },
      ...knobs.binding,
    },
    map: priorMap.map((row) => ({ ...row })),
    projects: [], versions: [], lines: [], mirrors: [], outbox: [], deleted: [],
  };
  const initialBindingConfig = structuredClone(db.binding.config);
  const initialMap = structuredClone(db.map);
  const erp = { projects: [], budgets: [], seq: 0 };
  let activations = 0;
  const json = (body, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const eq = (url, key) => { const v = url.searchParams.get(key); return v?.startsWith('eq.') ? v.slice(3) : null; };
  const inList = (url, key) => { const v = url.searchParams.get(key); return v?.startsWith('in.(') ? v.slice(4, -1).split('","').map((s) => s.replace(/^"|"$/g, '')) : null; };
  const isService = (h) => h.apikey === cfg.localServiceKey && h.Authorization === `Bearer ${cfg.localServiceKey}`;
  const actorOf = (h) => h.apikey === cfg.localAnonKey ? { [`Bearer ${cfg.firstActorJwt}`]: 'u1', [`Bearer ${cfg.secondActorJwt}`]: knobs.sameUser ? 'u1' : 'u2' }[h.Authorization] : undefined;
  const fyToken = (fy) => Buffer.from(fy).toString('hex').replace(/[a-f]/g, (ch) => 'TZ.+-:'['abcdef'.indexOf(ch)]);

  function dispatch(versionId) {
    if (knobs.neverPush) return;
    const version = db.versions.find((v) => v.id === versionId && v.status === 'Active');
    const erpProject = db.binding.config.project_map?.[version.project_id];
    const accountOf = (category) => db.map.find((row) => row.org_id === ORG && row.category === category && row.is_push_target)?.erp_account;
    for (const line of db.lines.filter((l) => l.budget_version_id === versionId)) {
      const account = accountOf(line.category);
      let amount = Number(line.budgeted_amount);
      if (knobs.wrongSalaryAmount && account === cfg.salaryAccount) amount += 1;
      const identity = `${versionId}:a:${fyToken(line.fiscal_year).length}:${fyToken(line.fiscal_year)}:${Buffer.from(account).toString('hex')}`;
      const key = `bud16:${identity}:${Date.parse(version.activated_at)}`;
      if (db.outbox.some((row) => row.idempotency_key === key)) continue;
      db.outbox.push({ id: `ob-${db.outbox.length + 1}`, pmo_record_id: identity, idempotency_key: key, state: 'confirmed' });
      const live = erp.budgets.find((b) => b.project === erpProject && b.account === account && b.docstatus === 1);
      let doc = live;
      if (!live || Number(live.budget_amount) !== amount) {
        if (live) { live.docstatus = 2; live.modified = `m-${++erp.seq}`; }
        doc = {
          name: `BUD-${++erp.seq}`, company: db.binding.config.company, project: erpProject, budget_against: 'Project',
          account, budget_amount: amount, from_fiscal_year: line.fiscal_year, to_fiscal_year: line.fiscal_year,
          distribution_frequency: 'Monthly', distribute_equally: 1, docstatus: 1, modified: `m-${erp.seq}`,
          amended_from: live?.name ?? null, applicable_on_material_request: 0, applicable_on_purchase_order: 0,
          applicable_on_booking_actual_expenses: 1, ...Object.fromEntries(ACTIONS.map((field) => [field, 'Warn'])),
        };
        erp.budgets.push(doc);
      }
      db.mirrors.push({ budget_version_id: versionId, fiscal_year: line.fiscal_year, erp_account: account, budget_intent: 'ensure', push_state: 'pushed', activated_at_witness: version.activated_at, erp_budget_name: doc.name });
    }
  }

  async function local(url, method, h, body) {
    const path = url.pathname;
    if (path === '/auth/v1/user') { const id = actorOf(h); return id ? json({ id }) : json({}, 401); }
    if (path === '/rest/v1/profiles') return isService(h) ? json([{ org_id: knobs.otherOrgFor === eq(url, 'id') ? 'other-org' : ORG }]) : json([], 401);
    if (path === '/rest/v1/external_org_bindings') {
      if (!isService(h) || eq(url, 'org_id') !== ORG || eq(url, 'external_tier') !== 'erpnext') return json([], 400);
      if (method === 'PATCH') { db.binding.config = structuredClone(body.config); return json([db.binding]); }
      return json([structuredClone(db.binding)]);
    }
    if (path === '/rest/v1/budget_category_account_map') {
      if (method === 'GET') {
        const cats = inList(url, 'category'); const accts = inList(url, 'erp_account');
        return json(db.map.filter((r) => r.org_id === eq(url, 'org_id') && (cats ? cats.includes(r.category) : accts.includes(r.erp_account))));
      }
      if (method === 'DELETE') { db.map = db.map.filter((r) => !(r.org_id === eq(url, 'org_id') && r.category === eq(url, 'category') && r.erp_account === eq(url, 'erp_account'))); return json(undefined, 204); }
      db.map.push(...body.map((r) => ({ ...r }))); return json(undefined, 201);
    }
    if (path === '/rest/v1/projects') {
      if (method === 'POST') { if (knobs.projectInsertStatus) return json({ message: 'boom' }, knobs.projectInsertStatus); db.projects.push({ ...body }); return json(undefined, 201); }
      if (method === 'DELETE') { db.deleted.push(['projects', eq(url, 'id')]); db.projects = db.projects.filter((p) => p.id !== eq(url, 'id')); return json(undefined, 204); }
    }
    if (path === '/rest/v1/budget_versions') {
      if (method === 'POST') { if (actorOf(h) !== 'u1') return json({}, 403); db.versions.push({ ...body, created_by: 'u1', activated_at: null }); return json(undefined, 201); }
      if (method === 'GET') return json(db.versions.filter((v) => v.id === eq(url, 'id')).map(({ id, version, status, activated_at }) => ({ id, version, status, activated_at })));
      if (method === 'DELETE') { db.deleted.push(['budget_versions', eq(url, 'id')]); db.versions = db.versions.filter((v) => v.id !== eq(url, 'id')); return json(undefined, 204); }
    }
    if (path === '/rest/v1/budget_line_items') {
      if (method === 'POST') { if (actorOf(h) !== 'u1') return json({}, 403); db.lines.push(...body.map((l, i) => ({ id: `li-${db.lines.length + i + 1}`, ...l }))); return json(undefined, 201); }
      if (method === 'GET') return json(db.lines.filter((l) => l.budget_version_id === eq(url, 'budget_version_id') && (!eq(url, 'category') || l.category === eq(url, 'category'))));
      if (method === 'PATCH') { if (actorOf(h) !== 'u1') return json([]); const l = db.lines.find((x) => x.id === eq(url, 'id')); Object.assign(l, body); return json([l]); }
      if (method === 'DELETE') { db.deleted.push(['budget_line_items', eq(url, 'budget_version_id')]); db.lines = db.lines.filter((l) => l.budget_version_id !== eq(url, 'budget_version_id')); return json(undefined, 204); }
    }
    if (path === '/rest/v1/rpc/activate_budget_version') {
      if (actorOf(h) !== 'u2') return json({ message: 'drafter cannot activate' }, 403);
      const v = db.versions.find((x) => x.id === body.version_id);
      for (const other of db.versions.filter((x) => x.project_id === v.project_id && x.status === 'Active')) other.status = 'Archived';
      v.status = 'Active'; v.activated_at = `2026-10-15T10:00:0${++activations}.123456+00:00`;
      return json(undefined, 204);
    }
    if (path === '/rest/v1/rpc/clone_budget_version') {
      if (actorOf(h) !== 'u1') return json({}, 403);
      const source = db.versions.find((x) => x.id === body.version_id);
      const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      db.versions.push({ ...source, id, version: source.version + 1, status: 'Draft', activated_at: null });
      db.lines.push(...db.lines.filter((l) => l.budget_version_id === source.id).map((l, i) => ({ ...l, id: `li-c${i}`, budget_version_id: id })));
      return json(id);
    }
    if (path === '/functions/v1/adapter-dispatch') {
      if (actorOf(h) !== 'u2') return json({}, 401);
      dispatch(body.record.id);
      return json({ ok: true });
    }
    if (path === '/rest/v1/budget_version_account_erp_mirror') return json(db.mirrors.filter((m) => m.budget_version_id === eq(url, 'budget_version_id')));
    if (path === '/rest/v1/external_command_outbox' && method === 'GET') return json(db.outbox.filter((r) => r.pmo_record_id === eq(url, 'pmo_record_id')));
    if (['/rest/v1/external_command_outbox', '/rest/v1/external_refs', '/rest/v1/external_ref_lineage'].includes(path) && method === 'DELETE') {
      db.deleted.push([path.split('/').pop(), eq(url, 'pmo_record_id')]); return json(undefined, 204);
    }
    return json({ message: `unrouted ${method} ${path}` }, 404);
  }

  async function erpRoute(url, method, h, body) {
    if (h.Authorization !== cfg.erpAuthorization) return json({}, 401);
    const path = decodeURIComponent(url.pathname);
    if (path === '/api/resource/Project' && method === 'POST') { const name = `PROJ-${erp.projects.length + 1}`; erp.projects.push({ name, ...body }); return json({ data: { name } }); }
    if (path === '/api/resource/Budget' && method === 'GET') {
      const [[, , project]] = JSON.parse(url.searchParams.get('filters'));
      const fields = JSON.parse(url.searchParams.get('fields'));
      return json({ data: erp.budgets.filter((b) => b.project === project).map((b) => Object.fromEntries(fields.map((f) => [f, b[f]]))) });
    }
    const name = path.startsWith('/api/resource/Budget/') ? path.slice('/api/resource/Budget/'.length) : null;
    const doc = erp.budgets.find((b) => b.name === name);
    if (doc && method === 'GET') return json({ data: { ...doc } });
    if (doc && method === 'PUT') { if (knobs.cancelStatus) return json({}, knobs.cancelStatus); doc.docstatus = body.docstatus; return json({ data: { ...doc } }); }
    return json({}, 404);
  }

  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method ?? 'GET').toUpperCase();
    const h = { ...(init.headers ?? {}) };
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, headers: h, rawBody: init.body ?? null, redirect: init.redirect });
    return url.origin === cfg.localApi ? local(url, method, h, body) : erpRoute(url, method, h, body);
  };
  return { fetchImpl, calls, db, erp, initialBindingConfig, initialMap };
}

function harness(knobs = {}, opts = {}) {
  const world = fakeWorld(knobs);
  const out = []; const err = []; const sleeps = [];
  const evidenceDir = mkdtempSync(join(tmpdir(), 'bv16-test-'));
  let n = 0;
  const deps = {
    fetchImpl: world.fetchImpl, evidenceDir, retainRun: opts.retainRun ?? false,
    sleep: async (ms) => { sleeps.push(ms); }, stdout: (s) => out.push(s), stderr: (s) => err.push(s),
    newId: () => ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'][n++] ?? `00000000-0000-4000-8000-00000000000${n}`,
  };
  return { world, out, err, sleeps, evidenceDir, deps, files: () => readdirSync(evidenceDir), done: () => rmSync(evidenceDir, { recursive: true, force: true }) };
}

const harnessCalls = (world) => world.calls;
const assertNoSecrets = (text) => { for (const secret of SECRETS()) assert.ok(!text.includes(secret), 'a credential leaked into output/files'); };

test('AC-BV16-008 identity restatement matches the shipped account identity + key derivation', async () => {
  const shipped = await import('../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts');
  for (const [fy, account, stamp] of [['2026', 'Salary - EX', '2026-10-15T10:00:00.123456+00:00'], ['2025/26', 'Gehälter: 5100', '2026-10-15 17:00:00+07']]) {
    const vid = '44444444-4444-4444-8444-444444444444';
    assert.equal(budgetAccountIdentity(vid, fy, account), shipped.budgetAccountIdentity(vid, fy, account));
    assert.equal(budgetAccountPushKey(budgetAccountIdentity(vid, fy, account), stamp), shipped.budgetAccountPushKey(shipped.budgetAccountIdentity(vid, fy, account), stamp));
  }
});

test('AC-BV16-008 guard also refuses a rehearsal origin whose host is the frontend site', () => {
  assert.throws(() => validateConfig({ ...config(), rehearsalOrigin: 'https://frontend' }), /rehearsal configuration/i);
  assert.throws(() => validateConfig({ ...config(), rehearsalOrigin: 'https://frontend.example.test' }), /rehearsal configuration/i);
});

test('AC-BV16-008 routed fetch: harness may only create a Project and cancel allow-listed Budgets on the rehearsal origin', async () => {
  const seen = [];
  const cancellable = new Set(['BUD-1']);
  const routed = createRoutedFetch(validateConfig(config()), async (url, init) => { seen.push({ url: String(url), init }); return new Response('{}'); }, { cancellableBudgets: cancellable });
  const erpUrl = (p) => `https://v16-rehearsal.example.test${p}`;
  await routed(erpUrl('/api/resource/Budget?fields=[]'));
  await routed(erpUrl('/api/resource/Budget/BUD-1'));
  await routed(erpUrl('/api/resource/Budget/BUD-1'), { method: 'PUT', body: JSON.stringify({ docstatus: 2 }) });
  await assert.rejects(routed(erpUrl('/api/resource/Budget/BUD-9'), { method: 'PUT', body: JSON.stringify({ docstatus: 2 }) }), /forbidden/i);
  await assert.rejects(routed(erpUrl('/api/resource/Budget/BUD-1'), { method: 'PUT', body: JSON.stringify({ docstatus: 2, budget_amount: 1 }) }), /forbidden/i);
  await assert.rejects(routed(erpUrl('/api/resource/Budget/BUD-1'), { method: 'DELETE' }), /forbidden/i);
  await assert.rejects(routed(erpUrl('/api/method/frappe.client.cancel'), { method: 'POST', body: '{}' }), /forbidden/i);
  await assert.rejects(routed(erpUrl('/api/resource/Account'), { method: 'POST', body: '{}' }), /forbidden/i);
  await assert.rejects(routed(erpUrl('/api/resource/Project/P-1'), { method: 'DELETE' }), /forbidden/i);
  await assert.rejects(routed('http://127.0.0.1:54321/rest/v1/projects', { method: 'DELETE' }), /unscoped/i);
  await assert.rejects(routed('http://127.0.0.1:54321/rest/v1/external_refs?pmo_record_id=like.abc*', { method: 'DELETE' }), /unscoped/i);
  await assert.rejects(routed('http://127.0.0.1:54321/rest/v1/projects?id=eq.*', { method: 'PATCH', body: '{}' }), /unscoped/i);
  assert.equal(seen.length, 3);
});

test('AC-BV16-008 pollUntil is bounded at 60 × 1s and returns the first ready value', async () => {
  const sleeps = [];
  let i = 0;
  assert.equal(await pollUntil(async () => (++i === 3 ? 'ready' : undefined), { sleep: async (ms) => sleeps.push(ms) }), 'ready');
  assert.deepEqual(sleeps, [1000, 1000]);
  sleeps.length = 0;
  await assert.rejects(pollUntil(async () => undefined, { sleep: async (ms) => sleeps.push(ms) }), /timed out/i);
  assert.equal(sleeps.length, 59);
  assert.ok(sleeps.every((ms) => ms === 1000));
});

test('AC-BV16-008 local witness oracle requires both account units pushed under the activation-epoch keys', () => {
  const cfg = validateConfig(config());
  const vid = '44444444-4444-4444-8444-444444444444';
  const at = '2026-10-15T10:00:01.123456+00:00';
  const salaryId = budgetAccountIdentity(vid, '2026', cfg.salaryAccount);
  const cogsId = budgetAccountIdentity(vid, '2026', cfg.cogsAccount);
  const good = {
    version: { id: vid, status: 'Active', activated_at: at },
    mirrors: [
      { erp_account: cfg.salaryAccount, fiscal_year: '2026', push_state: 'pushed', budget_intent: 'ensure', activated_at_witness: '2026-10-15 10:00:01.123+00', erp_budget_name: 'SAL-1' },
      { erp_account: cfg.cogsAccount, fiscal_year: '2026', push_state: 'pushed', budget_intent: 'ensure', activated_at_witness: at, erp_budget_name: 'COGS-1' },
    ],
    outbox: { [salaryId]: [{ state: 'confirmed', idempotency_key: budgetAccountPushKey(salaryId, at) }], [cogsId]: [{ state: 'committed', idempotency_key: budgetAccountPushKey(cogsId, at) }] },
    erpNames: { [cfg.salaryAccount]: 'SAL-1', [cfg.cogsAccount]: 'COGS-1' },
  };
  assert.equal(assertLocalWitnesses(good, cfg), 2);
  const bad = (patch) => assert.throws(() => assertLocalWitnesses({ ...good, ...patch }, cfg), /witness/i);
  bad({ version: { ...good.version, activated_at: null } });
  bad({ mirrors: [good.mirrors[0]] });
  bad({ mirrors: [{ ...good.mirrors[0], push_state: 'failed' }, good.mirrors[1]] });
  bad({ mirrors: [{ ...good.mirrors[0], activated_at_witness: '2026-10-15T10:00:09+00:00' }, good.mirrors[1]] });
  bad({ mirrors: [{ ...good.mirrors[0], erp_budget_name: 'OTHER' }, good.mirrors[1]] });
  bad({ outbox: { ...good.outbox, [salaryId]: [{ state: 'failed', idempotency_key: budgetAccountPushKey(salaryId, at) }] } });
  bad({ outbox: { ...good.outbox, [cogsId]: [] } });
});

test('AC-BV16-008 happy path: real-dispatch flow, sanitized PASS, allow-listed routing, no harness Budget writes, scoped cleanup', async () => {
  const h = harness();
  try {
    const result = await runRehearsal(config(), h.deps);
    assert.equal(result.exitCode, 0, h.err.join(''));
    const calls = harnessCalls(h.world);
    // Routing: only the loopback PMO API and the nominated rehearsal origin, never following redirects.
    assert.ok(calls.every(({ url }) => [config().localApi, config().rehearsalOrigin].includes(url.origin)));
    assert.ok(calls.every(({ redirect }) => redirect === 'manual'));
    // The harness never writes a Budget: the only Budget mutations it sends are cleanup cancels.
    const budgetWrites = calls.filter(({ url, method }) => url.origin === config().rehearsalOrigin && url.pathname.startsWith('/api/resource/Budget') && method !== 'GET');
    assert.ok(budgetWrites.every(({ method, rawBody }) => method === 'PUT' && rawBody === '{"docstatus":2}'));
    assert.deepEqual(budgetWrites.map(({ url }) => decodeURIComponent(url.pathname.split('/').pop())).sort(), h.world.erp.budgets.map((b) => b.name).filter((n) => n !== 'BUD-1').sort());
    assert.ok(h.world.erp.budgets.every((b) => b.docstatus === 2), 'every run-owned Budget is cancelled at cleanup');
    // Order: setup → baseline dispatch happens only AFTER actor2 activated; same real HTTP handler shape.
    const dispatches = calls.filter(({ url }) => url.pathname === '/functions/v1/adapter-dispatch');
    assert.equal(dispatches.length, 3, 'baseline, revision, replay');
    for (const d of dispatches) {
      assert.equal(d.method, 'POST');
      assert.equal(d.headers.Authorization, `Bearer ${config().secondActorJwt}`);
      const body = JSON.parse(d.rawBody);
      assert.deepEqual(Object.keys(body).sort(), ['domain', 'operation', 'record']);
      assert.deepEqual({ ...body, record: { ...body.record, id: 'X' } }, { domain: 'budget', operation: 'create', record: { id: 'X', erp_doc_kind: 'budget' } });
    }
    assert.deepEqual(dispatches.map((d) => JSON.parse(d.rawBody).record.id), ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
    const activations = calls.filter(({ url }) => url.pathname === '/rest/v1/rpc/activate_budget_version');
    assert.ok(activations.every((c) => c.headers.Authorization === `Bearer ${config().secondActorJwt}`));
    const clone = calls.find(({ url }) => url.pathname === '/rest/v1/rpc/clone_budget_version');
    assert.equal(clone.headers.Authorization, `Bearer ${config().firstActorJwt}`);
    // ERP list asks only v16 fields — never fiscal_year.
    const lists = calls.filter(({ url, method }) => url.pathname === '/api/resource/Budget' && method === 'GET');
    assert.ok(lists.length >= 3);
    for (const l of lists) {
      assert.deepEqual(JSON.parse(l.url.searchParams.get('fields')), [...BUDGET_LIST_FIELDS]);
      assert.ok(!BUDGET_LIST_FIELDS.includes('fiscal_year'));
    }
    // The revision really amended only Salary to 60000 through the harness's actor1 edit.
    const patch = calls.find(({ url, method }) => url.pathname === '/rest/v1/budget_line_items' && method === 'PATCH');
    assert.equal(patch.headers.Authorization, `Bearer ${config().firstActorJwt}`);
    assert.deepEqual(JSON.parse(patch.rawBody), { budgeted_amount: '60000.00' });
    // Output: exactly the PASS line + sanitized counts; nothing secret, no coordinates, no labels/names.
    const stdout = h.out.join('');
    assert.match(stdout, /^AC-BV16-008 real-dispatch activation and single-account revision: PASS\n\{.*\}\n$/);
    const summary = JSON.parse(stdout.split('\n')[1]);
    assert.deepEqual(Object.keys(summary).sort(), ['amounts', 'counts', 'runToken']);
    assert.deepEqual(summary.amounts, [50000, 25000, 60000, 25000]);
    assert.deepEqual(summary.counts, { versions: 2, baselineSubmitted: 2, revisionDocuments: 3, revisionSubmitted: 2, replayDocuments: 3 });
    assertNoSecrets(stdout + h.err.join(''));
    assert.doesNotMatch(stdout, /Salary|COGS|BUD-|PROJ-|example\.test|127\.0\.0\.1|isolated/);
    // Local singletons restored exactly; run-owned rows removed, global rows untouched.
    assert.deepEqual(h.world.db.binding.config, h.world.initialBindingConfig);
    assert.deepEqual(h.world.db.map.sort((a, b) => a.category.localeCompare(b.category)), h.world.initialMap.sort((a, b) => a.category.localeCompare(b.category)));
    assert.equal(h.world.db.projects.length, 0);
    assert.equal(h.world.db.versions.length, 0);
    // Every local delete/patch is eq-scoped to a run-owned id or a snapshotted singleton row.
    for (const c of calls.filter(({ url, method }) => url.origin === config().localApi && ['DELETE', 'PATCH'].includes(method))) {
      const values = [...c.url.searchParams.values()];
      assert.ok(values.length > 0 && values.every((v) => v.startsWith('eq.') && !v.includes('*')), `${c.method} ${c.url.pathname}`);
    }
    // Private evidence saved locally (0600), with no credentials in it.
    const files = h.files();
    assert.deepEqual(files, ['11111111111141118111111111111111.evidence.json']);
    assertNoSecrets(readFileSync(join(h.evidenceDir, files[0]), 'utf8'));
  } finally { h.done(); }
});

test('AC-BV16-008 binding preflight: a non-v16 / wrong-origin / inactive binding refuses before any ERP write or local mutation', async () => {
  for (const binding of [{ version_major: 15 }, { site_url: 'https://other.example.test' }, { activated_at: null }, { config: { company: 'Other Co', project_map: {} } }]) {
    const h = harness({ binding });
    try {
      const result = await runRehearsal(config(), h.deps);
      assert.equal(result.exitCode, 1, JSON.stringify(binding));
      assert.ok(harnessCalls(h.world).every(({ url, method }) => url.origin === config().localApi && method === 'GET'), 'only local reads happened');
      assert.equal(h.out.join(''), '');
      assert.match(h.err.join(''), /binding/);
    } finally { h.done(); }
  }
});

test('AC-BV16-008 invalid config refuses before any request', async () => {
  const h = harness();
  try {
    await assert.rejects(runRehearsal({ ...config(), rehearsalSite: 'frontend' }, h.deps), /rehearsal configuration/);
    assert.equal(h.world.calls.length, 0);
  } finally { h.done(); }
});

test('AC-BV16-008 assertion failure: no PASS, non-zero, cleanup still restores and cancels only run-owned Budgets', async () => {
  const h = harness({ wrongSalaryAmount: true });
  try {
    const result = await runRehearsal(config(), h.deps);
    assert.equal(result.exitCode, 1);
    assert.equal(h.out.join(''), '');
    assert.match(h.err.join(''), /stage baseline/);
    assertNoSecrets(h.err.join(''));
    assert.ok(h.world.erp.budgets.length > 0 && h.world.erp.budgets.every((b) => b.docstatus === 2));
    assert.deepEqual(h.world.db.binding.config, h.world.initialBindingConfig);
    assert.equal(h.world.db.versions.length, 0);
  } finally { h.done(); }
});

test('AC-BV16-008 setup failure: local project insert fails → non-zero, binding never mutated, no Budget requests', async () => {
  const h = harness({ projectInsertStatus: 500 });
  try {
    const result = await runRehearsal(config(), h.deps);
    assert.equal(result.exitCode, 1);
    assert.match(h.err.join(''), /stage setup-local-project/);
    assert.ok(!h.world.calls.some(({ method, url }) => url.pathname === '/rest/v1/external_org_bindings' && method === 'PATCH'));
    assert.ok(!h.world.calls.some(({ url, method }) => url.pathname.startsWith('/api/resource/Budget/') && method !== 'GET'));
  } finally { h.done(); }
});

test('AC-BV16-008 dispatch never lands: bounded 60×1s poll, then honest failure', async () => {
  const h = harness({ neverPush: true });
  try {
    const result = await runRehearsal(config(), h.deps);
    assert.equal(result.exitCode, 1);
    assert.equal(h.sleeps.length, 59);
    assert.match(h.err.join(''), /timed out/);
  } finally { h.done(); }
});

test('AC-BV16-008 cleanup failure: ERP cancel refused → exit 2 + local-only manifest without credentials', async () => {
  const h = harness({ cancelStatus: 417 });
  try {
    const result = await runRehearsal(config(), h.deps);
    assert.equal(result.exitCode, 2);
    assert.match(h.out.join(''), /PASS/);
    assert.match(h.err.join(''), /cleanup incomplete/i);
    const manifestFile = h.files().find((f) => f.endsWith('.cleanup.json'));
    assert.ok(manifestFile, 'manifest written');
    const manifest = JSON.parse(readFileSync(join(h.evidenceDir, manifestFile), 'utf8'));
    assert.deepEqual(manifest.failedSteps, ['cancel-erp-budgets']);
    assert.equal(manifest.erpProject, 'PROJ-1');
    assert.ok(manifest.erpBudgetNames.length === 2);
    assert.ok(manifest.localRows.some((r) => r.table === 'projects'));
    assertNoSecrets(JSON.stringify(manifest) + h.err.join('') + h.out.join(''));
    // The singletons were still restored even though ERP cleanup failed.
    assert.deepEqual(h.world.db.binding.config, h.world.initialBindingConfig);
  } finally { h.done(); }
});

test('AC-BV16-008 --retain-run: emits only an opaque token, restores singletons, leaves fixtures for the Director', async () => {
  const h = harness({}, { retainRun: true });
  try {
    const result = await runRehearsal(config(), h.deps);
    assert.equal(result.exitCode, 0);
    assert.match(h.err.join(''), /^Retained run token 11111111111141118111111111111111\n$/);
    assert.ok(h.world.erp.budgets.some((b) => b.docstatus === 1));
    assert.ok(!h.world.calls.some(({ method, url }) => method === 'DELETE' && url.pathname !== '/rest/v1/budget_category_account_map'), 'no run-owned fixture is deleted');
    assert.equal(h.world.db.projects.length, 1);
    assert.equal(h.world.db.versions.length, 2);
    assert.ok(!h.world.calls.some(({ method, url }) => method === 'PUT' && url.pathname.startsWith('/api/resource/Budget/')), 'no ERP cancel in retain mode');
    assert.deepEqual(h.world.db.binding.config, h.world.initialBindingConfig);
    assert.ok(h.files().includes('11111111111141118111111111111111.cleanup.json'));
  } finally { h.done(); }
});

test('AC-BV16-008 actors must be two different people of one org — refused before any ERP request or local write', async () => {
  for (const knobs of [{ sameUser: true }, { otherOrgFor: 'u2' }]) {
    const h = harness(knobs);
    try {
      const result = await runRehearsal(config(), h.deps);
      assert.equal(result.exitCode, 1, JSON.stringify(knobs));
      assert.match(h.err.join(''), /stage resolve-actors: The two actors must/);
      assert.ok(h.world.calls.every(({ url, method }) => url.origin === config().localApi && method === 'GET'));
    } finally { h.done(); }
  }
});
