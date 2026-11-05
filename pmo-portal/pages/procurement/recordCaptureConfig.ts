import type { TFunction } from 'i18next';
import { VI_FIELD_TEST_IDS } from './vendorInvoiceTestIds';
// ---------------------------------------------------------------------------
// Record-type config
// ---------------------------------------------------------------------------

export type RecordKind =
  | 'purchase_request'
  | 'rfq'
  | 'purchase_order'
  | 'payment'
  // The action-zone capture kinds, folded in (refactor: procurement-detail-dedup).
  // GR/VI stage a confirm-before-commit (see `onStage`) rather than create directly.
  | 'goods_receipt'
  | 'vendor_invoice';

export const STATUS_OPTIONS: Record<RecordKind, string[]> = {
  purchase_request: ['Draft', 'Submitted', 'Approved', 'Closed'],
  rfq: ['Draft', 'Issued', 'Closed'],
  purchase_order: ['Draft', 'Issued', 'Acknowledged', 'Closed'],
  payment: ['Pending', 'Processed', 'Cleared'],
  // GR: default Complete (the field-config below sorts Partial first then Complete,
  // but the DEFAULT-selected value is Complete to preserve the prior inline form).
  goods_receipt: ['Partial', 'Complete'],
  // N1 (AC-W3-N1): Paid is NOT offered here — "Mark as Paid" is the sole PR→Paid authority.
  vendor_invoice: ['Received', 'Scheduled'],
};

// ---------------------------------------------------------------------------
// Per-kind field/label/testid config (refactor: procurement-detail-dedup).
//
// The four ERP-canonical kinds (PR/RFQ/PO/Payment) keep the generic
// `${kind}-*` / `form-capture-${kind}` ids + the "External ref" label. GR and VI
// PRESERVE the bespoke ids the unit + e2e BDD layer keys off (`form-create-gr`,
// `gr-ref-input`, `btn-save-gr`, `vi-*`, …) — change one and you break that layer.
// GR shows ref+status+date (NO amount); VI shows ref+amount+status+date.
// ---------------------------------------------------------------------------
export interface KindConfig {
  /** Default-selected status value (the others are still offered). */
  defaultStatus: string;
  /** Ref field label + placeholder. */
  refLabel: string;
  refPlaceholder: string;
  /** Date field label (GR: "Receipt date"; VI: "Invoice date"; else "Date"). */
  dateLabel: string;
  /** Whether the amount field is shown. */
  showAmount: boolean;
  /** Whether the predecessor-FK "Links to invoice" select is shown (payment only). */
  showInvoiceFk: boolean;
  /** Submit-button label (GR/VI keep the compact "Save GR"/"Save vendor invoice"). */
  saveLabel: string;
  /** data-testid for the <form>. */
  formTestId: string;
  refTestId: string;
  statusTestId: string;
  dateTestId: string;
  amountTestId: string;
  saveTestId: string;
  cancelTestId: string;
}

/** #769: kinds that carry the parent group's number (`external_ref`). */
export const GROUP_REF_KINDS: ReadonlySet<RecordKind> = new Set<RecordKind>(['purchase_request', 'purchase_order', 'vendor_invoice']);

const DEFAULT_REF_LABEL = 'External ref';
const DEFAULT_REF_PLACEHOLDER = 'e.g. SUPPLIER-PO-001';

const KIND_LABEL: Record<RecordKind, string> = {
  purchase_request: 'Purchase Request',
  rfq: 'RFQ',
  purchase_order: 'Purchase Order',
  payment: 'Payment',
  goods_receipt: 'Goods Receipt',
  vendor_invoice: 'Supplier invoice',
};

export function localizedRecordKindLabel(kind: RecordKind, t: TFunction): string {
  switch (kind) {
    case 'purchase_request': return t('procurementLedger.types.purchaseRequest', 'Purchase Request');
    case 'rfq': return t('procurementLedger.types.rfq', 'RFQ');
    case 'purchase_order': return t('procurementLedger.types.purchaseOrder', 'Purchase Order');
    case 'payment': return t('procurementLedger.types.payment', 'Payment');
    case 'goods_receipt': return t('procurementDetail.recordKinds.goodsReceipt', 'Goods Receipt');
    case 'vendor_invoice': return t('procurementDetail.recordKinds.vendorInvoice', 'Supplier Invoice');
  }
}

