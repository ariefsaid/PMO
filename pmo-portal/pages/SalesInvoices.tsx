import { salesInvoiceColumns } from './sales-invoices/salesInvoiceColumns';
import { SalesInvoiceDetail } from './sales-invoices/SalesInvoiceDetail';
import { SalesInvoiceDialogs } from './sales-invoices/SalesInvoiceDialogs';
import { useSalesInvoiceActions } from './sales-invoices/useSalesInvoiceActions';
import { SalesInvoiceFormModal } from './sales-invoices/SalesInvoiceFormModal';
import SalesInvoicesFilters from './sales-invoices/SalesInvoicesFilters';
import SalesInvoicePanelDrawer from './sales-invoices/SalesInvoicePanelDrawer';
import { createInvoiceReceiptGate, createInvoiceStatus } from './sales-invoices/salesInvoiceStatus';
import { buildInvoiceRowMenu } from './sales-invoices/salesInvoiceRowMenu';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import {
  ListPage,
  ListState,
  DataTable,
  Button,
  Icon,
  useToast,
  useUrlFilters,
} from '@/src/components/ui';
import { EfakturModal } from '@/src/components/EfakturModal';
import { issuedWithinMonthWindow, monthWindowFromParams } from '@/src/lib/finance/invoicePeriod';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { ExportButton } from '@/src/components/export';
import { usePermission } from '@/src/auth/usePermission';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAssignInvoiceProject, useSalesInvoices, useIncomingPayments } from '@/src/hooks/useRevenue';
import { useClientCompanyOptions, useInvoiceProjectOptions } from '@/src/hooks/useFkOptions';
import { useProjects } from '@/src/hooks/useProjects';
import { useAssignableProfiles } from '@/src/hooks/useTasks';
import { InvoiceProjectModal } from '@/src/components/InvoiceProjectModal';
import { canAttributeInvoice } from '@/src/lib/invoiceProjectAssignment';
import { useRecordContext } from '@/src/hooks/useRecordContext';
import { trackFilterApplied } from '@/src/lib/analytics';
import { formatCurrencyCents } from '@/src/lib/format';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { clientInvoiceOverdueDays } from '@/src/lib/repositories/revenueDisplay';
import { useAuth } from '@/src/auth/useAuth';
import { useRevenueMode } from '@/src/hooks/useRevenueMode';
import { invoiceNumber } from '@/src/lib/revenue/nativeInvoice';
import { useInvoicePdfDownload } from '@/src/hooks/useInvoicePdfDownload';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { BulkBar } from '@/src/components/finance/receivables/BulkBar';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { isTaxTreatment } from '@/src/lib/taxTreatment';
import { odooOwnsRevenueTier } from '@/src/lib/adapterSeam/odoo/ownership';
import { useExternalDomainOwnership } from '@/src/hooks/useExternalDomainOwnership';
import { useOdooRevenueCommandsForInvoices } from '@/src/hooks/useOdooRevenue';
import { useOdooUnreachable } from '@/src/hooks/useOdooPurchase';

import { ERP_STATUS_FILTERS, NATIVE_STATUS_FILTERS, matchesStatus, type StatusFilter } from './sales-invoices/salesInvoiceListModel';

type InvoiceGroupMode = 'none' | 'client' | 'project';

interface SalesInvoicesProps {
  embedded?: boolean;
  /** The page's other create action; on a phone it sits in the toolbar ⋯ menu. */
  secondaryAction?: { label: string; onSelect: () => void };
  onRecordPayment?: (invoice: SalesInvoiceRow) => void;
}

