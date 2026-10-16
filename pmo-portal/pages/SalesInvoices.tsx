import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  TaxBasisLabel,
  Badge,
  useToast,
  type Column,
  type ComboboxOption,
  type RowMenuItem,
} from '@/src/components/ui';
import { EfakturModal } from '@/src/components/EfakturModal';
import { EfakturCell } from '@/src/components/EfakturCell';
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
import { currencySymbol, formatCurrencyCents, formatDateOnly, formatInstantDate, parseMoneyInputAtScale } from '@/src/lib/format';
import type { SalesInvoiceRow, SalesInvoiceStatus } from '@/src/lib/db/revenue';
import { deriveArDueDate, overdueAgeDays } from '@/src/lib/repositories/revenueDisplay';
import { salesInvoiceStatusVariant } from '@/src/lib/status/statusVariants';
import { type PendingPushState } from '@/src/lib/adapterSeam/pendingPush';
import { useAuth } from '@/src/auth/useAuth';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { useCommandIntent, useCommandIntentMap } from '@/src/hooks/useCommandIntent';
import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';
import { useRevenueMode } from '@/src/hooks/useRevenueMode';
import { invoiceGross, invoiceNumber, isPartlyPaid, overpaidBy, paidToDate } from '@/src/lib/revenue/nativeInvoice';
import { displayAllocations } from '@/src/lib/revenue/receiptAllocation';
import { nativeRevenueDetails, nativeRevenueHeadlines } from '@/src/lib/revenue/nativeRevenueErrors';
import { useInvoicePdfDownload } from '@/src/hooks/useInvoicePdfDownload';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import type { CommandIntent } from '@/src/lib/repositories/types';
import { SalesInvoiceApprovalPreview } from '@/pages/approvals/SalesInvoiceApprovalRow';
import FxEquivalent from '@/src/components/fx/FxEquivalent';

/** Status filter segments. "PartlyPaid" is a display state of a PMO invoice (DD-NAR-3), never a stored status. */
type StatusFilter = 'All' | SalesInvoiceStatus | 'PartlyPaid';
const ERP_STATUS_FILTERS: StatusFilter[] = ['All', 'Draft', 'Submitted', 'Unpaid', 'PartlyPaid', 'Paid', 'Cancelled'];
/** M-7: PMO invoices are never "Submitted" (DD-NAR-3: Draft → Unpaid → Paid); a part-paid one is its own filter. */
const NATIVE_STATUS_FILTERS: StatusFilter[] = ['All', 'Draft', 'Unpaid', 'PartlyPaid', 'Paid', 'Cancelled'];

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
  qty: number;
  rate: string;
}

interface FormValues {
  customerId: string;
  projectId: string | null;
  lineItems: LineItemDraft[];
}

const EMPTY_LINE: LineItemDraft = { item_code: '', qty: 1, rate: '0' };

/**
 * #684 (AC-PLC-009): the ONE parse of a rate draft, used by `validate` and by the submit. Rates are
 * scale-2 money, so a value that would need rounding is refused rather than silently changed.
 */
const parseRate = (raw: string): number | null => parseMoneyInputAtScale(raw, 2);

