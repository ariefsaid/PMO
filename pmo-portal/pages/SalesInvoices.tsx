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
  Badge,
  useToast,
  type Column,
  type ComboboxOption,
  type RowMenuItem,
} from '@/src/components/ui';
import { EfakturModal } from '@/src/components/EfakturModal';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { ExportButton, withCurrencyColumn } from '@/src/components/export';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAssignInvoiceProject, useSalesInvoices, useRevenueMutations, useSalesInvoiceEvidence, useIncomingPayments } from '@/src/hooks/useRevenue';
import { useClientCompanyOptions, useInvoiceProjectOptions, type InvoiceProjectOption } from '@/src/hooks/useFkOptions';
import { InvoiceProjectModal } from '@/src/components/InvoiceProjectModal';
import { canAttributeInvoice } from '@/src/lib/invoiceProjectAssignment';
import { useRecordContext } from '@/src/hooks/useRecordContext';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { trackFilterApplied } from '@/src/lib/analytics';
import { currencySymbol, formatCurrencyAuto, formatDateOnly, formatInstantDate, formatNumber, parseMoneyInputAtScale } from '@/src/lib/format';
import type { SalesInvoiceRow, SalesInvoiceStatus } from '@/src/lib/db/revenue';
import { deriveArDueDate, overdueAgeDays } from '@/src/lib/repositories/revenueDisplay';
import { salesInvoiceStatusVariant } from '@/src/lib/status/statusVariants';
import { type PendingPushState } from '@/src/lib/adapterSeam/pendingPush';
import { useAuth } from '@/src/auth/useAuth';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { useCommandIntent, useCommandIntentMap } from '@/src/hooks/useCommandIntent';
import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';
import { useRevenueMode } from '@/src/hooks/useRevenueMode';
import { invoiceGross, invoiceNumber, isPartlyPaid, previewInvoiceDraft } from '@/src/lib/revenue/nativeInvoice';
import { decimalUnits } from '@/src/lib/taxNormalize';
import { displayAllocations } from '@/src/lib/revenue/receiptAllocation';
import { nativeRevenueDetails, nativeRevenueHeadlines } from '@/src/lib/revenue/nativeRevenueErrors';
import { useInvoicePdfDownload } from '@/src/hooks/useInvoicePdfDownload';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import type { CommandIntent } from '@/src/lib/repositories/types';
import { SalesInvoiceApprovalPreview } from '@/pages/approvals/SalesInvoiceApprovalRow';
import FxEquivalent from '@/src/components/fx/FxEquivalent';
import { MoneyInPageHeader } from './money-in/MoneyInPageHeader';
import { sortSalesInvoiceCollection, type SalesInvoiceCollectionSort } from '@/src/lib/salesInvoiceCollectionSort';

/** Status filter segments. "PartlyPaid" is a display state of a PMO invoice (DD-NAR-3), never a stored status. */
type StatusFilter = 'All' | SalesInvoiceStatus | 'PartlyPaid';
const ERP_STATUS_FILTERS: StatusFilter[] = ['All', 'Draft', 'Submitted', 'Unpaid', 'PartlyPaid', 'Paid', 'Cancelled'];
/** M-7: PMO invoices are never "Submitted" (DD-NAR-3: Draft → Unpaid → Paid); a part-paid one is its own filter. */
const NATIVE_STATUS_FILTERS: StatusFilter[] = ['All', 'Draft', 'Unpaid', 'PartlyPaid', 'Paid', 'Cancelled'];
const INVOICE_SORTS: SalesInvoiceCollectionSort[] = ['due-asc', 'overdue-desc', 'invoice-date-desc'];

function isInvoiceSort(value: string | null): value is SalesInvoiceCollectionSort {
  return INVOICE_SORTS.includes(value as SalesInvoiceCollectionSort);
}

function invoiceStatusDefaultSort(status: StatusFilter): SalesInvoiceCollectionSort {
  return status === 'Draft' || status === 'Paid' || status === 'Cancelled' ? 'invoice-date-desc' : 'due-asc';
}

function salesInvoiceStatusLabel(status: StatusFilter, t: (key: string, fallback: string) => string): string {
  const labels: Record<StatusFilter, string> = {
    All: t('financeCopy.statusAll', 'All'),
    Draft: t('financeCopy.statusDraft', 'Draft'),
    Submitted: t('financeCopy.statusSubmitted', 'Submitted'),
    Unpaid: t('financeCopy.statusUnpaid', 'Unpaid'),
    PartlyPaid: t('financeCopy.statusPartlyPaid', 'Partly paid'),
    Paid: t('financeCopy.statusPaid', 'Paid'),
    Cancelled: t('financeCopy.statusCancelled', 'Cancelled'),
  };
  return labels[status];
}

/** What the status filter matches. A part-paid invoice reads "Partly paid", so it is under that filter, not Unpaid. */
function matchesStatus(inv: SalesInvoiceRow, filter: StatusFilter): boolean {
  if (filter === 'All') return true;
  if (filter === 'PartlyPaid') return isPartlyPaid(inv);
  if (filter === 'Unpaid' || filter === 'Submitted') return inv.status === filter && !isPartlyPaid(inv);
  return inv.status === filter;
}

/** Line item as submitted: numeric, ready for the create command. */
interface LineItem {
  item_code: string;
  description?: string;
  qty: number;
  rate: number;
}

/**
 * Line item as edited. The rate is money, so it stays the user's locale-formatted DRAFT until
 * submit (#684) — converting on every keystroke would drop an unfinished decimal separator.
 */
interface LineItemDraft {
  item_code: string;
  description?: string;
  qty: string;
  rate: string;
}

interface FormValues {
  customerId: string;
  projectId: string | null;
  lineItems: LineItemDraft[];
}

const EMPTY_LINE: LineItemDraft = { item_code: '', qty: '1', rate: '0' };

/**
 * #684 (AC-PLC-009): the ONE parse of a rate draft, used by `validate` and by the submit. Rates are
 * scale-2 money, so a value that would need rounding is refused rather than silently changed.
 */
const parseRate = (raw: string): number | null => parseMoneyInputAtScale(raw, 2);
const parseQuantity = (raw: string): number | null => parseMoneyInputAtScale(raw, 3);
const isValidQuantity = (raw: string): boolean => {
  const qty = parseQuantity(raw);
  return qty !== null && Number.isFinite(qty) && qty > 0 && decimalUnits(qty, 3) !== null;
};

const validate = (
  v: FormValues,
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string,
  native = false,
  project?: InvoiceProjectOption,
  connected = false,
): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.customerId.trim()) errors.customerId = t('financeCopy.customerRequired', 'Customer is required.');
  // #784 (DD-NAR-7): the project decides a PMO invoice's VAT (OD-TAX-4), so a PMO invoice names one.
  if (native && !v.projectId) errors.projectId = t('financeCopy.nativeProjectRequired', "Project is required: it decides the invoice's VAT.");
  // I-2 (DD-TAX-4a): the server refuses a VAT project with no recorded rate — say so before the round trip.
  else if (native && needsVatRate(project)) errors.projectId = t('financeCopy.vatRateMissing', 'This project has no VAT rate recorded');
  if (v.lineItems.length === 0) {
    errors.lineItems = t('financeCopy.invoiceLineRequired', 'At least one line item is required.');
  } else {
    for (let i = 0; i < v.lineItems.length; i++) {
      const item = v.lineItems[i];
      const rate = parseRate(item.rate);
      const quantity = parseQuantity(item.qty);
      let lineError: string | undefined;
      // FR-NAR-002 (I-3): a PMO line needs an item code OR a description; an ERP line needs its item code.
      if (native && !connected) {
        if (!item.item_code.trim() && !item.description?.trim()) {
          lineError = t('financeCopy.invoiceLineCodeOrDescription', 'Line {{line}}: Enter an item code or a description.', { line: i + 1 });
        }
      } else if (!item.item_code.trim()) lineError = t('financeCopy.invoiceLineItemCodeRequired', 'Line {{line}}: Item code is required.', { line: i + 1 });
      if (quantity === null) {
        lineError = t('uxs16.invoiceLineQuantityValid', 'Line {{line}}: Quantity must be positive with no more than 3 decimal places.', { line: i + 1 });
      } else if (quantity <= 0) {
        lineError = t('financeCopy.invoiceLineQuantityPositive', 'Line {{line}}: Quantity must be positive.', { line: i + 1 });
      }
      if (rate === null) {
        lineError = t('financeCopy.invoiceLineRateValid', 'Line {{line}}: Enter a valid rate with no more than 2 decimal places.', { line: i + 1 });
      } else if (rate < 0) lineError = t('financeCopy.invoiceLineRateNonNegative', 'Line {{line}}: Rate cannot be negative.', { line: i + 1 });
      // The summary links to the first invalid line, so its message must identify that same line.
      if (!errors.lineItems && lineError) errors.lineItems = lineError;
    }
  }
  return errors;
};

/** DD-TAX-4a: a project subject to VAT with no recorded rate cannot be invoiced in PMO until its rate is recorded. */
const needsVatRate = (project?: InvoiceProjectOption): boolean => Boolean(project?.subjectToVat && project.taxRate == null);

