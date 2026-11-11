/**
 * firstDocument — the choices offered for the FIRST document of an empty Draft purchase (ADR-0093, FR-PFE-001).
 * Pure: which kinds the viewer's role may record, and which of those the org's purchase rules hold back.
 * UX only — the server (transition RPC + record triggers) is the authority on both.
 */
import type { ProcurementGates } from '@/src/lib/db/orgs';
import type { RecordKind } from './RecordCaptureForm';

export const FIRST_DOCUMENT_ORDER: readonly RecordKind[] = [
  'purchase_request', 'rfq', 'purchase_order', 'goods_receipt', 'vendor_invoice', 'payment',
];

export interface FirstDocumentRoles {
  /** May request quotes and place orders (the quotation writers). */
  canSource: boolean;
  /** May confirm receipt of goods (requester, Project Manager, Admin). */
  canReceive: boolean;
  /** May record a vendor invoice or a payment (Finance, Admin). */
  canInvoicePay: boolean;
}

/** The kinds the viewer may record first. A request is open to everyone who can raise one. */
export function recordableFirstKinds(roles: FirstDocumentRoles): RecordKind[] {
  return FIRST_DOCUMENT_ORDER.filter((kind) => {
    switch (kind) {
      case 'rfq':
      case 'purchase_order': return roles.canSource;
      case 'goods_receipt': return roles.canReceive;
      case 'vendor_invoice':
      case 'payment': return roles.canInvoicePay;
      default: return true;
    }
  });
}

export type GateHold = 'request' | 'approval' | 'receipt';

const STEP_RANK: Record<RecordKind, number> = {
  purchase_request: 0, rfq: 3, purchase_order: 5, goods_receipt: 6, vendor_invoice: 7, payment: 8,
};

/**
 * What, if anything, an ON purchase rule says must come before this kind on an empty Draft. Mirrors the server's
 * procurement_gate_violation (0368): rules apply cumulatively by the step the record reaches — order rules from
 * Ordered up, the receipt rule from Vendor Invoiced up, the payment rule at Paid — checked in the server's order.
 */
export function gateHold(kind: RecordKind, gates: ProcurementGates | undefined): GateHold | null {
  if (!gates) return null;
  const rank = STEP_RANK[kind];
  if (rank >= 5 && gates.request_before_order) return 'request';
  if (rank >= 5 && gates.approval_before_order) return 'approval';
  if (rank >= 7 && gates.receipt_before_invoice) return 'receipt';
  if (kind === 'payment' && gates.approval_before_payment) return 'approval';
  return null;
}
