// #1505 O2 P4 (AC-OPP-030..032, FR-OPP-030/031/033, OQ-OPP-10): the Odoo tier's goods-receipt outbox deps. The receipt's plan (what Odoo
// had received, what this receipt adds) is fixed from live Odoo on the FIRST attempt, refused above the open quantity before any outbox
// row, persisted, and read back verbatim on every retry; the recovery probe adopts, continues or holds. Odoo and Supabase are mocked
// over fetch; the deps are the shipped module's.
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertRejects } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { installEdgeEnv, jsonResponse, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute } from '../_shared/testing/edgeTestKit.ts';
import { receiptDigest } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/receiptBody.ts';
import { odooReissueOnInconclusiveAbsence, resolveOdooMoneyOutboxDeps } from './odooMoneyOutbox.ts';
import type { AdapterSelectContext } from './dispatchAdapters.ts';

const env = installEdgeEnv();
globalThis.addEventListener('unload', () => env.restore());

const ORG = '0d000000-0000-4000-8000-000000000005';
const ODOO = 'odoo.example.test';
const GR = '223e4567-e89b-12d3-a456-426614174000';
const KEY = 'cccccccc-cccc-4ccc-8ccc-0000000015ff';
const object = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const BINDING = {
  id: 'b0000000-0000-4000-8000-000000000001', site_url: `https://${ODOO}`, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z',
  config: { database: 'db1', odoo_company_id: 1, item_map: { Cable: '55', Bolt: '56' } },
};
const LINES = [
  { id: 11, product_id: [55, 'Cable'], product_qty: 10, qty_received: 0 },
  { id: 12, product_id: [56, 'Bolt'], product_qty: 4, qty_received: 0 },
];
const planLines = (cable: number, bolt = 0) => [{ lineId: 11, productId: 55, base: 0, quantity: cable }, { lineId: 12, productId: 56, base: 0, quantity: bolt }];
const planOf = async (cable: number, bolt = 0) => ({ orderId: 41, lines: planLines(cable, bolt), digest: await receiptDigest(planLines(cable, bolt)) });

type Answer = unknown[] | ((call: FetchCall) => unknown);
function setup(over: { record?: Record<string, unknown>; odoo?: Record<string, Answer>; stored?: Record<string, unknown> | null; poRows?: unknown[]; poRef?: string | null } = {}) {
  const odooCalls: FetchCall[] = [];
  const supabaseCalls: string[] = [];
  const routes: MockRoute[] = [
    supabaseSelect('external_org_bindings', () => object(BINDING)),
    supabaseRpc('read_vault_secret', () => jsonResponse('odoo-test-key')),
    supabaseSelect('purchase_orders', (c) => { supabaseCalls.push(`purchase_orders ${c.url.search}`); return jsonResponse(over.poRows ?? [{ id: 'po-1' }]); }),
    supabaseSelect('external_refs', () => over.poRef === null ? none() : object({ external_record_id: over.poRef ?? '41' })),
    supabaseSelect('external_command_outbox', () => over.stored ? object({ payload: over.stored }) : none()),
    { label: 'odoo', host: ODOO, response: (call) => {
      odooCalls.push(call);
      const model = call.url.pathname.split('/')[3];
      const answer = (over.odoo ?? {})[model] ?? (model === 'purchase.order.line' ? LINES : []);
      return jsonResponse(typeof answer === 'function' ? answer(call) : answer);
    } },
  ];
  const sc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const ctx = {
    orgId: ORG, serviceClient: sc, userId: 'u-1', faultGate: {}, erpAuth: {},
    command: { domain: 'procurement', operation: 'create', idempotencyKey: KEY, record: { id: GR, erp_doc_kind: 'goods-receipt', procurementId: 'case-1', ...over.record } },
  } as unknown as AdapterSelectContext;
  const record = () => ctx.command.record as Record<string, unknown>;
  const writes = () => odooCalls.filter((c) => !/\/(search_read|read|search|search_count|fields_get|has_access)$/.test(c.url.pathname));
  return { routes, ctx, odooCalls, supabaseCalls, record, writes };
}

describe('OQ-OPP-10 a receipt reissues only on conclusive absence', () => {
  it('the quantity observation covers the whole gap (nothing booked yet is provable), so a miss may continue; revise unchanged', () => {
    assertEquals(odooReissueOnInconclusiveAbsence('receipt'), true);
    assertEquals(odooReissueOnInconclusiveAbsence('bill'), false);
    assertEquals(odooReissueOnInconclusiveAbsence('payment'), false);
  });
});

