// #1506 O3 C2 (FR-OCI-001, PD-4, DD-OCI-1, ADR-0058 C-1, NFR-OCI-001): a tier-odoo revenue command goes through the SAME money outbox as the
// ERPNext tier. The Odoo tier's deps are the shipped module's: the anchor key follows the PMO record (`si:` / `ip:`), a record id that is not a
// UUID cannot reach Odoo, both revenue anchors are composite hold-on-doubt so a recovery that finds nothing is HELD and never reissued, and a
// connection that cannot be used is refused before any outbox row. Odoo and Supabase are mocked over fetch.
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertRejects } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { installEdgeEnv, jsonResponse, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute } from '../_shared/testing/edgeTestKit.ts';
import { createFakeOdoo } from '../../../pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts';
import { externalIdentifier } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/anchors.ts';
import { APPROVER_ID, CUSTOMER_ID, DRAFT_ID, PROJECT_ID, approveCommand, draftItems, revenueRoutes, type World } from './odooRevenueFixtures.ts';
import { resolveOdooMoneyOutboxDeps } from './odooMoneyOutbox.ts';
import { odooRevenueAnchorKey } from './odooRevenueOutbox.ts';
import type { AdapterSelectContext } from './dispatchAdapters.ts';

const env = installEdgeEnv();
globalThis.addEventListener('unload', () => env.restore());

const ORG = '0d000000-0000-4000-8000-000000000006';
const REC = '123e4567-e89b-12d3-a456-426614174000';
const KEY = 'cccccccc-cccc-4ccc-8ccc-0000000015ff';
const objectResponse = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const BINDING = { id: 'b0000000-0000-4000-8000-000000000001', site_url: 'https://odoo.example.test', secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z', config: { database: 'db1', odoo_company_id: 1 } };

function setup(kind: string, over: { id?: string; binding?: Record<string, unknown> | null; operation?: string } = {}) {
  const routes: MockRoute[] = [
    supabaseSelect('external_org_bindings', () => over.binding === null ? new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }) : objectResponse({ ...BINDING, ...over.binding })),
    supabaseRpc('read_vault_secret', () => jsonResponse('odoo-test-key')),
  ];
  const sc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const ctx = {
    orgId: ORG, serviceClient: sc, userId: 'u-1', faultGate: {}, erpAuth: {},
    command: { domain: 'revenue', operation: over.operation ?? 'create', idempotencyKey: KEY, record: { id: over.id ?? REC, erp_doc_kind: kind, customerId: 'c-1' } },
  } as unknown as AdapterSelectContext;
  return { routes, ctx };
}

describe('PD-4 the revenue anchor key follows the PMO record, never the per-click key', () => {
  it('derives one key per kind', () => {
    assertEquals(odooRevenueAnchorKey('sales-invoice', { id: REC }), `si:${REC}`);
    assertEquals(odooRevenueAnchorKey('incoming-payment', { id: REC }), `ip:${REC}`);
  });
  it('a record id that is not a UUID is refused', () => {
    for (const id of ['inv-1', '', undefined, `${REC}x`, "1' or '1'='1"]) {
      let thrown: unknown;
      try { odooRevenueAnchorKey('sales-invoice', { id }); } catch (error) { thrown = error; }
      assert(thrown instanceof Error && (thrown as { code?: string }).code === 'commit-rejected', String(id));
    }
  });
});

describe('FR-OCI-001 / ADR-0058 the Odoo revenue deps are the shared money outbox, held on doubt', () => {
  for (const kind of ['incoming-payment']) {
    it(`NFR-OCI-001 a ${kind} is never reissued on an inconclusive recovery (composite hold-on-doubt, C-1)`, async () => {
      const t = setup(kind);
      await withFetchMock(t.routes, async () => {
        const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
        assertEquals(deps.reissueOnInconclusiveAbsence, false);
        assertEquals(typeof deps.payloadDigest, 'string');
        // until the adapter's recovery arrives a probe holds the row: an unconfirmed outcome is never reported as success
        await assertRejects(() => deps.probeByRemarksKey('revenue', KEY), Error, 'odoo-revenue-recovery-unavailable');
      });
    });
  }

  it('a revenue kind Odoo does not push (or none) is refused before any outbox row', async () => {
    for (const kind of ['credit-note', 'sales-order', 'undefined']) {
      const t = setup(kind);
      await withFetchMock(t.routes, async () => {
        await assertRejects(() => resolveOdooMoneyOutboxDeps(t.ctx), Error, 'is not wired');
      });
    }
  });

  it('a delete is refused: Odoo documents are not deleted through the seam', async () => {
    const t = setup('sales-invoice', { operation: 'delete' });
    await withFetchMock(t.routes, async () => { await assertRejects(() => resolveOdooMoneyOutboxDeps(t.ctx), Error, 'does not support delete'); });
  });

  it('a record id that is not a UUID is refused before the connection is even read', async () => {
    const t = setup('incoming-payment', { id: 'rcpt-1' });
    await withFetchMock(t.routes, async ({ calls }) => {
      await assertRejects(() => resolveOdooMoneyOutboxDeps(t.ctx), Error, 'revenue-record-id-invalid');
      assertEquals(calls.length, 0);
    });
  });

  it('a connection that cannot be used is refused (config-rejected), not guessed', async () => {
    for (const binding of [null, { activated_at: null }] as const) {
      const t = setup('sales-invoice', { binding });
      await withFetchMock(t.routes, async () => { await assertRejects(() => resolveOdooMoneyOutboxDeps(t.ctx), Error, 'The Odoo connection is not usable'); });
    }
  });
});

