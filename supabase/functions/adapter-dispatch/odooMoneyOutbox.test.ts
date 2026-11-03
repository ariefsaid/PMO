// #1505 O2 P2-T6 (AC-OPP-053, AC-OPP-060, FR-OPP-070/072, OQ-OPP-10): the Odoo tier's money-outbox deps. The probe answers adopt (one
// match), nothing (zero) or a refusal to guess (many) for every kind, the reissue policy holds on a miss, and a key that is not a
// PMO purchase key cannot reach Odoo. Odoo and Supabase are mocked over fetch; the deps are the shipped module's.
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertRejects } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { installEdgeEnv, jsonResponse, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute } from '../_shared/testing/edgeTestKit.ts';
import { odooAnchorKey, odooReissueOnInconclusiveAbsence, resolveOdooMoneyOutboxDeps } from './odooMoneyOutbox.ts';
import type { AdapterSelectContext } from './dispatchAdapters.ts';

const env = installEdgeEnv();
globalThis.addEventListener('unload', () => env.restore());

const ORG = '0d000000-0000-4000-8000-000000000005';
const ODOO = 'odoo.example.test';
const REC = '123e4567-e89b-12d3-a456-426614174000';
const OTHER = '223e4567-e89b-12d3-a456-426614174000';
const KEY = 'cccccccc-cccc-4ccc-8ccc-0000000015ff';
const objectResponse = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const BINDING = { id: 'b0000000-0000-4000-8000-000000000001', site_url: `https://${ODOO}`, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z', config: { database: 'db1', odoo_company_id: 1 } };

type Rows = Record<string, unknown[] | ((body: { domain: unknown[][] }) => unknown[])>;
function setup(docKind: string, extra: Record<string, unknown> = {}, over: { binding?: Record<string, unknown> | null; odoo?: Rows; outbox?: Record<string, unknown> | null; replay?: boolean } = {}) {
  const odooCalls: FetchCall[] = [];
  const routes: MockRoute[] = [
    supabaseSelect('external_org_bindings', () => over.binding === null ? new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }) : objectResponse({ ...BINDING, ...over.binding })),
    supabaseRpc('read_vault_secret', () => jsonResponse('odoo-test-key')),
    supabaseSelect('external_refs', () => objectResponse({ external_record_id: 'Vendor:77' })),
    supabaseSelect('procurements', () => objectResponse({ code: 'PRC-1', project_id: null, vendor_id: 'v-1', currency: 'IDR' })),
    supabaseSelect('purchase_orders', () => jsonResponse([])),   // a bill with no order of its own
    supabaseSelect('external_master_records', () => jsonResponse([
      { external_id: '11', name: 'VAT 11%', active: true, tombstoned_at: null, attrs: { amount: 11, use: 'purchase' } },
      { external_id: '12', name: 'Withholding 2%', active: true, tombstoned_at: null, attrs: { amount: -2, use: 'purchase' } },
    ])),
    supabaseSelect('purchase_order_lines', () => jsonResponse([])),   // the PO has no lines of its own: the case's lines are the order
    supabaseSelect('procurement_items', () => jsonResponse([{ name: 'A', quantity: 4, rate: 10, description: null }, { name: 'B', quantity: 2, rate: 5, description: null }])),
    supabaseSelect('external_command_outbox', () => over.outbox ? objectResponse({ payload: over.outbox }) : new Response('null', { status: 200, headers: { 'content-type': 'application/json' } })),
    { label: 'odoo', host: ODOO, response: (call) => {
      odooCalls.push(call);
      const model = call.url.pathname.split('/')[3];
      const answer = (over.odoo ?? {})[model] ?? [];
      return jsonResponse(typeof answer === 'function' ? answer(call.bodyJson as { domain: unknown[][] }) : answer);
    } },
  ];
  const sc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const ctx = {
    orgId: ORG, serviceClient: sc, userId: 'u-1', faultGate: {}, erpAuth: {},
    command: { domain: 'procurement', operation: 'create', idempotencyKey: KEY, record: { id: REC, erp_doc_kind: docKind, procurementId: 'p', receiptDigest: 'ab12', supplier: 'v-1', paid_amount: 98, ...extra } },
    ...(over.replay ? { replay: true } : {}),
  } as unknown as AdapterSelectContext;
  return { routes, ctx, odooCalls };
}

