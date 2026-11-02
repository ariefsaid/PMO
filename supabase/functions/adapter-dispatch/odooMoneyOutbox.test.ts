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

const KINDS = [
  ['purchase-order', 'order', 'purchase.order'],
  ['goods-receipt', 'receipt', 'stock.picking'],
  ['purchase-invoice', 'bill', 'account.move'],
] as const;

type Rows = Record<string, unknown[] | ((body: { domain: unknown[][] }) => unknown[])>;
function setup(docKind: string, extra: Record<string, unknown> = {}, over: { binding?: Record<string, unknown> | null; odoo?: Rows } = {}) {
  const odooCalls: FetchCall[] = [];
  const routes: MockRoute[] = [
    supabaseSelect('external_org_bindings', () => over.binding === null ? new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }) : objectResponse({ ...BINDING, ...over.binding })),
    supabaseRpc('read_vault_secret', () => jsonResponse('odoo-test-key')),
    supabaseSelect('external_refs', () => objectResponse({ external_record_id: 'Vendor:77' })),
    supabaseSelect('external_command_outbox', () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } })),
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
  } as unknown as AdapterSelectContext;
  return { routes, ctx, odooCalls };
}

describe('OQ-OPP-10 a recovery that finds nothing', () => {
  for (const kind of ['order', 'receipt', 'bill', 'payment'] as const) {
    it(`AC-OPP-053 holds a ${kind}, never reissues it (no create-to-anchor composite covers it yet; a payment is mutable)`, () => {
      assertEquals(odooReissueOnInconclusiveAbsence(kind), false);
    });
  }
});

describe('PD-4 the anchor key follows the PMO record, never the per-click key', () => {
  it('derives one key per kind', () => {
    assertEquals(odooAnchorKey('order', { id: REC }), `po:${REC}`);
    assertEquals(odooAnchorKey('receipt', { id: REC, receiptDigest: 'ab12' }), `gr:${REC}:ab12`);
    assertEquals(odooAnchorKey('bill', { id: REC }), `bill:${REC}`);
    assertEquals(odooAnchorKey('payment', { id: REC }), `pay:${REC}`);
  });
});

describe('AC-OPP-053 the Odoo probe closure: zero, one and many matches', () => {
  for (const [docKind, kind, model] of KINDS) {
    it(`${kind}: one identifier adopts, none is null, a foreign model's identifier is not ours`, async () => {
      const identifier = (name: string, m: string, res: number) => ({ module: 'pmo', name, model: m, res_id: res });
      const mine = identifier(`${kind === 'order' ? 'po' : kind === 'receipt' ? 'gr' : 'bill'}_${REC.replaceAll('-', '_')}${kind === 'receipt' ? '_ab12' : ''}`, model, 41);
      // the fake answers every ir.model.data query with these rows: the closure must send the filter (asserted below)
      const one = setup(docKind, {}, { odoo: { 'ir.model.data': [{ res_id: 41 }] } });
      await withFetchMock(one.routes, async () => {
        const deps = await resolveOdooMoneyOutboxDeps(one.ctx);
        assertEquals(await deps.probeByRemarksKey('procurement', KEY), { externalRecordId: '41', canonical: { id: REC } });
      });
      const query = one.odooCalls.find((c) => c.url.pathname.endsWith('/ir.model.data/search_read'))!.bodyJson as { domain: unknown[][] };
      assert(query.domain.some(([f, op, v]) => f === 'name' && op === '=' && v === mine.name), JSON.stringify(query.domain));
      assert(query.domain.some(([f, op, v]) => f === 'model' && op === '=' && v === model));

      const none = setup(docKind);
      await withFetchMock(none.routes, async () => {
        const deps = await resolveOdooMoneyOutboxDeps(none.ctx);
        assertEquals(await deps.probeByRemarksKey('procurement', KEY), null);
      });

      const many = setup(docKind, {}, { odoo: { 'ir.model.data': [{ res_id: 41 }, { res_id: 42 }] } });
      await withFetchMock(many.routes, async () => {
        const deps = await resolveOdooMoneyOutboxDeps(many.ctx);
        await assertRejects(() => deps.probeByRemarksKey('procurement', KEY), Error, 'ambiguous-anchor');
      });
    });
  }

  const memoQuery = (body: { domain: unknown[][] }) => body.domain.some((t) => t[0] === 'memo');

  it('payment: the exact memo adopts', async () => {
    const t = setup('payment', {}, { odoo: { 'account.payment': (b) => (memoQuery(b) ? [{ id: 90 }] : []) } });
    await withFetchMock(t.routes, async () => {
      const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
      assertEquals(await deps.probeByRemarksKey('procurement', KEY), { externalRecordId: '90', canonical: { id: REC } });
    });
    const sent = t.odooCalls.map((c) => (c.bodyJson as { domain: unknown[][] }).domain);
    assert(sent[0].some(([f, op, v]) => f === 'memo' && op === '=' && v === `pmo:pay:${REC}`), JSON.stringify(sent[0]));
  });

  it('payment: an edited memo falls back to the composite built from the supplier\'s Odoo partner, the amount and the window', async () => {
    const t = setup('payment', {}, { odoo: { 'account.payment': (b) => (memoQuery(b) ? [] : [{ id: 91, memo: 'paid Friday' }]) } });
    await withFetchMock(t.routes, async () => {
      const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
      assertEquals(await deps.probeByRemarksKey('procurement', KEY), { externalRecordId: '91', canonical: { id: REC } });
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
