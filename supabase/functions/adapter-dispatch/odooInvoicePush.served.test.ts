// #1506 O3 C3 (AC-OCI-010/011/012/031/061, FR-OCI-010/013/020/023/060/062/070/074, OQ-OCI-1): an invoice for an org that employs revenue under tier `odoo`
// is a PMO DRAFT until its approval. Through the SHIPPED handler (`./index.ts`, fetch mocked) with the fake Odoo behind the Odoo host:
//   * authoring and editing a draft make no Odoo call and leave no outbox row (the lines are PMO's, on the draft row);
//   * the approval (a second user; the author is refused before any Odoo call) is ONE command that creates, anchors and posts the invoice from the DRAFT's
//     own lines (the payload claims nothing it can change), through the money outbox, and a retry never creates a second invoice;
//   * Odoo's failures classify (pending vs rejected) and neither its text nor its body reaches a response or a log.
// Every route is a FACT about the world the handler reads (`odooRevenueFixtures.ts`); `unexpected` names any read not mocked.
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import { createJwtAuthority, createTestJwksResolver, installEdgeEnv, withFetchMock } from '../_shared/testing/edgeTestKit.ts';
import type { FetchCall } from '../_shared/testing/edgeTestKit.ts';
import type { FakeOdoo } from '../../../pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts';
import { odooCurrencyAmountsEqual, odooFloatRound, odooLineSubtotal } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/odooRounding.ts';
import { formatTimeMaterialsDescription } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchRevenueFormatting.ts';
import {
  APPROVER_ID, AUTHOR_ID, CLAIM_ID, DRAFT_ID, NEW_INVOICE_ID, ODOO_HOST, PROJECT_ID, CUSTOMER_ID, WORK_ORDER_ID,
  approveCommand, draftCommand, draftRow, invoiceOdooWorld, revenueRoutes, type World,
} from './odooRevenueFixtures.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const auth = await createJwtAuthority(env.SUPABASE_URL);

let servedHandler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (h: unknown) => unknown }).serve = (h: unknown) => {
  servedHandler = h as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));
addEventListener('unload', () => env.restore());

const odooWorld = invoiceOdooWorld;

async function dispatchAs(caller: string, command: Record<string, unknown>, world: World = {}) {
  const unexpected: FetchCall[] = [];
  const logged: string[] = [];
  const realError = console.error, realLog = console.log, realWarn = console.warn;
  const sink = (...args: unknown[]) => { logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  console.error = sink; console.log = sink; console.warn = sink;
  try {
    const result = await withFetchMock(revenueRoutes(unexpected, caller, { projectLink: '101', ...world }), async ({ calls }) => {
      const jwt = await auth.mintJwt({ sub: caller });
      const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
        method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(command),
      }));
      return { status: res.status, body: await res.text(), calls };
    });
    return { ...result, unexpected, logged };
  } finally { console.error = realError; console.log = realLog; console.warn = realWarn; }
}

const noMoneyPipeline = (r: Awaited<ReturnType<typeof dispatchAs>>) => {
  assertEquals(r.calls.filter((c) => c.url.pathname.includes('external_command_outbox') && c.method === 'POST').length, 0, 'no outbox row');
  assertEquals(r.calls.filter((c) => c.url.host === ODOO_HOST).length, 0, 'no Odoo request');
};
const outboxInserts = (r: Awaited<ReturnType<typeof dispatchAs>>) => r.calls.filter((c) => c.method === 'POST' && c.url.pathname === '/rest/v1/external_command_outbox');
const moves = (fake: FakeOdoo) => fake.rows('account.move');
const creates = (fake: FakeOdoo) => fake.calls.filter((c) => c.model === 'account.move' && c.method === 'create').length;

describe('Odoo 20 line rounding', () => {
  it('uses the ORM quantity precision before currency rounding', () => {
    assertEquals(odooLineSubtotal(0.333, 1000.01, 0.01, 0.01), 330);
    assertEquals(odooLineSubtotal(12.345, 1000000, 0.01, 0.01), 12350000);
  });

  it('matches half-up ties, arbitrary currency increments and the large-value epsilon', () => {
    assertEquals(odooFloatRound(0.025, { precisionDigits: 2 }), 0.03);
    assertEquals(odooFloatRound(-0.025, { precisionDigits: 2 }), -0.03);
    assertEquals(odooFloatRound(0.075, { precisionRounding: 0.05 }), 0.1);
    assertEquals(odooFloatRound(1.001 * 11000000164.99, { precisionDigits: 2 }), 11011000165.16);
    assert(odooCurrencyAmountsEqual(odooLineSubtotal(1, 0.3, 0.01, 0.05), 0.3, 0.05));
  });
});

describe('OQ-OCI-1 authoring and editing an invoice draft is PMO\'s alone: no Odoo call, no outbox row, no mapping', () => {
  it('a create saves the draft row with its lines and the verified caller as author, whatever the payload claims', async () => {
    const writes: NonNullable<World['writes']> = [];
    const r = await dispatchAs(AUTHOR_ID, draftCommand({ author_user_id: APPROVER_ID, approved_by: APPROVER_ID, status: 'Submitted', native_lines: [], pmo_native: true }), { writes });
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    assertEquals([r.status, JSON.parse(r.body)], [200, { externalRecordId: null, canonical: { id: NEW_INVOICE_ID, si_number: null, status: 'Draft' }, draft: true }]);
    noMoneyPipeline(r);
    assertEquals(r.calls.filter((c) => c.url.pathname === '/rest/v1/external_refs' && c.method !== 'GET').length, 0, 'no external mapping');
    const insert = writes.find((w) => w.table === 'sales_invoices' && w.method === 'POST')!.body as Record<string, unknown>;
    assertEquals([insert.author_user_id, insert.status, insert.org_id, insert.amount], [AUTHOR_ID, 'Draft', '11111111-1111-4111-8111-111111111111', 2000]);
    assertEquals(insert.pmo_native, undefined, 'the payload cannot make a draft a PMO-native invoice');
    assertEquals((insert.native_lines as Array<Record<string, unknown>>).map((l) => [l.item_code, l.qty, l.rate, l.amount]), [['ITEM-A', 4, 250, 1000], ['ITEM-A', 2, 500, 1000]]);
    assertEquals((writes.find((w) => w.table === 'sales_invoice_authors')!.body as Record<string, unknown>).user_id, AUTHOR_ID, 'the author joins the authorship set the approval\'s SoD reads');
  });

  it('lines that are not in the stored shape are refused 422 before anything is written (no lines, zero quantity, a negative rate, no item code)', async () => {
    for (const items of [[], [{ item_code: 'ITEM-A', qty: 0, rate: 5 }], [{ item_code: 'ITEM-A', qty: 1, rate: -5 }], [{ qty: 1, rate: 5 }], undefined]) {
      const writes: NonNullable<World['writes']> = [];
      const r = await dispatchAs(AUTHOR_ID, draftCommand({ items }), { writes });
      assertEquals([r.status, JSON.parse(r.body).message], [422, 'invoice-lines-invalid'], JSON.stringify(items));
      assertEquals(writes, []);
    }
  });

  it('editing the lines of a draft re-stamps the author and joins the editor to the set: whoever chose the lines can never approve them', async () => {
    const writes: NonNullable<World['writes']> = [];
    const r = await dispatchAs(APPROVER_ID, { ...draftCommand({ id: DRAFT_ID, items: [{ item_code: 'ITEM-A', qty: 1, rate: 300 }] }), operation: 'update' }, { writes });
    assertEquals(r.status, 200, r.body);
    noMoneyPipeline(r);
    const patch = writes.find((w) => w.method === 'RPC')!.body as Record<string, unknown>;
    assertEquals([patch.p_actor_id, patch.p_amount, patch.p_update_native_lines], [APPROVER_ID, 300, true]);
    assertEquals((patch.p_native_lines as Array<Record<string, unknown>>).map((line) => [line.item_code, line.qty, line.rate, line.amount]), [['ITEM-A', 1, 300, 300]]);
    assertEquals(writes.some((w) => w.table === 'sales_invoices' && w.method === 'PATCH'), false, 'the guarded update is one database operation');
    assertEquals((writes.find((w) => w.table === 'sales_invoice_authors')!.body as Record<string, unknown>).user_id, APPROVER_ID);
  });

  it('an edit that reaches the database after approval clearance begins is refused, even before the outbox row exists', async () => {
    const writes: NonNullable<World['writes']> = [];
    const r = await dispatchAs(APPROVER_ID, { ...draftCommand({ id: DRAFT_ID, items: [{ item_code: 'ITEM-A', qty: 1, rate: 301 }] }), operation: 'update' }, { writes, approvalClearance: true });
    assertEquals([r.status, JSON.parse(r.body).message], [409, 'invoice-approval-started']);
    assertEquals(writes.some((w) => w.table === 'sales_invoices' && w.method === 'RPC'), false, 'no draft lines were changed');
    noMoneyPipeline(r);
  });

  it('a draft whose approval has started, or that is no longer a draft, cannot be edited', async () => {
    const started = new Map<string, Record<string, unknown>>([[`${DRAFT_ID}|k`, { pmo_record_id: DRAFT_ID, idempotency_key: 'k', state: 'pending' }]]);
    const a = await dispatchAs(APPROVER_ID, { ...draftCommand({ id: DRAFT_ID }), operation: 'update' }, { outbox: started, writes: [] });
    assertEquals([a.status, JSON.parse(a.body).message], [409, 'invoice-approval-started']);
    const b = await dispatchAs(APPROVER_ID, { ...draftCommand({ id: DRAFT_ID }), operation: 'update' }, { draft: draftRow({ status: 'Unpaid', erp_docstatus: 1 }), writes: [] });
    assertEquals([b.status, JSON.parse(b.body).message], [422, 'invoice-not-a-draft']);
    noMoneyPipeline(b);
  });
});

