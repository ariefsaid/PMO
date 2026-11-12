import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, TextField, NumberField, SelectField, Combobox, FormGrid, FormSection, Button, ConfirmDialog, type SubmitError, type ComboboxOption } from '@/src/components/ui';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { useSalesInvoices } from '@/src/hooks/useRevenue';
import { useClientCompanyOptions } from '@/src/hooks/useFkOptions';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { useOrgBusinessTimezone } from '@/src/hooks/useResolvedLocale';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { currencySymbol, formatCurrency, formatMoneyInputValue, parseMoneyInputAtScale } from '@/src/lib/format';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { invoiceNumber } from '@/src/lib/revenue/nativeInvoice';
import { nativeRevenueHeadlines } from '@/src/lib/revenue/nativeRevenueErrors';
import type { PendingPushState } from '@/src/lib/adapterSeam/pendingPush';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { useCommandIntent } from '@/src/hooks/useCommandIntent';
import type { CommandIntent } from '@/src/lib/repositories/types';
import { OdooJournalSelect } from '@/src/components/procurement/OdooDirectoryPickers';
import { nativeReceiptInvoiceCandidates } from './applicableInvoices';

/** Form values for the payment modal. */
interface FormValues {
  customerId: string;
  salesInvoiceId: string | null;
  paidAmount: string;
  receivedAmount: string;
  withheldAmount: string;
  withholdingSlipNumber: string;
  /** #1275: the tax article the client withheld under; '' = not stated. */
  withholdingArticle: '' | 'pph23' | 'pph4_2';
  date: string;
  journalId: string;
}

type ReceiptInput = { customerId: string; salesInvoiceId: string | null; paidAmount: number; receivedAmount: number; withheldAmount?: number; withholdingSlipNumber?: string | null; withholdingArticle?: 'pph23' | 'pph4_2'; journalId?: string; date: string };

/**
 * #684 (AC-PLC-009): both payment amounts are stored as numeric(14,2). This ONE locale-aware
 * scale-2 parse decides validity and produces the submitted number, so the two cannot disagree and
 * a value the column would round is refused before the write.
 */
function parsePaymentAmount(raw: string): number | null {
  const n = parseMoneyInputAtScale(raw, 2);
  return n !== null && n > 0 ? n : null;
}

const validate = (
  v: FormValues,
  t: (key: string, fallback: string) => string,
  native = false,
  invoiceDate?: string | null,
  today?: string,
): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.customerId.trim()) errors.customerId = t('financeCopy.customerRequired', 'Customer is required.');
  // #1415: with no invoice named, a PMO receipt is a payment ON ACCOUNT for the customer (applied to invoices afterwards).
  if (parsePaymentAmount(v.paidAmount) === null) {
    errors.paidAmount = t('financeCopy.paidAmountPositive', 'Paid amount must be positive, with no more than 2 decimal places.');
  }
  if (parsePaymentAmount(v.receivedAmount) === null) {
    errors.receivedAmount = t('financeCopy.receivedAmountPositive', 'Received amount must be positive, with no more than 2 decimal places.');
  }
  // I-5: in PMO the cash received plus the tax withheld IS the amount settled (DD-RCPT-1) — always, so a part payment
  // is checked here rather than refused by the server.
  if (native) {
    const paid = parsePaymentAmount(v.paidAmount);
    const received = parsePaymentAmount(v.receivedAmount);
    const withheldNow = v.withheldAmount.trim() ? parseMoneyInputAtScale(v.withheldAmount, 2) : 0;
    if (paid !== null && received !== null && withheldNow !== null && withheldNow >= 0
      && Math.round(received * 100) + Math.round(withheldNow * 100) !== Math.round(paid * 100)) {
      errors.receivedAmount = t('financeCopy.withheldAmountUnbalanced', "Cash received plus withheld tax must equal the amount allocated to the invoice.");
    }
  }
  if (!v.date) errors.date = t('financeCopy.paymentDateRequired', 'Date is required.');
  // #784 (DD-NAR-17): the server refuses a future payment date; say so before the round trip.
  else if (native && today && v.date > today) errors.date = t('financeCopy.paymentDateNotFuture', 'The payment date cannot be in the future.');
  // The server refuses a payment dated before its invoice (0275); say so before the round trip.
  else if (native && invoiceDate && v.date < invoiceDate) errors.date = t('financeCopy.paymentDateBeforeInvoice', 'The payment date cannot be before the invoice date.');
  const withheld = v.withheldAmount.trim() ? parseMoneyInputAtScale(v.withheldAmount, 2) : 0;
  if (withheld === null || withheld < 0) {
    errors.withheldAmount = t('financeCopy.withheldAmountInvalid', "Withheld tax must be non-negative, with no more than 2 decimal places.");
  } else if (withheld > 0 && !native) {
    const paid = parsePaymentAmount(v.paidAmount);
    const received = parsePaymentAmount(v.receivedAmount);
    if (paid !== null && received !== null && Math.round(received * 100) + Math.round(withheld * 100) !== Math.round(paid * 100)) {
      errors.withheldAmount = t('financeCopy.withheldAmountUnbalanced', "Cash received plus withheld tax must equal the amount allocated to the invoice.");
    }
  }
  if (withheld !== null && withheld > 0 && (!v.withholdingSlipNumber.trim() || v.withholdingSlipNumber.trim().length > 140)) {
    errors.withholdingSlipNumber = t('financeCopy.withholdingSlipInvalid', "Enter a withholding-slip number of at most 140 characters.");
  }
  return errors;
};