describe('OQ-OPP-10 a recovery that finds nothing', () => {
  for (const kind of ['payment'] as const) {
    it(`AC-OPP-053 holds a ${kind}, never reissues it (no create-to-anchor composite covers it yet, or its anchor is mutable)`, () => {
      assertEquals(odooReissueOnInconclusiveAbsence(kind), false);
    });
  }
  it('AC-OPP-041 holds a bill, never reissues it, although its composite now covers the create-to-anchor gap (OQ-OPP-10: bills are the stricter class)', () => {
    assertEquals(odooReissueOnInconclusiveAbsence('bill'), false);
  });
  it('AC-OPP-011 reissues an order only on conclusive absence: its composite covers the create-to-anchor gap', () => {
    assertEquals(odooReissueOnInconclusiveAbsence('order'), true);
  });
  it('AC-SCA-011 a revision reissues: it edits towards a line set, so a repeat cannot mint a second document', () => {
    assertEquals(odooReissueOnInconclusiveAbsence('order', 'revise'), true);
    assertEquals(odooReissueOnInconclusiveAbsence('payment', 'revise'), true);
  });
});

describe('PD-4 the anchor key follows the PMO record, never the per-click key', () => {
  it('derives one key per kind', () => {
    assertEquals(odooAnchorKey('order', { id: REC }), `po:${REC}`);
    assertEquals(odooAnchorKey('receipt', { id: REC, receiptDigest: 'ab12' }), `gr:${REC}:ab12`);
    assertEquals(odooAnchorKey('bill', { id: REC }), `bill:${REC}`);
    assertEquals(odooAnchorKey('payment', { id: REC }), `pay:${REC}`);
  });
  it('a revision is keyed by the PMO order and revision, not by its own record id', () => {
    assertEquals(odooAnchorKey('order', { id: OTHER, poId: REC, revision: 2 }, 'revise'), `porev:${REC}:2`);
  });
});

