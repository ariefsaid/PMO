import { salesInvoiceColumns } from './sales-invoices/salesInvoiceColumns';
import { SalesInvoiceDetail } from './sales-invoices/SalesInvoiceDetail';
import { SalesInvoiceDialogs } from './sales-invoices/SalesInvoiceDialogs';
import { useSalesInvoiceActions } from './sales-invoices/useSalesInvoiceActions';
import { SalesInvoiceFormModal } from './sales-invoices/SalesInvoiceFormModal';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ListPage,
  SearchMini,
  ViewToggle,
  ListState,
  DataTable,
  StatusPill,
  Button,
  Icon,
  Drawer,
  MenuButton,
  TaxBasisLabel,
  SelectField,
  cn,
  useToast,
  type RowMenuItem,
} from '@/src/components/ui';
import { EfakturModal } from '@/src/components/EfakturModal';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { ExportButton } from '@/src/components/export';
import { usePermission } from '@/src/auth/usePermission';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAssignInvoiceProject, useSalesInvoices, useIncomingPayments } from '@/src/hooks/useRevenue';
import { useClientCompanyOptions, useInvoiceProjectOptions } from '@/src/hooks/useFkOptions';
import { useProjects } from '@/src/hooks/useProjects';
import { useAssignableProfiles } from '@/src/hooks/useTasks';
import type { ProfileRow } from '@/src/lib/db/profiles';
import { InvoiceProjectModal } from '@/src/components/InvoiceProjectModal';
import { canAttributeInvoice } from '@/src/lib/invoiceProjectAssignment';
import { useRecordContext } from '@/src/hooks/useRecordContext';
import { trackFilterApplied } from '@/src/lib/analytics';
import { formatCurrency, formatCurrencyCents, formatDateOnly, formatInstantDate } from '@/src/lib/format';
import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';
import { deriveArDueDate, overdueAgeDays } from '@/src/lib/repositories/revenueDisplay';
import { salesInvoiceStatusVariant } from '@/src/lib/status/statusVariants';
import { useAuth } from '@/src/auth/useAuth';
import { useRevenueMode } from '@/src/hooks/useRevenueMode';
import { invoiceGross, invoiceNumber, isPartlyPaid } from '@/src/lib/revenue/nativeInvoice';
import { useInvoicePdfDownload } from '@/src/hooks/useInvoicePdfDownload';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { BulkBar } from '@/src/components/finance/receivables/BulkBar';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { isTaxTreatment } from '@/src/lib/taxTreatment';

import { ERP_STATUS_FILTERS, NATIVE_STATUS_FILTERS, salesInvoiceStatusLabel, matchesStatus, type StatusFilter } from './sales-invoices/salesInvoiceListModel';
import { SalesInvoiceEvidenceSection } from './sales-invoices/SalesInvoiceEvidence';

type InvoiceGroupMode = 'none' | 'client' | 'project';

