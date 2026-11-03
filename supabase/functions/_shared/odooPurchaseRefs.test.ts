/**
 * AC-OPP-013/014/021 and the revise resolver (#1505 P3): the PMO-side facts an Odoo purchase command is built from. Supabase is
 * mocked over fetch; every route is a fact about the world, and a read nobody mocked fails the test.
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertRejects } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { installEdgeEnv, jsonResponse, supabaseSelect, withFetchMock, type FetchCall, type MockRoute } from './testing/edgeTestKit.ts';
import { orderCompositeFacts, resolveOdooCostAccount, resolveOdooOrderCurrency, resolveOdooOrderInputs, resolveOdooReviseInputs } from './odooPurchaseRefs.ts';
import type { OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
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
  /** The PO's own revision-1 lines (a subcontract PO); none means the case's free-form lines are the order. */
  createLines?: unknown[]; boq?: Array<{ id: string; item_code: string; description?: string }>;
}
function routes(w: World, seen: string[] = []): MockRoute[] {
  const log = (name: string, r: Response) => { seen.push(name); return r; };
  return [
    supabaseSelect('external_project_bindings', (c) => log('binding', w.link ? one({ external_container_id: w.link }) : none())),
    supabaseSelect('external_master_records', () => log('mirror', w.account === null ? none() : one(w.account ?? { active: true, tombstoned_at: null }))),
    supabaseSelect('procurements', () => log('case', w.caseRow === null ? none() : one({ code: 'PRC-001', project_id: PROJECT, vendor_id: VENDOR, currency: 'IDR', ...w.caseRow }))),
    supabaseSelect('procurement_items', () => log('items', jsonResponse([{ name: 'Cable tray', quantity: 4, rate: 10, description: null }, { name: 'Bolt', quantity: 2, rate: 5, description: 'M8' }]))),
    supabaseSelect('external_refs', (c) => log('refs', (param(c, 'domain') === 'companies' ? w.vendorRef : w.poRef) ? one({ external_record_id: param(c, 'domain') === 'companies' ? w.vendorRef : w.poRef }) : none())),
    supabaseSelect('purchase_orders', () => log('po', one({ procurement_id: CASE }))),
    supabaseSelect('purchase_order_lines', (c) => log('rev', jsonResponse(param(c, 'revision') === '1' ? w.createLines ?? [] : w.revisionLines ?? [{ boq_item_id: BOQ, quantity: '6.000', rate: '10.00', unit: 'm' }]))),
    supabaseSelect('boq_items', () => log('boq', jsonResponse(w.boq ?? [{ id: BOQ, item_code: 'Cable tray', description: 'Cable tray 300mm' }]))),
  ];
}
const sc = () => createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const CONFIG = { item_map: { 'Cable tray': '55', Bolt: '56' }, unit_map: { m: '11' }, purchase_tax_ids: [7, 'x', 0] };
const RESOLVED = { companyId: 1, config: CONFIG as Record<string, unknown> };
const CURRENCY_ID = 12;
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
    const r = await withFetchMock(routes({ link: '101', vendorRef: 'Vendor:9' }), () => resolveOdooOrderInputs(sc(), ORG, cmd({ procurementId: CASE, referenceNumber: 'PO-77', date: '2026-12-01' }), RESOLVED, CURRENCY_ID));
    assertEquals(r.ctx, { companyId: 1, currencyId: CURRENCY_ID, itemMap: CONFIG.item_map, unitMap: CONFIG.unit_map, costAccountId: '101', taxIds: [7] });
    assertEquals(r.input, {
      vendor: 'Vendor:9', caseNumber: 'PRC-001', vendorReference: 'PO-77', expectedDate: '2026-12-01', projectIds: [PROJECT],
      lines: [{ name: 'Cable tray', quantity: 4, rate: 10, description: null }, { name: 'Bolt', quantity: 2, rate: 5, description: 'M8' }],
    });
  });

  it('a command naming a different project than the case adds a second project (refused downstream), never redirects the cost', async () => {
    const r = await withFetchMock(routes({ link: '101', vendorRef: 'Vendor:9' }), () => resolveOdooOrderInputs(sc(), ORG, cmd({ procurementId: CASE, projectId: 'c0000000-0000-4000-8000-0000000000ff' }), RESOLVED, CURRENCY_ID));
    assertEquals(r.input.projectIds, [PROJECT, 'c0000000-0000-4000-8000-0000000000ff']);
    assertEquals(r.ctx.costAccountId, '101');
  });

  it('an unmapped vendor is null, not a guess', async () => {
    const r = await withFetchMock(routes({ link: '101', vendorRef: null }), () => resolveOdooOrderInputs(sc(), ORG, cmd({ procurementId: CASE }), RESOLVED, CURRENCY_ID));
    assertEquals(r.input.vendor, null);
  });

  it('a case with no project resolves no account and asks for none', async () => {
    const seen: string[] = [];
    const r = await withFetchMock(routes({ caseRow: { project_id: null }, vendorRef: 'Vendor:9' }, seen), () => resolveOdooOrderInputs(sc(), ORG, cmd({ procurementId: CASE }), RESOLVED, CURRENCY_ID));
    assertEquals([r.input.projectIds, r.ctx.costAccountId], [[], null]);
    assert(!seen.includes('binding'));
  });

  it('AC-OPP-014 an unlinked or needs-attention project refuses with a named reason', async () => {
    const err1 = await assertRejects(() => withFetchMock(routes({ link: null }), () => resolveOdooOrderInputs(sc(), ORG, cmd({ procurementId: CASE }), RESOLVED, CURRENCY_ID)));
    assertEquals((err1 as Error).message, 'project-unlinked');
    const err2 = await assertRejects(() => withFetchMock(routes({ link: '101', account: { active: false, tombstoned_at: null } }), () => resolveOdooOrderInputs(sc(), ORG, cmd({ procurementId: CASE }), RESOLVED, CURRENCY_ID)));
    assertEquals((err2 as Error).message, 'project-needs-attention');
  });

  it('a case that is not in this org, a missing case id, and an activation without a company all refuse', async () => {
    for (const [world, record, res] of [
      [{ caseRow: null }, { procurementId: CASE }, RESOLVED], [{}, {}, RESOLVED], [{ link: '101' }, { procurementId: CASE }, { ...RESOLVED, companyId: null }],
    ] as const) {
      await assertRejects(() => withFetchMock(routes(world), () => resolveOdooOrderInputs(sc(), ORG, cmd(record), res, CURRENCY_ID)));
    }
  });
});

