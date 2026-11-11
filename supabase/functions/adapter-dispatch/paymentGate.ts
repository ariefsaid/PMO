// #910 — the vendor-payment money gate (FR-VPAY-005, DD-VPAY-5, AC-VPAY-003), extracted as a
// pure/testable module because index.ts is integration-only (the sodGuard.ts/approvalGuard.ts
// module shape; paymentGate.test.ts owns the proof).
//
// WHY THIS GATE EXISTS: on a flipped (ERP-owned) org the dispatched Payment Entry IS the money
// release — `transition_procurement`'s `Vendor Invoiced → Paid` branch (0006_procurement_lifecycle.sql,
// SoD-b "approver ≠ payer" + its Finance-only role gate) never runs on that path, and the served
// dispatch gate is role-only (authGuard.ts). OBS-VPAY-2: without this gate the case's approver could
// pay their own approved case through the form (or a direct dispatch), the exact split the SoD rule
// exists to prevent.
//
// POSTURE (the same discipline as every other served money gate):
//   • a DB RE-READ decides — the command payload is never trusted to assert state or approver-ness
//     (ADR-0059 §3.3); the caller id is the VERIFIED JWT sub threaded from index.ts, never a payload
//     field;
//   • the read is org-filtered (service client + explicit `org_id`) so another tenant's case id is a
//     missing row here — fail closed;
//   • a missing/unreadable case row refuses (fail closed, the approvalGuard posture): a gate that
//     cannot evaluate must refuse, not pass;
//   • runs BEFORE the outbox insert, so a refused payment leaves no outbox row and touches no ERP;
//   • keyed on the command (`isProcurementPaymentCreate`): every other kind/domain passes without
//     paying for the read (byte-for-byte).
//
// ORDERING: the closed-case refusal (422 `purchase_closed`) precedes the SoD-b refusal (403), which
// precedes the payment rule (422, `procurement_payment_allowed`, 0368), which precedes the ceiling.
// Since #1319 (owner AC-1) the step itself no longer gates a payment — a purchase may start at payment —
// so SoD-b applies at every step. The message is 0006's exact SoD-b wording so the two paths are
// indistinguishable to the client.
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

/** The PMO procurement domain the ERPNext tier owns (a literal here so the guard stays
 *  dependency-free and Deno-importable in isolation, the same idiom as sodGuard's REVENUE_DOMAIN). */
const PROCUREMENT_DOMAIN = 'procurement';

/** #1319 (owner AC-1): a purchase can start at any step, payment included, so the step no longer gates a
 *  payment. A closed purchase refuses here before any RPC — the same `purchase_closed` the link RPC (0361) uses.
 *  Every other approval question (awaiting approval, entered approval but never approved, approval_before_payment)
 *  is the database's ONE rule, `procurement_payment_allowed` (0368), which the Paid update guard and the outbox
 *  claim also ask. */
const CLOSED_STATES = new Set(['Cancelled', 'Rejected']);

/** Structural seam for the case re-read (the refs.ts ExternalRefsFilterBuilder idiom). */
export interface PaymentGateClient {
  /** `procurement_payment_allowed` (0368, a reason code or null) — the ONE payment rule the Paid update guard and the
   *  outbox claim also apply — and `procurement_payment_within_ceiling` (0349, rows of PaymentCeilingRow) — the ONE
   *  ceiling the Paid transition also applies. */
  rpc(functionName: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): PaymentGateFilterBuilder;
    };
  };
}

/** One row of `procurement_payment_within_ceiling`: pre-tax live-bill net vs the approved amount. */
export interface PaymentCeilingRow {
  ok: boolean;
  reason: string | null;
  billed_net: number | null;
  approved_amount: number | null;
}

export interface PaymentGateFilterBuilder {
  eq(column: string, value: string): PaymentGateFilterBuilder;
  maybeSingle(): Promise<{
    data: { status: string | null; approved_by_id: string | null; amount_approved_by_id?: string | null; approved_total_value?: number | null } | null;
    error: { code?: string; message: string } | null;
  }>;
}

