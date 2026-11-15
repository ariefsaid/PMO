import { afterAll, describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { handlePurchaseCaptureRequest } from './index.ts';
import { createJwtAuthority, createAuthedRequest, installEdgeEnv, jwksRoute, jsonResponse, supabaseSelect, supabaseRpc, erp, withFetchMock } from '../_shared/testing/edgeTestKit.ts';

const env = installEdgeEnv();
const priorAnon = Deno.env.get('SUPABASE_ANON_KEY');
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const auth = await createJwtAuthority(env.SUPABASE_URL);
afterAll(() => { env.restore(); if (priorAnon === undefined) Deno.env.delete('SUPABASE_ANON_KEY'); else Deno.env.set('SUPABASE_ANON_KEY', priorAnon); });

describe('purchase capture caller authorization', () => {
  it('AC-ROP-021 handler has no adapter document type literals', async () => {
    const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
    for (const name of ['Purchase Order', 'Purchase Invoice', 'Payment Entry', 'Journal Entry']) {
      assertEquals(source.includes(name), false);
    }
  });
  it('AC-ROP-021 handler remains adapter neutral', async () => {
    const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
    for (const name of ['/erpnext/', 'project_map', 'erp_name', 'purchase_orders', 'erp_modified', 'voucher_type', 'voucher_no', 'journal_purchase_id']) assertEquals(source.includes(name), false, name);
  });
  it('AC-ROP-021 apply rules use normalized document kinds', async () => {
    const sql = await Deno.readTextFile(new URL('../../migrations/0866_erp_purchase_capture.sql', import.meta.url));
    const apply = sql.split('create function public.capture_history_apply_internal(')[1]?.split('revoke all on function public.capture_history_apply_internal')[0];
    assertEquals(typeof apply, 'string');
    for (const name of ['Purchase Order', 'Purchase Invoice', 'Payment Entry', 'Journal Entry', "'erpnext'", "'project_map'", "'Supplier:'", "'erp_project'", "'To Receive and Bill'", "'To Receive'", "'To Bill'", "'Unpaid'", "'Overdue'", "'Partly Paid'", "'Paid'"]) {
      assertEquals(apply.includes(name), false);
    }
  });
  it('AC-ROP-005 rejects anonymous requests', async () => {
    const response = await handlePurchaseCaptureRequest(new Request('http://edge.test/purchase-capture', { method: 'POST' }));
    assertEquals(response.status, 401);
  });
  it('AC-ROP-005 rejects Finance before any census read', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Finance', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
    ], async ({ calls }) => {
      const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'preview', scope: { projectId: null } }, token));
      assertEquals(response.status, 403);
      assertEquals(calls.some(call => call.url.pathname.includes('purchase_capture_source_page')), false);
    });
  });
  it('AC-ROP-005 rejects an inactive actor before reading or applying', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: false })),
    ], async ({ calls }) => {
      const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'preview', scope: { projectId: null } }, token));
      assertEquals(response.status, 403);
      assertEquals(calls.some(call => /purchase_capture_source_page|purchase_capture_ledger_page|purchase_capture_feed_health|capture_history_batch/.test(call.url.pathname)), false);
    });
  });
  it('AC-ROP-012 rejects invalid apply identities before census or mutation', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
    ], async ({ calls }) => {
      const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'apply', scope: { projectId: null }, expectedRevision: 'revision' }, token));
      assertEquals(response.status, 400);
      assertEquals(calls.some(call => call.url.pathname.includes('purchase_capture_source_page')), false);
    });
  });

  it('AC-ROP-021 invoice assignment capability refuses unsupported', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([{ id: 'binding-1', external_tier: 'odoo', config: {} }])),
    ], async ({ calls }) => {
      const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'assign', rows: [{ request_id: '22222222-2222-4222-8222-222222222222', source_id: '33333333-3333-4333-8333-333333333333', decision: 'project', project_id: '44444444-4444-4444-8444-444444444444', accept_set_aside: true }], expectedRevision: 'rev', dryRun: true }, token));
      const body = await response.json();
      assertEquals(response.status, 409);
      assertEquals(body.missing?.includes('invoice_assignment'), true);
      assertEquals(body.erp_write, false);
      assertEquals(calls.some(call => call.url.pathname.includes('assign_capture_invoices')), false);
      assertEquals(calls.some(call => call.url.pathname.startsWith('/api/')), false);
    });
  });

  it('AC-ROP-021 supported assignment dispatches through declared capability', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const rows = [{ request_id: '22222222-2222-4222-8222-222222222222', source_id: '33333333-3333-4333-8333-333333333333', decision: 'project', project_id: '44444444-4444-4444-8444-444444444444', accept_set_aside: true }];
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([{ id: 'binding-1', external_tier: 'erpnext', config: { company: 'Example' }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 }])),
      supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret')),
      supabaseRpc('assign_capture_invoices', call => { assertEquals(call.bodyJson, { p_rows: rows, p_expected_revision: 'rev', p_dry_run: true }); return jsonResponse({ complete: true }); }),
    ], async ({ calls }) => {
      const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'assign', rows, expectedRevision: 'rev', dryRun: true }, token));
      assertEquals(response.status, 200);
      assertEquals((await response.json()).complete, true);
      assertEquals(calls.filter(call => call.url.pathname.includes('assign_capture_invoices')).length, 1);
      assertEquals(calls.some(call => call.url.pathname.startsWith('/api/')), false);
    });
  });

  it('AC-ROP-012 served assignment never calls ERP', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const rows = [{ request_id: '22222222-2222-4222-8222-222222222222', source_id: '33333333-3333-4333-8333-333333333333', decision: 'project', project_id: '44444444-4444-4444-8444-444444444444' },
      { request_id: '22222222-2222-4222-8222-222222222223', source_id: '33333333-3333-4333-8333-333333333334', decision: 'set_aside' }];
    const results = [{ request_id: rows[0].request_id, outcome: 'create', erp_write: false }, { request_id: rows[1].request_id, outcome: 'refused', reason: 'source_tagged', erp_write: false }];
    for (const tier of ['erpnext', 'odoo']) {
      for (const dryRun of [true, false]) {
        await withFetchMock([
          jwksRoute(auth),
          supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
          supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
          supabaseSelect('external_org_bindings', () => jsonResponse([{ id: 'binding-1', external_tier: tier, config: { company: 'Example' }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 }])),
          supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret')),
          supabaseRpc('assign_capture_invoices', () => jsonResponse({ complete: true, revision: 'rev', results })),
        ], async ({ calls }) => {
          const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'assign', rows, expectedRevision: 'rev', dryRun }, token));
          const body = await response.json();
          assertEquals(body.erp_write, false, `${tier} dryRun=${dryRun}`);
          if (tier === 'erpnext') {
            assertEquals(response.status, 200);
            assertEquals(body.results.map((r: { outcome: string }) => r.outcome), ['create', 'refused']);
          } else {
            assertEquals(response.status, 409);
          }
          assertEquals(calls.some(call => call.url.host === '8.8.8.8' || call.url.pathname.startsWith('/api/')), false, 'no call to the ERP');
          assertEquals(calls.some(call => /outbox|dispatch/i.test(call.url.pathname)), false, 'nothing queued for dispatch');
          assertEquals(calls.some(call => call.method !== 'GET' && !/\/rpc\//.test(call.url.pathname)), false, 'no write except the named RPC');
        });
      }
    }
  });

  it('AC-ROP-012 assignment resolves no ERP credentials, so a credential failure never reads as unsupported', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const rows = [{ request_id: '22222222-2222-4222-8222-222222222222', source_id: '33333333-3333-4333-8333-333333333333', decision: 'set_aside' }];
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([{ id: 'binding-1', external_tier: 'erpnext', config: { company: 'Example' }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 }])),
      supabaseRpc('read_vault_secret', () => jsonResponse({ message: 'vault unavailable' }, { status: 500 })),
      supabaseRpc('assign_capture_invoices', () => jsonResponse({ complete: true, results: [] })),
    ], async ({ calls }) => {
      const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'assign', rows, expectedRevision: 'rev', dryRun: true }, token));
      assertEquals(response.status, 200);
      assertEquals(calls.some(call => call.url.pathname.includes('read_vault_secret')), false);
    });
  });

  it('AC-ROP-021 reports unsupported Odoo capability rather than an empty census', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([{ id: 'binding-1', external_tier: 'odoo', config: {} }])),
    ], async ({ calls }) => {
      const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'preview', scope: { projectId: null } }, token));
      const body = await response.json();
      assertEquals(body.complete, false);
      assertEquals(body.erp_write, false);
      assertEquals(body.missing.includes('odoo_purchase_capture'), true);
      assertEquals(calls.some(call => call.url.pathname.includes('purchase_capture_source_page')), false);
    });
  });

  it('AC-ROP-021 refuses an unknown adapter before any census or ERP request', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([{ id: 'binding-1', external_tier: 'unknown', config: {} }])),
    ], async ({ calls }) => {
      const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'preview', scope: { projectId: null } }, token));
      assertEquals(response.status, 409);
      assertEquals((await response.json()).missing, ['unsupported_adapter']);
      assertEquals(calls.some(call => call.url.pathname.includes('purchase_capture_source_page')), false);
    });
  });

  for (const scenario of ['company_unknown', 'erp_reader_unavailable'] as const) {
    it(`AC-ROP-017 refuses ${scenario} before reading the census`, async () => {
      const token = await auth.mintJwt({ sub: 'user-1' });
      const config = scenario === 'company_unknown' ? {} : { company: 'Example' };
      await withFetchMock([
        jwksRoute(auth),
        supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
        supabaseSelect('external_org_bindings', call => call.url.searchParams.get('select')?.startsWith('site_url')
          ? jsonResponse(null) : jsonResponse([{ id: 'binding-1', external_tier: 'erpnext', config }])),
      ], async ({ calls }) => {
        const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'preview', scope: { projectId: null } }, token));
        assertEquals(response.status, 200);
        assertEquals((await response.json()).missing, [scenario]);
        assertEquals(calls.some(call => call.url.pathname.includes('purchase_capture_source_page')), false);
      });
    });
  }

  it('AC-ROP-017 previews a scoped mirror order through the trusted reader without writes', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const project = '11111111-1111-4111-8111-111111111111';
    const binding = { id: 'binding-1', org_id: 'org-1', external_tier: 'erpnext', config: { company: 'Example', project_map: { [project]: 'PROJECT' } }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 };
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([binding])),
      supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret')),
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [{ id: 'order-1', kind: 'order', erp_doctype: 'Purchase Order', erp_name: 'PO-1', erp_docstatus: 1, erp_status: 'To Bill', erp_modified: 'rev', supplier: 'SUP', supplier_name: 'Vendor', supplier_id: 'vendor-1', project_ids: [project], purchase_orders: [], procurement_id: null, purchase_origin: null, doc_date: null, currency: 'USD', net_total: '100.00', is_return: false, recorded_by_pmo: false }, { id: 'order-2', kind: 'order', erp_doctype: 'Purchase Order', erp_name: 'PO-2', erp_docstatus: 1, erp_status: 'To Bill', erp_modified: 'rev', supplier: 'SUP', supplier_name: 'Vendor', supplier_id: 'vendor-1', project_ids: [project], purchase_orders: [], procurement_id: null, purchase_origin: null, recorded_by_pmo: true, doc_date: null, currency: 'USD', net_total: '10.00', is_return: false }, { id: 'payment-1', kind: 'supplier_payment', erp_doctype: 'Payment Entry', erp_name: 'PAY-1', erp_docstatus: 1, erp_status: 'Paid', erp_modified: 'rev', supplier: 'SUP', supplier_name: 'Vendor', supplier_id: 'vendor-1', project_ids: [], purchase_orders: [], procurement_id: null, purchase_origin: null, recorded_by_pmo: false, doc_date: null, currency: null, net_total: null, is_return: false }], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true, ledger_currency: 'IDR', ledger_started_at: '2026-11-13T00:00:00Z' })),
      supabaseRpc('purchase_capture_assignment_report', () => jsonResponse({ assignments: [] })),
      erp('8.8.8.8', '/api/resource/System%20Settings/System%20Settings', () => jsonResponse({ data: { currency_precision: '2', float_precision: '3', number_format: '#,###.##' } })),
    ], async ({ calls }) => {
      const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'preview', scope: { projectId: project } }, token));
      const body = await response.json();
      assertEquals(response.status, 200);
      assertEquals(body.proposals[0].outcome, 'propose');
      assertEquals(body.proposals.find((item: { id: string }) => item.id === 'order-2')?.reason, 'recorded_by_pmo');
      assertEquals(body.unassigned_documents[0], { id: 'payment-1', kind: 'supplier_payment', state: 'paid', source: 'PAY-1', reason: 'payment_without_invoice' });
      assertEquals(body.complete, true);
      assertEquals(body.revision, 'gen');
      assertEquals(body.erp_write, false);
      assertEquals((calls.find(call => call.url.pathname.endsWith('/purchase_capture_source_page'))?.bodyJson as { p_project_id: string }).p_project_id, project);
      assertEquals((calls.find(call => call.url.pathname.endsWith('/purchase_capture_ledger_page'))?.bodyJson as { p_project_id: string }).p_project_id, project);
      assertEquals(calls.filter(call => call.url.hostname === '8.8.8.8').length, 1);
      assertEquals(calls.some(call => call.url.pathname.endsWith('/capture_history_apply')), false);
    });
  });

  it('AC-ROP-017 refuses incomplete families in preview and apply', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const project = '11111111-1111-4111-8111-111111111111';
    const binding = { id: 'binding-1', org_id: 'org-1', external_tier: 'erpnext', config: { company: 'Example' }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 };
    const base = { erp_docstatus: 1, erp_modified: 'rev', supplier: 'SUP', supplier_name: 'Vendor', supplier_id: 'vendor-1', project_ids: [project], procurement_id: null, purchase_origin: null, doc_date: null, currency: 'USD', net_total: '100.00', is_return: false, recorded_by_pmo: false, family_incomplete: true };
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([binding])),
      supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret')),
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [
        { ...base, id: 'invoice-1', kind: 'supplier_invoice', erp_doctype: 'Purchase Invoice', erp_name: 'INV-1', erp_status: 'Unpaid', purchase_orders: ['PO-absent'] },
        { ...base, id: 'order-1', kind: 'order', erp_doctype: 'Purchase Order', erp_name: 'PO-1', erp_status: 'To Bill', purchase_orders: [] },
      ], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [{ id: 'gl-1', erp_modified: 'rev', company: 'Example', project_id: project, kind: 'supplier_invoice', voucher_type: 'Purchase Invoice', voucher_no: 'INV-1', debit: '100', credit: '0', document_id: 'invoice-1', journal_purchase_id: null, classification: 'mapped' }], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true, ledger_currency: 'USD', ledger_started_at: '2026-11-13T00:00:00Z' })),
      supabaseRpc('purchase_capture_assignment_report', () => jsonResponse({ assignments: [] })),
      supabaseRpc('capture_history_batch', call => jsonResponse((call.bodyJson as { p_groups: unknown }).p_groups === null ? { reason: 'batch_not_found' } : { complete: true })),
      erp('8.8.8.8', '/api/resource/System%20Settings/System%20Settings', () => jsonResponse({ data: { currency_precision: '2' } })),
    ], async ({ calls }) => {
      for (const action of ['preview', 'apply']) {
        const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action, scope: { projectId: project }, expectedRevision: 'gen', requestId: '22222222-2222-4222-8222-222222222222' }, token));
        const body = await response.json();
        assertEquals(body.proposals.map((p: { reason: string }) => p.reason), ['family_incomplete', 'family_incomplete']);
      }
      const batches = calls.filter(call => call.url.pathname.endsWith('/capture_history_batch'));
      assertEquals(batches.length, 2);
      assertEquals((batches[1].bodyJson as { p_groups: unknown[] }).p_groups, []);
    });
  });

  it('AC-ROP-017 includes the whole captured family when a later invoice arrives', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const project = '11111111-1111-4111-8111-111111111111';
    const binding = { id: 'binding-1', org_id: 'org-1', external_tier: 'erpnext', config: { company: 'Example' }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 };
    const base = { erp_docstatus: 1, erp_modified: 'rev', supplier: 'SUP', supplier_name: 'Vendor', supplier_id: 'vendor-1', project_ids: [project], doc_date: null, currency: 'USD', net_total: '100.00', is_return: false, recorded_by_pmo: false, family_incomplete: false };
    let attached = false;
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([binding])),
      supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret')),
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [
        { ...base, id: 'order-1', kind: 'order', erp_doctype: 'Purchase Order', erp_name: 'PO-1', erp_status: 'To Bill', purchase_orders: [], procurement_id: 'purchase-1', purchase_origin: 'captured' },
        { ...base, id: 'invoice-1', kind: 'supplier_invoice', erp_doctype: 'Purchase Invoice', erp_name: 'INV-1', erp_status: 'Unpaid', purchase_orders: ['PO-1'], procurement_id: attached ? 'purchase-1' : null, purchase_origin: attached ? 'captured' : null },
      ], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [{ id: 'gl-1', erp_modified: 'rev', company: 'Example', project_id: project, kind: 'supplier_invoice', voucher_type: 'Purchase Invoice', voucher_no: 'INV-1', debit: '100', credit: '0', document_id: 'invoice-1', journal_purchase_id: null, classification: 'mapped' }], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true, ledger_currency: 'USD', ledger_started_at: '2026-11-13T00:00:00Z' })),
      supabaseRpc('purchase_capture_assignment_report', () => jsonResponse({ assignments: [] })),
      supabaseRpc('capture_history_batch', call => {
        const groups = (call.bodyJson as { p_groups: unknown }).p_groups;
        if (groups === null) return jsonResponse({ reason: 'batch_not_found' });
        attached = true;
        return jsonResponse({ complete: true, results: [{ outcome: 'create', procurement_id: 'purchase-1' }] });
      }),
      erp('8.8.8.8', '/api/resource/System%20Settings/System%20Settings', () => jsonResponse({ data: { currency_precision: '2' } })),
    ], async ({ calls }) => {
      const invoke = async (action: string) => (await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action, scope: { projectId: project }, expectedRevision: 'gen', requestId: '22222222-2222-4222-8222-222222222222' }, token))).json();
      const preview = await invoke('preview');
      assertEquals(preview.proposals.map((p: { outcome: string }) => p.outcome), ['matched', 'propose']);
      await invoke('apply');
      const submitted = calls.filter(call => call.url.pathname.endsWith('/capture_history_batch'));
      assertEquals((submitted[1].bodyJson as { p_groups: unknown }).p_groups, [{ project_id: project, source_ids: ['invoice-1', 'order-1'] }]);
      const rerun = await invoke('preview');
      assertEquals(rerun.proposals.map((p: { outcome: string }) => p.outcome), ['matched', 'matched']);
    });
  });

  it('AC-ROP-018 reconciles signed mapped ledger and names the journal remainder', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const project = '11111111-1111-4111-8111-111111111111';
    const binding = { id: 'binding-1', org_id: 'org-1', external_tier: 'erpnext', config: { company: 'Example', project_map: { [project]: 'PROJECT' } }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 };
    const base = { erp_docstatus: 1, erp_modified: 'rev', supplier: 'SUP', supplier_name: 'Vendor', supplier_id: 'vendor-1', project_ids: [project], procurement_id: 'purchase-1', purchase_origin: 'captured', doc_date: null, currency: 'USD', net_total: '100.00', is_return: false, recorded_by_pmo: false };
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([binding])),
      supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret')),
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [
        { ...base, id: 'order-1', kind: 'order', erp_doctype: 'Purchase Order', erp_name: 'PO-1', erp_status: 'To Bill', purchase_orders: [] },
        { ...base, id: 'invoice-1', kind: 'supplier_invoice', erp_doctype: 'Purchase Invoice', erp_name: 'INV-1', erp_status: 'Unpaid', purchase_orders: ['PO-1'] },
      ], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [
        { id: 'gl-1', erp_modified: 'v1', company: 'Example', project_id: project, kind: 'supplier_invoice', voucher_type: 'Purchase Invoice', voucher_no: 'INV-1', debit: '100.00', credit: '0', document_id: 'invoice-1', journal_purchase_id: null, classification: 'mapped' },
        { id: 'gl-2', erp_modified: 'v2', company: 'Example', project_id: project, kind: 'journal', voucher_type: 'Journal Entry', voucher_no: 'JV-1', debit: '0', credit: '5.00', document_id: null, journal_purchase_id: null, classification: 'mapped' },
      ], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true, ledger_currency: 'IDR', ledger_started_at: '2026-11-13T00:00:00Z' })),
      supabaseRpc('purchase_capture_assignment_report', () => jsonResponse({ assignments: [] })),
      erp('8.8.8.8', '/api/resource/System%20Settings/System%20Settings', () => jsonResponse({ data: { currency_precision: '2', float_precision: '3', number_format: '#,###.##' } })),
    ], async ({ calls }) => {
      const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'report', scope: { projectId: project } }, token));
      const body = await response.json();
      assertEquals(body.complete, true);
      assertEquals(body.reports[0].ledgerMinor, '9500');
      assertEquals(body.reports[0].representedMinor, '10000');
      assertEquals(body.reports[0].remainderMinor, '-500');
      assertEquals(body.reports[0].remainder[0].source, 'JV-1');
      assertEquals(body.reports[0].remainder[0].kind, 'journal');
      assertEquals(body.reports[0].documentOnly.includes('order-1'), true);
      assertEquals(body.reports[0].itemCoverage.complete, false);
      assertEquals(calls.filter(call => call.url.hostname === '8.8.8.8').length, 2);
    });
  });

  it('AC-ROP-018 assignment bridge and excluded costs', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const project = '11111111-1111-4111-8111-111111111111';
    const binding = { id: 'binding-1', org_id: 'org-1', external_tier: 'erpnext', config: { company: 'Example', project_map: { [project]: 'PROJECT' } }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 };
    const base = { erp_docstatus: 1, erp_modified: 'rev', supplier: 'SUP', supplier_name: 'Vendor', supplier_id: 'vendor-1', project_ids: [project], procurement_id: 'purchase-1', purchase_origin: 'captured', doc_date: null, currency: 'USD', net_total: '100.00', is_return: false, recorded_by_pmo: false };
    const assignment = { decision_id: 'decision-1', source_id: 'invoice-9', source: 'INV-9', decision: 'project', project_id: project, procurement_id: 'purchase-9', assignment_origin: 'pmo_assignment', placed: '40.00',
      excluded: [{ account: 'Fixed Assets', amount: '25.00', kind: 'capital' }, { account: 'Misc', amount: '5.00', kind: 'unmapped_expense' }] };
    const routes = (assignments: () => Response) => [
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([binding])),
      supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret')),
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [{ ...base, id: 'invoice-1', kind: 'supplier_invoice', erp_doctype: 'Purchase Invoice', erp_name: 'INV-1', erp_status: 'Unpaid', purchase_orders: [] }], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [
        { id: 'gl-1', erp_modified: 'v1', company: 'Example', project_id: project, kind: 'supplier_invoice', voucher_type: 'Purchase Invoice', voucher_no: 'INV-1', debit: '100.00', credit: '0', document_id: 'invoice-1', journal_purchase_id: null, classification: 'mapped' },
      ], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true, ledger_currency: 'IDR', ledger_started_at: '2026-11-13T00:00:00Z' })),
      supabaseRpc('purchase_capture_assignment_report', assignments),
      erp('8.8.8.8', '/api/resource/System%20Settings/System%20Settings', () => jsonResponse({ data: { currency_precision: '2', float_precision: '3', number_format: '#,###.##' } })),
    ];
    await withFetchMock(routes(() => jsonResponse({ assignments: [assignment] })), async ({ calls }) => {
      const body = await (await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'report', scope: { projectId: project } }, token))).json();
      assertEquals(body.complete, true);
      assertEquals(body.assignments.length, 1);
      assertEquals(body.assignments[0].assignmentOrigin, 'pmo_assignment');
      assertEquals(body.assignments[0].source, 'INV-9');
      assertEquals(body.assignments[0].projectId, project);
      assertEquals(body.assignments[0].placedMinor, '4000');
      assertEquals(body.assignments[0].excluded.map((line: { account: string; amountMinor: string; kind: string }) => `${line.kind}:${line.account}:${line.amountMinor}`), ['capital:Fixed Assets:2500', 'unmapped_expense:Misc:500']);
      assertEquals(body.reports[0].ledgerMinor, '10000');
      assertEquals(body.reports[0].bridge, { erpTaggedMinor: '10000', pmoAssignedMinor: '4000', pmoReportMinor: '14000' });
      assertEquals(calls.filter(call => call.url.hostname === '8.8.8.8').length, 1);
    });
    await withFetchMock(routes(() => jsonResponse({ message: 'boom' }, { status: 500 })), async () => {
      const body = await (await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'report', scope: { projectId: project } }, token))).json();
      assertEquals(body.complete, false);
      assertEquals(body.missing.includes('assignment_read_failed'), true);
      assertEquals(body.assignments, undefined);
    });
  });

  it('AC-ROP-009 an invoice with an active decision is listed under it, not as unassigned', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const project = '11111111-1111-4111-8111-111111111111';
    const binding = { id: 'binding-1', org_id: 'org-1', external_tier: 'erpnext', config: { company: 'Example' }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 };
    const base = { erp_docstatus: 1, erp_modified: 'rev', supplier: 'SUP', supplier_name: 'Vendor', supplier_id: 'vendor-1', project_ids: [], procurement_id: null, purchase_origin: null, doc_date: null, currency: 'USD', net_total: '100.00', is_return: false, recorded_by_pmo: false };
    const placed = { decision_id: 'd1', source_id: 'invoice-9', source: 'INV-9', decision: 'project', project_id: project, procurement_id: 'purchase-9', assignment_origin: 'pmo_assignment', placed: '40.00', excluded: [] };
    const aside = { decision_id: 'd2', source_id: 'invoice-7', source: 'INV-7', decision: 'set_aside', project_id: null, procurement_id: null, assignment_origin: 'pmo_assignment', placed: '0', excluded: [] };
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([binding])),
      supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret')),
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: ['invoice-9', 'invoice-7', 'invoice-8'].map(id => ({ ...base, id, kind: 'supplier_invoice', erp_doctype: 'Purchase Invoice', erp_name: id.toUpperCase(), erp_status: 'Unpaid', purchase_orders: [] })), revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [
        { id: 'gl-9', erp_modified: 'v1', company: 'Example', project_id: null, kind: 'supplier_invoice', voucher_type: 'Purchase Invoice', voucher_no: 'INV-9', debit: '40.00', credit: '0', document_id: 'invoice-9', journal_purchase_id: null, classification: 'mapped' },
      ], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true, ledger_currency: 'USD', ledger_started_at: '2026-11-13T00:00:00Z' })),
      supabaseRpc('purchase_capture_assignment_report', () => jsonResponse({ assignments: [placed, aside] })),
      erp('8.8.8.8', '/api/resource/System%20Settings/System%20Settings', () => jsonResponse({ data: { currency_precision: '2', float_precision: '3', number_format: '#,###.##' } })),
    ], async () => {
      const body = await (await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'report', scope: { projectId: null } }, token))).json();
      assertEquals(body.unassigned_documents.map((doc: { id: string }) => doc.id), ['invoice-8']);
      assertEquals(body.unassigned.length, 0);
      assertEquals(body.assignments.map((row: { decision: string; projectId: string | null }) => `${row.decision}:${row.projectId}`), [`project:${project}`, 'set_aside:null']);
      assertEquals(body.reports.map((report: { scope: { projectId: string } }) => report.scope.projectId), [project]);
      assertEquals(body.reports[0].bridge.pmoAssignedMinor, '4000');
    });
  });

  it('AC-ROP-011 tagged assignment reported', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const project = '11111111-1111-4111-8111-111111111111';
    const binding = { id: 'binding-1', org_id: 'org-1', external_tier: 'erpnext', config: { company: 'Example', project_map: { [project]: 'PROJECT' } }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 };
    const base = { erp_docstatus: 1, erp_modified: 'rev', supplier: 'SUP', supplier_name: 'Vendor', supplier_id: 'vendor-1', project_ids: [project], procurement_id: 'purchase-1', purchase_origin: 'captured', doc_date: null, currency: 'USD', net_total: '100.00', is_return: false, recorded_by_pmo: false };
    const assignment = { decision_id: 'decision-1', source_id: 'invoice-9', source: 'INV-9', decision: 'project', project_id: project, procurement_id: 'purchase-9', assignment_origin: 'pmo_assignment', placed: '0',
      tagged_in_erp: true, erp_project_id: '44444444-4444-4444-8444-444444444444', erp_tag_unmapped: false, excluded: [] };
    const unmapped = { ...assignment, decision_id: 'decision-2', source: 'INV-10', erp_project_id: null, erp_tag_unmapped: true };
    const routes = (assignments: () => Response) => [
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([binding])),
      supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret')),
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [{ ...base, id: 'invoice-1', kind: 'supplier_invoice', erp_doctype: 'Purchase Invoice', erp_name: 'INV-1', erp_status: 'Unpaid', purchase_orders: [] }], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [
        { id: 'gl-1', erp_modified: 'v1', company: 'Example', project_id: project, kind: 'supplier_invoice', voucher_type: 'Purchase Invoice', voucher_no: 'INV-1', debit: '100.00', credit: '0', document_id: 'invoice-1', journal_purchase_id: null, classification: 'mapped' },
      ], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true, ledger_currency: 'IDR', ledger_started_at: '2026-11-13T00:00:00Z' })),
      supabaseRpc('purchase_capture_assignment_report', assignments),
      erp('8.8.8.8', '/api/resource/System%20Settings/System%20Settings', () => jsonResponse({ data: { currency_precision: '2', float_precision: '3', number_format: '#,###.##' } })),
    ];
    await withFetchMock(routes(() => jsonResponse({ assignments: [assignment, unmapped] })), async () => {
      const body = await (await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'report', scope: { projectId: project } }, token))).json();
      assertEquals(body.assignments[0].taggedInErp, true);
      assertEquals(body.assignments[0].erpProjectId, '44444444-4444-4444-8444-444444444444');
      assertEquals(body.assignments[0].erpTagUnmapped, false);
      assertEquals(body.assignments[1].taggedInErp, true);
      assertEquals(body.assignments[1].erpProjectId, null);
      assertEquals(body.assignments[1].erpTagUnmapped, true);
      assertEquals(body.assignments[0].placedMinor, '0');
      assertEquals(body.reports[0].bridge.pmoAssignedMinor, '0');
    });
  });

  it('AC-ROP-018 withholds a report when the generation changes after its pages', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const project = '11111111-1111-4111-8111-111111111111';
    const binding = { id: 'binding-1', org_id: 'org-1', external_tier: 'erpnext', config: { company: 'Example' }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 };
    let reads = 0;
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([binding])),
      supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret')),
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [], revision: ++reads === 1 ? 'gen' : 'changed', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true, ledger_currency: 'USD', ledger_started_at: '2026-11-13T00:00:00Z' })),
      supabaseRpc('purchase_capture_assignment_report', () => jsonResponse({ assignments: [] })),
    ], async () => {
      const result = await (await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'report', scope: { projectId: project } }, token))).json();
      assertEquals(result.complete, false);
      assertEquals(result.missing.includes('generation_changed'), true);
      assertEquals(result.reports[0].ledgerMinor, null);
    });
  });

  it('AC-ROP-012 applies server-derived groups through the service-only batch entry', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const project = '11111111-1111-4111-8111-111111111111';
    const request = '22222222-2222-4222-8222-222222222222';
    const binding = { id: 'binding-1', org_id: 'org-1', external_tier: 'erpnext', config: { company: 'Example', project_map: { [project]: 'PROJECT' } }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 };
    const batches: unknown[] = [];
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([binding])),
      supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret')),
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [{ id: 'order-1', kind: 'order', erp_doctype: 'Purchase Order', erp_name: 'PO-1', erp_docstatus: 1, erp_status: 'To Bill', erp_modified: 'rev', supplier: 'SUP', supplier_name: 'Vendor', supplier_id: 'vendor-1', project_ids: [project], purchase_orders: [], procurement_id: null, purchase_origin: null, doc_date: null, currency: 'USD', net_total: '100.00', is_return: false, recorded_by_pmo: false }], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true, ledger_currency: 'IDR', ledger_started_at: '2026-11-13T00:00:00Z' })),
      supabaseRpc('purchase_capture_assignment_report', () => jsonResponse({ assignments: [] })),
      supabaseRpc('capture_history_batch', call => { const args = call.bodyJson as Record<string, unknown>; if (args.p_groups === null) return jsonResponse({ complete: false, reason: 'batch_not_found' }); batches.push(args); return jsonResponse({ complete: true, resume: false, results: [{ outcome: 'create', source_ids: ['order-1'] }], erp_write: false }); }),
      erp('8.8.8.8', '/api/resource/System%20Settings/System%20Settings', () => jsonResponse({ data: { currency_precision: '2', float_precision: '3', number_format: '#,###.##' } })),
    ], async ({ calls }) => {
      const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'apply', scope: { projectId: project }, requestId: request, expectedRevision: 'gen', groups: [{ source_ids: ['forged'] }] }, token));
      const body = await response.json();
      assertEquals(response.status, 200);
      assertEquals(body.complete, true);
      assertEquals(batches, [{ p_actor_id: 'user-1', p_project_id: project, p_request_id: request, p_revision: 'gen', p_precision: { order: 2 }, p_groups: [{ project_id: project, source_ids: ['order-1'] }] }]);
      assertEquals(calls.filter(call => call.url.hostname === '8.8.8.8').length, 1);
      assertEquals(body.erp_write, false);
    });
  });

  for (const scenario of ['completed', 'partial', 'undone', 'changed'] as const) {
    it(`AC-ROP-008 external ${scenario} retry uses the server-bound batch identity`, async () => {
      const token = await auth.mintJwt({ sub: 'user-1' });
      const project = '11111111-1111-4111-8111-111111111111';
      const requestId = '22222222-2222-4222-8222-222222222222';
      const binding = { id: 'binding-1', org_id: 'org-1', external_tier: 'erpnext', config: { company: 'Example', project_map: { [project]: 'PROJECT' } }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 };
      const batches: Array<Record<string, unknown>> = [];
      await withFetchMock([
        jwksRoute(auth),
        supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
        supabaseSelect('external_org_bindings', () => jsonResponse([binding])),
        supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret')),
        supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [{ id: 'order-1', kind: 'order', erp_doctype: 'Purchase Order', erp_name: 'PO-1', erp_docstatus: 1, erp_status: 'To Bill', erp_modified: 'rev', supplier: 'SUP', supplier_name: 'Vendor', supplier_id: 'vendor-1', project_ids: [project], purchase_orders: [], procurement_id: 'purchase-1', purchase_origin: 'captured', doc_date: null, currency: 'USD', net_total: '100.00', is_return: false, recorded_by_pmo: false }], revision: 'new-generation', next_cursor: null })),
        supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [], revision: 'new-generation', next_cursor: null })),
        supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true, ledger_currency: 'USD' })),
        supabaseRpc('purchase_capture_assignment_report', () => jsonResponse({ assignments: [] })),
        supabaseRpc('capture_history_batch', call => {
          const args = call.bodyJson as Record<string, unknown>; batches.push(args);
          if (args.p_groups !== null) return jsonResponse({ complete: false, reason: 'request_conflict' });
          if (scenario === 'changed') return jsonResponse({ complete: false, reason: 'request_conflict' });
          if (scenario === 'undone') return jsonResponse({ complete: false, reason: 'batch_contains_undone_capture' });
          if (scenario === 'partial' && batches.length === 1) return jsonResponse({ complete: false, resume: true });
          return jsonResponse({ complete: true, resume: false, results: [] });
        }),
        erp('8.8.8.8', '/api/resource/System%20Settings/System%20Settings', () => jsonResponse({ data: { currency_precision: '2', float_precision: '3', number_format: '#,###.##' } })),
      ], async () => {
        const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'apply', scope: { projectId: project }, requestId, expectedRevision: scenario === 'changed' ? 'different-review' : 'reviewed' }, token));
        const result = await response.json();
        assertEquals(result.reason ?? null, scenario === 'undone' ? 'batch_contains_undone_capture' : scenario === 'changed' ? 'request_conflict' : null);
        assertEquals(result.complete, scenario === 'completed' || scenario === 'partial');
        assertEquals(batches.length, scenario === 'partial' ? 2 : 1);
        assertEquals(batches.every(args => args.p_groups === null), true);
        assertEquals(batches[0].p_revision, scenario === 'changed' ? 'different-review' : 'reviewed');
      });
    });
  }

  it('AC-ROP-018 reports a linked journal even when no purchase documents exist', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const project = '11111111-1111-4111-8111-111111111111';
    const binding = { id: 'binding-1', org_id: 'org-1', external_tier: 'erpnext', config: { company: 'Example', project_map: { [project]: 'PROJECT' } }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 };
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([binding])),
      supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret')),
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [{ id: 'gl-1', erp_modified: 'v1', company: 'Example', project_id: project, kind: 'journal', voucher_type: 'Journal Entry', voucher_no: 'JV-1', debit: '5.00', credit: '0', document_id: null, journal_purchase_id: 'purchase-1', classification: 'mapped' }], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true, ledger_currency: 'IDR', ledger_started_at: '2026-11-13T00:00:00Z' })),
      supabaseRpc('purchase_capture_assignment_report', () => jsonResponse({ assignments: [] })),
      erp('8.8.8.8', '/api/resource/System%20Settings/System%20Settings', () => jsonResponse({ data: { currency_precision: '2', float_precision: '3', number_format: '#,###.##' } })),
    ], async () => {
      const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'report', scope: { projectId: project } }, token));
      const body = await response.json();
      assertEquals(body.complete, true);
      assertEquals(body.reports[0].ledgerMinor, '500');
      assertEquals(body.reports[0].representedMinor, '500');
      assertEquals(body.reports[0].remainderMinor, '0');
    });
  });

  it('AC-ROP-023 reports missing item capability for a journal-only project', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const project = '11111111-1111-4111-8111-111111111111';
    const binding = { id: 'binding-1', org_id: 'org-1', external_tier: 'erpnext', config: { company: 'Example', project_map: { [project]: 'PROJECT' } }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 };
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([binding])),
      supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret')),
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [{ id: 'gl-1', erp_modified: 'v1', company: 'Example', project_id: project, kind: 'journal', voucher_type: 'Journal Entry', voucher_no: 'JV-1', debit: '5.00', credit: '0', document_id: null, journal_purchase_id: null, classification: 'mapped' }], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true, ledger_currency: 'IDR', ledger_started_at: '2026-11-13T00:00:00Z' })),
      supabaseRpc('purchase_capture_assignment_report', () => jsonResponse({ assignments: [] })),
      erp('8.8.8.8', '/api/resource/System%20Settings/System%20Settings', () => jsonResponse({ data: { currency_precision: '2', float_precision: '3', number_format: '#,###.##' } })),
    ], async () => {
      const response = await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'report', scope: { projectId: project } }, token));
      const body = await response.json();
      assertEquals(body.complete, true);
      assertEquals(body.reports[0].ledgerMinor, '500');
      assertEquals(body.reports[0].representedMinor, '0');
      assertEquals(body.reports[0].remainderMinor, '500');
      assertEquals(body.reports[0].itemCoverage.complete, false);
      assertEquals(body.reports[0].itemCoverage.missing.includes('line_evidence'), true);
    });
  });

  it('AC-ROP-011 preview, report and apply expose held scope while another supplier proceeds', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const project = '11111111-1111-4111-8111-111111111111';
    const requestId = '22222222-2222-4222-8222-222222222222';
    const purchase = '33333333-3333-4333-8333-333333333333';
    const command = `node scripts/pmo.mjs purchases undo-record-only ${purchase} --reason "Incorrect link"`;
    const hold = { supplier_id: 'vendor-1', project_id: project, currency: 'USD', purchase_id: purchase, undo_command: command };
    const binding = { id: 'binding-1', org_id: 'org-1', external_tier: 'erpnext', config: { company: 'Example', project_map: { [project]: 'PROJECT' } }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 };
    const base = { kind: 'order', erp_doctype: 'Purchase Order', erp_docstatus: 1, erp_status: 'To Bill', erp_modified: 'rev', supplier_name: 'Vendor', project_ids: [project], purchase_orders: [], procurement_id: null, purchase_origin: null, doc_date: null, currency: 'USD', net_total: '125.00', is_return: false, recorded_by_pmo: false };
    const batches: Array<Record<string, unknown>> = [];
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([binding])),
      supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret')),
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [
        { ...base, id: 'copy', erp_name: 'COPY', supplier: 'SUP-1', supplier_id: 'vendor-1', needs_undo: [hold] },
        { ...base, id: 'other', erp_name: 'OTHER', supplier: 'SUP-2', supplier_id: 'vendor-2', needs_undo: [] },
      ], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true, ledger_currency: 'USD', ledger_started_at: '2026-11-13T00:00:00Z' })),
      supabaseRpc('purchase_capture_assignment_report', () => jsonResponse({ assignments: [] })),
      supabaseRpc('capture_history_batch', call => { const args = call.bodyJson as Record<string, unknown>; batches.push(args); return args.p_groups === null ? jsonResponse({ complete: false, reason: 'batch_not_found' }) : jsonResponse({ complete: true, results: [{ outcome: 'create' }] }); }),
      erp('8.8.8.8', '/api/resource/System%20Settings/System%20Settings', () => jsonResponse({ data: { currency_precision: '2', float_precision: '3', number_format: '#,###.##' } })),
    ], async () => {
      const expected = { supplierId: 'vendor-1', projectId: project, currency: 'USD', purchaseId: purchase, undoCommand: command };
      const preview = await (await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'preview', scope: { projectId: project } }, token))).json();
      assertEquals(preview.proposals.find((p: { id: string }) => p.id === 'copy').reason, 'needs_undo');
      assertEquals(preview.proposals.find((p: { id: string }) => p.id === 'copy').needsUndo, [expected]);
      const report = await (await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'report', scope: { projectId: project } }, token))).json();
      assertEquals(report.reports[0].needsUndo, [{ sourceId: 'copy', ...expected }]);
      await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'apply', scope: { projectId: project }, requestId, expectedRevision: 'gen' }, token));
      assertEquals(batches.at(-1)?.p_groups, [{ project_id: project, source_ids: ['other'] }]);
    });
  });

  it('AC-ROP-017 refuses a source census beyond twenty pages with project guidance', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const seen: Array<string | null> = [];
    const binding = { id: 'binding-1', org_id: 'org-1', external_tier: 'erpnext', config: { company: 'Example' }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 };
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([binding])),
      supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret')),
      supabaseRpc('purchase_capture_source_page', call => {
        const cursor = (call.bodyJson as { p_cursor: string | null }).p_cursor;
        seen.push(cursor);
        const page = cursor === null ? 0 : Number(cursor);
        const sources = Array.from({ length: 500 }, (_, i) => ({ id: `payment-${page * 500 + i}`, kind: 'supplier_payment', erp_doctype: 'Payment Entry', erp_name: `PAY-${page * 500 + i}`, erp_docstatus: 1, erp_status: 'Paid', erp_modified: 'rev', project_ids: [], purchase_orders: [], supplier_id: null, procurement_id: null, purchase_origin: null, recorded_by_pmo: false, doc_date: null, currency: null, net_total: null, is_return: false }));
        return jsonResponse({ sources, revision: 'gen', next_cursor: page < 20 ? String(page + 1) : null });
      }),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true, ledger_currency: 'USD', ledger_started_at: '2026-11-13T00:00:00Z' })),
      supabaseRpc('purchase_capture_assignment_report', () => jsonResponse({ assignments: [] })),
    ], async ({ calls }) => {
      const first = await (await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'preview', scope: { projectId: null } }, token))).json();
      assertEquals(first.complete, false);
      assertEquals(first.missing.includes('source_limit_exceeded'), true);
      assertEquals(first.proposals, []);
      assertEquals(first.guidance, 'run_per_project');
      assertEquals(seen.length, 20);
      const apply = await (await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'apply', scope: { projectId: null }, expectedRevision: 'reviewed', requestId: '22222222-2222-4222-8222-222222222222' }, token))).json();
      assertEquals(apply.complete, false);
      assertEquals(apply.proposals, []);
      assertEquals(apply.request_id, '22222222-2222-4222-8222-222222222222');
      assertEquals(apply.revision, 'reviewed');
      assertEquals(calls.some(call => call.url.pathname.endsWith('/capture_history_batch')), false);
    });
  });

  it('AC-ROP-017 refuses an oversized scoped ledger without an apply', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const project = '11111111-1111-4111-8111-111111111111';
    const binding = { id: 'binding-1', org_id: 'org-1', external_tier: 'erpnext', config: { company: 'Example' }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 };
    let pages = 0;
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([binding])),
      supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret')),
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', call => {
        const request = call.bodyJson as { p_cursor: string | null; p_project_id: string };
        assertEquals(request.p_project_id, project);
        const page = request.p_cursor === null ? 0 : Number(request.p_cursor);
        pages++;
        return jsonResponse({ lines: Array.from({ length: 500 }, (_, i) => ({ id: `line-${page * 500 + i}` })), revision: 'gen', next_cursor: String(page + 1) });
      }),
    ], async ({ calls }) => {
      const result = await (await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'apply', scope: { projectId: project }, expectedRevision: 'gen', requestId: '22222222-2222-4222-8222-222222222222' }, token))).json();
      assertEquals(pages, 20);
      assertEquals(result.complete, false);
      assertEquals(result.missing, ['ledger_limit_exceeded']);
      assertEquals(result.guidance, 'scope_still_exceeds_limit');
      assertEquals(result.proposals, []);
      assertEquals(calls.some(call => call.url.pathname.endsWith('/capture_history_batch')), false);
    });
  });

  it('AC-ROP-017 accepts a complete final page at the 10000-source bound', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const project = '11111111-1111-4111-8111-111111111111';
    const binding = { id: 'binding-1', org_id: 'org-1', external_tier: 'erpnext', config: { company: 'Example' }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 };
    let pages = 0;
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([binding])),
      supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret')),
      supabaseRpc('purchase_capture_source_page', call => {
        const request = call.bodyJson as { p_cursor: string | null; p_limit: number };
        if (request.p_limit === 1) return jsonResponse({ sources: [], revision: 'gen', next_cursor: null });
        const page = request.p_cursor === null ? 0 : Number(request.p_cursor);
        pages++;
        const sources = Array.from({ length: 500 }, (_, i) => ({ id: `order-${page * 500 + i}`, kind: 'order', erp_doctype: 'Purchase Order', erp_name: `PO-${page * 500 + i}`, erp_docstatus: 1, erp_status: 'To Bill', erp_modified: 'rev', supplier: 'SUP', supplier_name: 'Vendor', supplier_id: 'vendor', project_ids: [project], purchase_orders: [], procurement_id: null, purchase_origin: null, recorded_by_pmo: false, doc_date: null, currency: 'USD', net_total: '1', is_return: false }));
        return jsonResponse({ sources, revision: 'gen', next_cursor: page < 19 ? String(page + 1) : null });
      }),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true, ledger_currency: 'USD', ledger_started_at: '2026-11-13T00:00:00Z' })),
      supabaseRpc('purchase_capture_assignment_report', () => jsonResponse({ assignments: [] })),
      erp('8.8.8.8', '/api/resource/System%20Settings/System%20Settings', () => jsonResponse({ data: { currency_precision: '2' } })),
    ], async () => {
      const result = await (await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'preview', scope: { projectId: project } }, token))).json();
      assertEquals(pages, 20);
      assertEquals(result.complete, true);
      assertEquals(result.proposals.length, 10000);
    });
  });

  it('AC-ROP-010 reads precision once per kind and afresh for apply with 500 documents', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const project = '11111111-1111-4111-8111-111111111111';
    const requestId = '22222222-2222-4222-8222-222222222222';
    const binding = { id: 'binding-1', org_id: 'org-1', external_tier: 'erpnext', config: { company: 'Example' }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 };
    const sources = Array.from({ length: 500 }, (_, i) => ({ id: `order-${i}`, kind: 'order', erp_doctype: 'Purchase Order', erp_name: `PO-${i}`, erp_docstatus: 1, erp_status: 'To Bill', erp_modified: 'rev', supplier: 'SUP', supplier_name: 'Vendor', supplier_id: 'vendor-1', project_ids: [project], purchase_orders: [], procurement_id: null, purchase_origin: null, recorded_by_pmo: false, doc_date: null, currency: 'USD', net_total: '100.00', is_return: false }));
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([binding])),
      supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret')),
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources, revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true, ledger_currency: 'USD', ledger_started_at: '2026-11-13T00:00:00Z' })),
      supabaseRpc('purchase_capture_assignment_report', () => jsonResponse({ assignments: [] })),
      supabaseRpc('capture_history_batch', () => jsonResponse({ complete: true, resume: false, results: [] })),
      erp('8.8.8.8', '/api/resource/System%20Settings/System%20Settings', () => jsonResponse({ data: { currency_precision: '2' } })),
    ], async ({ calls }) => {
      const preview = await (await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'preview', scope: { projectId: project } }, token))).json();
      assertEquals(preview.complete, true);
      assertEquals(calls.filter(call => call.url.hostname === '8.8.8.8').length, 1);
      const apply = await (await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'apply', scope: { projectId: project }, expectedRevision: 'gen', requestId }, token))).json();
      assertEquals(apply.complete, true);
      assertEquals(calls.filter(call => call.url.hostname === '8.8.8.8').length, 2);
    });
  });

  // A preview over the whole organization: one placed order and invoice, plus whatever ledger lines the case adds.
  const previewAll = async (health: Record<string, unknown>, extraLines: Array<Record<string, unknown>> = []) => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const project = '11111111-1111-4111-8111-111111111111';
    const binding = { id: 'binding-1', org_id: 'org-1', external_tier: 'erpnext', config: { company: 'Example', project_map: { [project]: 'PROJECT' } }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 };
    const base = { erp_docstatus: 1, erp_modified: 'rev', supplier: 'SUP', supplier_name: 'Vendor', supplier_id: 'vendor-1', project_ids: [project], procurement_id: 'purchase-1', purchase_origin: 'captured', doc_date: null, currency: 'USD', net_total: '100.00', is_return: false, recorded_by_pmo: false };
    const line = { erp_modified: 'v', company: 'Example', project_id: null, voucher_type: 'Journal Entry', voucher_no: 'X', debit: '0', credit: '0', document_id: null, journal_purchase_id: null, classification: 'unmapped' };
    let body: Record<string, any> = {};
    await withFetchMock([
      jwksRoute(auth),
      supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('external_org_bindings', () => jsonResponse([binding])),
      supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret')),
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [
        { ...base, id: 'order-1', kind: 'order', erp_doctype: 'Purchase Order', erp_name: 'PO-1', erp_status: 'To Bill', purchase_orders: [] },
        { ...base, id: 'invoice-1', kind: 'supplier_invoice', erp_doctype: 'Purchase Invoice', erp_name: 'INV-1', erp_status: 'Unpaid', purchase_orders: ['PO-1'] },
      ], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [
        { ...line, id: 'gl-1', project_id: project, kind: 'supplier_invoice', voucher_type: 'Purchase Invoice', voucher_no: 'INV-1', debit: '100.00', document_id: 'invoice-1', classification: 'mapped' },
        ...extraLines.map((extra, i) => ({ ...line, id: `gl-extra-${i}`, ...extra })),
      ], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_assignment_report', () => jsonResponse({ assignments: [] })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse(health)),
      erp('8.8.8.8', '/api/resource/System%20Settings/System%20Settings', () => jsonResponse({ data: { currency_precision: '2', float_precision: '3', number_format: '#,###.##' } })),
    ], async () => {
      body = await (await handlePurchaseCaptureRequest(createAuthedRequest('http://edge.test/purchase-capture', { action: 'preview', scope: { projectId: null } }, token))).json();
    });
    return body;
  };
  const healthy = { caught_up: true, ledger_currency: 'USD', ledger_started_at: '2026-11-13T00:00:00Z' };

  it('AC-ROP-072 says a feed run in progress is running and tells the operator to retry', async () => {
    const body = await previewAll({ caught_up: false, feed_state: 'running', reason: 'feed_not_current', ledger_currency: 'USD' });
    assertEquals(body.complete, false);
    assertEquals(body.missing.includes('feed_not_current'), true);
    assertEquals(body.feed, { state: 'running', last_synced_at: null, guidance: 'sync_running_retry_in_minutes' });
  });
  it('AC-ROP-072 names the last sync time and the stopped-sync guidance for a stale feed', async () => {
    const body = await previewAll({ caught_up: false, feed_state: 'stale', reason: 'feed_not_current', ledger_currency: 'USD', purchases_started_at: '2026-11-15T01:00:00Z', ledger_started_at: '2026-11-15T01:05:00Z' });
    assertEquals(body.missing.includes('feed_not_current'), true);
    assertEquals(body.feed, { state: 'stale', last_synced_at: '2026-11-15T01:00:00Z', guidance: 'erpnext_sync_stopped_check_integrations' });
  });
  it('AC-ROP-072 says a feed that never ran has never synced', async () => {
    const body = await previewAll({ caught_up: false, feed_state: 'never', reason: 'feed_not_current' });
    assertEquals(body.feed, { state: 'never', last_synced_at: null, guidance: 'erpnext_sync_stopped_check_integrations' });
  });
  it('AC-ROP-072 reports a currency mismatch as missing, not as an unknown currency', async () => {
    const body = await previewAll({ caught_up: true, feed_state: 'current', reason: 'ledger_currency_mismatch', ledger_currency: null });
    assertEquals(body.complete, false);
    assertEquals(body.missing.includes('ledger_currency_mismatch'), true);
    assertEquals(body.missing.includes('ledger_currency_unknown'), false);
    assertEquals(body.feed, undefined);
  });
  it('AC-ROP-072 reports a currency mismatch on a stale feed as a mismatch, not as an unknown currency', async () => {
    const body = await previewAll({ caught_up: false, feed_state: 'stale', reason: 'feed_not_current', ledger_currency: null, ledger_currency_mismatch: true,
      purchases_started_at: '2026-11-15T01:00:00Z', ledger_started_at: '2026-11-15T01:05:00Z' });
    assertEquals(body.missing.includes('feed_not_current'), true);
    assertEquals(body.missing.includes('ledger_currency_mismatch'), true);
    assertEquals(body.missing.includes('ledger_currency_unknown'), false);
  });
  it('AC-ROP-072 still reports an unknown currency on a current feed', async () => {
    const body = await previewAll({ caught_up: true, feed_state: 'current', ledger_currency: null });
    assertEquals(body.missing.includes('ledger_currency_unknown'), true);
  });

  it('AC-ROP-073 lists journal and payment lines without a project as information and stays complete', async () => {
    const body = await previewAll(healthy, [
      { kind: 'journal', debit: '5.00', credit: '0' }, { kind: 'journal', debit: '0', credit: '2.50' },
      { kind: 'supplier_payment', voucher_type: 'Payment Entry', debit: '0', credit: '40.00' }, { kind: 'other', voucher_type: 'Sales Invoice', debit: '7.00', credit: '0' }, { kind: null, debit: '1.00', credit: '0' },
    ]);
    assertEquals(body.complete, true);
    assertEquals(body.unassigned, []);
    assertEquals(body.other_unassigned, [
      { kind: 'journal', count: 2, total: '2.50' }, { kind: 'other', count: 2, total: '8.00' }, { kind: 'supplier_payment', count: 1, total: '-40.00' },
    ]);
  });
  it('AC-ROP-073 a ledger line with no debit or credit makes its kind total unknown instead of failing the preview', async () => {
    const body = await previewAll(healthy, [{ kind: 'journal', debit: '5.00', credit: '0' }, { kind: 'journal', debit: null, credit: null }, { kind: 'other', voucher_type: 'Bank Entry', debit: '1.00', credit: '0' }]);
    assertEquals(body.complete, true);
    assertEquals(body.other_unassigned, [{ kind: 'journal', count: 2, total: null }, { kind: 'other', count: 1, total: '1.00' }]);
  });
  it('AC-ROP-073 blocks on a purchase invoice line without a project', async () => {
    const body = await previewAll(healthy, [{ kind: 'journal', debit: '5.00' }, { kind: 'supplier_invoice', voucher_type: 'Purchase Invoice', voucher_no: 'INV-9', debit: '3.00' }]);
    assertEquals(body.complete, false);
    assertEquals(body.unassigned, [{ id: 'gl-extra-1', kind: 'supplier_invoice', source: 'INV-9', reason: 'project_unmapped' }]);
    assertEquals(body.other_unassigned, [{ kind: 'journal', count: 1, total: '5.00' }]);
  });
  it('AC-ROP-073 blocks on a line of another company whatever its kind', async () => {
    const body = await previewAll(healthy, [{ kind: 'journal', company: 'Other', debit: '5.00' }, { kind: 'supplier_payment', voucher_type: 'Payment Entry', company: 'Other', debit: '1.00' }]);
    assertEquals(body.complete, false);
    assertEquals(body.unassigned.map((item: { reason: string }) => item.reason), ['company_scope_mismatch', 'company_scope_mismatch']);
    assertEquals(body.other_unassigned, []);
  });
});
