import { describe, it, afterAll } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { handlePurchaseCaptureRequest, setTestJwks } from './index.ts';
import { createJwtAuthority, installEdgeEnv, withFetchMock, supabaseSelect, supabaseRpc, jsonResponse,
  createAuthedRequest, createTestJwksResolver } from '../_shared/testing/edgeTestKit.ts';

const env = installEdgeEnv();
const priorAnon = Deno.env.get('SUPABASE_ANON_KEY');
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const auth = await createJwtAuthority(env.SUPABASE_URL);
setTestJwks(createTestJwksResolver(auth));
afterAll(() => { env.restore(); if (priorAnon === undefined) Deno.env.delete('SUPABASE_ANON_KEY'); else Deno.env.set('SUPABASE_ANON_KEY', priorAnon); });

describe('purchase capture authorization', () => {
  it('AC-ROP-005 refuses an anonymous capture', async () => {
    const response = await handlePurchaseCaptureRequest(new Request('http://edge.test/purchase-capture', { method: 'POST' }));
    assertEquals(response.status, 401);
  });
  it('AC-ROP-005 refuses Finance before reading source data', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    await withFetchMock([supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Finance' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } }))], async ({ calls }) => {
      const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'preview', scope: { projectId: null } }, token));
      assertEquals(response.status, 403);
      assertEquals(calls.filter((call) => call.url.pathname.includes('erp_purchase_documents')).length, 0);
    });
  });
  it('AC-ROP-017 previews a complete source census without staging or posting', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const single = { headers: { 'content-type': 'application/vnd.pgrst.object+json' } };
    await withFetchMock([
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, single)),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([{ id: 'binding-1', external_tier: 'erpnext' }])),
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [], revision: 'generation', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: false, freshness_seconds: 1800, reason: 'purchase_feed_not_current' })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [], revision: 'generation', next_cursor: null })),
      supabaseSelect('organizations', () => jsonResponse({ default_currency: 'USD' }, single)),
    ], async ({ calls }) => {
      const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'preview', scope: { projectId: null } }, token));
      assertEquals(response.status, 200);
      const body = await response.json();
      assertEquals(body.revision, 'generation');
      assertEquals(body.proposals, []);
      assertEquals(body.erp_write, false);
      assertEquals(calls.filter((call) => call.url.pathname.includes('erp_capture_sources')).length, 0);
    });
  });

  it('AC-ROP-018 names a journal remainder while missing feed coverage stays incomplete', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const single = { headers: { 'content-type': 'application/vnd.pgrst.object+json' } };
    const project = '11111111-1111-1111-1111-111111111111';
    await withFetchMock([
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, single)),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([{ id: 'binding-1', external_tier: 'erpnext', config: { project_map: { [project]: 'ERP-A' } } }])),
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [], revision: 'generation', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [{ id: 'gl-1', project: 'ERP-A', voucher_type: 'Journal Entry', voucher_no: 'JV', debit: '5.00', credit: '0.00', mapped: true }], revision: 'generation', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: false, freshness_seconds: 1800, reason: 'purchase_feed_not_current' })),
      supabaseSelect('organizations', () => jsonResponse({ default_currency: 'USD' }, single)),
    ], async () => {
      const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'report', scope: { projectId: project } }, token));
      assertEquals(response.status, 200);
      const body = await response.json();
      assertEquals(body.complete, false);
      assertEquals(body.feed_health.caught_up, false);
      assertEquals(body.reports[0].remainder[0].reason, 'journal');
      assertEquals(body.reports[0].remainder[0].amountCents, '500');
    });
  });

  it('AC-ROP-018 includes a project whose only evidence is a captured open order', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const project = '11111111-1111-1111-1111-111111111111';
    const single = { headers: { 'content-type': 'application/vnd.pgrst.object+json' } };
    await withFetchMock([
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, single)),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([{ id: 'binding-1', external_tier: 'erpnext', config: { project_map: { [project]: 'ERP-A' } } }])),
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [{ id: 'order-1', erp_doctype: 'Purchase Order', erp_name: 'PO-1', erp_docstatus: 1, erp_status: 'To Bill', erp_modified: 'rev', project_ids: [project], procurement_id: 'purchase-1', supplier: null, supplier_name: null, doc_date: null, currency: 'USD', net_total: '100.00', is_return: false, purchase_orders: [] }], revision: 'generation', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [], revision: 'generation', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: false })),
      supabaseSelect('organizations', () => jsonResponse({ default_currency: 'USD' }, single)),
    ], async () => {
      const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'report', scope: { projectId: null } }, token));
      const body = await response.json();
      assertEquals(body.reports.length, 1);
      assertEquals(body.reports[0].openOrders[0].id, 'order-1');
    });
  });

  it('AC-ROP-018 reconciles covered invoice ledger lines and a named journal to verified actuals', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const project = '11111111-1111-1111-1111-111111111111';
    const single = { headers: { 'content-type': 'application/vnd.pgrst.object+json' } };
    await withFetchMock([
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, single)),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([{ id: 'binding-1', external_tier: 'erpnext', config: { project_map: { [project]: 'ERP-A' } } }])),
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [{ id: 'bill-1', erp_doctype: 'Purchase Invoice', erp_name: 'INV-1', erp_docstatus: 1, erp_status: 'Unpaid', erp_modified: 'rev', project_ids: [project], procurement_id: 'purchase-1', supplier: null, supplier_name: null, doc_date: null, currency: 'USD', net_total: '30.00', is_return: false, purchase_orders: [], account_class: 'expense' }], revision: 'generation', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [
        { id: 'gl-1', project: 'ERP-A', voucher_type: 'Purchase Invoice', voucher_no: 'INV-1', debit: '30.00', credit: '0.00', mapped: true },
        { id: 'gl-2', project: 'ERP-A', voucher_type: 'Journal Entry', voucher_no: 'JV', debit: '20.00', credit: '0.00', mapped: true },
      ], revision: 'generation', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true })),
      supabaseRpc('purchase_capture_actuals_witness', () => jsonResponse({ complete: true, amount_cents: '5000', revision: 'generation' })),
      supabaseSelect('organizations', () => jsonResponse({ default_currency: 'USD' }, single)),
    ], async () => {
      const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'report', scope: { projectId: project } }, token));
      const body = await response.json();
      assertEquals(body.complete, true);
      assertEquals(body.reports[0].ledgerTotalCents, '5000');
      assertEquals(body.reports[0].coveredTotalCents, '3000');
      assertEquals(body.reports[0].remainderTotalCents, '2000');
      assertEquals(body.reports[0].remainder[0].reason, 'journal');
    });
  });

  it('AC-ROP-018 refuses complete totals when the witness belongs to another generation', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const project = '11111111-1111-1111-1111-111111111111';
    const single = { headers: { 'content-type': 'application/vnd.pgrst.object+json' } };
    await withFetchMock([
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, single)),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([{ id: 'binding-1', external_tier: 'erpnext', config: { project_map: { [project]: 'ERP-A' } } }])),
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [], revision: 'generation', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [], revision: 'generation', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true })),
      supabaseRpc('purchase_capture_actuals_witness', () => jsonResponse({ complete: true, amount_cents: '0', revision: 'changed' })),
      supabaseSelect('organizations', () => jsonResponse({ default_currency: 'USD' }, single)),
    ], async () => {
      const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'report', scope: { projectId: project } }, token));
      const body = await response.json();
      assertEquals(body.complete, false);
      assertEquals(body.reports[0].ledgerTotalCents, null);
    });
  });

  it('AC-ROP-018 includes the project ledger remainder in the dry-run report', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const project = '11111111-1111-1111-1111-111111111111';
    const single = { headers: { 'content-type': 'application/vnd.pgrst.object+json' } };
    await withFetchMock([
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, single)),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([{ id: 'binding-1', external_tier: 'erpnext', config: { project_map: { [project]: 'ERP-A' } } }])),
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [], revision: 'generation', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [{ id: 'gl-1', project: 'ERP-A', voucher_type: 'Journal Entry', voucher_no: 'JV', debit: '5.00', credit: '0.00', mapped: true }], revision: 'generation', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: false })),
      supabaseSelect('organizations', () => jsonResponse({ default_currency: 'USD' }, single)),
    ], async () => {
      const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'preview', scope: { projectId: project } }, token));
      const body = await response.json();
      assertEquals(body.reports[0].remainder[0].reason, 'journal');
      assertEquals(body.reports[0].complete, false);
    });
  });

});
