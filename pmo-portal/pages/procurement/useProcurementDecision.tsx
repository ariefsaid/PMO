import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ProjectNameLink, useToast } from '@/src/components/ui';
import type { useProcurementMutations } from '@/src/hooks/useProcurementDetail';
import { formatCurrency } from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { odooActionError } from '@/src/lib/procurement/odooActionError';
import { odooOwnsProcurement } from '@/src/lib/adapterSeam/odoo/ownership';
import type { CommandIntent } from '@/src/lib/repositories/types';
import type { ErpVendorTaxAmounts, PphType } from '@/src/lib/vendorWithholding';
import type { SubcontractBillLineInput } from '@/src/lib/db/subcontracts';
import type { ProcurementStatus, ProcurementDetail, TaxTreatment } from '@/src/lib/db/procurementLifecycle';
import { toastStateLabel } from '../../components/procurement';
import { classifySubcontractBillError } from './subcontractBillError';
import type { ActionVariant } from '@/src/lib/procurement/mainAction';
import type { VendorInvoiceCapture } from './ProcurementDecisionZone';


/** A staged, not-yet-committed mutation awaiting the ConfirmDialog. */
export type PendingConfirm =
  | {
      kind: 'transition';
      to: ProcurementStatus;
      title: string;
      /** Per-target dialog body. The kept financial confirms (Approve / Mark as Paid)
       *  RESTATE the amount + project + requester here (OD-UX-1, confirm against the money). */
      description: React.ReactNode;
      confirmLabel: string;
      /** Dismiss-button label; defaults to "Cancel" but the PR-cancel flow uses
       *  "Keep request" so the dismiss never reads as "cancel the cancellation". */
      cancelLabel?: string;
      tone: 'default' | 'destructive';
    }
  | {
      kind: 'createGR';
      status: 'Partial' | 'Complete';
      receiptDate: string;
      referenceNumber: string | null;
      /** #1505 P8: quantities entered per line on an Odoo-owned org (absent = everything still open). */
      receiptLines?: Array<{ itemRef: string; quantity: number }>;
      /** BLOCK 2 (ADR-0058): the capture form's command identity, carried verbatim to the commit. */
      intent: CommandIntent;
    }
  | {
      kind: 'createVI';
      /** N1: Paid removed — Mark as Paid is the sole PR→Paid authority (AC-W3-N1). */
      status: 'Received' | 'Scheduled';
      invoiceDate: string;
      referenceNumber: string | null;
      /** #769: the parent group's number for this invoice. */
      externalRef?: string | null;
      amount: number | null;
      /** Present when the existing supplier-invoice form captures a capped subcontract bill. */
      lines?: SubcontractBillLineInput[];
      /** #505: REQUIRED — staged from the capture form and carried verbatim through the confirm to
       *  the RPC, so the confirmed write can never be the one that discovers they are missing. */
      taxTreatment: TaxTreatment;
      taxAmount: number;
      taxRate?: number | null;
      taxBaseNumerator?: number;
      taxBaseDenominator?: number;
      /** #520: the ERPNext purchase tax template chosen on a flipped org. */
      taxTemplate?: string;
      /** #876 slice 2: standalone tax withheld + its PPh type (only when > 0, OQ-VWH-6) and the ERP-bound entered amounts. */
      withheldAmount?: number;
      withheldPphType?: PphType;
      erpTaxAmounts?: ErpVendorTaxAmounts;
      /** #1505 P8: taxes picked from the Odoo directory (absent = the organisation default). */
      taxIds?: string[];
      /** BLOCK 2 (ADR-0058): see the createGR variant. */
      intent: CommandIntent;
    };

// ── Write policy (OD-UX-1): a transition gets a ConfirmDialog IFF it is
//    consequential/financial — the set {Approve, Reject, Cancel, Mark-as-Paid}.
//    Every other routine, reversible forward step (Submit Request, Request Vendor
//    Quotes, Generate Purchase Order, Confirm Receipt, Mark Vendor Invoiced) is
//    SINGLE-CLICK + a quiet success toast (no modal). The kept financial confirms
//    RESTATE the amount + project + requester (confirm against the money — the
//    contract-value SoD confirm is the template). PRESERVED RPC contract.
const CONSEQUENTIAL_TARGETS = new Set<ProcurementStatus>([
  'Approved',
  'Rejected',
  'Cancelled',
  'Paid',
]);