describe('I3 one identity for a PO line across create and revise', () => {
  // The case's free-form line is named "Cable tray 300mm"; the PO's own line is BoQ item ELC-014. Revise can only name the BoQ item,
  // so a PO that has its own lines is created from them: the item map is asked the BoQ code on both paths.
  const world = (over: World = {}): World => ({
    link: '101', vendorRef: 'Vendor:9', poRef: 'purchase.order:312', createLines: [{ boq_item_id: BOQ, quantity: '6.000', rate: '10.00', unit: 'm' }],
    boq: [{ id: BOQ, item_code: 'ELC-014', description: 'Cable tray 300mm' }], ...over,
  });
  const MAP = { ...RESOLVED, config: { ...CONFIG, item_map: { 'ELC-014': '55', 'Cable tray': '99' } } };

  it('a PO with its own lines is created from them, keyed by BoQ item code, and revised under the same key', async () => {
    const created = await withFetchMock(routes(world()), () => resolveOdooOrderInputs(sc(), ORG, cmd({ procurementId: CASE }), MAP, CURRENCY_ID));
    const revised = await withFetchMock(routes(world()), () => resolveOdooReviseInputs(sc(), ORG, { domain: 'procurement', operation: 'revise', record: { id: 'r-1', poId: PO, revision: 2 } } as unknown as AdapterCommand, MAP, CURRENCY_ID));
    assertEquals(created.input.lines, [{ name: 'ELC-014', quantity: 6, rate: 10, description: 'Cable tray 300mm' }]);
    assertEquals(created.input.lines[0].name, revised.lines[0].itemRef);
    assertEquals(created.ctx.itemMap[created.input.lines[0].name], MAP.config.item_map['ELC-014']);
  });

  it('the composite facts describe the same lines the order is built from', async () => {
    const facts = await withFetchMock(routes(world()), () => orderCompositeFacts(sc(), ORG, { id: PO, procurementId: CASE }));
    assertEquals(facts, { partnerId: 9, amount: '60.00', lineCount: 1 });
  });

  it('a PO with no lines of its own keeps the case\'s lines, keyed by their name', async () => {
    const r = await withFetchMock(routes(world({ createLines: [] })), () => resolveOdooOrderInputs(sc(), ORG, cmd({ procurementId: CASE }), MAP, CURRENCY_ID));
    assertEquals(r.input.lines.map((l) => l.name), ['Cable tray', 'Bolt']);
  });

  it('a PO line whose BoQ item cannot be read refuses rather than falling back to the case lines', async () => {
    await assertRejects(() => withFetchMock(routes(world({ boq: [] })), () => resolveOdooOrderInputs(sc(), ORG, cmd({ procurementId: CASE }), MAP, CURRENCY_ID)));
  });
});

