/**
 * LedgerCaptureRow — the ONE capture affordance for the Documents ledger.
 *
 * Pre-selects the next expected record type for the current procurement stage
 * via `nextExpectedType(status)`. Wraps the existing `RecordCaptureForm` (reuse —
 * no new form primitive). Gated via the caller-supplied `canWrite` (derived from
 * `can('create','procFile',{ realRole })` at the page level — the real JWT role).
 *
 * Terminal statuses (Paid / Cancelled / Rejected) hide the row entirely (honest
 * doorway — no dead control). Multiple captures are supported: after one record is
 * saved the row remains for another (gated only by `canWrite` + stage).
 *
 * PO-less paths: `nextExpectedType` falls back to the next LEGAL type for the case's
 * actual stage, not a fixed chain. The capture form's FK selects remain optional/
 * none-default (already the case in RecordCaptureForm's [PD-5] handling).
 *
 * DESIGN.md tokens: dashed capture row uses `border-primary/35 bg-primary/[0.04]` per §6.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Icon, SelectField } from '@/src/components/ui';
import { RecordCaptureForm, type RecordKind, type StagedRecord } from './RecordCaptureForm';
import type { ProcurementGates } from '@/src/lib/db/orgs';
import { gateHold, type GateHold } from './firstDocument';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import type { ProcurementInvoiceRow } from '@/src/lib/db/procurementLifecycle';
import type { RecordType } from '@/src/lib/db/procurementLedger';
import type { VendorInvoiceContext } from '@/src/components/procurement/vendorInvoiceIdentityLabels';
// nextExpectedType is the DATA-DRIVEN capture gate (status-unlock AND not-already-
// present). Extracted to a sibling module so it stays unit-testable directly (no
// mirror → no drift) without a react-refresh component-export lint violation.
import { nextExpectedType } from './ledgerCapture';
import { groupRefIsPmoAuthored } from './groupRef';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

/** Human label for the capture type (shown in the dashed row label).
 *  GR/VI are NOT capturable here (handled by the action-zone forms — see
 *  nextExpectedType's M4 note), so they are absent from this ledger-only map. */
