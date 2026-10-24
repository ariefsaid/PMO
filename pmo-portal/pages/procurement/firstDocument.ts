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

/** What, if anything, an ON purchase rule says must come before this kind. A kind with no hold is free. */
export function gateHold(kind: RecordKind, gates: ProcurementGates | undefined): GateHold | null {
  if (!gates) return null;
  if (kind === 'purchase_order') {
    if (gates.request_before_order) return 'request';
    if (gates.approval_before_order) return 'approval';
  }
  if (kind === 'vendor_invoice' && gates.receipt_before_invoice) return 'receipt';
  if (kind === 'payment' && gates.approval_before_payment) return 'approval';
  return null;
}
