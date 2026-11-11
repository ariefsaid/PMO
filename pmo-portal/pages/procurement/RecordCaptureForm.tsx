import { useVendorInvoiceCapture } from './useVendorInvoiceCapture';
import { PaymentCaptureFields } from './PaymentCaptureFields';
import { VendorInvoiceCaptureFields } from './VendorInvoiceCaptureFields';
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
import type { TFunction } from 'i18next';
import { Button, ConfirmDialog, FieldError, Icon, SelectField, useMoneyInputMask, useToast } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { ProcurementInvoiceRow, TaxTreatment } from '@/src/lib/db/procurementLifecycle';
import { RECORD_AMOUNT_ERROR, parseRecordAmount } from './recordAmount';
import { useCommandIntent } from '@/src/hooks/useCommandIntent';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { OdooJournalSelect } from '@/src/components/procurement/OdooDirectoryPickers';
import { OdooReceiptQuantities } from '@/src/components/procurement/OdooReceiptQuantities';
import { parseReceiptQuantities, type ReceiptItem, type ReceiptLine } from '@/src/lib/procurement/receiptQuantities';
import { odooOwnsProcurement } from '@/src/lib/adapterSeam/odoo/ownership';
import { useOrgFeatures } from '@/src/hooks/useOrgFeatures';
import { odooActionError } from '@/src/lib/procurement/odooActionError';
import type { ErpVendorTaxAmounts, PphType } from '@/src/lib/vendorWithholding';
import { useTranslation } from 'react-i18next';
import { groupRefIsPmoAuthored } from './groupRef';
import { formatMoneyInputValue } from '@/src/lib/format';
import type { CommandIntent } from '@/src/lib/repositories/types';
import type { VendorInvoiceContext } from '@/src/components/procurement/vendorInvoiceIdentityLabels';
import { SubcontractBillLines } from './SubcontractBillLines';
import type { SubcontractBillLineInput } from '@/src/lib/db/subcontracts';

import { type RecordKind, STATUS_OPTIONS, GROUP_REF_KINDS, localizedRecordKindLabel, statusOptionLabel, kindConfig } from './recordCaptureConfig';
export type { RecordKind };

// ---------------------------------------------------------------------------
// Mutation input shapes — mirrored from useProcurementRecords
// ---------------------------------------------------------------------------

export interface CreatePRInput {
  referenceNumber: string | null;
  /** #769: the parent group's number (PR/PO/VI only). */
  externalRef?: string | null;
  status: string | null;
  date: string | null;
  amount: number | null;
  /** BLOCK 2 (ADR-0058): the capture form's OWN command identity — the SAME on every retry. */
  intent?: CommandIntent;
}

export interface CreateRfqInput {
  referenceNumber: string | null;
  status: string | null;
  date: string | null;
  amount: number | null;
  intent?: CommandIntent;
}

export interface CreatePOInput {
  referenceNumber: string | null;
  /** #769: the parent group's number (PR/PO/VI only). */
  externalRef?: string | null;
  status: string | null;
  date: string | null;
  amount: number | null;
  intent?: CommandIntent;
}

export interface CreatePaymentInput {
  invoiceId: string | null;
  referenceNumber: string | null;
  status: string | null;
  date: string | null;
  amount: number | null;
  intent?: CommandIntent;
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
  /** BLOCK 2 (ADR-0058): the capture form's OWN command identity — carried through the confirm so a
   *  retry of the same capture reuses it (the committed ERP doc is reconciled, not duplicated). */
  intent: CommandIntent;
  status: 'Partial' | 'Complete';
  receiptDate: string;
  referenceNumber: string | null;
  /** #1505 P8: the quantities entered per line on an Odoo-owned org (absent = everything still open). */
  receiptLines?: ReceiptLine[];
}