const CAPTURE_LABELS: Record<RecordKind, string> = {
  purchase_request: 'Purchase Request',
  rfq: 'RFQ',
  purchase_order: 'Purchase Order',
  payment: 'Payment',
  goods_receipt: 'Goods Receipt',
  vendor_invoice: 'Supplier invoice',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface LedgerCaptureRowProps {
  /** Current procurement status — determines which type is unlocked. */
  status: ProcurementStatus;
  /**
   * The set of ledger RecordTypes already captured for this case. Used to gate
   * the capture offer: a kind that already exists is never re-offered (the
   * over-prompt fix — e.g. a submitted PR at Requested → await approval).
   */
  existingTypes: ReadonlySet<RecordType>;
  /** Called when a record is saved. Refreshes the ledger via React Query's invalidation. */
  onCreate: (kind: RecordKind, input: unknown) => Promise<unknown>;
  /** Invoice rows for the payment predecessor-FK dropdown ([PD-5]). */
  invoices?: ProcurementInvoiceRow[];
  /** Display-only case/project facts already loaded with the owning procurement. */
  invoiceIdentityContext?: VendorInvoiceContext;
  /** Whether the capture affordance is active. Derived from real JWT role. */
  canWrite: boolean;
  /** Whether any mutation is in flight (busy state). */
  busy?: boolean;
  /** The case approver cannot pay on an ERP-owned org (server SoD gate). */
  isApprover?: boolean;
  /**
   * FR-PFE-001: the kinds the viewer's role may record as the FIRST document of an empty Draft. With more than one,
   * the row offers the choice; with one (a requester) it is the plain request capture it always was.
   */
  firstDocumentKinds?: RecordKind[];
  /** One-shot arrival handoff from intake; opens this same first-document capture when allowed. */
  autoOpenFirstDocument?: RecordKind | null;
  onAutoOpenFirstDocumentConsumed?: () => void;
  /** Goods receipt / vendor invoice confirm-before-commit hand-off (the page's ConfirmDialog owns the write). */
  onStage?: (staged: StagedRecord) => void;
  /** Changes whenever a record is committed, so an open form closes after its write lands. */
  resetKey?: number;
  /** The viewer may approve this purchase — worded into the Requested empty state. */
  canApprove?: boolean;
  /** The ledger has no rows; the Requested note then lives in the empty state, so it is not repeated here. */
  emptyLedger?: boolean;
  /** #876: forwarded to the vendor-invoice form's tax pre-fill. */
  vendorId?: string | null;
  itemsNet?: number | null;
  /** The purchase's currency, named on the capture form's amount field. */
  currency?: string | null;
  /** The org's purchase rules (read by the page). Unknown = nothing is held back; the server still enforces. */
  gates?: ProcurementGates;
}

function firstKindName(kind: RecordKind, t: TFunction): string {
  switch (kind) {
    case 'purchase_request': return t('procurement:ledger.first.request', 'Request');
    case 'rfq': return t('procurement:ledger.first.rfq', 'Quote request');
    case 'purchase_order': return t('procurement:ledger.first.order', 'Order');
    case 'goods_receipt': return t('procurement:ledger.first.receipt', 'Goods receipt');
    case 'vendor_invoice': return t('procurement:ledger.first.invoice', 'Supplier invoice');
    default: return t('procurement:ledger.first.payment', 'Payment');
  }
}

const GATE_HOLD_TEXT: Record<GateHold, [string, string]> = {
  request: ['procurement:ledger.first.needsRequest', 'needs a purchase request first'],
  approval: ['procurement:ledger.first.needsApproval', 'needs an approval first'],
  receipt: ['procurement:ledger.first.needsReceipt', 'needs a goods receipt first'],
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const LedgerCaptureRow: React.FC<LedgerCaptureRowProps> = ({
  status,
  existingTypes,
  onCreate,
  invoices = [],
  invoiceIdentityContext,
  canWrite,
  busy = false,
  isApprover = false,
  firstDocumentKinds = [],
  autoOpenFirstDocument = null,
  onAutoOpenFirstDocumentConsumed,
  onStage,
  resetKey = 0,
  canApprove = false,
  emptyLedger = false,
  vendorId,
  itemsNet,
  currency,
  gates,
}) => {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<RecordKind>('purchase_request');
  const autoOpenConsumed = useRef(false);
  const { t } = useTranslation();
  useEffect(() => setOpen(false), [resetKey]);
  useEffect(() => {
    if (!autoOpenFirstDocument || autoOpenConsumed.current) return;
    autoOpenConsumed.current = true;
    if (!canWrite || status !== 'Draft' || existingTypes.size !== 0
      || !firstDocumentKinds.includes(autoOpenFirstDocument)
      || gateHold(autoOpenFirstDocument, gates) !== null) {
      onAutoOpenFirstDocumentConsumed?.();
      return;
    }
    setChosen(autoOpenFirstDocument);
    setOpen(true);
    onAutoOpenFirstDocumentConsumed?.();
  }, [autoOpenFirstDocument, canWrite, existingTypes, firstDocumentKinds, gates, onAutoOpenFirstDocumentConsumed, status]);
  // The page's decision bar is sticky at the bottom: bring an opened form to the middle of the screen so its Save
  // button is not left underneath it.
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) rowRef.current?.scrollIntoView?.({ block: 'center' }); }, [open]);
  // The first document of an empty Draft is the viewer's choice (when they have one); otherwise the shipped gate.
  const choosingFirst = status === 'Draft' && existingTypes.size === 0 && firstDocumentKinds.length > 1;
  const effectiveChoice = gateHold(chosen, gates) === null && firstDocumentKinds.includes(chosen)
    ? chosen
    : (firstDocumentKinds.find((k) => gateHold(k, gates) === null) ?? 'purchase_request');
  const nextKind = nextExpectedType(status, existingTypes, choosingFirst ? effectiveChoice : null);

  // Honest doorway: hide when canWrite=false OR terminal status
  if (!canWrite) return null;
  // ADR-0093: the server refuses documents on a purchase awaiting approval — say so instead of offering a dead action.
  if (status === 'Requested') {
    if (emptyLedger) return null;
    return (
      <p data-testid="ledger-awaiting-approval" className="mt-3 text-[13px] text-muted-foreground">
        {canApprove
          ? t('procurement:ledger.approveToStart', 'Approve to start recording documents.')
          : t('procurement:ledger.awaitingApproval', 'Waiting for approval. Documents can be recorded once it is approved.')}
      </p>
    );
  }

  if (nextKind === null) return null;
  const label = nextKind === 'purchase_request' ? t('procurementLedger.types.purchaseRequest', 'Purchase Request')
    : nextKind === 'rfq' ? t('procurementLedger.types.rfq', 'RFQ')
      : nextKind === 'purchase_order' ? t('procurementLedger.types.purchaseOrder', 'Purchase Order')
        : nextKind === 'payment' ? t('procurementLedger.types.payment', 'Payment') : CAPTURE_LABELS[nextKind];
  const paymentBlocked = nextKind === 'payment' && isApprover && !groupRefIsPmoAuthored();
  // ERP-owned: a payment must name a PMO bill, and an ERP-linked invoice is not one. With none to pay against, point at
  // the supported route instead of offering a form whose required bill selector is empty.
  const paymentRecordInErp = nextKind === 'payment' && !groupRefIsPmoAuthored() && invoices.length === 0;

  return (
    <div ref={rowRef} data-testid="ledger-capture-row" className="mt-3">
      {open && !paymentRecordInErp ? (
        <RecordCaptureForm
          kind={nextKind}
          invoices={invoices}
          invoiceIdentityContext={invoiceIdentityContext}
          vendorId={vendorId}
          itemsNet={itemsNet}
          currency={currency}
          busy={busy}
          onCreate={(input) => onCreate(nextKind, input)}
          onStage={onStage && (nextKind === 'goods_receipt' || nextKind === 'vendor_invoice') ? onStage : undefined}
          onClose={() => setOpen(false)}
        />
      ) : (
        /* Dashed capture prompt (DESIGN.md §6 capture row token) */
        <div
          className="flex flex-wrap items-center gap-3 rounded-[calc(var(--radius)-2px)] border-[1.5px] border-dashed border-primary/35 bg-primary/[0.04] px-4 py-3"
        >
          {choosingFirst ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
              <SelectField
                id="ledger-first-document"
                label={t('procurement:ledger.first.label', 'Record the first document')}
                value={effectiveChoice}
                onChange={(v) => setChosen(v as RecordKind)}
                options={firstDocumentKinds.map((kind) => {
                  const hold = gateHold(kind, gates);
                  const name = firstKindName(kind, t);
                  return {
                    value: kind,
                    label: hold ? `${name} — ${t(...GATE_HOLD_TEXT[hold])}` : name,
                    disabled: hold !== null,
                  };
                })}
                helper={t('procurement:ledger.first.helper', 'Start from the document you already have. Your organization’s purchase rules still apply.')}
              />
            </div>
          ) : paymentRecordInErp ? null : (
            <span className="text-[13px] text-muted-foreground">
              {t('procurementLedger.capture.next', '+ Capture {{record}}: the next record for this phase.', { record: label })}
            </span>
          )}
          {paymentRecordInErp ? (
            <p data-testid="ledger-payment-in-erp" className="ml-auto text-[13px] text-muted-foreground">
              {t('procurement:ledger.paymentInErp', 'Record the payment in ERPNext; it links here on the next sync.')}
            </p>
          ) : (<>
          <button
            type="button"
            data-testid="ledger-capture-open"
            onClick={() => setOpen(true)}
            disabled={paymentBlocked}
            aria-describedby={paymentBlocked ? 'ledger-payment-sod-reason' : undefined}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Icon name="plus" className="size-3.5" />
            {t('procurementLedger.capture.action', 'Capture {{record}}', { record: label })}
          </button>
          {paymentBlocked && (
            <span id="ledger-payment-sod-reason" className="basis-full text-right text-[12px] text-muted-foreground">
              {t('procurementDetail.paymentApproverCannotPay', 'Separation of duties: the approver cannot pay their own procurement.')}
            </span>
          )}
          </>)}
        </div>
      )}
    </div>
  );
};

LedgerCaptureRow.displayName = 'LedgerCaptureRow';
