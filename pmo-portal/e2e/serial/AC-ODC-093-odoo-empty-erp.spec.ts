// @e2e-isolation: serial — sends into the shared Odoo bed and counts its whole database before and after, so it must not overlap another bed journey; no reset is needed (the oracle is the delta).
// AC-ODC-093 (scenario S-C; AC-ECA-051 Odoo parity): PMO has data, the connected Odoo has none of it. Accepting everything sends it once.
// The Odoo section has no census/accept screen yet, so the journey calls the same setup verbs the Integrations screen calls (see s10-app-failures).
// The account-code oracle expects fix/odoo-send-project-number (FR-ODC-072: the send codes the analytic account with the PMO project number).
import { test, expect } from '@playwright/test';
import { accessToken, adminClient, bedCounts, must, provisionOdooOrg, scenarioGate, setup, sweep, sweepUntil, type ScenarioOrg } from '../_connectScenario';

const gate = scenarioGate('AC-ODC-093');
test.skip(!gate.ready, gate.reason);
test.setTimeout(420_000);

type Census = { census: Array<{ kind: string; pmoCount?: number; erpCount?: number; pmo_count?: number; erp_count?: number }> };
const num = (row: Census['census'][number], a: 'pmo' | 'erp') => (a === 'pmo' ? row.pmoCount ?? row.pmo_count : row.erpCount ?? row.erp_count) ?? 0;

let scenario: ScenarioOrg | undefined;
let sentIds: string[] = [];
let sentCodes: string[] = [];
let sentItems: string[] = [];
// The sends created real records in the shared bed; remove exactly those, then the PMO org.
test.afterAll(async () => {
  const call = scenario?.call;
  if (call) {
    const partners = await call<number[]>('res.partner', 'search', { domain: [['ref', 'in', sentIds.map((id) => `pmo:${id}`)]], context: { active_test: false } }).catch(() => []);
    await call('res.partner', 'unlink', { ids: partners }).catch(() => undefined);
    const accounts = await call<number[]>('account.analytic.account', 'search', { domain: [['code', 'in', sentCodes]], context: { active_test: false } }).catch(() => []);
    await call('account.analytic.account', 'unlink', { ids: accounts }).catch(() => undefined);
    const products = await call<number[]>('product.product', 'search', { domain: [['name', 'in', sentItems]], context: { active_test: false } }).catch(() => []);
    await call('product.product', 'unlink', { ids: products }).catch(() => undefined);
  }
  await scenario?.cleanup();
});

