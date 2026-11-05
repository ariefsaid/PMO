/**
 * AC-OPP-013/014/021 and the revise resolver (#1505 P3): the PMO-side facts an Odoo purchase command is built from. Supabase is
 * mocked over fetch; every route is a fact about the world, and a read nobody mocked fails the test.
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertRejects } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { installEdgeEnv, jsonResponse, supabaseSelect, withFetchMock, type FetchCall, type MockRoute } from './testing/edgeTestKit.ts';
import { billCompositeFacts, orderCompositeFacts, resolveOdooBillInputs, resolveOdooCostAccount, resolveOdooOrderCurrency, resolveOdooOrderInputs, resolveOdooReviseInputs } from './odooPurchaseRefs.ts';
import { OdooError, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
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

// ── P5: the vendor bill ───────────────────────────────────────────────────────────────────────────────────────────────

describe('AC-OPP-040 / 042 / 046 the bill inputs', () => {
  interface BillWorld {
    /** The PMO purchase order of the case (its Odoo order is `poRef`); none means a bill with no order. */
    po?: boolean; poRef?: string | null;
    mirror?: Array<{ external_id: string; name: string; active?: boolean; tombstoned_at?: string | null; attrs: Record<string, unknown> }>;
    /** What Odoo says: each tax's company, each withholding tax's repartition account and that account's type, and the order's lines. */
    taxCompany?: Record<number, number>; repartition?: Array<{ tax_id: [number, string]; account_id: [number, string] | false }>; accountType?: string; orderLines?: Array<{ id: number; product_id: [number, string] }>;
    odooFails?: boolean; orderLinesFail?: boolean;
  }
  const MIRROR = [
    { external_id: '11', name: 'VAT 11%', attrs: { amount: 11, use: 'purchase' } },
    { external_id: '12', name: 'Withholding 2%', attrs: { amount: -2, use: 'purchase' } },
  ];
  function billRoutes(w: BillWorld, seen: string[] = []): MockRoute[] {
    const log = (n: string, r: Response) => { seen.push(n); return r; };
    return [
      supabaseSelect('external_project_bindings', () => log('binding', one({ external_container_id: '101' }))),
      supabaseSelect('external_master_records', (c) => param(c, 'kind') === 'tax'
        ? log('taxes', jsonResponse((w.mirror ?? MIRROR).map((m) => ({ active: true, tombstoned_at: null, ...m }))))
        : log('account', one({ active: true, tombstoned_at: null }))),
      supabaseSelect('procurements', () => log('case', one({ code: 'PRC-001', project_id: PROJECT, vendor_id: VENDOR, currency: 'IDR' }))),
      supabaseSelect('procurement_items', () => log('items', jsonResponse([{ name: 'Cable tray', quantity: 4, rate: 10, description: null }, { name: 'Bolt', quantity: 2, rate: 5, description: 'M8' }]))),
      supabaseSelect('purchase_orders', () => log('po', jsonResponse(w.po === false ? [] : [{ id: PO }]))),
      supabaseSelect('purchase_order_lines', () => log('po-lines', jsonResponse([]))),
      supabaseSelect('external_refs', (c) => param(c, 'domain') === 'companies' ? one({ external_record_id: 'Vendor:9' }) : w.poRef === null || w.po === false ? none() : one({ external_record_id: w.poRef ?? 'purchase.order:777' })),
    ];
  }
  const odoo = (w: BillWorld, calls: string[] = []): OdooCall => (async (model: string, method: string) => {
    calls.push(`${model}/${method}`);
    if (w.odooFails) throw new Error('Odoo is down');
    if (model === 'account.tax') return [11, 12, 13].map((id) => ({ id, company_id: [w.taxCompany?.[id] ?? 1, 'Co'] }));
    if (model === 'account.tax.repartition.line') return w.repartition ?? [{ tax_id: [12, 'Withholding 2%'], account_id: [900, 'PPh payable'] }];
    if (model === 'account.account') return [{ id: 900, account_type: w.accountType ?? 'liability_current' }];
    if (model === 'purchase.order.line' && w.orderLinesFail) throw new OdooError('timeout');
    if (model === 'purchase.order.line') return w.orderLines ?? [{ id: 201, product_id: [55, 'Cable tray'] }, { id: 202, product_id: [56, 'Bolt'] }];
    throw new Error(`unexpected Odoo call ${model}/${method}`);
  }) as OdooCall;
  const CHOICE = { ...RESOLVED, config: { ...CONFIG, purchase_tax_ids: [11] } };
  const run = (w: BillWorld, record: Record<string, unknown> = {}, resolved = CHOICE, calls: string[] = []) =>
    withFetchMock(billRoutes(w), () => resolveOdooBillInputs(sc(), ORG, cmd({ procurementId: CASE, referenceNumber: 'INV-77', invoiceDate: '2026-12-05', ...record }), resolved, CURRENCY_ID, odoo(w, calls)));
  const refusal = async (w: BillWorld, record: Record<string, unknown> = {}) => {
    const err = await assertRejects(() => run(w, record)) as { code?: string; message: string };
    assertEquals(err.code, 'config-rejected');
    return err.message;
  };

  it('the case\'s vendor and lines, each bill line linked to the Odoo order line of its product, the validated explicit taxes and the cost account', async () => {
    const r = await run({}, { taxIds: [11, 12] });
    assertEquals(r.input, {
      vendor: 'Vendor:9', reference: 'INV-77', invoiceDate: '2026-12-05', dueDate: null, projectIds: [PROJECT],
      lines: [{ name: 'Cable tray', quantity: 4, rate: 10, description: null, purchaseLineId: 201 }, { name: 'Bolt', quantity: 2, rate: 5, description: 'M8', purchaseLineId: 202 }],
    });
    assertEquals(r.ctx.taxes.map((t) => [t.id, t.rate, t.scope, t.active, t.companyId, t.liabilityAccount]), [[11, 11, 'purchase', true, 1, false], [12, -2, 'purchase', true, 1, true]]);
    assertEquals([r.ctx.costAccountId, r.ctx.companyId, r.ctx.currencyId], ['101', 1, CURRENCY_ID]);
  });

  it('AC-OPP-042 accepts the decimal-string tax IDs sent by the purchase tax picker', async () => {
    const r = await run({}, { taxIds: ['11', '12'] });
    assertEquals(r.ctx.taxes.map((tax) => tax.id), [11, 12]);
  });

  it('a bill with no order is free-standing: no line is linked and no Odoo order line is read', async () => {
    const calls: string[] = [];
    const r = await run({ po: false }, { taxIds: [11] }, CHOICE, calls);
    assertEquals(r.input.lines.map((l) => l.purchaseLineId), [null, null]);
    assert(!calls.includes('purchase.order.line/search_read'));
  });

  it('I3 (#1505 P5 review) a failed read of the order\'s lines fails the command as retryable; it never becomes a free-standing bill', async () => {
    const err = await assertRejects(() => run({ orderLinesFail: true }, { taxIds: [11] })) as { code?: string; message: string };
    assertEquals([err.code, err.message], ['external-unreachable', 'timeout']);
  });

  it('I3 an order reference that is not a purchase.order reference is refused, never read as "no order"', async () => {
    for (const poRef of ['777', 'account.move:777', 'purchase.order:x', 'purchase.order:']) {
      const err = await assertRejects(() => run({ poRef }, { taxIds: [11] }), Error, 'order-ref-invalid') as { code?: string };
      assertEquals(err.code, 'commit-rejected', poRef);
    }
  });

  it('I3 the order\'s model-qualified reference is the one parsed: its id is what the order lines are read for', async () => {
    const bodies: unknown[] = [];
    const w: BillWorld = {};
    const spy = (async (model: string, method: string, body?: unknown) => { if (model === 'purchase.order.line') bodies.push(body); return odoo(w)(model, method, body as never); }) as OdooCall;
    await withFetchMock(billRoutes(w), () => resolveOdooBillInputs(sc(), ORG, cmd({ procurementId: CASE, taxIds: [11] }), CHOICE, CURRENCY_ID, spy));
    assertEquals((bodies[0] as { domain: unknown[] }).domain, [['order_id', '=', 777]]);
  });

  it('I2 (#1505 P5 review) entered VAT / PPh amounts or a template are refused naming the field, before anything is read: they are never silently replaced by the default taxes', async () => {
    for (const entered of [{ taxTemplate: 'PPN 11%' }, { vatAmount: 0 }, { withheldAmount: 2000 }, { pphType: 'PPh 23' }, { vatAmount: 0, withheldAmount: 2000, pphType: 'PPh 23' }]) {
      const calls: string[] = [];
      const seen: string[] = [];
      const err = await assertRejects(() => withFetchMock(billRoutes({}, seen), () => resolveOdooBillInputs(sc(), ORG, cmd({ procurementId: CASE, ...entered }), CHOICE, CURRENCY_ID, odoo({}, calls)))) as { code?: string; message: string };
      assertEquals(err.code, 'config-rejected');
      const field = Object.keys(entered)[0];
      assert(err.message.includes(field), err.message);
      assertEquals([calls, seen], [[], []], 'no Odoo call and no read');
    }
  });

  it('I2 fields that were not entered (absent, null, empty) are not a refusal', async () => {
    const r = await run({}, { taxTemplate: '', vatAmount: null, withheldAmount: undefined });
    assertEquals(r.ctx.taxes.map((t) => t.id), [11]);
  });

  it('a product that is on two order lines is not linked (ambiguous): never a wrong link', async () => {
    const r = await run({ orderLines: [{ id: 201, product_id: [55, 'a'] }, { id: 203, product_id: [55, 'a'] }, { id: 202, product_id: [56, 'b'] }] }, { taxIds: [11] });
    assertEquals(r.input.lines.map((l) => l.purchaseLineId), [null, 202]);
  });

  it('AC-OPP-046 no choice resolves the org\'s default purchase taxes from the directory, validated; an empty choice is an explicit "no tax"', async () => {
    assertEquals((await run({})).ctx.taxes.map((t) => t.id), [11]);
    assertEquals((await run({}, { taxIds: [] })).ctx.taxes, []);
  });

  it('AC-OPP-042 a tax the directory lacks, an inactive or tombstoned one, another scope, another company and a withholding tax with no liability account all refuse naming the tax', async () => {
    assertEquals(await refusal({}, { taxIds: [99] }), 'config-rejected: tax-unknown 99');
    assertEquals(await refusal({ mirror: [{ ...MIRROR[0], active: false }] }, { taxIds: [11] }), 'config-rejected: VAT 11%');
    assertEquals(await refusal({ mirror: [{ ...MIRROR[0], tombstoned_at: '2026-11-01T00:00:00Z' }] }, { taxIds: [11] }), 'config-rejected: VAT 11%');
    assertEquals(await refusal({ mirror: [{ ...MIRROR[0], attrs: { amount: 11, use: 'sale' } }] }, { taxIds: [11] }), 'config-rejected: VAT 11%');
    assertEquals(await refusal({ taxCompany: { 11: 2 } }, { taxIds: [11] }), 'config-rejected: VAT 11%');
    assertEquals(await refusal({ accountType: 'asset_current' }, { taxIds: [12] }), 'config-rejected: Withholding 2%');
    assertEquals(await refusal({ repartition: [{ tax_id: [12, 'x'], account_id: false }] }, { taxIds: [12] }), 'config-rejected: Withholding 2%');
    assertEquals(await refusal({ repartition: [] }, { taxIds: [12] }), 'config-rejected: Withholding 2%');
  });

  it('a malformed choice is refused, never narrowed to "no tax"; an unreadable Odoo or directory refuses closed', async () => {
    assert((await refusal({}, { taxIds: ['x', 11] })).startsWith('config-rejected'));
    assert((await refusal({ odooFails: true }, { taxIds: [11] })).includes('could not be checked against Odoo'));
  });

  it('an unlinked project refuses before any tax is read', async () => {
    const seen: string[] = [];
    const bare: MockRoute[] = [supabaseSelect('external_project_bindings', () => none()), ...billRoutes({}, seen)];
    await assertRejects(() => withFetchMock(bare, () => resolveOdooBillInputs(sc(), ORG, cmd({ procurementId: CASE }), CHOICE, CURRENCY_ID, odoo({}))));
    assert(!seen.includes('taxes'));
  });

  it('is resolved once per command: the selection and the outbox payload share the answer', async () => {
    const calls: string[] = [];
    const command = cmd({ procurementId: CASE, taxIds: [11] });
    const w: BillWorld = {};
    const first = await withFetchMock(billRoutes(w), () => resolveOdooBillInputs(sc(), ORG, command, CHOICE, CURRENCY_ID, odoo(w, calls)));
    const readsAfterFirst = calls.length;
    const second = await resolveOdooBillInputs(sc(), ORG, command, CHOICE, CURRENCY_ID, odoo(w, calls));   // no fetch mock: any read would fail
    assertEquals(second, first);
    assertEquals(calls.length, readsAfterFirst);
  });

  it('the composite facts: the case\'s vendor partner, the untaxed total and the line count the bill is made of', async () => {
    assertEquals(await withFetchMock(billRoutes({}), () => billCompositeFacts(sc(), ORG, { procurementId: CASE })), { partnerId: 9, amount: '50.00', lineCount: 2 });
  });
});
