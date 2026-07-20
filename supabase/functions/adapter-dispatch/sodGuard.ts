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
import { buildsSalesInvoiceBody } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts';

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

// ════════════════════════════════════════════════════════════════════════════
// SoD defect 2 — the pre-ERP AUTHOR CLAIM (closes the TOCTOU race).
//
// The submit authorization ran BEFORE the ERP body was constructed and authorship was recorded only
// AFTER, in the read-model writer (post-ERP). Two concurrent commands from the same approver — an
// `update` that rewrites the amount and a `submit` — therefore both passed: the submit read the
// authorship as it stood BEFORE the rewrite. Net: the approver's own number carried the approver's
// own approval.
//
// The fix moves BOTH halves behind the invoice row lock IN THE DB (the serialization point and the
// enforcement authority — an edge function holds no transaction across an HTTP call):
//   • a body-rewriting command must first CLAIM authorship via `claim_sales_invoice_author`, which
//     takes `select … for update` on the invoice and REFUSES (55006) while a submit authorization is
//     outstanding;
//   • `submit_sales_invoice` records that authorization under the same lock, after checking the
//     author SET.
// Whichever transaction wins the lock, the other is refused — and the refusal happens BEFORE any ERP
// call, so no money moves either way. (Migration 0113.)
// ════════════════════════════════════════════════════════════════════════════

/** Does this command REWRITE an existing sales invoice's ERP body, and so require the author claim?
 *
 *  `buildsSalesInvoiceBody` (dispatchFactory — the ONE definition) marks the operations that rebuild
 *  the body from the caller's `items`: `update` and `transition{verb:'amend'}`. `create` is excluded
 *  deliberately: there is no PMO invoice row to lock yet, and no submit can race an invoice that does
 *  not exist — the mirror writer records the creator's authorship on the insert instead. */
export function requiresSiAuthorClaim(command: AdapterCommand): boolean {
  if (command.domain !== REVENUE_DOMAIN) return false;
  const operation = command.operation as string;
  if (operation === 'create') return false;
  const rec = command.record as { erp_doc_kind?: unknown; verb?: unknown };
  if (rec.erp_doc_kind !== 'sales-invoice') return false;
  return buildsSalesInvoiceBody({ operation, record: rec });
}

/** Claim authorship of the sales invoice's body BEFORE the ERP write, under the CALLER's JWT.
 *
 *  `55006` (object_in_use) means a submit authorization for this invoice is still outstanding — the
 *  rewrite must not proceed (409 `si-submit-in-progress`, retryable once the submit resolves or its
 *  authorization lapses). `42501` is the org/role/active-member gate (403). Anything else is 409. */
export async function claimSiAuthor(client: SodRpcClient, siId: string): Promise<SodResult> {
  const { error } = await client.rpc('claim_sales_invoice_author', { p_si_id: siId });
  if (error) {
    if (error.code === '55006') return { ok: false, status: 409, message: 'si-submit-in-progress' };
    return { ok: false, status: error.code === '42501' ? 403 : 409, message: error.message };
  }
  return { ok: true, status: 200, message: '' };
}