const SalesInvoices: React.FC<SalesInvoicesProps> = ({ embedded = false, onRecordPayment, secondaryAction: _secondaryAction }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useSalesInvoices();
  const mode = useRevenueMode();
  const ownership = useExternalDomainOwnership().data ?? [];
  const odoo = ownership.some((row) => row.domain === 'revenue' && odooOwnsRevenueTier(row.externalTier));
  const odooUnreachable = useOdooUnreachable(odoo).unreachable;
  const odooOffline = odoo && odooUnreachable;
  const odooCommands = useOdooRevenueCommandsForInvoices((data ?? []).map((invoice) => invoice.id), odoo);
  const { data: paymentRows = [] } = useIncomingPayments(undefined, embedded || mode === 'erp');
  const { data: profileRows = [] } = useAssignableProfiles();
  const profilesById = useMemo(() => new Map(profileRows.map((profile) => [profile.id, profile])), [profileRows]);
  const { day: organizationToday, isError: orgDayError, retry: retryOrgDay } = useFxOrgDay(true);
  const orgCurrency = useOrgCurrency();
  const actions = useSalesInvoiceActions();
  const { create, setReceivedDate, setEfaktur, submitInvoice, pendingPush, cancelTarget, setCancelTarget, submitTarget, setSubmitTarget, receiptTarget, setReceiptTarget, efakturTarget, setEfakturTarget, projectTarget, setProjectTarget } = actions;
  const pdfDownload = useInvoicePdfDownload();
  // #784: undefined while ownership loads — the page waits rather than flash the wrong mode's copy and actions.
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
  const receiptAwaitingOdooForInvoice = createInvoiceReceiptGate(paymentRows);
  const invoiceStatus = createInvoiceStatus({
    t,
    canApproveDraft,
    receiptAwaitingOdooForInvoice,
    odoo,
    odooOffline,
    organizationToday,
    odooCommandsData: odooCommands.data,
  });

  const all = useMemo(() => data ?? [], [data]);

  // Search and status live in the list URL so a record address can retain and restore the exact context.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlFilters = useUrlFilters(['q', 'status', 'attribution']);
  const search = urlFilters.values.q;
  const requestedCustomerId = searchParams.get('customer');
  const selectedCustomer = requestedCustomerId
    ? customerOptionsQuery.data?.find((option) => option.value === requestedCustomerId) ?? null
    : null;
  const requestedStatus = urlFilters.values.status;
  const statusFilter: StatusFilter = requestedStatus && statusFilters.includes(requestedStatus as StatusFilter)
    ? requestedStatus as StatusFilter
    : 'All';
  useEffect(() => {
    if (mode === undefined) return;
    const requested = searchParams.get('status');
    if (requested === null || (requested !== 'All' && statusFilters.includes(requested as StatusFilter))) return;
    urlFilters.setFilter('status', '', { replace: true });
  }, [mode, searchParams, statusFilters, urlFilters]);
  // The list leaves out a PMO copy that counts through its ERP invoice (ECA-5); a direct link still opens it, read by id.
  const listedTarget = invoiceId ? all.find((inv) => inv.id === invoiceId) : undefined;
  const unlisted = useQuery({
    queryKey: ['salesInvoice', currentUser?.org_id, invoiceId],
    queryFn: () => repositories.revenue.getInvoice(invoiceId!),
    enabled: Boolean(invoiceId && currentUser?.org_id && !isPending && !isError && !listedTarget),
    retry: false,
  });
  const viewTarget = invoiceId ? listedTarget ?? unlisted.data ?? null : null;
  const openInvoiceId = embedded ? searchParams.get('open') : null;
  const panelInvoice = openInvoiceId ? all.find((inv) => inv.id === openInvoiceId) ?? null : null;
  const [localSelectedKeys, setLocalSelectedKeys] = useState<Set<string>>(() => new Set());
  const handleSelectionChange = (next: Set<string>) => {
    setLocalSelectedKeys(next);
  };

  const selectedProject = projectOptionsById.get(searchParams.get('project') ?? '') ?? null;
  const requestedGroup = searchParams.get('group');
  const groupMode: InvoiceGroupMode = requestedGroup === 'client' || requestedGroup === 'project' ? requestedGroup : 'none';

  const updateListParam = (key: 'q' | 'status' | 'attribution' | 'project' | 'customer' | 'overdue', value: string) => {
    if (key === 'q') {
      urlFilters.setFilter(key, value, { replace: true });
    } else if (key === 'status') {
      urlFilters.setFilter(key, value === 'All' ? '' : value);
    } else {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        if (!value) next.delete(key);
        else next.set(key, value);
        return next;
      }, { replace: true });
    }
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
  const recordPrimaryAction = !odooOffline && viewTarget
    ? canApproveDraft(viewTarget)
      ? { label: t('finance:receivables.approve', 'Approve'), onClick: () => setSubmitTarget(viewTarget) }
      : (viewTarget.status === 'Submitted' || viewTarget.status === 'Unpaid') && !viewTarget.received_date && canRecordReceipt && !(viewTarget.pmo_native && !native)
        ? { label: t('finance:receivables.markReceived', 'Record delivery'), onClick: () => setReceiptTarget(viewTarget) }
        : (viewTarget.status === 'Submitted' || viewTarget.status === 'Unpaid') && (viewTarget.erp_outstanding_amount ?? 0) > 0 && may('create', 'incomingPayment')
          ? { label: t('finance:receivables.recordPayment', 'Record payment'), onClick: () => navigate(`/finance/receivables?view=payments&invoice=${encodeURIComponent(viewTarget.id)}&create=1`) }
          : null
    : null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // #1461: a dashboard 'Invoiced · excl. tax' drill carries its window (`from`/`to` month
    // tokens). The list then shows exactly the issued, non-cancelled invoices dated in that
    // window — the records the management-pack figure sums.
    const periodWindow = monthWindowFromParams(searchParams.get('from'), searchParams.get('to'));
    return all
      .filter((inv) => searchParams.get('attribution') !== 'unassigned' || inv.project_id === null)
      .filter((inv) => matchesStatus(inv, statusFilter))
      .filter((inv) => (periodWindow ? issuedWithinMonthWindow(inv, periodWindow) : true))
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
        // #1457: the one shared overdue rule decides the "Overdue only" filter.
        clientInvoiceOverdueDays(inv, organizationToday) !== null
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
        // #1457: the one shared overdue rule also provides the oldest-first sort age.
        age: clientInvoiceOverdueDays(invoice, organizationToday) ?? 0,
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
    return <SalesInvoiceDetail viewTarget={viewTarget} isPending={isPending || unlisted.isFetching} isError={isError || unlisted.isError} data={data} mode={mode} organizationToday={organizationToday} onBack={recordContext.closeRecord} refetch={refetch} recordPrimaryAction={recordPrimaryAction} invoiceDisplayLabel={invoiceDisplayLabel} receiptAwaitingOdoo={viewTarget ? receiptAwaitingOdooForInvoice(viewTarget) : false} odoo={odoo} may={may} pdfDownload={pdfDownload} dialogs={<SalesInvoiceDialogs actions={actions} submitFallback={invoiceDisplayLabel} />} />;
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
      ? <span className="text-control font-medium tabular text-muted-foreground">{t('finance:receivables.openBalance', 'Open balance {{amount}}', { amount: amounts.join(' · ') })}</span>
      : null;
  };

  const rowMenu = buildInvoiceRowMenu({
    t, may, pdfDownload, native, odooOffline: Boolean(odooOffline), canCancel, canRecordReceipt, canRecordEfaktur,
    canApproveDraft, openRecord: recordContext.openRecord, setProjectTarget, setReceiptTarget, setEfakturTarget, setCancelTarget, setSubmitTarget,
  });

  const panelPayments = panelInvoice
    ? paymentRows.filter((payment) => (!payment.pmo_native && payment.sales_invoice_id === panelInvoice.id)
      || Boolean(payment.allocation_details?.some((allocation) => allocation.invoice_id === panelInvoice.id))
      // #1415: a PMO receipt reaches an invoice through its live allocations, never through its own invoice pointer.
      || Boolean(payment.allocations?.some((allocation) => allocation.sales_invoice_id === panelInvoice.id)))
    : [];
  const panelPrimary = !odooOffline && panelInvoice
    ? canApproveDraft(panelInvoice)
      ? { label: t('finance:receivables.approve', 'Approve'), onClick: () => setSubmitTarget(panelInvoice) }
      : (panelInvoice.status === 'Submitted' || panelInvoice.status === 'Unpaid') && !panelInvoice.received_date && canRecordReceipt && !(panelInvoice.pmo_native && !native)
        ? { label: t('finance:receivables.markReceived', 'Record delivery'), onClick: () => setReceiptTarget(panelInvoice) }
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

  const filtersNode = state !== 'loading' && (
          <SalesInvoicesFilters
            embedded={embedded}
            isDesktop={isDesktop}
            statusFilters={statusFilters}
            statusFilter={statusFilter}
            onStatusChange={(v) => {
              updateListParam('status', v);
              trackFilterApplied('status', statusFilters.length, 'salesInvoices');
            }}
            search={search}
            onSearchChange={(v) => updateListParam('q', v)}
            onClearFilters={() => urlFilters.clear()}
            shownCount={filtered.length}
            totalCount={all.length}
            requestedCustomerId={requestedCustomerId}
            selectedCustomerLabel={selectedCustomer?.label ?? null}
            customerOptionsPending={customerOptionsQuery.isPending}
            onClearCustomer={() => updateListParam('customer', '')}
            contextualProjectId={contextualProjectId}
            selectedProjectLabel={selectedProject?.label ?? null}
            onClearProject={() => updateListParam('project', '')}
            overdueActive={searchParams.get('overdue') === 'true'}
            organizationToday={organizationToday}
            onToggleOverdue={() => updateListParam('overdue', searchParams.get('overdue') === 'true' ? '' : 'true')}
            groupMode={groupMode}
            onGroupChange={(value) => setQueryValue('group', value === 'none' ? '' : value)}
          />
        );
  const exportNode = state !== 'loading' && !(searchParams.get('overdue') === 'true' && !organizationToday) && (
          embedded && localSelectedKeys.size > 0
            ? <BulkBar count={localSelectedKeys.size} onClear={() => handleSelectionChange(new Set())}>
              <ExportButton
                rows={all.filter((invoice) => localSelectedKeys.has(invoice.id))}
                columns={exportColumns}
                entity="Sales Invoices"
                label={t('finance:bulk.exportSelected', 'Export selected')}
              />
            </BulkBar>
            : <ExportButton rows={sortedInvoices} columns={exportColumns} entity="Sales Invoices" />
        );

  return (
    <ListPage
      title={invoiceId ? t('shell.nav.invoiceRecord', 'Invoice record') : embedded ? t('finance:area.invoicesList', 'Invoices') : t('financeCopy.salesInvoices', "Sales Invoices")}
      count={undefined}
      total={undefined}
      headingLevel={embedded ? 2 : 1}
      banner={odooOffline ? <p role="status" className="mb-3 text-sm text-muted-foreground">{t('finance:odooOutcome.offlineAction', 'Odoo is unavailable. You can still view the last data PMO read; no new changes were sent from this screen.')}</p> : undefined}
      primaryAction={!embedded && mode !== undefined && !createRequested && canCreate ? (
        <Button variant="primary" onClick={openNewInvoice}>
          <Icon name="plus" />
          {t('financeCopy.newInvoice', "New Invoice")}</Button>
      ) : undefined}
      hideHeader={embedded}
      filters={filtersNode}
      exportAction={exportNode}
      desktopToolbarClassName={embedded ? '!mb-0 min-w-0 !flex-nowrap overflow-x-auto !rounded-none !border-x-0 !border-t-0 border-b !bg-transparent !px-0 py-2' : undefined}
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
            {t('financeCopy.clearAttribution', 'Clear attribution')}
          </Button>
        </div>
      )}
      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" shape="table" columns={6} rows={6} />
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
          title={t('financeCopy.noSalesInvoicesYet', "No invoices yet")}
          sub={canCreate ? t('financeCopy.createYourFirstInvoiceToStartBillingClients', 'Use New Invoice to start billing.') : t('uxs26.invoiceEmptyProjectManager', 'Finance manages invoice creation.')}
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
            <span className="min-w-0 truncate text-control font-semibold">{inv.customer_name ?? t('finance:receivables.clientUnavailable', 'Client not recorded')}</span>
            <span className="min-w-0 truncate font-mono text-control font-normal text-muted-foreground">{invoiceNumber(inv) ?? t('financeCopy.draftInvoiceLabel', 'Draft · {{customer}}', { customer: inv.customer_name ?? '—' })}</span>
          </span> : undefined}
          mobileCardDetails={embedded ? mobileCardDetails : undefined}
          selection={embedded ? {
            selectedIds: localSelectedKeys,
            onChange: handleSelectionChange,
            selectAllAfterFirst: true,
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
              ...(input.billingKind ? { billingKind: input.billingKind } : {}),
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

      <SalesInvoicePanelDrawer
        panelInvoice={panelInvoice}
        panelPayments={panelPayments}
        profileRows={profileRows}
        panelPrimary={panelPrimary}
        invoiceStatus={invoiceStatus}
        projectLabelOf={projectLabelOf}
        rowMenu={rowMenu}
        odoo={odoo}
        onClose={closeInvoicePanel}
        onOpenFullInvoice={openFullInvoice}
        nestedOpen={Boolean(submitTarget || receiptTarget || formTarget || cancelTarget || projectTarget || efakturTarget)}
        loading={submitInvoice.isPending || setReceivedDate.isPending}
      />
    </ListPage>
  );
};

export default SalesInvoices;
