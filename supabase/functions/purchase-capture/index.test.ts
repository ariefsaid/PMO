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
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [{ id: 'order-1', erp_doctype: 'Purchase Order', erp_name: 'PO-1', erp_docstatus: 1, erp_status: 'To Bill', erp_modified: 'rev', supplier: 'SUP', supplier_name: 'Vendor', supplier_id: 'vendor-1', project_ids: [project], purchase_orders: [], procurement_id: null, purchase_origin: null, doc_date: null, currency: 'USD', net_total: '100.00', is_return: false, recorded_by_pmo: false }, { id: 'order-2', erp_doctype: 'Purchase Order', erp_name: 'PO-2', erp_docstatus: 1, erp_status: 'To Bill', erp_modified: 'rev', supplier: 'SUP', supplier_name: 'Vendor', supplier_id: 'vendor-1', project_ids: [project], purchase_orders: [], procurement_id: null, purchase_origin: null, recorded_by_pmo: true, doc_date: null, currency: 'USD', net_total: '10.00', is_return: false }, { id: 'payment-1', erp_doctype: 'Payment Entry', erp_name: 'PAY-1', erp_docstatus: 1, erp_status: 'Paid', erp_modified: 'rev', supplier: 'SUP', supplier_name: 'Vendor', supplier_id: 'vendor-1', project_ids: [], purchase_orders: [], procurement_id: null, purchase_origin: null, recorded_by_pmo: false, doc_date: null, currency: null, net_total: null, is_return: false }], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true, ledger_currency: 'IDR', ledger_started_at: '2026-11-13T00:00:00Z' })),
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
      assertEquals(calls.filter(call => call.url.hostname === '8.8.8.8').length, 1);
      assertEquals(calls.some(call => call.url.pathname.endsWith('/capture_history_apply')), false);
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
        { ...base, id: 'order-1', erp_doctype: 'Purchase Order', erp_name: 'PO-1', erp_status: 'To Bill', purchase_orders: [] },
        { ...base, id: 'invoice-1', erp_doctype: 'Purchase Invoice', erp_name: 'INV-1', erp_status: 'Unpaid', purchase_orders: ['PO-1'] },
      ], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [
        { id: 'gl-1', erp_modified: 'v1', company: 'Example', project_id: project, voucher_type: 'Purchase Invoice', voucher_no: 'INV-1', debit: '100.00', credit: '0', document_id: 'invoice-1', journal_purchase_id: null, classification: 'mapped' },
        { id: 'gl-2', erp_modified: 'v2', company: 'Example', project_id: project, voucher_type: 'Journal Entry', voucher_no: 'JV-1', debit: '0', credit: '5.00', document_id: null, journal_purchase_id: null, classification: 'mapped' },
      ], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true, ledger_currency: 'IDR', ledger_started_at: '2026-11-13T00:00:00Z' })),
      erp('8.8.8.8', '/api/resource/System%20Settings/System%20Settings', () => jsonResponse({ data: { currency_precision: '2', float_precision: '3', number_format: '#,###.##' } })),
    ], async () => {
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
      supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [{ id: 'order-1', erp_doctype: 'Purchase Order', erp_name: 'PO-1', erp_docstatus: 1, erp_status: 'To Bill', erp_modified: 'rev', supplier: 'SUP', supplier_name: 'Vendor', supplier_id: 'vendor-1', project_ids: [project], purchase_orders: [], procurement_id: null, purchase_origin: null, doc_date: null, currency: 'USD', net_total: '100.00', is_return: false, recorded_by_pmo: false }], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true, ledger_currency: 'IDR', ledger_started_at: '2026-11-13T00:00:00Z' })),
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
        supabaseRpc('purchase_capture_source_page', () => jsonResponse({ sources: [{ id: 'order-1', erp_doctype: 'Purchase Order', erp_name: 'PO-1', erp_docstatus: 1, erp_status: 'To Bill', erp_modified: 'rev', supplier: 'SUP', supplier_name: 'Vendor', supplier_id: 'vendor-1', project_ids: [project], purchase_orders: [], procurement_id: 'purchase-1', purchase_origin: 'captured', doc_date: null, currency: 'USD', net_total: '100.00', is_return: false, recorded_by_pmo: false }], revision: 'new-generation', next_cursor: null })),
        supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [], revision: 'new-generation', next_cursor: null })),
        supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true, ledger_currency: 'USD' })),
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
      supabaseRpc('purchase_capture_ledger_page', () => jsonResponse({ lines: [{ id: 'gl-1', erp_modified: 'v1', company: 'Example', project_id: project, voucher_type: 'Journal Entry', voucher_no: 'JV-1', debit: '5.00', credit: '0', document_id: null, journal_purchase_id: 'purchase-1', classification: 'mapped' }], revision: 'gen', next_cursor: null })),
      supabaseRpc('purchase_capture_feed_health', () => jsonResponse({ caught_up: true, ledger_currency: 'IDR', ledger_started_at: '2026-11-13T00:00:00Z' })),
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

  it('AC-ROP-011 preview, report and apply expose held scope while another supplier proceeds', async () => {
    const token = await auth.mintJwt({ sub: 'user-1' });
    const project = '11111111-1111-4111-8111-111111111111';
    const requestId = '22222222-2222-4222-8222-222222222222';
    const purchase = '33333333-3333-4333-8333-333333333333';
    const command = `node scripts/pmo.mjs purchases undo-record-only ${purchase} --reason "Incorrect link"`;
    const hold = { supplier_id: 'vendor-1', project_id: project, currency: 'USD', purchase_id: purchase, undo_command: command };
    const binding = { id: 'binding-1', org_id: 'org-1', external_tier: 'erpnext', config: { company: 'Example', project_map: { [project]: 'PROJECT' } }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic', status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 };
    const base = { erp_doctype: 'Purchase Order', erp_docstatus: 1, erp_status: 'To Bill', erp_modified: 'rev', supplier_name: 'Vendor', project_ids: [project], purchase_orders: [], procurement_id: null, purchase_origin: null, doc_date: null, currency: 'USD', net_total: '125.00', is_return: false, recorded_by_pmo: false };
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

});