const SalesInvoiceEvidenceSection: React.FC<{ invoice: SalesInvoiceRow }> = ({ invoice }) => {
  const { t } = useTranslation();
  const evidence = useSalesInvoiceEvidence(invoice.id, !invoice.pmo_native && invoice.erp_docstatus !== null);

  return (
    <section aria-labelledby="invoice-evidence-heading" className="mb-5 border-b border-border pb-4">
      <h2 id="invoice-evidence-heading" className="mb-3 type-section-head text-heading">{t('moneyIn:financeCopy.invoiceEvidenceCurrency', 'Bill evidence · {{currency}}', { currency: invoice.currency })}</h2>
      {evidence.isPending ? (
        <p className="text-sm text-muted-foreground">{t('uxs17.evidenceLoading', 'Loading invoice evidence…')}</p>
      ) : evidence.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">{t('uxs17.evidenceUnavailable', 'Bill evidence is temporarily unavailable.')}</p>
          <Button variant="outline" size="sm" className="min-h-11" onClick={() => void evidence.refetch()}>{t('uxs17.evidenceRetry', 'Retry invoice evidence')}</Button>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-[minmax(0,2fr)_minmax(12rem,1fr)]">
          <div>
            {invoice.pmo_native ? null : evidence.data?.lines != null && evidence.data.lines.length === 0 ? null : <h3 className="text-sm font-medium">{t('uxs17.invoiceLines', 'Invoice lines')}</h3>}
            {invoice.pmo_native ? null : evidence.data?.lines == null ? (
              <p className="mt-1 text-sm text-muted-foreground">{t('uxs17.linesUnknown', 'Line details are not available.')}</p>
            ) : evidence.data.lines.length === 0 ? null : (
              <ul className="mt-2 divide-y divide-border/70">
                {evidence.data.lines.map((line, index) => (
                  <li key={`${line.item_code ?? 'line'}-${index}`} className="grid min-w-0 grid-cols-1 gap-2 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline">
                    <span className="min-w-0 break-words">
                      <span className="block">{line.description ?? line.item_code ?? t('uxs17.lineDescriptionUnavailable', 'Description not available')}</span>
                      {line.item_code && line.description && <span className="font-mono text-xs text-muted-foreground">{line.item_code}</span>}
                    </span>
                    <span className="tabular text-muted-foreground sm:text-right">
                      {line.qty == null ? '—' : line.qty}{' × '}{line.rate == null ? '—' : formatNumber(line.rate)}{' = '}
                      <span className="font-medium text-foreground">{line.amount == null ? '—' : formatNumber(line.amount)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {evidence.data?.contact ? (
            <div>
              <details className="text-sm">
                <summary className="min-h-11 cursor-pointer py-2 font-medium">{t('uxs17.billingContact', 'Billing contact')}</summary>
                <address className="space-y-1 pb-2 not-italic">
                  {evidence.data.contact.name && <p>{evidence.data.contact.name}</p>}
                  {evidence.data.contact.email && <p><a className="underline underline-offset-2" href={`mailto:${evidence.data.contact.email}`}>{evidence.data.contact.email}</a></p>}
                  {evidence.data.contact.phone && <p><a className="underline underline-offset-2" href={`tel:${evidence.data.contact.phone}`}>{evidence.data.contact.phone}</a></p>}
                </address>
              </details>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
};

const SalesInvoiceAppliedReceipts: React.FC<{ invoice: SalesInvoiceRow }> = ({ invoice }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const payments = useIncomingPayments(undefined, true, invoice.id);
  const paymentEvidence = useMemo(() => {
    const rows = (payments.data ?? []).filter((payment) =>
      payment.status !== 'Scheduled' && !payment.erp_cancelled_at && !payment.cancelled_at,
    );
    const allocations = rows.flatMap((payment) => {
      const reported = displayAllocations(payment, (id) => id === invoice.id ? invoice.si_number : null);
      return (reported ?? []).filter((allocation) =>
        allocation.invoice_id === invoice.id || Boolean(invoice.si_number && allocation.invoice_number === invoice.si_number),
      ).map((allocation) => ({ payment, allocation }));
    });
    return {
      allocations,
      hasUnknown: rows.some((payment) =>
        (payment.sales_invoice_id === invoice.id || (payment.allocation_details ?? []).some((allocation) => allocation.invoice_id === invoice.id))
        && displayAllocations(payment, (id) => id === invoice.id ? invoice.si_number : null) === null,
      ),
    };
  }, [invoice.id, invoice.si_number, payments.data]);

  if (payments.isPending && !payments.data) {
    return (
      <section id="invoice-receipts" data-money-in-section aria-labelledby="invoice-applied-receipts-heading" className="mb-5 border-b border-border pb-4 scroll-mt-[var(--header-h)]">
        <h2 id="invoice-applied-receipts-heading" className="mb-2 type-section-head text-heading">{t('uxs17.appliedReceipts', 'Applied receipts')}</h2>
        <p className="text-sm text-muted-foreground">{t('moneyIn:financeCopy.receiptDetailsLoading', 'Loading applied receipt details…')}</p>
      </section>
    );
  }

  return (
    <section id="invoice-receipts" data-money-in-section aria-labelledby="invoice-applied-receipts-heading" className="mb-5 border-b border-border pb-4 scroll-mt-[var(--header-h)]">
      <h2 id="invoice-applied-receipts-heading" className="mb-2 type-section-head text-heading">{t('uxs17.appliedReceipts', 'Applied receipts')}</h2>
      {payments.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">{t('uxs17.receiptsUnavailable', 'Applied receipt details are unavailable.')}</p>
          <Button variant="outline" className="min-h-11" onClick={() => void payments.refetch()}>{t('moneyIn:financeCopy.receiptDetailsRetry', 'Retry receipts')}</Button>
        </div>
      ) : paymentEvidence.allocations.length ? (
        <>
          <ul className="divide-y divide-border/70">
            {paymentEvidence.allocations.map(({ payment, allocation }, index) => {
              const amount = allocation.amount == null ? null : Number(allocation.amount);
              return (
                <li key={`${payment.id}-${index}`} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 text-sm">
                  <span>
                    <Link
                      to={`/incoming-payments/${encodeURIComponent(payment.id)}`}
                      state={{ recordContext: { listPath: `${location.pathname}${location.search}${location.hash}` } }}
                      className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-primary-text focus-visible:text-primary-text"
                    >{payment.ip_number ?? payment.reference_number ?? t('uxs17.receiptReferenceUnavailable', 'Receipt reference not recorded')}</Link>
                    {payment.date && <span className="ml-2 text-muted-foreground">{formatDateOnly(payment.date)}</span>}
                  </span>
                  <span className="tabular">{amount == null || !Number.isFinite(amount) || !allocation.currency
                    ? t('uxs17.allocationAmountUnavailable', 'Applied amount not available')
                    : formatCurrencyAuto(amount, allocation.currency)}</span>
                </li>
              );
            })}
          </ul>
          {paymentEvidence.hasUnknown && <p className="mt-2 text-sm text-muted-foreground">{t('uxs17.receiptsCoverageUnknown', 'Receipt allocations have not all been reported.')}</p>}
        </>
      ) : paymentEvidence.hasUnknown ? (
        <p className="text-sm text-muted-foreground">{t('uxs17.receiptsCoverageUnknown', 'Receipt allocations have not all been reported.')}</p>
      ) : (
        <p className="text-sm text-muted-foreground">{t('moneyIn:financeCopy.noAppliedReceipts', 'No receipts have been applied to this invoice.')}</p>
      )}
    </section>
  );
};

const SalesInvoices: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useSalesInvoices();
  const { day: organizationToday } = useFxOrgDay(true);
  const { create, setReceivedDate, setEfaktur, submitInvoice, cancelInvoice, pendingPush } = useRevenueMutations();
  const pdfDownload = useInvoicePdfDownload();
  // #784: undefined while ownership loads — the page waits rather than flash the wrong mode's copy and actions.
  const mode = useRevenueMode();
  const native = mode === 'native';
  const statusFilters = native ? NATIVE_STATUS_FILTERS : ERP_STATUS_FILTERS;
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const recordContext = useRecordContext('/sales-invoices', invoiceId);
  const customerOptionsQuery = useClientCompanyOptions();
  const projectOptionsQuery = useInvoiceProjectOptions();
  const projectOptions = projectOptionsQuery.data;
  const projectOptionsPending = projectOptionsQuery.isPending;
  const refetchProjectOptions = projectOptionsQuery.refetch;
  const assignProject = useAssignInvoiceProject();
  const loadProjectOptions = useCallback(async () => {
    const result = await refetchProjectOptions();
    if (result.error) throw result.error;
    return result.data ?? [];
  }, [refetchProjectOptions]);
  const refetchCustomerOptions = customerOptionsQuery.refetch;

  const canView = may('view', 'salesInvoice');
  const canCreate = may('create', 'salesInvoice');
  const canEdit = may('edit', 'salesInvoice');
  const canCancel = may('transition', 'salesInvoice');
  const canRecordReceipt = may('record_received_date', 'salesInvoice');
  const canRecordEfaktur = may('record_efaktur', 'salesInvoice');
  const canDownloadApprovedPdf = (inv: SalesInvoiceRow) =>
    inv.erp_docstatus === 1
    && (inv.status === 'Submitted' || inv.status === 'Unpaid' || inv.status === 'Paid')
    && may('download_pdf', 'salesInvoice', { record: { status: inv.status, erp_docstatus: inv.erp_docstatus } });
  // One permission oracle for both the row-menu action and its View-modal continuation. The RPC
  // applies the same append-only author-set SoD rule; read-only users may still open invoice details.
  const canApproveDraft = (inv: SalesInvoiceRow) =>
    inv.status === 'Draft'
    && may('submit_sales_invoice', 'salesInvoice', {
      currentUserId: currentUser?.id,
      record: { author_id: inv.author_user_id, author_ids: inv.author_user_ids },
    });

  const all = useMemo(() => data ?? [], [data]);

  // Search and status live in the list URL so a record address can retain and restore the exact context.
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const requestedCustomerId = searchParams.get('customer');
  const selectedCustomer = requestedCustomerId
    ? customerOptionsQuery.data?.find((option) => option.value === requestedCustomerId) ?? null
    : null;
  const requestedStatus = searchParams.get('status');
  const statusFilter: StatusFilter = requestedStatus && statusFilters.includes(requestedStatus as StatusFilter)
    ? requestedStatus as StatusFilter
    : 'All';
  const requestedSort = searchParams.get('sort');
  const invoiceSort = isInvoiceSort(requestedSort) ? requestedSort : invoiceStatusDefaultSort(statusFilter);
  useEffect(() => {
    if (mode === undefined) return;
    const requested = searchParams.get('status');
    if (requested === null || (requested !== 'All' && statusFilters.includes(requested as StatusFilter))) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('status');
      return next;
    }, { replace: true });
  }, [mode, searchParams, setSearchParams, statusFilters]);
  useEffect(() => {
    if (requestedSort === null || isInvoiceSort(requestedSort)) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('sort', invoiceStatusDefaultSort(statusFilter));
      return next;
    }, { replace: true });
  }, [requestedSort, searchParams, setSearchParams, statusFilter]);
  useEffect(() => {
    const attribution = searchParams.get('attribution');
    if (attribution === null || attribution === 'assigned' || attribution === 'unassigned') return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('attribution');
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);
  const viewTarget = invoiceId ? all.find((inv) => inv.id === invoiceId) ?? null : null;
  const invoiceDetailsCount = viewTarget ? 1 + [
    canDownloadApprovedPdf(viewTarget) && Boolean(viewTarget.received_date),
    canRecordReceipt && viewTarget.status !== 'Cancelled' && viewTarget.status !== 'Draft',
    canRecordEfaktur && viewTarget.status !== 'Cancelled' && viewTarget.status !== 'Draft',
    may('assign_project', 'salesInvoice') && canAttributeInvoice(viewTarget),
    canCancel && !(Boolean(viewTarget.pmo_native) && !native) && viewTarget.status !== 'Cancelled' && !(viewTarget.pmo_native && viewTarget.status === 'Paid'),
  ].filter(Boolean).length : 1;
  const [activeInvoiceSection, setActiveInvoiceSection] = useState('invoice-identity');
  const invoiceSections = viewTarget ? [
    { id: 'invoice-identity', label: t('financeCopy.customer', 'Customer') },
    { id: 'invoice-position', label: t('uxs17.collectionSummary', 'Invoice collection details') },
    { id: 'invoice-lines', label: t('financeCopy.lineItemsSection', 'Line items') },
    ...(viewTarget.erp_docstatus === 1 && ['Submitted', 'Unpaid', 'Paid'].includes(viewTarget.status)
      ? [{ id: 'invoice-delivery', label: t('uxs17.deliverySection', 'Client delivery') }]
      : []),
    { id: 'invoice-receipts', label: t('uxs17.appliedReceipts', 'Applied receipts') },
    { id: 'invoice-details', label: t('financeCopy.invoiceDetails', 'Invoice details') },
  ] : [];
  const activeInvoiceSectionLabel = invoiceSections.find((section) => section.id === activeInvoiceSection)?.label
    ?? invoiceSections[0]?.label
    ?? '';

  useEffect(() => {
    if (!invoiceId || typeof IntersectionObserver === 'undefined') return;
    const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-money-in-section]'));
    if (sections.length === 0) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
      if (visible?.target instanceof HTMLElement && visible.target.id) setActiveInvoiceSection(visible.target.id);
    }, { rootMargin: '-18% 0px -68% 0px' });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [invoiceId, viewTarget?.id]);

  const selectedProject = projectOptions?.find((option) => option.value === searchParams.get('project')) ?? null;

  const updateListParam = (key: 'q' | 'status' | 'attribution' | 'project' | 'customer' | 'overdue' | 'sort', value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (!value || (key === 'status' && value === 'All')) next.delete(key);
      else next.set(key, value);
      if (key === 'status' && !current.has('sort')) {
        const nextStatus = value as StatusFilter;
        const defaultSort = invoiceStatusDefaultSort(nextStatus || 'All');
        if (defaultSort === 'due-asc') next.delete('sort');
        else next.set('sort', defaultSort);
      }
      return next;
    }, { replace: true });
  };

  const invoiceDisplayLabel = (inv: SalesInvoiceRow) => {
    if (inv.si_number) return inv.si_number;
    const project = projectOptions?.find((option) => option.value === inv.project_id)?.contractualName;
    const context = project || inv.customer_name || t('financeCopy.unnamedInvoice', 'invoice');
    return t('financeCopy.draftInvoiceForProject', 'Draft invoice · {{project}}', { project: context });
  };
  const projectLabelOf = (inv: SalesInvoiceRow) => projectOptions?.find((option) => option.value === inv.project_id)?.contractualName;

  const invoiceEfakturContext = (inv: SalesInvoiceRow): React.ReactNode => {
    if (inv.si_number?.trim()) {
      return (
        <p className="min-w-0 break-words font-medium">
          {t('efaktur.issuedSalesInvoice', 'Issued sales invoice number')}: <span className="font-mono">{inv.si_number}</span>
        </p>
      );
    }
    const project = projectOptions?.find((option) => option.value === inv.project_id)?.contractualName;
    const projectContext = project
      ?? (inv.project_id
        ? projectOptionsPending
          ? t('financeCopy.projectLoading', 'Project details loading')
          : t('financeCopy.projectUnavailable', 'Project details unavailable')
        : t('financeCopy.projectNotRecorded', 'Project not recorded'));
    const customerContext = inv.customer_name?.trim()
      ? inv.customer_name
      : t('financeCopy.customerNotRecorded', 'Customer not recorded');
    return (
      <div className="min-w-0 space-y-0.5 break-words">
        <p className="font-medium">{t('financeCopy.draftInvoice', 'Draft invoice')}</p>
        <p className="text-muted-foreground">{t('financeCopy.project', 'Project')}: {projectContext}</p>
        <p className="text-muted-foreground">{t('financeCopy.customer', 'Customer')}: {customerContext}</p>
      </div>
    );
  };

  const [formTarget, setFormTarget] = useState<{
    invoice: SalesInvoiceRow | null;
    initialContext?: { projectId: string; customerId: string };
  } | null>(null);
  const [contextError, setContextError] = useState<'options' | 'invalid' | null>(null);
  const createRequested = searchParams.get('create') === '1';
  const contextualProjectId = searchParams.get('project');

  useEffect(() => {
    if (!createRequested || invoiceId || formTarget || !canCreate || mode === undefined) return;

    const consumeCreateIntent = () => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('create');
        return next;
      }, { replace: true });
    };

    // `?create=1` without a project is the existing global create, with no inferred FK values.
    if (!contextualProjectId) {
      setContextError(null);
      setFormTarget({ invoice: null });
      consumeCreateIntent();
      return;
    }

    // Do not turn a still-loading or failed authorized option read into a guessed customer.
    if (projectOptionsQuery.isPending || customerOptionsQuery.isPending) return;
    if (projectOptionsQuery.isError || customerOptionsQuery.isError) {
      setContextError('options');
      return;
    }

    const project = projectOptions?.find((option) => option.value === contextualProjectId);
    const customerId = project?.clientId;
    const customerIsAuthorized = Boolean(customerId && customerOptionsQuery.data?.some((option) => option.value === customerId));
    if (!project || project.archived || !customerId || !customerIsAuthorized) {
      setContextError('invalid');
      consumeCreateIntent();
      return;
    }

    setContextError(null);
    setFormTarget({ invoice: null, initialContext: { projectId: project.value, customerId } });
    consumeCreateIntent();
  }, [
    canCreate,
    contextualProjectId,
    createRequested,
    customerOptionsQuery.data,
    customerOptionsQuery.isError,
    customerOptionsQuery.isPending,
    formTarget,
    invoiceId,
    mode,
    projectOptions,
    projectOptionsQuery.isError,
    projectOptionsQuery.isPending,
    setSearchParams,
  ]);

  const openNewInvoice = () => {
    setContextError(null);
    setFormTarget({ invoice: null });
  };
  const [cancelTarget, setCancelTarget] = useState<SalesInvoiceRow | null>(null);
  const [submitTarget, setSubmitTarget] = useState<SalesInvoiceRow | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<SalesInvoiceRow | null>(null);
  const [efakturTarget, setEfakturTarget] = useState<SalesInvoiceRow | null>(null);
  const [projectTarget, setProjectTarget] = useState<SalesInvoiceRow | null>(null);

  // BLOCK 2 (ADR-0058): the confirm dialogs are ALWAYS mounted, so their command identity cannot be
  // a plain ref — it must be per (record, verb) or a retry on invoice B would carry invoice A's key.
  // Released only after a terminal success (never on error — reusing the key on retry IS the fix).
  const verbIntents = useCommandIntentMap();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const attribution = searchParams.get('attribution');
    return all
      .filter((inv) => attribution === 'unassigned' ? inv.project_id === null : attribution === 'assigned' ? inv.project_id !== null : true)
      .filter((inv) => matchesStatus(inv, statusFilter))
      .filter((inv) => !searchParams.get('project') || inv.project_id === searchParams.get('project'))
      .filter((inv) => !searchParams.get('customer') || inv.customer_id === searchParams.get('customer'))
      .filter((inv) => searchParams.get('overdue') !== 'true' || (
        (inv.status === 'Submitted' || inv.status === 'Unpaid')
        && overdueAgeDays(deriveArDueDate(inv.invoice_date, inv.erp_payment_terms_days, inv.erp_due_date, inv.received_date), organizationToday) !== null
        && overdueAgeDays(deriveArDueDate(inv.invoice_date, inv.erp_payment_terms_days, inv.erp_due_date, inv.received_date), organizationToday)! > 0
      ))
      .filter((inv) => !q
        || invoiceNumber(inv)?.toLowerCase().includes(q)
        || inv.reference_number?.toLowerCase().includes(q)
        // #781 (AC-FIN-001): the list search also indexes the resolved customer company name.
        || inv.customer_name?.toLowerCase().includes(q)
        // FIN-S1: the project filter control is gone; the project is reachable through search.
        // AC-002 #1325: either the short label or the contractual title finds the invoice.
        || [projectOptions?.find((option) => option.value === inv.project_id)].some((o) => o && (o.label.toLowerCase().includes(q) || o.contractualName?.toLowerCase().includes(q))));
  }, [all, organizationToday, projectOptions, search, searchParams, statusFilter]);

  const sortedInvoices = useMemo(() => {
    const sortable = filtered.map((invoice) => ({
      invoice,
      id: invoice.id,
      dueDate: deriveArDueDate(invoice.invoice_date, invoice.erp_payment_terms_days, invoice.erp_due_date, invoice.received_date),
      invoiceDate: invoice.invoice_date,
    }));
    return sortSalesInvoiceCollection(sortable, invoiceSort, organizationToday ?? '').map(({ invoice }) => invoice);
  }, [filtered, invoiceSort, organizationToday]);

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
          <h2 className="type-section-head text-heading">{t('financeCopy.youDonTHaveAccessToSalesInvoices', "You don't have access to Sales Invoices")}</h2>
          <p className="mt-2 text-muted-foreground">
            {t('financeCopy.theSalesInvoicesDirectoryIsAvailableToFinanceProjectManagersAndExecutives', "The sales invoices directory is available to Finance, Project Managers, and Executives.")}</p>
          <Button variant="outline" onClick={() => navigate('/')} className="mt-4">
            <Icon name="back" className="size-4 mr-2" />
            {t('financeCopy.backToDashboard', "Back to dashboard")}</Button>
        </div>
      </div>
    );
  }

  if (invoiceId) {
    return (
      <div className="min-w-0">
        <BackBar label={t('shell.nav.salesInvoices', 'Sales Invoices')} onBack={recordContext.closeRecord} phoneOnly />
        {isPending || mode === undefined ? (
          <ListState variant="loading" rows={3} />
        ) : isError || !data ? (
          <ListState
            variant="error"
            title={t('financeCopy.salesInvoicesLoadFailed', "Couldn't load sales invoices")}
            sub={t('financeCopy.theRequestFailedCheckYourConnectionAndTryAgain', "The request failed. Check your connection and try again.")}
            onRetry={() => refetch()}
          />
        ) : viewTarget ? (
          <>
            <MoneyInPageHeader
              kind="record"
              title={viewTarget.si_number
                ? t('financeCopy.invoiceRecordTitle', 'Invoice {{number}}', { number: viewTarget.si_number })
                : invoiceDisplayLabel(viewTarget)}
              scope={viewTarget.customer_name ?? t('moneyIn:financeCopy.customerUnavailable', 'Customer not available')}
              status={isPartlyPaid(viewTarget)
                ? <StatusPill variant={salesInvoiceStatusVariant('Unpaid')}>{t('financeCopy.statusPartlyPaid', 'Partly paid')}</StatusPill>
                : <StatusPill variant={salesInvoiceStatusVariant(viewTarget.status)}>{salesInvoiceStatusLabel(viewTarget.status, t)}</StatusPill>}
              primaryAction={canDownloadApprovedPdf(viewTarget) && !viewTarget.received_date ? (
                <Button
                  variant="primary"
                  disabled={pdfDownload.inFlightIds.has(viewTarget.id)}
                  onClick={() => void pdfDownload.download(viewTarget)}
                  className="min-h-11"
                >
                  <Icon name="download" />
                  {pdfDownload.inFlightIds.has(viewTarget.id)
                    ? t('uxs17.preparingPdf', 'Preparing PDF…')
                    : t('uxs17.downloadApprovedPdf', 'Download approved PDF')}
                </Button>
              ) : undefined}
            />
            <div className="sticky top-[var(--header-h)] z-10 -mx-4 mb-4 min-w-0 border-b border-border bg-background px-4 py-2">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words text-sm font-medium">
                  {t('moneyIn:financeCopy.invoiceRecordIdentity', 'Invoice')} · {activeInvoiceSectionLabel}
                </span>
                <details className="group relative md:hidden">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-md border border-border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {t('moneyIn:financeCopy.invoiceSections', 'Sections')}
                  </summary>
                  <nav aria-label={t('moneyIn:financeCopy.invoiceSections', 'Sections')} className="absolute right-0 top-full z-20 mt-1 grid min-w-48 gap-1 rounded-md border border-border bg-card p-2 shadow-sm">
                    {invoiceSections.map((section) => (
                      <a key={section.id} href={`#${section.id}`} aria-current={activeInvoiceSection === section.id ? 'location' : undefined}
                        onClick={() => setActiveInvoiceSection(section.id)}
                        className="flex min-h-11 items-center rounded px-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {section.label}
                      </a>
                    ))}
                  </nav>
                </details>
                <nav aria-label={t('moneyIn:financeCopy.invoiceSections', 'Sections')} className="hidden min-w-0 flex-wrap gap-x-2 md:flex">
                  {invoiceSections.map((section) => (
                    <a key={section.id} href={`#${section.id}`} aria-current={activeInvoiceSection === section.id ? 'location' : undefined}
                      onClick={() => setActiveInvoiceSection(section.id)}
                      className="inline-flex min-h-11 items-center border-b-2 px-2 text-sm text-muted-foreground aria-[current=location]:border-primary aria-[current=location]:text-foreground">
                      {section.label}
                    </a>
                  ))}
                </nav>
              </div>
            </div>
            <section id="invoice-identity" data-money-in-section className="scroll-mt-[var(--header-h)]">
              <SalesInvoiceApprovalPreview inv={viewTarget} showFx showLineItems={false} showTotals={false} readableWholeUnits />
            </section>
            <section id="invoice-position" data-money-in-section aria-labelledby="invoice-position-heading" className="mb-5 border-b border-border pb-4 scroll-mt-[var(--header-h)]">
              <h2 id="invoice-position-heading" className="mb-3 type-section-head text-heading">
                {t('financeCopy.outstanding', 'Outstanding')} · {viewTarget.currency}{' '}
                {viewTarget.erp_outstanding_amount == null ? (
                  <span title={t('uxs17.outstandingUnavailable', 'Outstanding amount not available')}>
                    —<span className="sr-only">{t('uxs17.outstandingUnavailable', 'Outstanding amount not available')}</span>
                  </span>
                ) : (
                  <>{formatNumber(viewTarget.erp_outstanding_amount)}<FxEquivalent amount={viewTarget.erp_outstanding_amount} currency={viewTarget.currency} date="latest" /></>
                )}
              </h2>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
                <div>
                  <dt className="type-label text-muted-foreground">{t('uxs17.invoiceDate', 'Invoice date')}</dt>
                  <dd className="mt-1 type-value">{viewTarget.invoice_date ? formatDateOnly(viewTarget.invoice_date) : t('uxs17.dateNotRecorded', 'Not recorded')}</dd>
                </div>
                <div>
                  <dt className="type-label text-muted-foreground">{t('uxs17.dueDate', 'Due date')}</dt>
                  <dd className="mt-1 type-value">
                    {(() => {
                      const dueDate = deriveArDueDate(viewTarget.invoice_date, viewTarget.erp_payment_terms_days, viewTarget.erp_due_date, viewTarget.received_date);
                      return dueDate ? formatDateOnly(dueDate) : t('uxs17.dueDateUnavailable', 'Due date not available');
                    })()}
                  </dd>
                </div>
                {(() => {
                  const dueDate = deriveArDueDate(viewTarget.invoice_date, viewTarget.erp_payment_terms_days, viewTarget.erp_due_date, viewTarget.received_date);
                  const overdueDays = overdueAgeDays(dueDate, organizationToday);
                  return overdueDays != null && overdueDays > 0 && (viewTarget.status === 'Submitted' || viewTarget.status === 'Unpaid') ? (
                    <div>
                      <dt className="type-label text-muted-foreground">{t('uxs17.overdue', 'Overdue')}</dt>
                      <dd className="mt-1 type-value">{t('uxs17.daysOverdue', '{{count}} days overdue', { count: overdueDays })}</dd>
                    </div>
                  ) : null;
                })()}
              </dl>
            </section>
            {viewTarget.pmo_native ? (
              <section id="invoice-lines" data-money-in-section className="scroll-mt-[var(--header-h)]">
                <SalesInvoiceApprovalPreview inv={viewTarget} showFx showIdentity={false} readableWholeUnits />
              </section>
            ) : (
              <section id="invoice-lines" data-money-in-section className="scroll-mt-[var(--header-h)]">
                <SalesInvoiceEvidenceSection invoice={viewTarget} />
                <SalesInvoiceApprovalPreview inv={viewTarget} showFx showIdentity={false} showLineItems={false} readableWholeUnits />
              </section>
            )}
            {viewTarget.erp_docstatus === 1 && (viewTarget.status === 'Submitted' || viewTarget.status === 'Unpaid' || viewTarget.status === 'Paid') && (
              <section id="invoice-delivery" data-money-in-section aria-label={t('uxs17.deliverySection', 'Client delivery')} className="mb-5 space-y-2 border-b border-border pb-4 scroll-mt-[var(--header-h)]">
                <div>
                  <h2 className="type-section-head text-heading">
                    {viewTarget.received_date
                      ? t('uxs17.receivedByClient', 'Received by client')
                      : t('uxs17.readyToSend', 'Ready to send')}
                  </h2>
                  <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">
                    {viewTarget.received_date
                      ? t('uxs17.receivedDateSummary', 'Client receipt was recorded for {{date}}.', { date: formatDateOnly(viewTarget.received_date) })
                      : t('uxs17.manualHandoffHelp', 'Download the PDF and send it to your client yourself.')}
                  </p>
                </div>
              </section>
            )}
            <SalesInvoiceAppliedReceipts invoice={viewTarget} />
            <details id="invoice-details" data-money-in-section className="mb-5 border-b border-border pb-4 scroll-mt-[var(--header-h)]">
              <summary className="min-h-11 cursor-pointer py-2 font-medium">{t('moneyIn:financeCopy.invoiceDetailsSummary', 'Invoice details · {{count}}', { count: invoiceDetailsCount })}</summary>
              <dl className="grid gap-x-6 gap-y-3 py-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">{t('efaktur.column', 'e-Faktur')}</dt>
                  <dd className="mt-1 break-words text-sm">
                    {[viewTarget.efaktur_number, viewTarget.efaktur_date ? formatDateOnly(viewTarget.efaktur_date) : null].filter(Boolean).join(' · ') || t('uxs06.notReported', 'Not reported')}
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                {canDownloadApprovedPdf(viewTarget) && viewTarget.received_date && (
                  <Button variant="ghost" className="min-h-11" onClick={() => void pdfDownload.download(viewTarget)} disabled={pdfDownload.inFlightIds.has(viewTarget.id)}>
                    {t('financeCopy.invoicePdf.download', 'Download PDF')}
                  </Button>
                )}
                {canRecordReceipt && viewTarget.status !== 'Cancelled' && viewTarget.status !== 'Draft' && (
                  <Button variant="ghost" className="min-h-11" onClick={() => setReceiptTarget(viewTarget)}>
                    {t('financeCopy.recordReceivedDate', 'Record received date')}
                  </Button>
                )}
                {canRecordEfaktur && viewTarget.status !== 'Cancelled' && viewTarget.status !== 'Draft' && (
                  <Button variant="ghost" className="min-h-11" onClick={() => setEfakturTarget(viewTarget)}>
                    {t('efaktur.record', 'Record e-Faktur')}
                  </Button>
                )}
                {may('assign_project', 'salesInvoice') && canAttributeInvoice(viewTarget) && (
                  <Button variant="ghost" className="min-h-11" onClick={() => setProjectTarget(viewTarget)}>
                    {viewTarget.project_id ? t('invoiceProject.change', 'Change project') : t('invoiceProject.assign', 'Assign project')}
                  </Button>
                )}
                {canCancel && !(Boolean(viewTarget.pmo_native) && !native) && viewTarget.status !== 'Cancelled' && !(viewTarget.pmo_native && viewTarget.status === 'Paid') && (
                  <Button variant="ghost" className="min-h-11 text-destructive-text" onClick={() => setCancelTarget(viewTarget)}>
                    {t('financeCopy.cancel', 'Cancel')}
                  </Button>
                )}
              </div>
            </details>
            {canApproveDraft(viewTarget) && (
              <div className="mt-5 flex justify-end">
                <Button variant="primary" onClick={() => setSubmitTarget(viewTarget)} className="min-h-11">
                  {t('financeCopy.approveInvoice', 'Approve invoice')}
                </Button>
              </div>
            )}
          </>
        ) : (
          <ListState
            variant="empty"
            icon="doc"
            title={t('financeCopy.invoiceRecordNotFound', 'Invoice not found')}
            sub={t('financeCopy.invoiceRecordNotFoundBody', 'This invoice is no longer available.')}
          />
        )}
        <ConfirmDialog
          open={!!submitTarget}
          title={submitTarget?.pmo_native
            ? t('financeCopy.approveInvoiceNamed', 'Approve the invoice for {{customer}}?', { customer: submitTarget.customer_name ?? '' })
            : submitTarget ? t('financeCopy.submitInvoiceNamed', 'Submit {{invoice}}?', { invoice: submitTarget.si_number ?? invoiceDisplayLabel(submitTarget) }) : t('financeCopy.submitInvoiceQuestion', 'Submit invoice?')}
          description={submitTarget?.pmo_native
            ? t('financeCopy.approveInvoiceBody', 'Approving issues the invoice: it gets its number, becomes Unpaid and can receive payments. Its author cannot approve it.')
            : t('financeCopy.submitInvoiceForApprovalThisCommitsItToTheLedgerAndCannotBeUndoneByTheSubmitter', 'Submit invoice for approval? This commits it to the ledger and cannot be undone by the submitter.')}
          confirmLabel={submitTarget?.pmo_native ? t('financeCopy.approveInvoice', 'Approve invoice') : t('financeCopy.submitInvoice', 'Submit invoice')}
          loading={submitInvoice.isPending}
          onConfirm={onSubmitConfirm}
          onCancel={() => setSubmitTarget(null)}
        />
      </div>
    );
  }

  // The list keeps the invoice's identity, its customer/project context, its collection state, and both balances distinct.
  const invoiceColumn: Column<SalesInvoiceRow> = {
    key: 'si_number',
    header: t('financeCopy.invoice', "Invoice #"),
    kind: 'primary',
    size: 280,
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
          amount: formatCurrencyAuto(inv.erp_opening_amount, inv.currency),
          date: formatInstantDate(inv.erp_opening_at),
        })}`
        : preErp;
      return (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <Link
            to={`/sales-invoices/${encodeURIComponent(inv.id)}${location.search}`}
            state={{ recordContext: { listPath: `${location.pathname}${location.search}${location.hash}` } }}
            className={draftLabel ? 'inline-flex min-h-11 items-center break-words text-sm text-foreground underline-offset-2 hover:underline focus-visible:underline' : 'inline-flex min-h-11 items-center break-words font-mono text-sm text-foreground underline-offset-2 hover:underline focus-visible:underline'}
            title={draftLabel ?? number ?? ''}
          >{draftLabel ?? number ?? '—'}</Link>
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
    exportValue: (inv) => invoiceNumber(inv) ?? '',
  };
  const customerProjectColumn: Column<SalesInvoiceRow> = {
    key: 'customer_project',
    header: t('moneyIn:financeCopy.customerProjectContext', 'Customer / project'),
    kind: 'text',
    size: 250,
    cell: (inv) => {
      const project = projectLabelOf(inv);
      return (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="break-words font-medium">{inv.customer_name ?? t('moneyIn:financeCopy.customerUnavailable', 'Customer not available')}</span>
          {project
            ? <span className="break-words text-xs text-muted-foreground">{project}</span>
            : inv.project_id
              ? <span className="break-words text-xs text-muted-foreground">{t('financeCopy.projectUnavailable', 'Project details unavailable')}</span>
              : null}
        </span>
      );
    },
    exportValue: (inv) => inv.customer_name ?? '',
  };
  const referenceColumn: Column<SalesInvoiceRow> = {
    key: 'reference_number',
    header: t('uxs05.customerReference', 'Customer reference'),
    kind: 'text',
    size: 140,
    cell: (inv) => inv.reference_number
      ? <span className="min-w-0 break-words">{inv.reference_number}</span>
      : <span className="text-muted-foreground">—</span>,
    exportValue: (inv) => inv.reference_number ?? '',
  };
  const statusColumn: Column<SalesInvoiceRow> = {
    key: 'status',
    header: t('financeCopy.status', "Status"),
    kind: 'status',
    // DD-NAR-3: "Partly paid" is a display state of a PMO Unpaid invoice, never a stored status.
    cell: (inv) => {
      const gross = invoiceGross(inv);
      const partlySettled = isPartlyPaid(inv) || (
        (inv.status === 'Submitted' || inv.status === 'Unpaid')
        && gross != null
        && inv.erp_outstanding_amount != null
        && inv.erp_outstanding_amount > 0
        && inv.erp_outstanding_amount < gross
      );
      return partlySettled
        ? <StatusPill variant={salesInvoiceStatusVariant('Unpaid')}>{t('financeCopy.statusPartlyPaid', 'Partly paid')}</StatusPill>
        : <StatusPill variant={salesInvoiceStatusVariant(inv.status)}>{salesInvoiceStatusLabel(inv.status, t)}</StatusPill>;
    },
    exportValue: (inv) => inv.status,
  };
  const amountColumn: Column<SalesInvoiceRow> = {
    key: 'amount',
    header: t('moneyIn:financeCopy.invoiceGross', 'Invoice gross'),
    kind: 'money',
    align: 'num',
    size: 200,
    cell: (inv) => {
      const gross = invoiceGross(inv);
      return <span className="tabular text-right text-sm">{gross === null ? '—' : formatNumber(gross)}</span>;
    },
    exportValue: (inv) => invoiceGross(inv) ?? '',
  };
  const currencyColumn: Column<SalesInvoiceRow> = {
    key: 'currency',
    header: t('financeCopy.currency', 'Currency'),
    kind: 'text',
    size: 90,
    cell: (inv) => <span className="tabular">{inv.currency}</span>,
    exportValue: () => '',
  };
  const outstandingColumn: Column<SalesInvoiceRow> = {
    key: 'erp_outstanding_amount',
    header: t('moneyIn:financeCopy.outstandingGross', 'Outstanding gross'),
    kind: 'money',
    align: 'num',
    size: 170,
    cell: (inv) => <span className="tabular text-right text-heading font-bold">{inv.erp_outstanding_amount != null ? formatNumber(inv.erp_outstanding_amount) : '—'}</span>,
    exportValue: (inv) => inv.erp_outstanding_amount ?? '',
  };
  const dueColumn: Column<SalesInvoiceRow> = {
    key: 'due_date',
    header: t('financeCopy.dueDate', "Due Date"),
    kind: 'date',
    size: 130,
    cell: (inv) => {
      const due = deriveArDueDate(inv.invoice_date, inv.erp_payment_terms_days, inv.erp_due_date, inv.received_date);
      const age = overdueAgeDays(due, organizationToday);
      const unpaid = inv.status === 'Submitted' || inv.status === 'Unpaid';
      return (
        <span className="flex flex-col">
          <span>{due ? formatDateOnly(due) : '—'}</span>
          {unpaid && age !== null && age > 0 && <span className="tabular text-xs text-destructive-text">{age === 1
            ? t('uxs05.overdueDay', '{{count}} day overdue', { count: age })
            : t('uxs05.overdueDays', '{{count}} days overdue', { count: age })}</span>}
        </span>
      );
    },
    exportValue: (inv) => deriveArDueDate(inv.invoice_date, inv.erp_payment_terms_days, inv.erp_due_date, inv.received_date) ?? '',
  };
  const statusDueColumn: Column<SalesInvoiceRow> = {
    key: 'status_due',
    header: t('moneyIn:financeCopy.statusDueContext', 'Status / due'),
    kind: 'status',
    size: 200,
    cell: (inv) => (
      <span className="flex min-w-0 flex-col items-start gap-1">
        {statusColumn.cell(inv)}
        <span className="text-sm">{dueColumn.cell(inv)}</span>
      </span>
    ),
  };
  const columns: Column<SalesInvoiceRow>[] = [
    invoiceColumn, customerProjectColumn, statusDueColumn, currencyColumn, outstandingColumn, amountColumn,
  ];

  // AC-L10N-052: the download carries each row's own ISO code beside amount (export-only). Everything the
  // screen no longer shows (customer, invoice and received dates, the e-Faktur pair) stays in the download.
  const exportColumns = withCurrencyColumn<SalesInvoiceRow>([
    invoiceColumn,
    referenceColumn,
    { key: 'customer_id', header: t('financeCopy.customer', "Customer"), cell: (inv) => inv.customer_name, exportValue: (inv) => inv.customer_name ?? '' },
    statusColumn,
    { ...amountColumn, key: 'invoice_gross' },
    { key: 'amount', header: t('moneyIn:financeCopy.netAmount', 'Net amount'), cell: (inv) => inv.amount, exportValue: (inv) => inv.amount ?? '' },
    outstandingColumn,
    { key: 'invoice_date', header: t('financeCopy.date', "Date"), cell: (inv) => inv.invoice_date, exportValue: (inv) => inv.invoice_date ?? '' },
    { key: 'received_date', header: t('financeCopy.receivedDate', "Received"), cell: (inv) => inv.received_date, exportValue: (inv) => inv.received_date ?? '' },
    dueColumn,
    { key: 'efaktur_number', header: t('efaktur.number', 'e-Faktur number'), cell: (inv) => inv.efaktur_number, exportValue: (inv) => inv.efaktur_number ?? '' },
    { key: 'efaktur_date', header: t('efaktur.date', 'e-Faktur date'), cell: (inv) => inv.efaktur_date, exportValue: (inv) => inv.efaktur_date ?? '' },
  ], 'amount', (r) => r.currency);

  const rowMenu = (inv: SalesInvoiceRow): RowMenuItem[] => {
    const items: RowMenuItem[] = [{
      label: t('financeCopy.viewInvoice', 'View invoice'),
      onClick: () => recordContext.openRecord(inv.id),
    }];
    // #784 AC-NAR-004 (DD-NAR-11): a PMO invoice from before the ERP took revenue over is history — no approve or cancel.
    const frozen = Boolean(inv.pmo_native) && !native;
    // #912 (OD-INV-PDF-1, AC-PDF-003): the ERP's own PDF of a submitted invoice — what the client receives.
    // `can()` is UX only; external-invoice-pdf re-checks role, tenancy and the LIVE ERP docstatus.
    // AC-PDF-011: while THIS invoice's download runs, the item disables itself under the busy
    // label — a repeat click is impossible, not silent.
    if (may('download_pdf', 'salesInvoice', { record: { status: inv.status, erp_docstatus: inv.erp_docstatus } }))
      items.push({
        label: pdfDownload.inFlightIds.has(inv.id)
          ? t('financeCopy.invoicePdf.preparing', 'Preparing PDF…')
          : t('financeCopy.invoicePdf.download', 'Download PDF'),
        disabled: pdfDownload.inFlightIds.has(inv.id),
        onClick: () => void pdfDownload.download(inv),
      });
    if (may('assign_project', 'salesInvoice') && canAttributeInvoice(inv)) {
      items.push({
        label: inv.project_id
          ? t('invoiceProject.change', 'Change project')
          : t('invoiceProject.assign', 'Assign project'),
        onClick: () => setProjectTarget(inv),
      });
    }
    if (canEdit) items.push({ label: t('financeCopy.edit', "Edit"), onClick: () => setFormTarget({ invoice: inv }) });
    // #767 AC-DUE-001: receipt is learned after submission, so this is offered in any non-cancelled
    // state to the revenue write set (the RPC enforces it; `can()` is UX only).
    // M-7: not on a Draft — the client cannot have received an invoice that has not been issued.
    // #784 (DD-NAR-11): not on a frozen row — once an ERP owns revenue, a PMO invoice's fields are
    // the ERP's history; `set_sales_invoice_received_date` refuses it server-side too.
    if (canRecordReceipt && !frozen && inv.status !== 'Cancelled' && inv.status !== 'Draft')
      items.push({ label: t('financeCopy.recordReceivedDate', "Record received date"), onClick: () => setReceiptTarget(inv) });
    // FIN-S3: a Draft has no issued tax invoice yet, so there is nothing to record.
    if (canRecordEfaktur && inv.status !== 'Cancelled' && inv.status !== 'Draft')
      items.push({ label: t('efaktur.record', 'Record e-Faktur'), onClick: () => setEfakturTarget(inv) });
    // A Paid PMO invoice is not cancellable (FR-NAR-009); an ERP one follows the ERP.
    if (canCancel && !frozen && inv.status !== 'Cancelled' && !(inv.pmo_native && inv.status === 'Paid'))
      items.push({ label: t('financeCopy.cancel', "Cancel"), onClick: () => setCancelTarget(inv), danger: true });
    // Submit action: only for DRAFT status, gated by submit_sales_invoice permission with record
    // context (SoD). The oracle is the APPEND-ONLY author SET (`sales_invoice_authors`, migration
    // 0113) union the legacy scalar — the same one `submit_sales_invoice` enforces. Passing only the
    // last-writer-wins scalar showed an EARLIER body writer an enabled "Submit" that 403'd on click
    // (round-6 re-audit NIT 1). `can()` also fails closed on an unattributable invoice, so the
    // separate author-not-null guard is no longer needed here.
    // #784: a PMO Draft is APPROVED in PMO by a second person (DD-NAR-5) — the same predicate.
    if (
      !frozen
      && canApproveDraft(inv)
    ) {
      items.push({
        label: inv.pmo_native ? t('financeCopy.approve', 'Approve') : t('financeCopy.submit', "Submit"),
        onClick: () => inv.pmo_native ? recordContext.openRecord(inv.id) : setSubmitTarget(inv),
      });
    }
    return items;
  };

  const onCancelConfirm = async () => {
    if (!cancelTarget) return;
    const key = `cancel:${cancelTarget.id}`;
    try {
      await cancelInvoice.mutateAsync({ siId: cancelTarget.id, intent: verbIntents.intentFor(key) });
      verbIntents.release(key);
      toast(t('financeCopy.invoiceCancelled', 'Invoice cancelled'), invoiceNumber(cancelTarget) ?? cancelTarget.customer_name ?? cancelTarget.id, 'success');
      setCancelTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err, nativeRevenueHeadlines(t));
      toast(headline, detail, 'warning');
    }
  };

  async function onSubmitConfirm() {
    if (!submitTarget) return;
    const key = `submit:${submitTarget.id}`;
    try {
      await submitInvoice.mutateAsync({ siId: submitTarget.id, intent: verbIntents.intentFor(key) });
      verbIntents.release(key);
      toast(
        submitTarget.pmo_native ? t('financeCopy.invoiceApproved', 'Invoice approved') : t('financeCopy.invoiceSubmitted', 'Invoice submitted'),
        invoiceNumber(submitTarget) ?? submitTarget.customer_name ?? submitTarget.id,
        'success',
      );
      setSubmitTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err, nativeRevenueHeadlines(t));
      toast(headline, detail, 'warning');
    }
  }

  const clearFilters = () => {
    setSearch('');
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const key of ['q', 'status', 'customer', 'project', 'attribution', 'overdue', 'sort']) next.delete(key);
      return next;
    }, { replace: true });
  };

  return (
    <div className="min-w-0">
      <MoneyInPageHeader
        title={t('financeCopy.salesInvoices', 'Sales Invoices')}
        scope={t('moneyIn:financeCopy.invoiceCollectionScope', 'Due-first collection · gross amounts in each invoice currency.')}
      />
      <div data-testid="money-in-toolbar" className="mb-4 flex min-w-0 flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        <SearchMini
          placeholder={t('financeCopy.searchInvoices', 'Search invoices…')}
          aria-label={t('financeCopy.searchSalesInvoices', 'Search sales invoices')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            updateListParam('q', e.target.value);
          }}
          searchSurface="sales-invoices-list"
          module="salesInvoices"
          resultCount={filtered.length}
          className="min-h-11"
          containerClassName="min-h-11 w-full md:w-64"
        />
        <div className="flex min-w-0 flex-col gap-2 md:flex-1">
          <div
            role="region"
            aria-label={t('financeCopy.filterByStatus', 'Filter by status')}
            tabIndex={0}
            className="min-w-0 max-w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ViewToggle<StatusFilter>
              options={statusFilters.map((f) => ({ value: f, label: salesInvoiceStatusLabel(f, t) }))}
              value={statusFilter}
              onChange={(v) => {
                updateListParam('status', v);
                trackFilterApplied('status', statusFilters.length, 'salesInvoices');
              }}
              ariaLabel={t('financeCopy.filterByStatus', 'Filter by status')}
              className="max-w-full flex-wrap"
            />
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="sr-only" htmlFor="invoice-customer-filter">{t('moneyIn:financeCopy.filterByCustomer', 'Filter by customer')}</label>
            <select
              id="invoice-customer-filter"
              aria-label={t('moneyIn:financeCopy.filterByCustomer', 'Filter by customer')}
              value={requestedCustomerId ?? ''}
              onChange={(event) => updateListParam('customer', event.target.value)}
              className="min-h-11 min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <option value="">{t('moneyIn:financeCopy.allCustomers', 'All customers')}</option>
              {requestedCustomerId && !selectedCustomer && <option value={requestedCustomerId}>{t('dashboard.uxs36CustomerFilterUnavailable', 'Selected customer is unavailable')}</option>}
              {(customerOptionsQuery.data ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <label className="sr-only" htmlFor="invoice-project-filter">{t('moneyIn:financeCopy.filterByProject', 'Filter by project')}</label>
            <select
              id="invoice-project-filter"
              aria-label={t('moneyIn:financeCopy.filterByProject', 'Filter by project')}
              value={searchParams.get('project') ?? ''}
              onChange={(event) => updateListParam('project', event.target.value)}
              className="min-h-11 min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <option value="">{t('moneyIn:financeCopy.allProjects', 'All projects')}</option>
              {searchParams.get('project') && !selectedProject && <option value={searchParams.get('project')!}>{t('financeCopy.projectUnavailable', 'Project details unavailable')}</option>}
              {(projectOptions ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <label className="sr-only" htmlFor="invoice-attribution-filter">{t('moneyIn:financeCopy.filterByAttribution', 'Filter by project attribution')}</label>
            <select
              id="invoice-attribution-filter"
              aria-label={t('moneyIn:financeCopy.filterByAttribution', 'Filter by project attribution')}
              value={searchParams.get('attribution') ?? 'all'}
              onChange={(event) => updateListParam('attribution', event.target.value === 'all' ? '' : event.target.value)}
              className="min-h-11 min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <option value="all">{t('moneyIn:financeCopy.allAttribution', 'All project attribution')}</option>
              <option value="assigned">{t('moneyIn:financeCopy.assignedToProject', 'Assigned to project')}</option>
              <option value="unassigned">{t('invoiceProject.unassignedFilter', 'Unassigned invoices')}</option>
            </select>
          </div>
          <Button
            type="button"
            variant={searchParams.get('overdue') === 'true' ? 'outline' : 'ghost'}
            aria-pressed={searchParams.get('overdue') === 'true'}
            disabled={!organizationToday}
            className="min-h-11 self-start"
            onClick={() => updateListParam('overdue', searchParams.get('overdue') === 'true' ? '' : 'true')}
          >{t('uxs05.overdueOnly', 'Overdue only')}</Button>
        </div>
        <label className="flex min-h-11 min-w-0 items-center gap-2 md:w-auto">
          <span className="sr-only">{t('moneyIn:financeCopy.sortInvoices', 'Sort invoices')}</span>
          <select
            aria-label={t('moneyIn:financeCopy.sortInvoices', 'Sort invoices')}
            value={invoiceSort}
            onChange={(event) => updateListParam('sort', event.target.value)}
            className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:w-auto"
          >
            <option value="due-asc">{t('moneyIn:financeCopy.dueSoonest', 'Due soonest')}</option>
            <option value="overdue-desc">{t('moneyIn:financeCopy.oldestOverdueFirst', 'Oldest overdue first')}</option>
            <option value="invoice-date-desc">{t('moneyIn:financeCopy.latestInvoiceDate', 'Latest invoice date')}</option>
          </select>
        </label>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row md:ml-auto">
          <ExportButton
            rows={sortedInvoices}
            columns={exportColumns}
            entity={t('financeCopy.salesInvoices', 'Sales Invoices')}
            label={t('moneyIn:financeCopy.exportInvoices', 'Export invoices')}
            disabled={state === 'loading' || state === 'error'}
            className="min-h-11"
          />
          {mode !== undefined && !createRequested && canCreate && (
            <Button variant="primary" onClick={openNewInvoice} className="min-h-11">
              <Icon name="plus" />
              {t('financeCopy.newInvoice', 'New Invoice')}
            </Button>
          )}
        </div>
      </div>
      {/* Body */}
      {contextError && (
        <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-sm">
          <p className="text-muted-foreground">
            {contextError === 'options'
              ? t('uxs15.contextOptionsUnavailable', 'Project and customer options could not be loaded. Retry to confirm the invoice context.')
              : t('uxs15.contextInvalid', 'This project or its customer is no longer available. Start a new invoice and choose from the current options.')}
          </p>
          {contextError === 'options' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { void refetchProjectOptions(); void refetchCustomerOptions(); }}
              className="min-h-11"
            >
              {t('uxs15.retryContext', 'Retry context')}
            </Button>
          )}
        </div>
      )}
      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" rows={6} />
        </div>
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title={t('financeCopy.salesInvoicesLoadFailed', "Couldn't load sales invoices")}
          sub={t('financeCopy.theRequestFailedCheckYourConnectionAndTryAgain', "The request failed. Check your connection and try again.")}
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="doc"
          title={t('financeCopy.noSalesInvoicesYet', "No sales invoices yet")}
          sub={canCreate
            ? t('financeCopy.createYourFirstInvoiceToStartBillingClients', 'No client invoices have been recorded yet. Use New Invoice to start billing.')
            : t('uxs26.invoiceEmptyProjectManager', 'No client invoices have been recorded yet. Finance manages invoice creation.')}
          stateId="sales-invoices-empty"
          role={realRole ?? undefined}
          module="salesInvoices"
        />
      )}

      {state === undefined && filtered.length === 0 && (
        <ListState
          variant="empty"
          icon="search"
          title={t('financeCopy.noInvoicesMatchYourFilters', 'No invoices match your filters')}
          sub={(
            <div className="flex flex-col items-center gap-2">
              <span>{t('financeCopy.tryADifferentStatusOrClearTheSearch', 'Try a different status or clear the search.')}</span>
              <Button variant="ghost" onClick={clearFilters} className="min-h-11">
                {t('moneyIn:financeCopy.clearFilters', 'Clear filters')}
              </Button>
            </div>
          )}
        />
      )}

      {state === undefined && filtered.length > 0 && (
        <DataTable<SalesInvoiceRow>
          rows={sortedInvoices}
          columns={columns}
          rowKey={(inv) => inv.id}
          mobileDetails={{
            columnKeys: ['amount'],
            summary: (_inv, count) => t('moneyIn:financeCopy.invoiceOtherAmounts', 'Other invoice amounts · {{count}}', { count }),
          }}
          rowMenu={rowMenu}
          tableId="salesinvoices-table"
          accessibleName={t('financeCopy.salesInvoices', 'Sales Invoices')}
        />
      )}

      {/* Create / edit modal */}
      {formTarget && (
        <SalesInvoiceFormModal
          invoice={formTarget.invoice}
          initialContext={formTarget.initialContext}
          pendingPush={pendingPush}
          native={native}
          onClose={() => setFormTarget(null)}
          onCreate={async (input, intent) => {
            await create.mutateAsync({
              customerId: input.customerId,
              projectId: input.projectId,
              items: input.lineItems,
              intent,
            });
            toast(t('financeCopy.invoiceCreated', 'Invoice created'), undefined, 'success');
            setFormTarget(null);
          }}
          onUpdate={async (_id, _input) => {
            // In a full implementation, we'd have an update mutation
            // For now, just close the modal
            setFormTarget(null);
          }}
        />
      )}

      {projectTarget && (
        <InvoiceProjectModal
          invoice={projectTarget}
          projects={projectOptions ?? []}
          loadProjects={loadProjectOptions}
          currentProjectName={projectOptions?.find((option) => option.value === projectTarget.project_id)?.label ?? null}
          loading={assignProject.isPending}
          onClose={() => setProjectTarget(null)}
          onSave={async (projectId) => {
            await assignProject.mutateAsync({
              siId: projectTarget.id,
              projectId,
              oldProjectId: projectTarget.project_id,
            });
          }}
        />
      )}

      {efakturTarget && (
        <EfakturModal
          recordContext={invoiceEfakturContext(efakturTarget)}
          number={efakturTarget.efaktur_number}
          date={efakturTarget.efaktur_date}
          loading={setEfaktur.isPending}
          onClose={() => setEfakturTarget(null)}
          onSave={async ({ efakturNumber, efakturDate }) => {
            await setEfaktur.mutateAsync({ siId: efakturTarget.id, efakturNumber, efakturDate });
            toast(t('efaktur.saved', 'e-Faktur details saved'), efakturTarget.si_number ?? efakturTarget.id, 'success');
            setEfakturTarget(null);
          }}
        />
      )}

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
          : submitTarget ? t('financeCopy.submitInvoiceNamed', 'Submit {{invoice}}?', { invoice: submitTarget.si_number ?? submitTarget.id }) : t('financeCopy.submitInvoiceQuestion', 'Submit invoice?')}
        description={submitTarget?.pmo_native
          ? t('financeCopy.approveInvoiceBody', 'Approving issues the invoice: it gets its number, becomes Unpaid and can receive payments. Its author cannot approve it.')
          : t('financeCopy.submitInvoiceForApprovalThisCommitsItToTheLedgerAndCannotBeUndoneByTheSubmitter', "Submit invoice for approval? This commits it to the ledger and cannot be undone by the submitter.")}
        confirmLabel={submitTarget?.pmo_native ? t('financeCopy.approveInvoice', 'Approve invoice') : t('financeCopy.submitInvoice', "Submit invoice")}
        loading={submitInvoice.isPending}
        onConfirm={onSubmitConfirm}
        onCancel={() => setSubmitTarget(null)}
      />
    </div>
  );
};

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
        className="min-h-11 w-48"
      />
    </EntityFormModal>
  );
};

// ── Create / edit form modal ────────────────────────────────────────────────

interface SalesInvoiceFormModalProps {
  invoice: SalesInvoiceRow | null;
  initialContext?: { projectId: string; customerId: string };
  onClose: () => void;
  /** `intent` is the modal's OWN command identity — stable for this form session (BLOCK 2). */
  onCreate: (
    input: { customerId: string; projectId: string | null; lineItems: LineItem[] },
    intent: CommandIntent,
  ) => Promise<void>;
  onUpdate: (id: string, input: { customerId: string; projectId: string | null; lineItems: LineItem[] }) => Promise<void>;
  pendingPush: PendingPushState;
  /** #784: true while PMO owns revenue — the project is required and lines carry a description. */
  native: boolean;
}

const SalesInvoiceFormModal: React.FC<SalesInvoiceFormModalProps> = ({
  invoice,
  initialContext,
  onClose,
  onCreate,
  onUpdate,
  pendingPush,
  native,
}) => {
  const { t } = useTranslation();
  const isEdit = !!invoice;
  // The hook is called unconditionally. Unscoped creation keeps the org default; native project
  // entry follows the selected authorized project's source currency, and unknown stays explicit.
  const orgCurrency = useOrgCurrency();
  const erpItems = useErpItemOptions('sales');
  // BLOCK 2 (ADR-0058): ONE command identity per form session. This modal is mounted only while the
  // form is open (`{formTarget && …}`), so its mount IS the session: every retry of a failed submit
  // reuses this identity (the ERP doc a lost response already committed gets reconciled, not
  // duplicated), and a success closes the modal → the next "New Invoice" mints a fresh one.
  const intent = useCommandIntent();
  // FK options come from the cached hooks ("hooks own data fetching"); the Combobox loader just
  // hands back the already-fetched list (no re-fetch on popover open).
  const { data: customerOptions } = useClientCompanyOptions();
  const { data: projectOptions } = useInvoiceProjectOptions();
  const projectById = useCallback((id: string | null) => projectOptions?.find((p) => p.value === id), [projectOptions]);
  const form = useEntityForm<FormValues>({
    initialValues: {
      customerId: invoice ? '' : initialContext?.customerId ?? '',
      projectId: invoice ? null : initialContext?.projectId ?? null,
      lineItems: [EMPTY_LINE],
    },
    validate: (values) => validate(values, t, native, projectById(values.projectId), erpItems.connected),
    idPrefix: 'sales-invoice-form',
    requiredFields: native ? ['customerId', 'projectId', 'lineItems'] : ['customerId', 'lineItems'],
    module: 'salesInvoices',
  });

  const customerField = form.fieldProps('customerId');
  const projectField = form.fieldProps('projectId');
  const selectedProject = projectField.value ? projectById(projectField.value) : undefined;
  const selectedProjectCurrency = selectedProject?.currency?.trim() || undefined;
  const taxBaseNumerator = selectedProject?.taxBaseNumerator;
  const taxBaseDenominator = selectedProject?.taxBaseDenominator;
  const hasKnownTaxBaseFraction =
    typeof taxBaseNumerator === 'number' && Number.isInteger(taxBaseNumerator) && taxBaseNumerator > 0 &&
    typeof taxBaseDenominator === 'number' && Number.isInteger(taxBaseDenominator) &&
    taxBaseDenominator >= taxBaseNumerator && taxBaseDenominator <= 2_147_483_647;
  const moneyCurrency = invoice?.currency ?? (native && projectField.value ? selectedProjectCurrency : orgCurrency);
  const moneyPrefix = moneyCurrency ? currencySymbol(moneyCurrency) : undefined;
  const projectCurrencyUnavailable = native && Boolean(projectField.value) && !selectedProjectCurrency;
  // I-2: the project's page is where its contract value and VAT rate are recorded.
  const vatRateLink = (projectId: string | null) => projectId ? (
    <Link to={`/projects/${projectId}`} className="inline-flex min-h-11 items-center font-medium text-primary-text underline underline-offset-2">
      {t('financeCopy.recordVatRateOnProject', 'Record the VAT rate on the project')}
    </Link>
  ) : null;
  const vatMissing = native && needsVatRate(projectById(projectField.value));
  const draftTaxFacts = native && selectedProject
    ? selectedProject.subjectToVat
      ? selectedProject.taxRate != null && Number.isFinite(selectedProject.taxRate) && selectedProject.taxRate > 0 && hasKnownTaxBaseFraction
        ? {
            treatment: 'exclusive' as const,
            rate: selectedProject.taxRate,
            fraction: { numerator: taxBaseNumerator!, denominator: taxBaseDenominator! },
          }
        : null
      : { treatment: 'exclusive' as const, rate: 0, fraction: { numerator: 1, denominator: 1 } }
    : null;
  const draftReviewCurrencyCandidate = native
    ? invoice?.currency ?? selectedProjectCurrency
    : invoice?.currency ?? orgCurrency;
  const draftReviewCurrency = typeof draftReviewCurrencyCandidate === 'string' && /^[A-Z]{3}$/.test(draftReviewCurrencyCandidate)
    ? draftReviewCurrencyCandidate
    : null;

  const errorSummary = form.errors.customerId || form.errors.projectId || form.errors.lineItems
    ? [
        ...(form.errors.customerId ? [{ fieldId: customerField.id, message: form.errors.customerId }] : []),
        ...(form.errors.projectId ? [{ fieldId: projectField.id, message: form.errors.projectId }] : []),
        ...(form.errors.lineItems ? [{ fieldId: (() => {
          const requiresItemCode = !native || erpItems.connected;
          const first = form.values.lineItems.findIndex((item) => (requiresItemCode ? !item.item_code.trim() : !item.item_code.trim() && !item.description?.trim()) || !isValidQuantity(item.qty) || parseRate(item.rate) === null || parseRate(item.rate)! < 0);
          const index = Math.max(first, 0);
          const item = form.values.lineItems[index];
          return item && (parseRate(item.rate) === null || parseRate(item.rate)! < 0)
            ? `sales-invoice-line-${index}-rate`
            : item && !isValidQuantity(item.qty)
              ? `sales-invoice-line-${index}-qty`
              : native && !erpItems.connected && !item?.item_code.trim() && !item?.description?.trim()
                ? `sales-invoice-line-${index}-description`
                : `sales-invoice-line-${index}-item`;
        })(), message: form.errors.lineItems }] : []),
      ]
    : undefined;

  // #559 / AC-ERR-001: a rejected save must leave PERSISTENT evidence in the dialog. The toast
  // auto-dismisses after 4s, ~700px from where the user is looking, after which the modal is
  // indistinguishable from a pristine form with data in it — so the save looks like it worked.
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const lineItems: LineItem[] = [];
      for (const item of values.lineItems) {
        const qty = parseQuantity(item.qty);
        const rate = parseRate(item.rate);
        // Unreachable after `validate`, which applies the same parse.
        if (qty === null || !isValidQuantity(item.qty) || rate === null) return;
        lineItems.push({ item_code: item.item_code, qty, rate, ...(item.description?.trim() ? { description: item.description.trim() } : {}) });
      }
      const input = { customerId: values.customerId, projectId: values.projectId, lineItems };
      try {
        if (isEdit && invoice) await onUpdate(invoice.id, input);
        else await onCreate(input, intent);
      } catch (err) {
        // I-2: a rejected save is shown ONCE — here, persistently, in the dialog (#559) — not also as a toast. This
        // is therefore the one `save_failed` capture point for the form (ADR-0067).
        const { headline, detail } = classifyMutationError(err, nativeRevenueHeadlines(t), { module: 'sales', detailOverrides: nativeRevenueDetails(t) });
        const code = (err as { code?: unknown } | null)?.code;
        setSaveError({ headline, detail, ...(code === 'vat-rate-missing' ? { action: vatRateLink(values.projectId) } : {}) });
      }
    });
  };

  const loadCustomers = useCallback(async (): Promise<ComboboxOption[]> => customerOptions ?? [], [customerOptions]);
  // M-1: a live project of the chosen customer — the loader changes with the customer, so the picker re-loads.
  const selectedCustomerId = customerField.value;
  const loadProjects = useCallback(
    async (): Promise<ComboboxOption[]> => (projectOptions ?? [])
      .filter((p) => !p.archived && (!selectedCustomerId || p.clientId === selectedCustomerId)),
    [projectOptions, selectedCustomerId],
  );

  // Line items live IN the form (BLOCK 1b): a detached useState meant the VALIDATED values and the
  // SUBMITTED values were different objects — the user's typed lines were dropped and an invoice
  // worth $0 would have posted for someone who typed $25,000.
  const lineItems = form.values.lineItems;
  const addLineItem = () => form.setValue('lineItems', [...lineItems, EMPTY_LINE]);
  const removeLineItem = (index: number) =>
    form.setValue('lineItems', lineItems.filter((_, i) => i !== index));
  const updateLineItem = (index: number, field: keyof LineItemDraft, value: string | number) =>
    form.setValue('lineItems', lineItems.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  const draftPreview = previewInvoiceDraft(
    lineItems.map((item) => {
      const parsedRate = parseRate(item.rate);
      const parsedQty = parseQuantity(item.qty);
      const requiresItemCode = !native || erpItems.connected;
      const hasLineIdentity = requiresItemCode
        ? Boolean(item.item_code.trim())
        : Boolean(item.item_code.trim() || item.description?.trim());
      return { qty: parsedQty ?? Number.NaN, rate: parsedRate !== null && hasLineIdentity ? parsedRate : Number.NaN };
    }),
    native ? draftTaxFacts : null,
  );

  return (
    <EntityFormModal
      open
      title={isEdit ? t('financeCopy.editInvoiceTitle', 'Edit invoice') : t('financeCopy.newInvoiceTitle', 'New invoice')}
      subtitle={native
        ? t('financeCopy.nativeNewInvoiceSubtitle', 'Raises a draft. A different Finance or Admin user approves it.')
        : isEdit
          ? t('financeCopy.editInvoiceSubtitle', 'Update this sales invoice')
          : t('financeCopy.newInvoiceSubtitle', 'Create a new sales invoice for a client')}
      submitLabel={isEdit ? t('financeCopy.saveInvoice', 'Save invoice') : t('financeCopy.createInvoice', 'Create invoice')}
      cancelLabel={t('financeCopy.cancel', 'Cancel')}
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
      <FormSection legend={t('financeCopy.invoiceDetails', 'Invoice details')}>
        <FormGrid>
          <Combobox
            id={customerField.id}
            triggerClassName="min-h-11"
            label={t('financeCopy.customer', "Customer")}
            required
            value={customerField.value}
            selectedOption={customerOptions?.find((option) => option.value === customerField.value) ?? null}
            onChange={(value, _option) => {
              // M-1: a project of another customer cannot stay picked once the customer changes.
              const project = projectById(projectField.value);
              if (project && value && project.clientId !== value) form.setValues({ customerId: value, projectId: null });
              else customerField.onChange(value);
            }}
            error={customerField.error}
            placeholder={t('financeCopy.selectOrSearchCustomer', "Select or search customer…")}
            loadOptions={loadCustomers}
            noun="customer"
          />
          <Combobox
            id={projectField.id}
            triggerClassName="min-h-11"
            label={t('financeCopy.project', "Project")}
            required={native}
            value={projectField.value ?? ''}
            selectedOption={projectOptions?.find((option) => option.value === projectField.value) ?? null}
            onChange={(value, _option) => projectField.onChange(value ?? '')}
            // I-2: shown the moment a VAT project with no rate is picked, with the way to fix it.
            error={vatMissing ? (
              <>
                {t('financeCopy.vatRateMissingInline', 'This project has no VAT rate recorded, so it cannot be invoiced yet.')}{' '}
                {vatRateLink(projectField.value)}
              </>
            ) : projectField.error}
            placeholder={native ? t('financeCopy.nativeSelectProject', 'Select project…') : t('financeCopy.selectProjectOptional', "Select project (optional)…")}
            loadOptions={loadProjects}
            noun="project"
          />
        </FormGrid>
      </FormSection>

      <FormSection legend={t('financeCopy.lineItemsSection', 'Line items')}>
        {lineItems.map((item, index) => (
          <div key={index} className="flex flex-col sm:flex-row gap-2 mb-2">
            <div className="min-w-0 flex-1 space-y-2">
              {native && (
                <TextField
                  id={`sales-invoice-line-${index}-description`}
                  label={t('financeCopy.description', 'Description')}
                  value={item.description ?? ''}
                  onChange={(value) => updateLineItem(index, 'description', value)}
                  maxLength={140}
                  placeholder={t('financeCopy.describeWorkOrGoods', 'Describe the work or goods…')}
                  className="min-h-11"
                />
              )}
              {erpItems.connected ? (
                <Combobox
                  id={`sales-invoice-line-${index}-item`}
                  triggerClassName="min-h-11"
                  label={t('financeCopy.erpItem', 'ERP item')}
                  value={item.item_code || null}
                  selectedOption={item.item_code ? { value: item.item_code, label: item.item_code } : null}
                  onChange={(code) => updateLineItem(index, 'item_code', code)}
                  loadOptions={erpItems.loadOptions}
                  required
                  noun={t('financeCopy.erpItem', 'ERP item')}
                  placeholder={t('financeCopy.selectOrSearchItem', 'Select or search item…')}
                  searchPlaceholder={t('financeCopy.searchItemCodeOrName', 'Search item code or name…')}
                />
              ) : (
                <TextField
                  id={`sales-invoice-line-${index}-item`}
                  label={t('financeCopy.itemCode', "Item code")}
                  value={item.item_code}
                  onChange={(v) => updateLineItem(index, 'item_code', v)}
                  // FR-NAR-002 (I-3): a PMO line needs an item code OR a description.
                  required={!native}
                  maxLength={native ? 140 : undefined}
                  placeholder={t('financeCopy.iTEM001', "ITEM-001")}
                  className="min-h-11 flex-1"
                />
              )}
              {!native && erpItems.connected && (
                <TextField
                  id={`sales-invoice-line-${index}-description`}
                  label={t('financeCopy.description', 'Description')}
                  value={item.description ?? ''}
                  onChange={(value) => updateLineItem(index, 'description', value)}
                  maxLength={native ? 140 : undefined}
                  placeholder={t('financeCopy.describeWorkOrGoods', 'Describe the work or goods…')}
                  className="min-h-11"
                />
              )}
            </div>
            <NumberField
              id={`sales-invoice-line-${index}-qty`}
              label={t('financeCopy.qty', "Qty")}
              value={item.qty}
              onChange={(v) => updateLineItem(index, 'qty', v)}
              required
              min={0}
              step={0.001}
              localeAware
              className="min-h-11 w-full sm:w-24"
            />
            <NumberField
              id={`sales-invoice-line-${index}-rate`}
              label={t('financeCopy.rate', "Rate")}
              value={item.rate}
              onChange={(v) => updateLineItem(index, 'rate', v)}
              localeAware
              required
              min={0}
              step={0.01}
              prefix={moneyPrefix}
              helper={projectCurrencyUnavailable ? t('uxs15.currencyUnavailable', 'Project currency unavailable.') : undefined}
              className="min-h-11 w-full sm:w-32"
            />
            {lineItems.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11 min-w-11 self-end mt-5"
                onClick={() => removeLineItem(index)}
                aria-label={t('financeCopy.removeLine', 'Remove line {{line}}', { line: index + 1 })}
              >
                <Icon name="trash" className="size-4" />
              </Button>
            )}
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={addLineItem}>
          <Icon name="plus" className="size-4 mr-1.5" />
          {t('financeCopy.addLineItem', "Add line item")}</Button>
      </FormSection>

      {(draftReviewCurrency || !native || selectedProject) && (
      <section
        className="mt-4 border-t border-border pt-4"
        aria-label={t('uxs16.invoiceDraftReview', 'Invoice draft review')}
      >
        <h3 className="type-section-head text-heading">
          {t('uxs16.invoiceDraftReview', 'Invoice draft review')}
          {draftReviewCurrency && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">{draftReviewCurrency}</span>
          )}
        </h3>
        {!draftReviewCurrency ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {t('uxs16.currencyUnavailable', 'Currency is unavailable, so draft totals cannot be displayed.')}
          </p>
        ) : (
          <>
            <dl className="mt-3 grid gap-2.5 text-sm">
              <div className="flex min-w-0 items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">{t('uxs16.subtotal', 'Subtotal')}</dt>
                <dd className="shrink-0 text-right tabular-nums">
                  {draftPreview.subtotal === null ? '—' : formatCurrencyAuto(draftPreview.subtotal, draftReviewCurrency)}
                </dd>
              </div>
              {native && (
              <>
              <div className="flex min-w-0 items-baseline justify-between gap-4">
                <dt className="min-w-0 text-muted-foreground">
                  <span>{t('uxs16.tax', 'Tax')}</span>
                </dt>
                <dd className="shrink-0 text-right tabular-nums">
                  {draftPreview.tax === null ? '—' : formatCurrencyAuto(draftPreview.tax, draftReviewCurrency)}
                </dd>
              </div>
              <div className="flex min-w-0 items-baseline justify-between gap-4 border-t border-border pt-2 font-semibold">
                <dt>{t('uxs16.total', 'Total')}</dt>
                <dd className="shrink-0 text-right tabular-nums">
                  {draftPreview.total === null ? '—' : formatCurrencyAuto(draftPreview.total, draftReviewCurrency)}
                </dd>
              </div>
              </>
              )}
            </dl>
            {draftPreview.reason === 'invalid-lines' && (
              <p className="mt-3 text-sm text-muted-foreground">
                {t('uxs16.completeLinesForReview', 'Enter valid line details, quantities, and rates to review totals.')}
              </p>
            )}
            {native && draftPreview.reason === 'tax-unavailable' && (
              <p className="mt-3 text-sm text-muted-foreground">
                {t('uxs16.projectTaxUnavailable', 'Project tax details are unavailable, so tax and final total cannot be previewed yet.')}{' '}
                {selectedProject && (
                  <Link to={`/projects/${selectedProject.value}`} className="inline-flex min-h-11 items-center font-medium text-primary-text underline underline-offset-2">
                    {t('uxs16.reviewProjectTax', 'Review project tax settings')}
                  </Link>
                )}
              </p>
            )}
          </>
        )}
      </section>
      )}
    </EntityFormModal>
  );
};

export default SalesInvoices;