/**
 * The invoices a receipt can still be applied to, as picker options.
 *
 * "Open" = SUBMITTED to the ledger (`Submitted`/`Unpaid`) and still owing. A `Draft` has not hit
 * the GL yet (P3a creates every SI as an ERP draft — the SoD-gated submit is the commitment), and
 * `Paid`/`Cancelled` can receive nothing. A null `erp_outstanding_amount` means the ERP mirror
 * hasn't reported one yet, so the invoice stays selectable rather than silently disappearing.
 * Scoped to `customerId` when one is chosen — a receipt must never settle another client's invoice.
 */
function openCustomerOpenInvoices(
  invoices: SalesInvoiceRow[],
  customerId: string | null | undefined,
): SalesInvoiceRow[] {
  return invoices
    .filter((inv) => inv.status === 'Submitted' || inv.status === 'Unpaid')
    .filter((inv) => inv.erp_outstanding_amount == null || inv.erp_outstanding_amount > 0)
    .filter((inv) => !customerId || inv.customer_id === customerId);
}

function openInvoiceOptions(
  invoices: SalesInvoiceRow[],
  customerId: string | null | undefined,
  native: boolean,
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string,
): ComboboxOption[] {
  const candidates = native
    ? nativeReceiptInvoiceCandidates(invoices, { customerId })
    : openCustomerOpenInvoices(invoices, customerId).filter((inv) => !inv.pmo_native);
  return candidates
    .map((inv) => ({
      value: inv.id,
      label: invoiceNumber(inv) ?? inv.id,
      searchTerms: inv.customer_name ? [inv.customer_name] : undefined,
      sub:
        inv.erp_outstanding_amount != null
          ? t('financeCopy.amountOutstanding', '{{amount}} outstanding', { amount: formatCurrency(inv.erp_outstanding_amount, inv.currency, { precision: 'minor' }) })
          : undefined,
    }));
}

// ── Create form modal ────────────────────────────────────────────────

interface IncomingPaymentFormModalProps {
  initialInvoiceId?: string;
  onClose: () => void;
  /** `intent` is the modal's OWN command identity — stable for this form session (BLOCK 2). */
  onCreate: (
    input: {
      customerId: string;
      salesInvoiceId: string | null;
      paidAmount: number;
      receivedAmount: number;
      withheldAmount?: number;
      withholdingSlipNumber?: string | null;
      withholdingArticle?: 'pph23' | 'pph4_2';
      journalId?: string;
      date: string;
    },
    intent: CommandIntent,
  ) => Promise<void>;
  pendingPush: PendingPushState;
  /** #784: true while PMO owns revenue — the receipt names its invoice and states its payment date (DD-NAR-17). */
  native: boolean;
  /** Odoo-owned revenue shows the mirrored payment journal and confirms the money action. */
  odoo?: boolean;
  unreachable?: boolean;
}