/** The money/context the kept financial confirms restate (Approve, Mark as Paid). */
function transitionMoney(p: ProcurementDetail) {
  // The shared money/context line the kept financial confirms restate.
  //
  // #571 — ONE key per shape, never "amount" + " on " + "…, requested by ". The optional project
  // and requester clauses are what forced the fragments, so each combination gets its own whole
  // sentence with the pieces as placeholders a translator can reorder.
  const moneyAmount = formatCurrency(Number(p.total_value), p.currency);
  const scheduledPayments = (p.payments ?? []).filter((payment) => payment.status === 'Scheduled');
  const payableInvoices = p.invoices.filter((invoice) => invoice.amount != null);
  const paidConfirmationAmount = scheduledPayments.length > 0
    ? scheduledPayments.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0)
    : payableInvoices.length > 0
      ? payableInvoices.reduce((sum, invoice) => sum + Number(invoice.amount)
          + (invoice.tax_treatment === 'exclusive' ? Number(invoice.tax_amount ?? 0) : 0)
          - Number(invoice.withheld_amount ?? 0), 0)
      : Number(p.total_value);
  const paidMoneyAmount = formatCurrency(paidConfirmationAmount, p.currency);
  const moneyProject = p.project?.name ?? null;
  const moneyRequester = p.requested_by?.full_name ?? null;
  const moneyContext = moneyProject ? (
    moneyRequester ? (
      <Trans
        i18nKey="procurementDetail.confirm.moneyOnProjectRequestedBy"
        defaults="<amount>{{amount}}</amount> on <project/>, requested by <person>{{name}}</person>"
        values={{ amount: moneyAmount, name: moneyRequester }}
        components={{
          amount: <b />,
          project: <ProjectNameLink projectId={p.project_id} name={moneyProject} />,
          person: <i />,
        }}
      />
    ) : (
      <Trans
        i18nKey="procurementDetail.confirm.moneyOnProject"
        defaults="<amount>{{amount}}</amount> on <project/>"
        values={{ amount: moneyAmount }}
        components={{
          amount: <b />,
          project: <ProjectNameLink projectId={p.project_id} name={moneyProject} />,
        }}
      />
    )
  ) : moneyRequester ? (
    <Trans
      i18nKey="procurementDetail.confirm.moneyRequestedBy"
      defaults="<amount>{{amount}}</amount>, requested by <person>{{name}}</person>"
      values={{ amount: moneyAmount, name: moneyRequester }}
      components={{ amount: <b />, person: <i /> }}
    />
  ) : (
    <b>{moneyAmount}</b>
  );
  return { moneyContext, paidMoneyAmount };
}

/** Where the decision flow reaches back into the page: its own open/closed panels and tab. */
export interface ProcurementDecisionUi {
  setTab: (tab: 'quotes') => void;
  notesInput: string;
  setNotesInput: (value: string) => void;
  setMutationError: (message: string | null) => void;
  setShowCreateGR: (open: boolean) => void;
  setShowCreateVI: (open: boolean) => void;
  setShowVICapture: (open: boolean) => void;
  setCaptureKind: (kind: null) => void;
}

/**
 * The stage-decision workflow of the record page: stages a transition / receipt / invoice behind the
 * ConfirmDialog, then commits it (confirm-before-write, OD-UX-1). Owns the staged confirm and the
 * rejection comment; everything it touches on the page comes in through `ui`.
 */