export function statusOptionLabel(value: string, t: (key: string, fallback: string) => string): string {
  switch (value) {
    case 'Draft': return t('procurementDetail.statusOption.draft', 'Draft');
    case 'Submitted': return t('procurementDetail.statusOption.submitted', 'Submitted');
    case 'Requested': return t('procurementDetail.statusOption.requested', 'Requested');
    case 'Approved': return t('procurementDetail.statusOption.approved', 'Approved');
    case 'Rejected': return t('procurementDetail.statusOption.rejected', 'Rejected');
    case 'Sent': return t('procurementDetail.statusOption.sent', 'Sent');
    case 'Received': return t('procurementDetail.statusOption.received', 'Received');
    case 'Closed': return t('procurementDetail.statusOption.closed', 'Closed');
    case 'Issued': return t('procurementDetail.statusOption.issued', 'Issued');
    case 'Acknowledged': return t('procurementDetail.statusOption.acknowledged', 'Acknowledged');
    case 'Pending': return t('procurementDetail.statusOption.pending', 'Pending');
    case 'Processed': return t('procurementDetail.statusOption.processed', 'Processed');
    case 'Cleared': return t('procurementDetail.statusOption.cleared', 'Cleared');
    case 'Partial': return t('procurementDetail.statusOption.partial', 'Partial');
    case 'Complete': return t('procurementDetail.statusOption.complete', 'Complete');
    case 'Scheduled': return t('procurementDetail.statusOption.scheduled', 'Scheduled');
    default: return value;
  }
}

export function kindConfig(kind: RecordKind): KindConfig {
  if (kind === 'goods_receipt') {
    return {
      defaultStatus: 'Complete',
      refLabel: 'Delivery note',
      refPlaceholder: 'e.g. DN-44120',
      dateLabel: 'Receipt date',
      showAmount: false,
      showInvoiceFk: false,
      saveLabel: 'Save GR',
      formTestId: 'form-create-gr',
      refTestId: 'gr-ref-input',
      statusTestId: 'gr-status-select',
      dateTestId: 'gr-date-input',
      amountTestId: 'gr-amount-input', // unused (showAmount=false) but kept for shape
      saveTestId: 'btn-save-gr',
      cancelTestId: 'btn-cancel-gr',
    };
  }
  if (kind === 'vendor_invoice') {
    // ⚠ KEEP IN SYNC with VIInlineCapture in ProcurementDecisionZone.tsx — the OTHER
    // vendor-invoice capture entry point (the transition-coupled "Mark Vendor Invoiced"
    // path). Both render the SAME four VI fields; the `vi-*` testids are single-sourced
    // in vendorInvoiceTestIds.ts so the two paths can never silently diverge.
    return {
      defaultStatus: 'Received',
      refLabel: 'Invoice #',
      refPlaceholder: 'e.g. INV-2291',
      dateLabel: 'Invoice date',
      showAmount: true,
      showInvoiceFk: false,
      saveLabel: 'Save supplier invoice',
      formTestId: 'form-create-vi',
      refTestId: VI_FIELD_TEST_IDS.ref,
      statusTestId: VI_FIELD_TEST_IDS.status,
      dateTestId: VI_FIELD_TEST_IDS.date,
      amountTestId: VI_FIELD_TEST_IDS.amount,
      saveTestId: 'btn-save-vi',
      cancelTestId: 'btn-cancel-vi',
    };
  }
  // The four generic ERP-canonical kinds — unchanged ids/labels.
  return {
    defaultStatus: STATUS_OPTIONS[kind][0] ?? '',
    refLabel: DEFAULT_REF_LABEL,
    refPlaceholder: DEFAULT_REF_PLACEHOLDER,
    dateLabel: 'procurementDetail.dateLabel',
    showAmount: true,
    showInvoiceFk: kind === 'payment',
    saveLabel: `Save ${KIND_LABEL[kind]}`,
    formTestId: `form-capture-${kind}`,
    refTestId: `${kind}-ref-input`,
    statusTestId: `${kind}-status-select`,
    dateTestId: `${kind}-date-input`,
    amountTestId: `${kind}-amount-input`,
    saveTestId: `${kind}-save-btn`,
    cancelTestId: `${kind}-cancel-btn`,
  };
}

