/**
 * AC-OPP-013/014/021 and the revise resolver (#1505 P3): the PMO-side facts an Odoo purchase command is built from. Supabase is
 * mocked over fetch; every route is a fact about the world, and a read nobody mocked fails the test.
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertRejects } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { installEdgeEnv, jsonResponse, supabaseSelect, withFetchMock, type FetchCall, type MockRoute } from './testing/edgeTestKit.ts';
import { orderCompositeFacts, resolveOdooCostAccount, resolveOdooOrderInputs, resolveOdooReviseInputs } from './odooPurchaseRefs.ts';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

const env = installEdgeEnv();
afterAll(() => env.restore());

const ORG = '0d000000-0000-4000-8000-000000000007';
const CASE = 'c0000000-0000-4000-8000-000000000001';
const PROJECT = 'c0000000-0000-4000-8000-000000000002';
const VENDOR = 'c0000000-0000-4000-8000-000000000003';
const PO = 'c0000000-0000-4000-8000-000000000004';
const BOQ = 'c0000000-0000-4000-8000-000000000005';
const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const param = (c: FetchCall, k: string) => { const v = c.url.searchParams.get(k); return v?.startsWith('eq.') ? decodeURIComponent(v.slice(3)) : v; };

interface World {
  link?: string | null; account?: { active: boolean; tombstoned_at: string | null } | null; caseRow?: Record<string, unknown> | null;
  vendorRef?: string | null; poRef?: string | null; revisionLines?: unknown[];
}
function routes(w: World, seen: string[] = []): MockRoute[] {
  const log = (name: string, r: Response) => { seen.push(name); return r; };
  return [
    supabaseSelect('external_project_bindings', (c) => log('binding', w.link ? one({ external_container_id: w.link }) : none())),
    supabaseSelect('external_master_records', () => log('mirror', w.account === null ? none() : one(w.account ?? { active: true, tombstoned_at: null }))),
    supabaseSelect('procurements', () => log('case', w.caseRow === null ? none() : one({ code: 'PRC-001', project_id: PROJECT, vendor_id: VENDOR, ...w.caseRow }))),
    supabaseSelect('procurement_items', () => log('items', jsonResponse([{ name: 'Cable tray', quantity: 4, rate: 10, description: null }, { name: 'Bolt', quantity: 2, rate: 5, description: 'M8' }]))),
    supabaseSelect('external_refs', (c) => log('refs', (param(c, 'domain') === 'companies' ? w.vendorRef : w.poRef) ? one({ external_record_id: param(c, 'domain') === 'companies' ? w.vendorRef : w.poRef }) : none())),
    supabaseSelect('purchase_orders', () => log('po', one({ procurement_id: CASE }))),
    supabaseSelect('purchase_order_lines', () => log('rev', jsonResponse(w.revisionLines ?? [{ boq_item_id: BOQ, quantity: '6.000', rate: '10.00', unit: 'm' }]))),
    supabaseSelect('boq_items', () => log('boq', jsonResponse([{ id: BOQ, item_code: 'Cable tray' }]))),
  ];
}
const sc = () => createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const CONFIG = { item_map: { 'Cable tray': '55', Bolt: '56' }, unit_map: { m: '11' }, purchase_tax_ids: [7, 'x', 0] };
const RESOLVED = { companyId: 1, config: CONFIG as Record<string, unknown> };
const cmd = (record: Record<string, unknown>): AdapterCommand => ({ domain: 'procurement', operation: 'create', record: { id: PO, ...record } });

describe('FR-ODC-102 the project cost account resolves, or says why not', () => {
  it('a linked, active account resolves', async () => {
    assertEquals(await withFetchMock(routes({ link: '101' }), () => resolveOdooCostAccount(sc(), ORG, PROJECT)), { status: 'resolved', accountId: '101' });
  });
  it('an unlinked project is unlinked, and the mirror is not asked', async () => {
    const seen: string[] = [];
    assertEquals(await withFetchMock(routes({ link: null }, seen), () => resolveOdooCostAccount(sc(), ORG, PROJECT)), { status: 'unlinked' });
    assertEquals(seen, ['binding']);
  });
  it('AC-OPP-014 an archived, tombstoned or vanished account needs attention (fail closed)', async () => {
    for (const account of [{ active: false, tombstoned_at: null }, { active: true, tombstoned_at: '2026-11-01T00:00:00Z' }, null]) {
      assertEquals(await withFetchMock(routes({ link: '101', account }), () => resolveOdooCostAccount(sc(), ORG, PROJECT)), { status: 'needs-attention', reason: 'cost-account-unavailable' });
    }
  });
  it('an unreadable link table needs attention, never "unlinked"', async () => {
    const failing: MockRoute[] = [supabaseSelect('external_project_bindings', () => jsonResponse({ message: 'boom' }, { status: 500 }))];
    assertEquals(await withFetchMock(failing, () => resolveOdooCostAccount(sc(), ORG, PROJECT)), { status: 'needs-attention', reason: 'unreadable' });
  });
});

describe('AC-OPP-010 / 013 / 014 the order inputs', () => {
  it('the case\'s vendor, lines, project account and the org\'s mappings, as the order body needs them', async () => {
    const r = await withFetchMock(routes({ link: '101', vendorRef: 'Vendor:9' }), () => resolveOdooOrderInputs(sc(), ORG, cmd({ procurementId: CASE, referenceNumber: 'PO-77', date: '2026-12-01' }), RESOLVED));
    assertEquals(r.ctx, { companyId: 1, itemMap: CONFIG.item_map, unitMap: CONFIG.unit_map, costAccountId: '101', taxIds: [7] });
    assertEquals(r.input, {
      vendor: 'Vendor:9', caseNumber: 'PRC-001', vendorReference: 'PO-77', expectedDate: '2026-12-01', projectIds: [PROJECT],
      lines: [{ name: 'Cable tray', quantity: 4, rate: 10, description: null }, { name: 'Bolt', quantity: 2, rate: 5, description: 'M8' }],
    });
  });

  it('a command naming a different project than the case adds a second project (refused downstream), never redirects the cost', async () => {
    const r = await withFetchMock(routes({ link: '101', vendorRef: 'Vendor:9' }), () => resolveOdooOrderInputs(sc(), ORG, cmd({ procurementId: CASE, projectId: 'c0000000-0000-4000-8000-0000000000ff' }), RESOLVED));
    assertEquals(r.input.projectIds, [PROJECT, 'c0000000-0000-4000-8000-0000000000ff']);
    assertEquals(r.ctx.costAccountId, '101');
  });

  it('an unmapped vendor is null, not a guess', async () => {
    const r = await withFetchMock(routes({ link: '101', vendorRef: null }), () => resolveOdooOrderInputs(sc(), ORG, cmd({ procurementId: CASE }), RESOLVED));
    assertEquals(r.input.vendor, null);
  });

  it('a case with no project resolves no account and asks for none', async () => {
    const seen: string[] = [];
    const r = await withFetchMock(routes({ caseRow: { project_id: null }, vendorRef: 'Vendor:9' }, seen), () => resolveOdooOrderInputs(sc(), ORG, cmd({ procurementId: CASE }), RESOLVED));
    assertEquals([r.input.projectIds, r.ctx.costAccountId], [[], null]);
    assert(!seen.includes('binding'));
  });

  it('AC-OPP-014 an unlinked or needs-attention project refuses with a named reason', async () => {
    const err1 = await assertRejects(() => withFetchMock(routes({ link: null }), () => resolveOdooOrderInputs(sc(), ORG, cmd({ procurementId: CASE }), RESOLVED)));
    assertEquals((err1 as Error).message, 'project-unlinked');
    const err2 = await assertRejects(() => withFetchMock(routes({ link: '101', account: { active: false, tombstoned_at: null } }), () => resolveOdooOrderInputs(sc(), ORG, cmd({ procurementId: CASE }), RESOLVED)));
    assertEquals((err2 as Error).message, 'project-needs-attention');
  });

  it('a case that is not in this org, a missing case id, and an activation without a company all refuse', async () => {
    for (const [world, record, res] of [
      [{ caseRow: null }, { procurementId: CASE }, RESOLVED], [{}, {}, RESOLVED], [{ link: '101' }, { procurementId: CASE }, { ...RESOLVED, companyId: null }],
    ] as const) {
      await assertRejects(() => withFetchMock(routes(world), () => resolveOdooOrderInputs(sc(), ORG, cmd(record), res)));
    }
  });
});

describe('AC-OPP-011 the order composite facts (the recovery probe\'s inputs)', () => {
  it('are the vendor\'s Odoo partner, the untaxed total and the line count, and need no project link', async () => {
    const seen: string[] = [];
    const facts = await withFetchMock(routes({ link: null, vendorRef: 'Vendor:9' }, seen), () => orderCompositeFacts(sc(), ORG, { procurementId: CASE }));
    assertEquals(facts, { partnerId: 9, amount: '50.00', lineCount: 2 });
    assert(!seen.includes('binding'));
  });
  it('an unmapped vendor has no partner id', async () => {
    assertEquals((await withFetchMock(routes({ vendorRef: null }), () => orderCompositeFacts(sc(), ORG, { procurementId: CASE }))).partnerId, null);
  });
});

describe('AC-OPP-016 the revision inputs come from the issued revision, not the command', () => {
  const revise = (record: Record<string, unknown> = {}) => ({ domain: 'procurement', operation: 'revise', record: { id: 'r-1', poId: PO, revision: 2, lines: [{ itemRef: 'forged' }], ...record } } as unknown as AdapterCommand);

  it('maps the Odoo order, the issued lines (BoQ item code) and the project account', async () => {
    const r = await withFetchMock(routes({ link: '101', poRef: '312' }), () => resolveOdooReviseInputs(sc(), ORG, revise(), RESOLVED));
    assertEquals(r.orderId, 312);
    assertEquals(r.lines, [{ itemRef: 'Cable tray', quantity: '6.000', rate: '10.00', unit: 'm' }]);
    assertEquals(r.ctx.costAccountId, '101');
  });

  it('a PMO order with no Odoo order, no issued lines, or a bad revision refuses', async () => {
    await assertRejects(() => withFetchMock(routes({ link: '101', poRef: null }), () => resolveOdooReviseInputs(sc(), ORG, revise(), RESOLVED)));
    await assertRejects(() => withFetchMock(routes({ link: '101', poRef: '312', revisionLines: [] }), () => resolveOdooReviseInputs(sc(), ORG, revise(), RESOLVED)));
    await assertRejects(() => withFetchMock(routes({ link: '101', poRef: '312' }), () => resolveOdooReviseInputs(sc(), ORG, revise({ revision: 'x' }), RESOLVED)));
  });
});