describe('AC-OCI-010 / FR-OCI-060 the approval: the author is refused before any Odoo call; a second user creates and posts exactly one invoice', () => {
  const claiming = () => approveCommand({ approved_by: AUTHOR_ID, author: AUTHOR_ID, customerId: '12121212-1212-4121-8121-121212121212', items: [{ item_code: 'ITEM-A', qty: 999, rate: 999 }] });

  it('the draft\'s AUTHOR approving is refused 403 sod-self-approval before the outbox and Odoo', async () => {
    const odoo = odooWorld();
    const r = await dispatchAs(AUTHOR_ID, claiming(), { odoo });
    assertEquals([r.status, JSON.parse(r.body)], [403, { error: 'commit-rejected', message: 'sod-self-approval' }]);
    noMoneyPipeline(r);
    assertEquals(moves(odoo).length, 0);
  });

  it('a DIFFERENT user: one outbox row, one posted Odoo invoice from the DRAFT\'s lines (the payload\'s customer and items change nothing), the mirror carries Odoo\'s facts', async () => {
    const odoo = odooWorld();
    const grants: string[] = [];
    const writes: NonNullable<World['writes']> = [];
    const r = await dispatchAs(APPROVER_ID, claiming(), { odoo, grants, writes });
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    assertEquals(r.status, 200, r.body);
    assertEquals(grants, [APPROVER_ID], 'the approver is the JWT subject, never the payload\'s');
    const [invoice] = moves(odoo);
    assertEquals(moves(odoo).length, 1);
    assertEquals([invoice.move_type, invoice.state, invoice.partner_id, invoice.ref, invoice.amount_untaxed, invoice.amount_tax, invoice.amount_total], ['out_invoice', 'posted', 41, 'WO-PO-9', 2000, 220, 2220]);
    const lines = odoo.rows('account.move.line').filter((l) => l.move_id === invoice.id && l.display_type === 'product');
    assertEquals(lines.map((l) => [l.quantity, l.price_unit, l.tax_ids, l.analytic_distribution]), [[4, 250, [5], { '101': 100 }], [2, 500, [5], { '101': 100 }]]);
    assertEquals(JSON.stringify(odoo.rows('account.move')).includes(APPROVER_ID) || JSON.stringify(odoo.rows('account.move.line')).includes(AUTHOR_ID), false, 'no PMO user id reaches Odoo');
    const [insert] = outboxInserts(r);
    const body = insert.bodyJson as { operation: string; payload: Record<string, unknown> };
    assertEquals(body.operation, 'create', 'the row is the create it is: the work-order fence of 0262 reads it as one');
    assertEquals([body.payload.customerId, body.payload.projectId, body.payload.workOrderId], ['44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666']);
    assertEquals((body.payload.items as unknown[]).length, 2, 'the draft\'s lines, not the payload\'s');
    assertEquals([body.payload.odoo_partner_id, body.payload.odoo_expected_total, body.payload.odoo_cost_account], [41, '2220.00', 101]);
    assert(typeof body.payload.created_after === 'string' && typeof body.payload.created_before === 'string', 'the recovery window is bounded on both sides');
    const mirror = writes.find((w) => w.table === 'sales_invoices' && w.method === 'PATCH')!.body as Record<string, unknown>;
    assertEquals([mirror.si_number, mirror.amount, mirror.tax_amount, mirror.erp_outstanding_amount, mirror.status, mirror.erp_docstatus, mirror.odoo_state, mirror.odoo_attention], [invoice.name, '2220.00', '220.00', '2220.00', 'Unpaid', 1, 'posted', null]);
  });

  it('C3 ordinary invoice lines are reshaped only when Odoo would book a different currency amount', async () => {
    const writes: NonNullable<World['writes']> = [];
    const created = await dispatchAs(AUTHOR_ID, draftCommand({ items: [{ item_code: 'ITEM-A', description: 'Roadworks (km)', qty: 0.333, rate: 1000.01 }] }), { writes });
    assertEquals(created.status, 200, created.body);
    noMoneyPipeline(created);
    const saved = writes.find((w) => w.table === 'sales_invoices' && w.method === 'POST')!.body as Record<string, unknown>;
    assertEquals([saved.amount, (saved.native_lines as Array<Record<string, unknown>>)[0].amount], [333, 333]);

    const odoo = invoiceOdooWorld();
    const approved = await dispatchAs(APPROVER_ID, approveCommand(), {
      writes, odoo, draft: draftRow({ native_lines: saved.native_lines, amount: saved.amount }),
    });
    assertEquals(approved.status, 200, approved.body);
    const [invoice] = odoo.rows('account.move');
    const [line] = odoo.rows('account.move.line').filter((row) => row.move_id === invoice.id && row.display_type === 'product');
    assertEquals([line.quantity, line.price_unit, invoice.amount_untaxed], [1, 333, 333], 'Odoo receives one unit priced at the signed PMO draft amount');
    assertEquals(line.name, formatTimeMaterialsDescription('Roadworks', 'km', 0.333, 1000.01, 333, 'IDR'));
  });

  it('refuses before the outbox when Odoo quantity precision cannot be read', async () => {
    const odoo = invoiceOdooWorld();
    const fetchOdoo = odoo.fetch;
    odoo.fetch = (url, init) => /\/decimal\.precision\/search_read$/.test(String(url))
      ? Promise.resolve(Response.json([]))
      : fetchOdoo(url, init);
    const r = await dispatchAs(APPROVER_ID, approveCommand(), { odoo });
    assertEquals([r.status, JSON.parse(r.body).error, JSON.parse(r.body).message], [422, 'config-rejected', 'config-rejected: the product-unit quantity precision could not be read']);
    assertEquals(outboxInserts(r).length, 0, 'configuration is checked before the outbox snapshot');
    assertEquals(creates(odoo), 0, 'no Odoo invoice is written');
  });

  it('refuses before the outbox when Odoo currency rounding cannot be read', async () => {
    const odoo = invoiceOdooWorld();
    const fetchOdoo = odoo.fetch;
    odoo.fetch = (url, init) => /\/res\.currency\/read$/.test(String(url))
      ? Promise.resolve(Response.json([]))
      : fetchOdoo(url, init);
    const r = await dispatchAs(APPROVER_ID, approveCommand(), { odoo });
    assertEquals([r.status, JSON.parse(r.body).error, JSON.parse(r.body).message], [422, 'config-rejected', 'config-rejected: the invoice currency rounding could not be read']);
    assertEquals(outboxInserts(r).length, 0, 'configuration is checked before the outbox snapshot');
    assertEquals(creates(odoo), 0, 'no Odoo invoice is written');
  });

  it('AC-OCI-011 a retry of the same command is a replay: no second outbox row, no second create, no second post', async () => {
    const odoo = odooWorld();
    const outbox = new Map<string, Record<string, unknown>>();
    const first = await dispatchAs(APPROVER_ID, approveCommand(), { odoo, outbox });
    assertEquals(first.status, 200, first.body);
    const again = await dispatchAs(APPROVER_ID, approveCommand(), { odoo, outbox, draft: draftRow({ status: 'Unpaid', erp_docstatus: 1 }), draftMapped: true });
    assertEquals(again.status, 200, again.body);
    assertEquals([moves(odoo).length, creates(odoo), odoo.calls.filter((c) => c.method === 'action_post').length], [1, 1, 1]);
    assertEquals(outboxInserts(again).length, 0, 'the retry reuses the first attempt\'s row');
  });

  it('FR-OCI-070 a new approval after a rejected anchor write uses the same server-derived key and never creates a second invoice', async () => {
    const odoo = odooWorld();
    const call = odoo.fetch.bind(odoo);
    let rejectAnchor = true;
    odoo.fetch = (url: string | URL | Request, init?: RequestInit) => {
      if (rejectAnchor && /\/ir\.model\.data\/create$/.test(String(url))) {
        rejectAnchor = false;
        return Promise.resolve(Response.json({ name: 'odoo.exceptions.ValidationError', message: 'private fixture text' }, { status: 422 }));
      }
      return call(url, init);
    };
    const outbox = new Map<string, Record<string, unknown>>();
    const first = await dispatchAs(APPROVER_ID, approveCommand(), { odoo, outbox });
    assertEquals(first.status, 422, first.body);
    assertEquals([moves(odoo).length, creates(odoo)], [1, 1], 'the non-transient anchor rejection follows a successful create');
    // Fake Odoo starts on a fixed clock; model the created invoice as recent enough for the bounded recovery probe.
    moves(odoo)[0].create_date = new Date().toISOString().slice(0, 19).replace('T', ' ');

    const second = await dispatchAs(APPROVER_ID, { ...approveCommand(), idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-000000001509' }, { odoo, outbox });
    assertEquals([second.status, JSON.parse(second.body).message.includes('held for operator resolution')], [409, true], second.body);
    assertEquals([moves(odoo).length, creates(odoo)], [1, 1], 'a later approval under a different client key cannot mint a second invoice');
    const invoiceOutboxRows = [...outbox.values()].filter((row) => row.pmo_record_id === DRAFT_ID);
    assertEquals(invoiceOutboxRows.map((row) => row.idempotency_key), [`si:${DRAFT_ID}`], 'the Odoo invoice key is derived from the PMO invoice on the server');
    assertEquals(invoiceOutboxRows.map((row) => row.state), ['held'], 'the same outbox command is durably held for reconciliation');
  });

  it('FR-OCI-070 an Odoo invoice approval does not need a caller-supplied idempotency key', async () => {
    const odoo = odooWorld();
    const { idempotencyKey: _callerKey, ...command } = approveCommand();
    const outbox = new Map<string, Record<string, unknown>>();
    const r = await dispatchAs(APPROVER_ID, command, { odoo, outbox });
    assertEquals(r.status, 200, r.body);
    assertEquals(moves(odoo).length, 1);
    assertEquals([...outbox.values()].map((row) => row.idempotency_key), [`si:${DRAFT_ID}`]);
  });

  it('M-1 a mapped invoice that is no longer a draft is refused by the adapter path under a new key', async () => {
    const odoo = odooWorld();
    const command = { ...approveCommand(), idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-000000001510' };
    const r = await dispatchAs(APPROVER_ID, command, { odoo, draft: draftRow({ status: 'Unpaid', erp_docstatus: 1 }), draftMapped: true });
    assertEquals([r.status, JSON.parse(r.body).message], [422, 'invoice-not-a-draft']);
    assertEquals(outboxInserts(r).length, 0, 'no outbox row');
    assertEquals(creates(odoo), 0, 'no Odoo invoice create');
    assertEquals(r.calls.filter((c) => c.url.host === ODOO_HOST).length, 0, 'no Odoo write');
  });

  it('AC-OCI-011 a lost response on the post: the retry adopts the posted invoice, creates nothing, posts nothing again', async () => {
    const odoo = odooWorld();
    odoo.failAt('after-post');
    const outbox = new Map<string, Record<string, unknown>>();
    const first = await dispatchAs(APPROVER_ID, approveCommand(), { odoo, outbox });
    assert(first.status >= 500 || first.status === 409 || first.status === 202, `pending, not success and not rejection: ${first.status} ${first.body}`);
    assertEquals(moves(odoo)[0].state, 'posted');
    const retry = await dispatchAs(APPROVER_ID, approveCommand(), { odoo, outbox, draft: draftRow(), draftMapped: true });
    assertEquals(retry.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    assertEquals(retry.status, 200, retry.body);
    assertEquals([moves(odoo).length, creates(odoo), odoo.calls.filter((c) => c.method === 'action_post').length], [1, 1, 1]);
  });

});

describe('AC-OCI-012 / AC-OCI-031 / FR-OCI-023 an approval that cannot be built writes nothing and leaves no outbox row', () => {
  const refused = async (world: World, message: RegExp | string) => {
    const odoo = odooWorld();
    const r = await dispatchAs(APPROVER_ID, approveCommand(), { odoo, ...world });
    assertEquals(r.status, 422, r.body);
    assert(typeof message === 'string' ? JSON.parse(r.body).message === message : message.test(JSON.parse(r.body).message), r.body);
    assertEquals(outboxInserts(r).length, 0, 'no outbox row');
    assertEquals(creates(odoo), 0);
  };
  it('an item with no Odoo product refuses naming the item', async () => {
    await refused({ draft: draftRow({ native_lines: [{ item_code: 'UNMAPPED', description: 'x', qty: 1, rate: 5, amount: 5 }] }) }, /config-rejected: item: UNMAPPED/);
  });
  it('a client with no Odoo partner refuses naming the client', async () => {
    await refused({ draft: draftRow({ customer_id: null }) }, /config-rejected: client/);
  });
  it('an unlinked project, or a link in needs-attention, refuses with a named reason', async () => {
    await refused({ projectLink: null }, 'project-unlinked');
    await refused({ account: { active: false, tombstoned_at: null } }, 'project-needs-attention');
  });
  it('a sale tax that is not a PPN output tax, or not mirrored, refuses naming the tax', async () => {
    await refused({ saleTax: 'collector' }, /sale tax 12% \(Non-Luxury Good\) cannot be used/);
    await refused({ saleTax: 'absent' }, /sale tax cannot be used/);
  });
  it('no draft row, a row that is no longer a draft, and a PMO-native invoice are refused', async () => {
    await refused({ draft: null }, 'invoice-draft-missing');
    await refused({ draft: draftRow({ status: 'Unpaid', erp_docstatus: 1 }) }, 'invoice-not-a-draft');
  });
});

describe('AC-OCI-020 / AC-OCI-021 / AC-OCI-022 / AC-OCI-023 Odoo billing claims', () => {
  const progressClaim = {
    id: CLAIM_ID, project_id: PROJECT_ID, work_order_id: WORK_ORDER_ID, kind: 'progress', currency: 'IDR',
    down_payment_amount: null, dp_recovery_amount: '40000.00', dp_item_code: 'ITEM-DP', withdrawn_at: null,
  };
  const progressLines = [{ item_code: 'ITEM-A', description: 'Roadworks', unit: 'km', quantity: '10.000', rate: '50000.00', amount: '500000.00' }];
  const evidence = [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }];
  const nativeClaimLines = [
    { item_code: 'ITEM-A', description: 'Roadworks (km)', qty: 10, rate: 50000, amount: 500000 },
    { item_code: 'ITEM-DP', description: null, qty: 1, rate: -40000, amount: -40000 },
  ];
  const claimDraft = (nativeLines = nativeClaimLines, over: Record<string, unknown> = {}) => draftRow({ id: CLAIM_ID, customer_id: CUSTOMER_ID, project_id: PROJECT_ID, work_order_id: WORK_ORDER_ID, native_lines: nativeLines.map((line) => ({ ...line })), ...over });
  const timeMaterialsClaim = {
    id: CLAIM_ID, project_id: PROJECT_ID, work_order_id: null, kind: 'time_materials', currency: 'IDR', gross_amount: '6000000.00',
    down_payment_amount: null, dp_recovery_amount: '0.00', dp_item_code: null, withdrawn_at: null,
  };
  const signedTimeMaterialsClaim = { id: CLAIM_ID, status: 'SignedOff', confirmed_by: APPROVER_ID, gross_amount: '6000000.00' };
  const timeMaterialsLines = [{ line_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', rate_version: 1, kind: 'labour', label: 'Field labour', unit: 'hour', units: '120.00', rate: '50000.00', amount: '6000000.00' }];
  const nativeTimeMaterialsLines = [{ item_code: 'Field labour', description: 'Field labour (hour)', qty: 120, rate: 50000, amount: 6000000, unit: 'hour' }];
  const timeMaterialsDraft = () => draftRow({ id: CLAIM_ID, customer_id: CUSTOMER_ID, project_id: PROJECT_ID, work_order_id: null, native_lines: nativeTimeMaterialsLines });

  it('Finance raising a progress claim saves a locked PMO draft from claim rows and makes no Odoo call', async () => {
    const writes: NonNullable<World['writes']> = [];
    const r = await dispatchAs(AUTHOR_ID, draftCommand({ id: CLAIM_ID, items: [{ item_code: 'ITEM-A', qty: 999, rate: 999 }] }), {
      progressClaim, progressClaimLines: progressLines, progressClaimEvidence: evidence, writes,
    });

    assertEquals(r.status, 200, r.body);
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every claim read is modeled');
    assertEquals(r.calls.filter((c) => c.url.host === ODOO_HOST).length, 0, 'raising the PMO draft does not call Odoo');
    noMoneyPipeline(r);
    const insert = writes.find((w) => w.table === 'sales_invoices' && w.method === 'POST')!.body as Record<string, unknown>;
    assertEquals([insert.customer_id, insert.project_id, insert.work_order_id, insert.author_user_id], [CUSTOMER_ID, PROJECT_ID, WORK_ORDER_ID, AUTHOR_ID]);
    assertEquals(insert.native_lines, nativeClaimLines, 'the claim recorded lines and recovery line replace payload items');
  });

  it('AC-OCI-020 a withdrawn progress claim cannot contribute lines to an Odoo invoice draft', async () => {
    const writes: NonNullable<World['writes']> = [];
    const r = await dispatchAs(AUTHOR_ID, draftCommand({ id: CLAIM_ID }), {
      progressClaim: { ...progressClaim, withdrawn_at: '2026-11-03T00:00:00Z' },
      progressClaimLines: progressLines, progressClaimEvidence: evidence, writes,
    });

    assertEquals([r.status, JSON.parse(r.body).message], [422, 'This progress claim was withdrawn, so no invoice can be raised for it']);
    assertEquals(writes, []);
    noMoneyPipeline(r);
  });

  it('C4 fractional claim quantities post the signed line amounts, not Odoo-rounded quantities', async () => {
    const fractionalClaim = { ...progressClaim, dp_recovery_amount: '0.00', dp_item_code: null };
    const fractionalLines = [
      { item_code: 'ITEM-A', description: 'Roadworks', unit: 'km', quantity: '0.333', rate: '1000.01', amount: '333.00' },
      { item_code: 'ITEM-A', description: 'Earthworks', unit: 'm3', quantity: '12.345', rate: '1000000.00', amount: '12345000.00' },
    ];
    const recordedLines = [
      { item_code: 'ITEM-A', description: 'Roadworks (km)', qty: 0.333, rate: 1000.01, amount: 333 },
      { item_code: 'ITEM-A', description: 'Earthworks (m3)', qty: 12.345, rate: 1000000, amount: 12345000 },
    ];
    const writes: NonNullable<World['writes']> = [];
    const draft = await dispatchAs(AUTHOR_ID, draftCommand({ id: CLAIM_ID }), {
      progressClaim: fractionalClaim, progressClaimLines: fractionalLines, progressClaimEvidence: evidence, writes,
    });
    assertEquals(draft.status, 200, draft.body);
    const saved = writes.find((w) => w.table === 'sales_invoices' && w.method === 'POST')!.body as Record<string, unknown>;
    assertEquals([saved.amount, saved.native_lines], [12345333, recordedLines], 'PMO stores the immutable signed per-line amounts');

    const odoo = invoiceOdooWorld();
    const approved = await dispatchAs(APPROVER_ID, approveCommand({ id: CLAIM_ID }), {
      progressClaim: fractionalClaim, progressClaimLines: fractionalLines, progressClaimEvidence: evidence,
      draft: claimDraft(recordedLines), invoiceAuthor: AUTHOR_ID, writes, odoo,
    });
    assertEquals(approved.status, 200, approved.body);
    const [invoice] = odoo.rows('account.move');
    const posted = odoo.rows('account.move.line').filter((line) => line.move_id === invoice.id && line.display_type === 'product');
    assertEquals([invoice.amount_untaxed, posted.map((line) => [line.quantity, line.price_unit])], [12345333, [[1, 333], [1, 12345000]]]);
    assert(posted.every((line) => String(line.name).includes('rounded to')));
  });

  it('a half-cent claim amount is copied to the PMO draft and used for its posted line', async () => {
    const tieClaim = { ...progressClaim, dp_recovery_amount: '0.00', dp_item_code: null };
    const tieLines = [{ item_code: 'ITEM-A', description: 'Survey', unit: 'hour', quantity: '1.001', rate: '15.00', amount: '15.02' }];
    const nativeLines = [{ item_code: 'ITEM-A', description: 'Survey (hour)', qty: 1.001, rate: 15, amount: 15.02 }];
    const writes: NonNullable<World['writes']> = [];
    const created = await dispatchAs(AUTHOR_ID, draftCommand({ id: CLAIM_ID }), {
      progressClaim: tieClaim, progressClaimLines: tieLines, progressClaimEvidence: evidence, writes,
    });
    assertEquals(created.status, 200, created.body);
    const saved = writes.find((w) => w.table === 'sales_invoices' && w.method === 'POST')!.body as Record<string, unknown>;
    assertEquals([saved.amount, (saved.native_lines as Array<Record<string, unknown>>)[0].amount], [15.02, 15.02]);

    const odoo = invoiceOdooWorld();
    const approved = await dispatchAs(APPROVER_ID, approveCommand({ id: CLAIM_ID }), {
      progressClaim: tieClaim, progressClaimLines: tieLines, progressClaimEvidence: evidence,
      draft: claimDraft(nativeLines), invoiceAuthor: AUTHOR_ID, writes, odoo,
    });
    assertEquals(approved.status, 200, approved.body);
    const [invoice] = odoo.rows('account.move');
    const [line] = odoo.rows('account.move.line').filter((row) => row.move_id === invoice.id && row.display_type === 'product');
    assertEquals([line.quantity, line.price_unit, invoice.amount_untaxed], [1, 15.02, 15.02]);
  });

  it('Odoo float epsilon at large values is reproduced and the signed amount is retained', async () => {
    const largeClaim = { ...progressClaim, dp_recovery_amount: '0.00', dp_item_code: null };
    const largeLines = [{ item_code: 'ITEM-A', description: 'Pipeline', unit: 'km', quantity: '1.001', rate: '11000000164.99', amount: '11011000165.15' }];
    const nativeLines = [{ item_code: 'ITEM-A', description: 'Pipeline (km)', qty: 1.001, rate: 11000000164.99, amount: 11011000165.15 }];
    const writes: NonNullable<World['writes']> = [];
    const created = await dispatchAs(AUTHOR_ID, draftCommand({ id: CLAIM_ID }), {
      progressClaim: largeClaim, progressClaimLines: largeLines, progressClaimEvidence: evidence, writes,
    });
    assertEquals(created.status, 200, created.body);
    const odoo = invoiceOdooWorld();
    (odoo.rows('decimal.precision')[0] as Record<string, unknown>).digits = 3;
    const approved = await dispatchAs(APPROVER_ID, approveCommand({ id: CLAIM_ID }), {
      progressClaim: largeClaim, progressClaimLines: largeLines, progressClaimEvidence: evidence,
      draft: claimDraft(nativeLines), invoiceAuthor: AUTHOR_ID, writes, odoo,
    });
    assertEquals(approved.status, 200, approved.body);
    const [invoice] = odoo.rows('account.move');
    const [line] = odoo.rows('account.move.line').filter((row) => row.move_id === invoice.id && row.display_type === 'product');
    assertEquals([line.quantity, line.price_unit, invoice.amount_untaxed], [1, 11011000165.15, 11011000165.15]);
  });

  it('the claim author cannot submit the claim draft; a different approver posts the recorded lines once', async () => {
    const denied = await dispatchAs(AUTHOR_ID, approveCommand({ id: CLAIM_ID }), {
      progressClaim, progressClaimLines: progressLines, progressClaimEvidence: evidence, draft: claimDraft(), invoiceAuthor: AUTHOR_ID,
    });
    assertEquals([denied.status, JSON.parse(denied.body).message], [403, 'sod-self-approval']);
    noMoneyPipeline(denied);

    const odoo = invoiceOdooWorld();
    const writes: NonNullable<World['writes']> = [];
    const grants: string[] = [];
    const world: World = { progressClaim, progressClaimLines: progressLines, progressClaimEvidence: evidence, draft: claimDraft(), invoiceAuthor: AUTHOR_ID, writes, grants, odoo };
    const approved = await dispatchAs(APPROVER_ID, approveCommand({ id: CLAIM_ID, items: [{ item_code: 'ITEM-A', qty: 999, rate: 999 }] }), world);
    assertEquals(approved.status, 200, approved.body);
    assertEquals(approved.unexpected, [], 'every claim approval read is modeled');
    assertEquals(grants, [APPROVER_ID], 'the second user is the verified submitter');
    const [invoice] = odoo.rows('account.move');
    assertEquals([invoice.ref, invoice.amount_untaxed, invoice.amount_tax, invoice.amount_total], ['WO-PO-9', 460000, 50600, 510600]);
    const posted = odoo.rows('account.move.line').filter((line) => line.move_id === invoice.id && line.display_type === 'product');
    assertEquals(posted.map((line) => [line.product_id, line.quantity, line.price_unit, line.account_id, line.analytic_distribution]), [
      [71, 10, 50000, 149, { '101': 100 }],
      [72, 1, -40000, 210, { '101': 100 }],
    ]);
    const body = JSON.parse(approved.body) as { canonical?: Record<string, unknown> };
    assertEquals([body.canonical?.work_order_id, body.canonical?.odoo_attention], [WORK_ORDER_ID, null], 'the claim work_order_id is retained through read-back');
  });

  it('AC-OCI-020 approval refuses a claim draft whose recovery line differs from the immutable claim rows', async () => {
    const odoo = invoiceOdooWorld();
    const driftedDraft = claimDraft();
    driftedDraft.native_lines[1] = { ...driftedDraft.native_lines[1], rate: -30000, amount: -30000 };
    const writes: NonNullable<World['writes']> = [];
    const r = await dispatchAs(APPROVER_ID, approveCommand({ id: CLAIM_ID }), {
      progressClaim, progressClaimLines: progressLines, progressClaimEvidence: evidence,
      draft: driftedDraft, invoiceAuthor: AUTHOR_ID, writes, odoo,
    });

    assertEquals([r.status, JSON.parse(r.body).message], [422, 'claim-invoice-draft-mismatch']);
    noMoneyPipeline(r);
    assertEquals(outboxInserts(r).length, 0, 'no outbox row records the drifted claim invoice');
    assertEquals(writes, []);
    assertEquals(odoo.calls, []);
  });

  it('DD-PBL-7 refuses a claim invoice draft whose project differs from the immutable claim project', async () => {
    const odoo = invoiceOdooWorld();
    const writes: NonNullable<World['writes']> = [];
    const r = await dispatchAs(APPROVER_ID, approveCommand({ id: CLAIM_ID }), {
      progressClaim, progressClaimLines: progressLines, progressClaimEvidence: evidence,
      draft: claimDraft(nativeClaimLines, { project_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      invoiceAuthor: AUTHOR_ID, writes, odoo,
    });
    assertEquals([r.status, JSON.parse(r.body).message], [422, 'claim-invoice-draft-mismatch']);
    assertEquals(outboxInserts(r).length, 0);
    assertEquals(creates(odoo), 0);
    assertEquals(writes, []);
  });

  it('DD-PBL-7 refuses a case-variant claim id', async () => {
    const caseVariantId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
    const writes: NonNullable<World['writes']> = [];
    const r = await dispatchAs(AUTHOR_ID, draftCommand({ id: caseVariantId }), {
      progressClaim: { ...progressClaim, id: caseVariantId.toUpperCase() }, progressClaimLines: progressLines,
      progressClaimEvidence: evidence, writes,
    });
    assertEquals([r.status, JSON.parse(r.body)], [422, { error: 'commit-rejected', message: 'The billing claim cannot be invoiced through Odoo' }], r.body);
    assertEquals(writes, []);
    noMoneyPipeline(r);
  });

  it('a claim-derived draft cannot be edited after it has been copied from the immutable claim', async () => {
    const writes: NonNullable<World['writes']> = [];
    const r = await dispatchAs(APPROVER_ID, { ...draftCommand({ id: CLAIM_ID, items: [{ item_code: 'ITEM-A', qty: 1, rate: 1 }] }), operation: 'update' }, {
      progressClaim, progressClaimLines: progressLines, progressClaimEvidence: evidence, draft: claimDraft(), writes,
    });

    assertEquals([r.status, JSON.parse(r.body).message], [409, 'claim-invoice-lines-locked']);
    assertEquals(writes, []);
    assertEquals(r.calls.filter((c) => c.url.host === ODOO_HOST).length, 0);
  });

  it('AC-OCI-024 a signed T&M claim creates a locked draft from its canonical lines, regardless of the payload', async () => {
    const writes: NonNullable<World['writes']> = [];
    const r = await dispatchAs(AUTHOR_ID, draftCommand({ id: CLAIM_ID, customerId: '12121212-1212-4121-8121-121212121212', items: [{ item_code: 'ITEM-A', qty: 999, rate: 999 }] }), {
      progressClaim: timeMaterialsClaim, timeMaterialsClaim: signedTimeMaterialsClaim, timeMaterialsClaimLines: timeMaterialsLines,
      progressClaimEvidence: evidence, writes,
    });

    assertEquals(r.status, 200, r.body);
    assertEquals(r.unexpected, [], 'every T&M claim read is modeled');
    noMoneyPipeline(r);
    const insert = writes.find((w) => w.table === 'sales_invoices' && w.method === 'POST')!.body as Record<string, unknown>;
    assertEquals([insert.customer_id, insert.project_id, insert.work_order_id ?? null, insert.author_user_id], [CUSTOMER_ID, PROJECT_ID, null, AUTHOR_ID]);
    assertEquals(insert.native_lines, nativeTimeMaterialsLines, 'label, unit, approved units and frozen rate replace caller lines');
    assertEquals(insert.amount, 6000000, 'the signed claim gross is the PMO draft total');
  });

  it('AC-OCI-024 a Draft or withdrawn T&M claim cannot contribute lines to an invoice', async () => {
    for (const [state, progressClaim, expected] of [
      ['Draft', timeMaterialsClaim, 'Confirm the time-and-materials claim before raising its invoice'],
      ['Withdrawn', { ...timeMaterialsClaim, withdrawn_at: '2026-11-03T00:00:00Z' }, 'This time-and-materials claim was withdrawn, so no invoice can be raised for it'],
    ] as const) {
      const writes: NonNullable<World['writes']> = [];
      const r = await dispatchAs(AUTHOR_ID, draftCommand({ id: CLAIM_ID, items: [{ item_code: 'Field labour', qty: 120, rate: 50000 }] }), {
        progressClaim: state === 'Draft' ? null : progressClaim,
        timeMaterialsClaim: { ...signedTimeMaterialsClaim, status: state, confirmed_by: state === 'Draft' ? null : APPROVER_ID },
        timeMaterialsClaimLines: timeMaterialsLines, progressClaimEvidence: evidence, writes,
      });

      assertEquals([r.status, JSON.parse(r.body).message], [422, expected], state);
      assertEquals(writes, [], `${state} T&M amounts never become invoice draft lines`);
      noMoneyPipeline(r);
    }
  });

  it('AC-OCI-024 the T&M claim author cannot approve; a second approver posts 120 hours at the frozen rate and the signed gross', async () => {
    const denied = await dispatchAs(AUTHOR_ID, approveCommand({ id: CLAIM_ID, items: [{ item_code: 'Field labour', qty: 1, rate: 1 }] }), {
      progressClaim: timeMaterialsClaim, timeMaterialsClaim: signedTimeMaterialsClaim, timeMaterialsClaimLines: timeMaterialsLines,
      progressClaimEvidence: evidence, draft: timeMaterialsDraft(), invoiceAuthor: AUTHOR_ID,
    });
    assertEquals([denied.status, JSON.parse(denied.body).message], [403, 'sod-self-approval']);
    noMoneyPipeline(denied);

    const odoo = invoiceOdooWorld();
    const writes: NonNullable<World['writes']> = [];
    const grants: string[] = [];
    const approved = await dispatchAs(APPROVER_ID, approveCommand({ id: CLAIM_ID, customerId: '12121212-1212-4121-8121-121212121212', items: [{ item_code: 'ITEM-DP', qty: 1, rate: 1 }] }), {
      progressClaim: timeMaterialsClaim, timeMaterialsClaim: signedTimeMaterialsClaim, timeMaterialsClaimLines: timeMaterialsLines,
      progressClaimEvidence: evidence, projectSubjectToVat: false, draft: timeMaterialsDraft(), invoiceAuthor: AUTHOR_ID, grants, writes, odoo,
    });

    assertEquals(approved.status, 200, approved.body);
    assertEquals(approved.unexpected, [], 'every signed T&M approval read is modeled');
    assertEquals(grants, [APPROVER_ID], 'approval identity comes from the authenticated caller');
    const [invoice] = odoo.rows('account.move');
    assertEquals([invoice.state, invoice.amount_untaxed, invoice.amount_tax, invoice.amount_total], ['posted', 6000000, 0, 6000000]);
    const posted = odoo.rows('account.move.line').filter((line) => line.move_id === invoice.id && line.display_type === 'product');
    assertEquals(posted.map((line) => [line.product_id, line.quantity, line.price_unit, line.analytic_distribution]), [[71, 120, 50000, { '101': 100 }]]);
    assertEquals(posted[0].product_uom_id, 13, 'the frozen claim hour unit maps to Odoo');
    assertEquals(JSON.parse(approved.body).canonical.amount, '6000000.00', 'the Odoo booked total equals the signed claim gross to the cent');
  });

  it('AC-OCI-024 an approved T&M line carries its frozen amount into the reshaped Odoo invoice line', async () => {
    const amount = 162052101764.36;
    const claim = { ...timeMaterialsClaim, gross_amount: '162052101764.36' };
    const signoff = { ...signedTimeMaterialsClaim, gross_amount: '162052101764.36' };
    const claimLines = [{ ...timeMaterialsLines[0], units: '331052.81', rate: '489505.29', amount: '162052101764.36' }];
    const draft = draftRow({
      id: CLAIM_ID, customer_id: CUSTOMER_ID, project_id: PROJECT_ID, work_order_id: null,
      native_lines: [{ item_code: 'Field labour', description: 'Field labour (hour)', qty: 331052.81, rate: 489505.29, amount, unit: 'hour' }],
    });
    const odoo = invoiceOdooWorld();
    const approved = await dispatchAs(APPROVER_ID, approveCommand({ id: CLAIM_ID }), {
      progressClaim: claim, timeMaterialsClaim: signoff, timeMaterialsClaimLines: claimLines,
      progressClaimEvidence: evidence, projectSubjectToVat: false, draft, invoiceAuthor: AUTHOR_ID, odoo,
    });

    assertEquals(approved.status, 200, approved.body);
    assertEquals(approved.unexpected, [], 'every signed T&M approval read is modeled');
    const [invoice] = odoo.rows('account.move');
    const posted = odoo.rows('account.move.line').filter((line) => line.move_id === invoice.id && line.display_type === 'product');
    assertEquals(posted.map((line) => [line.quantity, line.price_unit, line.name]), [[
      1, amount, 'Field labour (hour): 331.052,81 x 489.505,29, rounded to Rp\u00a0162.052.101.764,36',
    ]]);
    assertEquals(JSON.parse(approved.body).canonical.amount, '162052101764.36', 'read-back matches the signed gross');
  });

  it('AC-OCI-024 refuses before the Odoo draft when Product Unit precision is unavailable', async () => {
    const writes: NonNullable<World['writes']> = [];
    const odoo = invoiceOdooWorld();
    odoo.dropModel('decimal.precision');
    const r = await dispatchAs(APPROVER_ID, approveCommand({ id: CLAIM_ID }), {
      progressClaim: timeMaterialsClaim, timeMaterialsClaim: signedTimeMaterialsClaim,
      timeMaterialsClaimLines: timeMaterialsLines, progressClaimEvidence: evidence, draft: timeMaterialsDraft(),
      invoiceAuthor: AUTHOR_ID, writes, odoo,
    });

    assertEquals([r.status, JSON.parse(r.body).message], [422, 'config-rejected: the product unit precision could not be checked against Odoo']);
    assertEquals(odoo.rows('account.move'), []);
    assertEquals(writes, []);
    assertEquals(odoo.calls.some((call) => call.model === 'decimal.precision' && call.method === 'search_read'), true, 'Odoo precision is read before any invoice write');
    assertEquals(odoo.calls.filter((call) => call.model === 'account.move' && (call.method === 'create' || call.method === 'action_post')), []);
    assertEquals(r.calls.filter((call) => call.url.pathname.includes('external_command_outbox') && call.method === 'POST'), []);
  });

  it('AC-OCI-024 an existing T&M claim without signed-off confirmation cannot be invoiced', async () => {
    const writes: NonNullable<World['writes']> = [];
    const odoo = invoiceOdooWorld();
    const r = await dispatchAs(APPROVER_ID, approveCommand({ id: CLAIM_ID }), {
      progressClaim: timeMaterialsClaim, timeMaterialsClaim: { ...signedTimeMaterialsClaim, status: 'Draft' },
      timeMaterialsClaimLines: timeMaterialsLines, progressClaimEvidence: evidence, draft: timeMaterialsDraft(),
      invoiceAuthor: AUTHOR_ID, writes, odoo,
    });

    assertEquals([r.status, JSON.parse(r.body).message], [422, 'Confirm the time-and-materials claim before raising its invoice']);
    assertEquals(writes, []);
    noMoneyPipeline(r);
  });

  it('AC-OCI-024 a T&M header that differs from its signed line sum cannot be invoiced', async () => {
    const writes: NonNullable<World['writes']> = [];
    const odoo = invoiceOdooWorld();
    const r = await dispatchAs(APPROVER_ID, approveCommand({ id: CLAIM_ID }), {
      progressClaim: { ...timeMaterialsClaim, gross_amount: '6000001.00' }, timeMaterialsClaim: signedTimeMaterialsClaim,
      timeMaterialsClaimLines: timeMaterialsLines, progressClaimEvidence: evidence, draft: timeMaterialsDraft(),
      invoiceAuthor: AUTHOR_ID, writes, odoo,
    });

    assertEquals([r.status, JSON.parse(r.body).message], [422, 'The signed time-and-materials claim header does not match its line amounts']);
    assertEquals(writes, []);
    noMoneyPipeline(r);
  });

  it('AC-OCI-021 a second user approves the 200,000 down-payment draft and its posted line uses the advance account', async () => {
    const downPayment = { ...progressClaim, kind: 'down_payment', down_payment_amount: '200000.00', dp_recovery_amount: '0.00', work_order_id: null };
    const odoo = invoiceOdooWorld();
    const grants: string[] = [];
    const approved = await dispatchAs(APPROVER_ID, approveCommand({ id: CLAIM_ID }), {
      progressClaim: downPayment, progressClaimLines: [], progressClaimEvidence: evidence,
      draft: draftRow({ id: CLAIM_ID, customer_id: CUSTOMER_ID, project_id: PROJECT_ID, work_order_id: null,
        native_lines: [{ item_code: 'ITEM-DP', description: null, qty: 1, rate: 200000, amount: 200000 }] }),
      invoiceAuthor: AUTHOR_ID, grants, odoo,
    });

    assertEquals(approved.status, 200, approved.body);
    assertEquals(grants, [APPROVER_ID], 'the down-payment author is different from the approver');
    const [invoice] = odoo.rows('account.move');
    const [line] = odoo.rows('account.move.line').filter((row) => row.move_id === invoice.id && row.display_type === 'product');
    assertEquals([invoice.amount_untaxed, line.product_id, line.account_id], [200000, 72, 210]);
    assertEquals((JSON.parse(approved.body) as { canonical: Record<string, unknown> }).canonical.odoo_attention, null);
  });

  it('a down-payment item with no matching configured advance account refuses before Odoo is called', async () => {
    const downPayment = { ...progressClaim, kind: 'down_payment', down_payment_amount: '200000.00', dp_recovery_amount: '0.00', work_order_id: null };
    for (const customerAdvanceAccountRef of ['account.account:149', null] as const) {
      const writes: NonNullable<World['writes']> = [];
      const odoo = invoiceOdooWorld();
      const r = await dispatchAs(APPROVER_ID, approveCommand({ id: CLAIM_ID }), {
        progressClaim: downPayment, progressClaimLines: [], progressClaimEvidence: evidence,
        draft: draftRow({ id: CLAIM_ID, customer_id: CUSTOMER_ID, project_id: PROJECT_ID, work_order_id: null,
          native_lines: [{ item_code: 'ITEM-DP', description: null, qty: 1, rate: 200000, amount: 200000 }] }),
        customerAdvanceAccountRef, writes, odoo,
      });

      assertEquals(r.status, 422, r.body);
      assertEquals(JSON.parse(r.body).error, 'config-rejected');
      assert(JSON.parse(r.body).message.includes('ITEM-DP'), r.body);
      assertEquals(outboxInserts(r).length, 0, 'the invalid account is refused before an outbox row');
      assertEquals(r.calls.filter((c) => c.url.host === ODOO_HOST).length, 0, 'the mirrored config check is before every Odoo request');
      assertEquals(odoo.calls, []);
    }
  });

  it('AC-OCI-022 refuses a down-payment product mirrored to a different income account before any Odoo call', async () => {
    const downPayment = { ...progressClaim, kind: 'down_payment', down_payment_amount: '200000.00', dp_recovery_amount: '0.00', work_order_id: null };
    const odoo = invoiceOdooWorld();
    const r = await dispatchAs(APPROVER_ID, approveCommand({ id: CLAIM_ID }), {
      progressClaim: downPayment, progressClaimLines: [], progressClaimEvidence: evidence,
      draft: draftRow({ id: CLAIM_ID, customer_id: CUSTOMER_ID, project_id: PROJECT_ID, work_order_id: null,
        native_lines: [{ item_code: 'ITEM-DP', description: null, qty: 1, rate: 200000, amount: 200000 }] }),
      customerAdvanceAccountRef: 'account.account:210', downPaymentProductMirrorIncomeAccount: '149', odoo,
    });

    assertEquals(r.status, 422, r.body);
    assertEquals(JSON.parse(r.body).error, 'config-rejected');
    assert(JSON.parse(r.body).message.includes('ITEM-DP'), r.body);
    noMoneyPipeline(r);
    assertEquals(odoo.calls, []);
  });

  it('AC-OCI-022 a legacy down-payment product mirror without income_account_id refuses before any Odoo call', async () => {
    const downPayment = { ...progressClaim, kind: 'down_payment', down_payment_amount: '200000.00', dp_recovery_amount: '0.00', work_order_id: null };
    const odoo = invoiceOdooWorld();
    const r = await dispatchAs(APPROVER_ID, approveCommand({ id: CLAIM_ID }), {
      progressClaim: downPayment, progressClaimLines: [], progressClaimEvidence: evidence,
      draft: draftRow({ id: CLAIM_ID, customer_id: CUSTOMER_ID, project_id: PROJECT_ID, work_order_id: null,
        native_lines: [{ item_code: 'ITEM-DP', description: null, qty: 1, rate: 200000, amount: 200000 }] }),
      customerAdvanceAccountRef: 'account.account:210', downPaymentProductMirrorIncomeAccount: null, odoo,
    });

    assertEquals(r.status, 422, r.body);
    assertEquals(JSON.parse(r.body).error, 'config-rejected');
    assert(JSON.parse(r.body).message.includes('ITEM-DP'), r.body);
    noMoneyPipeline(r);
    assertEquals(odoo.calls, []);
  });

  it('an Odoo payable account is refused for a customer advance before any Odoo call', async () => {
    const downPayment = { ...progressClaim, kind: 'down_payment', down_payment_amount: '200000.00', dp_recovery_amount: '0.00', work_order_id: null };
    const writes: NonNullable<World['writes']> = [];
    const odoo = invoiceOdooWorld();
    const r = await dispatchAs(APPROVER_ID, approveCommand({ id: CLAIM_ID }), {
      progressClaim: downPayment, progressClaimLines: [], progressClaimEvidence: evidence,
      draft: draftRow({ id: CLAIM_ID, customer_id: CUSTOMER_ID, project_id: PROJECT_ID, work_order_id: null,
        native_lines: [{ item_code: 'ITEM-DP', description: null, qty: 1, rate: 200000, amount: 200000 }] }),
      customerAdvanceAccountType: 'liability_payable', writes, odoo,
    });

    assertEquals(r.status, 422, r.body);
    assertEquals(JSON.parse(r.body).error, 'config-rejected');
    assert(JSON.parse(r.body).message.includes('ITEM-DP'), r.body);
    assertEquals(outboxInserts(r).length, 0, 'the unsupported payable account is rejected before an outbox row');
    assertEquals(r.calls.filter((c) => c.url.host === ODOO_HOST).length, 0, 'an unsupported account is rejected before Odoo is called');
    assertEquals(odoo.calls, []);
  });

  it('read-back flags a down-payment product whose actual posted line account differs from the configured account', async () => {
    const downPayment = { ...progressClaim, kind: 'down_payment', down_payment_amount: '200000.00', dp_recovery_amount: '0.00', work_order_id: null };
    const odoo = invoiceOdooWorld();
    const odooFetch = odoo.fetch;
    odoo.fetch = async (url, init) => {
      if (String(url).endsWith('/account.move/create')) {
        const product = odoo.rows('product.product').find((row) => row.id === 72)!;
        product.income_account_id = 149;
        product.property_account_income_id = [149, 'Sales'];
      }
      return await odooFetch(url, init);
    };
    const writes: NonNullable<World['writes']> = [];
    const r = await dispatchAs(APPROVER_ID, approveCommand({ id: CLAIM_ID }), {
      progressClaim: downPayment, progressClaimLines: [], progressClaimEvidence: evidence,
      draft: draftRow({ id: CLAIM_ID, customer_id: CUSTOMER_ID, project_id: PROJECT_ID, work_order_id: null,
        native_lines: [{ item_code: 'ITEM-DP', description: null, qty: 1, rate: 200000, amount: 200000 }] }),
      invoiceAuthor: AUTHOR_ID, odoo, writes,
    });

    assertEquals(r.status, 200, r.body);
    const body = JSON.parse(r.body) as { canonical?: Record<string, unknown> };
    assertEquals(body.canonical?.odoo_attention, 'advance-account-mismatch');
    const mirror = writes.find((w) => w.table === 'sales_invoices' && w.method === 'PATCH')?.body as Record<string, unknown> | undefined;
    assertEquals([mirror?.odoo_state, mirror?.odoo_attention], ['posted', 'advance-account-mismatch'], 'the posted invoice is mirrored with its attention flag');
    const [invoice] = odoo.rows('account.move');
    const [line] = odoo.rows('account.move.line').filter((row) => row.move_id === invoice.id && row.display_type === 'product');
    assertEquals(line.account_id, 149);
  });
});

describe('AC-OCI-061 / FR-OCI-074 Odoo\'s failures classify and its body never leaves', () => {
  const SECRET = 'SECRET-ODOO-TEXT-4f2a';
  const failing = (status: number, name: string) => {
    const base = odooWorld();
    return { fetch: (url: string, init?: RequestInit) => /account\.move\/create$/.test(url)
      ? Promise.resolve(new Response(JSON.stringify({ name, message: SECRET, arguments: [SECRET], context: { secret: SECRET }, debug: `Traceback ${SECRET}`, timestamp: 'now' }), { status, headers: { 'content-type': 'application/json' } }))
      : base.fetch(url, init), base };
  };

  it('a validation error is rejected 422 with a fixed, user-safe reason: nothing of Odoo\'s text in the response or any log', async () => {
    const odoo = failing(422, 'odoo.exceptions.UserError');
    const r = await dispatchAs(APPROVER_ID, approveCommand(), { odoo });
    assertEquals(r.status, 422, r.body);
    assertEquals(r.body.includes(SECRET), false);
    assertEquals(r.logged.some((l) => l.includes(SECRET)), false, 'no log line carries Odoo\'s body');
    assertEquals(moves(odoo.base).length, 0);
  });

  it('a 5xx is pending (not success, not a rejection), and carries nothing of Odoo\'s body', async () => {
    const odoo = failing(502, 'werkzeug.exceptions.BadGateway');
    const r = await dispatchAs(APPROVER_ID, approveCommand(), { odoo });
    assert(r.status !== 200 && r.status !== 422, `${r.status} ${r.body}`);
    assertEquals(r.body.includes(SECRET), false);
    assertEquals(r.logged.some((l) => l.includes(SECRET)), false);
  });

  it('a 429 is pending after the bounded retry, never a rejection', async () => {
    const odoo = failing(429, 'werkzeug.exceptions.TooManyRequests');
    const r = await dispatchAs(APPROVER_ID, approveCommand(), { odoo });
    assert(r.status !== 200 && r.status !== 422, `${r.status} ${r.body}`);
    assertEquals(r.body.includes(SECRET), false);
  });
});