export const IncomingPaymentFormModal: React.FC<IncomingPaymentFormModalProps> = ({
  initialInvoiceId,
  onClose,
  onCreate,
  pendingPush,
  native,
  odoo = false,
  unreachable = false,
}) => {
  const { t } = useTranslation();
  const orgTimezone = useOrgBusinessTimezone();
  const today = useOrgToday(orgTimezone);
  // A PMO receipt uses its invoice's currency; otherwise use the organization's currency.
  const orgCurrency = useOrgCurrency();
  // BLOCK 2 (ADR-0058): ONE command identity per form session. This modal is mounted only while the
  // form is open, so its mount IS the session: a retry after "external system unreachable" reuses
  // this identity (the committed Payment Entry is reconciled, NOT posted twice), while a success
  // closes the modal → the next "Receive Payment" mints a fresh one.
  const intent = useCommandIntent();
  const { data: invoices, isPending: invoicesPending, isError: invoicesError, refetch: refetchInvoices } = useSalesInvoices();
  const invoiceDateOf = (id: string | null) => (id ? invoices?.find((inv) => inv.id === id)?.invoice_date ?? null : null);
  const initialInvoice = initialInvoiceId ? invoices?.find((invoice) => invoice.id === initialInvoiceId) : undefined;
  const form = useEntityForm<FormValues>({
    initialValues: {
      customerId: initialInvoice?.customer_id ?? '',
      salesInvoiceId: initialInvoice?.id ?? null,
      paidAmount: '0',
      receivedAmount: '0',
      withheldAmount: '0',
      withholdingSlipNumber: '',
      withholdingArticle: initialInvoice?.project_receipt_withholding_article ?? '',
      journalId: '',
      // #784 (DD-NAR-17): a PMO receipt's payment date starts at today in the org's time zone.
      date: today,
    },
    validate: (values) => {
      const errors = validate(values, t, native, invoiceDateOf(values.salesInvoiceId), today);
      if (values.salesInvoiceId && !invoices?.some((invoice) => invoice.id === values.salesInvoiceId && invoice.customer_id === values.customerId)) {
        errors.salesInvoiceId = t('financeCopy.salesInvoiceRequired', 'Choose the invoice this receipt settles.');
      }
      return errors;
    },
    idPrefix: 'incoming-payment-form',
    requiredFields: ['customerId', 'paidAmount', 'receivedAmount', 'date'],
    module: 'incomingPayments',
  });

  // FK options from the cached hooks ("hooks own data fetching"); the Combobox loaders just hand
  // back the already-fetched lists. The invoice loader depends on the chosen customer, so the
  // picker re-loads when the customer changes.
  const { data: customerOptions } = useClientCompanyOptions();
  const loadCustomers = useCallback(async (): Promise<ComboboxOption[]> => customerOptions ?? [], [customerOptions]);
  const selectedCustomerId = form.values.customerId;
  const selectedCustomerOpenInvoices = openCustomerOpenInvoices(invoices ?? [], selectedCustomerId);
  const selectedCustomerNativeInvoiceCandidates = nativeReceiptInvoiceCandidates(invoices ?? [], { customerId: selectedCustomerId });
  const hasEligibleInvoices = native
    ? selectedCustomerNativeInvoiceCandidates.length > 0
    : selectedCustomerOpenInvoices.some((invoice) => !invoice.pmo_native);
  const otherLedgerOpenInvoiceCount = native
    ? selectedCustomerOpenInvoices.filter((invoice) => !invoice.pmo_native).length
    : selectedCustomerNativeInvoiceCandidates.length;
  const invoiceQueryLoading = invoicesPending || (!invoicesError && invoices == null);
  const invoiceEmptyMessage = (): React.ReactNode | undefined => {
    if (selectedCustomerId && !hasEligibleInvoices) {
      if (otherLedgerOpenInvoiceCount === 1) {
        return <span role="status">{native
          ? t('financeCopy.excludedAccountingInvoiceSingular', '1 open invoice is recorded in the accounting system. A receipt against it cannot be recorded here yet.')
          : t('financeCopy.excludedPmoInvoiceSingular', '1 open invoice is recorded in PMO. A receipt against it cannot be recorded here yet.')}</span>;
      }
      if (otherLedgerOpenInvoiceCount > 1) {
        return <span role="status">{native
          ? t('financeCopy.excludedAccountingInvoicesPlural', '{{count}} open invoices are recorded in the accounting system. Receipts against them cannot be recorded here yet.', { count: otherLedgerOpenInvoiceCount })
          : t('financeCopy.excludedPmoInvoicesPlural', '{{count}} open invoices are recorded in PMO. Receipts against them cannot be recorded here yet.', { count: otherLedgerOpenInvoiceCount })}</span>;
      }
      return <span role="status">{native
        ? t('financeCopy.noEligibleNativeInvoiceForCustomer', 'No approved invoice with a reported balance is available for this customer. Create or approve an invoice, or refresh its balance, then try again.')
        : t('financeCopy.noOpenInvoicesForCustomer', 'No open invoices for this customer.')}</span>;
    }
    // Keep the Combobox's standard query-specific "No invoice matches" copy when eligible invoices exist.
    return undefined;
  };
  const loadOpenInvoices = useCallback(
    async (): Promise<ComboboxOption[]> => openInvoiceOptions(invoices ?? [], selectedCustomerId, native, t),
    [invoices, selectedCustomerId, native, t],
  );

  const customerField = form.fieldProps('customerId');
  const salesInvoiceField = form.fieldProps('salesInvoiceId');
  // #784 (DD-NAR-17): the PMO invoice this receipt settles, for the amount's starting value and its helper.
  const chosenInvoice = native ? invoices?.find((inv) => inv.id === salesInvoiceField.value) : undefined;
  // A PMO receipt is recorded in its invoice's currency (0275), so the amounts read in it once one is chosen.
  const moneyPrefix = currencySymbol(chosenInvoice?.currency ?? orgCurrency);
  const paidAmountField = form.fieldProps('paidAmount');
  const receivedAmountField = form.fieldProps('receivedAmount');
  const withheldAmountField = form.fieldProps('withheldAmount');
  const slipField = form.fieldProps('withholdingSlipNumber');
  const articleField = form.fieldProps('withholdingArticle');
  // #1275: an invoice change re-pre-fills the article only until the accountant hand-picks one.
  const articlePicked = React.useRef(false);
  const dateField = form.fieldProps('date');
  const journalField = form.fieldProps('journalId');
  const withholdingPanelId = React.useId();
  const [withholdingExpanded, setWithholdingExpanded] = useState(false);
  const withheldForSummary = form.values.withheldAmount.trim()
    ? parseMoneyInputAtScale(form.values.withheldAmount, 2)
    : 0;
  const hasWithholdingSummary = withheldForSummary === null
    ? form.values.withheldAmount.trim().length > 0
    : withheldForSummary !== 0;
  const showWithholdingSummary = !withholdingExpanded && (
    hasWithholdingSummary || slipField.value.trim().length > 0
  );

  const cashReceivedField = (
    <NumberField
      id={receivedAmountField.id}
      label={t('uxs27.cashReceived', 'Cash received')}
      value={String(receivedAmountField.value)}
      onChange={(v) => receivedAmountField.onChange(v)}
      required
      min={0}
      step={0.01}
      prefix={moneyPrefix}
      error={receivedAmountField.error}
      helper={t('financeCopy.receivedAmountHelper', "The cash actually received.")}
      localeAware
    />
  );

  const errorSummary = form.errors.customerId || form.errors.salesInvoiceId || form.errors.paidAmount || form.errors.receivedAmount || form.errors.date || form.errors.withheldAmount || form.errors.withholdingSlipNumber
    ? [
        ...(form.errors.customerId ? [{ fieldId: customerField.id, message: form.errors.customerId }] : []),
        ...(form.errors.salesInvoiceId ? [{ fieldId: salesInvoiceField.id, message: form.errors.salesInvoiceId }] : []),
        ...(form.errors.paidAmount ? [{ fieldId: paidAmountField.id, message: form.errors.paidAmount }] : []),
        ...(form.errors.receivedAmount ? [{ fieldId: receivedAmountField.id, message: form.errors.receivedAmount }] : []),
        ...(form.errors.date ? [{ fieldId: dateField.id, message: form.errors.date }] : []),
        ...(form.errors.withheldAmount ? [{ fieldId: withheldAmountField.id, message: form.errors.withheldAmount }] : []),
        ...(form.errors.withholdingSlipNumber ? [{ fieldId: slipField.id, message: form.errors.withholdingSlipNumber }] : []),
      ]
    : undefined;

  // #559 / AC-ERR-001: a rejected save must leave PERSISTENT evidence in the dialog. The toast
  // auto-dismisses after 4s, ~700px away, after which the modal looks like a pristine form with
  // data in it. `suppressCapture` because the page's own `onError` classifies the same rejection
  // for the toast and owns the single `save_failed` event (ADR-0067).
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const [confirmInput, setConfirmInput] = useState<ReceiptInput | null>(null);
  const [confirmSaving, setConfirmSaving] = useState(false);

  const saveReceipt = async (input: ReceiptInput) => {
    if (odoo && unreachable) return;
    try {
      await onCreate(input, intent);
      setConfirmInput(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err, nativeRevenueHeadlines(t), { module: 'sales' });
      setSaveError({ headline, detail });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {

    e.preventDefault();
    // Expand before EntityFormModal focuses the first invalid field after submit. The
    // existing validator remains the authority; this read only keeps that field visible.
    const withholdingErrors = validate(form.values, t, native, invoiceDateOf(form.values.salesInvoiceId), today);
    const nativeBalanceNeedsWithholding = native
      && Boolean(withholdingErrors.receivedAmount)
      && withheldForSummary !== null
      && withheldForSummary > 0;
    if (withholdingErrors.withheldAmount || withholdingErrors.withholdingSlipNumber || nativeBalanceNeedsWithholding) {
      setWithholdingExpanded(true);
    }
    void form.handleSubmit(async (values) => {
      const paidAmount = parsePaymentAmount(values.paidAmount);
      const receivedAmount = parsePaymentAmount(values.receivedAmount);
      // Unreachable after `validate`, which applies the same parse — kept so the types prove it.
      if (paidAmount === null || receivedAmount === null) return;
      const withheldAmount = values.withheldAmount.trim() ? parseMoneyInputAtScale(values.withheldAmount, 2)! : 0;
      const input = {
        customerId: values.customerId,
        salesInvoiceId: values.salesInvoiceId,
        paidAmount,
        receivedAmount,
        ...(withheldAmount > 0 ? {
          withheldAmount,
          withholdingSlipNumber: values.withholdingSlipNumber.trim(),
          // #1275: ERP receipts only (a PMO-native receipt posts to no GL); Odoo ignores the article, so no picker.
          ...(!native && !odoo && values.withholdingArticle ? { withholdingArticle: values.withholdingArticle } : {}),
        } : {}),
        ...(values.journalId ? { journalId: values.journalId } : {}),
        date: values.date,
      };
      if (odoo) setConfirmInput(input);
      else await saveReceipt(input);
    });
  };

  return (
    <EntityFormModal
      open
      title={t('financeCopy.receivePayment', 'Receive payment')}
      submitLabel={t('financeCopy.recordPayment', 'Record payment')}
      cancelLabel={t('financeCopy.cancel', 'Cancel')}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete || (odoo && unreachable)}
      errorSummary={errorSummary}
    >
      {!native && pendingPush.status !== 'idle' && (
        <div className="mb-3.5 flex justify-end">
          <span className="text-control text-muted-foreground">{t(odoo ? 'financeCopy.pushingToOdoo' : 'financeCopy.pushingToERPNext', odoo ? 'Sending to Odoo…' : 'Pushing to ERPNext…')}</span>
        </div>
      )}
      {odoo && unreachable && <p role="status" className="mb-3 text-sm text-muted-foreground">{t('finance:odooOutcome.offlineAction', 'Odoo is unavailable. You can still view the last data PMO read; no new changes were sent from this screen.')}</p>}
      <FormSection legend={t('financeCopy.paymentDetails', 'Payment details')}>
        <FormGrid>
          <Combobox
            id={customerField.id}
            label={t('financeCopy.customer', "Customer")}
            required
            value={customerField.value}
            onChange={(value) => {
              if (value !== customerField.value) {
                form.setValues({ customerId: value, salesInvoiceId: null, paidAmount: '0', receivedAmount: '0', withheldAmount: '0', withholdingSlipNumber: '', withholdingArticle: '' });
                articlePicked.current = false;
              }
            }}
            error={customerField.error}
            placeholder={t('financeCopy.selectOrSearchCustomer', "Select or search customer…")}
            loadOptions={loadCustomers}
            noun="customer"
          />
          <Combobox
            id={salesInvoiceField.id}
            label={t('financeCopy.salesInvoiceOptional', "Sales Invoice (optional)")}
            value={salesInvoiceField.value ?? ''}
            onChange={(value, _option) => {
              salesInvoiceField.onChange(value ?? '');
              // #1275 (AC-WHA-007): pre-fill the article from the invoice's project; the accountant can change it.
              if (!native && !articlePicked.current) form.setValues({ withholdingArticle: invoices?.find((inv) => inv.id === value)?.project_receipt_withholding_article ?? '' });
              // #784 (DD-NAR-17): a PMO receipt's amount starts at what the chosen invoice still owes.
              const chosen = native ? invoices?.find((inv) => inv.id === value) : undefined;
              if (chosen?.erp_outstanding_amount != null && chosen.erp_outstanding_amount > 0) {
                const draft = formatMoneyInputValue(chosen.erp_outstanding_amount);
                form.setValues({ paidAmount: draft, receivedAmount: draft, withheldAmount: '0' });
              }
            }}
            error={salesInvoiceField.error}
            placeholder={t('financeCopy.linkToSalesInvoice', "Link to sales invoice…")}
            loadOptions={loadOpenInvoices}
            statusOverride={invoiceQueryLoading ? 'loading' : invoicesError ? 'error' : undefined}
            onRetry={() => { void refetchInvoices(); }}
            emptyMessage={invoiceEmptyMessage}
            noun="invoice"
          />
          {native && !salesInvoiceField.value && (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              {t('finance:receipts.onAccount.mode', 'No invoice chosen: this is recorded as a payment on account for the customer. You can apply it to invoices afterwards.')}
            </p>
          )}
          <NumberField
            id={paidAmountField.id}
            label={t('uxs27.amountSettled', 'Amount settled')}
            value={String(paidAmountField.value)}
            onChange={(v) => {
              // I-5: while nothing is withheld, the cash received IS the amount paid — keep them in step.
              const withheldNow = form.values.withheldAmount.trim() ? parseMoneyInputAtScale(form.values.withheldAmount, 2) : 0;
              if ((native || odoo) && withheldNow === 0) form.setValues({ paidAmount: v, receivedAmount: v });
              else paidAmountField.onChange(v);
            }}
            required
            min={0}
            step={0.01}
            prefix={moneyPrefix}
            error={paidAmountField.error}
            helper={chosenInvoice?.erp_outstanding_amount != null
              ? t('financeCopy.nativeReceiptAmountHelper', 'Starts at the {{amount}} outstanding. Enter less for a part payment, or more if the client paid more; the excess shows as overpaid.', {
                amount: formatCurrency(chosenInvoice.erp_outstanding_amount, chosenInvoice.currency, { precision: 'minor' }),
              })
              : undefined}
            localeAware
          />
          {(!odoo || withheldForSummary !== 0) && cashReceivedField}
          {odoo && <div className="sm:col-span-2"><OdooJournalSelect value={journalField.value} onChange={journalField.onChange} id={journalField.id} label={t('finance:receipts.journalLabel', 'Received into')} /></div>}
          <div className="sm:col-span-2">
            <Button
              variant="outline"
              className="touch-target"
              type="button"
              aria-expanded={withholdingExpanded}
              aria-controls={withholdingPanelId}
              onClick={() => setWithholdingExpanded((expanded) => !expanded)}
            >
              {t('uxs27.taxWithheldDisclosure', 'Tax withheld')}
            </Button>
            {showWithholdingSummary && (
              <div className="mt-2 min-w-0 space-y-1 text-control text-muted-foreground">
                <p className="break-words">
                  {t('uxs27.withheldSummary', 'Tax withheld: {{amount}}', {
                    amount: `${moneyPrefix}${withheldAmountField.value}`,
                  })}
                </p>
                {slipField.value.trim()
                  ? <p className="break-words">{t('uxs27.withholdingSlipSummary', 'Withholding slip: {{slip}}', { slip: slipField.value })}</p>
                  : withheldForSummary !== null && withheldForSummary > 0
                    ? <p>{t('uxs27.withholdingSlipMissing', 'Withholding slip not entered (required for a deduction).')}</p>
                    : null}
              </div>
            )}
            <div id={withholdingPanelId} hidden={!withholdingExpanded} className="mt-3">
              <FormGrid>
                <NumberField
                  id={withheldAmountField.id}
                  label={t('financeCopy.withheldAmountLabel', "Withheld tax amount")}
                  value={withheldAmountField.value}
                  onChange={withheldAmountField.onChange}
                  onBlur={withheldAmountField.onBlur}
                  prefix={moneyPrefix}
                  localeAware
                  error={withheldAmountField.error}
                  helper={t('financeCopy.withheldAmountHelper', "Enter the amount the client withheld; PMO does not calculate income tax. Enter 0 for no withholding.")}
                />
                <TextField
                  id={slipField.id}
                  label={t('financeCopy.withholdingSlipNumberLabel', "Withholding-slip number")}
                  value={slipField.value}
                  onChange={slipField.onChange}
                  onBlur={slipField.onBlur}
                  maxLength={140}
                  error={slipField.error}
                  helper={t('financeCopy.withholdingSlipHelper', "Required when the client withheld tax.")}
                />
                {!native && !odoo && (
                  <SelectField
                    id={articleField.id}
                    label={t('finance:financeCopy.withholdingArticle', 'Withholding article')}
                    value={articleField.value}
                    onChange={(v) => { articlePicked.current = true; articleField.onChange(v as FormValues['withholdingArticle']); }}
                    options={[
                      { value: '', label: t('finance:financeCopy.withholdingArticleNone', 'Not stated') },
                      { value: 'pph23', label: t('finance:financeCopy.withholdingArticlePph23', 'PPh 23') },
                      { value: 'pph4_2', label: t('finance:financeCopy.withholdingArticlePph42', 'PPh 4(2)') },
                    ]}
                  />
                )}
              </FormGrid>
            </div>
          </div>
          <TextField
            id={dateField.id}
            label={native ? t('financeCopy.paymentDateLabel', 'Payment date') : t('financeCopy.date', "Date")}
            max={native ? today : undefined}
            min={native ? chosenInvoice?.invoice_date ?? undefined : undefined}
            value={dateField.value}
            onChange={dateField.onChange}
            onBlur={dateField.onBlur}
            required
            error={dateField.error}
            type="date"
            className="w-48"
          />
        </FormGrid>
      </FormSection>
      <ConfirmDialog
        open={confirmInput !== null}
        title={t('finance:receipts.confirmOdooTitle', 'Record this receipt in Odoo?')}
        description={<span className="space-y-2"><span className="block">{t('finance:receipts.confirmOdooBody', 'PMO sends this receipt to Odoo. Check the settled amount and any tax withheld before continuing.')}</span>{saveError && <span role="alert" className="block">{saveError.headline} {saveError.detail}</span>}</span>}
        confirmLabel={t('financeCopy.recordPayment', 'Record payment')}
        cancelLabel={t('financeCopy.cancel', 'Cancel')}
        loading={confirmSaving}
        confirmDisabled={unreachable}
        onConfirm={() => {
          if (!confirmInput || unreachable) return;
          setConfirmSaving(true);
          void saveReceipt(confirmInput).finally(() => setConfirmSaving(false));
        }}
        onCancel={() => setConfirmInput(null)}
      />
    </EntityFormModal>
  );
};