export interface PaymentGateResult {
  ok: boolean;
  /** 403 for the SoD-b refusal (mirrors 0006's 42501), 422 for the closed/missing-case and ceiling refusals. */
  status: number;
  message: string;
}

/** Does this command need the vendor-payment gate? True ONLY for a procurement `payment` CREATE —
 *  the one operation that mints the money release. Transitions/cancels of an existing PE are not a
 *  new release, and every other kind/domain never was (they keep their own gates). */
export function isProcurementPaymentCreate(command: AdapterCommand): boolean {
  if (command.domain !== PROCUREMENT_DOMAIN) return false;
  if ((command.operation as string) !== 'create') return false;
  return (command.record as { erp_doc_kind?: unknown }).erp_doc_kind === 'payment';
}

const REFUSED = (status: number, message: string): PaymentGateResult => ({ ok: false, status, message });

/**
 * Re-assert, from the database, that this procurement payment create may release money: the case
 * exists in the caller's org and is not closed, the verified caller is not one of its approvers, and —
 * when an approval exists — the bills fit the approved amount. `callerUserId` is the JWT-verified sub —
 * NEVER a payload field.
 */
export async function enforcePaymentGate(
  client: PaymentGateClient,
  orgId: string,
  callerUserId: string,
  procurementId: string,
): Promise<PaymentGateResult> {
  const { data, error } = await client.from('procurements').select('status,approved_by_id,amount_approved_by_id,approved_total_value').eq('org_id', orgId).eq('id', procurementId).maybeSingle();
  if (error) {
    // Fail closed: an unreadable row never passes.
    return REFUSED(422, `vendor payment: the procurement case could not be read (${error.message})`);
  }
  if (!data) {
    // Fail closed: a missing row (including another org's id — the read is org-filtered). The database's
    // own reason code (procurement_gate_violation), so every refusal of a missing purchase reads the same.
    return REFUSED(422, 'purchase_not_found');
  }
  if (data.status === null || CLOSED_STATES.has(data.status)) return REFUSED(422, 'purchase_closed');
  // SoD-b covers both approvals that set the ceiling: the request's approver and, when the billed amount
  // was later approved higher (approve_procurement_amount), that amount's approver.
  if (callerUserId && (callerUserId === data.approved_by_id || callerUserId === data.amount_approved_by_id)) {
    return REFUSED(403, 'separation of duties: approver cannot pay own procurement');
  }
  // #1319 slice G review (C1): the database's payment rule (0368). A purchase awaiting approval (Requested, including
  // one a quote re-opened), one that entered approval and was never approved, or one the org's approval_before_payment
  // gate holds is refused with the rule's reason code. A rule that cannot be evaluated refuses (fail closed).
  const rule = await client.rpc('procurement_payment_allowed', { p_procurement_id: procurementId });
  if (rule.error) return REFUSED(422, `vendor payment: the payment rule could not be evaluated (${rule.error.message})`);
  if (rule.data !== null && rule.data !== undefined) return REFUSED(422, String(rule.data));
  // #1319 (owner AC-3, FR-PFE-017): no approval recorded = nothing to compare against, so no ceiling. The
  // same split as the procurement update guard (0362/0368): an approver without an approved amount still asks the
  // helper, which refuses it ('approved amount is missing').
  if (data.approved_by_id == null && data.approved_total_value == null) return { ok: true, status: 200, message: '' };
  // The approved-amount ceiling, evaluated by the same SQL helper the Paid transition uses: pre-tax
  // net of live bills ≤ the approved amount, bills in the procurement's currency. No row or an error
  // refuses (fail closed).
  const ceiling = await client.rpc('procurement_payment_within_ceiling', { p_procurement_id: procurementId });
  const result = (ceiling.data as Array<PaymentCeilingRow> | null)?.[0];
  if (ceiling.error || !result) {
    return REFUSED(422, `vendor payment: approved-amount ceiling could not be evaluated${ceiling.error ? ` (${ceiling.error.message})` : ''}`);
  }
  if (!result.ok) return REFUSED(422, `vendor payment: ${result.reason ?? 'approved-amount ceiling refused payment'}`);
  return { ok: true, status: 200, message: '' };
}
