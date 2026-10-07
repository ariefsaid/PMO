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
// ORDERING MATCHES 0006: the case-state refusal (422 — only a `Vendor Invoiced` case owes a bill
// payment) precedes the SoD-b refusal (403 — the approver may not pay), so "anyone dispatches for a
// case at any other status" gets the 422, and the 403 is reserved for the stage where the money
// would actually move. The message is 0006's exact SoD-b wording so the two paths are indistinguishable
// to the client.
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

/** The PMO procurement domain the ERPNext tier owns (a literal here so the guard stays
 *  dependency-free and Deno-importable in isolation, the same idiom as sodGuard's REVENUE_DOMAIN). */
const PROCUREMENT_DOMAIN = 'procurement';

/** The case state a bill payment releases (0006's `Vendor Invoiced → Paid` source state). */
const PAYABLE_STATE = 'Vendor Invoiced';

/** Structural seam for the case re-read (the refs.ts ExternalRefsFilterBuilder idiom). */
export interface PaymentGateClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): PaymentGateFilterBuilder;
    };
  };
}

export interface PaymentGateFilterBuilder {
  eq(column: string, value: string): PaymentGateFilterBuilder;
  maybeSingle(): Promise<{ data: { status: string | null; approved_by_id: string | null } | null; error: { code?: string; message: string } | null }>;
}

export interface PaymentGateResult {
  ok: boolean;
  /** 403 for the SoD-b refusal (mirrors 0006's 42501), 422 for the state/missing-case refusal. */
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
 * exists in the caller's org, sits at `Vendor Invoiced`, and the verified caller is not the case's
 * approver. `callerUserId` is the JWT-verified sub — NEVER a payload field.
 */
export async function enforcePaymentGate(
  client: PaymentGateClient,
  orgId: string,
  callerUserId: string,
  procurementId: string,
): Promise<PaymentGateResult> {
  const { data, error } = await client.from('procurements').select('status,approved_by_id').eq('org_id', orgId).eq('id', procurementId).maybeSingle();
  if (error || !data) {
    // Fail closed: a missing row (including another org's id — the read is org-filtered) or an
    // unreadable one never passes. There is no "absent ⇒ allowed" branch to fall into.
    return REFUSED(422, `vendor payment: the procurement case for this payment was not found in this org${error ? ` (${error.message})` : ''}`);
  }
  if (data.status !== PAYABLE_STATE) {
    return REFUSED(422, `vendor payment: the case must be at ${PAYABLE_STATE} to pay a bill (it is at '${data.status ?? 'unknown'}')`);
  }
  if (callerUserId && data.approved_by_id && callerUserId === data.approved_by_id) {
    return REFUSED(403, 'separation of duties: approver cannot pay own procurement');
  }
  return { ok: true, status: 200, message: '' };
}
