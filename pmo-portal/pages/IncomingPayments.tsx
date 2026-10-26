import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackBar } from '@/src/components/shell';
import {
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
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
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
  formatCurrencyAuto,
  formatDateOnly,
  formatMoneyInputValue,
  instantToZonedDatetimeLocal,
  parseMoneyInputAtScale,
} from '@/src/lib/format';
import type { IncomingPaymentRow, IncomingPaymentStatus, SalesInvoiceRow } from '@/src/lib/db/revenue';
import { incomingPaymentStatusVariant, salesInvoiceStatusVariant } from '@/src/lib/status/statusVariants';
import { useRevenueMode } from '@/src/hooks/useRevenueMode';
import { invoiceNumber, receiptNumber } from '@/src/lib/revenue/nativeInvoice';
import { nativeRevenueHeadlines } from '@/src/lib/revenue/nativeRevenueErrors';
import { type PendingPushState } from '@/src/lib/adapterSeam/pendingPush';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { useCommandIntent, useCommandIntentMap } from '@/src/hooks/useCommandIntent';
import type { CommandIntent } from '@/src/lib/repositories/types';
import { displayAllocations, knownUnappliedCash } from '@/src/lib/revenue/receiptAllocation';
import { ReceiptRecord } from './incoming-payments/ReceiptRecord';
import { MoneyInPageHeader } from './money-in/MoneyInPageHeader';

/** Status filter segments. "Received"/"Cancelled" are how a PMO receipt reads (I-5): it is recorded as received, never
 *  Scheduled, and a cancelled one keeps its row (DD-NAR-10). */
type StatusFilter = 'All' | IncomingPaymentStatus | 'Received' | 'Cancelled';
const ERP_STATUS_FILTERS: StatusFilter[] = ['All', 'Scheduled', 'Paid'];
const NATIVE_STATUS_FILTERS: StatusFilter[] = ['All', 'Received', 'Cancelled'];

function incomingPaymentStatusLabel(status: StatusFilter, t: (key: string, fallback: string) => string): string {
  const labels: Record<StatusFilter, string> = {
    All: t('financeCopy.statusAll', 'All'),
    // S-06 (RF-033): a receipt is cash Expected or Received — Paid / Scheduled are invoice words.
    Scheduled: t('uxs06.statusExpected', 'Expected'),
    Paid: t('uxs06.statusReceived', 'Received'),
    Received: t('uxs06.statusReceived', 'Received'),
    Cancelled: t('financeCopy.statusCancelled', 'Cancelled'),
  };
  return labels[status] ?? status;
}

function matchesStatus(p: IncomingPaymentRow, filter: StatusFilter): boolean {
  if (filter === 'All') return true;
  if (filter === 'Cancelled') return Boolean(p.cancelled_at);
  if (filter === 'Received') return p.status === 'Paid' && !p.cancelled_at;
  return p.status === filter;
}

type ReceiptSort = 'payment-date-desc' | 'payment-date-asc';

function sortReceipts(rows: IncomingPaymentRow[], sort: ReceiptSort): IncomingPaymentRow[] {
  const direction = sort === 'payment-date-desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (a.date == null && b.date != null) return 1;
    if (a.date != null && b.date == null) return -1;
    if (a.date && b.date) {
      const byPaymentDate = a.date.localeCompare(b.date) * direction;
      if (byPaymentDate) return byPaymentDate;
    }
    const byCreated = b.created_at.localeCompare(a.created_at);
    return byCreated || a.id.localeCompare(b.id);
  });
}

