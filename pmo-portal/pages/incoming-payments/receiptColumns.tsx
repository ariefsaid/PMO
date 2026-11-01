import React from 'react';
import { Link, type useLocation } from 'react-router';
import type { useTranslation } from 'react-i18next';
import { StatusPill, type Column } from '@/src/components/ui';
import { withCurrencyColumn } from '@/src/components/export';
import { formatCurrency, formatCurrencyCents, formatDateOnly } from '@/src/lib/format';
import type { IncomingPaymentRow, IncomingPaymentStatus } from '@/src/lib/db/revenue';
import { incomingPaymentStatusVariant, salesInvoiceStatusVariant } from '@/src/lib/status/statusVariants';
import { receiptNumber } from '@/src/lib/revenue/nativeInvoice';
import { displayAllocations, knownUnappliedCash } from '@/src/lib/revenue/receiptAllocation';

/** Status filter segments. "Received"/"Cancelled" are how a PMO receipt reads (I-5): it is recorded as received, never
 *  Scheduled, and a cancelled one keeps its row (DD-NAR-10). */
export type StatusFilter = 'All' | IncomingPaymentStatus | 'Received' | 'Cancelled';
export const ERP_STATUS_FILTERS: StatusFilter[] = ['All', 'Scheduled', 'Paid'];
export const NATIVE_STATUS_FILTERS: StatusFilter[] = ['All', 'Received', 'Cancelled'];

export function incomingPaymentStatusLabel(status: StatusFilter, t: (key: string, fallback: string) => string): string {
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

export function displayStatus(p: IncomingPaymentRow): Exclude<StatusFilter, 'All'> {
  return p.cancelled_at || p.erp_cancelled_at ? 'Cancelled' : p.status;
}

export function matchesStatus(p: IncomingPaymentRow, filter: StatusFilter): boolean {
  const status = displayStatus(p);
  return filter === 'All' || (filter === 'Received' ? status === 'Paid' : status === filter);
}

export function receiptColumns({ t, embedded, location, invoiceNumberById }: {
  t: ReturnType<typeof useTranslation>['t'];
  embedded: boolean;
  location: ReturnType<typeof useLocation>;
  invoiceNumberById: Map<string, string | null>;
}) {
  const invoiceNumberOf = (id: string) => invoiceNumberById.get(id) ?? null;
  const notReported = t('uxs06.notReported', 'Not reported');
  // ponytail: lists read in whole units (G1); exact cents stay on the receipt page.
  const listMoney = embedded ? formatCurrency : formatCurrencyCents;
  const allColumns: Column<IncomingPaymentRow>[] = [
    {
      key: 'ip_number',
      header: t('financeCopy.payment', "Payment #"),
      cell: (p) => embedded ? (
        <span className="truncate font-mono text-[13px]" title={receiptNumber(p) ?? ''}>{receiptNumber(p) ?? '—'}</span>
      ) : (
        <Link
          to={`/incoming-payments/${encodeURIComponent(p.id)}${location.search}`}
          state={{ recordContext: { listPath: `${location.pathname}${location.search}${location.hash}` } }}
          className="truncate font-mono text-[13px] text-foreground underline-offset-2 hover:underline focus-visible:underline"
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
        return <span className="truncate font-mono text-[13px]" title={settled?.map((a) => a.invoice_number).join(', ') ?? first ?? ''}>{text ?? '—'}</span>;
      },
      exportValue: (p) => displayAllocations(p, invoiceNumberOf)?.map((a) => a.invoice_number).join(', ')
        ?? (p.sales_invoice_id ? invoiceNumberById.get(p.sales_invoice_id) ?? '' : ''),
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
      // I-5: a live PMO receipt reads Received — the same word as its filter.
      cell: (p) => displayStatus(p) === 'Cancelled'
        ? <StatusPill variant={salesInvoiceStatusVariant('Cancelled')}>{t('financeCopy.statusCancelled', 'Cancelled')}</StatusPill>
        : <StatusPill variant={incomingPaymentStatusVariant(p.status)}>{incomingPaymentStatusLabel(displayStatus(p), t)}</StatusPill>,
      exportValue: (p) => (displayStatus(p) === 'Cancelled' ? 'Cancelled' : displayStatus(p) === 'Paid' ? 'Received' : 'Expected'),
    },
    {
      key: 'amount',
      header: t('financeCopy.amount', "Amount"),
      align: 'num',
      cell: (p) => (
        <span className="tabular text-right text-[13px]">
          {p.amount != null ? listMoney(p.amount, p.currency) : '—'}
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
      cell: (p) => p.received_amount != null ? listMoney(p.received_amount, p.currency) : '—',
      exportValue: (p) => p.received_amount ?? '',
    },
    {
      // S-06 (RF-032): None = known to be zero; Not reported = the source never said. Unknown is not zero.
      key: 'withheld_amount', header: t('financeCopy.taxWithheld', "Tax withheld"), align: 'num',
      cell: (p) => p.withheld_amount == null ? <span className="text-muted-foreground">{notReported}</span>
        : p.withheld_amount === 0 ? t('uxs06.none', 'None') : listMoney(p.withheld_amount, p.currency),
      exportValue: (p) => p.withheld_amount ?? '',
    },
    {
      // S-06 (RF-031): cash the accounting system has not matched to any invoice.
      key: 'unapplied', header: t('uxs06.unappliedCol', 'Not yet applied'), align: 'num',
      cell: (p) => {
        const unapplied = knownUnappliedCash({ ...p, allocation_details: displayAllocations(p, invoiceNumberOf) });
        return unapplied === null ? <span className="text-muted-foreground">{notReported}</span>
          : unapplied === 0 ? t('uxs06.none', 'None') : <span className="font-medium">{listMoney(unapplied, p.currency)}</span>;
      },
      exportValue: (p) => knownUnappliedCash({ ...p, allocation_details: displayAllocations(p, invoiceNumberOf) }) ?? '',
    },
    {
      key: 'withholding_slip_number', header: t('financeCopy.withholdingSlip', "Withholding slip"),
      cell: (p) => <span className="font-mono text-[13px]">{p.withholding_slip_number ?? '—'}</span>,
      exportValue: (p) => p.withholding_slip_number ?? '',
    },
  ];

  // FIN-S5: cash received, tax withheld, not-yet-applied and the slip live on the receipt record; the list keeps
  // seven columns and the download keeps all eleven.
  const EXPORT_ONLY = new Set(['received_amount', 'withheld_amount', 'unapplied', 'withholding_slip_number']);
  const columns = allColumns.filter((column) => !EXPORT_ONLY.has(column.key));
  // AC-L10N-052: the download carries each row's own ISO code beside amount (export-only).
  const exportColumns = withCurrencyColumn(allColumns, 'amount', (r) => r.currency);

  return { columns, exportColumns };
}
