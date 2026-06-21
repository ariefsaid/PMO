/**
 * RecordCaptureForm — inline per-phase capture form for the four new ERP-canonical
 * record types (PR / RFQ / PO / Payment).
 *
 * Compact form built on shared primitives: keyboard-operable, programmatic labels on
 * every field, reference-number bounded at maxLength=64 (NFR-PR-SEC-003), touch
 * targets ≥44px (NFR-PR-RESP-002). Calls the mutation returned by `useProcurementRecords`
 * (Task 6.4). classifyMutationError feeds toasts. No dangerouslySetInnerHTML.
 *
 * [PD-5]: predecessor FKs (invoice_id on payment) are inline-OPTIONAL selects defaulting
 * to none — captured by the user, not auto-wired.
 */
import React, { useState } from 'react';
import { Button, Icon, useToast } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { ProcurementInvoiceRow } from '@/src/lib/db/procurementLifecycle';

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

interface StatusOption {
  value: string;
  label: string;
}

const STATUS_OPTIONS: Record<RecordKind, StatusOption[]> = {
  purchase_request: [
    { value: 'Draft', label: 'Draft' },
    { value: 'Requested', label: 'Requested' },
    { value: 'Approved', label: 'Approved' },
    { value: 'Rejected', label: 'Rejected' },
  ],
  rfq: [
    { value: 'Draft', label: 'Draft' },
    { value: 'Sent', label: 'Sent' },
    { value: 'Received', label: 'Received' },
    { value: 'Closed', label: 'Closed' },
  ],
  purchase_order: [
    { value: 'Draft', label: 'Draft' },
    { value: 'Issued', label: 'Issued' },
    { value: 'Acknowledged', label: 'Acknowledged' },
    { value: 'Closed', label: 'Closed' },
  ],
  payment: [
    { value: 'Pending', label: 'Pending' },
    { value: 'Processed', label: 'Processed' },
    { value: 'Cleared', label: 'Cleared' },
  ],
  // GR: default Complete (the field-config below sorts Partial first then Complete,
  // but the DEFAULT-selected value is Complete to preserve the prior inline form).
  goods_receipt: [
    { value: 'Partial', label: 'Partial' },
    { value: 'Complete', label: 'Complete' },
  ],
  // N1 (AC-W3-N1): Paid is NOT offered here — "Mark as Paid" is the sole PR→Paid authority.
  vendor_invoice: [
    { value: 'Received', label: 'Received' },
    { value: 'Scheduled', label: 'Scheduled' },
  ],
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
interface KindConfig {
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
  /** Submit-button label (GR/VI keep the compact "Save GR"/"Save VI"). */
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

const DEFAULT_REF_LABEL = 'External ref';
const DEFAULT_REF_PLACEHOLDER = 'e.g. VENDOR-PO-001';

const KIND_LABEL: Record<RecordKind, string> = {
  purchase_request: 'Purchase Request',
  rfq: 'RFQ',
  purchase_order: 'Purchase Order',
  payment: 'Payment',
  goods_receipt: 'Goods Receipt',
  vendor_invoice: 'Vendor Invoice',
};

function kindConfig(kind: RecordKind): KindConfig {
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
    return {
      defaultStatus: 'Received',
      refLabel: 'Invoice #',
      refPlaceholder: 'e.g. INV-2291',
      dateLabel: 'Invoice date',
      showAmount: true,
      showInvoiceFk: false,
      saveLabel: 'Save VI',
      formTestId: 'form-create-vi',
      refTestId: 'vi-ref-input',
      statusTestId: 'vi-status-select',
      dateTestId: 'vi-date-input',
      amountTestId: 'vi-amount-input',
      saveTestId: 'btn-save-vi',
      cancelTestId: 'btn-cancel-vi',
    };
  }
  // The four generic ERP-canonical kinds — unchanged ids/labels.
  return {
    defaultStatus: STATUS_OPTIONS[kind][0]?.value ?? '',
    refLabel: DEFAULT_REF_LABEL,
    refPlaceholder: DEFAULT_REF_PLACEHOLDER,
    dateLabel: 'Date',
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

// ---------------------------------------------------------------------------
// Mutation input shapes — mirrored from useProcurementRecords
// ---------------------------------------------------------------------------

export interface CreatePRInput {
  referenceNumber: string | null;
  status: string | null;
  date: string | null;
  amount: number | null;
}

export interface CreateRfqInput {
  referenceNumber: string | null;
  status: string | null;
  date: string | null;
  amount: number | null;
}

export interface CreatePOInput {
  referenceNumber: string | null;
  status: string | null;
  date: string | null;
  amount: number | null;
}

export interface CreatePaymentInput {
  invoiceId: string | null;
  referenceNumber: string | null;
  status: string | null;
  date: string | null;
  amount: number | null;
}

export type CreateRecordInput =
  | CreatePRInput
  | CreateRfqInput
  | CreatePOInput
  | CreatePaymentInput;

// ---------------------------------------------------------------------------
// Staged GR/VI payloads (refactor: procurement-detail-dedup). GR/VI do NOT create
// directly on submit — they hand off a `pendingConfirm`-shaped payload to the page
// via `onStage`, which stages a confirm-before-commit. The shapes mirror the
// PendingConfirm `createGR` / `createVI` variants in ProcurementDetails.tsx.
// ---------------------------------------------------------------------------
export interface StagedGR {
  kind: 'createGR';
  status: 'Partial' | 'Complete';
  receiptDate: string;
  referenceNumber: string | null;
}

export interface StagedVI {
  kind: 'createVI';
  /** N1: Paid excluded — Mark as Paid is the sole PR→Paid authority. */
  status: 'Received' | 'Scheduled';
  invoiceDate: string;
  referenceNumber: string | null;
  amount: number | null;
}

export type StagedRecord = StagedGR | StagedVI;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RecordCaptureFormProps {
  kind: RecordKind;
  /** Callable mutation — the hook provides this; returns a Promise. */
  onCreate: (input: CreateRecordInput) => Promise<unknown>;
  /** Whether the mutation is in flight. */
  busy?: boolean;
  /** Invoice rows for the Payment predecessor-FK dropdown ([PD-5]). */
  invoices?: ProcurementInvoiceRow[];
  /** Called when the form is dismissed (cancel). */
  onClose: () => void;
  /**
   * GR/VI confirm-before-commit hand-off (refactor: procurement-detail-dedup).
   * When provided, submit calls `onStage(...)` with the parsed fields INSTEAD of
   * `onCreate` — no toast, no direct create. The page stages a `pendingConfirm`
   * and commits on the ConfirmDialog's Confirm. When ABSENT, behavior is exactly
   * as before (direct `onCreate` + success toast). Only the GR/VI kinds use it.
   */
  onStage?: (staged: StagedRecord) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const RecordCaptureForm: React.FC<RecordCaptureFormProps> = ({
  kind,
  onCreate,
  busy = false,
  invoices = [],
  onClose,
  onStage,
}) => {
  const { toast } = useToast();
  const cfg = kindConfig(kind);
  const [referenceNumber, setReferenceNumber] = useState('');
  const [status, setStatus] = useState(cfg.defaultStatus);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amountStr, setAmountStr] = useState('');
  // [PD-5]: predecessor FK for payment — optional, defaults to none.
  const [invoiceId, setInvoiceId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const label = KIND_LABEL[kind];
  const statusOptions = STATUS_OPTIONS[kind];
  const formId = `record-capture-${kind}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // GR/VI confirm-before-commit hand-off (refactor: procurement-detail-dedup).
    // When `onStage` is provided we stage the parsed fields for the page's
    // ConfirmDialog INSTEAD of creating directly — no toast, no `onCreate`, no
    // `onClose` (the page closes the form once the staged write commits).
    if (onStage) {
      const refNum = referenceNumber.trim() || null;
      const parsedAmount = amountStr.trim() === '' ? null : Number(amountStr.replace(/,/g, ''));
      if (kind === 'goods_receipt') {
        onStage({
          kind: 'createGR',
          status: status as 'Partial' | 'Complete',
          receiptDate: date,
          referenceNumber: refNum,
        });
      } else {
        // N1: status excludes Paid — the select never offers it.
        onStage({
          kind: 'createVI',
          status: status as 'Received' | 'Scheduled',
          invoiceDate: date,
          referenceNumber: refNum,
          amount: parsedAmount,
        });
      }
      return;
    }

    setSubmitting(true);
    try {
      const parsedAmount = amountStr.trim() === '' ? null : Number(amountStr.replace(/,/g, ''));
      const refNum = referenceNumber.trim() || null;
      const dateVal = date || null;
      const statusVal = status || null;

      let input: CreateRecordInput;
      if (kind === 'payment') {
        input = {
          invoiceId: invoiceId || null,
          referenceNumber: refNum,
          status: statusVal,
          date: dateVal,
          amount: parsedAmount,
        } satisfies CreatePaymentInput;
      } else {
        input = {
          referenceNumber: refNum,
          status: statusVal,
          date: dateVal,
          amount: parsedAmount,
        } satisfies CreatePRInput;
      }

      await onCreate(input);
      toast(`${label} recorded`, refNum ?? undefined, 'success');
      onClose();
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  const isBusy = busy || submitting;

  return (
    <form
      id={formId}
      data-testid={cfg.formTestId}
      onSubmit={(e) => void handleSubmit(e)}
      className="flex flex-col gap-3 rounded-md border border-border/60 bg-card p-3"
      aria-label={`Capture ${label}`}
    >
      <p className="text-[12px] font-semibold text-muted-foreground">
        Capture {label}
      </p>

      {/* Reference number — bounded at 64 chars (NFR-PR-SEC-003) */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor={`${formId}-ref`}
          className="text-[12px] font-semibold text-muted-foreground"
        >
          {cfg.refLabel} <span className="font-normal">(optional)</span>
        </label>
        <input
          id={`${formId}-ref`}
          type="text"
          value={referenceNumber}
          onChange={(e) => setReferenceNumber(e.target.value)}
          maxLength={64}
          placeholder={cfg.refPlaceholder}
          data-testid={cfg.refTestId}
          className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13.5px] outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
      </div>

      {/* Two-column row: date + status */}
      <div className="flex flex-wrap gap-3">
        {/* Business date */}
        <div className="flex min-w-[140px] flex-1 flex-col gap-1">
          <label
            htmlFor={`${formId}-date`}
            className="text-[12px] font-semibold text-muted-foreground"
          >
            {cfg.dateLabel}
          </label>
          <input
            id={`${formId}-date`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            data-testid={cfg.dateTestId}
            className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13.5px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </div>

        {/* Status */}
        <div className="flex min-w-[140px] flex-1 flex-col gap-1">
          <label
            htmlFor={`${formId}-status`}
            className="text-[12px] font-semibold text-muted-foreground"
          >
            Status
          </label>
          <select
            id={`${formId}-status`}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            data-testid={cfg.statusTestId}
            className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13.5px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Amount — hidden for kinds without a money field (e.g. Goods Receipt) */}
      {cfg.showAmount && (
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${formId}-amount`}
            className="text-[12px] font-semibold text-muted-foreground"
          >
            Amount <span className="font-normal">(optional)</span>
          </label>
          <input
            id={`${formId}-amount`}
            type="text"
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder="0.00"
            data-testid={cfg.amountTestId}
            className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13.5px] tabular-nums outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </div>
      )}

      {/* [PD-5]: predecessor FK for payment — optional inline-select */}
      {cfg.showInvoiceFk && (
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${formId}-invoice`}
            className="text-[12px] font-semibold text-muted-foreground"
          >
            Links to invoice <span className="font-normal">(optional)</span>
          </label>
          <select
            id={`${formId}-invoice`}
            value={invoiceId}
            onChange={(e) => setInvoiceId(e.target.value)}
            data-testid="payment-invoice-select"
            className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13.5px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <option value="">— none —</option>
            {invoices.map((inv) => (
              <option key={inv.id} value={inv.id}>
                {inv.vi_number ?? inv.id}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={isBusy}
          data-testid={cfg.saveTestId}
        >
          {cfg.saveLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={isBusy}
          data-testid={cfg.cancelTestId}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
};

// ---------------------------------------------------------------------------
// Trigger button — shown before the form is open (ghost link, no solid blue,
// preserving the One-Blue Rule when a primary CTA exists on screen).
// ---------------------------------------------------------------------------

export interface RecordCaptureTriggerProps {
  kind: RecordKind;
  /** Whether the form is currently open. */
  open: boolean;
  onOpen: () => void;
}

// Per-kind trigger testid + label. GR/VI PRESERVE the prior inline triggers'
// `btn-create-gr` / `btn-create-vi` ids + "Record goods receipt" / "Record vendor
// invoice" copy (the unit + e2e BDD layer keys off these); the four generic kinds
// keep the `trigger-capture-${kind}` id + "Add <Kind>" copy.
function triggerConfig(kind: RecordKind): { testId: string; label: string } {
  if (kind === 'goods_receipt') return { testId: 'btn-create-gr', label: 'Record goods receipt' };
  if (kind === 'vendor_invoice') return { testId: 'btn-create-vi', label: 'Record vendor invoice' };
  return { testId: `trigger-capture-${kind}`, label: `Add ${KIND_LABEL[kind]}` };
}

export const RecordCaptureTrigger: React.FC<RecordCaptureTriggerProps> = ({
  kind,
  open,
  onOpen,
}) => {
  if (open) return null;
  const { testId, label } = triggerConfig(kind);
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onOpen}
      className="inline-flex items-center gap-1.5 rounded-md px-0 text-[13px] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Icon name="plus" className="size-3.5" />
      {label}
    </button>
  );
};

RecordCaptureForm.displayName = 'RecordCaptureForm';
RecordCaptureTrigger.displayName = 'RecordCaptureTrigger';