function isReceiptSort(value: string | null): value is ReceiptSort {
  return value === 'payment-date-desc' || value === 'payment-date-asc';
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

const validate = (
  v: FormValues,
  t: (key: string, fallback: string) => string,
  native = false,
  invoiceDate?: string | null,
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
  else if (native && v.date > orgToday()) errors.date = t('financeCopy.paymentDateNotFuture', 'The payment date cannot be in the future.');
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
function openInvoiceOptions(
  invoices: SalesInvoiceRow[],
  customerId: string | null | undefined,
  native: boolean,
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string,
): ComboboxOption[] {
  return invoices
    // I-5: a PMO receipt settles only a PMO invoice; an ERP payment never settles a PMO invoice frozen at connect.
    .filter((inv) => Boolean(inv.pmo_native) === native)
    .filter((inv) => inv.status === 'Submitted' || inv.status === 'Unpaid')
    .filter((inv) => inv.erp_outstanding_amount == null || inv.erp_outstanding_amount > 0)
    .filter((inv) => !customerId || inv.customer_id === customerId)
    .map((inv) => ({
      value: inv.id,
      label: invoiceNumber(inv) ?? inv.id,
      sub:
        inv.erp_outstanding_amount != null
          ? t('financeCopy.amountOutstanding', '{{amount}} outstanding', { amount: formatCurrencyAuto(inv.erp_outstanding_amount, inv.currency) })
          : undefined,
    }));
}

const IncomingPayments: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { receiptId } = useParams<{ receiptId: string }>();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useIncomingPayments();
  const { createPayment, cancelPayment, pendingPush } = useRevenueMutations();
  // #784: undefined while ownership loads — the page waits rather than flash the wrong mode's copy and actions.
  const mode = useRevenueMode();
  const native = mode === 'native';
  const statusFilters = native ? NATIVE_STATUS_FILTERS : ERP_STATUS_FILTERS;
  const { data: customerOptions = [] } = useClientCompanyOptions();
  // I-5: the invoice each receipt settles, by its number (the list read already holds them).
  const { data: invoiceList } = useSalesInvoices();
  const invoiceNumberById = useMemo(
    () => new Map((invoiceList ?? []).map((inv) => [inv.id, invoiceNumber(inv)])),
    [invoiceList],
  );

  const canView = may('view', 'incomingPayment');
  const canCreate = may('create', 'incomingPayment');
  const canCancel = may('transition', 'incomingPayment');
  const canRowWrite = canCancel;

  const all = useMemo(() => data ?? [], [data]);

  const search = searchParams.get('q') ?? '';
  const requestedStatus = searchParams.get('status');
  const statusFilter = statusFilters.includes(requestedStatus as StatusFilter)
    ? requestedStatus as StatusFilter
    : 'All';
  const customerFilter = searchParams.get('customer') ?? '';
  const requestedSort = searchParams.get('sort');
  const receiptSort: ReceiptSort = isReceiptSort(requestedSort) ? requestedSort : 'payment-date-desc';

  const updateListParam = (key: string, value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  };

  useEffect(() => {
    const requestedSort = searchParams.get('sort');
    const requested = searchParams.get('status');
    const invalidStatus = requested !== null
      && (requested === 'All' || !statusFilters.includes(requested as StatusFilter));
    const invalidSort = requestedSort !== null && !isReceiptSort(requestedSort);
    if (!invalidStatus && !invalidSort) return;
    const next = new URLSearchParams(searchParams);
    if (invalidStatus) next.delete('status');
    if (invalidSort) next.set('sort', 'payment-date-desc');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, statusFilters]);

  const [formTarget, setFormTarget] = useState<{ payment: IncomingPaymentRow | null } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<IncomingPaymentRow | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);

  // BLOCK 2 (ADR-0058): the cancel confirm dialog is ALWAYS mounted, so its command identity is per
  // (record, verb) — a retry on payment B must never carry payment A's key. Released only after a
  // terminal success (never on error — reusing the key on retry IS the fix).
  const verbIntents = useCommandIntentMap();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matching = all
      .filter((p) => matchesStatus(p, statusFilter))
      .filter((p) => !customerFilter || p.customer_id === customerFilter)
      .filter((p) => !q
        || receiptNumber(p)?.toLowerCase().includes(q)
        // #781 (AC-FIN-001): the list search also indexes the resolved customer company name.
        || p.customer_name?.toLowerCase().includes(q));
    return sortReceipts(matching, receiptSort);
  }, [all, customerFilter, receiptSort, search, statusFilter]);

  const state: 'loading' | 'empty' | 'error' | undefined = isPending || mode === undefined
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
          <h2 className="type-section-head text-heading">{t('financeCopy.youDonTHaveAccessToIncomingPayments', "You don't have access to Incoming Payments")}</h2>
          <p className="mt-2 text-muted-foreground">
            {t('financeCopy.theIncomingPaymentsListIsAvailableToFinanceProjectManagersAndExecutives', "The incoming payments list is available to Finance, Project Managers, and Executives.")}</p>
          <Button variant="outline" onClick={() => navigate('/')} className="mt-4">
            <Icon name="back" className="size-4 mr-2" />
            {t('financeCopy.backToDashboard', "Back to dashboard")}</Button>
        </div>
      </div>
    );
  }

  const invoiceNumberOf = (invoiceId: string) => invoiceNumberById.get(invoiceId) ?? null;

  const notReported = t('uxs06.notReported', 'Not reported');
  const allColumns: Column<IncomingPaymentRow>[] = [
    {
      key: 'ip_number',
      header: t('financeCopy.payment', "Payment #"),
      cell: (p) => (
        <Link
          to={`/incoming-payments/${encodeURIComponent(p.id)}`}
          className="inline-flex min-h-11 items-center break-words font-mono text-sm text-foreground underline-offset-2 hover:underline focus-visible:underline"
          title={receiptNumber(p) ?? ''}
        >
          {receiptNumber(p) ?? '—'}
        </Link>
      ),
      exportValue: (p) => receiptNumber(p) ?? '',
    },
    {
      key: 'sales_invoice_id',
      header: t('financeCopy.invoice', "Invoice #"),
      cell: (p) => {
        // S-06 (RF-030): a receipt that settled several invoices names the first and how many more.
        const settled = displayAllocations(p, invoiceNumberOf);
        const first = settled?.[0]?.invoice_number ?? (p.sales_invoice_id ? invoiceNumberById.get(p.sales_invoice_id) ?? null : null);
        const more = settled && settled.length > 1 ? settled.length - 1 : 0;
        const text = first && more > 0 ? t('uxs06.invoiceAndMore', '{{first}} +{{count}} more', { first, count: more }) : first;
        return <span className="break-words font-mono text-sm" title={settled?.map((a) => a.invoice_number).join(', ') ?? first ?? ''}>{text ?? '—'}</span>;
      },
      exportValue: (p) => displayAllocations(p, invoiceNumberOf)?.map((a) => a.invoice_number).join(', ')
        ?? (p.sales_invoice_id ? invoiceNumberById.get(p.sales_invoice_id) ?? '' : ''),
    },
    {
      key: 'reference_number',
      header: t('financeCopy.reference', "Reference"),
      cell: (p) => (
        <span className="min-w-0 break-words text-muted-foreground">
          {p.reference_number ?? '—'}
        </span>
      ),
      exportValue: (p) => p.reference_number ?? '',
    },
    {
      key: 'customer_id',
      header: t('financeCopy.customer', "Customer"),
      cell: (p) => (
        <span className="min-w-0 break-words">
          {p.customer_name ?? '—'}
        </span>
      ),
      exportValue: (p) => p.customer_name ?? '',
    },
    {
      key: 'status',
      header: t('financeCopy.status', "Status"),
      // #784 AC-NAR-006: a cancelled PMO receipt keeps its row (status stays Paid) and reads Cancelled.
      // I-5: a live PMO receipt reads Received — the same word as its filter.
      cell: (p) => p.cancelled_at || p.erp_cancelled_at
        ? <StatusPill variant={salesInvoiceStatusVariant('Cancelled')}>{t('financeCopy.statusCancelled', 'Cancelled')}</StatusPill>
        : <StatusPill variant={incomingPaymentStatusVariant(p.status)}>{incomingPaymentStatusLabel(p.pmo_native && p.status === 'Paid' ? 'Received' : p.status, t)}</StatusPill>,
      exportValue: (p) => (p.cancelled_at || p.erp_cancelled_at ? 'Cancelled' : p.status === 'Paid' ? 'Received' : 'Expected'),
    },
    {
      key: 'amount',
      header: t('financeCopy.amount', "Amount"),
      align: 'num',
      cell: (p) => (
        <span className="tabular text-right text-sm">
          {p.amount != null ? formatCurrencyAuto(p.amount, p.currency) : '—'}
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
      cell: (p) => p.received_amount != null ? formatCurrencyAuto(p.received_amount, p.currency) : '—',
      exportValue: (p) => p.received_amount ?? '',
    },
    {
      // S-06 (RF-032): None = known to be zero; Not reported = the source never said. Unknown is not zero.
      key: 'withheld_amount', header: t('financeCopy.taxWithheld', "Tax withheld"), align: 'num',
      cell: (p) => p.withheld_amount == null ? <span className="text-muted-foreground">{notReported}</span>
        : p.withheld_amount === 0 ? t('uxs06.none', 'None') : formatCurrencyAuto(p.withheld_amount, p.currency),
      exportValue: (p) => p.withheld_amount ?? '',
    },
    {
      // S-06 (RF-031): cash the accounting system has not matched to any invoice.
      key: 'unapplied', header: t('uxs06.unappliedCol', 'Not yet applied'), align: 'num',
      cell: (p) => {
        const unapplied = knownUnappliedCash({ ...p, allocation_details: displayAllocations(p, invoiceNumberOf) });
        return unapplied === null ? <span className="text-muted-foreground">{notReported}</span>
          : unapplied === 0 ? t('uxs06.none', 'None') : <span className="font-medium">{formatCurrencyAuto(unapplied, p.currency)}</span>;
      },
      exportValue: (p) => knownUnappliedCash({ ...p, allocation_details: displayAllocations(p, invoiceNumberOf) }) ?? '',
    },
    {
      key: 'withholding_slip_number', header: t('financeCopy.withholdingSlip', "Withholding slip"),
      cell: (p) => <span className="font-mono text-sm">{p.withholding_slip_number ?? '—'}</span>,
      exportValue: (p) => p.withholding_slip_number ?? '',
    },
  ];

  // The XLSX retains reconciliation fields hidden from the collection, with each row's ISO currency.
  const exportColumns = withCurrencyColumn(allColumns, 'amount', (r) => r.currency);
  const columns: Column<IncomingPaymentRow>[] = [
    {
      key: 'receipt',
      header: t('financeCopy.payment', 'Payment #'),
      kind: 'primary',
      primaryTitle: (p) => receiptNumber(p) ?? p.id,
      cell: (p) => {
        const url = `/incoming-payments/${encodeURIComponent(p.id)}`;
        const sourceUrl = `${location.pathname}${location.search}`;
        return (
          <Link
            to={url}
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              navigate(url, { state: { moneyInSource: { url: sourceUrl, scrollY: window.scrollY } } });
            }}
            className="inline-flex min-h-11 items-center break-words font-mono text-sm text-foreground underline-offset-2 hover:underline focus-visible:underline"
            title={receiptNumber(p) ?? ''}
          >
            {receiptNumber(p) ?? '—'}
          </Link>
        );
      },
      secondaryCell: (p) => {
        const settled = displayAllocations(p, invoiceNumberOf);
        const invoice = settled?.[0]?.invoice_number
          ?? (p.sales_invoice_id ? invoiceNumberById.get(p.sales_invoice_id) ?? null : null);
        const more = settled && settled.length > 1 ? settled.length - 1 : 0;
        const invoiceLabel = invoice && more > 0
          ? t('uxs06.invoiceAndMore', '{{first}} +{{count}} more', { first: invoice, count: more })
          : invoice ?? t('moneyIn:uxs06.noInvoiceLinked', 'No invoice linked');
        return <span className="block break-words text-xs text-muted-foreground">{p.customer_name ?? t('moneyIn:uxs06.customerUnavailable', 'Customer unavailable')} · {invoiceLabel}</span>;
      },
      exportValue: (p) => receiptNumber(p) ?? '',
    },
    {
      key: 'status-date',
      header: t('moneyIn:uxs06.statusAndPaymentDate', 'Status / payment date'),
      kind: 'status',
      cell: (p) => (
        <div className="flex min-w-0 flex-col items-start gap-1">
          {p.cancelled_at || p.erp_cancelled_at
            ? <StatusPill variant={salesInvoiceStatusVariant('Cancelled')}>{t('financeCopy.statusCancelled', 'Cancelled')}</StatusPill>
            : <StatusPill variant={incomingPaymentStatusVariant(p.status)}>{incomingPaymentStatusLabel(p.pmo_native && p.status === 'Paid' ? 'Received' : p.status, t)}</StatusPill>}
          <span className="text-xs text-muted-foreground">{p.date ? formatDateOnly(p.date) : t('moneyIn:uxs06.dateNotReported', 'Date not reported')}</span>
        </div>
      ),
    },
    {
      key: 'receipt-total',
      header: t('uxs06.receiptTotal', 'Receipt total'),
      kind: 'money',
      align: 'num',
      cell: (p) => <span className="tabular text-right text-sm">{p.amount != null ? formatCurrencyAuto(p.amount, p.currency) : t('uxs06.notReported', 'Not reported')}</span>,
      exportValue: (p) => p.amount ?? '',
    },
  ];

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
      const { headline, detail } = classifyMutationError(err, nativeRevenueHeadlines(t));
      toast(headline, detail, 'warning');
    }
  };

  const record = receiptId ? all.find((p) => p.id === receiptId) : undefined;
  const moneyInSource = (location.state as { moneyInSource?: { url?: string; scrollY?: number } } | null)?.moneyInSource;
  const returnUrl = moneyInSource?.url ?? `/incoming-payments${location.search}`;
  const returnFromRecord = () => {
    navigate(returnUrl);
    if (moneyInSource?.scrollY) {
      window.requestAnimationFrame(() => window.scrollTo({ top: moneyInSource.scrollY, behavior: 'instant' }));
    }
  };
  const cancelDialog = (
    <ConfirmDialog
      open={!!cancelTarget}
      tone="destructive"
      title={cancelTarget ? t('financeCopy.cancelPaymentNamed', 'Cancel {{payment}}?', { payment: receiptNumber(cancelTarget) ?? cancelTarget.id }) : t('financeCopy.cancelPaymentQuestion', 'Cancel payment?')}
      description={cancelTarget?.pmo_native
        ? t('financeCopy.nativeCancelReceiptBody', "This cancels the receipt in PMO and puts its amount back on the invoice's balance.")
        : t('financeCopy.cancelPaymentDescription', "This cancels the payment in ERPNext (docstatus 1→2). The payment will be marked Cancelled and the linked invoice's outstanding amount will be restored.")}
      confirmLabel={t('financeCopy.cancelPayment', 'Cancel payment')}
      loading={cancelPayment.isPending}
      onConfirm={onCancelConfirm}
      onCancel={() => setCancelTarget(null)}
    />
  );

  if (receiptId) {
    const returnAction = <BackBar label={t('shell.nav.incomingPayments', 'Incoming Payments')} onBack={returnFromRecord} phoneOnly />;
    if (state === 'loading') {
      return <div className="min-w-0">
        <MoneyInPageHeader kind="record" title={t('uxs06.receiptTitle', 'Receipt {{number}}', { number: receiptId })} returnAction={returnAction} />
        <ListState variant="loading" rows={3} />
      </div>;
    }
    if (state === 'error') {
      return <div className="min-w-0">
        <MoneyInPageHeader kind="record" title={t('uxs06.receiptTitle', 'Receipt {{number}}', { number: receiptId })} returnAction={returnAction} />
        <ListState variant="error" title={t('financeCopy.incomingPaymentsLoadFailed', "Couldn't load incoming payments")} onRetry={() => void refetch()} retryLabel={t('ui.listState.retry', 'Retry')} />
      </div>;
    }
    if (!record) {
      return <div className="min-w-0">
        <MoneyInPageHeader kind="record" title={t('uxs06.receiptTitle', 'Receipt {{number}}', { number: receiptId })} returnAction={returnAction} />
        <ListState variant="empty" icon="doc" title={t('uxs06.receiptNotFound', "We couldn't find this receipt")} sub={t('uxs06.receiptNotFoundBody', 'It may have been removed, or you may not have access to it.')} />
      </div>;
    }
    const recordCanCancel = canCancel && ((record.pmo_native && !record.cancelled_at && native) || (!record.pmo_native && record.status !== 'Paid'));
    return <>
      <ReceiptRecord
        receipt={record}
        allocations={displayAllocations(record, invoiceNumberOf)}
        onBack={returnFromRecord}
        onCancel={recordCanCancel ? () => setCancelTarget(record) : undefined}
      />
      {cancelDialog}
    </>;
  }

  return (
    <div className="min-w-0">
      <MoneyInPageHeader
        title={t('financeCopy.incomingPayments', 'Incoming Payments')}
        scope={native
          ? t('financeCopy.nativeIncomingPaymentsDescription', 'Customer receipts recorded in PMO against approved invoices.')
          : t('financeCopy.paymentsReceivedFromClientsMirroredFromERPNextLinkedToSalesInvoicesWhenApplicable', 'Payments received from clients, mirrored from ERPNext. Linked to sales invoices when applicable.')}
      />

      <div data-testid="money-in-toolbar" className="mb-4 flex min-w-0 flex-col gap-2 md:flex-row md:flex-wrap md:items-center" role="group" aria-label={t('moneyIn:uxs06.receiptFilters', 'Receipt filters')}>
        {state !== 'empty' && <>
        <SearchMini
          placeholder={t('financeCopy.searchPayments', 'Search payments…')}
          aria-label={t('financeCopy.searchIncomingPayments', 'Search incoming payments')}
          value={search}
          onChange={(event) => updateListParam('q', event.target.value)}
          searchSurface="incoming-payments-list"
          module="incomingPayments"
          resultCount={filtered.length}
          className="min-h-11"
          containerClassName="w-full min-w-0 min-h-11 md:w-64"
        />
        <Button
          type="button"
          variant="outline"
          aria-expanded={filtersOpen}
          aria-controls="receipt-collection-filters"
          className="min-h-11 md:hidden"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          {t('uxs14.filters', 'Filters')}{statusFilter !== 'All' || customerFilter ? ` · ${Number(statusFilter !== 'All') + Number(Boolean(customerFilter))}` : ''}
        </Button>
        <div id="receipt-collection-filters" className={`${filtersOpen ? 'flex' : 'hidden'} min-w-0 flex-wrap items-center gap-2 md:flex md:flex-1`}>
            <label className="sr-only" htmlFor="receipt-customer-filter">{t('moneyIn:financeCopy.filterByCustomer', 'Filter by customer')}</label>
            <select
              id="receipt-customer-filter"
              aria-label={t('moneyIn:financeCopy.filterByCustomer', 'Filter by customer')}
              value={customerFilter}
              onChange={(event) => updateListParam('customer', event.target.value)}
              className="min-h-11 min-w-0 max-w-full rounded-md border border-border bg-card px-3 text-sm text-foreground"
            >
              <option value="">{t('moneyIn:uxs06.allCustomers', 'All customers')}</option>
              {customerFilter && !customerOptions.some((option) => option.value === customerFilter) && (
                <option value={customerFilter}>{t('moneyIn:uxs06.customerUnavailable', 'Customer unavailable')}</option>
              )}
              {customerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <ViewToggle<StatusFilter>
              options={statusFilters.map((filter) => ({ value: filter, label: incomingPaymentStatusLabel(filter, t) }))}
              value={statusFilter}
              onChange={(value) => {
                updateListParam('status', value === 'All' ? '' : value);
                trackFilterApplied('status', statusFilters.length, 'incomingPayments');
              }}
              ariaLabel={t('financeCopy.filterByStatus', 'Filter by status')}
            />
        </div>
        <label className="min-w-0 md:w-auto">
          <span className="sr-only">{t('moneyIn:uxs06.sortReceipts', 'Sort receipts')}</span>
          <select
            id="receipt-sort"
            aria-label={t('moneyIn:uxs06.sortReceipts', 'Sort receipts')}
            value={receiptSort}
            onChange={(event) => updateListParam('sort', event.target.value)}
            className="min-h-11 w-full min-w-0 rounded-md border border-border bg-card px-3 text-sm text-foreground md:w-auto"
          >
            <option value="payment-date-desc">{t('moneyIn:uxs06.latestPaymentDate', 'Latest payment date')}</option>
            <option value="payment-date-asc">{t('moneyIn:uxs06.oldestPaymentDate', 'Oldest payment date')}</option>
          </select>
        </label>
        </>}
        <div className="flex min-w-0 items-center gap-2 md:ml-auto">
          {state !== 'empty' && <>
          <Button
            type="button"
            variant="outline"
            aria-expanded={moreActionsOpen}
            aria-controls="receipt-collection-more-actions"
            className="min-h-11 flex-1 md:hidden"
            onClick={() => setMoreActionsOpen((open) => !open)}
          >{t('uxs14.moreActions', 'More actions')}</Button>
          <div id="receipt-collection-more-actions" className={`${moreActionsOpen ? 'flex' : 'hidden'} min-w-0 md:flex`}>
            <ExportButton rows={filtered} columns={exportColumns} entity={t('moneyIn:uxs06.receipts', 'Receipts')} className="min-h-11" disabled={state === 'loading' || state === 'error'} />
          </div>
          </>}
          {mode !== undefined && canCreate && (
            <Button variant="primary" onClick={() => setFormTarget({ payment: null })} className="min-h-11 w-full md:w-auto">
              <Icon name="plus" />
              {t('financeCopy.receivePayment', 'Receive Payment')}
            </Button>
          )}
        </div>
      </div>

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
          sub={canCreate
            ? t('financeCopy.recordYourFirstPaymentReceivedFromAClient', 'No client receipts have been recorded yet. Use Receive Payment when a client payment arrives.')
            : t('uxs26.receiptsEmptyProjectManager', 'No client receipts have been recorded yet. Finance records client payments.')}
          stateId="incoming-payments-empty"
          role={realRole ?? undefined}
          module="incomingPayments"
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
          emptyAction={{
            label: t('moneyIn:financeCopy.clearFilters', 'Clear filters'),
            onClick: () => {
              setSearchParams((current) => {
                const next = new URLSearchParams(current);
                for (const key of ['q', 'status', 'customer', 'sort']) next.delete(key);
                return next;
              }, { replace: true });
            },
          }}
        tableId="incomingpayments-table" />
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
            toast(t('financeCopy.paymentCreated', 'Payment created'), undefined, 'success');
            setFormTarget(null);
          }}
        />
      )}

      {cancelDialog}
    </div>
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
  pendingPush: PendingPushState;
  /** #784: true while PMO owns revenue — the receipt names its invoice and states its payment date (DD-NAR-17). */
  native: boolean;
}