export function useProcurementDecision(
  procurement: ProcurementDetail | undefined,
  mutations: ReturnType<typeof useProcurementMutations>,
  ui: ProcurementDecisionUi,
) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { setTab, notesInput, setNotesInput, setMutationError, setShowCreateGR, setShowCreateVI, setShowVICapture, setCaptureKind } = ui;
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [rejectionComment, setRejectionComment] = useState('');

  const onActionClick = (action: { to: ProcurementStatus; label: string; variant: ActionVariant }) => {
    setMutationError(null);
    if (action.to === 'Quote Selected') {
      setTab('quotes');
      return;
    }
    // O3 (AC-W3-O3): "Mark Vendor Invoiced" opens an inline capture so the invoice
    // reference + date + status are recorded BEFORE the transition fires (co-locate
    // capture with the action, mirroring the DealBand Mark-won pattern).
    if (action.to === 'Vendor Invoiced') {
      setShowVICapture(true);
      return;
    }
    if (!CONSEQUENTIAL_TARGETS.has(action.to)) {
      // Routine reversible forward step → commit directly, no dialog.
      void commitTransition(action.to);
      return;
    }
    if (!procurement) return;
    const { moneyContext, paidMoneyAmount } = transitionMoney(procurement);
    setRejectionComment('');
    const destructive = action.variant === 'destructive';
    const isCancel = action.to === 'Cancelled';
    // The commit verb (action.label is already "Cancel request" for the cancel
    // flow). The dismiss is "Keep request" ONLY for the cancel flow so the three
    // Cancels disambiguate (polish #2): page action "Cancel request" → confirm
    // "Cancel request" / "Keep request". Other destructive moves keep "Cancel".
    // Approve / Mark-as-Paid restate the money (task 10); Reject / Cancel are the
    // terminal destructive moves (the only other consequential targets).
    const description: React.ReactNode =
      action.to === 'Approved' ? (
        <Trans
          i18nKey="procurementDetail.confirm.approveBody"
          defaults="Approve <money/>?"
          components={{ money: <span>{moneyContext}</span> }}
        />
      ) : action.to === 'Paid' ? (
        <Trans
          i18nKey="procurementDetail.confirm.markPaidBody"
          defaults="Record {{amount}} as paid? This records payment evidence; it does not transfer funds."
          values={{ amount: paidMoneyAmount }}
        />
      ) : (
        t(
          'procurementDetail.confirm.terminal',
          'This is a terminal action for this procurement and cannot be undone.',
        )
      );
    setPendingConfirm({
      kind: 'transition',
      to: action.to,
      title: isCancel
        ? t('procurementDetail.confirm.cancelTitle', 'Cancel this procurement?')
        : destructive
          ? t('procurementDetail.confirm.destructiveTitle', '{{action}} this procurement', {
              action: action.label,
            })
          : `${action.label}?`,
      description,
      confirmLabel: action.label,
      cancelLabel: isCancel
        ? t('procurementDetail.confirm.keepRequest', 'Keep procurement')
        : undefined,
      tone: destructive ? 'destructive' : 'default',
    });
  };

  // ── Run a transition (shared by the routine single-click path and the confirm
  //    path). Toast is classified by the preserved RPC error code (sub-task b) so
  //    an illegal-stage / SoD failure reads as such instead of a silent no-op.
  const commitTransition = async (to: ProcurementStatus) => {
    try {
      // A rejection's notes are the required comment from its confirm, not the approval-note box.
      const notes = to === 'Rejected' ? rejectionComment.trim() : notesInput;
      await mutations.transition.mutateAsync({ to, notes: notes || undefined });
      setNotesInput('');
      setRejectionComment('');
      setPendingConfirm(null);
      // AC-IXD-PROC-001: the toast names the SAME canonical state the badge will
      // show — not the raw enum value (button verb → badge → toast all agree).
      toast(
        t('procurementDetail.toast.requestUpdated', 'Procurement updated'),
        `${t('procurementDetail.toast.movedTo', 'Moved to')} ${toastStateLabel(to)}`,
        'success',
      );
    } catch (err) {
      setPendingConfirm(null);
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setMutationError(detail);
    }
  };

  // ── Commit the staged confirm (kept for the consequential set + GR/VI). Toast is
  //    classified by the preserved RPC error code (sub-task b) so an illegal-stage /
  //    SoD failure reads as such instead of a silent no-op.
  const commitConfirm = async () => {
    if (!pendingConfirm) return;
    setMutationError(null);
    if (pendingConfirm.kind === 'transition') {
      await commitTransition(pendingConfirm.to);
      return;
    }
    try {
      if (pendingConfirm.kind === 'createGR') {
        await mutations.createReceipt.mutateAsync({
          status: pendingConfirm.status,
          receiptDate: pendingConfirm.receiptDate,
          referenceNumber: pendingConfirm.referenceNumber,
          ...(pendingConfirm.receiptLines ? { receiptLines: pendingConfirm.receiptLines } : {}),
          intent: pendingConfirm.intent,
        });
        setShowCreateGR(false);
        setCaptureKind(null);
        toast(t('procurementDetail.toast.grRecorded', 'Goods receipt recorded'), undefined, 'success');
      } else {
        const invoice = {
          status: pendingConfirm.status,
          invoiceDate: pendingConfirm.invoiceDate,
          referenceNumber: pendingConfirm.referenceNumber,
          externalRef: pendingConfirm.externalRef,
          amount: pendingConfirm.amount,
          // #505: forwarded from the staged capture — required by the mutation's type.
          taxTreatment: pendingConfirm.taxTreatment,
          taxAmount: pendingConfirm.taxAmount,
          taxRate: pendingConfirm.taxRate, taxBaseNumerator: pendingConfirm.taxBaseNumerator, taxBaseDenominator: pendingConfirm.taxBaseDenominator,
          ...(pendingConfirm.taxTemplate ? { taxTemplate: pendingConfirm.taxTemplate } : {}),
          ...(pendingConfirm.withheldAmount && pendingConfirm.withheldPphType
            ? { withheldAmount: pendingConfirm.withheldAmount, withheldPphType: pendingConfirm.withheldPphType } : {}),
          ...(pendingConfirm.erpTaxAmounts ? { erpTaxAmounts: pendingConfirm.erpTaxAmounts } : {}),
          ...(pendingConfirm.taxIds ? { taxIds: pendingConfirm.taxIds } : {}),
          intent: pendingConfirm.intent,
        };
        if (pendingConfirm.lines) {
          await mutations.captureSubcontractVendorInvoice.mutateAsync({ ...invoice, lines: pendingConfirm.lines });
        } else {
          await mutations.createInvoice.mutateAsync(invoice);
        }
        setShowCreateVI(false);
        setCaptureKind(null);
        toast(t('procurementDetail.toast.viRecorded', 'Supplier invoice recorded'), undefined, 'success');
      }
      setPendingConfirm(null);
    } catch (err) {
      // Close the confirm; surface the classified toast + keep the verbatim
      // inline error (forms keep redundant errors — that is correct).
      setPendingConfirm(null);
      const { headline, detail } = (pendingConfirm.kind === 'createVI' && pendingConfirm.lines
        ? classifySubcontractBillError(err, t)
        : null) ?? odooActionError(err, odooOwnsProcurement(), t) ?? classifyMutationError(err);
      toast(headline, detail, 'warning');
      setMutationError(detail);
    }
  };

  // O3 (AC-W3-O3) + harden #2: submit the inline VI capture atomically. The transition to Vendor
  // Invoiced + the invoice-create + the status-event log now happen in ONE transactional RPC
  // (capture_vendor_invoice), so a partial failure can never leave the case at Vendor Invoiced with
  // no invoice (or vice versa) — it is all-or-nothing. Exactly ONE toast: a combined success, or the
  // classified failure. On FAILURE the inline panel STAYS OPEN so the user can correct + retry
  // without hunting for the recovery after-form; only a success closes it.
  const submitVICapture = async (capture: VendorInvoiceCapture) => {
    setMutationError(null);
    try {
      const { lines, ...rest } = capture;
      // #1513 S7.4: a subcontract bill with BoQ lines goes through the capped RPC (SC001 refusal, in words).
      if (lines) await mutations.captureSubcontractVendorInvoice.mutateAsync({ ...rest, lines, notes: notesInput || undefined });
      else await mutations.captureVendorInvoice.mutateAsync({
        // #505: `capture` is `CaptureVendorInvoiceInput` minus procurementId/notes, so the tax facts
        // travel through by construction — there is no field list here to forget to update.
        ...rest,
        notes: notesInput || undefined,
      });
      setNotesInput('');
      setShowVICapture(false);
      toast(
        t('procurementDetail.toast.viRecorded', 'Supplier invoice recorded'),
        `${t('procurementDetail.toast.movedTo', 'Moved to')} ${toastStateLabel('Vendor Invoiced')}`,
        'success',
      );
    } catch (err) {
      // Keep the form open (do NOT close) — the atomic RPC rolled everything back, so the user
      // can fix the input and resubmit from the same panel.
      const { headline, detail } = classifySubcontractBillError(err, t) ?? classifyMutationError(err);
      toast(headline, detail, 'warning');
      setMutationError(detail);
    }
  };

  const confirmInFlight =
    mutations.transition.isPending ||
    mutations.createReceipt.isPending ||
    mutations.createInvoice.isPending ||
    mutations.captureVendorInvoice.isPending ||
    mutations.captureSubcontractVendorInvoice?.isPending;

  return {
    pendingConfirm,
    setPendingConfirm,
    rejectionComment,
    setRejectionComment,
    onActionClick,
    commitConfirm,
    submitVICapture,
    confirmInFlight,
  };
}
