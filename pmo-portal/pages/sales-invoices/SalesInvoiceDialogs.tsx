import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog, EntityFormModal, TextField, useToast, type SubmitError } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { nativeRevenueHeadlines } from '@/src/lib/revenue/nativeRevenueErrors';
import { invoiceNumber } from '@/src/lib/revenue/nativeInvoice';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import type { useSalesInvoiceActions } from './useSalesInvoiceActions';

export function SalesInvoiceDialogs({ actions, submitFallback }: { actions: ReturnType<typeof useSalesInvoiceActions>; submitFallback: (invoice: SalesInvoiceRow) => string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { receiptTarget, setReceiptTarget, setReceivedDate, cancelTarget, setCancelTarget, cancelInvoice, onCancelConfirm, submitTarget, setSubmitTarget, submitInvoice, onSubmitConfirm } = actions;
  return <>
      {receiptTarget && (
        <ReceivedDateModal
          invoice={receiptTarget}
          loading={setReceivedDate.isPending}
          onClose={() => setReceiptTarget(null)}
          onSave={async (date) => {
            await setReceivedDate.mutateAsync({ siId: receiptTarget.id, receivedDate: date });
            toast(t('financeCopy.receivedDateSaved', 'Received date saved'), invoiceNumber(receiptTarget) ?? receiptTarget.id, 'success');
            setReceiptTarget(null);
          }}
        />
      )}


      {/* Cancel confirm (destructive tone) */}
      <ConfirmDialog
        open={!!cancelTarget}
        tone="destructive"
        title={cancelTarget ? t('financeCopy.cancelInvoiceNamed', 'Cancel {{invoice}}?', { invoice: invoiceNumber(cancelTarget) ?? cancelTarget.customer_name ?? cancelTarget.id }) : t('financeCopy.cancelInvoiceQuestion', 'Cancel invoice?')}
        description={cancelTarget?.pmo_native
          ? t('financeCopy.nativeCancelInvoiceBody', 'This cancels the invoice in PMO and it stops counting as billed. An invoice with receipts can be cancelled only after its receipts are cancelled.')
          : t('financeCopy.thisCancelsTheInvoiceInERPNextDocstatus12TheInvoiceWillBeMarkedCancelledAndCanNoLongerBeSubmittedOutstandingAmountIsReleased', "This cancels the invoice in ERPNext (docstatus 1→2). The invoice will be marked Cancelled and can no longer be submitted. Outstanding amount is released.")}
        confirmLabel={t('financeCopy.cancelInvoice', "Cancel invoice")}
        loading={cancelInvoice.isPending}
        onConfirm={onCancelConfirm}
        onCancel={() => setCancelTarget(null)}
      />

      {/* Submit confirm (default tone — primary action) */}
      <ConfirmDialog
        open={!!submitTarget}
        title={submitTarget?.pmo_native
          ? t('financeCopy.approveInvoiceNamed', 'Approve the invoice for {{customer}}?', { customer: submitTarget.customer_name ?? '' })
          : submitTarget ? t('financeCopy.submitInvoiceNamed', 'Submit {{invoice}}?', { invoice: submitTarget.si_number ?? submitFallback(submitTarget) }) : t('financeCopy.submitInvoiceQuestion', 'Submit invoice?')}
        description={submitTarget?.pmo_native
          ? t('financeCopy.approveInvoiceBody', 'Approving issues the invoice: it gets its number, becomes Unpaid and can receive payments. Its author cannot approve it.')
          : t('financeCopy.submitInvoiceForApprovalThisCommitsItToTheLedgerAndCannotBeUndoneByTheSubmitter', "Submit invoice for approval? This commits it to the ledger and cannot be undone by the submitter.")}
        confirmLabel={submitTarget?.pmo_native ? t('financeCopy.approveInvoice', 'Approve invoice') : t('financeCopy.submitInvoice', "Submit invoice")}
        loading={submitInvoice.isPending}
        onConfirm={onSubmitConfirm}
        onCancel={() => setSubmitTarget(null)}
      />

  </>;
}

// ── Received-date modal (#767) ──────────────────────────────────────────────

const ReceivedDateModal: React.FC<{
  invoice: SalesInvoiceRow;
  loading: boolean;
  onClose: () => void;
  onSave: (date: string | null) => Promise<void>;
}> = ({ invoice, loading, onClose, onSave }) => {
  const { t } = useTranslation();
  const [value, setValue] = useState(invoice.received_date ?? '');
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const tooEarly = !!value && !!invoice.invoice_date && value < invoice.invoice_date;
  return (
    <EntityFormModal
      open
      title={t('financeCopy.recordReceivedDate', 'Record received date')}
      subtitle={t('financeCopy.receivedDateHelp', 'The date the client received this invoice. The due date follows it.')}
      submitLabel={t('financeCopy.save', 'Save')}
      onSubmit={(e) => {
        e.preventDefault();
        if (tooEarly) return;
        void onSave(value || null).catch((err: unknown) => {
          const { headline, detail } = classifyMutationError(err, nativeRevenueHeadlines(t));
          setSaveError({ headline, detail });
        });
      }}
      onClose={onClose}
      loading={loading}
      dirty={value !== (invoice.received_date ?? '')}
      submitDisabled={tooEarly}
      submitError={saveError}
    >
      <TextField
        label={t('financeCopy.receivedDate', 'Received')}
        type="date"
        value={value}
        onChange={setValue}
        min={invoice.invoice_date ?? undefined}
        error={tooEarly ? t('financeCopy.receivedBeforeInvoiceDate', 'Cannot be before the invoice date') : undefined}
        className="w-48"
      />
    </EntityFormModal>
  );
};
