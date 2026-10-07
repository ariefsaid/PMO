import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ListPage,
  SearchMini,
  ViewToggle,
  ListState,
  DataTable,
  StatusPill,
  ConfirmDialog,
  EntityFormModal,
  type SubmitError,
  TextField,
  NumberField,
  Combobox,
  FormGrid,
  FormSection,
  Button,
  Icon,
  useToast,
  type Column,
  type ComboboxOption,
  type RowMenuItem,
} from '@/src/components/ui';
import { useNavigate } from 'react-router';
import { ExportButton, withCurrencyColumn } from '@/src/components/export';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useIncomingPayments, useSalesInvoices, useRevenueMutations } from '@/src/hooks/useRevenue';
import { useClientCompanyOptions } from '@/src/hooks/useFkOptions';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { trackFilterApplied } from '@/src/lib/analytics';
import {
  currencySymbol,
  formatCurrencyCents,
  formatDateOnly,
  formatMoneyInputValue,
  instantToZonedDatetimeLocal,
  parseMoneyInputAtScale,
} from '@/src/lib/format';
import type { IncomingPaymentRow, IncomingPaymentStatus, SalesInvoiceRow } from '@/src/lib/db/revenue';
import { incomingPaymentStatusVariant, salesInvoiceStatusVariant } from '@/src/lib/status/statusVariants';
import { useRevenueMode } from '@/src/hooks/useRevenueMode';
import { invoiceNumber, receiptNumber } from '@/src/lib/revenue/nativeInvoice';
import { type PendingPushState } from '@/src/lib/adapterSeam/pendingPush';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { useCommandIntent, useCommandIntentMap } from '@/src/hooks/useCommandIntent';
import type { CommandIntent } from '@/src/lib/repositories/types';

/** Status filter segments. */
type StatusFilter = 'All' | IncomingPaymentStatus;
const STATUS_FILTERS: StatusFilter[] = ['All', 'Scheduled', 'Paid'];

function incomingPaymentStatusLabel(status: StatusFilter, t: (key: string, fallback: string) => string): string {
  const labels: Record<StatusFilter, string> = {
    All: t('financeCopy.statusAll', 'All'),
    Scheduled: t('financeCopy.statusScheduled', 'Scheduled'),
    Paid: t('financeCopy.statusPaid', 'Paid'),
  };
  return labels[status] ?? status;
}

/** Form values for the payment modal. */
interface FormValues {
  customerId: string;
  salesInvoiceId: string | null;
  paidAmount: string;
  receivedAmount: string;
  withheldAmount: string;
  withholdingSlipNumber: string;
  date: string;
}

/**
 * #684 (AC-PLC-009): both payment amounts are stored as numeric(14,2). This ONE locale-aware
 * scale-2 parse decides validity and produces the submitted number, so the two cannot disagree and
 * a value the column would round is refused before the write.
 */
function parsePaymentAmount(raw: string): number | null {
  const n = parseMoneyInputAtScale(raw, 2);
  return n !== null && n > 0 ? n : null;
}

/** #784 (DD-NAR-17): today in the org's time zone — the latest payment date the server accepts. */
const orgToday = (): string => instantToZonedDatetimeLocal(new Date()).slice(0, 10);

/**
 * #784 (DD-NAR-17): the server's receipt refusals are classified by code; these headlines say what to fix in
 * plain words (the server's own sentence stays as the detail).
 */
function nativeReceiptErrorHeadlines(err: unknown, t: (key: string, fallback: string) => string): Record<string, string> {
  const message = err instanceof Error ? err.message : '';
  return {
    '23502': t('financeCopy.receiptDateMissing', 'Enter the payment date.'),
    '23514': /future/i.test(message)
      ? t('financeCopy.paymentDateNotFuture', 'The payment date cannot be in the future.')
      : t('financeCopy.receiptRefused', 'Check the receipt amounts.'),
  };
}

