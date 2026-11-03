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
import {
  APPROVER_ID, AUTHOR_ID, DRAFT_ID, NEW_INVOICE_ID, ODOO_HOST, approveCommand, draftCommand, draftRow, invoiceOdooWorld, revenueRoutes, type World,
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

  it('FR-OCI-063 a user retry after an adopted resolution confirms its invoice without a second create', async () => {
    const odoo = odooWorld();
    const outbox = new Map<string, Record<string, unknown>>();
    const first = await dispatchAs(APPROVER_ID, approveCommand(), { odoo, outbox });
    assertEquals(first.status, 200, first.body);
    const invoice = moves(odoo)[0];
    const createdCount = creates(odoo);
    assertEquals(createdCount, 1);

    for (const anchor of odoo.rows('ir.model.data').filter((row) => row.res_id === invoice.id && row.module === 'pmo')) anchor.module = 'edited';
    const row = [...outbox.values()][0];
    row.state = 'failed';
    row.payload = { ...(row.payload as Record<string, unknown>), odoo_adopted_ref: `account.move:${invoice.id}` };

    const retry = await dispatchAs(APPROVER_ID, approveCommand(), { odoo, outbox });
    assertEquals(retry.status, 200, retry.body);
    assertEquals([moves(odoo).length, creates(odoo) - createdCount], [1, 0], 'the resolved reference confirms the existing invoice; the retry makes zero create calls');
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