const InvoiceStatusTimeline: React.FC<{ invoice: SalesInvoiceRow; payments: IncomingPaymentRow[]; profiles: ProfileRow[] }> = ({ invoice, payments, profiles }) => {
  const { t } = useTranslation();
  const approver = invoice.approved_by_id ? profiles.find((profile) => profile.id === invoice.approved_by_id)?.full_name : null;
  const orderedPayments = [...payments]
    .filter((payment) => payment.status === 'Paid' && !payment.cancelled_at && !payment.erp_cancelled_at)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const draft = invoice.status === 'Draft';
  const received = Boolean(invoice.received_date) || invoice.status === 'Paid';
  const hasBalance = (invoice.erp_outstanding_amount ?? 0) > 0;
  const steps: { stage: string; state: 'done' | 'current' | 'future'; content: React.ReactNode }[] = [
    {
      stage: 'drafted', state: 'done',
      content: t('finance:receivables.drafted', 'Drafted {{date}}', { date: formatInstantDate(invoice.created_at) }),
    },
    {
      stage: 'approved', state: draft ? 'current' : 'done',
      content: invoice.approved_at
        ? approver
          ? t('finance:receivables.approvedBySecond', 'Approved {{date}} by {{name}}, a second person', { date: formatInstantDate(invoice.approved_at), name: approver })
          : t('finance:receivables.approvalRecorded', 'Approval recorded {{date}}', { date: formatInstantDate(invoice.approved_at) })
        : draft
          ? t('finance:receivables.awaitingApproval', 'Awaiting approval')
          : t('finance:receivables.secondApprover', 'Second person approved'),
    },
    {
      stage: 'received', state: received ? 'done' : draft ? 'future' : 'current',
      content: invoice.received_date
        ? t('finance:receivables.receivedByClient', 'Sent and received by client {{date}}', { date: formatDateOnly(invoice.received_date) })
        : draft
          ? t('finance:receivables.sentToClient', 'Sent and received by client')
          : t('finance:receivables.notReceivedByClient', 'Not marked received'),
    },
    ...orderedPayments.map((payment) => ({
      stage: 'payment', state: 'done' as const,
      content: <><span>{payment.date ? formatDateOnly(payment.date) : t('finance:receivables.partPayments', 'Payment received')}</span><span className="tabular">{payment.received_amount != null ? formatCurrencyCents(payment.received_amount, payment.currency) : payment.amount != null ? formatCurrencyCents(payment.amount, payment.currency) : '—'}</span></>,
    })),
    {
      stage: 'paid',
      state: invoice.status === 'Paid' ? 'done' : received && hasBalance && invoice.status !== 'Cancelled' ? 'current' : 'future',
      content: invoice.status === 'Paid'
        ? t('finance:receivables.statusPaid', 'Paid')
        : t('finance:receivables.awaitingPayment', 'Awaiting full payment'),
    },
  ];
  return (
    <section aria-labelledby="receivable-invoice-timeline">
      <h2 id="receivable-invoice-timeline" className="mb-2 text-sm font-semibold">{t('finance:receivables.timeline', 'Status timeline')}</h2>
      <ol className="relative space-y-3 pl-7 text-sm before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-border">
        {steps.map((step, index) => <li key={`${step.stage}-${index}`} data-stage={step.stage} data-state={step.state} className="relative flex min-h-4 items-start justify-between gap-3">
          <span
            aria-hidden="true"
            className={`absolute -left-7 top-0.5 size-4 rounded-full border-2 ${step.state === 'done' ? 'border-[hsl(var(--success))] bg-[hsl(var(--success))]' : step.state === 'current' ? 'border-[hsl(var(--warning))] bg-[hsl(var(--warning))]' : 'border-muted-foreground bg-card'}`}
          />
          {step.content}
        </li>)}
      </ol>
    </section>
  );
};

interface SalesInvoicesProps {
  embedded?: boolean;
  selectedKeys?: Set<string>;
  onSelectionChange?: (keys: Set<string>) => void;
  onRecordPayment?: (invoice: SalesInvoiceRow) => void;
}