const validate = (
  v: FormValues,
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string,
  native = false,
  project?: InvoiceProjectOption,
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
      let lineError: string | undefined;
      // FR-NAR-002 (I-3): a PMO line needs an item code OR a description; an ERP line needs its item code.
      if (native) {
        if (!item.item_code.trim() && !item.description?.trim()) {
          lineError = t('financeCopy.invoiceLineCodeOrDescription', 'Line {{line}}: Enter an item code or a description.', { line: i + 1 });
        }
      } else if (!item.item_code.trim()) lineError = t('financeCopy.invoiceLineItemCodeRequired', 'Line {{line}}: Item code is required.', { line: i + 1 });
      if (item.qty <= 0) lineError = t('financeCopy.invoiceLineQuantityPositive', 'Line {{line}}: Quantity must be positive.', { line: i + 1 });
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
  const payments = useIncomingPayments(undefined, true);
  const paymentEvidence = useMemo(() => {
    const rows = payments.data ?? [];
    const allocations = rows.flatMap((payment) => {
      const reported = displayAllocations(payment, (id) => id === invoice.id ? invoice.si_number : null);
      return (reported ?? []).filter((allocation) =>
        allocation.invoice_id === invoice.id || Boolean(invoice.si_number && allocation.invoice_number === invoice.si_number),
      ).map((allocation) => ({ payment, allocation }));
    });
    return {
      allocations,
      hasUnknown: rows.some((payment) => displayAllocations(payment, (id) => id === invoice.id ? invoice.si_number : null) === null),
    };
  }, [invoice.id, invoice.si_number, payments.data]);

  return (
    <section aria-labelledby="invoice-evidence-heading" className="mb-5 border-b border-border pb-4">
      <h2 id="invoice-evidence-heading" className="mb-3 text-base font-semibold">{t('uxs17.billEvidence', 'Bill evidence')}</h2>
      {evidence.isPending ? (
        <p className="text-sm text-muted-foreground">{t('uxs17.evidenceLoading', 'Loading invoice evidence…')}</p>
      ) : evidence.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">{t('uxs17.evidenceUnavailable', 'Bill evidence is temporarily unavailable.')}</p>
          <Button variant="outline" size="sm" onClick={() => void evidence.refetch()}>{t('uxs17.evidenceRetry', 'Retry invoice evidence')}</Button>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-[minmax(0,2fr)_minmax(12rem,1fr)]">
          <div>
            <h3 className="text-sm font-medium">{t('uxs17.invoiceLines', 'Invoice lines')}</h3>
            {evidence.data?.lines == null ? (
              <p className="mt-1 text-sm text-muted-foreground">{t('uxs17.linesUnknown', 'Line details are not available.')}</p>
            ) : evidence.data.lines.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">{t('uxs17.noLines', 'No line details were returned.')}</p>
            ) : (
              <ul className="mt-2 divide-y divide-border/70">
                {evidence.data.lines.map((line, index) => (
                  <li key={`${line.item_code ?? 'line'}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
                    <span className="min-w-0 flex-1 break-words">
                      <span className="block">{line.description ?? line.item_code ?? t('uxs17.lineDescriptionUnavailable', 'Description not available')}</span>
                      {line.item_code && line.description && <span className="font-mono text-xs text-muted-foreground">{line.item_code}</span>}
                    </span>
                    <span className="tabular text-right text-muted-foreground">
                      {line.qty == null ? '—' : line.qty}{' × '}{line.rate == null ? '—' : formatCurrencyCents(line.rate, invoice.currency)}{' = '}
                      <span className="font-medium text-foreground">{line.amount == null ? '—' : formatCurrencyCents(line.amount, invoice.currency)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-sm font-medium">{t('uxs17.billingContact', 'Billing contact')}</h3>
            {evidence.data?.contact ? (
              <address className="mt-1 space-y-1 text-sm not-italic">
                {evidence.data.contact.name && <p>{evidence.data.contact.name}</p>}
                {evidence.data.contact.email && <p><a className="underline underline-offset-2" href={`mailto:${evidence.data.contact.email}`}>{evidence.data.contact.email}</a></p>}
                {evidence.data.contact.phone && <p><a className="underline underline-offset-2" href={`tel:${evidence.data.contact.phone}`}>{evidence.data.contact.phone}</a></p>}
              </address>
            ) : <p className="mt-1 text-sm text-muted-foreground">{t('uxs17.noBillingContact', 'No billing contact details were returned.')}</p>}
          </div>
        </div>
      )}
      <div className="mt-5 border-t border-border/70 pt-3">
        <h3 className="mb-1 text-sm font-medium">{t('uxs17.appliedReceipts', 'Applied receipts')}</h3>
        {payments.isPending ? (
          <p className="text-sm text-muted-foreground">{t('uxs17.receiptsLoading', 'Loading receipt allocations…')}</p>
        ) : payments.isError ? (
          <p className="text-sm text-muted-foreground">{t('uxs17.receiptsUnavailable', 'Applied receipt details are unavailable.')}</p>
        ) : paymentEvidence.allocations.length ? (
          <>
            <ul className="divide-y divide-border/70">
              {paymentEvidence.allocations.map(({ payment, allocation }, index) => {
                const amount = allocation.amount == null ? null : Number(allocation.amount);
                return (
                  <li key={`${payment.id}-${index}`} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 text-sm">
                    <span>{payment.ip_number ?? payment.reference_number ?? t('uxs17.receiptReferenceUnavailable', 'Receipt reference not recorded')}
                      {payment.date && <span className="ml-2 text-muted-foreground">{formatDateOnly(payment.date)}</span>}
                    </span>
                    <span className="tabular">{amount == null || !Number.isFinite(amount) || !allocation.currency
                      ? t('uxs17.allocationAmountUnavailable', 'Applied amount not available')
                      : formatCurrencyCents(amount, allocation.currency)}</span>
                  </li>
                );
              })}
            </ul>
            {paymentEvidence.hasUnknown && <p className="mt-2 text-sm text-muted-foreground">{t('uxs17.receiptsCoverageUnknown', 'Receipt allocations have not all been reported.')}</p>}
          </>
        ) : paymentEvidence.hasUnknown ? (
          <p className="text-sm text-muted-foreground">{t('uxs17.receiptsCoverageUnknown', 'Receipt allocations have not all been reported.')}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('uxs17.noAppliedReceipts', 'No applied receipts are recorded for this invoice.')}</p>
        )}
      </div>
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
  const { day: organizationToday, isPending: isOrganizationDayPending } = useFxOrgDay(true);
  const { create, setReceivedDate, setEfaktur, submitInvoice, cancelInvoice, pendingPush } = useRevenueMutations();
  const pdfDownload = useInvoicePdfDownload();
  // #784: undefined while ownership loads — the page waits rather than flash the wrong mode's copy and actions.
  const mode = useRevenueMode();
  const native = mode === 'native';
  const statusFilters = native ? NATIVE_STATUS_FILTERS : ERP_STATUS_FILTERS;
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const recordContext = useRecordContext('/sales-invoices', invoiceId);
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

  const canView = may('view', 'salesInvoice');
  const canCreate = may('create', 'salesInvoice');
  const canEdit = may('edit', 'salesInvoice');
  const canCancel = may('transition', 'salesInvoice');
  const canRecordReceipt = may('record_received_date', 'salesInvoice');
  const canRecordEfaktur = may('record_efaktur', 'salesInvoice');
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
  const requestedStatus = searchParams.get('status');
  const statusFilter: StatusFilter = requestedStatus && statusFilters.includes(requestedStatus as StatusFilter)
    ? requestedStatus as StatusFilter
    : 'All';
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
  const viewTarget = invoiceId ? all.find((inv) => inv.id === invoiceId) ?? null : null;

  const loadFilterProjects = useCallback(async (): Promise<ComboboxOption[]> => projectOptions ?? [], [projectOptions]);
  const selectedProject = projectOptions?.find((option) => option.value === searchParams.get('project')) ?? null;

  const updateListParam = (key: 'q' | 'status' | 'attribution' | 'project' | 'overdue' | 'sort', value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (!value || (key === 'status' && value === 'All')) next.delete(key);
      else next.set(key, value);
      return next;
    }, { replace: true });
  };

  const invoiceDisplayLabel = (inv: SalesInvoiceRow) => {
    if (inv.si_number) return inv.si_number;
    const project = projectOptions?.find((option) => option.value === inv.project_id)?.label;
    const context = project || inv.customer_name || t('financeCopy.unnamedInvoice', 'invoice');
    return t('financeCopy.draftInvoiceForProject', 'Draft invoice · {{project}}', { project: context });
  };

  const invoiceEfakturContext = (inv: SalesInvoiceRow): React.ReactNode => {
    if (inv.si_number?.trim()) {
      return (
        <p className="min-w-0 break-words font-medium">
          {t('efaktur.issuedSalesInvoice', 'Issued sales invoice number')}: <span className="font-mono">{inv.si_number}</span>
        </p>
      );
    }
    const project = projectOptions?.find((option) => option.value === inv.project_id)?.label;
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

  const [formTarget, setFormTarget] = useState<{ invoice: SalesInvoiceRow | null } | null>(null);
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
    return all
      .filter((inv) => searchParams.get('attribution') !== 'unassigned' || inv.project_id === null)
      .filter((inv) => matchesStatus(inv, statusFilter))
      .filter((inv) => !searchParams.get('project') || inv.project_id === searchParams.get('project'))
      .filter((inv) => searchParams.get('overdue') !== 'true' || (
        (inv.status === 'Submitted' || inv.status === 'Unpaid')
        && overdueAgeDays(deriveArDueDate(inv.invoice_date, inv.erp_payment_terms_days, inv.erp_due_date, inv.received_date), organizationToday) !== null
        && overdueAgeDays(deriveArDueDate(inv.invoice_date, inv.erp_payment_terms_days, inv.erp_due_date, inv.received_date), organizationToday)! > 0
      ))
      .filter((inv) => !q
        || invoiceNumber(inv)?.toLowerCase().includes(q)
        || inv.reference_number?.toLowerCase().includes(q)
        // #781 (AC-FIN-001): the list search also indexes the resolved customer company name.
        || inv.customer_name?.toLowerCase().includes(q));
  }, [all, organizationToday, search, searchParams, statusFilter]);

  const sortedInvoices = useMemo(() => {
    if (searchParams.get('sort') !== 'oldest-overdue') return filtered;
    return filtered
      .map((invoice, index) => {
        const age = overdueAgeDays(
          deriveArDueDate(invoice.invoice_date, invoice.erp_payment_terms_days, invoice.erp_due_date, invoice.received_date),
          organizationToday,
        );
        const overdueUnpaid = (invoice.status === 'Submitted' || invoice.status === 'Unpaid') && age !== null && age > 0;
        return { invoice, index, age, overdueUnpaid };
      })
      .sort((a, b) => Number(b.overdueUnpaid) - Number(a.overdueUnpaid)
        || (a.overdueUnpaid && b.overdueUnpaid ? (b.age ?? 0) - (a.age ?? 0) : 0)
        || a.index - b.index)
      .map(({ invoice }) => invoice);
  }, [filtered, organizationToday, searchParams]);

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
          <h2 className="text-heading font-semibold">{t('financeCopy.youDonTHaveAccessToSalesInvoices', "You don't have access to Sales Invoices")}</h2>
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
      <main className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-6">
        <Button variant="ghost" onClick={recordContext.closeRecord} className="mb-4 -ml-3">
          <Icon name="back" className="size-4" />
          {t('financeCopy.backToInvoices', 'Back to Sales Invoices')}
        </Button>
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
            <header className="mb-5 border-b border-border pb-4">
              <h1 className="text-[24px] font-bold tracking-[-0.02em]">
                {viewTarget.si_number
                  ? t('financeCopy.invoiceRecordTitle', 'Invoice {{number}}', { number: viewTarget.si_number })
                  : invoiceDisplayLabel(viewTarget)}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">{viewTarget.customer_name ?? '—'}</p>
            </header>
            <section aria-label={t('uxs17.collectionSummary', 'Invoice collection details')} className="mb-5 border-b border-border pb-4">
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">{t('uxs17.invoiceDate', 'Invoice date')}</dt>
                  <dd className="mt-1 text-sm">{viewTarget.invoice_date ? formatDateOnly(viewTarget.invoice_date) : t('uxs17.dateNotRecorded', 'Not recorded')}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">{t('uxs17.dueDate', 'Due date')}</dt>
                  <dd className="mt-1 text-sm">
                    {(() => {
                      const dueDate = deriveArDueDate(viewTarget.invoice_date, viewTarget.erp_payment_terms_days, viewTarget.erp_due_date, viewTarget.received_date);
                      return dueDate ? formatDateOnly(dueDate) : t('uxs17.dueDateUnavailable', 'Due date not available');
                    })()}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">{t('uxs17.status', 'Status')}</dt>
                  <dd className="mt-1">
                    {isPartlyPaid(viewTarget)
                      ? <StatusPill variant={salesInvoiceStatusVariant('Unpaid')}>{t('financeCopy.statusPartlyPaid', 'Partly paid')}</StatusPill>
                      : <StatusPill variant={salesInvoiceStatusVariant(viewTarget.status)}>{salesInvoiceStatusLabel(viewTarget.status, t)}</StatusPill>}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">{t('uxs17.collection', 'Collection')}</dt>
                  <dd className="mt-1 text-sm tabular">
                    {viewTarget.erp_outstanding_amount == null
                      ? t('uxs17.outstandingUnavailable', 'Outstanding amount not available')
                      : formatCurrencyCents(viewTarget.erp_outstanding_amount, viewTarget.currency)}
                  </dd>
                </div>
                {(() => {
                  const dueDate = deriveArDueDate(viewTarget.invoice_date, viewTarget.erp_payment_terms_days, viewTarget.erp_due_date, viewTarget.received_date);
                  const overdueDays = overdueAgeDays(dueDate, organizationToday);
                  return overdueDays != null && overdueDays > 0 && (viewTarget.status === 'Submitted' || viewTarget.status === 'Unpaid') ? (
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">{t('uxs17.overdue', 'Overdue')}</dt>
                      <dd className="mt-1 text-sm font-medium">{t('uxs17.daysOverdue', '{{count}} days overdue', { count: overdueDays })}</dd>
                    </div>
                  ) : null;
                })()}
              </dl>
            </section>
            {viewTarget.erp_docstatus === 1 && (viewTarget.status === 'Submitted' || viewTarget.status === 'Unpaid' || viewTarget.status === 'Paid') && (
              <section aria-label={t('uxs17.deliverySection', 'Client delivery')} className="mb-5 space-y-2 border-b border-border pb-4">
                <div>
                  <h2 className="text-base font-semibold">
                    {viewTarget.received_date
                      ? t('uxs17.receivedByClient', 'Received by client')
                      : t('uxs17.readyToSend', 'Ready to send')}
                  </h2>
                  <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">
                    {viewTarget.received_date
                      ? t('uxs17.receivedDateSummary', 'Client receipt was recorded for {{date}}.', { date: formatDateOnly(viewTarget.received_date) })
                      : t('uxs17.manualHandoffHelp', 'Download the approved PDF and send it to your client outside PMO. A download does not mean the invoice was sent.')}
                  </p>
                </div>
                {!viewTarget.received_date && (
                  <div className="flex flex-wrap gap-2">
                    {may('download_pdf', 'salesInvoice', { record: { status: viewTarget.status, erp_docstatus: viewTarget.erp_docstatus } }) && (
                      <Button
                        variant="primary"
                        disabled={pdfDownload.inFlightIds.has(viewTarget.id)}
                        onClick={() => void pdfDownload.download(viewTarget)}
                      >
                        <Icon name="download" />
                        {pdfDownload.inFlightIds.has(viewTarget.id)
                          ? t('uxs17.preparingPdf', 'Preparing PDF…')
                          : t('uxs17.downloadApprovedPdf', 'Download approved PDF')}
                      </Button>
                    )}
                    {canRecordReceipt && (
                      <Button variant="outline" onClick={() => setReceiptTarget(viewTarget)}>
                        {t('financeCopy.recordReceivedDate', 'Record received date')}
                      </Button>
                    )}
                  </div>
                )}
              </section>
            )}
            {!viewTarget.pmo_native && viewTarget.erp_docstatus !== null && <SalesInvoiceEvidenceSection invoice={viewTarget} />}
            <SalesInvoiceApprovalPreview inv={viewTarget} showFx />
            {canApproveDraft(viewTarget) && (
              <div className="mt-5 flex justify-end">
                <Button variant="primary" onClick={() => setSubmitTarget(viewTarget)}>
                  {t('financeCopy.continueToApprove', 'Continue to approve')}
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
      </main>
    );
  }

  const columns: Column<SalesInvoiceRow>[] = [
    {
      key: 'si_number',
      header: t('financeCopy.invoice', "Invoice #"),
      cell: (inv) => {
        const number = invoiceNumber(inv);
        // M-2: a Draft is numbered on approval (DD-NAR-9), so until then it reads by its customer, never a bare dash.
        const draftLabel = !number && inv.status === 'Draft'
          ? t('financeCopy.draftInvoiceLabel', 'Draft · {{customer}}', { customer: inv.customer_name ?? '—' })
          : null;
        const preErp = t('financeCopy.recordedBeforeErp', 'Recorded in PMO before the ERP was connected');
        return (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <Link
              to={`/sales-invoices/${encodeURIComponent(inv.id)}${location.search}`}
              state={{ recordContext: { listPath: `${location.pathname}${location.search}${location.hash}` } }}
              className={draftLabel ? 'truncate text-[13px] text-foreground underline-offset-2 hover:underline focus-visible:underline' : 'truncate font-mono text-[13px] text-foreground underline-offset-2 hover:underline focus-visible:underline'}
              title={draftLabel ?? number ?? ''}
            >{draftLabel ?? number ?? '—'}</Link>
            {/* #784 AC-NAR-004 (DD-NAR-11): a PMO invoice from before the ERP took revenue over is history. M-3: a
                compact badge, the full sentence as its tooltip and for a screen reader. */}
            {inv.pmo_native && !native && (
              <Badge title={preErp}>
                {t('financeCopy.preErpBadge', 'Pre-ERP')}
                <span className="sr-only">{preErp}</span>
              </Badge>
            )}
          </span>
        );
      },
      exportValue: (inv) => invoiceNumber(inv) ?? '',
    },
    {
      key: 'reference_number',
      header: t('uxs05.customerReference', 'Customer reference'),
      cell: (inv) => {
        const projectReference = projectOptions?.find((option) => option.value === inv.project_id)?.customerContractRef;
        return inv.reference_number
          ? <span className="truncate" title={inv.reference_number}>{inv.reference_number}</span>
          : projectReference
            ? <span className="truncate text-muted-foreground" title={projectReference}>{t('uxs05.projectReferenceFallback', 'Project reference: {{reference}}', { reference: projectReference })}</span>
            : <span className="text-muted-foreground">—</span>;
      },
      exportValue: (inv) => inv.reference_number ?? projectOptions?.find((option) => option.value === inv.project_id)?.customerContractRef ?? '',
    },
    {
      key: 'customer_id',
      header: t('financeCopy.customer', "Customer"),
      cell: (inv) => {
        const project = projectOptions?.find((option) => option.value === inv.project_id);
        return (
          <span className="flex min-w-0 flex-col">
            <span className="truncate" title={inv.customer_name ?? ''}>{inv.customer_name ?? '—'}</span>
            {inv.project_id ? (
              <span className="truncate text-xs text-muted-foreground" title={project?.label ?? ''}>
                {project?.label ?? (projectOptionsPending ? t('financeCopy.projectLoading', 'Project details loading') : t('financeCopy.projectUnavailable', 'Project details unavailable'))}
              </span>
            ) : <span className="truncate text-xs text-muted-foreground">{t('financeCopy.projectNotRecorded', 'Project not recorded')}</span>}
          </span>
        );
      },
      exportValue: (inv) => inv.customer_name ?? '',
    },
    {
      key: 'status',
      header: t('financeCopy.status', "Status"),
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
    },
    {
      key: 'amount',
      header: t('financeCopy.amount', "Amount"),
      align: 'num',
      // OD-TAX-1 §2: `sales_invoices.tax_treatment` is NOT NULL (0188) — the marker exists on every
      // row, so no invoice total may be bare. The basis is the row's own; the org default
      // pre-selects a form and is never read here.
      cell: (inv) => (
        <span className="flex w-full flex-col items-end gap-0.5 text-right md:inline-flex md:w-auto md:flex-row md:flex-wrap md:items-baseline md:justify-end md:gap-x-1.5">
          <span className="tabular text-right text-[13px]">
            {inv.amount != null ? formatCurrencyCents(inv.amount, inv.currency) : '—'}
          </span>
          {inv.amount != null && <FxEquivalent amount={inv.amount} currency={inv.currency} date={inv.invoice_date} />}
          {inv.amount != null ? <TaxBasisLabel treatment={inv.tax_treatment} showDetails={false} className="w-full text-right md:w-auto" taxBaseUnknown={inv.erp_docstatus != null} taxRate={inv.tax_rate} taxBaseNumerator={inv.tax_base_numerator} taxBaseDenominator={inv.tax_base_denominator} /> : null}
          {/* I-4: a PMO invoice states what the client owes in full, so Outstanding reconciles by eye. */}
          {inv.pmo_native && invoiceGross(inv) != null && (
            <span className="w-full text-right text-xs text-muted-foreground md:basis-full">
              {t('financeCopy.totalDueAmount', 'Total due {{amount}}', { amount: formatCurrencyCents(invoiceGross(inv)!, inv.currency) })}
              <FxEquivalent amount={invoiceGross(inv)} currency={inv.currency} date={inv.invoice_date} />
            </span>
          )}
        </span>
      ),
      // A NUMBER, not its string: a text cell is unsummable and locale-fragile (#701).
      exportValue: (inv) => inv.amount ?? '',
    },
    {
      key: 'erp_outstanding_amount',
      header: t('financeCopy.outstanding', "Outstanding"),
      align: 'num',
      cell: (inv) => {
        const overpaid = overpaidBy(inv);
        const paid = paidToDate(inv);
        return (
          <span className="flex w-full flex-col items-end gap-0.5 text-right">
            <span className="tabular text-[13px]">
              {inv.erp_outstanding_amount != null ? formatCurrencyCents(inv.erp_outstanding_amount, inv.currency) : '—'}
            </span>
            {inv.erp_outstanding_amount != null && <FxEquivalent amount={inv.erp_outstanding_amount} currency={inv.currency} date="latest" />}
            {/* I-4: what a PMO invoice has been paid so far (total due − paid = outstanding). */}
            {paid != null && (
              <span className="text-xs text-muted-foreground">
                {t('financeCopy.paidToDateAmount', 'Paid {{amount}}', { amount: formatCurrencyCents(paid, inv.currency) })}
              </span>
            )}
            {/* #784 DD-NAR-17: a receipt above the balance is kept; the excess is shown, never hidden. */}
            {overpaid != null && (
              <span className="text-xs text-muted-foreground">
                {t('financeCopy.overpaidBy', 'Overpaid by {{amount}}', { amount: formatCurrencyCents(overpaid, inv.currency) })}
              </span>
            )}
            {/* #784 DD-NAR-16: what this PMO invoice carried into the ERP's opening entry at connect. */}
            {inv.pmo_native && inv.erp_opening_amount != null && inv.erp_opening_at && (
              <span className="max-w-[24ch] whitespace-normal text-xs text-muted-foreground">
                {t('financeCopy.carriedIntoErpOpening', 'Carried into the ERP opening balance: {{amount}} on {{date}}', {
                  amount: formatCurrencyCents(inv.erp_opening_amount, inv.currency),
                  date: formatInstantDate(inv.erp_opening_at),
                })}
              </span>
            )}
          </span>
        );
      },
      exportValue: (inv) => inv.erp_outstanding_amount ?? '',
    },
    {
      key: 'invoice_date',
      header: t('financeCopy.date', "Date"),
      cell: (inv) => (inv.invoice_date ? formatDateOnly(inv.invoice_date) : '—'),
      exportValue: (inv) => inv.invoice_date ?? '',
    },
    {
      key: 'received_date',
      header: t('financeCopy.receivedDate', "Received"),
      cell: (inv) => (inv.received_date ? formatDateOnly(inv.received_date) : '—'),
      exportValue: (inv) => inv.received_date ?? '',
    },
    {
      key: 'due_date',
      header: t('financeCopy.dueDate', "Due Date"),
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
    },
    {
      // One cell for the pair (number over a muted date): two columns pushed the row ⋯ off the 1440 view.
      key: 'efaktur',
      header: t('efaktur.column', 'e-Faktur'),
      cell: (inv) => <EfakturCell number={inv.efaktur_number} date={inv.efaktur_date} />,
    },
  ];

  // AC-L10N-052: the download carries each row's own ISO code beside amount (export-only). The
  // e-Faktur pair shares one cell on screen but stays two sortable columns in the download.
  const exportColumns = withCurrencyColumn(columns, 'amount', (r) => r.currency).flatMap((col): Column<SalesInvoiceRow>[] =>
    col.key !== 'efaktur' ? [col] : [
      { key: 'efaktur_number', header: t('efaktur.number', 'e-Faktur number'), cell: (inv) => inv.efaktur_number, exportValue: (inv) => inv.efaktur_number ?? '' },
      { key: 'efaktur_date', header: t('efaktur.date', 'e-Faktur date'), cell: (inv) => inv.efaktur_date, exportValue: (inv) => inv.efaktur_date ?? '' },
    ]);

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
    if (canRecordEfaktur && inv.status !== 'Cancelled')
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

  return (
    <ListPage
      title={t('financeCopy.salesInvoices', "Sales Invoices")}
      description={mode === undefined
        ? undefined
        : native
          ? t('financeCopy.nativeSalesInvoicesDescription', 'Client invoices raised, approved and settled in PMO.')
          : t('financeCopy.clientInvoicesIssuedThroughPMOMirroredFromERPNextOutstandingAmountsAreERPSourced', "Client invoices issued through PMO, mirrored from ERPNext. Outstanding amounts are ERP-sourced.")}
      primaryAction={
        canCreate && mode !== undefined && (
          <Button variant="primary" onClick={() => setFormTarget({ invoice: null })}>
            <Icon name="plus" />
            {t('financeCopy.newInvoice', "New Invoice")}</Button>
        )
      }
      filters={
        state !== 'loading' && (
          <div
            role="region"
            aria-label={t('financeCopy.filterByStatus', "Filter by status")}
            tabIndex={0}
            className="min-w-0 max-w-full overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ViewToggle<StatusFilter>
              options={statusFilters.map((f) => ({ value: f, label: salesInvoiceStatusLabel(f, t) }))}
              value={statusFilter}
              onChange={(v) => {
                updateListParam('status', v);
                trackFilterApplied('status', statusFilters.length, 'salesInvoices');
              }}
              ariaLabel={t('financeCopy.filterByStatus', "Filter by status")}
            />
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div className="w-full max-w-[280px]">
                <Combobox
                  label={t('uxs05.filterProject', 'Filter by project')}
                  value={selectedProject?.value ?? null}
                  selectedOption={selectedProject}
                  onChange={(value) => updateListParam('project', value ?? '')}
                  loadOptions={loadFilterProjects}
                  noun={t('uxs05.project', 'Project')}
                  placeholder={t('uxs05.allProjects', 'All projects')}
                />
              </div>
              <Button
                type="button"
                variant={searchParams.get('overdue') === 'true' ? 'outline' : 'ghost'}
                aria-pressed={searchParams.get('overdue') === 'true'}
                disabled={!organizationToday}
                onClick={() => updateListParam('overdue', searchParams.get('overdue') === 'true' ? '' : 'true')}
              >{t('uxs05.overdueOnly', 'Overdue only')}</Button>
              {!organizationToday && <span className="text-sm text-muted-foreground" role="status">{isOrganizationDayPending ? t('uxs05.overdueDateLoading', 'Loading the organization date…') : t('uxs05.overdueDateUnavailable', 'Overdue filtering is unavailable until the organization date is known.')}</span>}
              <Button
                type="button"
                variant={searchParams.get('sort') === 'oldest-overdue' ? 'outline' : 'ghost'}
                aria-pressed={searchParams.get('sort') === 'oldest-overdue'}
                disabled={!organizationToday}
                onClick={() => updateListParam('sort', searchParams.get('sort') === 'oldest-overdue' ? '' : 'oldest-overdue')}
              >{t('uxs05.sortOldestOverdue', 'Oldest overdue first')}</Button>
            </div>
          </div>
        )
      }
      search={
        state !== 'loading' && (
          <SearchMini
            placeholder={t('financeCopy.searchInvoices', "Search invoices…")}
            aria-label={t('financeCopy.searchSalesInvoices', "Search sales invoices")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              updateListParam('q', e.target.value);
            }}
            searchSurface="sales-invoices-list"
            module="salesInvoices"
            resultCount={filtered.length}
            containerClassName="max-sm:basis-full max-sm:w-full max-sm:min-w-0 sm:ml-auto"
          />
        )
      }
      exportAction={
        state !== 'loading' && (
          <ExportButton rows={sortedInvoices} columns={exportColumns} entity="Sales Invoices" />
        )
      }
    >
      {/* Body */}
      {searchParams.get('attribution') === 'unassigned' && (
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-full border border-border bg-secondary px-3 py-1 text-sm">
            {t('invoiceProject.unassignedFilter', 'Unassigned invoices')}
          </span>
          <Button variant="ghost" size="sm" onClick={() => updateListParam('attribution', '')}>
            {t('financeCopy.clearFilter', 'Clear filter')}
          </Button>
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
          sub={t('financeCopy.createYourFirstInvoiceToStartBillingClients', "Create your first invoice to start billing clients.")}
          stateId="sales-invoices-empty"
          role={realRole ?? undefined}
          module="salesInvoices"
          action={canCreate ? { label: t('financeCopy.newInvoice', "New Invoice"), onClick: () => setFormTarget({ invoice: null }) } : undefined}
        />
      )}

      {state === undefined && (
        <DataTable<SalesInvoiceRow>
          rows={sortedInvoices}
          columns={columns}
          rowKey={(inv) => inv.id}
          rowMenu={rowMenu}
          state={sortedInvoices.length === 0 ? 'empty' : undefined}
          emptyTitle={t('financeCopy.noInvoicesMatchYourFilters', "No invoices match your filters")}
          emptySub={t('financeCopy.tryADifferentStatusOrClearTheSearch', "Try a different status or clear the search.")}
        />
      )}

      {/* Create / edit modal */}
      {formTarget && (
        <SalesInvoiceFormModal
          invoice={formTarget.invoice}
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
    </ListPage>
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
        className="w-48"
      />
    </EntityFormModal>
  );
};

// ── Create / edit form modal ────────────────────────────────────────────────

interface SalesInvoiceFormModalProps {
  invoice: SalesInvoiceRow | null;
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
  onClose,
  onCreate,
  onUpdate,
  pendingPush,
  native,
}) => {
  const { t } = useTranslation();
  const isEdit = !!invoice;
  // The adornment follows the record's own currency when editing one; a create form has no record
  // yet, so it falls back to the org's operating currency (#731). The hook is called unconditionally.
  const orgCurrency = useOrgCurrency();
  const erpItems = useErpItemOptions('sales');
  const moneyPrefix = currencySymbol(invoice?.currency ?? orgCurrency);
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
      customerId: '',
      projectId: null,
      lineItems: [EMPTY_LINE],
    },
    validate: (values) => validate(values, t, native, projectById(values.projectId)),
    idPrefix: 'sales-invoice-form',
    requiredFields: native ? ['customerId', 'projectId', 'lineItems'] : ['customerId', 'lineItems'],
    module: 'salesInvoices',
  });

  const customerField = form.fieldProps('customerId');
  const projectField = form.fieldProps('projectId');
  // I-2: the project's page is where its contract value and VAT rate are recorded.
  const vatRateLink = (projectId: string | null) => projectId ? (
    <Link to={`/projects/${projectId}`} className="font-medium text-primary-text underline underline-offset-2">
      {t('financeCopy.recordVatRateOnProject', 'Record the VAT rate on the project')}
    </Link>
  ) : null;
  const vatMissing = native && needsVatRate(projectById(projectField.value));

  const errorSummary = form.errors.customerId || form.errors.projectId || form.errors.lineItems
    ? [
        ...(form.errors.customerId ? [{ fieldId: customerField.id, message: form.errors.customerId }] : []),
        ...(form.errors.projectId ? [{ fieldId: projectField.id, message: form.errors.projectId }] : []),
        ...(form.errors.lineItems ? [{ fieldId: (() => {
          const first = form.values.lineItems.findIndex((item) => (native ? !item.item_code.trim() && !item.description?.trim() : !item.item_code.trim()) || item.qty <= 0 || parseRate(item.rate) === null || parseRate(item.rate)! < 0);
          const index = Math.max(first, 0);
          const item = form.values.lineItems[index];
          return item && (parseRate(item.rate) === null || parseRate(item.rate)! < 0)
            ? `sales-invoice-line-${index}-rate`
            : item && item.qty <= 0
              ? `sales-invoice-line-${index}-qty`
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
        const rate = parseRate(item.rate);
        // Unreachable after `validate`, which applies the same parse.
        if (rate === null) return;
        lineItems.push({ item_code: item.item_code, qty: item.qty, rate, ...(item.description?.trim() ? { description: item.description.trim() } : {}) });
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
            label={t('financeCopy.customer', "Customer")}
            required
            value={customerField.value}
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
            label={t('financeCopy.project', "Project")}
            required={native}
            value={projectField.value ?? ''}
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
              {erpItems.connected ? (
                <Combobox
                  id={`sales-invoice-line-${index}-item`}
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
                  className="flex-1"
                />
              )}
              {(erpItems.connected || native) && (
                <TextField
                  label={t('financeCopy.description', 'Description')}
                  value={item.description ?? ''}
                  onChange={(value) => updateLineItem(index, 'description', value)}
                  maxLength={native ? 140 : undefined}
                  placeholder={t('financeCopy.describeWorkOrGoods', 'Describe the work or goods…')}
                />
              )}
            </div>
            <NumberField
              id={`sales-invoice-line-${index}-qty`}
              label={t('financeCopy.qty', "Qty")}
              value={String(item.qty)}
              onChange={(v) => updateLineItem(index, 'qty', Number(v))}
              required
              min={0}
              step={1}
              className="w-full sm:w-24"
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
              className="w-full sm:w-32"
            />
            {lineItems.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-end mt-5"
                onClick={() => removeLineItem(index)}
                aria-label={t('financeCopy.removeLine', 'Remove line {{line}}', { line: index + 1 })}
              >
                <Icon name="trash" className="size-4" />
              </Button>
            )}
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addLineItem}>
          <Icon name="plus" className="size-4 mr-1.5" />
          {t('financeCopy.addLineItem', "Add line item")}</Button>
      </FormSection>
    </EntityFormModal>
  );
};

export default SalesInvoices;