const validate = (
  v: FormValues,
  t: (key: string, fallback: string) => string,
  native = false,
): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.customerId.trim()) errors.customerId = t('financeCopy.customerRequired', 'Customer is required.');
  // #784 (FR-NAR-007): a PMO receipt settles a named PMO invoice — there is no on-account receipt without an ERP.
  if (native && !v.salesInvoiceId) errors.salesInvoiceId = t('financeCopy.salesInvoiceRequired', 'Choose the invoice this receipt settles.');
  if (parsePaymentAmount(v.paidAmount) === null) {
    errors.paidAmount = t('financeCopy.paidAmountPositive', 'Paid amount must be positive, with no more than 2 decimal places.');
  }
  if (parsePaymentAmount(v.receivedAmount) === null) {
    errors.receivedAmount = t('financeCopy.receivedAmountPositive', 'Received amount must be positive, with no more than 2 decimal places.');
  }
  if (!v.date) errors.date = t('financeCopy.paymentDateRequired', 'Date is required.');
  // #784 (DD-NAR-17): the server refuses a future payment date; say so before the round trip.
  else if (native && v.date > orgToday()) errors.date = t('financeCopy.paymentDateNotFuture', 'The payment date cannot be in the future.');
  const withheld = v.withheldAmount.trim() ? parseMoneyInputAtScale(v.withheldAmount, 2) : 0;
  if (withheld === null || withheld < 0) {
    errors.withheldAmount = t('financeCopy.withheldAmountInvalid', "Withheld tax must be non-negative, with no more than 2 decimal places.");
  } else if (withheld > 0) {
    const paid = parsePaymentAmount(v.paidAmount);
    const received = parsePaymentAmount(v.receivedAmount);
    if (paid !== null && received !== null && Math.round(received * 100) + Math.round(withheld * 100) !== Math.round(paid * 100)) {
      errors.withheldAmount = t('financeCopy.withheldAmountUnbalanced', "Cash received plus withheld tax must equal the amount allocated to the invoice.");
    }
    if (!v.withholdingSlipNumber.trim() || v.withholdingSlipNumber.trim().length > 140) {
      errors.withholdingSlipNumber = t('financeCopy.withholdingSlipInvalid', "Enter a withholding-slip number of at most 140 characters.");
    }
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
function openInvoiceOptions(
  invoices: SalesInvoiceRow[],
  customerId?: string | null,
): ComboboxOption[] {
  return invoices
    .filter((inv) => inv.status === 'Submitted' || inv.status === 'Unpaid')
    .filter((inv) => inv.erp_outstanding_amount == null || inv.erp_outstanding_amount > 0)
    .filter((inv) => !customerId || inv.customer_id === customerId)
    .map((inv) => ({
      value: inv.id,
      label: invoiceNumber(inv) ?? inv.id,
      sub:
        inv.erp_outstanding_amount != null
          ? `${formatCurrencyCents(inv.erp_outstanding_amount, inv.currency)} outstanding`
          : undefined,
    }));
}

const IncomingPayments: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useIncomingPayments();
  const { createPayment, cancelPayment, pendingPush } = useRevenueMutations();
  const native = useRevenueMode() === 'native';

  const canView = may('view', 'incomingPayment');
  const canCreate = may('create', 'incomingPayment');
  const canCancel = may('transition', 'incomingPayment');
  const canRowWrite = canCancel;

  const all = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');

  const [formTarget, setFormTarget] = useState<{ payment: IncomingPaymentRow | null } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<IncomingPaymentRow | null>(null);

  // BLOCK 2 (ADR-0058): the cancel confirm dialog is ALWAYS mounted, so its command identity is per
  // (record, verb) — a retry on payment B must never carry payment A's key. Released only after a
  // terminal success (never on error — reusing the key on retry IS the fix).
  const verbIntents = useCommandIntentMap();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((p) => statusFilter === 'All' || p.status === statusFilter)
      .filter((p) => !q
        || receiptNumber(p)?.toLowerCase().includes(q)
        // #781 (AC-FIN-001): the list search also indexes the resolved customer company name.
        || p.customer_name?.toLowerCase().includes(q));
  }, [all, search, statusFilter]);

  const state: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError || !data
      ? 'error'
      : all.length === 0
        ? 'empty'
        : undefined;

  if (!canView) {
    return (
      <div className="flex h-[calc(100vh-var(--header-h))] items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-heading font-semibold">{t('financeCopy.youDonTHaveAccessToIncomingPayments', "You don't have access to Incoming Payments")}</h2>
          <p className="mt-2 text-muted-foreground">
            {t('financeCopy.theIncomingPaymentsListIsAvailableToFinanceProjectManagersAndExecutives', "The incoming payments list is available to Finance, Project Managers, and Executives.")}</p>
          <Button variant="outline" onClick={() => navigate('/')} className="mt-4">
            <Icon name="back" className="size-4 mr-2" />
            {t('financeCopy.backToDashboard', "Back to dashboard")}</Button>
        </div>
      </div>
    );
  }

  const columns: Column<IncomingPaymentRow>[] = [
    {
      key: 'ip_number',
      header: t('financeCopy.payment', "Payment #"),
      cell: (p) => (
        <span className="truncate font-mono text-[13px]" title={receiptNumber(p) ?? ''}>
          {receiptNumber(p) ?? '—'}
        </span>
      ),
      exportValue: (p) => receiptNumber(p) ?? '',
    },
    {
      key: 'reference_number',
      header: t('financeCopy.reference', "Reference"),
      cell: (p) => (
        <span className="truncate text-muted-foreground" title={p.reference_number ?? ''}>
          {p.reference_number ?? '—'}
        </span>
      ),
      exportValue: (p) => p.reference_number ?? '',
    },
    {
      key: 'customer_id',
      header: t('financeCopy.customer', "Customer"),
      cell: (p) => (
        <span className="truncate" title={p.customer_name ?? ''}>
          {p.customer_name ?? '—'}
        </span>
      ),
      exportValue: (p) => p.customer_name ?? '',
    },
    {
      key: 'status',
      header: t('financeCopy.status', "Status"),
      // #784 AC-NAR-006: a cancelled PMO receipt keeps its row (status stays Paid) and reads Cancelled.
      cell: (p) => p.cancelled_at
        ? <StatusPill variant={salesInvoiceStatusVariant('Cancelled')}>{t('financeCopy.statusCancelled', 'Cancelled')}</StatusPill>
        : <StatusPill variant={incomingPaymentStatusVariant(p.status)}>{incomingPaymentStatusLabel(p.status, t)}</StatusPill>,
      exportValue: (p) => (p.cancelled_at ? 'Cancelled' : p.status),
    },
    {
      key: 'amount',
      header: t('financeCopy.amount', "Amount"),
      align: 'num',
      cell: (p) => (
        <span className="tabular text-right font-mono text-[13px]">
          {p.amount != null ? formatCurrencyCents(p.amount, p.currency) : '—'}
        </span>
      ),
      // A NUMBER, not its string: a text cell is unsummable and locale-fragile (#701).
      exportValue: (p) => p.amount ?? '',
    },
    {
      key: 'date',
      header: t('financeCopy.date', "Date"),
      cell: (p) => (p.date ? formatDateOnly(p.date) : '—'),
      exportValue: (p) => p.date ?? '',
    },
    {
      key: 'received_amount', header: t('financeCopy.cashReceived', "Cash received"), align: 'num',
      cell: (p) => p.received_amount != null ? formatCurrencyCents(p.received_amount, p.currency) : '—',
      exportValue: (p) => p.received_amount ?? '',
    },
    {
      key: 'withheld_amount', header: t('financeCopy.taxWithheld', "Tax withheld"), align: 'num',
      cell: (p) => p.withheld_amount != null ? formatCurrencyCents(p.withheld_amount, p.currency) : '—',
      exportValue: (p) => p.withheld_amount ?? '',
    },
    {
      key: 'withholding_slip_number', header: t('financeCopy.withholdingSlip', "Withholding slip"),
      cell: (p) => <span className="font-mono text-[13px]">{p.withholding_slip_number ?? '—'}</span>,
      exportValue: (p) => p.withholding_slip_number ?? '',
    },
  ];

  // AC-L10N-052: the download carries each row's own ISO code beside amount (export-only).
  const exportColumns = withCurrencyColumn(columns, 'amount', (r) => r.currency);

  const rowMenu = (p: IncomingPaymentRow): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    if (canCancel && !p.pmo_native && p.status !== 'Paid')
      items.push({ label: t('financeCopy.cancel', "Cancel"), onClick: () => setCancelTarget(p), danger: true });
    // #784 AC-NAR-006: a PMO receipt is cancelled in PMO while PMO owns revenue (the RPC re-checks all of it).
    if (canCancel && p.pmo_native && !p.cancelled_at && native)
      items.push({ label: t('financeCopy.cancel', "Cancel"), onClick: () => setCancelTarget(p), danger: true });
    return items;
  };

  const onCancelConfirm = async () => {
    if (!cancelTarget) return;
    const key = `cancel:${cancelTarget.id}`;
    try {
      await cancelPayment.mutateAsync({ ipId: cancelTarget.id, intent: verbIntents.intentFor(key) });
      verbIntents.release(key);
      toast(
        cancelTarget.pmo_native ? t('financeCopy.receiptCancelled', 'Receipt cancelled') : t('financeCopy.paymentCancelled', 'Payment cancelled'),
        receiptNumber(cancelTarget) ?? cancelTarget.id,
        'success',
      );
      setCancelTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  return (
    <ListPage
      title={t('financeCopy.incomingPayments', "Incoming Payments")}
      description={native
        ? t('financeCopy.nativeIncomingPaymentsDescription', 'Customer receipts recorded in PMO against approved invoices.')
        : t('financeCopy.paymentsReceivedFromClientsMirroredFromERPNextLinkedToSalesInvoicesWhenApplicable', "Payments received from clients, mirrored from ERPNext. Linked to sales invoices when applicable.")}
      primaryAction={
        canCreate && (
          <Button variant="primary" onClick={() => setFormTarget({ payment: null })}>
            <Icon name="plus" />
            {t('financeCopy.receivePayment', "Receive Payment")}</Button>
        )
      }
      filters={
        state !== 'loading' && (
          <ViewToggle<StatusFilter>
            options={STATUS_FILTERS.map((f) => ({ value: f, label: incomingPaymentStatusLabel(f, t) }))}
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              trackFilterApplied('status', STATUS_FILTERS.length, 'incomingPayments');
            }}
            ariaLabel={t('financeCopy.filterByStatus', "Filter by status")}
          />
        )
      }
      search={
        state !== 'loading' && (
          <SearchMini
            placeholder={t('financeCopy.searchPayments', "Search payments…")}
            aria-label={t('financeCopy.searchIncomingPayments', "Search incoming payments")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            searchSurface="incoming-payments-list"
            module="incomingPayments"
            resultCount={filtered.length}
            containerClassName="max-sm:basis-full max-sm:w-full max-sm:min-w-0 sm:ml-auto"
          />
        )
      }
      exportAction={
        state !== 'loading' && (
          <ExportButton rows={filtered} columns={exportColumns} entity="Incoming Payments" />
        )
      }
    >
      {/* Body */}
      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" rows={6} />
        </div>
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title={t('financeCopy.incomingPaymentsLoadFailed', "Couldn't load incoming payments")}
          sub={t('financeCopy.theRequestFailedCheckYourConnectionAndTryAgain', "The request failed. Check your connection and try again.")}
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="dollar"
          title={t('financeCopy.noIncomingPaymentsYet', "No incoming payments yet")}
          sub={t('financeCopy.recordYourFirstPaymentReceivedFromAClient', "Record your first payment received from a client.")}
          stateId="incoming-payments-empty"
          role={realRole ?? undefined}
          module="incomingPayments"
          action={canCreate ? { label: t('financeCopy.receivePayment', "Receive Payment"), onClick: () => setFormTarget({ payment: null }) } : undefined}
        />
      )}

      {state === undefined && (
        <DataTable<IncomingPaymentRow>
          rows={filtered}
          columns={columns}
          rowKey={(p) => p.id}
          rowMenu={canRowWrite ? rowMenu : undefined}
          state={filtered.length === 0 ? 'empty' : undefined}
          emptyTitle={t('financeCopy.noPaymentsMatchYourFilters', "No payments match your filters")}
          emptySub={t('financeCopy.tryADifferentStatusOrClearTheSearch', "Try a different status or clear the search.")}
        />
      )}

      {/* Create modal */}
      {formTarget && (
        <IncomingPaymentFormModal
          payment={formTarget.payment}
          pendingPush={pendingPush}
          native={native}
          onClose={() => setFormTarget(null)}
          onCreate={async (input, intent) => {
            await createPayment.mutateAsync({ ...input, intent });
            toast(t('financeCopy.paymentCreated', 'Payment created'), input.customerId, 'success');
            setFormTarget(null);
          }}
          onError={(err) => {
            const { headline, detail } = classifyMutationError(err, native ? nativeReceiptErrorHeadlines(err, t) : undefined);
            toast(headline, detail, 'warning');
          }}
        />
      )}

      {/* Cancel confirm (destructive tone) */}
      <ConfirmDialog
        open={!!cancelTarget}
        tone="destructive"
        title={cancelTarget ? t('financeCopy.cancelPaymentNamed', 'Cancel {{payment}}?', { payment: receiptNumber(cancelTarget) ?? cancelTarget.id }) : t('financeCopy.cancelPaymentQuestion', 'Cancel payment?')}
        description={cancelTarget?.pmo_native
          ? t('financeCopy.nativeCancelReceiptBody', "This cancels the receipt in PMO and puts its amount back on the invoice's balance.")
          : t('financeCopy.cancelPaymentDescription', "This cancels the payment in ERPNext (docstatus 1→2). The payment will be marked Cancelled and the linked invoice's outstanding amount will be restored.")}
        confirmLabel={t('financeCopy.cancelPayment', "Cancel payment")}
        loading={cancelPayment.isPending}
        onConfirm={onCancelConfirm}
        onCancel={() => setCancelTarget(null)}
      />
    </ListPage>
  );
};