export interface StagedVI {
  kind: 'createVI';
  /** BLOCK 2 (ADR-0058): see StagedGR.intent. */
  intent: CommandIntent;
  /** N1: Paid excluded — Mark as Paid is the sole PR→Paid authority. */
  status: 'Received' | 'Scheduled';
  invoiceDate: string;
  referenceNumber: string | null;
  /** #769: the parent group's number for this invoice. */
  externalRef?: string | null;
  amount: number | null;
  /** Present for a subcontract purchase; the page routes these lines through the capped RPC. */
  lines?: SubcontractBillLineInput[];
  /** #505: REQUIRED — the staged payload carries the tax facts through the confirm to the RPC.
   *  Non-optional on purpose: a staged VI that reaches the confirm dialog without them would fail
   *  at commit with P0001 after the user has already confirmed. */
  taxTreatment: TaxTreatment;
  taxAmount: number;
  taxRate?: number | null;
  taxBaseNumerator?: number;
  taxBaseDenominator?: number;
  /** #520: the ERPNext Purchase Taxes and Charges Template chosen on a flipped org. */
  taxTemplate?: string;
  /** #876 slice 2: tax withheld on a standalone bill and its PPh type (OQ-VWH-6) — present only when > 0. */
  withheldAmount?: number;
  withheldPphType?: PphType;
  /** #876 slice 2 (DD-VWH-13/14): the VAT / PPh entered for an ERP-bound bill ("Enter the tax amounts" mode). */
  erpTaxAmounts?: ErpVendorTaxAmounts;
  /** #1505 P8: the taxes picked from the Odoo tax directory on an Odoo-owned org (absent = the organisation default). */
  taxIds?: string[];
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
  /** Display-only case/project facts already loaded with the owning procurement. */
  invoiceIdentityContext?: VendorInvoiceContext;
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
  /** #876 slice 2 (OD-VWH-1): the procurement's vendor — its default tax treatment pre-fills a vendor invoice. */
  vendorId?: string | null;
  /** #876 slice 2: the case's items total before tax — the base an ERP-bound bill's tax is pre-filled on. */
  itemsNet?: number | null;
  /** #1505 P8: the case's lines; an Odoo-owned org enters the quantity received against them (FR-OPP-030). */
  items?: readonly ReceiptItem[];
  /** The purchase's currency. The server records the document in it (no conversion), so the amount field names it. */
  currency?: string | null;
  /** Issued subcontract PO whose payable BoQ quantities cap this invoice. */
  subcontractPoId?: string;
  /** Reports local draft edits to a host that guards route navigation. */
  onDirtyChange?: (dirty: boolean) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const RecordCaptureForm: React.FC<RecordCaptureFormProps> = ({
  kind,
  onCreate,
  busy = false,
  invoices = [],
  invoiceIdentityContext,
  onClose,
  onStage,
  vendorId = null,
  itemsNet = null,
  items = [],
  currency = null,
  subcontractPoId,
  onDirtyChange,
}) => {
  const { toast } = useToast();
  const { t } = useTranslation();
  const cfg = kindConfig(kind);
  // #910 (DD-VPAY-8): the payment capture NEVER asks for a status — the form's `{Pending, Processed,
  // Cleared}` options are illegal against the `payments.status ('Scheduled','Paid')` CHECK (0035), so
  // every native form capture from this form failed (0178). The native RPC coalesces a null status to
  // `Scheduled`; the external wire record omits status entirely (DD-VPAY-1) — the ERP docstatus is
  // the only status truth. Other kinds keep their selects.
  const isPayment = kind === 'payment';
  // #910 (DD-VPAY-3 + DD-VPAY-10, FR-VPAY-010): on a FLIPPED org (the same org-level predicate the
  // group-ref hide uses) the dispatched payment must name its bill — so the invoice FK is required,
  // and selecting a bill prefills the amount with its mirrored ERP outstanding (what we actually
  // owe, net of withholding). On a PMO-native org the FK stays optional (nullable predecessor).
  const paymentBillRequired = isPayment && !groupRefIsPmoAuthored();
  const [billError, setBillError] = useState<string | undefined>(undefined);
  const [referenceNumber, setReferenceNumber] = useState('');
  const [groupRef, setGroupRef] = useState('');
  // Hidden on an ERP-owned org: the dispatched create never carries it (see groupRefIsPmoAuthored).
  const hasGroupRef = GROUP_REF_KINDS.has(kind) && groupRefIsPmoAuthored();
  const today = useOrgToday();
  const [status, setStatus] = useState(cfg.defaultStatus);
  const [date, setDate] = useState(today);
  const [amountStr, setAmountStr] = useState('');
  const [amountError, setAmountError] = useState<string | undefined>(undefined);
  const [subcontractBill, setSubcontractBill] = useState<{ lines: SubcontractBillLineInput[]; amount: number } | null>(null);
  // #684: both money drafts group in the viewer's number convention as the user types.
  const amountMask = useMoneyInputMask(amountStr, (next) => {
    setAmountStr(next);
    setAmountError(undefined);
  });
  // [PD-5]: predecessor FK for payment — optional, defaults to none.
  const [invoiceId, setInvoiceId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [captureError, setCaptureError] = useState<{ headline: string; detail: string } | null>(null);
  // BLOCK 2 (MONEY-CRITICAL, ADR-0058): ONE command identity for this capture SESSION. The form is
  // mounted only while open and stays open on failure, so every retry carries the SAME identity —
  // a lost response can no longer turn one capture into two submitted ERP documents. A success
  // unmounts the form (`onClose`), so the next capture mints a fresh one.
  const intent = useCommandIntent();

  const markDirty = () => {
    if (formDirty) return;
    setFormDirty(true);
    onDirtyChange?.(true);
  };
  const dismissForm = () => {
    if (formDirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  };
  const discardDraft = () => {
    setDiscardOpen(false);
    setFormDirty(false);
    onDirtyChange?.(false);
    onClose();
  };

  const label = localizedRecordKindLabel(kind, t);
  // AC-PLN-008 (#1783 item 1, D17): the quantity grid is a Full affordance. The org's RESOLVED
  // entitlement read is the projection (the served receipt-line guard stays the authority); only a
  // ready literal `true` counts — `useFeature`'s default-true placeholder must never open the grid.
  const { data: orgFeatureData, isLoading: orgFeaturesLoading, isError: orgFeaturesError, refetch: refetchOrgFeatures } = useOrgFeatures();
  const statusOptions = STATUS_OPTIONS[kind].map((value) => ({ value, label: statusOptionLabel(value, t) }));
  const formId = `record-capture-${kind}`;
  const isVendorInvoice = kind === 'vendor_invoice';
  const isSubcontractInvoice = isVendorInvoice && Boolean(subcontractPoId);
  const odooProcurement = odooOwnsProcurement();
  const vi = useVendorInvoiceCapture({ isVendorInvoice, odooProcurement, vendorId, itemsNet, amountStr });
  const { pmoAuthorsTax, odooBill, choosesErpTaxTemplate, taxIncomplete, vendorTax } = vi;
  const [odooJournalId, setOdooJournalId] = useState('');
  // A receipt on an Odoo-owned org: the quantity per line replaces the typed Partial/Complete (Odoo derives the status, FR-OPP-034).
  const odooReceipt = kind === 'goods_receipt' && odooProcurement && items.length > 0;
  const [receiptQty, setReceiptQty] = useState<Record<string, string>>({});
  const [receiptInvalid, setReceiptInvalid] = useState<string | undefined>(undefined);
  // Full is READY only when the resolved read landed with a literal true (loading/error/off are not on).
  const receiptFullReady = !orgFeaturesLoading && !orgFeaturesError && orgFeatureData?.procurement_full === true;
  // A typed partial draft (valid or not) is real user intent — it must never be silently discarded or
  // silently received in full when the entitlement moves under it (AC-PLN-008).
  const receiptHasDraft = Object.values(receiptQty).some((v) => v.trim() !== '');
  // The grid stays visible while a draft exists even when Full is unavailable, so the user can see,
  // retry or explicitly clear what they typed; without a draft the whole-receipt form shows instead.
  const showsQtyGrid = odooReceipt && (receiptFullReady || receiptHasDraft);
  // While blocked, staging and submission are refused BOTH by the disabled save and by an early
  // return inside handleSubmit — a programmatic submit (Enter key) can never stage the lines.
  const receiptBlockedByFeature = odooReceipt && receiptHasDraft && !receiptFullReady;
  // OQ-VWH-8: the bill amount is never sent on the ERP path (ERPNext totals the items), so it is not asked there.
  const showsAmount = cfg.showAmount && !choosesErpTaxTemplate && !odooBill;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCaptureError(null);

    // AC-PLN-008 (#1783 item 1): a partial draft while the line-receipt entitlement is unavailable can
    // never stage or submit — the disabled button AND this guard together cover every submit path.
    if (receiptBlockedByFeature) return;

    // #684 (AC-PLC-009): ONE parse of the amount draft, used for both the verdict and the write.
    // A value the numeric(14,2) column would have to round is refused here, before any write.
    const amountParse = showsAmount ? parseRecordAmount(amountStr) : ({ ok: true, amount: null } as const);
    if (!amountParse.ok) {
      setAmountError(RECORD_AMOUNT_ERROR);
      return;
    }
    const parsedAmount = amountParse.amount;
    if (isSubcontractInvoice && (!subcontractBill || subcontractBill.lines.length === 0)) return;

    // GR/VI confirm-before-commit hand-off (refactor: procurement-detail-dedup).
    // When `onStage` is provided we stage the parsed fields for the page's
    // ConfirmDialog INSTEAD of creating directly — no toast, no `onCreate`, no
    // `onClose` (the page closes the form once the staged write commits).
    if (onStage && (kind === 'goods_receipt' || kind === 'vendor_invoice')) {
      const refNum = referenceNumber.trim() || null;
      if (kind === 'goods_receipt') {
        const parsedQty = odooReceipt ? parseReceiptQuantities(items, receiptQty) : { lines: [] as ReceiptLine[] };
        if ('invalid' in parsedQty) { setReceiptInvalid(parsedQty.invalid); return; }
        onStage({
          kind: 'createGR',
          intent,
          status: status as 'Partial' | 'Complete',
          receiptDate: date,
          referenceNumber: refNum,
          ...(parsedQty.lines.length ? { receiptLines: parsedQty.lines } : {}),
        });
      } else {
        // #505: refuse to stage without the tax facts. Unreachable through the UI (Save VI is
        // disabled), but staging an incomplete VI would surface P0001 AFTER the user confirmed.
        const taxFacts = vi.stagedTaxFacts();
        if (!taxFacts) return;
        // N1: status excludes Paid — the select never offers it.
        onStage({
          kind: 'createVI',
          intent,
          status: status as 'Received' | 'Scheduled',
          invoiceDate: date,
          referenceNumber: refNum,
          ...(hasGroupRef && groupRef.trim() ? { externalRef: groupRef.trim() } : {}),
          amount: isSubcontractInvoice && subcontractBill ? subcontractBill.amount : parsedAmount,
          ...(isSubcontractInvoice && subcontractBill ? { lines: subcontractBill.lines } : {}),
          ...taxFacts,
        });
      }
      return;
    }

    setSubmitting(true);
    try {
      const refNum = referenceNumber.trim() || null;
      const dateVal = date || null;
      // DD-VPAY-8: a payment never sends a status — not the (hidden, illegal) select value.
      const statusVal = isPayment ? null : (status || null);

      // DD-VPAY-3: on a flipped org the payment MUST name its bill — refused here, locally, before
      // any dispatch call (the server gate is the authority; this is the form not throwing blind).
      if (paymentBillRequired && !invoiceId) {
        setBillError(t('procurementDetail.paymentBillRequired', 'Select the supplier invoice this payment closes.'));
        setSubmitting(false);
        return;
      }

      let input: CreateRecordInput;
      if (kind === 'payment') {
        input = {
          invoiceId: invoiceId || null,
          referenceNumber: refNum,
          status: statusVal,
          date: dateVal,
          amount: parsedAmount,
          ...(odooProcurement && odooJournalId ? { journalId: odooJournalId } : {}),
          intent,
        } satisfies CreatePaymentInput;
      } else {
        input = {
          referenceNumber: refNum,
          ...(hasGroupRef && groupRef.trim() ? { externalRef: groupRef.trim() } : {}),
          status: statusVal,
          date: dateVal,
          amount: parsedAmount,
          intent,
        } satisfies CreatePRInput;
      }

      await onCreate(input);
      toast(isPayment ? t('procurementDetail.paymentRecorded', 'Payment recorded') : t('procurementDetail.captureRecorded', '{{label}} recorded', { label }), refNum ?? undefined, 'success');
      setFormDirty(false);
      onDirtyChange?.(false);
      onClose();
    } catch (err) {
      const paymentConflict = (err as { code?: unknown } | null)?.code === 'payment-in-flight-for-bill'
        ? {
            headline: t('procurementRecord:errors.paymentInFlight.title', 'Payment already in progress'),
            detail: t(
              'procurementRecord:errors.paymentInFlight.detail',
              'A payment for this bill is already in progress. Wait for it to finish before paying again.',
            ),
          }
        : null;
      const { headline, detail } = odooActionError(err, odooProcurement, t) ?? paymentConflict ?? classifyMutationError(err);
      setCaptureError({ headline, detail });
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
      onChangeCapture={markDirty}
      className="flex flex-col gap-3 rounded-md border border-border/60 bg-card p-3"
      aria-label={t('procurementDetail.captureForm', 'Capture {{record}}', { record: label })}
    >
      <p className="text-sm font-semibold text-muted-foreground">
        {t('procurementDetail.captureForm', 'Capture {{record}}', { record: label })}
      </p>

      {captureError && (
        <div role="alert" data-testid="record-capture-error" className="flex flex-col gap-1 rounded-md border border-destructive/25 bg-destructive/[0.04] px-3 py-2 text-sm text-destructive-text">
          <p className="font-semibold">{captureError.headline}</p>
          {captureError.detail && <p>{captureError.detail}</p>}
        </div>
      )}

      {/* Reference number — bounded at 64 chars (NFR-PR-SEC-003) */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor={`${formId}-ref`}
          className="text-sm font-semibold text-muted-foreground"
        >
          {kind === 'payment'
            ? t('procurementDetail.externalRefOptional', 'External ref (optional)')
            : kind === 'vendor_invoice'
              ? t('procurementDetail.vendorInvoice.invoiceNumber', 'Invoice #')
              : cfg.refLabel} {kind !== 'payment' && <span className="font-normal">({t('procurementDetail.vendorInvoice.optional', 'optional')})</span>}
        </label>
        <input
          id={`${formId}-ref`}
          type="text"
          value={referenceNumber}
          onChange={(e) => setReferenceNumber(e.target.value)}
          maxLength={64}
          placeholder={cfg.refPlaceholder}
          data-testid={cfg.refTestId}
          className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
      </div>

      {/* #769: the parent group's own number — PR / PO / vendor invoice only; bounded at 100 chars */}
      {hasGroupRef && (
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${formId}-group-ref`}
            className="text-sm font-semibold text-muted-foreground"
          >
            {t('procurementDetail.groupRef.label', 'Group ref')}{' '}
            <span className="font-normal">{t('procurementDetail.groupRef.optional', '(optional)')}</span>
          </label>
          <input
            id={`${formId}-group-ref`}
            type="text"
            value={groupRef}
            onChange={(e) => setGroupRef(e.target.value)}
            maxLength={100}
            placeholder={t('procurementDetail.groupRef.placeholder', 'e.g. PRQ-0026100001')}
            data-testid={`${kind}-group-ref-input`}
            className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </div>
      )}

      {/* Two-column row: date + status */}
      <div className="flex flex-wrap gap-3">
        {/* Business date */}
        <div className="flex min-w-[140px] flex-1 flex-col gap-1">
          <label
            htmlFor={`${formId}-date`}
            className="text-sm font-semibold text-muted-foreground"
          >
            {kind === 'vendor_invoice'
              ? t('procurementDetail.vendorInvoice.invoiceDate', 'Invoice date')
              : cfg.dateLabel === 'procurementDetail.dateLabel'
                ? t('procurementDetail.dateLabel', 'Date')
                : cfg.dateLabel}
          </label>
          <input
            id={`${formId}-date`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            data-testid={cfg.dateTestId}
            className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </div>

        {/* Status — never rendered for a payment: DD-VPAY-8 (the options are illegal; null is sent). */}
        {!isPayment && !showsQtyGrid && (
          <div className="min-w-[140px] flex-1">
            <SelectField
              id={`${formId}-status`}
              label={isVendorInvoice ? t('procurementDetail.vendorInvoice.invoiceStatus', 'Invoice status') : t('procurementDetail.status', 'Status')}
              value={status}
              onChange={setStatus}
              options={statusOptions.map((option) => isVendorInvoice
                ? { ...option, label: option.value === 'Received'
                  ? t('procurementDetail.vendorInvoice.received', 'Received')
                  : t('procurementDetail.vendorInvoice.scheduled', 'Scheduled') }
                : option)}
              data-testid={cfg.statusTestId}
            />
          </div>
        )}
      </div>

      {showsQtyGrid && <OdooReceiptQuantities items={items} value={receiptQty} onChange={(next) => { setReceiptQty(next); setReceiptInvalid(undefined); }} invalid={receiptInvalid} />}

      {/* AC-PLN-008 (#1783 item 1): a typed draft while Full is unavailable is kept visible but blocked.
          The status explains itself; retry re-reads the entitlement; the ONLY way out is the explicit
          clear, which switches this submission to the whole receipt (existing confirmation retained). */}
      {receiptBlockedByFeature && (
        <div role="status" className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-status-warning-surface p-2">
          <p className="text-sm font-medium text-warning-foreground">
            {t('procurement:odoo.receipt.fullUnavailable', 'Line quantities are kept, but they cannot be submitted while line-level receipts are unavailable. Clear them to receive everything still open.')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => refetchOrgFeatures()}
              disabled={orgFeaturesLoading}
              data-testid="gr-full-retry"
            >
              {t('procurement:odoo.receipt.retry', 'Retry')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setReceiptQty({}); setReceiptInvalid(undefined); }}
              data-testid="gr-clear-quantities"
            >
              {t('procurement:odoo.receipt.clearAll', 'Clear quantities and receive all open items')}
            </Button>
          </div>
        </div>
      )}

      {/* Amount — hidden for kinds without a money field (e.g. Goods Receipt) */}
      {isSubcontractInvoice && subcontractPoId && (
        <SubcontractBillLines
          poId={subcontractPoId}
          currency={currency ?? ''}
          onChange={(lines, amount) => {
            setSubcontractBill({ lines, amount });
            setAmountStr(formatMoneyInputValue(amount));
            setAmountError(undefined);
          }}
        />
      )}
      {showsAmount && (
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${formId}-amount`}
            className="text-sm font-semibold text-muted-foreground"
          >
            {isSubcontractInvoice
              ? t('procurement:subcontract.bill.amountFromLines', 'Amount from payable lines')
              : kind === 'vendor_invoice'
                ? t('procurementDetail.vendorInvoice.amountOptional', 'Amount (optional)')
                : t('procurementDetail.amountOptional', 'Amount (optional)')}
            {currency ? ` · ${currency}` : null}
          </label>
          <input
            id={`${formId}-amount`}
            type="text"
            inputMode="decimal"
            ref={amountMask.ref}
            value={amountStr}
            onChange={isSubcontractInvoice ? undefined : amountMask.onChange}
            readOnly={isSubcontractInvoice}
            aria-invalid={amountError ? true : undefined}
            aria-describedby={amountError ? `${formId}-amount-error` : undefined}
            placeholder="0.00"
            data-testid={cfg.amountTestId}
            className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm tabular-nums outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <FieldError id={`${formId}-amount-error`}>{amountError}</FieldError>
        </div>
      )}

      <VendorInvoiceCaptureFields formId={formId} capture={vi} isVendorInvoice={isVendorInvoice} />

      {/* [PD-5]: predecessor FK for payment — required on a flipped org (DD-VPAY-3), optional otherwise */}
      {cfg.showInvoiceFk && (
        <PaymentCaptureFields
          formId={formId}
          invoices={invoices}
          invoiceIdentityContext={invoiceIdentityContext}
          paymentBillRequired={paymentBillRequired}
          odooProcurement={odooProcurement}
          invoiceId={invoiceId}
          billError={billError}
          onSelect={(next) => { setInvoiceId(next); setBillError(undefined); }}
          onOutstandingAmount={(formatted) => { setAmountStr(formatted); setAmountError(undefined); }}
        />
      )}

      {isPayment && odooProcurement && <OdooJournalSelect value={odooJournalId} onChange={setOdooJournalId} id={`${formId}-journal`} />}

      {isVendorInvoice && pmoAuthorsTax && !amountStr && vendorTax?.pphType && taxIncomplete && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('procurementDetail.withholdingNeedsAmount', 'Enter the bill amount to calculate the supplier withholding.')}
        </p>
      )}

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={isBusy}
          // #505: a VI cannot be saved until its tax treatment + tax amount are stated.
          // AC-PLN-008 (#1783 item 1): a partial receipt draft under an unavailable entitlement cannot
          // be saved either — the submit-time guard inside handleSubmit is the second half of this rule.
          disabled={taxIncomplete || (isSubcontractInvoice && !subcontractBill?.lines.length) || receiptBlockedByFeature}
          data-testid={cfg.saveTestId}
        >
          {kind === 'payment' ? t('procurementDetail.savePayment', 'Save Payment') : kind === 'vendor_invoice' ? t('procurementDetail.confirm.saveVI', 'Save supplier invoice') : cfg.saveLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={dismissForm}
          disabled={isBusy}
          data-testid={cfg.cancelTestId}
        >
          {t('financeCopy.cancel', 'Cancel')}
        </Button>
      </div>
      <ConfirmDialog
        open={discardOpen}
        title={t('entityForm.discardTitle', 'Discard your changes?')}
        description={t('entityForm.discardBody', 'This form has unsaved changes. Discarding will lose them.')}
        confirmLabel={t('entityForm.discard', 'Discard')}
        cancelLabel={t('entityForm.stay', 'Stay')}
        onConfirm={discardDraft}
        onCancel={() => setDiscardOpen(false)}
      />
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
function triggerConfig(kind: RecordKind, t: TFunction): { testId: string; label: string } {
  if (kind === 'goods_receipt') return { testId: 'btn-create-gr', label: t('procurementDetail.recordGoodsReceipt', 'Record goods receipt') };
  if (kind === 'vendor_invoice') return { testId: 'btn-create-vi', label: t('procurementDetail.recordVendorInvoice', 'Record supplier invoice') };
  return {
    testId: `trigger-capture-${kind}`,
    label: t('procurementDetail.addRecord', 'Add {{record}}', { record: localizedRecordKindLabel(kind, t) }),
  };
}

export const RecordCaptureTrigger: React.FC<RecordCaptureTriggerProps> = ({
  kind,
  open,
  onOpen,
}) => {
  const { t } = useTranslation();
  if (open) return null;
  const { testId, label } = triggerConfig(kind, t);
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onOpen}
      className="inline-flex items-center gap-1.5 rounded-md px-0 text-sm font-medium text-primary-text underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Icon name="plus" className="size-3.5" />
      {label}
    </button>
  );
};

RecordCaptureForm.displayName = 'RecordCaptureForm';
RecordCaptureTrigger.displayName = 'RecordCaptureTrigger';