const IncomingPaymentFormModal: React.FC<IncomingPaymentFormModalProps> = ({
  payment,
  onClose,
  onCreate,
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
  const { data: invoices } = useSalesInvoices();
  const invoiceDateOf = (id: string | null) => (id ? invoices?.find((inv) => inv.id === id)?.invoice_date ?? null : null);
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
    validate: (values) => validate(values, t, native, invoiceDateOf(values.salesInvoiceId)),
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
  const loadOpenInvoices = useCallback(
    async (): Promise<ComboboxOption[]> => openInvoiceOptions(invoices ?? [], selectedCustomerId, native, t),
    [invoices, selectedCustomerId, native, t],
  );

  const customerField = form.fieldProps('customerId');
  const salesInvoiceField = form.fieldProps('salesInvoiceId');
  // #784 (DD-NAR-17): the PMO invoice this receipt settles, for the amount's starting value and its helper.
  const chosenInvoice = native ? invoices?.find((inv) => inv.id === salesInvoiceField.value) : undefined;
  // A PMO receipt is recorded in its invoice's currency (0275), so the amounts read in it once one is chosen.
  const moneyPrefix = currencySymbol(payment?.currency ?? chosenInvoice?.currency ?? orgCurrency);
  const paidAmountField = form.fieldProps('paidAmount');
  const receivedAmountField = form.fieldProps('receivedAmount');
  const withheldAmountField = form.fieldProps('withheldAmount');
  const slipField = form.fieldProps('withholdingSlipNumber');
  const dateField = form.fieldProps('date');
  const withholdingPanelId = React.useId();
  const [withholdingExpanded, setWithholdingExpanded] = useState(() =>
    Boolean((payment?.withheld_amount ?? 0) > 0 || payment?.withholding_slip_number?.trim()),
  );
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
      className="min-h-11"
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

  const handleSubmit = (e: React.FormEvent) => {

    e.preventDefault();
    // Expand before EntityFormModal focuses the first invalid field after submit. The
    // existing validator remains the authority; this read only keeps that field visible.
    const withholdingErrors = validate(form.values, t, native, invoiceDateOf(form.values.salesInvoiceId));
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
        } : {}),
        date: values.date,
      };
      try {
        await onCreate(input, intent);
      } catch (err) {
        // A rejected save is shown ONCE — here, persistently, in the dialog (#559) — not also as a toast, so this is
        // the form's one `save_failed` capture point (ADR-0067). Headlines are keyed on the refusal code (#784).
        const { headline, detail } = classifyMutationError(err, nativeRevenueHeadlines(t), { module: 'sales' });
        setSaveError({ headline, detail });
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={isEdit ? t('financeCopy.editPaymentTitle', 'Edit payment') : t('financeCopy.receivePayment', 'Receive Payment')}
      subtitle={isEdit ? t('financeCopy.editPaymentSubtitle', 'Update this incoming payment') : t('financeCopy.receivePaymentSubtitle', 'Record a new incoming payment from a client')}
      submitLabel={isEdit ? t('financeCopy.savePayment', 'Save payment') : t('financeCopy.recordPayment', 'Record payment')}
      cancelLabel={t('financeCopy.cancel', 'Cancel')}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      disabledReasonVisible
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
            id={customerField.id}
            triggerClassName="min-h-11"
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
            id={salesInvoiceField.id}
            triggerClassName="min-h-11"
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
            id={paidAmountField.id}
            label={t('uxs27.amountSettled', 'Amount settled')}
            value={String(paidAmountField.value)}
            onChange={(v) => {
              // I-5: while nothing is withheld, the cash received IS the amount paid — keep them in step.
              const withheldNow = form.values.withheldAmount.trim() ? parseMoneyInputAtScale(form.values.withheldAmount, 2) : 0;
              if (native && withheldNow === 0) form.setValues({ paidAmount: v, receivedAmount: v });
              else paidAmountField.onChange(v);
            }}
            required
            min={0}
            step={0.01}
            prefix={moneyPrefix}
            error={paidAmountField.error}
            helper={chosenInvoice?.erp_outstanding_amount != null
              ? t('financeCopy.nativeReceiptAmountHelper', 'Starts at the {{amount}} outstanding. Enter less for a part payment, or more if the client paid more; the excess shows as overpaid.', {
                amount: formatCurrencyAuto(chosenInvoice.erp_outstanding_amount, chosenInvoice.currency),
              })
              : undefined}
            localeAware
            className="min-h-11"
          />
          {cashReceivedField}
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
              <div className="mt-2 min-w-0 space-y-1 text-sm text-muted-foreground">
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
                  className="min-h-11"
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
                  className="min-h-11"
                />
              </FormGrid>
            </div>
          </div>
          <TextField
            id={dateField.id}
            label={native ? t('financeCopy.paymentDateLabel', 'Payment date') : t('financeCopy.date', "Date")}
            max={native ? orgToday() : undefined}
            min={native ? chosenInvoice?.invoice_date ?? undefined : undefined}
            value={dateField.value}
            onChange={dateField.onChange}
            onBlur={dateField.onBlur}
            required
            error={dateField.error}
            type="date"
            className="min-h-11 w-48"
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default IncomingPayments;