// ── Create form modal ────────────────────────────────────────────────

interface IncomingPaymentFormModalProps {
  payment: IncomingPaymentRow | null;
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
      date: string;
    },
    intent: CommandIntent,
  ) => Promise<void>;
  onError: (err: unknown) => void;
  pendingPush: PendingPushState;
  /** #784: true while PMO owns revenue — the receipt names its invoice and states its payment date (DD-NAR-17). */
  native: boolean;
}

const IncomingPaymentFormModal: React.FC<IncomingPaymentFormModalProps> = ({
  payment,
  onClose,
  onCreate,
  onError,
  pendingPush,
  native,
}) => {
  const { t } = useTranslation();
  const isEdit = !!payment;
  // The adornment follows the record's own currency when editing one; a create form has no record
  // yet, so it falls back to the org's operating currency (#731) — or, for a PMO receipt, the chosen
  // invoice's (`moneyPrefix` below). The hook is called unconditionally.
  const orgCurrency = useOrgCurrency();
  // BLOCK 2 (ADR-0058): ONE command identity per form session. This modal is mounted only while the
  // form is open, so its mount IS the session: a retry after "external system unreachable" reuses
  // this identity (the committed Payment Entry is reconciled, NOT posted twice), while a success
  // closes the modal → the next "Receive Payment" mints a fresh one.
  const intent = useCommandIntent();
  const form = useEntityForm<FormValues>({
    initialValues: {
      customerId: '',
      salesInvoiceId: null,
      paidAmount: '0',
      receivedAmount: '0',
      withheldAmount: '0',
      withholdingSlipNumber: '',
      // #784 (DD-NAR-17): a PMO receipt's payment date starts at today in the org's time zone.
      date: native ? orgToday() : new Date().toISOString().split('T')[0],
    },
    validate: (values) => validate(values, t, native),
    idPrefix: 'incoming-payment-form',
    requiredFields: ['customerId', 'paidAmount', 'receivedAmount', 'date'],
    module: 'incomingPayments',
  });

  // FK options from the cached hooks ("hooks own data fetching"); the Combobox loaders just hand
  // back the already-fetched lists. The invoice loader depends on the chosen customer, so the
  // picker re-loads when the customer changes.
  const { data: customerOptions } = useClientCompanyOptions();
  const { data: invoices } = useSalesInvoices();
  const loadCustomers = useCallback(async (): Promise<ComboboxOption[]> => customerOptions ?? [], [customerOptions]);
  const selectedCustomerId = form.values.customerId;
  const loadOpenInvoices = useCallback(
    async (): Promise<ComboboxOption[]> => openInvoiceOptions(invoices ?? [], selectedCustomerId),
    [invoices, selectedCustomerId],
  );

  const customerField = form.fieldProps('customerId');
  const salesInvoiceField = form.fieldProps('salesInvoiceId');
  // #784 (DD-NAR-17): the PMO invoice this receipt settles, for the amount's starting value and its helper.
  const chosenInvoice = native ? invoices?.find((inv) => inv.id === salesInvoiceField.value) : undefined;
  // A PMO receipt is recorded in its invoice's currency (0270), so the amounts read in it once one is chosen.
  const moneyPrefix = currencySymbol(payment?.currency ?? chosenInvoice?.currency ?? orgCurrency);
  const paidAmountField = form.fieldProps('paidAmount');
  const receivedAmountField = form.fieldProps('receivedAmount');
  const withheldAmountField = form.fieldProps('withheldAmount');
  const slipField = form.fieldProps('withholdingSlipNumber');
  const dateField = form.fieldProps('date');

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

  const handleSubmit = (e: React.FormEvent) => {

    e.preventDefault();
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
        } : {}),
        date: values.date,
      };
      try {
        await onCreate(input, intent);
      } catch (err) {
        // `suppressCapture` only: the page's own `onError` classifies this same rejection for
        // the toast and owns the single `save_failed` event (ADR-0067). Passing a module here
        // would be a second, competing capture point.
        const { headline, detail } = classifyMutationError(
          err,
          native ? nativeReceiptErrorHeadlines(err, t) : undefined,
          { suppressCapture: true },
        );
        setSaveError({ headline, detail });
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={isEdit ? 'Edit payment' : 'Receive Payment'}
      subtitle={isEdit ? 'Update this incoming payment' : 'Record a new incoming payment from a client'}
      submitLabel={isEdit ? 'Save payment' : 'Record payment'}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
    >
      {!native && pendingPush.status !== 'idle' && (
        <div className="mb-3.5 flex justify-end">
          <span className="text-xs text-muted-foreground">{t('financeCopy.pushingToERPNext', "Pushing to ERPNext…")}</span>
        </div>
      )}
      <FormSection legend={t('financeCopy.paymentDetails', 'Payment details')}>
        <FormGrid>
          <Combobox
            label={t('financeCopy.customer', "Customer")}
            required
            value={customerField.value}
            onChange={(value, _option) => customerField.onChange(value)}
            error={customerField.error}
            placeholder={t('financeCopy.selectOrSearchCustomer', "Select or search customer…")}
            loadOptions={loadCustomers}
            noun="customer"
          />
          <Combobox
            label={native ? t('financeCopy.salesInvoiceLabel', 'Sales Invoice') : t('financeCopy.salesInvoiceOptional', "Sales Invoice (optional)")}
            required={native}
            value={salesInvoiceField.value ?? ''}
            onChange={(value, _option) => {
              salesInvoiceField.onChange(value ?? '');
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
            noun="invoice"
          />
          <NumberField
            label={t('financeCopy.paidAmount', "Paid Amount")}
            value={String(paidAmountField.value)}
            onChange={(v) => paidAmountField.onChange(v)}
            required
            min={0}
            step={0.01}
            prefix={moneyPrefix}
            error={paidAmountField.error}
            helper={chosenInvoice?.erp_outstanding_amount != null
              ? t('financeCopy.nativeReceiptAmountHelper', 'Starts at the {{amount}} outstanding. Enter less for a part payment, or more if the client paid more; the excess shows as overpaid.', {
                  amount: formatCurrencyCents(chosenInvoice.erp_outstanding_amount, chosenInvoice.currency),
                })
              : t('financeCopy.paidAmountHelper', "The full amount applied to the invoice, including tax withheld by the client.")}
            localeAware
          />
          <NumberField
            label={t('financeCopy.receivedAmount', "Received Amount")}
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
          <TextField
            label={native ? t('financeCopy.paymentDateLabel', 'Payment date') : t('financeCopy.date', "Date")}
            max={native ? orgToday() : undefined}
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
    </EntityFormModal>
  );
};

export default IncomingPayments;
