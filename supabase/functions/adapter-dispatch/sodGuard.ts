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

/** Structural seam for a SECURITY DEFINER RPC invocation. Which client is passed is per-RPC and is a
 *  security decision: `claim_sales_invoice_author` runs under the CALLER's JWT (auth.uid() must be the
 *  real body-writer), while the clearance grant/release run under SERVICE ROLE (round-7 B1b — the party
 *  the clearance constrains must be unable to call them at all). */
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

/**
 * Enforce SoD server-side AND take this dispatch's body-rewrite clearance, in one locked DB step:
 * `grant_sales_invoice_submit_clearance(p_si_id, p_actor_id, p_clearance_id)`.
 *
 * Round-7 B1b — why this is not `submit_sales_invoice` under the caller's JWT any more:
 *   • that RPC recorded a clearance ANY authenticated Admin/Finance member could take, repeatedly, on a
 *     draft nobody was submitting — an insider freeze on the money path; and
 *   • the release that fixed the freeze was fenced to the GRANTEE, i.e. to the very approver the
 *     clearance constrains, who could therefore lift it mid-submit and rewrite the body their own
 *     in-flight submit was about to commit.
 * The grant is now SERVICE-ROLE ONLY, so a clearance can only come into existence through this dispatch
 * — which always releases it. Because service_role has no `auth.uid()`, the JWT-verified `actorId` is
 * passed explicitly and every authorization predicate in the RPC reads THAT user's profile.
 *
 * `clearanceId` is this dispatch's fencing token; `releaseSiSubmitClearance` names it to release exactly
 * this grant and no other. On a 42501 (self-approval / not-authorized) the bypass is closed — returns
 * `{ok:false, status:403}` and the dispatch returns 403 WITHOUT submitting to ERP. Any other RPC failure
 * → `{ok:false, status:409}`.
 */
export async function grantSiSubmitClearance(
  client: SodRpcClient,
  siId: string,
  actorId: string,
  clearanceId: string,
): Promise<SodResult> {
  const { error } = await client.rpc('grant_sales_invoice_submit_clearance', {
    p_si_id: siId,
    p_actor_id: actorId,
    p_clearance_id: clearanceId,
  });
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

/**
 * Release the clearance THIS dispatch was granted (migration 0114 §F), once the submit it protects has
 * RESOLVED — on the ERP-success, the ERP-rejection and the adapter-select-failure path alike.
 *
 * Without a release the invoice stays frozen for the whole TTL and Finance cannot correct an amount
 * nobody is submitting any more (the round-6 insider-DoS). With the WRONG release it is worse: the first
 * cut let the grantee release their own clearance, and the grantee is exactly the approver the clearance
 * constrains (round-7 B1b). So the release is service-role-only and fenced to `clearanceId` — the token
 * the grant minted — which also stops a SECOND concurrent submit from lifting the FIRST one's freeze
 * while that submit is still in flight (B1c).
 *
 * BEST-EFFORT by construction: the freeze already has a TTL, so a failed release must never turn a
 * RESOLVED money dispatch into a client-visible error. It is logged, never thrown.
 */
export async function releaseSiSubmitClearance(client: SodRpcClient, siId: string, clearanceId: string): Promise<boolean> {
  const { error } = await client.rpc('release_sales_invoice_submit_clearance', {
    p_si_id: siId,
    p_clearance_id: clearanceId,
  });
  if (error) {
    console.error(
      `[adapter-dispatch] submit clearance release failed for sales invoice ${siId} (clearance ${clearanceId}): `
        + `code=${error.code ?? 'none'} message=${error.message} — the clearance TTL remains the backstop`,
    );
    return false;
  }
  return true;
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