describe('AC-OPP-053 the Odoo probe closure: zero, one and many matches', () => {
  describe('order', () => {
    const ORDER_ROW = { name: 'P00041', state: 'purchase', amount_total: 50, write_date: '2026-11-03 10:00:00' };
    const orderSetup = (odoo: Rows) => setup('purchase-order', { amount: '50.00' }, { odoo });
    const queries = (t: ReturnType<typeof setup>, model: string) => t.odooCalls.filter((c) => c.url.pathname.includes(`/${model}/`)).map((c) => c.bodyJson as { domain: unknown[][] });

    it('AC-OPP-011 an anchored order is adopted read back (full canonical), never as a bare reference', async () => {
      const t = orderSetup({ 'ir.model.data': [{ res_id: 41 }], 'purchase.order': [ORDER_ROW] });
      await withFetchMock(t.routes, async () => {
        const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
        assertEquals(await deps.probeByRemarksKey('procurement', KEY), {
          externalRecordId: 'purchase.order:41',
          canonical: { id: REC, po_number: 'P00041', amount: '50.00', pmo_amount: '50.00', erp_docstatus: 1, erp_modified: '2026-11-03 10:00:00', erp_amended_from: null },
        });
      });
      const identifier = queries(t, 'ir.model.data')[0];
      assert(identifier.domain.some(([f, op, v]) => f === 'name' && op === '=' && v === `po_${REC.replaceAll('-', '_')}`), JSON.stringify(identifier));
    });

    it('AC-OPP-011 a miss asks the composite built from the case: vendor partner, untaxed total, line count, window', async () => {
      const t = orderSetup({});
      await withFetchMock(t.routes, async () => {
        const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
        assertEquals(await deps.probeByRemarksKey('procurement', KEY), null);
      });
      const composite = queries(t, 'purchase.order')[0].domain;
      assert(composite.some(([f, op, v]) => f === 'partner_id' && op === '=' && v === 77), JSON.stringify(composite));
      assert(composite.some(([f, op, v]) => f === 'state' && op === '!=' && v === 'cancel'));
      // The amount and line count are compared on the rows read back, not filtered: a near-miss must be seen to hold the row (I1).
      assert(!composite.some(([f]) => f === 'amount_untaxed'), JSON.stringify(composite));
      const window = composite.find(([f, op]) => f === 'create_date' && op === '>=');
      assert(window !== undefined);
      assert(Date.now() - Date.parse(`${String(window[2]).replace(' ', 'T')}Z`) >= 10 * 60_000 - 5_000, 'the window reaches back at least ten minutes');
    });

    it('two orders with the identifier are doubt: the probe throws', async () => {
      const t = orderSetup({ 'ir.model.data': [{ res_id: 41 }, { res_id: 42 }] });
      await withFetchMock(t.routes, async () => {
        const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
        await assertRejects(() => deps.probeByRemarksKey('procurement', KEY), Error, 'ambiguous-anchor');
      });
    });

    it('AC-OPP-016 a revision probes its own key (porev) and adopts an applied revision with the order read back, keyed by the PMO order', async () => {
      const PO = OTHER;
      const t = setup('purchase-order', { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000009', poId: PO, revision: 2 }, { odoo: { 'ir.model.data': [{ res_id: 41 }], 'purchase.order': [ORDER_ROW] } });
      (t.ctx.command as unknown as { operation: string }).operation = 'revise';
      await withFetchMock(t.routes, async () => {
        const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
        const hit = await deps.probeByRemarksKey('procurement', KEY);
        assertEquals(hit?.externalRecordId, 'purchase.order:41');
        assertEquals(hit?.canonical?.id, PO);
      });
      assert(queries(t, 'ir.model.data')[0].domain.some(([f, op, v]) => f === 'name' && op === '=' && v === `porev_${PO.replaceAll('-', '_')}_2`));
    });
  });

  describe('bill', () => {
    const MOVE = { name: 'BILL/2026/00041', state: 'posted', move_type: 'in_invoice', amount_total: 54.5, amount_residual: 54.5, ref: 'INV-77', invoice_date: '2026-12-05', currency_id: [12, 'IDR'], write_date: '2026-11-03 10:00:00' };
    const lines = (b: { domain: unknown[][] }) => (b.domain.some((t) => t[0] === 'tax_line_id') ? [{ balance: 5.5 }, { balance: -1 }] : [{ analytic_distribution: false }]);
    const billSetup = (odoo: Rows, over: Parameters<typeof setup>[2] = {}) => setup('purchase-invoice', { taxIds: [11, 12], referenceNumber: 'INV-77', invoiceDate: '2026-12-05' }, {
      ...over, odoo: { 'res.company': [{ currency_id: [12, 'IDR'] }], 'account.tax': [{ id: 11, company_id: [1, 'Co'] }, { id: 12, company_id: [1, 'Co'] }],
        'account.tax.repartition.line': [{ tax_id: [12, 'x'], account_id: [900, 'PPh payable'] }], 'account.account': [{ id: 900, account_type: 'liability_current' }], ...odoo },
    });
    const queries = (t: ReturnType<typeof setup>, model: string) => t.odooCalls.filter((c) => c.url.pathname.includes(`/${model}/`)).map((c) => c.bodyJson as { domain: unknown[][] });

    it('AC-OPP-041 an anchored bill is adopted read back (full canonical, the money header), judged against the figure PMO expected', async () => {
      const t = billSetup({ 'ir.model.data': [{ res_id: 41 }], 'account.move': [MOVE], 'account.move.line': lines });
      await withFetchMock(t.routes, async () => {
        const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
        assertEquals(await deps.probeByRemarksKey('procurement', KEY), {
          externalRecordId: 'account.move:41',   // qualified by model: Odoo ids are per model, external_refs is unique per (org, domain, id)
          canonical: {
            id: REC, vi_number: 'BILL/2026/00041', invoice_date: '2026-12-05', reference_number: 'INV-77', currency: 'IDR',
            amount: '55.50', tax_amount: '5.50', withheld_amount: '1.00', erp_outstanding_amount: '54.50', pmo_amount: '54.50',
            erp_docstatus: 1, erp_modified: '2026-11-03 10:00:00', erp_amended_from: null,
          },
        });
      });
      assert(queries(t, 'ir.model.data')[0].domain.some(([f, op, v]) => f === 'name' && op === '=' && v === `bill_${REC.replaceAll('-', '_')}`));
    });

    it('AC-OPP-041 a miss asks the bill composite: our vendor partner, vendor bills only, the window; absence is null', async () => {
      const t = billSetup({});
      await withFetchMock(t.routes, async () => {
        const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
        assertEquals(await deps.probeByRemarksKey('procurement', KEY), null);
      });
      const composite = queries(t, 'account.move')[0].domain;
      assert(composite.some(([f, op, v]) => f === 'move_type' && op === '=' && v === 'in_invoice'), JSON.stringify(composite));
      assert(composite.some(([f, op, v]) => f === 'partner_id' && op === '=' && v === 77));
      assert(composite.some(([f, op]) => f === 'create_date' && op === '>='));
    });

    // I1 (#1505 P5 review): the unrelated Odoo bills a vendor routinely has must not hold or be adopted by a bill's FIRST attempt.
    const LOOKALIKE = { id: 60, move_type: 'in_invoice', state: 'draft', partner_id: [77, 'Vendor'], amount_untaxed: 50, invoice_line_ids: [1, 2], create_date: '2026-01-01 00:00:00' };
    for (const [label, rows] of [['one of another amount', [{ ...LOOKALIKE, amount_untaxed: 7 }]], ['one that matches vendor, amount and lines exactly', [LOOKALIKE]]] as const) {
      it(`I1 a FIRST attempt probes by identifier only: an unanchored vendor bill (${label}) is neither a hold nor an adoption`, async () => {
        const t = billSetup({ 'account.move': [...rows] });
        await withFetchMock(t.routes, async () => {
          const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
          assertEquals(await deps.probeByRemarksKey('procurement', KEY, { recovery: false }), null);
        });
        assertEquals(queries(t, 'account.move').length, 0);
        assert(t.odooCalls.every((c) => /\/(read|search_read)$/.test(c.url.pathname)), t.odooCalls.map((c) => c.url.pathname).join());
      });
    }

    it('I1 a RECOVERY that finds an unanchored look-alike (vendor, amount and lines all equal) holds: it writes no identifier and posts nothing', async () => {
      const t = billSetup({ 'account.move': [LOOKALIKE] });
      await withFetchMock(t.routes, async () => {
        const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
        await assertRejects(() => deps.probeByRemarksKey('procurement', KEY, { recovery: true }), Error, 'ambiguous-anchor');
      });
      assert(t.odooCalls.every((c) => /\/(read|search_read)$/.test(c.url.pathname)), t.odooCalls.map((c) => c.url.pathname).join());
    });

    it('I1 the recovery window is bounded on both sides: reaches back ten minutes, closes after the first attempt\'s commit budget', async () => {
      const t = billSetup({});
      await withFetchMock(t.routes, async () => {
        const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
        assertEquals(await deps.probeByRemarksKey('procurement', KEY, { recovery: true }), null);
      });
      const composite = queries(t, 'account.move')[0].domain;
      const ms = (op: string) => Date.parse(`${String(composite.find(([f, o]) => f === 'create_date' && o === op)?.[2]).replace(' ', 'T')}Z`);
      assert(ms('>=') <= Date.now() - 10 * 60_000 + 5_000);
      assert(ms('<=') > Date.now() && ms('<=') <= Date.now() + 10 * 60_000, 'closes shortly after the first attempt, not never');
    });

    it('two bills with the identifier are doubt: the probe throws (the row is held)', async () => {
      const t = billSetup({ 'ir.model.data': [{ res_id: 41 }, { res_id: 42 }] });
      await withFetchMock(t.routes, async () => {
        const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
        await assertRejects(() => deps.probeByRemarksKey('procurement', KEY), Error, 'ambiguous-anchor');
      });
    });

    it('a malformed tax set is refused before the outbox deps exist (no row, no write); Odoo is only read', async () => {
      const t = billSetup({ 'account.account': [{ id: 900, account_type: 'asset_current' }] });
      await withFetchMock(t.routes, async () => {
        const err = await assertRejects(() => resolveOdooMoneyOutboxDeps(t.ctx)) as { code?: string; message: string };
        assertEquals([err.code, err.message], ['config-rejected', 'config-rejected: Withholding 2%']);
      });
      assert(t.odooCalls.every((c) => /\/(read|search_read)$/.test(c.url.pathname)), t.odooCalls.map((c) => c.url.pathname).join());
    });

    it('a REPLAY resolves no tax, currency or mapping (the document may already exist); it judges the bill against the stored expectation', async () => {
      const stored = { odoo_partner_id: 77, odoo_amount: '50.00', odoo_line_count: 2, odoo_expected_total: '54.50', odoo_cost_account: null };
      const t = billSetup({ 'ir.model.data': [{ res_id: 41 }], 'account.move': [MOVE], 'account.move.line': lines }, { replay: true, outbox: stored });
      await withFetchMock(t.routes, async () => {
        const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
        assertEquals((await deps.probeByRemarksKey('procurement', KEY))?.canonical?.pmo_amount, '54.50');
      });
      assertEquals(queries(t, 'account.tax').length + queries(t, 'res.company').length, 0);
    });

    it('a REPLAY with no stored expectation cannot judge the bill: the probe refuses (held), it never assumes a match', async () => {
      const t = billSetup({ 'ir.model.data': [{ res_id: 41 }], 'account.move': [MOVE], 'account.move.line': lines }, { replay: true });
      await withFetchMock(t.routes, async () => {
        const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
        await assertRejects(() => deps.probeByRemarksKey('procurement', KEY), Error, 'bill-expectation-missing');
      });
    });
  });

  const memoQuery = (body: { domain: unknown[][] }) => body.domain.some((t) => t[0] === 'memo');

  it('payment: the exact memo adopts', async () => {
    const t = setup('payment', {}, { odoo: { 'account.payment': (b) => (memoQuery(b) ? [{ id: 90 }] : []) } });
    await withFetchMock(t.routes, async () => {
      const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
      assertEquals(await deps.probeByRemarksKey('procurement', KEY), { externalRecordId: 'account.payment:90', canonical: { id: REC } });
    });
    const sent = t.odooCalls.map((c) => (c.bodyJson as { domain: unknown[][] }).domain);
    assert(sent[0].some(([f, op, v]) => f === 'memo' && op === '=' && v === `pmo:pay:${REC}`), JSON.stringify(sent[0]));
  });

  it('payment: an edited memo falls back to the composite built from the supplier\'s Odoo partner, the amount and the window', async () => {
    const t = setup('payment', {}, { odoo: { 'account.payment': (b) => (memoQuery(b) ? [] : [{ id: 91, memo: 'paid Friday' }]) } });
    await withFetchMock(t.routes, async () => {
      const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
      assertEquals(await deps.probeByRemarksKey('procurement', KEY), { externalRecordId: 'account.payment:91', canonical: { id: REC } });
    });
    const composite = (t.odooCalls[1].bodyJson as { domain: unknown[][] }).domain;
    assert(composite.some(([f, op, v]) => f === 'partner_id' && op === '=' && v === 77), JSON.stringify(composite));
    assert(composite.some(([f, op, v]) => f === 'amount' && op === '=' && v === 98));
    assert(composite.some(([f, op]) => f === 'create_date' && op === '>='));
  });

  it('payment: a look-alike that carries another PMO payment\'s anchor is never adopted', async () => {
    const t = setup('payment', {}, { odoo: { 'account.payment': (b) => (memoQuery(b) ? [] : [{ id: 92, memo: `pmo:pay:${OTHER}` }]) } });
    await withFetchMock(t.routes, async () => {
      const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
      assertEquals(await deps.probeByRemarksKey('procurement', KEY), null);
    });
  });

  it('a record id that is not a UUID cannot reach Odoo (no metacharacter in any query)', async () => {
    for (const bad of ['x%', 'a_b', `${REC}%`]) {
      const { routes, ctx, odooCalls } = setup('purchase-order', { id: bad });
      await withFetchMock(routes, async () => {
        const deps = await resolveOdooMoneyOutboxDeps(ctx);
        await assertRejects(() => deps.probeByRemarksKey('procurement', KEY));
      });
      assertEquals(odooCalls.length, 0, bad);
    }
  });
});

describe('FR-OPP-002 a connection that cannot be used leaves no outbox deps and sends nothing', () => {
  for (const [label, binding] of [['not activated', { activated_at: null }], ['disconnected', { status: 'disconnected' }]] as const) {
    it(label, async () => {
      const { routes, ctx, odooCalls } = setup('purchase-order', {}, { binding });
      await withFetchMock(routes, async () => {
        const err = await assertRejects(() => resolveOdooMoneyOutboxDeps(ctx)) as { code?: string };
        assertEquals(err.code, 'config-rejected');
      });
      assertEquals(odooCalls.length, 0);
    });
  }

  it('a purchase kind the Odoo tier does not know is refused', async () => {
    const { routes, ctx } = setup('quotation');
    await withFetchMock(routes, async () => {
      const err = await assertRejects(() => resolveOdooMoneyOutboxDeps(ctx)) as { code?: string };
      assertEquals(err.code, 'commit-rejected');
    });
  });
});