describe('I4 / OQ-OPP-9 the order currency is the company currency PMO holds, or the order is refused before any write', () => {
  const company = (currency: unknown): { call: OdooCall; calls: Array<[string, string]> } => {
    const calls: Array<[string, string]> = [];
    const call = (async (model: string, method: string) => { calls.push([model, method]); return [{ id: 1, currency_id: currency }]; }) as OdooCall;
    return { call, calls };
  };
  const revise = { domain: 'procurement', operation: 'revise', record: { id: 'r-1', poId: PO, revision: 2 } } as unknown as AdapterCommand;
  const resolve = (w: World, odooCurrency: unknown, command: AdapterCommand = cmd({ procurementId: CASE })) => {
    const c = company(odooCurrency);
    return { c, run: () => withFetchMock(routes(w), () => resolveOdooOrderCurrency(sc(), ORG, command, c.call, 1)) };
  };

  it('a company currency equal to the case\'s returns the Odoo currency id to send, reading only', async () => {
    const { c, run } = resolve({}, [12, 'IDR']);
    assertEquals(await run(), 12);
    assertEquals(c.calls, [['res.company', 'read']]);
  });

  it('a revision is checked against its case through the PO', async () => {
    assertEquals(await resolve({}, [12, 'IDR'], revise).run(), 12);
    await assertRejects(resolve({}, [31, 'USD'], revise).run, Error, 'currency-mismatch');
  });

  it('a mismatch is config-rejected, names both currencies, and Odoo is only read', async () => {
    const { c, run } = resolve({ caseRow: { currency: 'USD' } }, [12, 'IDR']);
    const err = await assertRejects(run) as Error & { code?: string };
    assertEquals(err.code, 'config-rejected');
    assert(err.message.includes('currency-mismatch') && err.message.includes('USD') && err.message.includes('IDR'), err.message);
    assert(c.calls.every(([, method]) => method === 'read'));
  });

  it('an unreadable Odoo currency, or a case without one, refuses closed', async () => {
    for (const odoo of [false, null, [12], [12, ''], 'IDR']) await assertRejects(resolve({}, odoo).run, Error, 'currency-unreadable');
    await assertRejects(resolve({ caseRow: { currency: null } }, [12, 'IDR']).run, Error, 'currency-unreadable');
    await assertRejects(resolve({ caseRow: null }, [12, 'IDR']).run);
  });
});

describe('AC-OPP-011 the order composite facts (the recovery probe\'s inputs)', () => {
  it('are the vendor\'s Odoo partner, the untaxed total and the line count, and need no project link', async () => {
    const seen: string[] = [];
    const facts = await withFetchMock(routes({ link: null, vendorRef: 'Vendor:9' }, seen), () => orderCompositeFacts(sc(), ORG, { id: PO, procurementId: CASE }));
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
    const r = await withFetchMock(routes({ link: '101', poRef: 'purchase.order:312' }), () => resolveOdooReviseInputs(sc(), ORG, revise(), RESOLVED, CURRENCY_ID));
    assertEquals(r.orderId, 312);
    assertEquals(r.lines, [{ itemRef: 'Cable tray', quantity: '6.000', rate: '10.00', unit: 'm' }]);
    assertEquals(r.ctx.costAccountId, '101');
  });

  it('a PMO order with no Odoo order, no issued lines, or a bad revision refuses', async () => {
    // an id of another Odoo model (or a bare id) is not an order: ids are per model
    for (const poRef of ['stock.picking:312', '312']) await assertRejects(() => withFetchMock(routes({ link: '101', poRef }), () => resolveOdooReviseInputs(sc(), ORG, revise(), RESOLVED, CURRENCY_ID)));
    await assertRejects(() => withFetchMock(routes({ link: '101', poRef: null }), () => resolveOdooReviseInputs(sc(), ORG, revise(), RESOLVED, CURRENCY_ID)));
    await assertRejects(() => withFetchMock(routes({ link: '101', poRef: 'purchase.order:312', revisionLines: [] }), () => resolveOdooReviseInputs(sc(), ORG, revise(), RESOLVED, CURRENCY_ID)));
    await assertRejects(() => withFetchMock(routes({ link: '101', poRef: 'purchase.order:312' }), () => resolveOdooReviseInputs(sc(), ORG, revise({ revision: 'x' }), RESOLVED, CURRENCY_ID)));
  });
});
