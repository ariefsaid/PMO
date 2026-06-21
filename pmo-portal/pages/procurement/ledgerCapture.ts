/**
 * ledgerCapture — pure capture-gating logic for the Documents ledger capture row.
 *
 * `nextExpectedType(status, existingTypes)` is DATA-DRIVEN: it offers a record kind
 * only if it is (a) unlocked by the current lifecycle status AND (b) not already
 * present in the ledger. Keying off status alone over-prompted (e.g. offering
 * "Capture Purchase Request" at Requested when a submitted PR already exists) — the
 * presence check fixes that. Terminal statuses return null up-front.
 *
 * Extracted from LedgerCaptureRow.tsx so the function is unit-testable without a
 * react-refresh component-export lint violation, and tested directly (no mirror →
 * no drift).
 */
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import type { RecordType } from '@/src/lib/db/procurementLedger';
import type { RecordKind } from './RecordCaptureForm';

/** Terminal statuses where capture is not available. */
const TERMINAL_STATUSES = new Set<ProcurementStatus>([
  'Paid',
  'Cancelled',
  'Rejected',
]);

/** The ledger RecordType that each capturable RecordKind materializes as.
 *  GR/VI are NOT ledger-capture kinds (action-zone owns them) so they are absent. */
const KIND_TO_LEDGER_TYPE: Partial<Record<RecordKind, RecordType>> = {
  purchase_request: 'PR',
  rfq: 'RFQ',
  purchase_order: 'PO',
  payment: 'Payment',
};

/** Maps a status to the record kind unlocked at that stage (ignoring presence).
 *  Ordered/Received → null (M4: GR/VI handled by the action-zone inline forms). */
function unlockedKindForStatus(status: ProcurementStatus): RecordKind | null {
  switch (status) {
    case 'Draft':
    case 'Requested':
      return 'purchase_request';
    case 'Approved':
    case 'Vendor Quoted':
      return 'rfq';
    case 'Quote Selected':
      return 'purchase_order';
    case 'Ordered':
    case 'Received':
      // M4 (design-review): at Ordered the next step is a Goods Receipt and at
      // Received a Vendor Invoice — neither is a ledger-capture RecordKind (they
      // are captured via the action-zone inline forms). Returning null hides the
      // ledger capture row so it never mis-prompts a past-phase record.
      return null;
    case 'Vendor Invoiced':
      return 'payment';
    default:
      return null;
  }
}

/**
 * The record kind to offer for capture, or null to hide the row.
 *
 * @param status         current procurement lifecycle status
 * @param existingTypes  the set of ledger RecordTypes already present for this case
 */
export function nextExpectedType(
  status: ProcurementStatus,
  existingTypes: ReadonlySet<RecordType>,
): RecordKind | null {
  if (TERMINAL_STATUSES.has(status)) return null;

  const kind = unlockedKindForStatus(status);
  if (kind === null) return null;

  // Data-driven gate: don't offer a kind that already exists in the ledger
  // (e.g. Requested with a submitted PR already present → await approval).
  const ledgerType = KIND_TO_LEDGER_TYPE[kind];
  if (ledgerType && existingTypes.has(ledgerType)) return null;

  return kind;
}
