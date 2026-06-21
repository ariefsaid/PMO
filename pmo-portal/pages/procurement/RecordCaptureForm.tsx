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

export type RecordKind = 'purchase_request' | 'rfq' | 'purchase_order' | 'payment';

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
};

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
}

const KIND_LABEL: Record<RecordKind, string> = {
  purchase_request: 'Purchase Request',
  rfq: 'RFQ',
  purchase_order: 'Purchase Order',
  payment: 'Payment',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const RecordCaptureForm: React.FC<RecordCaptureFormProps> = ({
  kind,
  onCreate,
  busy = false,
  invoices = [],
  onClose,
}) => {
  const { toast } = useToast();
  const [referenceNumber, setReferenceNumber] = useState('');
  const [status, setStatus] = useState(STATUS_OPTIONS[kind][0]?.value ?? '');
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
      data-testid={`form-capture-${kind}`}
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
          External ref <span className="font-normal">(optional)</span>
        </label>
        <input
          id={`${formId}-ref`}
          type="text"
          value={referenceNumber}
          onChange={(e) => setReferenceNumber(e.target.value)}
          maxLength={64}
          placeholder="e.g. VENDOR-PO-001"
          data-testid={`${kind}-ref-input`}
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
            Date
          </label>
          <input
            id={`${formId}-date`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            data-testid={`${kind}-date-input`}
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
            data-testid={`${kind}-status-select`}
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

      {/* Amount */}
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
          data-testid={`${kind}-amount-input`}
          className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13.5px] tabular-nums outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
      </div>

      {/* [PD-5]: predecessor FK for payment — optional inline-select */}
      {kind === 'payment' && (
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
          data-testid={`${kind}-save-btn`}
        >
          Save {label}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={isBusy}
          data-testid={`${kind}-cancel-btn`}
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

export const RecordCaptureTrigger: React.FC<RecordCaptureTriggerProps> = ({
  kind,
  open,
  onOpen,
}) => {
  if (open) return null;
  return (
    <button
      type="button"
      data-testid={`trigger-capture-${kind}`}
      onClick={onOpen}
      className="inline-flex items-center gap-1.5 rounded-md px-0 text-[13px] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Icon name="plus" className="size-3.5" />
      Add {KIND_LABEL[kind]}
    </button>
  );
};

RecordCaptureForm.displayName = 'RecordCaptureForm';
RecordCaptureTrigger.displayName = 'RecordCaptureTrigger';
