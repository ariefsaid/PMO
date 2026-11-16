/**
 * billOrderLinkFixture.ts — the Supabase-side route table shared by `billOrderLink.served.test.ts` (ERP mocked) and
 * `billOrderLink.bed.test.ts` (ERP real): the facts the shipped `adapter-dispatch` handler reads around a vendor bill on
 * a purchase whose one ERP order was linked from the ERP. A TEST FIXTURE (routes + seed data), never handler logic.
 */
import { jsonResponse, supabaseRpc, supabaseSelect, type FetchCall, type MockRoute } from '../_shared/testing/edgeTestKit.ts';
import { COMPANY, SECRET_REF } from './bfyServedFixture.ts';

export const ORG_ID = '11111111-1111-4111-8111-111111111111';
export const USER_ID = '22222222-2222-4222-8222-222222222222';
export const PROC_ID = '33333333-3333-4333-8333-333333333333';
export const VENDOR_ID = '44444444-4444-4444-8444-444444444444';
export const PI_ID = '55555555-5555-4555-8555-555555555555';
export function objectResponse(body: unknown): Response {
  return jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
}
export function nullObjectResponse(): Response {
  return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
}
export function eqParam(call: FetchCall, key: string): string | null {
  const raw = call.url.searchParams.get(key);
  return raw?.startsWith('eq.') ? decodeURIComponent(raw.slice(3)) : raw;
}

/** Every non-ERP read the handler makes for a bill on the purchase's linked order `po` (`null`: a purchase with no ERP order). `site` is the ERP site URL the binding holds. */
export function supabaseBillRoutes(opts: { po: string | null; site: string; version: number; supplier?: string; company?: string }): MockRoute[] {
  const outbox = new Map<string, Record<string, unknown>>();
  return [
    supabaseSelect('profiles', (call) =>
      call.url.searchParams.has('role') ? jsonResponse([{ id: USER_ID }]) : objectResponse({ org_id: ORG_ID })),
    supabaseRpc('domain_owned_by_tier', () => jsonResponse(true)),
    supabaseRpc('org_has_active_erpnext_binding', () => jsonResponse(true)),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Finance', active: true })),
    supabaseRpc('pre_cutover_procurement', () => jsonResponse(false)),
    supabaseRpc('linked_step_state', () => jsonResponse('new_step')),
    supabaseRpc('record_only_step_refusal', () => jsonResponse(null)),
    supabaseRpc('procurement_gate_violation', () => jsonResponse(null)),
    supabaseRpc('read_vault_secret', () => jsonResponse(null)),
    supabaseSelect('external_org_bindings', () => objectResponse({
      site_url: opts.site, secret_ref: SECRET_REF, activated_at: '2026-01-01T00:00:00+00:00', version_major: opts.version,
      config: { company: opts.company ?? COMPANY },
    })),
    supabaseSelect('organizations', () => objectResponse({ input_vat_account: null, pph23_payable_account: null, pph4_2_payable_account: null })),
    supabaseSelect('procurements', () => objectResponse({ id: PROC_ID, org_id: ORG_ID, vendor_id: VENDOR_ID, project_id: null })),
    supabaseSelect('companies', () => objectResponse({ id: VENDOR_ID, org_id: ORG_ID })),
    supabaseSelect('external_refs', (call) =>
      eqParam(call, 'pmo_record_id') === VENDOR_ID
        ? objectResponse({ external_record_id: `Supplier:${opts.supplier ?? 'Demo Supplier'}` })
        : nullObjectResponse()),
    supabaseSelect('procurement_items', () => jsonResponse([])),
    // The purchase's one ERP order is a linked one (captured from the ERP), not one PMO pushed.
    supabaseSelect('purchase_orders', () => jsonResponse([])),
    supabaseSelect('procurement_erp_links', () => jsonResponse(opts.po ? [{ erp_purchase_documents: { erp_name: opts.po, erp_doctype: 'Purchase Order' } }] : [])),
    {
      label: 'outbox read', method: 'GET', pathname: '/rest/v1/external_command_outbox',
      response: (call) => {
        const row = outbox.get(`${eqParam(call, 'pmo_record_id')}|${eqParam(call, 'idempotency_key')}`);
        return row ? objectResponse(row) : nullObjectResponse();
      },
    },
    {
      label: 'outbox insert', method: 'POST', pathname: '/rest/v1/external_command_outbox',
      response: (call) => {
        const body = call.bodyJson as Record<string, unknown>;
        const row = { id: 'outbox-1', domain: body.domain, pmo_record_id: body.pmo_record_id,
          idempotency_key: body.idempotency_key, state: 'pending', external_record_id: null, canonical: null,
          claim_generation: 0, payload_digest: body.payload_digest ?? null, payload: body.payload ?? null };
        outbox.set(`${String(body.pmo_record_id)}|${String(body.idempotency_key)}`, row);
        return objectResponse(row);
      },
    },
    { label: 'outbox update', method: 'PATCH', pathname: '/rest/v1/external_command_outbox',
      response: () => jsonResponse([{ id: 'outbox-1' }]) },
    supabaseRpc('claim_outbox_for_commit', () => {
      const row = [...outbox.values()][0];
      return jsonResponse(row ? { ...row, state: 'committing', claim_generation: 1 } : null);
    }),
    supabaseRpc('record_outbox_ref', () => jsonResponse(1)),
    supabaseRpc('confirm_outbox', () => jsonResponse(1)),
    supabaseRpc('surface_action_required', () => jsonResponse(null)),
    { label: 'procurement_invoices mirror', pathname: '/rest/v1/procurement_invoices', response: () => jsonResponse([]) },
    { label: 'notifications', pathname: '/rest/v1/notifications', response: () => jsonResponse([]) },
  ];
}