test('AC-ODC-093: an Odoo with none of the data receives every PMO vendor, client, project and item once, and no account or tax', async () => {
  const admin = adminClient();
  const stamp = `ODC093-${Date.now().toString(36)}`;
  scenario = await provisionOdooOrg(admin, stamp);
  const { orgId, call } = scenario;
  const token = await accessToken(scenario.admin);

  // PMO holds 3 vendors, 1 client, 2 projects and items on 2 open purchases.
  const vendors = [1, 2, 3].map((n) => ({ id: crypto.randomUUID(), name: `${stamp} Sinar Baja ${n}` }));
  const client = { id: crypto.randomUUID(), name: `${stamp} Client` };
  await must('vendors', admin.from('companies').insert(vendors.map((v) => ({ id: v.id, org_id: orgId, name: v.name, type: 'Vendor' as const }))).select('id'));
  await must('client', admin.from('companies').insert({ id: client.id, org_id: orgId, name: client.name, type: 'Client' }).select('id'));
  const projects = [1, 2].map((n) => ({ id: crypto.randomUUID(), code: `${stamp}-P${n}`.toUpperCase(), name: `${stamp} project ${n}`, number: '' }));
  const seededProjects = await must('projects', admin.from('projects').insert(projects.map((p) => ({ id: p.id, org_id: orgId, code: p.code, name: p.name, client_id: client.id, status: 'Ongoing Project' as const }))).select('id,pmo_project_number'));
  // An Odoo send codes each analytic account with the PMO project number (FR-ODC-072), not the client code.
  for (const p of projects) p.number = seededProjects.find((s) => s.id === p.id)!.pmo_project_number;
  const purchases = projects.map((p, i) => ({ id: crypto.randomUUID(), project: p, item: `${stamp} item ${i + 1}` }));
  await must('purchases', admin.from('procurements').insert(purchases.map((x, i) => ({
    id: x.id, org_id: orgId, code: `${stamp}-PO${i + 1}`, title: `${stamp} purchase ${i + 1}`, project_id: x.project.id, vendor_id: vendors[i].id,
    requested_by_id: scenario!.admin.id, total_value: 100000, currency: 'IDR', status: 'Draft' as const,
  }))).select('id'));
  await must('items', admin.from('procurement_items').insert(purchases.map((x) => ({ org_id: orgId, procurement_id: x.id, name: x.item, quantity: 1, rate: 100000 }))).select('id'));

  sentIds = [...vendors.map((v) => v.id), client.id]; sentCodes = projects.map((p) => p.number); sentItems = purchases.map((x) => x.item);

  // The cost-account plan is chosen once; the Odoo side starts without any PMO record.
  await sweep();   // mirror the directories first: the plan must be a mirrored one
  await setup(token, { setupAction: 'set-analytic-plan', planId: String(scenario.planId) });
  const before = await bedCounts(call);

  // Census: 3 vendors + 1 client in PMO, none in Odoo.
  const { census } = await setup<Census>(token, { setupAction: 'census' });
  const party = census.find((r) => r.kind === 'party');
  expect(party && num(party, 'pmo')).toBe(4);
  expect.soft(party && num(party, 'erp'), 'census: an empty Odoo holds 0 of the PMO kinds').toBe(0);

  // Accept all: one call applies the whole proposal set; the sends then drain over sweep ticks.
  await sweepUntil(
    () => setup<{ proposalCounts: Record<string, { send: number }> }>(token, { setupAction: 'connect-status' }),
    (s) => (s.proposalCounts.party?.send ?? 0) >= 4 && (s.proposalCounts.project?.send ?? 0) >= 2 && (s.proposalCounts.item?.send ?? 0) >= 2, 'the send proposals are ready',
  );
  const accepted = await setup<{ remaining: number }>(token, { setupAction: 'accept-proposals' });
  expect(accepted.remaining).toBe(0);

  const read = async () => ({
    refs: await must('refs', admin.from('external_refs').select('domain,pmo_record_id,external_record_id').eq('org_id', orgId).eq('external_tier', 'odoo')),
    ...(await (async () => { const st = await setup<{ waitingForSend: number; proposalCounts: unknown }>(token, { setupAction: 'connect-status' }); return { sending: st.waitingForSend, counts: st.proposalCounts }; })()),
    accounts: await call<number>('account.analytic.account', 'search_count', { domain: [['code', 'in', projects.map((p) => p.number)]] }),
    products: await call<number>('product.product', 'search_count', { domain: [['name', 'in', purchases.map((x) => x.item)]] }),
  });
  const done = await sweepUntil(read, (s) => s.sending === 0 && s.refs.length >= 4 && s.accounts === 2 && s.products === 2, 'sends finished');

  const partners = await call<Array<{ id: number; name: string; ref: string | false }>>('res.partner', 'search_read', { domain: [['ref', 'like', 'pmo:']], fields: ['id', 'name', 'ref'] });
  const mine = [...vendors, client];
  expect(partners.filter((p) => mine.some((m) => p.ref === `pmo:${m.id}`))).toHaveLength(4);
  const accounts = await call<Array<{ code: string }>>('account.analytic.account', 'search_read', { domain: [['code', 'in', projects.map((p) => p.number)]], fields: ['code'] });
  expect(accounts.map((a) => a.code).sort()).toEqual(projects.map((p) => p.number).sort());
  const products = await call<Array<{ name: string }>>('product.product', 'search_read', { domain: [['name', 'in', purchases.map((x) => x.item)]], fields: ['name'] });
  expect(products.map((p) => p.name).sort()).toEqual(purchases.map((x) => x.item).sort());

  const after = await bedCounts(call);
  expect(after.accounts).toBe(before.accounts);
  expect(after.taxes).toBe(before.taxes);
  expect(after.partners - before.partners).toBe(4);
  expect(after.analytic - before.analytic).toBe(2);
  expect(after.products - before.products).toBe(2);
  expect(new Set(done.refs.map((r) => r.pmo_record_id)).size).toBe(done.refs.length);

  // Accepting again creates nothing.
  await setup(token, { setupAction: 'accept-proposals' });
  await sweep();
  expect(await bedCounts(call)).toEqual(after);
});
