// Luna money audit — BLOCK 2: server-side Sales-Invoice submit SoD gate, enforced in the dispatch
// path so the bypass a direct dispatchDomainCommand('revenue','transition',{erp_doc_kind:'sales-invoice',
// verb:'submit'}) caller could otherwise skip is closed regardless of which client dispatched.
//
// `submitInvoice()` in the repository already calls the SoD RPC for the legitimate FE path, but a
// caller POSTing the dispatch command directly skips the repo. The edge function MUST therefore
// invoke `submit_sales_invoice(p_si_id)` (the SECURITY DEFINER RPC) under the CALLER's JWT (the
// deputy client, NOT service_role) before the adapter commits the ERP submit. If the RPC raises
// 42501 (self-approval / not-authorized), the dispatch returns 403/409 and does NOT submit to ERP.
//
// Extracted as a pure/testable module because index.ts is integration-only (Deno.serve at module
// top level) — the decision + the RPC seam are unit-provable here (sodGuard.test.ts).
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

/** The PMO revenue domain the ERPNext tier owns (mirrors erpnext/adapter.ts's ERPNEXT_REVENUE_DOMAIN
 *  — duplicated as a string literal so this guard stays dependency-free and Deno-importable in isolation). */
const REVENUE_DOMAIN = 'revenue';

/** Does this command require the server-side SI-submit SoD gate (Luna BLOCK 2)?
 *  True ONLY for a revenue sales-invoice SUBMIT transition — the money-commitment step where
 *  approver≠author must be enforced regardless of the dispatching client. Cancel/amend, other kinds,
 *  non-transition operations, and other domains are not self-approval concerns (and a transition
 *  carrying no `verb` is rejected by the adapter before any ERP submit — never a silent submit). */
export function isRevenueSiSubmitTransition(command: AdapterCommand): boolean {
  if (command.domain !== REVENUE_DOMAIN) return false;
  if ((command.operation as string) !== 'transition') return false;
  const rec = command.record as { erp_doc_kind?: unknown; verb?: unknown };
  return rec.erp_doc_kind === 'sales-invoice' && rec.verb === 'submit';
}

/** Structural seam for the SECURITY DEFINER RPC invocation under the caller's JWT (the deputy client,
 *  never service_role — auth.uid()/auth_org_id() must resolve to the real submitter). */
export interface SodRpcClient {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
}

export interface SodResult {
  ok: boolean;
  /** HTTP status the dispatch should return when `ok === false`: 403 for a SoD self-approval / not
   *  authorized (the bypass attempt is refused), 409 for any other RPC failure. */
  status: number;
  message: string;
}

/** Enforce SoD server-side: invoke `submit_sales_invoice(p_si_id)` under the caller's JWT. On a 42501
 *  (self-approval / not-authorized) the bypass is closed — returns `{ok:false, status:403}` and the
 *  dispatch returns 403 WITHOUT submitting to ERP. Any other RPC failure → `{ok:false, status:409}`. */
export async function enforceSiSubmitSod(client: SodRpcClient, siId: string): Promise<SodResult> {
  const { error } = await client.rpc('submit_sales_invoice', { p_si_id: siId });
  if (error) {
    const isSod = error.code === '42501' || /sod|self-approval|approver|author|not authorized/i.test(error.message);
    return { ok: false, status: isSod ? 403 : 409, message: error.message };
  }
  return { ok: true, status: 200, message: '' };
}