describe('AC-OPP-031 the plan is fixed on the first attempt and refused above the open quantity before any outbox row', () => {
  it('plans from live Odoo: the entered quantity per line on the case\'s latest order, stamped on the command with its digest', async () => {
    const t = setup({ record: { receiptLines: [{ itemRef: 'Cable', quantity: 6 }] } });
    await withFetchMock(t.routes, () => resolveOdooMoneyOutboxDeps(t.ctx));
    assertEquals(t.record().odooReceipt, await planOf(6));
    assertEquals(t.record().receiptDigest, (await planOf(6)).digest);
    assertEquals(t.writes(), []);   // Odoo is only read
    assert(t.supabaseCalls[0].includes('procurement_id=eq.case-1') && t.supabaseCalls[0].includes('org_id=eq.'), t.supabaseCalls[0]);
  });

  it('a receipt with no lines entered plans every open quantity', async () => {
    const t = setup();
    await withFetchMock(t.routes, () => resolveOdooMoneyOutboxDeps(t.ctx));
    assertEquals((t.record().odooReceipt as { lines: unknown[] }).lines, planLines(10, 4));
  });

  it('11 of 10 is refused commit-rejected, naming the item, with no write', async () => {
    const t = setup({ record: { receiptLines: [{ itemRef: 'Cable', quantity: 11 }] } });
    const err = await withFetchMock(t.routes, () => assertRejects(() => resolveOdooMoneyOutboxDeps(t.ctx))) as { code?: string; message: string };
    assertEquals([err.code, err.message], ['commit-rejected', 'over-receipt: Cable']);
    assertEquals(t.writes(), []);
  });

  it('a client-sent plan or digest is never trusted: both are replaced by the server\'s', async () => {
    const forged = { orderId: 99, lines: planLines(1), digest: 'f'.repeat(32) };
    const t = setup({ record: { receiptLines: [{ itemRef: 'Cable', quantity: 6 }], odooReceipt: forged, receiptDigest: forged.digest } });
    await withFetchMock(t.routes, () => resolveOdooMoneyOutboxDeps(t.ctx));
    assertEquals(t.record().odooReceipt, await planOf(6));
  });

  type Over = Parameters<typeof setup>[0];
  for (const [label, over, reason] of [
    ['a case with no order yet', { poRows: [] }, 'po-missing'],
    ['an order not in Odoo', { poRef: null }, 'order-not-in-odoo'],
    ['an item with no mapping', { record: { receiptLines: [{ itemRef: 'Nail', quantity: 1 }] } }, 'item-unmapped: Nail'],
    ['lines that are not a list', { record: { receiptLines: 'all' } }, 'receipt-lines-invalid'],
  ] as Array<[string, Over, string]>) {
    it(`refuses ${label}: ${reason}`, async () => {
      const t = setup(over);
      const err = await withFetchMock(t.routes, () => assertRejects(() => resolveOdooMoneyOutboxDeps(t.ctx))) as { code?: string; message: string };
      assertEquals([err.code, err.message], ['commit-rejected', reason]);
      assertEquals(t.writes(), []);
    });
  }
});

describe('AC-OPP-032 a retry judges against the persisted plan, never against a state its own validate changed', () => {
  it('reads the stored plan verbatim even though Odoo now shows the receipt booked', async () => {
    const stored = await planOf(6);
    const booked = LINES.map((l) => ({ ...l, qty_received: l.id === 11 ? 6 : 0 }));
    const t = setup({ record: { receiptLines: [{ itemRef: 'Cable', quantity: 6 }] }, stored: { odooReceipt: stored, receiptDigest: stored.digest }, odoo: { 'purchase.order.line': booked } });
    await withFetchMock(t.routes, () => resolveOdooMoneyOutboxDeps(t.ctx));
    assertEquals(t.record().odooReceipt, stored);
    assertEquals(t.record().receiptDigest, stored.digest);
  });

  it('a stored row whose plan is missing or broken is refused (fail closed), never re-planned from moved state', async () => {
    for (const stored of [{ receiptLines: [] }, { odooReceipt: { orderId: 41, lines: [], digest: 'zz' } }]) {
      const t = setup({ stored });
      const err = await withFetchMock(t.routes, () => assertRejects(() => resolveOdooMoneyOutboxDeps(t.ctx))) as { code?: string; message: string };
      assertEquals([err.code, err.message], ['commit-rejected', 'receipt-plan-invalid']);
    }
  });

  it('the probe: nothing booked and no anchor is null (the adapter books it); the other states hold', async () => {
    const plan = await planOf(6);
    const probe = async (odoo: Record<string, Answer>) => {
      const t = setup({ record: { receiptLines: [{ itemRef: 'Cable', quantity: 6 }] }, stored: { odooReceipt: plan }, odoo });
      return await withFetchMock(t.routes, async () => (await resolveOdooMoneyOutboxDeps(t.ctx)).probeByRemarksKey('procurement', KEY));
    };
    assertEquals(await probe({}), null);
    const received = (n: number) => LINES.map((l) => ({ ...l, qty_received: l.id === 11 ? n : 0 }));
    await assertRejects(() => probe({ 'purchase.order.line': received(6) }), Error, 'receipt-held');   // the quantities are there, nothing proves they are ours
    await assertRejects(() => probe({ 'purchase.order.line': received(3) }), Error, 'receipt-held');   // half-booked
  });

  it('the probe adopts a done transfer carrying our identifier, read back with what Odoo booked', async () => {
    const odoo: Record<string, Answer> = {
      'ir.model.data': [{ res_id: 77 }],
      'stock.picking': [{ name: 'WH/IN/00077', state: 'done', move_ids: [901], write_date: '2026-11-03 10:00:00' }],
      'stock.move': [{ id: 901, state: 'done', product_id: [55, 'Cable'], purchase_line_id: [11, 'l'], product_uom_qty: 6, quantity: 6 }],
      'purchase.order.line': LINES.map((l) => ({ ...l, qty_received: l.id === 11 ? 6 : 0 })),
    };
    const t = setup({ record: { receiptLines: [{ itemRef: 'Cable', quantity: 6 }] }, stored: { odooReceipt: await planOf(6) }, odoo });
    const hit = await withFetchMock(t.routes, async () => (await resolveOdooMoneyOutboxDeps(t.ctx)).probeByRemarksKey('procurement', KEY));
    assertEquals(hit?.externalRecordId, '77');
    assertEquals(hit?.canonical, {
      id: GR, gr_number: 'WH/IN/00077', po_id: '41', erp_docstatus: 1, erp_modified: '2026-11-03 10:00:00', odoo_receipt_status: 'Partial',
      odoo_booked: [{ lineId: 11, productId: 55, quantity: 6 }], odoo_entered: [{ lineId: 11, productId: 55, quantity: 6 }],
    });
    assertEquals(t.writes(), []);
  });
});