describe('FR-OCI-070 / FR-OCI-072 / OQ-OCI-14 an invoice approval goes through the shared money outbox: a create, held on doubt, probed by its anchor', () => {
  async function invoiceDeps(worldOverrides: Pick<World, 'saleTax' | 'outbox'> = {}) {
    const fake = createFakeOdoo({ key: 'odoo-test-key' });
    fake.seed('res.company', [{ id: 1, name: 'Co', currency_id: [12, 'IDR'] }]);
    fake.seed('res.partner', [{ id: 41, name: 'Client' }, { id: 42, name: 'Another' }]);
    fake.seed('account.tax', [{ id: 5, name: 'PPN', amount: 11, company_id: [1, 'Co'] }]);
    fake.seed('product.product', [{ id: 71, name: 'Item A', taxes_id: [], income_account_id: 149, property_account_income_id: [149, 'Sales'] }]);
    const unexpected: FetchCall[] = [];
    const sc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const ctx = { orgId: '11111111-1111-4111-8111-111111111111', serviceClient: sc, userId: APPROVER_ID, faultGate: {}, erpAuth: {}, command: approveCommand() } as unknown as AdapterSelectContext;
    const call = (model: string, method: string, body: unknown) => fake.fetch(`https://odoo.example.test/json/2/${model}/${method}`, { method: 'POST', headers: { Authorization: 'bearer odoo-test-key' }, body: JSON.stringify(body) }).then((r) => r.json());
    const world: World = { projectLink: '101', odoo: fake, ...worldOverrides };
    return { fake, ctx, call, unexpected, world, routes: revenueRoutes(unexpected, APPROVER_ID, world) };
  }

  it('the row is a create, never reissued on doubt, and its payload carries what the recovery judges by (client, expected total, cost account, bounded window)', async () => {
    const t = await invoiceDeps();
    await withFetchMock(t.routes, async ({ calls }) => {
      const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
      assertEquals(deps.reissueOnInconclusiveAbsence, false);
      await deps.insertOutboxPending('revenue', DRAFT_ID, KEY);
      const insert = calls.find((c) => c.method === 'POST' && c.url.pathname === '/rest/v1/external_command_outbox')!.bodyJson as { operation: string; payload: Record<string, unknown> };
      assertEquals(insert.operation, 'create');
      const payload = insert.payload;
      assertEquals([payload.odoo_partner_id, payload.odoo_expected_total, payload.odoo_cost_account, payload.erp_doc_kind], [41, '2220.00', 101, 'sales-invoice']);
      assertEquals(typeof payload.created_after === 'string' && typeof payload.created_before === 'string', true);
      assertEquals(t.unexpected, []);
    });
  });

  it('the digest is the command\'s, not the derived facts: the window and the judged figures stay out of it', async () => {
    const [a, b] = [await invoiceDeps(), await invoiceDeps()];
    const digests: string[] = [];
    for (const t of [a, b]) {
      await withFetchMock(t.routes, async () => { await new Promise((r) => setTimeout(r, 1100)); digests.push((await resolveOdooMoneyOutboxDeps(t.ctx)).payloadDigest as string); });
    }
    assertEquals(digests[0], digests[1], 'the same approval digests the same, whenever it is made');
  });

  it('a RECOVERY holds on an unanchored look-alike of the client in the window, never adopting it; a first attempt (no recovery) finds nothing', async () => {
    const t = await invoiceDeps();
    await t.call('account.move', 'create', { vals_list: [{ move_type: 'out_invoice', partner_id: 41, invoice_date: '2026-11-03', invoice_line_ids: [] }] });
    t.fake.rows('account.move')[0].create_date = new Date().toISOString().slice(0, 19).replace('T', ' ');   // made just now, inside the window
    await withFetchMock(t.routes, async () => {
      const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
      assertEquals(await deps.probeByRemarksKey('revenue', KEY, { recovery: false }), null);
      await assertRejects(() => deps.probeByRemarksKey('revenue', KEY, { recovery: true }), Error, 'ambiguous-anchor');
      assertEquals(t.fake.rows('account.move')[0].state, 'draft', 'nothing was posted or anchored');
    });
  });

  it('a RECOVERY finds our anchored draft and posts it exactly once; the canonical it returns is the read-back', async () => {
    const t = await invoiceDeps();
    const [id] = await t.call('account.move', 'create', { vals_list: [{ move_type: 'out_invoice', partner_id: 41, invoice_date: '2026-11-03', invoice_line_ids: [[0, 0, { product_id: 71, name: 'x', quantity: 1, price_unit: 2000, tax_ids: [[6, 0, [5]]], analytic_distribution: { '101': 100 } }]] }] });
    await t.call('ir.model.data', 'create', { vals_list: [{ ...externalIdentifier(`si:${DRAFT_ID}`), model: 'account.move', res_id: id }] });
    await withFetchMock(t.routes, async () => {
      const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
      const found = await deps.probeByRemarksKey('revenue', KEY, { recovery: true });
      assertEquals(found?.externalRecordId, `account.move:${id}`);
      assertEquals(t.fake.rows('account.move').length, 1);
      assertEquals(t.fake.rows('account.move')[0].state, 'posted');
    });
  });

  it('AC-OCI-062 recovery uses frozen outbox facts when the current sale-tax mapping is unavailable', async () => {
    const outbox = new Map<string, Record<string, unknown>>();
    const payload = {
      id: DRAFT_ID, erp_doc_kind: 'sales-invoice', verb: 'submit', customerId: CUSTOMER_ID, projectId: PROJECT_ID,
      workOrderId: '66666666-6666-4666-8666-666666666666', currency: 'IDR', items: draftItems,
      reference_number: 'WO-PO-9', odoo_partner_id: 41, odoo_expected_total: '2220.00', odoo_cost_account: 101,
      created_after: '2026-11-03 13:00:00', created_before: '2026-11-03 13:20:00',
    };
    outbox.set(`${DRAFT_ID}|${KEY}`, {
      id: 'outbox-1', domain: 'revenue', pmo_record_id: DRAFT_ID, idempotency_key: KEY, state: 'quarantined',
      external_tier: 'odoo', operation: 'create', payload,
    });
    const t = await invoiceDeps({ saleTax: 'absent', outbox });
    t.ctx.command.idempotencyKey = KEY;
    const [id] = await t.call('account.move', 'create', { vals_list: [{ move_type: 'out_invoice', partner_id: 41, invoice_date: '2026-11-03', invoice_line_ids: [[0, 0, {
      product_id: 71, name: 'x', quantity: 1, price_unit: 2000, tax_ids: [[6, 0, [5]]], analytic_distribution: { '101': 100 },
    }]] }] });
    await t.call('account.move', 'action_post', { ids: [id] });
    await t.call('ir.model.data', 'create', { vals_list: [{ ...externalIdentifier(`si:${DRAFT_ID}`), model: 'account.move', res_id: id }] });

    await withFetchMock(t.routes, async ({ calls }) => {
      const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
      const found = await deps.probeByRemarksKey('revenue', KEY, { recovery: true });
      assertEquals(found?.externalRecordId, `account.move:${id}`);
      assertEquals(calls.some((call) => call.url.pathname === '/rest/v1/external_master_records'
        && call.url.searchParams.get('kind') === 'eq.tax'), false, 'recovery does not re-resolve the current sale-tax mapping');
      assertEquals(t.unexpected, []);
    });
  });

  it('FR-OCI-063 an adopted Odoo invoice is probed by its resolved reference, even after the stock anchor was edited', async () => {
    const createdAfter = new Date(Date.now() - 60_000).toISOString().slice(0, 19).replace('T', ' ');
    const createdBefore = new Date(Date.now() + 60_000).toISOString().slice(0, 19).replace('T', ' ');
    const outbox = new Map<string, Record<string, unknown>>();
    const t = await invoiceDeps({ outbox });
    const [id] = await t.call('account.move', 'create', { vals_list: [{ move_type: 'out_invoice', partner_id: 41, invoice_date: '2026-11-03', invoice_line_ids: [[0, 0, {
      product_id: 71, name: 'x', quantity: 1, price_unit: 2000, tax_ids: [[6, 0, [5]]], analytic_distribution: { '101': 100 },
    }]] }] });
    await t.call('account.move', 'action_post', { ids: [id] });
    const payload = {
      id: DRAFT_ID, erp_doc_kind: 'sales-invoice', verb: 'submit', customerId: CUSTOMER_ID, projectId: PROJECT_ID,
      workOrderId: '66666666-6666-4666-8666-666666666666', currency: 'IDR', items: draftItems,
      reference_number: 'WO-PO-9', odoo_partner_id: 41, odoo_expected_total: '2220.00', odoo_cost_account: 101,
      created_after: createdAfter, created_before: createdBefore, odoo_adopted_ref: `account.move:${id}`,
    };
    outbox.set(`${DRAFT_ID}|${approveCommand().idempotencyKey}`, {
      id: 'outbox-adopted', domain: 'revenue', pmo_record_id: DRAFT_ID, idempotency_key: approveCommand().idempotencyKey,
      state: 'failed', external_tier: 'odoo', operation: 'create', payload,
    });
    await withFetchMock(t.routes, async () => {
      const deps = await resolveOdooMoneyOutboxDeps(t.ctx);
      const found = await deps.probeByRemarksKey('revenue', approveCommand().idempotencyKey, { recovery: true });
      assertEquals(found?.externalRecordId, `account.move:${id}`);
      assertEquals(t.fake.rows('account.move').length, 1, 'adoption verifies the named invoice without creating another');
    });
  });
});
