import React from 'react';
import { Link, type Location } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Badge, Icon, StatusPill, TaxBasisLabel, Tooltip, type Column } from '@/src/components/ui';
import { EfakturCell } from '@/src/components/EfakturCell';
import { withCurrencyColumn } from '@/src/components/export';
import FxEquivalent from '@/src/components/fx/FxEquivalent';
import { formatCurrency, formatCurrencyAuto, formatCurrencyCents, formatDateOnly, formatInstantDate } from '@/src/lib/format';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import type { TaxTreatment } from '@/src/lib/db/procurementLifecycle';
import { deriveArDueDate } from '@/src/lib/repositories/revenueDisplay';
import { salesInvoiceStatusVariant } from '@/src/lib/status/statusVariants';
import { invoiceGross, invoiceNumber, overpaidBy, paidToDate } from '@/src/lib/revenue/nativeInvoice';
import { salesInvoiceStatusLabel } from './salesInvoiceListModel';

interface Props {
  t: ReturnType<typeof useTranslation>['t'];
  all: SalesInvoiceRow[];
  embedded: boolean;
  native: boolean;
  location: Location;
  orgCurrency: string;
  sharedTaxBasis: TaxTreatment | null;
  projectOptionsById: Map<string, { contractualName?: string | null }>;
  projectsById: Map<string, { pm?: { full_name: string | null } | null }>;
  profilesById: Map<string, { full_name: string | null }>;
  invoiceStatus: (invoice: SalesInvoiceRow) => { label: string; variant: ReturnType<typeof salesInvoiceStatusVariant>; partlySettled: boolean };
}
export function salesInvoiceColumns({ t, all, embedded, native, location, orgCurrency, sharedTaxBasis, projectOptionsById, projectsById, profilesById, invoiceStatus }: Props) {
  // FIN-S1 / T4 (AC-RD-TBL-INV-001): one primary cell (number over customer), then at most six more
  // columns. Dates other than Due, and the separate Customer, are export-only below.
  const projectLabelOf = (inv: SalesInvoiceRow) => projectOptionsById.get(inv.project_id ?? '')?.contractualName;
  const showEfaktur = all.some((inv) => inv.efaktur_number || inv.efaktur_date);
  // Lists show whole units (G1); exact cents stay on the record page.
  const listMoney = embedded ? formatCurrency : formatCurrencyAuto;
  const invoiceColumn: Column<SalesInvoiceRow> = {
    key: 'si_number',
    header: embedded ? t('finance:receivables.invoiceColumn', 'Invoice') : t('financeCopy.invoice', "Invoice #"),
    // ponytail: embedded, the client column carries the row's identity; 'primary' would force a 240px floor and push Outstanding off-screen at 1440.
    kind: embedded ? 'text' : 'primary',
    size: embedded ? 156 : 280,
    primaryTitle: (inv) => invoiceNumber(inv) ?? inv.customer_name ?? '',
    cell: (inv) => {
      const number = invoiceNumber(inv);
      // M-2: a Draft is numbered on approval (DD-NAR-9), so until then it reads by its customer, never a bare dash.
      const draftLabel = !number && inv.status === 'Draft'
        ? t('financeCopy.draftInvoiceLabel', 'Draft · {{customer}}', { customer: inv.customer_name ?? '—' })
        : null;
      const preErp = t('financeCopy.recordedBeforeErp', 'Recorded in PMO before the ERP was connected');
      // The opening-balance fact rides the Pre-ERP badge (tooltip + screen reader), not a line in the row.
      const preErpDetail = inv.erp_opening_amount != null && inv.erp_opening_at
        ? `${preErp}. ${t('financeCopy.carriedIntoErpOpening', 'Carried into the ERP opening balance: {{amount}} on {{date}}', {
          amount: formatCurrencyCents(inv.erp_opening_amount, inv.currency),
          date: formatInstantDate(inv.erp_opening_at),
        })}`
        : preErp;
      return (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          {embedded ? <span className={draftLabel ? 'min-w-0 break-words text-[13px] text-foreground' : 'min-w-0 break-all font-mono text-[13px] text-foreground'}>{draftLabel ?? number ?? '—'}</span> : <Link
            to={`/sales-invoices/${encodeURIComponent(inv.id)}${location.search}`}
            state={{ recordContext: { listPath: `${location.pathname}${location.search}${location.hash}` } }}
            className={draftLabel ? 'truncate text-[13px] text-foreground underline-offset-2 hover:underline focus-visible:underline' : 'truncate font-mono text-[13px] text-foreground underline-offset-2 hover:underline focus-visible:underline'}
            title={draftLabel ?? number ?? ''}
          >{draftLabel ?? number ?? '—'}</Link>}
          {/* #784 AC-NAR-004 (DD-NAR-11): a PMO invoice from before the ERP took revenue over is history. */}
          {inv.pmo_native && !native && (
            <Badge title={preErpDetail}>
              {t('financeCopy.preErpBadge', 'Pre-ERP')}
              <span className="sr-only">{preErpDetail}</span>
            </Badge>
          )}
        </span>
      );
    },
    secondaryCell: (inv) => {
      if (embedded) return null;
      const project = projectLabelOf(inv);
      const customer = invoiceNumber(inv) || inv.status !== 'Draft' ? (inv.customer_name ?? '—') : null;
      if (!customer && !project) return null;
      return (
        <>
          {customer && <span className="block truncate" title={customer}>{customer}</span>}
          {project && <span className="block truncate" title={project}>{project}</span>}
        </>
      );
    },
    exportValue: (inv) => invoiceNumber(inv) ?? '',
  };
  const referenceColumn: Column<SalesInvoiceRow> = {
    key: 'reference_number',
    header: t('uxs05.customerReference', 'Customer reference'),
    kind: 'text',
    size: 140,
    cell: (inv) => inv.reference_number
      ? <span className="truncate" title={inv.reference_number}>{inv.reference_number}</span>
      : <span className="text-muted-foreground">—</span>,
    exportValue: (inv) => inv.reference_number ?? '',
  };
  const statusColumn: Column<SalesInvoiceRow> = {
    key: 'status',
    header: t('financeCopy.status', "Status"),
    kind: 'status',
    size: embedded ? 180 : undefined,
    cell: (inv) => {
      const status = invoiceStatus(inv);
      const legacyLabel = status.partlySettled
        ? t('financeCopy.statusPartlyPaid', 'Partly paid')
        : salesInvoiceStatusLabel(inv.status, t);
      return <StatusPill className={embedded ? 'max-w-full whitespace-normal!' : undefined} variant={embedded ? status.variant : status.partlySettled ? salesInvoiceStatusVariant('Unpaid') : salesInvoiceStatusVariant(inv.status)}>{embedded ? status.label : legacyLabel}</StatusPill>;
    },
    exportValue: (inv) => inv.status,
  };
  const amountColumn: Column<SalesInvoiceRow> = {
    key: 'amount',
    header: sharedTaxBasis
      ? <span className="inline-flex items-baseline gap-1">{t('financeCopy.amount', "Amount")}<TaxBasisLabel treatment={sharedTaxBasis} showDetails={false} className="normal-case tracking-normal" /></span>
      : t('financeCopy.amount', "Amount"),
    kind: 'money',
    align: 'num',
    size: embedded ? 140 : 200,
    // OD-TAX-1 §2: `sales_invoices.tax_treatment` is NOT NULL (0188) — the marker exists on every
    // row, so no invoice total may be bare. The basis is the row's own; the org default
    // pre-selects a form and is never read here.
    cell: (inv) => {
      // The ISO code is shown only when it tells the reader something: the invoice is not in the org currency.
      // Embedded lists use formatCurrency, which already prefixes a foreign code — a second one is noise.
      const showCode = !embedded && inv.amount != null && Boolean(inv.currency) && inv.currency !== orgCurrency;
      return (
        <span className="flex w-full flex-col items-end gap-0.5 text-right md:inline-flex md:w-auto md:flex-row md:flex-wrap md:items-baseline md:justify-end md:gap-x-1.5">
          <span className="inline-flex items-baseline justify-end gap-1">
            <span className="tabular text-right text-[13px]">
              {inv.amount != null ? listMoney(inv.amount, inv.currency) : '—'}
            </span>
            {showCode && <span className="text-xs text-muted-foreground">{inv.currency}</span>}
          </span>
          {inv.amount != null && <FxEquivalent amount={inv.amount} currency={inv.currency} date={inv.invoice_date} />}
          {inv.amount != null && inv.tax_treatment !== sharedTaxBasis ? <TaxBasisLabel treatment={inv.tax_treatment} showDetails={false} className="w-full text-right md:w-auto" taxBaseUnknown={inv.erp_docstatus != null} taxRate={inv.tax_rate} taxBaseNumerator={inv.tax_base_numerator} taxBaseDenominator={inv.tax_base_denominator} /> : null}
          {/* I-4: a PMO invoice states what the client owes in full, so Outstanding reconciles by eye. */}
          {inv.pmo_native && invoiceGross(inv) != null && invoiceGross(inv) !== inv.amount && (
            <span className="w-full text-right text-xs text-muted-foreground md:basis-full">
              {t('financeCopy.totalDueAmount', 'Total due {{amount}}', { amount: listMoney(invoiceGross(inv)!, inv.currency) })}
              <FxEquivalent amount={invoiceGross(inv)} currency={inv.currency} date={inv.invoice_date} />
            </span>
          )}
        </span>
      );
    },
    // A NUMBER, not its string: a text cell is unsummable and locale-fragile (#701).
    exportValue: (inv) => inv.amount ?? '',
  };
  const outstandingColumn: Column<SalesInvoiceRow> = {
    key: 'erp_outstanding_amount',
    header: embedded ? <span className="inline-flex items-center gap-1">{t('financeCopy.outstanding', 'Outstanding')}<Tooltip content={t('finance:receivables.outstanding', 'Outstanding · tax included')}><button type="button" aria-label={t('finance:receivables.outstanding', 'Outstanding · tax included')} className="inline-grid size-4 place-items-center rounded-full normal-case text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><Icon name="help" className="size-3.5" /></button></Tooltip></span> : t('financeCopy.outstanding', "Outstanding"),
    kind: 'money',
    align: 'num',
    size: embedded ? 140 : 170,
    cell: (inv) => {
      const overpaid = overpaidBy(inv);
      const paid = paidToDate(inv);
      return (
        <span className="flex w-full flex-col items-end gap-0.5 text-right">
          <span className="tabular text-[13px]">
            {inv.erp_outstanding_amount != null ? listMoney(inv.erp_outstanding_amount, inv.currency) : '—'}
          </span>
          {inv.erp_outstanding_amount != null && <FxEquivalent amount={inv.erp_outstanding_amount} currency={inv.currency} date="latest" />}
          {/* I-4: what a PMO invoice has been paid so far (total due − paid = outstanding). */}
          {paid != null && (
            <span className="text-xs text-muted-foreground">
              {t('financeCopy.paidToDateAmount', 'Paid {{amount}}', { amount: listMoney(paid, inv.currency) })}
            </span>
          )}
          {/* #784 DD-NAR-17: a receipt above the balance is kept; the excess is shown, never hidden. */}
          {overpaid != null && (
            <span className="text-xs text-muted-foreground">
              {t('financeCopy.overpaidBy', 'Overpaid by {{amount}}', { amount: listMoney(overpaid, inv.currency) })}
            </span>
          )}
        </span>
      );
    },
    exportValue: (inv) => inv.erp_outstanding_amount ?? '',
  };
  const dueColumn: Column<SalesInvoiceRow> = {
    key: 'due_date',
    header: t('financeCopy.dueDate', "Due Date"),
    kind: 'date',
    size: embedded ? 100 : 130,
    cell: (inv) => {
      const due = deriveArDueDate(inv.invoice_date, inv.erp_payment_terms_days, inv.erp_due_date, inv.received_date);
      return due ? formatDateOnly(due) : '—';
    },
    exportValue: (inv) => deriveArDueDate(inv.invoice_date, inv.erp_payment_terms_days, inv.erp_due_date, inv.received_date) ?? '',
  };
  const efakturColumn: Column<SalesInvoiceRow> = {
    // One cell for the pair (number over a muted date). Shown only when a loaded row carries a value.
    key: 'efaktur',
    header: t('efaktur.column', 'e-Faktur'),
    kind: 'text',
    size: embedded ? 100 : 150,
    cell: (inv) => <EfakturCell number={inv.efaktur_number} date={inv.efaktur_date} />,
  };
  const columns: Column<SalesInvoiceRow>[] = [
    invoiceColumn, referenceColumn, statusColumn, amountColumn, outstandingColumn, dueColumn,
    ...(showEfaktur ? [efakturColumn] : []),
  ];
  const clientColumn: Column<SalesInvoiceRow> = {
    key: 'client',
    header: t('finance:receivables.client', 'Client'),
    kind: 'text',
    size: 192,
    cell: (inv) => {
      const project = projectLabelOf(inv);
      const manager = inv.project_id ? projectsById.get(inv.project_id)?.pm?.full_name?.trim() : null;
      const managerInitial = manager?.charAt(0).toLocaleUpperCase() ?? '—';
      return <span className="flex min-w-0 flex-col gap-0.5">
        <span className="min-w-0 break-words font-medium">{inv.customer_name ?? t('finance:receivables.clientUnavailable', 'Client not recorded')}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span className="min-w-0 break-words">{project ?? '—'}</span>
          <span aria-hidden="true" className="inline-grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-semibold text-secondary-foreground" title={manager ?? t('finance:receivables.unassignedProjectManager', 'Unassigned PM')}>{managerInitial}</span>
          <span className="min-w-0 break-words">{manager ?? t('finance:receivables.unassignedProjectManager', 'Unassigned PM')}</span>
        </span>
      </span>;
    },
    exportValue: (inv) => inv.customer_name ?? '',
  };
  const deliveryColumn: Column<SalesInvoiceRow> = {
    key: 'delivery',
    header: t('finance:receivables.delivery', 'Delivery'),
    kind: 'date',
    size: embedded ? 124 : 165,
    cell: (inv) => <span className="block min-w-0 whitespace-normal break-words">{inv.received_date
      ? t('finance:receivables.deliveryReceived', 'Received {{date}}', { date: formatDateOnly(inv.received_date) })
      : inv.status === 'Draft'
        ? t('finance:receivables.deliveryDraft', 'Draft by {{name}}', { name: inv.author_user_id ? profilesById.get(inv.author_user_id)?.full_name ?? t('finance:receivables.authorUnavailable', 'unknown') : t('finance:receivables.authorUnavailable', 'unknown') })
        : t('finance:receivables.deliveryNotReceived', 'Not marked received')}</span>,
    exportValue: (inv) => inv.received_date ?? '',
  };
  const displayColumns = embedded
    // ponytail: e-Faktur lives in the drawer and the export on the embedded list, so the money columns fit at 1440.
    ? [invoiceColumn, clientColumn, statusColumn, dueColumn, deliveryColumn, amountColumn, outstandingColumn, { ...efakturColumn, exportOnly: true }]
    : columns;
  // AC-L10N-052: the download carries each row's own ISO code beside amount (export-only). Everything the
  // screen no longer shows (customer, invoice and received dates, the e-Faktur pair) stays in the download.
  const exportColumns = withCurrencyColumn<SalesInvoiceRow>([
    invoiceColumn,
    referenceColumn,
    { key: 'customer_id', header: t('financeCopy.customer', "Customer"), cell: (inv) => inv.customer_name, exportValue: (inv) => inv.customer_name ?? '' },
    statusColumn,
    amountColumn,
    outstandingColumn,
    { key: 'invoice_date', header: t('financeCopy.date', "Date"), cell: (inv) => inv.invoice_date, exportValue: (inv) => inv.invoice_date ?? '' },
    { key: 'received_date', header: t('financeCopy.receivedDate', "Received"), cell: (inv) => inv.received_date, exportValue: (inv) => inv.received_date ?? '' },
    dueColumn,
    { key: 'efaktur_number', header: t('efaktur.number', 'e-Faktur number'), cell: (inv) => inv.efaktur_number, exportValue: (inv) => inv.efaktur_number ?? '' },
    { key: 'efaktur_date', header: t('efaktur.date', 'e-Faktur date'), cell: (inv) => inv.efaktur_date, exportValue: (inv) => inv.efaktur_date ?? '' },
  ], 'amount', (r) => r.currency);

  return { projectLabelOf, displayColumns, exportColumns, statusColumn };
}