const SalesInvoices: React.FC<SalesInvoicesProps> = ({ embedded = false, selectedKeys, onSelectionChange, onRecordPayment }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useSalesInvoices();
  const { data: paymentRows = [] } = useIncomingPayments(undefined, embedded);
  const { data: profileRows = [] } = useAssignableProfiles();
  const profilesById = useMemo(() => new Map(profileRows.map((profile) => [profile.id, profile])), [profileRows]);
  const { day: organizationToday, isError: orgDayError, retry: retryOrgDay } = useFxOrgDay(true);
  const orgCurrency = useOrgCurrency();
  const actions = useSalesInvoiceActions();
  const { create, setReceivedDate, setEfaktur, submitInvoice, pendingPush, cancelTarget, setCancelTarget, submitTarget, setSubmitTarget, receiptTarget, setReceiptTarget, efakturTarget, setEfakturTarget, projectTarget, setProjectTarget } = actions;
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
  const projectOptionsById = useMemo(() => new Map((projectOptions ?? []).map((option) => [option.value, option])), [projectOptions]);
  const projectsQuery = useProjects({ enabled: embedded });
  const projectsById = useMemo(() => new Map((projectsQuery.data ?? []).map((project) => [project.id, project])), [projectsQuery.data]);
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
  const canCancel = may('transition', 'salesInvoice');
  const canRecordReceipt = may('record_received_date', 'salesInvoice');
  const canRecordEfaktur = may('record_efaktur', 'salesInvoice');
  // One permission oracle for both the row-menu action and its View-modal continuation. The RPC
  // applies the same append-only author-set SoD rule; read-only users may still open invoice details.
  const canApproveDraft = useCallback((inv: SalesInvoiceRow) =>
    inv.status === 'Draft'
    && may('submit_sales_invoice', 'salesInvoice', {
      currentUserId: currentUser?.id,
      record: { author_id: inv.author_user_id, author_ids: inv.author_user_ids },
    }), [currentUser?.id, may]);
  const invoiceStatus = (inv: SalesInvoiceRow) => {
    const gross = invoiceGross(inv);
    const partlySettled = isPartlyPaid(inv) || (
      (inv.status === 'Submitted' || inv.status === 'Unpaid')
      && gross != null
      && inv.erp_outstanding_amount != null
      && inv.erp_outstanding_amount > 0
      && inv.erp_outstanding_amount < gross
    );
    const due = deriveArDueDate(inv.invoice_date, inv.erp_payment_terms_days, inv.erp_due_date, inv.received_date);
    const lateDays = overdueAgeDays(due, organizationToday) ?? 0;
    if (inv.status === 'Draft') return {
      label: canApproveDraft(inv)
        ? t('finance:receivables.statusDraftApproval', 'Draft · to approve')
        : t('finance:receivables.statusDraftSecond', 'Draft · needs a second approver'),
      variant: salesInvoiceStatusVariant(inv.status),
      partlySettled,
    };
    if (inv.status === 'Cancelled') return { label: t('finance:receivables.statusCancelled', 'Cancelled'), variant: salesInvoiceStatusVariant(inv.status), partlySettled };
    if (inv.status === 'Paid') return { label: t('finance:receivables.statusPaid', 'Paid'), variant: salesInvoiceStatusVariant(inv.status), partlySettled };
    if (partlySettled) return {
      label: lateDays > 0
        ? lateDays === 1
          ? t('finance:receivables.statusPartlyPaidLateDay', 'Partly paid · {{count}} day late', { count: lateDays })
          : t('finance:receivables.statusPartlyPaidLateDays', 'Partly paid · {{count}} days late', { count: lateDays })
        : t('finance:receivables.statusPartlyPaid', 'Partly paid · not yet due'),
      variant: lateDays > 0 ? 'overdue' as const : salesInvoiceStatusVariant('Unpaid'),
      partlySettled,
    };
    if (lateDays > 0) return {
      label: lateDays === 1
        ? t('finance:receivables.statusOverdueDay', 'Overdue · {{count}} day', { count: lateDays })
        : t('finance:receivables.statusOverdueDays', 'Overdue · {{count}} days', { count: lateDays }),
      variant: 'overdue' as const,
      partlySettled,
    };
    if (inv.status === 'Submitted') return { label: t('finance:receivables.statusSubmitted', 'Submitted'), variant: salesInvoiceStatusVariant(inv.status), partlySettled };
    return { label: t('finance:receivables.statusUnpaid', 'Unpaid · not yet due'), variant: salesInvoiceStatusVariant(inv.status), partlySettled };
  };

  const all = useMemo(() => data ?? [], [data]);

  // Search and status live in the list URL so a record address can retain and restore the exact context.
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const urlSearch = searchParams.get('q') ?? '';
  useEffect(() => setSearch(urlSearch), [urlSearch]);
  const requestedCustomerId = searchParams.get('customer');
  const selectedCustomer = requestedCustomerId
    ? customerOptionsQuery.data?.find((option) => option.value === requestedCustomerId) ?? null
    : null;
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
  const openInvoiceId = embedded ? searchParams.get('open') : null;
  const panelInvoice = openInvoiceId ? all.find((inv) => inv.id === openInvoiceId) ?? null : null;
  const [localSelectedKeys, setLocalSelectedKeys] = useState<Set<string>>(() => new Set());
  const effectiveSelectedKeys = selectedKeys ?? localSelectedKeys;
  const handleSelectionChange = (next: Set<string>) => {
    if (selectedKeys === undefined) setLocalSelectedKeys(next);
    onSelectionChange?.(next);
  };

  const selectedProject = projectOptionsById.get(searchParams.get('project') ?? '') ?? null;
  const requestedGroup = searchParams.get('group');
  const groupMode: InvoiceGroupMode = requestedGroup === 'client' || requestedGroup === 'project' ? requestedGroup : 'none';

  const updateListParam = (key: 'q' | 'status' | 'attribution' | 'project' | 'customer' | 'overdue', value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (!value || (key === 'status' && value === 'All')) next.delete(key);
      else next.set(key, value);
      return next;
    }, { replace: true });
  };

  const setQueryValue = (key: string, value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  };
  const openInvoicePanel = (invoice: SalesInvoiceRow) => setQueryValue('open', invoice.id);
  const closeInvoicePanel = () => setQueryValue('open', '');

  const invoiceDisplayLabel = (inv: SalesInvoiceRow) => {
    if (inv.si_number) return inv.si_number;
    const project = projectOptionsById.get(inv.project_id ?? '')?.contractualName;
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
    const project = projectOptionsById.get(inv.project_id ?? '')?.contractualName;
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
      setFormTarget({});
      consumeCreateIntent();
      return;
    }

    // Do not turn a still-loading or failed authorized option read into a guessed customer.
    if (projectOptionsQuery.isPending || customerOptionsQuery.isPending) return;
    if (projectOptionsQuery.isError || customerOptionsQuery.isError) {
      setContextError('options');
      return;
    }

    const project = projectOptionsById.get(contextualProjectId);
    const customerId = project?.clientId;
    const customerIsAuthorized = Boolean(customerId && customerOptionsQuery.data?.some((option) => option.value === customerId));
    if (!project || project.archived || !customerId || !customerIsAuthorized) {
      setContextError('invalid');
      consumeCreateIntent();
      return;
    }

    setContextError(null);
    setFormTarget({ initialContext: { projectId: project.value, customerId } });
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
    projectOptionsById,
    projectOptionsQuery.isError,
    projectOptionsQuery.isPending,
    setSearchParams,
  ]);

  const openNewInvoice = () => {
    setContextError(null);
    setFormTarget({});
  };
  const recordPrimaryAction = viewTarget
    ? canApproveDraft(viewTarget)
      ? { label: t('finance:receivables.approve', 'Approve'), onClick: () => setSubmitTarget(viewTarget) }
      : (viewTarget.status === 'Submitted' || viewTarget.status === 'Unpaid') && !viewTarget.received_date && canRecordReceipt && !(viewTarget.pmo_native && !native)
        ? { label: t('finance:receivables.markReceived', 'Mark received'), onClick: () => setReceiptTarget(viewTarget) }
        : (viewTarget.status === 'Submitted' || viewTarget.status === 'Unpaid') && (viewTarget.erp_outstanding_amount ?? 0) > 0 && may('create', 'incomingPayment')
          ? { label: t('finance:receivables.recordPayment', 'Record payment'), onClick: () => navigate(`/incoming-payments?invoice=${encodeURIComponent(viewTarget.id)}&create=1`) }
          : null
    : null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((inv) => searchParams.get('attribution') !== 'unassigned' || inv.project_id === null)
      .filter((inv) => matchesStatus(inv, statusFilter))
      .filter((inv) => !searchParams.get('project') || inv.project_id === searchParams.get('project'))
      .filter((inv) => !searchParams.get('customer') || inv.customer_id === searchParams.get('customer'))
      .filter((inv) => {
        const todo = searchParams.get('todo');
        if (todo === 'approve') return canApproveDraft(inv);
        if (todo === 'second') return inv.status === 'Draft' && (inv.author_user_id === currentUser?.id || inv.author_user_ids.includes(currentUser?.id ?? ''));
        if (todo === 'send') return inv.status !== 'Draft' && inv.status !== 'Cancelled' && inv.status !== 'Paid' && !inv.received_date;
        return true;
      })
      .filter((inv) => searchParams.get('overdue') !== 'true' || !organizationToday || (
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
        || [projectOptionsById.get(inv.project_id ?? '')].some((o) => o && (o.label.toLowerCase().includes(q) || o.contractualName?.toLowerCase().includes(q))));
  }, [all, canApproveDraft, currentUser?.id, organizationToday, projectOptionsById, search, searchParams, statusFilter]);

  // FIN-S1: "Overdue only" is also the oldest-overdue-first view, so it needs no separate sort control.
  const sortedInvoices = useMemo(() => {
    if (searchParams.get('overdue') !== 'true') return filtered;
    return filtered
      .map((invoice, index) => ({
        invoice,
        index,
        age: overdueAgeDays(
          deriveArDueDate(invoice.invoice_date, invoice.erp_payment_terms_days, invoice.erp_due_date, invoice.received_date),
          organizationToday,
        ) ?? 0,
      }))
      .sort((a, b) => b.age - a.age || a.index - b.index)
      .map(({ invoice }) => invoice);
  }, [filtered, organizationToday, searchParams]);
  // P5: on a phone the status chips become one select, so no chip is clipped at the scroll edge.
  const isDesktop = useIsDesktop();
  // C6: the Amount header states the basis most listed amounts share, once; only rows on another basis carry their own.
  const sharedTaxBasis = useMemo(() => {
    if (!embedded) return null;
    const counts = new Map<string, number>();
    for (const inv of sortedInvoices) {
      if (inv.amount == null || !isTaxTreatment(inv.tax_treatment)) continue;
      counts.set(inv.tax_treatment, (counts.get(inv.tax_treatment) ?? 0) + 1);
    }
    const [majority] = [...counts.entries()].sort((left, right) => right[1] - left[1]);
    return majority && isTaxTreatment(majority[0]) ? majority[0] : null;
  }, [embedded, sortedInvoices]);

  const state: 'loading' | 'empty' | 'error' | undefined = isPending || mode === undefined
    ? 'loading'
    : isError || !data
      ? 'error'
      : all.length === 0
        ? 'empty'
        : undefined;

  if (!canView && !embedded) {
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
    return <SalesInvoiceDetail viewTarget={viewTarget} isPending={isPending} isError={isError} data={data} mode={mode} organizationToday={organizationToday} onBack={recordContext.closeRecord} refetch={refetch} recordPrimaryAction={recordPrimaryAction} invoiceDisplayLabel={invoiceDisplayLabel} may={may} pdfDownload={pdfDownload} dialogs={<SalesInvoiceDialogs actions={actions} submitFallback={invoiceDisplayLabel} />} />;
  }

  const { projectLabelOf, displayColumns, exportColumns, mobileCardDetails } = salesInvoiceColumns({ t, all, embedded, native, location, orgCurrency, sharedTaxBasis, projectOptionsById, projectsById, profilesById, invoiceStatus });
  const groupRowsBy = groupMode === 'client'
    ? (inv: SalesInvoiceRow) => inv.customer_name ?? t('finance:receivables.clientUnavailable', 'Client not recorded')
    : groupMode === 'project'
      ? (inv: SalesInvoiceRow) => projectLabelOf(inv) ?? t('finance:receivables.projectUnassigned', 'Unassigned project')
      : undefined;
  const groupBalance = (_label: string, groupInvoices: SalesInvoiceRow[]) => {
    const balances = new Map<string, number>();
    for (const invoice of groupInvoices) {
      if ((invoice.status === 'Submitted' || invoice.status === 'Unpaid') && invoice.erp_outstanding_amount != null) {
        balances.set(invoice.currency, (balances.get(invoice.currency) ?? 0) + Math.round(invoice.erp_outstanding_amount * 100));
      }
    }
    const amounts = Array.from(balances, ([currency, cents]) => formatCurrencyCents(cents / 100, currency));
    return amounts.length
      ? <span className="text-xs font-medium tabular text-muted-foreground">{t('finance:receivables.openBalance', 'Open balance {{amount}}', { amount: amounts.join(' · ') })}</span>
      : null;
  };

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
    } else if (may('assign_project', 'salesInvoice') && inv.project_id) {
      // #1471 FR-004: a native or PMO-authored linked invoice keeps its project; only its billing kind is correctable.
      items.push({ label: t('invoiceProject.changeKind', 'Change billing kind'), onClick: () => setProjectTarget(inv) });
    }
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

  const panelPayments = panelInvoice
    ? paymentRows.filter((payment) => payment.sales_invoice_id === panelInvoice.id
      || Boolean(payment.allocation_details?.some((allocation) => allocation.invoice_id === panelInvoice.id)))
    : [];
  const panelPrimary = panelInvoice
    ? canApproveDraft(panelInvoice)
      ? { label: t('finance:receivables.approve', 'Approve'), onClick: () => setSubmitTarget(panelInvoice) }
      : (panelInvoice.status === 'Submitted' || panelInvoice.status === 'Unpaid') && !panelInvoice.received_date && canRecordReceipt && !(panelInvoice.pmo_native && !native)
        ? { label: t('finance:receivables.markReceived', 'Mark received'), onClick: () => setReceiptTarget(panelInvoice) }
        : (panelInvoice.status === 'Submitted' || panelInvoice.status === 'Unpaid') && (panelInvoice.erp_outstanding_amount ?? 0) > 0 && may('create', 'incomingPayment')
          ? { label: t('finance:receivables.recordPayment', 'Record payment'), onClick: () => onRecordPayment?.(panelInvoice) }
          : null
    : null;
  const openFullInvoice = () => {
    if (!panelInvoice) return;
    const query = new URLSearchParams(searchParams);
    query.delete('open');
    const queryString = query.toString();
    const listPath = `${location.pathname}${queryString ? `?${queryString}` : ''}${location.hash}`;
    navigate(`/sales-invoices/${encodeURIComponent(panelInvoice.id)}${queryString ? `?${queryString}` : ''}`, {
      state: { recordContext: { listPath } },
    });
  };

  return (
    <ListPage
      title={embedded ? t('finance:area.invoicesList', 'Invoices') : t('financeCopy.salesInvoices', "Sales Invoices")}
      headingLevel={embedded ? 2 : 1}
      description={embedded ? undefined : t('finance:invoices.description', 'Client invoices.')}
      primaryAction={!embedded && mode !== undefined && !createRequested && canCreate ? (
        <Button variant="primary" onClick={openNewInvoice}>
          <Icon name="plus" />
          {t('financeCopy.newInvoice', "New Invoice")}</Button>
      ) : undefined}
      desktopToolbarClassName={embedded ? '!mb-0 min-w-0 !flex-nowrap overflow-x-auto !rounded-none !border-x-0 !border-t-0 border-b !bg-transparent !px-0 py-2' : undefined}
      filters={
        state !== 'loading' && (
          <div
            role="region"
            aria-label={t('financeCopy.filterByStatus', "Filter by status")}
            tabIndex={0}
            className={embedded
              // P5: on a phone the filters wrap onto a second line instead of running past the screen edge.
              ? isDesktop
                ? 'flex min-w-0 shrink-0 items-center gap-2 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
                : 'flex min-w-0 max-w-full flex-wrap items-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
              : 'min-w-0 max-w-full overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'}
          >
            {isDesktop ? <ViewToggle<StatusFilter>
              options={statusFilters.map((f) => ({ value: f, label: salesInvoiceStatusLabel(f, t) }))}
              value={statusFilter}
              onChange={(v) => {
                updateListParam('status', v);
                trackFilterApplied('status', statusFilters.length, 'salesInvoices');
              }}
              ariaLabel={t('financeCopy.filterByStatus', "Filter by status")}
            /> : <SelectField
              label={t('financeCopy.filterByStatus', "Filter by status")}
              hideLabel
              value={statusFilter}
              options={statusFilters.map((f) => ({ value: f, label: salesInvoiceStatusLabel(f, t) }))}
              onChange={(v) => {
                updateListParam('status', v);
                trackFilterApplied('status', statusFilters.length, 'salesInvoices');
              }}
              fullWidth
              wrapperClassName="w-full"
              className="h-11 w-full text-[16px]"
            />}
            <div data-testid="invoice-filter-group" className={embedded ? (isDesktop ? 'flex shrink-0 items-center gap-2' : 'flex min-w-0 max-w-full flex-wrap items-center gap-2') : 'mt-2 flex flex-wrap items-end gap-2'}>
              {requestedCustomerId && (
                <div data-testid="customer-filter" className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5">
                  <span role="status" className="min-w-0 break-words text-sm">
                    {t('dashboard.uxs36CustomerFilterLabel', 'Customer')}: <span className="font-medium">
                      {selectedCustomer?.label ?? t('dashboard.uxs36CustomerFilterUnavailable', 'Selected customer is unavailable')}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => updateListParam('customer', '')}
                  >{t('dashboard.uxs36CustomerFilterClear', 'Clear customer filter')}</Button>
                </div>
              )}
              {contextualProjectId && (
                <div data-testid="project-filter" className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5">
                  <span role="status" className="min-w-0 break-words text-sm">
                    {t('financeCopy.project', 'Project')}: <span className="font-medium">
                      {selectedProject?.label ?? t('financeCopy.projectUnavailable', 'Project details unavailable')}
                    </span>
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => updateListParam('project', '')}>
                    {t('finance:invoices.clearProject', 'Clear project filter')}
                  </Button>
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={searchParams.get('overdue') === 'true'}
                disabled={!organizationToday && searchParams.get('overdue') !== 'true'}
                onClick={() => updateListParam('overdue', searchParams.get('overdue') === 'true' ? '' : 'true')}
                className={cn(
                  'h-8',
                  searchParams.get('overdue') === 'true'
                    ? 'border-primary/40 bg-primary/10 font-semibold text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >{t('uxs05.overdueOnly', 'Overdue only')}</Button>
              {embedded && <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">{t('finance:receivables.groupBy', 'Group by')}</span>
                <ViewToggle<InvoiceGroupMode>
                  options={[
                    { value: 'none', label: t('finance:receivables.groupNone', 'None') },
                    { value: 'client', label: t('finance:receivables.groupClient', 'Client') },
                    { value: 'project', label: t('finance:receivables.groupProject', 'Project') },
                  ]}
                  value={groupMode}
                  onChange={(value) => setQueryValue('group', value === 'none' ? '' : value)}
                  ariaLabel={t('finance:receivables.groupBy', 'Group by')}
                />
              </div>}
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
        state !== 'loading' && !(searchParams.get('overdue') === 'true' && !organizationToday) && (
          embedded && effectiveSelectedKeys.size > 0
            ? <BulkBar count={effectiveSelectedKeys.size} onClear={() => handleSelectionChange(new Set())}>
              <ExportButton
                rows={all.filter((invoice) => effectiveSelectedKeys.has(invoice.id))}
                columns={exportColumns}
                entity="Sales Invoices"
                label={t('finance:bulk.exportSelected', 'Export selected')}
              />
            </BulkBar>
            : <ExportButton rows={sortedInvoices} columns={exportColumns} entity="Sales Invoices" />
        )
      }
    >
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
            >
              {t('uxs15.retryContext', 'Retry context')}
            </Button>
          )}
        </div>
      )}
      {search.trim() && projectOptionsQuery.isPending && <p role="status" className="text-sm text-muted-foreground">{t('finance:receivables.projectSearchLoading', 'Loading projects for search…')}</p>}
      {searchParams.get('overdue') === 'true' && !organizationToday && !orgDayError && <p role="status" className="text-sm text-muted-foreground">{t('finance:receivables.businessDayLoading', 'Loading the business day; overdue results cannot be calculated yet.')}</p>}
      {projectOptionsQuery.isError && <div role="alert" className="flex items-center gap-3 text-sm">{t('finance:receivables.projectSearchUnavailable', 'Project search is unavailable.')} <Button variant="outline" size="sm" onClick={() => void refetchProjectOptions()}>{t('finance:receivables.retryProjects', 'Retry projects')}</Button></div>}
      {orgDayError && <div role="alert" className="flex items-center gap-3 text-sm">{t('finance:receivables.businessDayUnavailable', 'Business day unavailable; overdue results cannot be calculated.')} <Button variant="outline" size="sm" onClick={retryOrgDay}>{t('finance:receivables.retryBusinessDay', 'Retry business day')}</Button></div>}
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
          sub={canCreate
            ? t('financeCopy.createYourFirstInvoiceToStartBillingClients', 'No client invoices have been recorded yet. Use New Invoice to start billing.')
            : t('uxs26.invoiceEmptyProjectManager', 'No client invoices have been recorded yet. Finance manages invoice creation.')}
          stateId="sales-invoices-empty"
          role={realRole ?? undefined}
          module="salesInvoices"
        />
      )}

      {state === undefined && (
        <DataTable<SalesInvoiceRow>
          rows={sortedInvoices}
          columns={displayColumns}
          rowKey={(inv) => inv.id}
          rowMenu={rowMenu}
          onActivate={embedded ? openInvoicePanel : undefined}
          rowLabel={embedded ? (inv) => t('table.openRow', 'Open {{name}}', { name: invoiceNumber(inv) ?? inv.customer_name ?? invoiceDisplayLabel(inv) }) : undefined}
          mobileCardTitle={embedded ? (inv) => <span className="flex min-w-0 flex-col gap-0.5">
            <span className="min-w-0 truncate text-[13px] font-semibold">{inv.customer_name ?? t('finance:receivables.clientUnavailable', 'Client not recorded')}</span>
            <span className="min-w-0 truncate font-mono text-xs font-normal text-muted-foreground">{invoiceNumber(inv) ?? t('financeCopy.draftInvoiceLabel', 'Draft · {{customer}}', { customer: inv.customer_name ?? '—' })}</span>
          </span> : undefined}
          mobileCardDetails={embedded ? mobileCardDetails : undefined}
          selection={embedded ? {
            selectedIds: effectiveSelectedKeys,
            onChange: handleSelectionChange,
            rowLabel: (inv) => t('finance:table.selectRow', 'Select {{name}}', { name: invoiceNumber(inv) ?? inv.customer_name ?? invoiceDisplayLabel(inv) }),
          } : undefined}
          groupBy={groupRowsBy}
          groupHeader={embedded && groupRowsBy ? groupBalance : undefined}
          state={sortedInvoices.length === 0 ? 'empty' : undefined}
          emptyTitle={searchParams.get('overdue') === 'true' && !organizationToday ? t('finance:receivables.overdueUnavailable', 'Overdue results are unavailable') : t('financeCopy.noInvoicesMatchYourFilters', "No invoices match your filters")}
          emptySub={t('financeCopy.tryADifferentStatusOrClearTheSearch', "Try a different status or clear the search.")}
        tableId="salesinvoices-table" />
      )}

      {/* Create modal */}
      {formTarget && (
        <SalesInvoiceFormModal
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
        />
      )}

      {projectTarget && (
        <InvoiceProjectModal
          invoice={projectTarget}
          projects={projectOptions ?? []}
          loadProjects={loadProjectOptions}
          currentProjectName={projectOptionsById.get(projectTarget.project_id ?? '')?.label ?? null}
          loading={assignProject.isPending}
          projectLocked={!canAttributeInvoice(projectTarget)}
          onClose={() => setProjectTarget(null)}
          onSave={async (projectId, billingKind) => {
            await assignProject.mutateAsync({
              siId: projectTarget.id,
              projectId,
              oldProjectId: projectTarget.project_id,
              billingKind,
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

      <SalesInvoiceDialogs actions={actions} submitFallback={(invoice) => invoice.id} />

      <Drawer
        open={Boolean(panelInvoice)}
        // N5: the title names the client; the amount lives in the figures below, so the title never wraps on money.
        title={panelInvoice ? panelInvoice.customer_name ?? t('finance:receivables.clientUnavailable', 'Client not recorded') : ''}
        subtitle={panelInvoice ? <span className="flex flex-wrap items-center gap-2">
          {invoiceNumber(panelInvoice) && <span className="font-mono text-xs">{invoiceNumber(panelInvoice)}</span>}
          {projectLabelOf(panelInvoice) && <span className="text-xs">{projectLabelOf(panelInvoice)}</span>}
        </span> : undefined}
        icon={<Icon name="doc" />}
        status={panelInvoice ? <StatusPill variant={invoiceStatus(panelInvoice).variant}>{invoiceStatus(panelInvoice).label}</StatusPill> : undefined}
        headerActions={panelInvoice ? <>
          {panelPrimary && <Button type="button" variant="primary" size="sm" onClick={panelPrimary.onClick}>{panelPrimary.label}</Button>}
          <Button type="button" variant="outline" size="sm" onClick={openFullInvoice}>{t('finance:receivables.openFullRecord', 'Open full page')}</Button>
          <MenuButton items={rowMenu(panelInvoice)} ariaLabel={t('finance:receivables.rowActions', 'Invoice actions')} />
        </> : undefined}
        onClose={closeInvoicePanel}
        width="lg"
        loading={submitInvoice.isPending || setReceivedDate.isPending}
        nestedOpen={Boolean(submitTarget || receiptTarget || formTarget || cancelTarget || projectTarget || efakturTarget)}
      >
        {panelInvoice && <div className="space-y-5 p-4 sm:p-5">
          {(() => {
            // C4: a field with nothing recorded is left out; an unknown open balance is said once, never shown as a dash.
            const due = deriveArDueDate(panelInvoice.invoice_date, panelInvoice.erp_payment_terms_days, panelInvoice.erp_due_date, panelInvoice.received_date);
            const outstandingUnknown = panelInvoice.erp_outstanding_amount == null && (panelInvoice.status === 'Unpaid' || panelInvoice.status === 'Submitted');
            const field = (key: string, label: string, value: React.ReactNode) => <div key={key}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1">{value}</dd></div>;
            return <div className="border-b border-border pb-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {panelInvoice.amount != null && field('amount', t('finance:receivables.amount', 'Amount'), <span className="flex flex-wrap items-baseline gap-x-1.5"><span className="tabular font-semibold">{formatCurrency(panelInvoice.amount, panelInvoice.currency)}</span><TaxBasisLabel treatment={panelInvoice.tax_treatment} showDetails taxRate={panelInvoice.tax_rate} taxBaseNumerator={panelInvoice.tax_base_numerator} taxBaseDenominator={panelInvoice.tax_base_denominator} /></span>)}
                {panelInvoice.erp_outstanding_amount != null && field('outstanding', t('finance:receivables.outstanding', 'Outstanding · tax included'), <span className="tabular">{formatCurrency(panelInvoice.erp_outstanding_amount, panelInvoice.currency)}</span>)}
                {due && field('due', t('finance:receivables.dueDate', 'Due date'), formatDateOnly(due))}
                {panelInvoice.invoice_date && field('invoiceDate', t('finance:receivables.invoiceDate', 'Invoice date'), formatDateOnly(panelInvoice.invoice_date))}
                {panelInvoice.erp_payment_terms_days != null && field('terms', t('finance:receivables.paymentTerms', 'Terms'), t('finance:receivables.paymentTermsDays', '{{count}} days', { count: panelInvoice.erp_payment_terms_days }))}
                {panelInvoice.efaktur_number && field('efaktur', t('finance:receivables.eFaktur', 'e-Faktur'), `${panelInvoice.efaktur_number}${panelInvoice.efaktur_date ? ` · ${formatDateOnly(panelInvoice.efaktur_date)}` : ''}`)}
              </dl>
              {outstandingUnknown && <p className="mt-3 text-xs text-muted-foreground">{t('finance:receivables.outstandingUnknown', 'The outstanding balance is not known yet: the accounting system has not reported it for this invoice.')}</p>}
            </div>;
          })()}
          <InvoiceStatusTimeline invoice={panelInvoice} payments={panelPayments} profiles={profileRows} />
          <SalesInvoiceEvidenceSection invoice={panelInvoice} />
        </div>}
      </Drawer>
    </ListPage>
  );
};

export default SalesInvoices;
