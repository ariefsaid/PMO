// @e2e-isolation: dedicated-row — owns a fresh PMO org and uniquely stamped Odoo records; nothing shared is mutated.
// AC-ODC-091 (scenario S-A; AC-ECA-050 Odoo parity): a new PMO org connects to an Odoo that already holds partners and products. Accepting everything brings them in.
// The Odoo section has no census/accept screen yet, so the journey calls the same setup verbs the Integrations screen calls (see s10-app-failures).
import { test, expect } from '@playwright/test';
import { accessToken, adminClient, provisionOdooOrg, scenarioGate, setup, sweep, sweepUntil, type ScenarioOrg } from './_connectScenario';

const gate = scenarioGate('AC-ODC-091');
test.skip(!gate.ready, gate.reason);
test.setTimeout(420_000);

let scenario: ScenarioOrg | undefined;
let partnerIds: number[] = [];
let productIds: number[] = [];
test.afterAll(async () => {
  await scenario?.call('res.partner', 'unlink', { ids: partnerIds }).catch(() => undefined);
  await scenario?.call('product.product', 'unlink', { ids: productIds }).catch(() => undefined);
  await scenario?.cleanup();
});

test('AC-ODC-091: an Odoo that already has 20 partners and 5 products fills a new PMO org with one company per partner and no review rows', async () => {
  const admin = adminClient();
  const stamp = `ODC091-${Date.now().toString(36)}`;
  scenario = await provisionOdooOrg(admin, stamp);
  const { orgId, call } = scenario;
  const token = await accessToken(scenario.admin);

  const names = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${stamp} ${prefix} ${String(i + 1).padStart(2, '0')}`);
  const suppliers = names(10, 'Pemasok'), customers = names(10, 'Pelanggan');
  partnerIds = (await call<number[]>('res.partner', 'create', { vals_list: [
    ...suppliers.map((name) => ({ name, is_company: true, supplier_rank: 1 })),
    ...customers.map((name) => ({ name, is_company: true, customer_rank: 1 })),
  ] }));
  const productNames = names(5, 'Barang');
  productIds = await call<number[]>('product.product', 'create', { vals_list: productNames.map((name, i) => ({ name, default_code: `${stamp}-${i + 1}`.toUpperCase(), purchase_ok: true })) });

  await sweep();
  const { census } = await setup<{ census: Array<Record<string, number | string>> }>(token, { setupAction: 'census' });
  const party = census.find((r) => r.kind === 'party')!;
  expect(Number(party.pmoCount ?? party.pmo_count)).toBe(0);
  // The census counts the WHOLE shared bed (other journeys' partners included); the seeded 20 are a
  // floor, and the accept half below proves exactly what this run brought in.
  expect.soft(Number(party.erpCount ?? party.erp_count), 'census: Odoo holds at least the 20 seeded partners (the bed is shared)').toBeGreaterThanOrEqual(20);

  const status = await sweepUntil(
    () => setup<{ proposalCounts: Record<string, { bring_in: number; review: number }> }>(token, { setupAction: 'connect-status' }),
    (s) => (s.proposalCounts.party?.bring_in ?? 0) >= 20, 'the bring-in proposals are ready',
  );
  const bringIn = Number(status.proposalCounts.party?.bring_in ?? 0);
  await setup(token, { setupAction: 'accept-proposals' });

  const { data: companies } = await admin.from('companies').select('name,type').eq('org_id', orgId);
  const byName = new Map((companies ?? []).map((c) => [c.name, c.type]));
  // One PMO company per partner the run brought in — the bed may hold more partners than we seeded.
  expect((companies ?? []).length, `accepting brought in one company per proposal (${bringIn})`).toBe(bringIn);
  expect((companies ?? []).length).toBeGreaterThanOrEqual(20);
  for (const n of suppliers) expect(byName.get(n)).toBe('Vendor');
  for (const n of customers) expect(byName.get(n)).toBe('Client');

  const review = await setup<{ proposals: Array<{ external_ids: string[] }> }>(token, { setupAction: 'list-proposals', state: 'open', outcome: 'review' });
  const ours = partnerIds.map(String);
  expect.soft(review.proposals.filter((r) => r.external_ids.some((id) => ours.includes(String(id)))), 'no review rows for the records this run seeded (a shared bed may hold other runs\' ambiguous partners)').toHaveLength(0);

  // The item picker reads the mirror: all five products are there, with their codes.
  const { data: mirrored } = await admin.from('external_master_records').select('external_id,name,code').eq('org_id', orgId).eq('external_tier', 'odoo').eq('kind', 'product').in('external_id', productIds.map(String));
  expect((mirrored ?? []).map((r) => r.name).sort()).toEqual(productNames.slice().sort());
});
