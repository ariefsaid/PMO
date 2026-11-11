import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ListPage,
  SearchMini,
  ViewToggle,
  ListState,
  DataTable,
  StatusPill,
  ConfirmDialog,
  Button,
  Icon,
  Drawer,
  MenuButton,
  useToast,
  type RowMenuItem,
} from '@/src/components/ui';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { ExportButton } from '@/src/components/export';
import { useExport } from '@/src/components/export/useExport';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { PhoneListToolbar } from './sales-invoices/PhoneListToolbar';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useIncomingPayments, useSalesInvoices, useRevenueMutations } from '@/src/hooks/useRevenue';
import { useInvoiceProjectOptions } from '@/src/hooks/useFkOptions';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { trackFilterApplied } from '@/src/lib/analytics';
import {
  formatCurrency,
  formatDay,
} from '@/src/lib/format';
import type { IncomingPaymentRow } from '@/src/lib/db/revenue';
import { incomingPaymentStatusVariant, salesInvoiceStatusVariant } from '@/src/lib/status/statusVariants';
import { useRevenueMode } from '@/src/hooks/useRevenueMode';
import { useExternalDomainOwnership } from '@/src/hooks/useExternalDomainOwnership';
import { useOdooUnreachable } from '@/src/hooks/useOdooPurchase';
import { odooOwnsRevenueTier } from '@/src/lib/adapterSeam/odoo/ownership';
import { invoiceNumber, receiptNumber } from '@/src/lib/revenue/nativeInvoice';
import { useRecordContext } from '@/src/hooks/useRecordContext';
import { nativeRevenueHeadlines } from '@/src/lib/revenue/nativeRevenueErrors';
import { useCommandIntentMap } from '@/src/hooks/useCommandIntent';
import { displayAllocations, knownUnappliedCash } from '@/src/lib/revenue/receiptAllocation';
import { receiptColumns, displayStatus, matchesStatus, incomingPaymentStatusLabel, ERP_STATUS_FILTERS, NATIVE_STATUS_FILTERS, type StatusFilter } from './incoming-payments/receiptColumns';
import { monthWindowFromParams, monthWindowExclusiveEnd } from '@/src/lib/finance/invoicePeriod';
import { OdooReceiptStatus } from './incoming-payments/OdooReceiptStatus';
import { IncomingPaymentFormModal } from './incoming-payments/IncomingPaymentFormModal';
import { ApplyReceiptForm } from './incoming-payments/ApplyReceiptForm';
import { ReceiptRecord } from './incoming-payments/ReceiptRecord';
import { BulkBar } from '@/src/components/finance/receivables/BulkBar';

interface IncomingPaymentsProps {
  embedded?: boolean;
  /** The page's other create action; on a phone it sits in the toolbar ⋯ menu. */
  secondaryAction?: { label: string; onSelect: () => void };
  selectedKeys?: Set<string>;
  onSelectionChange?: (keys: Set<string>) => void;
}

