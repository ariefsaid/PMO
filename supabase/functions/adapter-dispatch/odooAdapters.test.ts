// #1505 O2 P3 (FR-OPP-002, DD-OPP-1, DD-OPP-8): the Odoo adapter factory returns the procurement adapter for the steps P3 pushes (purchase
// order create and revise) and refuses every other step before any outbox row, as it refuses an unusable connection or a snapshot
// that lacks a model. Supabase is mocked over fetch; the factory is the shipped one.
import { describe, it } from '@std/testing/bdd';
import { assertEquals, assertRejects } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { installEdgeEnv, jsonResponse, supabaseRpc, supabaseSelect, withFetchMock } from '../_shared/testing/edgeTestKit.ts';
import { resolveOdooProcurementAdapter, ODOO_ADAPTER_REGISTRY } from './odooAdapters.ts';
import type { AdapterSelectContext } from './dispatchAdapters.ts';

const env = installEdgeEnv();
globalThis.addEventListener('unload', () => env.restore());

const SNAPSHOT = {
  later: { 'purchase.order': true, 'purchase.order.line': true, 'stock.picking': true, 'stock.move': true, 'account.move': true, 'account.payment': true },
  models: { 'account.journal': { exists: true, read: true } },
};
const binding = (config: Record<string, unknown> = {}) => jsonResponse({
  id: 'b0000000-0000-4000-8000-000000000001', site_url: 'https://odoo.example.test', secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z',
  config: { database: 'db1', odoo_company_id: 1, capabilities: SNAPSHOT, ...config },
}, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });

function ctxFor(kind: string, operation = 'create') {
  const sc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return { orgId: '0d000000-0000-4000-8000-000000000008', serviceClient: sc, userId: 'u-1', faultGate: {}, erpAuth: {},
    command: { domain: 'procurement', operation, record: { id: '123e4567-e89b-12d3-a456-426614174000', erp_doc_kind: kind, procurementId: 'c0000000-0000-4000-8000-000000000001', poId: '123e4567-e89b-12d3-a456-426614174000', revision: 2 } } } as unknown as AdapterSelectContext;
}
const object = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
/** `odooCurrency`: what `res.company.currency_id` reads as; `caseCurrency`: the PMO case's. `odooCalls` records the Odoo methods called. */
const world = (config?: Record<string, unknown>, { caseCurrency = 'IDR', odooCurrency = [12, 'IDR'], odooCalls = [] as string[] } = {}) => [
  supabaseSelect('external_org_bindings', () => binding(config)),
  supabaseRpc('read_vault_secret', () => jsonResponse('odoo-test-key')),
  supabaseSelect('procurements', () => object({ code: 'PRC-1', project_id: null, vendor_id: null, currency: caseCurrency })),
  supabaseSelect('purchase_orders', () => object({ procurement_id: 'c0000000-0000-4000-8000-000000000001' })),
  { label: 'odoo', host: 'odoo.example.test', response: (call: { url: URL }) => {
    odooCalls.push(call.url.pathname.split('/').slice(-2).join('/'));
    return jsonResponse([{ id: 1, currency_id: odooCurrency }]);
  } },
];

describe('P3 the Odoo adapter factory', () => {
  it('is the procurement domain\'s Odoo factory', () => assertEquals(Object.keys(ODOO_ADAPTER_REGISTRY), ['procurement']));

  for (const [kind, operation] of [['purchase-order', 'create'], ['purchase-order', 'revise']] as const) {
    it(`returns the Odoo procurement adapter for a ${kind} ${operation}`, async () => {
      const adapter = await withFetchMock(world(), () => resolveOdooProcurementAdapter(ctxFor(kind, operation)));
      assertEquals([adapter.tier, [...adapter.capabilityMap]], ['odoo', ['procurement']]);
    });
  }

  for (const kind of ['goods-receipt', 'purchase-invoice', 'payment', 'rfq']) {
    it(`refuses a ${kind} create: not available yet, config-rejected, before any outbox row`, async () => {
      const err = await withFetchMock(world(), () => assertRejects(() => resolveOdooProcurementAdapter(ctxFor(kind)))) as { code?: string; message: string };
      assertEquals(err.code, 'config-rejected');
      assertEquals(err.message.includes('not available yet'), true);
    });
  }

  it('a purchase-order transition (no such Odoo step) is refused too', async () => {
    await withFetchMock(world(), () => assertRejects(() => resolveOdooProcurementAdapter(ctxFor('purchase-order', 'transition'))));
  });

  it('a snapshot missing a model refuses and names it, whatever the step', async () => {
    const err = await withFetchMock(world({ capabilities: { ...SNAPSHOT, later: { ...SNAPSHOT.later, 'stock.move': false } } }), () => assertRejects(() => resolveOdooProcurementAdapter(ctxFor('purchase-order')))) as Error;
    assertEquals(err.message.includes('stock.move'), true);
  });

  for (const operation of ['create', 'revise']) {
    it(`I4 a ${operation} whose case currency differs from the Odoo company's is config-rejected, names both, and only reads Odoo`, async () => {
      const odooCalls: string[] = [];
      const err = await withFetchMock(world(undefined, { caseCurrency: 'USD', odooCalls }), () => assertRejects(() => resolveOdooProcurementAdapter(ctxFor('purchase-order', operation)))) as { code?: string; message: string };
      assertEquals(err.code, 'config-rejected');
      assertEquals(err.message.includes('currency-mismatch') && err.message.includes('USD') && err.message.includes('IDR'), true, err.message);
      assertEquals(odooCalls, ['res.company/read']);
    });
  }

  it('I4 an Odoo company whose currency cannot be read refuses closed', async () => {
    const err = await withFetchMock(world(undefined, { odooCurrency: false as never }), () => assertRejects(() => resolveOdooProcurementAdapter(ctxFor('purchase-order')))) as { code?: string; message: string };
    assertEquals([err.code, err.message.startsWith('currency-unreadable')], ['config-rejected', true]);
  });
});