const IncomingPayments: React.FC<IncomingPaymentsProps> = ({ embedded = false, secondaryAction, selectedKeys, onSelectionChange }) => {
  const isDesktop = useIsDesktop();
  const { exportXlsx, busy: exporting } = useExport();
  const { t } = useTranslation();
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const navigate = useNavigate();
  const { receiptId } = useParams<{ receiptId: string }>();
  const location = useLocation();
  const recordContext = useRecordContext('/incoming-payments', receiptId);
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useIncomingPayments();
  const { createPayment, cancelPayment, applyReceipt, unapplyAllocation, pendingPush } = useRevenueMutations();
  // #784: undefined while ownership loads — the page waits rather than flash the wrong mode's copy and actions.
  const mode = useRevenueMode();
  const revenueOwnership = useExternalDomainOwnership().data ?? [];
  const odoo = revenueOwnership.some((row) => row.domain === 'revenue' && odooOwnsRevenueTier(row.externalTier));
  const odooOffline = useOdooUnreachable(odoo).unreachable;
  const native = mode === 'native';
  const statusFilters = native ? NATIVE_STATUS_FILTERS : data?.some((p) => displayStatus(p) === 'Cancelled') ? [...ERP_STATUS_FILTERS, 'Cancelled' as const] : ERP_STATUS_FILTERS;
  // I-5: the invoice each receipt settles, by its number (the list read already holds them).
  const { data: invoiceList, isPending: invoiceListPending } = useSalesInvoices();
  const projectOptions = useInvoiceProjectOptions().data ?? [];
  const invoiceNumberById = useMemo(
    () => new Map((invoiceList ?? []).map((inv) => [inv.id, invoiceNumber(inv)])),
    [invoiceList],
  );

  const canView = may('view', 'incomingPayment');
  const canCreate = may('create', 'incomingPayment');
  const canCancel = may('transition', 'incomingPayment');

  const all = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  // #1461: the list status is URL-owned so a dashboard drill (`status=Paid&from&to`) lands on
  // exactly the receipts the Collected figure sums, and a copied link reproduces the view.
  const [statusFilter, setStatusFilterState] = useState<StatusFilter>(() => {
    const requested = searchParams.get('status');
    return requested && ['All', 'Scheduled', 'Paid', 'Received', 'Cancelled'].includes(requested)
      ? requested as StatusFilter
      : 'All';
  });
  const setStatusFilter = (next: StatusFilter) => {
    setStatusFilterState(next);
    setQueryValue('status', next === 'All' ? '' : next);
  };

  const [formOpen, setFormOpen] = useState(false);
  const [initialInvoiceId, setInitialInvoiceId] = useState<string | undefined>();
  const [cancelTarget, setCancelTarget] = useState<IncomingPaymentRow | null>(null);
  // #1415: apply a PMO receipt across invoices / take one allocation back (org without an ERP).
  const [applyTarget, setApplyTarget] = useState<IncomingPaymentRow | null>(null);
  const [unapplyTarget, setUnapplyTarget] = useState<{ id: string; invoice: string } | null>(null);
  const [unapplying, setUnapplying] = useState(false);
  const [localSelectedKeys, setLocalSelectedKeys] = useState<Set<string>>(() => new Set());
  const effectiveSelectedKeys = selectedKeys ?? localSelectedKeys;
  const handleSelectionChange = (next: Set<string>) => {
    if (selectedKeys === undefined) setLocalSelectedKeys(next);
    onSelectionChange?.(next);
  };
  const openPaymentId = embedded ? searchParams.get('open') : null;
  const panelPayment = openPaymentId ? all.find((payment) => payment.id === openPaymentId) ?? null : null;
  const setQueryValue = (key: string, value: string) => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    if (value) next.set(key, value);
    else next.delete(key);
    return next;
  }, { replace: true });
  const openPaymentPanel = (payment: IncomingPaymentRow) => setQueryValue('open', payment.id);
  const closePaymentPanel = () => setQueryValue('open', '');
  const openFullPayment = () => {
    if (!panelPayment) return;
    const query = new URLSearchParams(searchParams);
    query.delete('open');
    const queryString = query.toString();
    const listPath = `${location.pathname}${queryString ? `?${queryString}` : ''}${location.hash}`;
    navigate(`/incoming-payments/${encodeURIComponent(panelPayment.id)}${queryString ? `?${queryString}` : ''}`, { state: { recordContext: { listPath } } });
  };
  const panelInvoice = panelPayment?.sales_invoice_id
    ? (invoiceList ?? []).find((invoice) => invoice.id === panelPayment.sales_invoice_id)
    : undefined;
  const invoiceNumberOfPanel = (invoiceId: string) => invoiceNumberById.get(invoiceId) ?? null;
  const panelAllocations = panelPayment ? displayAllocations(panelPayment, invoiceNumberOfPanel) : null;
  const panelUnapplied = panelPayment ? knownUnappliedCash({ ...panelPayment, allocation_details: panelAllocations }) : null;
  // #1415 AC-NPA-010/011: Apply and Unapply exist only for a PMO receipt in an org whose revenue no ERP owns, for the revenue writers;
  // an ERP's allocation is read-only here. This is UX only — the RPCs enforce role, ownership and balances.
  const canApplyHere = native && Boolean(panelPayment?.pmo_native) && !panelPayment?.cancelled_at && canCreate && !odooOffline;

  useEffect(() => {
    if (searchParams.get('create') !== '1' || !canCreate || odooOffline || mode === undefined || invoiceListPending) return;
    setInitialInvoiceId(searchParams.get('invoice') ?? undefined);
    setFormOpen(true);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('create');
      next.delete('invoice');
      return next;
    }, { replace: true });
  }, [canCreate, invoiceListPending, mode, odooOffline, searchParams, setSearchParams]);

  // BLOCK 2 (ADR-0058): the cancel confirm dialog is ALWAYS mounted, so its command identity is per
  // (record, verb) — a retry on payment B must never carry payment A's key. Released only after a
  // terminal success (never on error — reusing the key on retry IS the fix).
  const verbIntents = useCommandIntentMap();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // #1461: a dashboard 'Collected' drill carries its window (`from`/`to` month tokens); the
    // list then shows exactly the Paid receipts dated in that window — the records it sums.
    const periodWindow = monthWindowFromParams(searchParams.get('from'), searchParams.get('to'));
    return all
      .filter((p) => matchesStatus(p, statusFilter))
      .filter((p) => (periodWindow
        ? p.status === 'Paid' && p.date !== null && p.date >= `${periodWindow.from}-01` && p.date < monthWindowExclusiveEnd(periodWindow.to)
        : true))
      .filter((p) => searchParams.get('todo') !== 'unapplied' || (knownUnappliedCash(p) ?? 0) > 0)
      .filter((p) => !q
        || receiptNumber(p)?.toLowerCase().includes(q)
        // #781 (AC-FIN-001): the list search also indexes the resolved customer company name.
        || p.customer_name?.toLowerCase().includes(q));
  }, [all, search, searchParams, statusFilter]);

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

  const invoiceNumberOf = (invoiceId: string) => invoiceNumberById.get(invoiceId) ?? null;

  if (receiptId) {
    const record = all.find((p) => p.id === receiptId);
    if (state === 'loading') return <main className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-6"><ListState variant="loading" shape="table" rows={3} /></main>;
    if (state === 'error') {
      return (
        <main className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-6">
          <Button variant="ghost" onClick={recordContext.closeRecord} className="mb-4 -ml-3">
            <Icon name="back" className="size-4" />
            {t('uxs06.backToReceipts', 'Back to Incoming Payments')}
          </Button>
          <ListState
            variant="error"
            title={t('financeCopy.incomingPaymentsLoadFailed', "Couldn't load incoming payments")}
            onRetry={() => void refetch()}
            retryLabel={t('ui.listState.retry', 'Retry')}
          />
        </main>
      );
    }
    if (!record) {
      return (
        <main className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-6">
          <Button variant="ghost" onClick={recordContext.closeRecord} className="mb-4 -ml-3">
            <Icon name="back" className="size-4" />
            {t('uxs06.backToReceipts', 'Back to Incoming Payments')}
          </Button>
          <ListState
            variant="empty"
            icon="doc"
            title={t('uxs06.receiptNotFound', "We couldn't find this receipt")}
            sub={t('uxs06.receiptNotFoundBody', 'It may have been removed, or you may not have access to it.')}
          />
        </main>
      );
    }
    return <ReceiptRecord receipt={record} allocations={displayAllocations(record, invoiceNumberOf)} onBack={recordContext.closeRecord} odoo={odoo} />;
  }

  const notReported = t('uxs06.notReported', 'Not reported');
  const { columns, exportColumns } = receiptColumns({ t, embedded, location, invoiceNumberById, odoo });

  const rowMenu = (p: IncomingPaymentRow): RowMenuItem[] => {
    const items: RowMenuItem[] = embedded
      ? [{ label: t('finance:receivables.viewPayment', 'View payment'), onClick: () => recordContext.openRecord(p.id) }]
      : [];
    if (!odooOffline && canCancel && !p.pmo_native && p.status !== 'Paid')
      items.push({ label: t('financeCopy.cancel', "Cancel"), onClick: () => setCancelTarget(p), danger: true });
    // #784 AC-NAR-006: a PMO receipt is cancelled in PMO while PMO owns revenue (the RPC re-checks all of it).
    if (!odooOffline && canCancel && p.pmo_native && !p.cancelled_at && native)
      items.push({ label: t('financeCopy.cancel', "Cancel"), onClick: () => setCancelTarget(p), danger: true });
    return items;
  };

  const onCancelConfirm = async () => {
    if (!cancelTarget || odooOffline) return;
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

  const filtersNode = state !== 'loading' && (
          <ViewToggle<StatusFilter>
            options={statusFilters.map((f) => ({ value: f, label: incomingPaymentStatusLabel(f, t) }))}
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              trackFilterApplied('status', statusFilters.length, 'incomingPayments');
            }}
            ariaLabel={t('financeCopy.filterByStatus', "Filter by status")}
          />
        );
  const searchNode = state !== 'loading' && (
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
        );
  const exportNode = state !== 'loading' && (
          embedded && effectiveSelectedKeys.size > 0
            ? <BulkBar count={effectiveSelectedKeys.size} onClear={() => handleSelectionChange(new Set())}>
              <ExportButton
                rows={all.filter((payment) => effectiveSelectedKeys.has(payment.id))}
                columns={exportColumns}
                entity="Incoming Payments"
                label={t('finance:bulk.exportSelected', 'Export selected')}
              />
            </BulkBar>
            : <ExportButton rows={filtered} columns={exportColumns} entity="Incoming Payments" />
        );
  const exportRows = embedded && effectiveSelectedKeys.size > 0 ? all.filter((payment) => effectiveSelectedKeys.has(payment.id)) : filtered;
  const phoneToolbar = embedded && state !== 'loading' && !isDesktop ? (
    <PhoneListToolbar
      search={searchNode}
      filters={filtersNode}
      activeFilters={statusFilter === 'All' ? 0 : 1}
      menuItems={[
        { key: 'export', label: effectiveSelectedKeys.size > 0 ? t('finance:bulk.exportSelected', 'Export selected') : t('finance:receivables.exportList', 'Export'), disabled: exporting || exportRows.length === 0, onSelect: () => void exportXlsx(exportRows, exportColumns, 'Incoming Payments') },
        ...(secondaryAction ? [{ key: 'secondary', label: secondaryAction.label, onSelect: secondaryAction.onSelect }] : []),
      ]}
      selectionBar={effectiveSelectedKeys.size > 0 ? <BulkBar count={effectiveSelectedKeys.size} onClear={() => handleSelectionChange(new Set())} /> : undefined}
    />
  ) : undefined;

  return (
    <ListPage
      title={embedded ? t('finance:area.paymentsList', 'Payments received') : t('financeCopy.incomingPayments', "Incoming Payments")}
      count={data ? filtered.length : undefined}
      total={data ? all.length : undefined}
      headingLevel={embedded ? 2 : 1}
      hideHeader={embedded}
      mobileToolbar={phoneToolbar}
      filters={filtersNode}
      search={searchNode}
      exportAction={exportNode}
      desktopToolbarClassName={embedded ? '!mb-0 min-w-0 !flex-nowrap overflow-x-auto !rounded-none !border-x-0 !border-t-0 border-b !bg-transparent !px-0 py-2' : undefined}
      banner={!embedded && odooOffline ? <p role="status" className="mb-3 text-control text-muted-foreground">{t('finance:odooOutcome.offlineAction', 'Odoo is unavailable. You can still view the last data PMO read; no new changes were sent from this screen.')}</p> : undefined}
      primaryAction={!embedded && mode !== undefined && canCreate && !odooOffline ? (
        <Button variant="primary" onClick={() => { setInitialInvoiceId(undefined); setFormOpen(true); }}>
          <Icon name="plus" />
          {t('financeCopy.receivePayment', "Receive payment")}</Button>
      ) : undefined}
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
          title={t('financeCopy.noIncomingPaymentsYet', "No payments received yet")}
          sub={canCreate ? t('financeCopy.recordYourFirstPaymentReceivedFromAClient', 'Use Receive payment when a client pays.') : t('uxs26.receiptsEmptyProjectManager', 'Finance records client payments.')}
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
          rowMenu={rowMenu}
          onActivate={embedded ? openPaymentPanel : undefined}
          rowLabel={embedded ? (payment) => t('table.openRow', 'Open {{name}}', { name: receiptNumber(payment) ?? payment.customer_name ?? payment.id }) : undefined}
          mobileCardTitle={embedded ? (payment) => <span className="flex min-w-0 flex-col gap-0.5">
            <span className="min-w-0 truncate text-control font-semibold">{payment.customer_name ?? '—'}</span>
            <span className="min-w-0 truncate font-mono text-control font-normal text-muted-foreground">{receiptNumber(payment) ?? '—'}</span>
          </span> : undefined}
          mobileCardDetails={embedded ? (payment) => {
            const cancelled = displayStatus(payment) === 'Cancelled';
            const statusLabel = incomingPaymentStatusLabel(displayStatus(payment), t);
            const fallbackStatus = <StatusPill variant={cancelled ? salesInvoiceStatusVariant('Cancelled') : incomingPaymentStatusVariant(payment.status)}>{statusLabel}</StatusPill>;
            const receivedAmount = payment.received_amount ?? payment.amount;
            const total = payment.amount;
            // ponytail: wrap instead of overlap, same as the invoice cards.
            return <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                {odoo ? <OdooReceiptStatus receipt={payment} fallback={fallbackStatus} /> : fallbackStatus}
                <span className="shrink-0 text-control text-muted-foreground">{payment.date ? formatDay(payment.date) : '—'}</span>
              </div>
              <span className="shrink-0 text-right text-control tabular">
                <span>{receivedAmount == null ? '—' : formatCurrency(receivedAmount, payment.currency)}</span>
                {total != null && <span className="ml-1 text-muted-foreground">{t('finance:receivables.ofTotal', 'of {{total}}', { total: formatCurrency(total, payment.currency) })}</span>}
              </span>
            </div>;
          } : undefined}
          selection={embedded ? {
            selectedIds: effectiveSelectedKeys,
            onChange: handleSelectionChange,
            selectAllAfterFirst: true,
            rowLabel: (payment) => t('finance:table.selectRow', 'Select {{name}}', { name: receiptNumber(payment) ?? payment.customer_name ?? payment.id }),
          } : undefined}
          state={filtered.length === 0 ? 'empty' : undefined}
          emptyTitle={t('financeCopy.noPaymentsMatchYourFilters', "No payments match your filters")}
          emptySub={t('financeCopy.tryADifferentStatusOrClearTheSearch', "Try a different status or clear the search.")}
        tableId="incomingpayments-table" />
      )}

      {/* Create modal */}
      {formOpen && (
        <IncomingPaymentFormModal
          initialInvoiceId={initialInvoiceId}
          pendingPush={pendingPush}
          native={native}
          odoo={odoo}
          unreachable={odooOffline}
          onClose={() => setFormOpen(false)}
          onCreate={async (input, intent) => {
            await createPayment.mutateAsync({ ...input, intent });
            toast(t('financeCopy.paymentCreated', 'Payment created'), undefined, 'success');
            setFormOpen(false);
          }}
        />
      )}

      {/* Cancel confirm (destructive tone) */}
      <ConfirmDialog
        open={!!cancelTarget}
        tone="destructive"
        title={cancelTarget ? t('financeCopy.cancelPaymentNamed', 'Cancel {{payment}}?', { payment: receiptNumber(cancelTarget) ?? cancelTarget.id }) : t('financeCopy.cancelPaymentQuestion', 'Cancel payment?')}
        description={odooOffline
          ? t('finance:odooOutcome.offlineAction', 'Odoo is unavailable. You can still view the last data PMO read; no new changes were sent from this screen.')
          : cancelTarget?.pmo_native
          ? t('financeCopy.nativeCancelReceiptBody', "This cancels the receipt in PMO and puts its amount back on the invoice's balance.")
          : t('financeCopy.cancelPaymentDescription', "This cancels the payment in ERPNext (docstatus 1→2). The payment will be marked Cancelled and the linked invoice's outstanding amount will be restored.")}
        confirmLabel={t('financeCopy.cancelPayment', "Cancel payment")}
        loading={cancelPayment.isPending}
        confirmDisabled={odooOffline}
        onConfirm={onCancelConfirm}
        onCancel={() => setCancelTarget(null)}
      />

      {/* Apply a PMO receipt across invoices (#1415) */}
      {applyTarget && (
        <ApplyReceiptForm
          receipt={applyTarget}
          unapplied={knownUnappliedCash({ ...applyTarget, allocation_details: displayAllocations(applyTarget, invoiceNumberOf) }) ?? 0}
          invoices={invoiceList ?? []}
          onClose={() => setApplyTarget(null)}
          onApply={async (allocations, requestId) => {
            await applyReceipt.mutateAsync({ receiptId: applyTarget.id, allocations, requestId });
            toast(t('finance:receipts.apply.done', 'Payment applied'), receiptNumber(applyTarget) ?? applyTarget.id, 'success');
            setApplyTarget(null);
          }}
        />
      )}

      {/* Unapply confirm (#1415) */}
      <ConfirmDialog
        open={unapplyTarget !== null}
        tone="destructive"
        title={t('finance:receipts.unapply.confirmTitle', 'Take this payment off the invoice?')}
        description={t('finance:receipts.unapply.confirmBody', 'The amount goes back to "Not yet applied" on the payment, and {{invoice}} owes it again.', { invoice: unapplyTarget?.invoice ?? '' })}
        confirmLabel={t('finance:receipts.unapply.action', 'Unapply')}
        loading={unapplying}
        onConfirm={async () => {
          if (!unapplyTarget) return;
          setUnapplying(true);
          try {
            await unapplyAllocation.mutateAsync({ allocationId: unapplyTarget.id });
            toast(t('finance:receipts.unapply.done', 'Payment taken off the invoice'), unapplyTarget.invoice, 'success');
            setUnapplyTarget(null);
          } catch (err) {
            const { headline, detail } = classifyMutationError(err, nativeRevenueHeadlines(t));
            toast(headline, detail, 'warning');
          } finally {
            setUnapplying(false);
          }
        }}
        onCancel={() => setUnapplyTarget(null)}
      />

      <Drawer
        open={Boolean(panelPayment)}
        title={panelPayment ? t('finance:receivables.paymentDrawerTitle', '{{client}} · {{amount}}', {
          client: panelPayment.customer_name ?? t('finance:receivables.clientUnavailable', 'Client not recorded'),
          amount: panelPayment.amount == null ? '—' : formatCurrency(panelPayment.amount, panelPayment.currency),
        }) : ''}
        subtitle={panelPayment ? <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-control">{receiptNumber(panelPayment) ?? '—'}</span>
          {panelInvoice && <span className="font-mono text-control">{invoiceNumber(panelInvoice) ?? '—'}</span>}
          {panelInvoice?.project_id && projectOptions.find((project) => project.value === panelInvoice.project_id)?.contractualName && <span className="text-control">{projectOptions.find((project) => project.value === panelInvoice.project_id)?.contractualName}</span>}
        </span> : undefined}
        icon={<Icon name="dollar" />}
        status={panelPayment ? odoo
          ? <OdooReceiptStatus receipt={panelPayment} fallback={<StatusPill variant={displayStatus(panelPayment) === 'Cancelled' ? salesInvoiceStatusVariant('Cancelled') : incomingPaymentStatusVariant(panelPayment.status)}>{incomingPaymentStatusLabel(displayStatus(panelPayment), t)}</StatusPill>} />
          : <StatusPill variant={displayStatus(panelPayment) === 'Cancelled' ? salesInvoiceStatusVariant('Cancelled') : incomingPaymentStatusVariant(panelPayment.status)}>{incomingPaymentStatusLabel(displayStatus(panelPayment), t)}</StatusPill>
          : undefined}
        headerActions={panelPayment ? <>
          <Button type="button" variant="outline" size="sm" onClick={openFullPayment}>{t('finance:receivables.openFullRecord', 'Open full page')}</Button>
          <MenuButton items={rowMenu(panelPayment)} ariaLabel={t('finance:receivables.paymentActions', 'Payment actions')} />
        </> : undefined}
        onClose={closePaymentPanel}
        width="lg"
        loading={cancelPayment.isPending}
        nestedOpen={Boolean(formOpen || cancelTarget || applyTarget || unapplyTarget)}
      >
        {panelPayment && <div className="space-y-5 p-4 sm:p-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-border py-4 text-sm">
            <div><dt className="text-control text-muted-foreground">{t('finance:receivables.cash', 'Cash received')}</dt><dd className="mt-1 tabular">{panelPayment.received_amount == null ? notReported : formatCurrency(panelPayment.received_amount, panelPayment.currency, { precision: 'minor' })}</dd></div>
            <div><dt className="text-control text-muted-foreground">{t('finance:receivables.withheld', 'Tax withheld')}</dt><dd className="mt-1 tabular">{panelPayment.withheld_amount == null ? notReported : formatCurrency(panelPayment.withheld_amount, panelPayment.currency, { precision: 'minor' })}</dd></div>
            <div><dt className="text-control text-muted-foreground">{t('finance:receivables.notApplied', 'Not yet applied')}</dt><dd className="mt-1 tabular">{panelUnapplied == null ? notReported : formatCurrency(panelUnapplied, panelPayment.currency, { precision: 'minor' })}</dd></div>
            <div><dt className="text-control text-muted-foreground">{t('finance:receivables.withholdingSlip', 'Withholding slip')}</dt><dd className="mt-1 font-mono">{panelPayment.withholding_slip_number ?? '—'}</dd></div>
          </dl>
          <section aria-labelledby="receivable-payment-invoices">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 id="receivable-payment-invoices" className="text-sm font-semibold">{t('finance:receivables.settledInvoices', 'Invoices settled')}</h2>
              {canApplyHere && (panelUnapplied ?? 0) > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={() => setApplyTarget(panelPayment)}>
                  {t('finance:receipts.apply.action', 'Apply to invoices')}
                </Button>
              )}
            </div>
            {panelAllocations?.length ? <ul className="divide-y divide-border/70">
              {panelAllocations.map((allocation, index) => <li key={`${allocation.invoice_id ?? allocation.invoice_number ?? 'invoice'}-${index}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-mono">{allocation.invoice_number ?? (allocation.invoice_id ? invoiceNumberOf(allocation.invoice_id) : null) ?? '—'}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular">{allocation.amount != null && allocation.currency && Number.isFinite(Number(allocation.amount)) ? formatCurrency(Number(allocation.amount), allocation.currency, { precision: 'minor' }) : notReported}</span>
                  {canApplyHere && panelPayment.allocations?.[index] && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('finance:receipts.unapply.actionFor', 'Unapply {{invoice}}', { invoice: allocation.invoice_number })}
                      onClick={() => setUnapplyTarget({ id: panelPayment.allocations![index].id, invoice: allocation.invoice_number })}
                    >
                      {t('finance:receipts.unapply.action', 'Unapply')}
                    </Button>
                  )}
                </span>
              </li>)}
            </ul> : <p className="text-sm text-muted-foreground">{t('finance:receivables.notApplied', 'Not yet applied')}</p>}
            {!panelPayment.pmo_native && (
              <p className="mt-2 text-control text-muted-foreground">{t('finance:receivables.allocatedInErp', 'Allocated in your accounting system; read-only here.')}</p>
            )}
          </section>
        </div>}
      </Drawer>
    </ListPage>
  );
};

export default IncomingPayments;
