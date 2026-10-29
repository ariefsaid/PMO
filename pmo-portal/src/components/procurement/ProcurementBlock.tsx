import React, { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  buttonClasses,
  ConfirmDialog,
  DataTable,
  Drawer,
  Icon,
  ListState,
  MenuButton,
  StatusPill,
  Tooltip,
  useToast,
  type Column,
  type DataTableProps,
  type RowMenuItem,
  type SortState,
} from '@/src/components/ui';
import { ExportButton, useExport } from '@/src/components/export';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useProject } from '@/src/hooks/useProjects';
import { useProcurements, useProjectProcurements } from '@/src/hooks/useProcurements';
import { useProcurementDetail } from '@/src/hooks/useProcurementDetail';
import { useErpPurchases } from '@/src/hooks/useErpPurchases';
import { repositories } from '@/src/lib/repositories';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatCurrency, formatDate, formatShortMoney } from '@/src/lib/format';
import { mayDecideRoutedApproval } from '@/src/lib/procurement/approvalRoute';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { pendingProcurementApprovals } from '@/src/lib/selectors/approvals';
import {
  type ProcurementStage,
  PROCUREMENT_STAGES,
  stageForStatus,
  stageDates,
  payStepLabel,
  stageLabelForStatus,
} from '@/pages/procurement/blocks/stage';
import { procurementMoney, type ProcurementMoneyResult } from '@/pages/procurement/blocks/procurementMoney';
import { allowedActions, sortActions, stateMainAction } from '@/pages/procurement/blocks/mainAction';
import { purchaseHasValue } from '@/pages/procurement/purchaseValue';
import { useBudgetPosition } from '@/pages/project-detail/useProjectPosition';
import { matchesSearch } from '@/src/lib/procurementSearch';

/**
 * ProcurementBlockProps: omit `projectId` for the company-wide procurement index;
 * pass a project id for the project-detail slice. Both surfaces use the same list,
 * stage band, selection actions, and `?open=<id>` quick-view drawer.
 */
export interface ProcurementBlockProps {
  projectId?: string;
  /** Narrows the rows after the role scope (the route's "Needs you" tab). */
  rowFilter?: (row: ProcurementWithRefs) => boolean;
  /** Overrides the default newest-created order for route-owned work queues. */
  rowOrder?: (a: ProcurementWithRefs, b: ProcurementWithRefs) => number;
  /** False when the host page already shows "New procurement" as its primary action. */
  showCreate?: boolean;
  /** Extra filter controls the host page owns (e.g. the company list's URL filters), shown in the toolbar. */
  toolbarExtra?: React.ReactNode;
  /** Clears the host page's filters too when the user clears a zero-match table. */
  onClearFilters?: () => void;
  /** Reports the already-loaded project list count to its host tab. */
  onCountChange?: (count: number | null) => void;
}

/** Four stage tiles: a 2×2 grid on phones (nothing clipped), one row from `sm` up. */
export const ProcurementStageBand: React.FC<React.PropsWithChildren<{ label: string }>> = ({ label, children }) => (
  <section aria-label={label} className="panel-card p-1.5 sm:p-2">
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">{children}</div>
  </section>
);

export interface ProcurementListProps extends Omit<DataTableProps<ProcurementWithRefs>, 'rows' | 'columns' | 'rowKey' | 'tableId'> {
  tableId: string;
  label: string;
  rows: ProcurementWithRefs[];
  columns: Column<ProcurementWithRefs>[];
  children: React.ReactNode;
  embedded?: boolean;
  /** N7: with nothing to list at all, the empty state stands alone — no column headers over a void. */
  bareEmpty?: boolean;
}

/** Shared list surface and DataTable contract, including its controlled selection and row menu. */
export const ProcurementList: React.FC<ProcurementListProps> = ({ label, rows, columns, children, embedded = false, bareEmpty = false, tableId, ...tableProps }) => (
  <section aria-label={label} className={embedded ? 'overflow-hidden' : 'panel-card overflow-hidden'}>
    {children}
    {bareEmpty && tableProps.state === 'empty'
      ? <ListState variant="empty" title={tableProps.emptyTitle} sub={tableProps.emptySub} action={tableProps.emptyAction} />
      : <DataTable embedded rows={rows} columns={columns} rowKey={(row) => row.id} {...tableProps} className="rounded-none border-0 bg-transparent" tableId={`procurement-block-${tableId}`} />}
  </section>
);

type DecisionTarget = 'Approved' | 'Rejected' | 'Cancelled';
type PendingDecision = { rows: ProcurementWithRefs[]; target: DecisionTarget };
type CurrencyTotal = { currency: string; value: number };
type ProcurementBudgetCategory = NonNullable<ProcurementWithRefs['budget_category']>;

const TERMINAL_STATUSES: ProcurementStatus[] = ['Paid', 'Rejected', 'Cancelled'];
const UNCATEGORIZED_FILTER = '__uncategorized__';
const UNASSIGNED_FILTER = '__unassigned__';

function initials(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase() || '?';
}

function statusText(status: ProcurementStatus, t: (key: string, fallback: string) => string): string {
  const label = stageLabelForStatus(status);
  if (label === 'Invoiced, not paid') return t('projectDetail.procurement.stageBand.invoicedNotPaid', label);
  if (label === 'Paid') return t('projectDetail.procurement.stageBand.paid', label);
  // N11: Approved is green, so it carries its own name; "Request" stays the grey (in-progress) label.
  if (status === 'Approved') return t('projectDetail.procurement.stageBand.approved', 'Approved');
  if (status === 'Vendor Quoted' || status === 'Quote Selected') return stageText('Request', t);
  if (status === 'Rejected') return t('projectDetail.procurement.stage.rejected', 'Rejected');
  if (status === 'Cancelled') return t('projectDetail.procurement.stage.cancelled', 'Cancelled');
  return stageText(stageForStatus(status), t);
}

function stageText(stage: ProcurementStage | 'Invoiced' | 'Paid', t: (key: string, fallback: string) => string): string {
  switch (stage) {
    case 'Request': return t('projectDetail.procurement.stageBand.request', 'Request');
    case 'Order': return t('projectDetail.procurement.stageBand.order', 'Order');
    case 'Receive': return t('projectDetail.procurement.stageBand.receive', 'Receive');
    case 'Pay': return t('projectDetail.procurement.stageBand.pay', 'Pay');
    case 'Invoiced': return t('projectDetail.procurement.stageBand.invoiced', 'Invoiced');
    case 'Paid': return t('projectDetail.procurement.stageBand.paid', 'Paid');
  }
}

function nextStepText(
  status: ProcurementStatus,
  canApprove: boolean,
  t: (key: string, fallback: string) => string,
): string {
  if (status === 'Requested') {
    return canApprove
      ? t('projectDetail.procurement.nextStep.approveOrReturn', 'Approve or return')
      : t('projectDetail.procurement.nextStep.waitingOnApprover', 'Waiting on approver');
  }
  switch (status) {
    case 'Draft': return t('projectDetail.procurement.nextStep.draft', 'Submit for approval');
    case 'Approved': return t('projectDetail.procurement.nextStep.approved', 'Get quotes or order');
    case 'Vendor Quoted': return t('projectDetail.procurement.nextStep.gettingQuotes', 'Choose a quote');
    case 'Quote Selected': return t('projectDetail.procurement.nextStep.quoteChosen', 'Raise the order');
    case 'Ordered': return t('projectDetail.procurement.nextStep.ordered', 'Record delivery');
    case 'Received': return t('projectDetail.procurement.nextStep.delivered', 'Record supplier invoice');
    case 'Vendor Invoiced': return t('projectDetail.procurement.nextStep.supplierInvoiced', 'Pay');
    default: return t('projectDetail.procurement.noNextStep', '—');
  }
}

function moneyFor(row: ProcurementWithRefs, erpDocuments: ReturnType<typeof useErpPurchases>['data'] = []) {
  return procurementMoney({
    total_value: row.total_value,
    purchase_requests: row.purchase_requests,
    purchase_orders: row.purchase_orders,
    procurement_invoices: row.procurement_invoices,
    payments: row.payments,
    erpDocuments: (erpDocuments ?? [])
      .filter((document) => document.procurementId === row.id)
      .map((document) => ({ doctype: document.doctype, grand_total: document.grandTotal, outstanding_amount: document.outstanding })),
  });
}

function datesFor(row: ProcurementWithRefs, erpDocuments: ReturnType<typeof useErpPurchases>['data'] = []) {
  const linked = (erpDocuments ?? [])
    .filter((document) => document.procurementId === row.id)
    .map((document) => ({ doctype: document.doctype, docDate: document.docDate }));
  return stageDates({
    purchase_requests: row.purchase_requests,
    purchase_orders: row.purchase_orders,
    receipts: row.receipts,
    invoices: row.procurement_invoices,
    payments: (row.payments ?? []).filter((payment) => payment.status === 'Paid'),
  }, linked);
}

function ageInCurrentStage(row: ProcurementWithRefs, erpDocuments: ReturnType<typeof useErpPurchases>['data'] = []): number {
  const stage = stageForStatus(row.status);
  const dates = datesFor(row, erpDocuments);
  const stageStatuses: Record<typeof stage, ProcurementStatus[]> = {
    Request: row.status === 'Draft' ? [] : [row.status],
    Order: ['Ordered'],
    Receive: ['Received'],
    Pay: ['Vendor Invoiced', 'Paid'],
  };
  const lastStageEvent = (row.status_events ?? [])
    .filter((event) => stageStatuses[stage].includes(event.to_status))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.created_at;
  const stageDate = lastStageEvent ?? (stage === 'Request' ? dates.request
    : stage === 'Order' ? dates.order
      : stage === 'Receive' ? dates.receive
        : dates.pay);
  const entered = stageDate ? new Date(stageDate).getTime() : new Date(row.created_at).getTime();
  if (!Number.isFinite(entered)) return 0;
  return Math.max(0, Math.floor((Date.now() - entered) / 86_400_000));
}

function moneyBasisText(kind: NonNullable<ReturnType<typeof moneyFor>['mostReal']>['kind'], t: (key: string, fallback: string) => string): string {
  switch (kind) {
    case 'paid': return t('procurement.moneyBasis.paid', 'Paid');
    case 'invoiced': return t('procurement.moneyBasis.invoiced', 'Invoiced');
    case 'ordered': return t('procurement.moneyBasis.ordered', 'Ordered');
    case 'requested': return t('procurement.moneyBasis.requested', 'Requested');
  }
}

function unpaidVisibleToRole(role: string | null | undefined): boolean {
  return role === 'Finance' || role === 'Admin';
}

/** The unpaid balance said once: never the shown amount again, never an unknown balance as a figure. */
function unpaidText(money: ProcurementMoneyResult, currency: string, t: (key: string, fallback: string, options?: Record<string, unknown>) => string): string | null {
  if (money.unpaid.unknown) return t('procurement.unpaidUnknown', 'Unpaid balance not recorded');
  const unpaid = money.unpaid.amount;
  if (unpaid === null || unpaid <= 0) return null;
  if (money.mostReal && unpaid === money.mostReal.amount) return t('procurement.unpaidInFull', 'Unpaid in full');
  return t('procurement.unpaidLine', 'Unpaid {{amount}}', { amount: formatCurrency(unpaid, currency) });
}

function stageTotals(
  rows: ProcurementWithRefs[],
  canSeeMoney: boolean,
  erpDocuments: ReturnType<typeof useErpPurchases>['data'],
  defaultCurrency?: string | null,
): Map<ProcurementStage, CurrencyTotal[]> {
  const values = new Map<ProcurementStage, Map<string, number>>();
  for (const stage of PROCUREMENT_STAGES) values.set(stage, new Map());
  for (const row of rows) {
    const stage = stageForStatus(row.status);
    if (!canSeeMoney) continue;
    const amount = moneyFor(row, erpDocuments).mostReal?.amount;
    if (amount === undefined) continue;
    const currency = row.currency || '—';
    const currencyTotals = values.get(stage)!;
    currencyTotals.set(currency, (currencyTotals.get(currency) ?? 0) + amount);
  }
  return new Map([...values].map(([stage, currencyTotals]) => {
    if (canSeeMoney && currencyTotals.size === 0 && defaultCurrency) currencyTotals.set(defaultCurrency, 0);
    return [stage, [...currencyTotals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, value]) => ({ currency, value }))];
  }));
}

function recordDocuments(detail: ProcurementDetail, t: (key: string, fallback: string) => string) {
  return [
    { label: t('projectDetail.procurement.document.purchaseRequest', 'Purchase request'), references: detail.purchase_requests.map((row) => row.pr_number ?? row.reference_number ?? row.external_ref) },
    { label: t('projectDetail.procurement.document.quotation', 'Quotation'), references: detail.quotations.map((row) => row.vq_number ?? row.reference) },
    { label: t('projectDetail.procurement.document.purchaseOrder', 'Purchase order'), references: detail.purchase_orders.map((row) => row.po_number ?? row.reference_number ?? row.external_ref) },
    { label: t('projectDetail.procurement.document.receipt', 'Receipt'), references: detail.receipts.map((row) => row.gr_number ?? row.reference_number) },
    { label: t('projectDetail.procurement.document.supplierInvoice', 'Supplier invoice'), references: detail.invoices.map((row) => row.vi_number ?? row.reference_number ?? row.external_ref) },
    { label: t('projectDetail.procurement.document.payment', 'Payment'), references: detail.payments.map((row) => row.pay_number ?? row.reference_number) },
  ].filter((document) => document.references.some(Boolean));
}

function ProcurementBudgetLeft({
  project,
  row,
  amount,
  t,
}: {
  project: NonNullable<ReturnType<typeof useProject>['data']>;
  row: ProcurementWithRefs;
  amount: number;
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string;
}) {
  const position = useBudgetPosition(project);
  const category = row.budget_category;
  const categoryPosition = position.rows.find((item) => item.category === category);
  const available = Boolean(
    categoryPosition && position.hasBudget && categoryPosition.actual !== null && row.currency === project.currency,
  );
  const left = available
    ? categoryPosition!.budget - categoryPosition!.actual! - amount
    : null;
  const source = t(
    'projectDetail.procurement.detail.budgetLeftTooltip',
    'Active category budget minus mapped actual spending and this procurement value. Source: the active budget and project spending.',
  );
  const loading = position.isPending || position.actualsPending;
  // C4: an unknown category position is left out, never shown as a value.
  if (!loading && left === null) return null;
  const shown = loading
    ? t('projectDetail.procurement.detail.budgetLoading', 'Loading budget…')
    : formatCurrency(left!, project.currency);

  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">
        {t('projectDetail.procurement.detail.budgetLeft', 'Budget left in category')}
      </div>
      <Tooltip content={source}>
        <span tabIndex={0} className="inline-flex rounded-sm text-sm font-medium tabular focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          {shown}
        </span>
      </Tooltip>
    </div>
  );
}

export const ProcurementBlock: React.FC<ProcurementBlockProps> = ({ projectId, rowFilter, rowOrder, showCreate = true, toolbarExtra, onClearFilters, onCountChange }) => {
  const { t } = useTranslation('procurement');
  // The state main action reuses the record page's labels, which live in the common catalogue.
  const { t: tCommon } = useTranslation();
  const { currentUser, role } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const may = usePermission();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { exportXlsx, busy: exportBusy } = useExport();
  const companyQuery = useProcurements({ withRefs: true, withSharedDetails: true, enabled: !projectId });
  const projectQuery = useProjectProcurements(projectId);
  const procurementQuery = projectId ? projectQuery : companyQuery;
  const { data, isPending, isError, refetch } = procurementQuery;
  React.useEffect(() => {
    onCountChange?.(isPending || isError || data == null ? null : data.length);
  }, [data, isError, isPending, onCountChange]);
  const ownScoped = !projectId && role === 'Engineer';
  const scopedRows = useMemo(() => (data ?? []).filter((row) => !ownScoped || row.requested_by_id === currentUser?.id),
    [data, ownScoped, currentUser?.id]);
  const rows = useMemo(() => scopedRows
    .filter((row) => !rowFilter || rowFilter(row))
    .sort(rowOrder ?? ((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())),
  [scopedRows, rowFilter, rowOrder]);
  const canSeeMoney = may('view', 'procurement');
  const canApprove = may('transition', 'procurement');
  const canCreate = may('create', 'procurement');
  const canAttachDocument = may('create', 'procDoc');
  const canDecideRow = useCallback((row: ProcurementWithRefs) => canApprove &&
    pendingProcurementApprovals([row], currentUser?.id, role === 'Admin').length > 0,
  [canApprove, currentUser?.id, role]);
  const erp = useErpPurchases(projectId, { enabled: canSeeMoney });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectedStage, setSelectedStage] = useState<ProcurementStage | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [sort, setSort] = useState<SortState>();
  const [pendingDecision, setPendingDecision] = useState<PendingDecision | null>(null);
  const openId = searchParams.get('open');
  // A shared ?open= link opens its record even when the current tab or filter hides the row.
  const selected = scopedRows.find((row) => row.id === openId) ?? null;
  const expandedRow = rows.find((row) => row.id === expandedId) ?? null;
  const focusRow = selected ?? expandedRow;
  const { data: project } = useProject(projectId ?? focusRow?.project_id ?? undefined);
  const detailQuery = useProcurementDetail(selected?.id ?? expandedId ?? undefined);
  const setSelected = useCallback((row: ProcurementWithRefs | null) => {
    if (row) setExpandedId(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (row) next.set('open', row.id);
      else next.delete('open');
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const transition = useMutation({
    mutationFn: ({ id, to }: { id: string; to: ProcurementStatus }) => repositories.procurement.transition(id, to),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['procurements'] });
      void queryClient.invalidateQueries({ queryKey: ['procurement'] });
    },
  });

  const categoryLabel = useCallback((category: string | null) => category
    ? budgetCategoryLabel(category, t)
    : t('projectDetail.procurement.uncategorized', 'Uncategorized'), [t]);
  const categories = useMemo(() => [...new Set(rows.map((row) => row.budget_category).filter((value): value is ProcurementBudgetCategory => value !== null))]
    .sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b))), [rows, categoryLabel]);
  const owners = useMemo(() => [...new Map(rows.filter((row) => row.requested_by_id).map((row) => [
    row.requested_by_id!,
    row.requested_by?.full_name ?? t('projectDetail.procurement.unassigned', 'Unassigned'),
  ])).entries()].sort(([, a], [, b]) => a.localeCompare(b)), [rows, t]);

  const filteredRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (selectedStage && stageForStatus(row.status) !== selectedStage) return false;
      if (categoryFilter === UNCATEGORIZED_FILTER && row.budget_category) return false;
      if (categoryFilter && categoryFilter !== UNCATEGORIZED_FILTER && row.budget_category !== categoryFilter) return false;
      if (ownerFilter === UNASSIGNED_FILTER && row.requested_by_id) return false;
      if (ownerFilter && ownerFilter !== UNASSIGNED_FILTER && row.requested_by_id !== ownerFilter) return false;
        return matchesSearch(row, search);
    });
    if (!sort) return filtered;
    const direction = sort.dir === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      let comparison: number;
      switch (sort.key) {
        case 'title': comparison = a.title.localeCompare(b.title); break;
        case 'category': comparison = categoryLabel(a.budget_category).localeCompare(categoryLabel(b.budget_category)); break;
        case 'value': comparison = (moneyFor(a, erp.data).mostReal?.amount ?? 0) - (moneyFor(b, erp.data).mostReal?.amount ?? 0); break;
        case 'stage': comparison = statusText(a.status, t).localeCompare(statusText(b.status, t)); break;
        case 'age': comparison = ageInCurrentStage(a, erp.data) - ageInCurrentStage(b, erp.data); break;
        case 'owner': comparison = (a.requested_by?.full_name ?? '').localeCompare(b.requested_by?.full_name ?? ''); break;
        default: comparison = a.updated_at.localeCompare(b.updated_at);
      }
      return comparison * direction;
    });
  }, [rows, selectedStage, categoryFilter, ownerFilter, search, sort, t, categoryLabel, erp.data]);

  const selectedRows = rows.filter((row) => selectedIds.has(row.id));
  const visibleIds = filteredRows.map((row) => row.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const projectCurrency = project?.currency ?? rows[0]?.currency ?? null;
  const totalsByStage = useMemo(() => stageTotals(rows, canSeeMoney, erp.data, projectCurrency), [rows, canSeeMoney, erp.data, projectCurrency]);

  const toggleVisibleSelection = () => setSelectedIds((current) => {
    const next = new Set(current);
    if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
    else visibleIds.forEach((id) => next.add(id));
    return next;
  });

  const runTransition = async (targets: ProcurementWithRefs[], to: DecisionTarget) => {
    const results = await Promise.allSettled(targets.map((row) => transition.mutateAsync({ id: row.id, to })));
    const failedIds = targets.filter((_row, index) => results[index].status === 'rejected').map((row) => row.id);
    const successCount = targets.length - failedIds.length;
    setSelectedIds((current) => new Set([...current].filter((id) => failedIds.includes(id))));
    if (successCount > 0 && failedIds.length === 0) {
      toast(
        to === 'Approved'
          ? t('projectDetail.procurement.toast.approved', 'Procurement approved')
          : to === 'Rejected'
            ? t('projectDetail.procurement.toast.returned', 'Procurement returned')
            : t('projectDetail.procurement.toast.cancelled', 'Procurement cancelled'),
        targets.length > 1
          ? t('projectDetail.procurement.toast.completedMany', '{{count}} records updated.', { count: successCount })
          : targets[0]?.title,
        'success',
      );
      return;
    }
    if (failedIds.length > 0) {
      const firstFailure = results.find((result) => result.status === 'rejected');
      const error = firstFailure?.status === 'rejected' ? firstFailure.reason : undefined;
      const classified = classifyMutationError(error);
      toast(
        successCount > 0
          ? t('projectDetail.procurement.toast.partial', 'Some records were updated')
          : classified.headline,
        t('projectDetail.procurement.toast.partialDetail', '{{updated}} updated; {{failed}} need review.', {
          updated: successCount,
          failed: failedIds.length,
        }),
        'warning',
      );
    }
  };

  const decide = (rowsToChange: ProcurementWithRefs[], target: DecisionTarget) => {
    if (rowsToChange.length === 0) return;
    // Write policy (OD-UX-1): Approve is a money decision, so it confirms against the amount, as on the record page.
    setPendingDecision({ rows: rowsToChange, target });
  };

  const openFullRecord = (row: ProcurementWithRefs) => navigate(`/procurement/${row.id}`);
  const attachDocument = (row: ProcurementWithRefs) => navigate(`/procurement/${row.id}/documents`);
  const copyRecordLink = async (row: ProcurementWithRefs) => {
    const href = `${window.location.origin}/procurement/${row.id}`;
    try {
      await navigator.clipboard.writeText(href);
      toast(t('projectDetail.procurement.toast.linkCopied', 'Link copied'), row.title, 'success');
    } catch {
      toast(t('projectDetail.procurement.toast.linkCopyFailed', 'Could not copy link'), href, 'warning');
    }
  };

  /** Row actions; inside the drawer the header already shows Open full page and the main action. */
  const rowMenu = (row: ProcurementWithRefs, inDrawer = false): RowMenuItem[] => {
    const items: RowMenuItem[] = inDrawer ? [] : [
      { label: t('projectDetail.procurement.rowMenu.open', 'Open procurement'), onClick: () => openFullRecord(row) },
    ];
    items.push({ label: t('procurement.rowMenu.recordDocument', 'Record another document'), onClick: () => openFullRecord(row) });
    if (canDecideRow(row)) {
      if (!inDrawer) items.push({ label: t('projectDetail.procurement.rowMenu.approve', 'Approve'), onClick: () => decide([row], 'Approved') });
      items.push({ label: t('projectDetail.procurement.rowMenu.return', 'Return'), onClick: () => decide([row], 'Rejected') });
    }
    if (canAttachDocument) {
      items.push({ label: t('procurement.rowMenu.linkFile', 'Link a file'), onClick: () => attachDocument(row) });
    }
    items.push({
      label: t('procurement.rowMenu.export', 'Export'),
      onClick: () => { void exportXlsx([row], exportColumns, t('projectDetail.procurement.exportEntity', 'Procurement')); },
      disabled: exportBusy,
    });
    items.push({ label: t('projectDetail.procurement.rowMenu.copyLink', 'Copy link'), onClick: () => { void copyRecordLink(row); } });
    if (canApprove && !TERMINAL_STATUSES.includes(row.status)) {
      items.push({
        label: t('projectDetail.procurement.rowMenu.cancel', 'Cancel procurement'),
        onClick: () => decide([row], 'Cancelled'),
        danger: true,
      });
    }
    return items;
  };

  const stageDateTooltip = useCallback((row: ProcurementWithRefs) => {
    const dates = datesFor(row, erp.data);
    const steps = [
      { key: 'Request' as const, date: dates.request },
      { key: 'Order' as const, date: dates.order },
      { key: 'Receive' as const, date: dates.receive },
      { key: payStepLabel(Boolean(row.payments?.some((payment) => payment.status === 'Paid')) || (erp.data ?? []).some((document) => document.procurementId === row.id && document.doctype === 'Payment Entry')), date: dates.pay },
    ];
    const done = steps.filter((step) => step.date);
    if (done.length === 0) return t('procurement.noStepDates', 'No step dates recorded yet.');
    return (
      <div className="space-y-1">
        {done.map((step) => (
          <div key={step.key} className="flex justify-between gap-4">
            <span>{stageText(step.key, t)}</span><span>{formatDate(step.date)}</span>
          </div>
        ))}
      </div>
    );
  }, [t, erp.data]);

  /** One amount per row; the unpaid balance remains available in its tooltip. */
  const rowAmount = useCallback((row: ProcurementWithRefs, inline = false) => {
    const money = moneyFor(row, erp.data);
    const amount = money.mostReal?.amount;
    const unpaid = unpaidVisibleToRole(role) ? unpaidText(money, row.currency, t) : null;
    const tip = [
      t('procurement.moneyTooltip', 'Most recorded amount: paid, invoiced, ordered, then requested. Source: procurement records.'),
      unpaid ? `${unpaid}. ${t('procurement.unpaidTooltip', 'Invoice amount less recorded payments, or the ERP outstanding balance.')}` : null,
    ].filter(Boolean).join(' ');
    if (amount === undefined) return <span className="text-xs text-muted-foreground">{t('procurement.moneyUnknown', 'Not recorded')}</span>;
    return (
      <span className={inline ? 'inline-flex items-baseline gap-1.5' : 'block space-y-0.5 text-right'}>
        <Tooltip content={tip}>
          <span tabIndex={0} className="rounded-sm font-medium tabular focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            {formatCurrency(amount, row.currency)}
          </span>
        </Tooltip>
        <span className={inline ? 'text-xs text-muted-foreground' : 'block text-xs text-muted-foreground'}>{moneyBasisText(money.mostReal!.kind, t)}</span>
      </span>
    );
  }, [erp.data, role, t]);

  const columns = useMemo<Column<ProcurementWithRefs>[]>(() => {
    const valueColumn: Column<ProcurementWithRefs> = {
      key: 'value',
      header: <Tooltip content={t('procurement.moneyTooltip', 'Most recorded amount: paid, invoiced, ordered, then requested. Source: procurement records.')}><span tabIndex={0}>{t('projectDetail.procurement.table.value', 'Value')}</span></Tooltip>,
      kind: 'money',
      align: 'num',
      size: 120,
      minSize: 105,
      sortKey: 'value',
      cell: (row) => rowAmount(row),
      exportValue: (row) => moneyFor(row, erp.data).mostReal?.amount ?? '',
    };
    const settlementColumn: Column<ProcurementWithRefs> = {
      key: 'settlement',
      header: <Tooltip content={t('procurement.settlementTooltip', 'Recorded paid amount compared with recorded invoices.')}><span tabIndex={0}>{t('procurement.settlement', 'Paid / invoiced')}</span></Tooltip>,
      kind: 'text',
      size: 134,
      minSize: 126,
      cell: (row) => {
        const money = moneyFor(row, erp.data);
        if (money.invoiced.unknown || money.paid.unknown || !money.invoiced.amount) return <span className="text-muted-foreground">—</span>;
        const paid = money.paid.amount ?? 0;
        const percent = Math.max(0, Math.min(100, (paid / money.invoiced.amount) * 100));
        return (
          <Tooltip content={t('procurement.settlementTooltip', 'Recorded paid amount compared with recorded invoices.')}>
            <span tabIndex={0} className="inline-flex min-w-0 w-full items-center gap-1.5 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
              <span aria-hidden="true" className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-secondary"><span className={`block h-full ${percent >= 100 ? 'bg-success' : 'bg-primary'}`} style={{ width: `${percent}%` }} /></span>
              <span className="shrink-0 text-xs tabular text-muted-foreground" title={`${formatCurrency(paid, row.currency)} / ${formatCurrency(money.invoiced.amount, row.currency)}`}>
                {percent}%
              </span>
            </span>
          </Tooltip>
        );
      },
      exportValue: (row) => {
        const money = moneyFor(row, erp.data);
        return money.invoiced.unknown || money.paid.unknown ? '' : `${money.paid.amount ?? 0} / ${money.invoiced.amount ?? 0}`;
      },
    };
    const tableColumns: Column<ProcurementWithRefs>[] = [
      {
        key: 'procurement',
        header: t('projectDetail.procurement.table.procurement', 'Procurement'),
        kind: 'text',
        rowHeader: true,
        size: 280,
        minSize: 220,
        sortKey: 'title',
        cell: (row) => {
          const isExpanded = expandedId === row.id;
          const rowMoney = moneyFor(row, erp.data);
          const rowValue = rowMoney.mostReal?.amount ?? Number(row.total_value ?? 0);
          const items = detailQuery.data?.id === row.id ? detailQuery.data.items : [];
          return (
            <div className="min-w-0 space-y-2">
              <div className="flex min-w-0 items-start gap-1">
                <button type="button" aria-label={t('table.openRow', 'Open {{name}}', { name: row.title })} onClick={() => setSelected(row)} title={row.title} className="min-w-0 line-clamp-2 break-words text-left font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                  {row.title}
                </button>
                <button type="button" aria-expanded={isExpanded} aria-label={t(isExpanded ? 'procurement.collapseDetails' : 'procurement.expandDetails', isExpanded ? 'Collapse procurement details' : 'Expand procurement details')}
                  onClick={() => setExpandedId(isExpanded ? null : row.id)}
                  className="shrink-0 rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                  <Icon name="chev" className={`size-3.5 transition-transform duration-100 motion-reduce:transition-none ${isExpanded ? '-rotate-90' : 'rotate-90'}`} />
                </button>
              </div>
              <span className="block line-clamp-2 break-words text-xs text-muted-foreground">
                <span className="font-mono">{row.code ?? row.id.slice(0, 8)}</span> · {row.vendor?.name ?? t('projectDetail.procurement.noSupplier', 'No supplier')}
              </span>
              {isExpanded && (
                <div className="space-y-2 border-t border-border/70 pt-2 text-xs" onClick={(event) => event.stopPropagation()}>
                  <div><span className="text-muted-foreground">{t('procurement.nextStepLabel', 'Next step')}: </span>{nextStepText(row.status, canDecideRow(row), t)}</div>
                  {canSeeMoney && project && <ProcurementBudgetLeft project={project} row={row} amount={rowValue} t={t} />}
                  <div>
                    <div className="mb-1 font-medium">{t('procurement.lineItems', 'Line items')}</div>
                    {detailQuery.isPending && <span className="text-muted-foreground">{t('common.loading', 'Loading…')}</span>}
                    {detailQuery.isError && <span className="text-muted-foreground">{t('procurement.lineItemsUnavailable', 'Line items could not be loaded.')}</span>}
                    {!detailQuery.isPending && !detailQuery.isError && items.length > 0 ? (
                      <ul className="space-y-1">
                        {items.map((item) => <li key={item.id}>{item.name}{item.description ? ` · ${item.description}` : ''} · {item.quantity}</li>)}
                      </ul>
                    ) : !detailQuery.isPending && !detailQuery.isError ? (
                      <span className="text-muted-foreground">{t('procurement.noLineItems', 'No line items recorded.')}</span>
                    ) : null}
                  </div>
                  <button type="button" onClick={() => setSelected(row)} className="font-medium text-primary-text underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{t('procurement.openDrawer', 'Open procurement')}</button>
                </div>
              )}
            </div>
          );
        },
        exportValue: (row) => row.title,
      },
      {
        key: 'category',
        header: t('projectDetail.procurement.table.category', 'Category'),
        kind: 'text',
        size: 110,
        minSize: 100,
        sortKey: 'category',
        cell: (row) => categoryLabel(row.budget_category),
        exportValue: (row) => categoryLabel(row.budget_category),
      },
      ...(canSeeMoney ? [valueColumn] : []),
      ...(canSeeMoney ? [settlementColumn] : []),
      {
        key: 'stage',
        header: t('projectDetail.procurement.table.stage', 'Stage'),
        kind: 'status',
        size: 120,
        minSize: 112,
        sortKey: 'stage',
        cell: (row) => (
          <Tooltip content={stageDateTooltip(row)}>
            <span tabIndex={0} className="inline-flex rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
              <StatusPill variant={workflowVariant(row.status)}>{statusText(row.status, t)}</StatusPill>
            </span>
          </Tooltip>
        ),
        exportValue: (row) => statusText(row.status, t),
      },
      {
        key: 'next-step',
        header: t('projectDetail.procurement.table.nextStep', 'Next step'),
        kind: 'text',
        size: 125,
        minSize: 105,
        cell: (row) => {
          const next = nextStepText(row.status, canDecideRow(row), t);
          return <Tooltip content={next}><span title={next} className={`block min-w-0 w-full max-w-full truncate ${row.status === 'Requested' && canDecideRow(row) ? 'font-medium text-primary-text' : 'text-muted-foreground'}`}>{next}</span></Tooltip>;
        },
        exportValue: (row) => nextStepText(row.status, canDecideRow(row), t),
      },
      {
        key: 'age',
        header: <Tooltip content={t('procurement.ageInStageTooltip', 'Days since the current procurement stage was most recently entered.')}><span tabIndex={0}>{t('procurement.ageShort', 'Age')}</span></Tooltip>,
        kind: 'number',
        colClassName: projectId ? 'hidden' : undefined,
        align: 'num',
        size: 100,
        minSize: 68,
        sortKey: 'age',
        cell: (row) => {
          const days = ageInCurrentStage(row, erp.data);
          return (
            <Tooltip content={t('procurement.ageInStageTooltip', 'Days since the current procurement stage was most recently entered.')}>
              <span tabIndex={0} className={`rounded-sm tabular focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${days > 30 && row.status !== 'Paid' ? 'text-warning-foreground' : 'text-muted-foreground'}`}>
                {t('procurement.ageInStageDays', '{{count}}d', { count: days })}
              </span>
            </Tooltip>
          );
        },
        exportValue: (row) => ageInCurrentStage(row, erp.data),
      },
      {
        key: 'owner',
        header: t('procurement.raisedBy', 'Raised by'),
        kind: 'text',
        colClassName: projectId ? 'hidden' : undefined,
        size: 150,
        minSize: 105,
        sortKey: 'owner',
        cell: (row) => {
          const owner = row.requested_by?.full_name ?? t('projectDetail.procurement.unassigned', 'Unassigned');
          return (
            <Tooltip content={t('projectDetail.procurement.ownerTooltip', 'Requested by {{name}}. Source: procurement record.', { name: owner })}>
              <span tabIndex={0} className="inline-flex max-w-full items-center gap-2 rounded-sm text-[12px] text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-bold text-foreground">{initials(owner)}</span>
                <span className="truncate">{owner}</span>
              </span>
            </Tooltip>
          );
        },
        exportValue: (row) => row.requested_by?.full_name ?? '',
      },
    ];
    return tableColumns;
  }, [canSeeMoney, t, categoryLabel, canDecideRow, stageDateTooltip, erp.data, expandedId, detailQuery.data, detailQuery.isError, detailQuery.isPending, project, projectId, setSelected, rowAmount]);

  const exportColumns = columns;
  const selectedForExport = selectedRows;
  const onSort = (key: string) => setSort((current) => ({
    key,
    dir: current?.key === key && current.dir === 'asc' ? 'desc' : 'asc',
  }));

  const heading = t('projectDetail.procurement.title', 'Procurement');
  const hasUnfilteredRows = rows.length > 0;
  const hasVisibleErpPurchases = canSeeMoney && (
    erp.isError || (erp.data ?? []).some((row) => row.procurementId === null || Number(row.outstanding ?? 0) > 0)
  );
  const globalErrorSub = projectId
    ? t('projectDetail.procurement.error.sub', "Something went wrong fetching this project's procurement.")
    : t('procurement.error.sub', 'Something went wrong fetching procurement.');

  const runDecisionFromDialog = () => {
    if (!pendingDecision) return;
    const decision = pendingDecision;
    setPendingDecision(null);
    void runTransition(decision.rows, decision.target);
  };

  const drawerDetails = detailQuery.data;
  const documents = drawerDetails ? recordDocuments(drawerDetails, t) : [];
  const drawerErpDocuments = (erp.data ?? []).filter((document) => document.procurementId === selected?.id);
  const drawerMoney = selected ? procurementMoney({
    total_value: selected.total_value,
    purchase_requests: drawerDetails?.purchase_requests ?? selected.purchase_requests,
    purchase_orders: drawerDetails?.purchase_orders ?? selected.purchase_orders,
    procurement_invoices: drawerDetails?.invoices ?? selected.procurement_invoices,
    payments: (drawerDetails?.payments ?? selected.payments ?? []).filter((payment) => payment.status === 'Paid'),
    erpDocuments: drawerErpDocuments.map((document) => ({ doctype: document.doctype, grand_total: document.grandTotal, outstanding_amount: document.outstanding })),
  }) : null;
  const dates = selected ? stageDates({
    purchase_requests: drawerDetails?.purchase_requests ?? selected.purchase_requests,
    purchase_orders: drawerDetails?.purchase_orders ?? selected.purchase_orders,
    receipts: drawerDetails?.receipts ?? selected.receipts,
    invoices: drawerDetails?.invoices ?? selected.procurement_invoices,
    payments: drawerDetails?.payments ?? selected.payments,
  }, drawerErpDocuments.map((document) => ({ doctype: document.doctype, docDate: document.docDate }))) : null;
  const hasPayment = Boolean((drawerDetails?.payments ?? selected?.payments ?? []).some((payment) => payment.status === 'Paid'))
    || drawerErpDocuments.some((document) => document.doctype === 'Payment Entry');
  const paymentDate = (drawerDetails?.payments ?? selected?.payments ?? [])
    .filter((payment) => payment.status === 'Paid')
    .map((payment) => payment.date ?? payment.created_at)
    .filter((date): date is string => Boolean(date))
    .sort()[0]
    ?? drawerErpDocuments.filter((document) => document.doctype === 'Payment Entry').map((document) => document.docDate).filter((date): date is string => Boolean(date)).sort()[0]
    ?? null;
  const invoiceDate = (drawerDetails?.invoices ?? selected?.procurement_invoices ?? [])
    .map((invoice) => invoice.invoice_date ?? invoice.created_at)
    .filter((date): date is string => Boolean(date))
    .sort()[0]
    ?? drawerErpDocuments.filter((document) => document.doctype === 'Purchase Invoice').map((document) => document.docDate).filter((date): date is string => Boolean(date)).sort()[0]
    ?? null;
  // L12: the Request step is dated by its purchase request document, the same source the record page reads.
  const timeline = selected ? [
    { key: 'Request' as const, date: dates?.request ?? null },
    { key: 'Order' as const, date: dates?.order ?? null },
    { key: 'Receive' as const, date: dates?.receive ?? null },
    { key: payStepLabel(hasPayment), date: hasPayment ? paymentDate : invoiceDate },
  ] : [];
  // B4: the drawer offers the record page's own main action for this state and viewer.
  const drawerDetailLoaded = Boolean(selected && drawerDetails && drawerDetails.id === selected.id);
  const drawerMain = selected && drawerDetails && drawerDetailLoaded ? stateMainAction(
    drawerDetails.status,
    sortActions(allowedActions(
      drawerDetails.status,
      role ?? '',
      drawerDetails.requested_by_id === currentUser?.id,
      Boolean(currentUser?.id) && drawerDetails.approved_by_id === currentUser?.id,
      tCommon,
      mayDecideRoutedApproval(drawerDetails.approvalRoute ?? selected.approvalRoute, currentUser?.id, role === 'Admin'),
      (drawerDetails.payments?.length ?? 0) > 0,
      purchaseHasValue(drawerDetails),
    )),
    tCommon,
  ) : undefined;
  const runDrawerMain = () => {
    if (!selected || !drawerMain) return;
    if (drawerMain.transition.to === 'Approved') {
      decide([selected], 'Approved');
      return;
    }
    // The record page starts the same step on arrival (router state, so a shared link never starts it).
    navigate(`/procurement/${selected.id}`, { state: { runMainAction: drawerMain.transition.to } });
  };
  const drawerUnpaid = selected && drawerMoney && unpaidVisibleToRole(role) ? unpaidText(drawerMoney, selected.currency, t) : null;
  const stageStats = PROCUREMENT_STAGES.map((key) => {
    const stageRows = rows.filter((row) => stageForStatus(row.status) === key);
    return { key, rows: stageRows, currencyTotals: totalsByStage.get(key) ?? [] };
  });
  const moneyTooltip = t(
    'procurement.moneyTooltip',
    'Most recorded amount: paid, invoiced, ordered, then requested. Source: procurement records.',
  );

  return (
    <div className="space-y-4">
      {isPending ? (
        <div className={projectId ? undefined : 'rounded-lg border border-border bg-card'}><ListState variant="loading" rows={3} /></div>
      ) : !isError && data && (
        <ProcurementStageBand label={t('projectDetail.procurement.stageBand.label', 'Procurement stages')}>
          {stageStats.map(({ key, rows: stageRows, currencyTotals }) => {
            const stageLabel = stageText(key, t);
            const forYou = key === 'Request' && canApprove
              ? pendingProcurementApprovals(stageRows, currentUser?.id, role === 'Admin').length
              : 0;
            const countTooltip = projectId
              ? t('projectDetail.procurement.stageCountTooltip', 'Count of procurements currently in {{stage}}. Source: project procurement records.', { stage: stageLabel })
              : t('procurement.stageCountTooltip', 'Count of procurements currently in {{stage}}. Source: company procurement records.', { stage: stageLabel });
            const source = canSeeMoney ? `${countTooltip} ${moneyTooltip}` : countTooltip;
            return (
              <Tooltip key={key} content={source} block>
                <button
                  type="button"
                  aria-pressed={selectedStage === key}
                  onClick={() => setSelectedStage((current) => current === key ? null : key)}
                  className={`flex min-h-[68px] w-full min-w-0 flex-col items-start justify-center rounded-md border px-3 py-2 text-left transition-colors focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${selectedStage === key ? 'border-primary bg-accent ring-1 ring-primary/30' : 'border-border bg-card hover:bg-accent/40'}`}
                >
                  <span className="flex w-full min-w-0 items-center justify-between gap-1 text-xs font-semibold text-muted-foreground">
                    <span className="truncate">{stageLabel}</span>
                    {forYou > 0 && <span className="shrink-0 font-medium text-primary-text">{t('projectDetail.procurement.forYou', '{{count}} for you', { count: forYou })}</span>}
                  </span>
                  <span className="mt-1 flex w-full min-w-0 flex-wrap items-baseline justify-start gap-x-2">
                    <span className="text-[18px] font-semibold leading-tight tabular text-foreground">{stageRows.length}</span>
                  {canSeeMoney && currencyTotals.length > 0 && (
                    <span className="flex min-w-0 flex-wrap justify-start gap-x-2 text-xs text-muted-foreground">
                      {currencyTotals.map((item) => <span key={item.currency} title={formatCurrency(item.value, item.currency)}>{formatShortMoney(item.value, item.currency)}</span>)}
                    </span>
                  )}
                  </span>
                </button>
              </Tooltip>
            );
          })}
        </ProcurementStageBand>
      )}

      <ProcurementList
        label={heading}
        rows={filteredRows}
        columns={columns}
        embedded={false}
        bareEmpty={!hasUnfilteredRows}
        accessibleName={projectId ? t('projectDetail.procurement.table.accessibleName', 'Project procurement') : t('procurement.table.accessibleName', 'Procurement')}
        rowMenu={(row) => rowMenu(row)}
        mobileCardDetails={(row) => {
          // L3: a phone row reads title · stage · one amount · next step; age and raiser ride along unlabelled.
          const next = TERMINAL_STATUSES.includes(row.status) ? null : nextStepText(row.status, canDecideRow(row), t);
          const owner = row.requested_by?.full_name ?? t('projectDetail.procurement.unassigned', 'Unassigned');
          const days = ageInCurrentStage(row, erp.data);
          return (
            <div className="space-y-1.5">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="inline-flex min-w-0 items-center gap-2">
                  <StatusPill variant={workflowVariant(row.status)}>{statusText(row.status, t)}</StatusPill>
                  <span className={`text-xs tabular ${days > 30 && row.status !== 'Paid' ? 'text-warning-foreground' : 'text-muted-foreground'}`}>
                    <span className="sr-only">{t('procurement.ageShort', 'Age')}</span>
                    {t('procurement.ageInStageDays', '{{count}}d', { count: days })}
                  </span>
                </span>
                {canSeeMoney && rowAmount(row, true)}
              </div>
              <div className="flex min-w-0 items-center justify-between gap-3">
                {next ? (
                  <Link to={`/procurement/${row.id}`} className="inline-flex min-h-8 items-center rounded-sm text-[13px] font-medium text-primary-text underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                    {next}
                  </Link>
                ) : <span />}
                <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="sr-only">{t('procurement.raisedBy', 'Raised by')}</span>
                  <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-bold text-foreground">{initials(owner)}</span>
                  <span className="truncate">{owner}</span>
                </span>
              </div>
            </div>
          );
        }}
        selectedKey={selected?.id}
        selection={{ selectedIds, onChange: setSelectedIds, rowLabel: (row) => t('projectDetail.procurement.selection.selectRow', 'Select {{name}}', { name: row.title }) }}
        sort={sort}
        onSort={onSort}
        tableId={projectId ? 'project-procurement' : 'company-procurement'}
        state={isPending ? 'loading' : isError ? 'error' : filteredRows.length === 0 ? 'empty' : undefined}
        emptyTitle={hasUnfilteredRows
          ? t('projectDetail.procurement.emptyFiltered.title', 'No procurement matches these filters.')
          : projectId
            // N7: an engineer only ever sees the procurements they raised, so an empty project says exactly that.
            ? (role === 'Engineer'
              ? t('projectDetail.procurement.empty.engineerTitle', "You haven't raised a procurement on this project.")
              : t('projectDetail.procurement.empty.title', 'No procurement on this project yet.'))
            : t('procurement.empty.title', 'No procurement yet.')}
        emptySub={hasUnfilteredRows
          ? t('projectDetail.procurement.emptyFiltered.sub', 'Adjust the search or filters and try again.')
          : projectId && hasVisibleErpPurchases
            ? t('uxs19.projectEmptyScope', 'Purchases recorded in ERPNext appear below.')
            // The company list says what it leaves out, so an empty list is not read as "no purchases at all".
            : !projectId ? t('procurement.empty.scopeNote', 'Purchases recorded only in the accounting system are not listed here.') : undefined}
        emptyAction={hasUnfilteredRows ? { label: t('projectDetail.procurement.emptyFiltered.clear', 'Clear filters'), onClick: () => {
          setSearch(''); setCategoryFilter(''); setOwnerFilter(''); setSelectedStage(null); onClearFilters?.();
        } } : undefined}
        errorTitle={projectId ? t('projectDetail.procurement.error.title', "Couldn't load procurement") : t('procurement.error.title', "Couldn't load procurement")}
        errorSub={globalErrorSub}
        onRetry={() => { void refetch(); }}
      >
        <div className="flex min-h-[58px] flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 sm:px-4">
          {selectedRows.length > 0 ? (
            <>
              <span aria-live="polite" className="mr-1 text-sm font-semibold text-foreground">
                {t('projectDetail.procurement.selection.count', '{{count}} selected', { count: selectedRows.length })}
              </span>
              <Button variant="ghost" size="sm" onClick={toggleVisibleSelection}>
                {allVisibleSelected
                  ? t('projectDetail.procurement.selection.clearVisible', 'Clear visible')
                  : t('projectDetail.procurement.selection.selectVisible', 'Select visible')}
              </Button>
              {selectedRows.some((row) => canDecideRow(row)) && (
                <>
                  <Button size="sm" onClick={() => decide(selectedRows.filter(canDecideRow), 'Approved')} disabled={transition.isPending}>
                    <Icon name="check" />{t('projectDetail.procurement.bulk.approve', 'Approve')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => decide(selectedRows.filter(canDecideRow), 'Rejected')} disabled={transition.isPending}>
                    {t('projectDetail.procurement.bulk.return', 'Return')}
                  </Button>
                </>
              )}
              <ExportButton
                rows={selectedForExport}
                columns={exportColumns}
                entity={t('projectDetail.procurement.exportEntity', 'Procurement')}
                label={t('projectDetail.procurement.bulk.export', 'Export')}
              />
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                {t('projectDetail.procurement.selection.clear', 'Clear selection')}
              </Button>
            </>
          ) : (
            <>
              <label className="flex h-8 min-w-[220px] flex-1 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-[13px] focus-within:ring-2 focus-within:ring-ring sm:max-w-[260px]">
                <Icon name="search" className="size-4 shrink-0 text-muted-foreground" />
                <span className="sr-only">{t('projectDetail.procurement.searchLabel', 'Search procurement')}</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('projectDetail.procurement.search', 'Search procurement…')}
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
              </label>
              {toolbarExtra}
              <label className="sr-only" htmlFor="procurement-category-filter">{t('projectDetail.procurement.filter.category', 'Filter by category')}</label>
              <select
                id="procurement-category-filter"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="h-8 min-w-0 max-w-full rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              >
                <option value="">{t('projectDetail.procurement.filter.allCategories', 'Category')}</option>
                {rows.some((row) => !row.budget_category) && <option value={UNCATEGORIZED_FILTER}>{t('projectDetail.procurement.uncategorized', 'Uncategorized')}</option>}
                {categories.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}
              </select>
              <label className="sr-only" htmlFor="procurement-owner-filter">{t('projectDetail.procurement.filter.owner', 'Filter by owner')}</label>
              <select
                id="procurement-owner-filter"
                value={ownerFilter}
                onChange={(event) => setOwnerFilter(event.target.value)}
                className="h-8 min-w-0 max-w-full rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              >
                <option value="">{t('projectDetail.procurement.filter.allOwners', 'Owner')}</option>
                {rows.some((row) => !row.requested_by_id) && <option value={UNASSIGNED_FILTER}>{t('projectDetail.procurement.unassigned', 'Unassigned')}</option>}
                {owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
              {selectedStage && (
                <Button variant="ghost" size="sm" aria-label={t('projectDetail.procurement.filter.clearStage', 'Clear stage filter')} onClick={() => setSelectedStage(null)}>
                  <Badge active>{stageText(selectedStage, t)} <Icon name="x" className="ml-1 size-3" /></Badge>
                </Button>
              )}
              <span className="flex-1" />
              {canCreate && showCreate && (
                <Button size="sm" onClick={() => navigate(projectId ? `/procurement/new?project=${encodeURIComponent(projectId)}` : '/procurement/new')}>
                  <Icon name="plus" />{t('projectDetail.procurement.newRequest', 'New procurement')}
                </Button>
              )}
            </>
          )}
        </div>

      </ProcurementList>

      <Drawer
        open={selected !== null}
        title={selected?.title ?? t('projectDetail.procurement.detail.title', 'Procurement details')}
        subtitle={selected ? `${selected.code ?? selected.id.slice(0, 8)} · ${selected.vendor?.name ?? t('projectDetail.procurement.noSupplier', 'No supplier')}` : undefined}
        status={selected ? <StatusPill variant={workflowVariant(selected.status)}>{statusText(selected.status, t)}</StatusPill> : undefined}
        width="lg"
        loading={transition.isPending}
        nestedOpen={pendingDecision !== null}
        onClose={() => setSelected(null)}
        headerActions={selected ? <>
          {drawerMain && <Button size="sm" onClick={runDrawerMain} disabled={transition.isPending || (drawerMain.transition.to === 'Requested' && (drawerDetails?.items.length ?? 0) === 0)}>
            {drawerMain.label}
          </Button>}
          <Link to={`/procurement/${selected.id}`} className={buttonClasses('outline', 'sm')}>
            {t('projectDetail.procurement.detail.openFullRecord', 'Open full page')}
          </Link>
          <MenuButton items={rowMenu(selected, true)} ariaLabel={t('procurement.moreActions', 'More procurement actions')} />
        </> : undefined}
      >
        {selected && (
          <div className="space-y-6">
            <section className="grid grid-cols-2 gap-x-5 gap-y-4 border-b border-border/70 pb-5 text-sm">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">{t('projectDetail.procurement.detail.category', 'Category')}</div>
                <div className="font-medium">{categoryLabel(selected.budget_category)}</div>
              </div>
              {canSeeMoney && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">{t('projectDetail.procurement.detail.value', 'Value')}</div>
                  <Tooltip content={moneyTooltip}>
                    <span tabIndex={0} className="inline-flex rounded-sm font-medium tabular focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                      {drawerMoney?.mostReal ? formatCurrency(drawerMoney.mostReal.amount, selected.currency) : t('procurement.moneyUnknown', 'Not recorded')}
                    </span>
                  </Tooltip>
                  {drawerMoney?.mostReal && <div className="text-xs text-muted-foreground">{moneyBasisText(drawerMoney.mostReal.kind, t)}</div>}
                  {drawerUnpaid && (
                    <Tooltip content={t('procurement.unpaidTooltip', 'Invoice amount less recorded payments, or the ERP outstanding balance.')}>
                      <div tabIndex={0} className="rounded-sm text-xs font-medium text-warning-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                        {drawerUnpaid}
                      </div>
                    </Tooltip>
                  )}
                </div>
              )}
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">{t('projectDetail.procurement.detail.owner', 'Owner')}</div>
                <div className="inline-flex min-w-0 items-center gap-2 font-medium">
                  <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-bold text-foreground">
                    {initials(selected.requested_by?.full_name)}
                  </span>
                  <span className="truncate">{selected.requested_by?.full_name ?? t('projectDetail.procurement.unassigned', 'Unassigned')}</span>
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">{t('procurement.ageInStage', 'Age in stage')}</div>
                <Tooltip content={t('procurement.ageInStageTooltip', 'Days since the current procurement stage was most recently entered.')}>
                  <span tabIndex={0} className="inline-flex rounded-sm tabular text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                    {t('procurement.ageInStageDays', '{{count}}d', { count: ageInCurrentStage(selected, erp.data) })}
                  </span>
                </Tooltip>
              </div>
              {canSeeMoney && project && drawerMoney?.mostReal && (
                <ProcurementBudgetLeft project={project} row={selected} amount={drawerMoney.mostReal.amount} t={t} />
              )}
              <div className="col-span-full space-y-1">
                <div className="text-xs text-muted-foreground">{t('projectDetail.procurement.table.nextStep', 'Next step')}</div>
                <div className={selected.status === 'Requested' && canApprove ? 'font-medium text-primary-text' : 'text-muted-foreground'}>
                  {nextStepText(selected.status, canDecideRow(selected), t)}
                </div>
              </div>
            </section>

            <section aria-labelledby="procurement-drawer-timeline">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="procurement-drawer-timeline" className="text-sm font-semibold">{t('projectDetail.procurement.detail.timeline', 'Step timeline')}</h2>
                <span className="text-xs text-muted-foreground">{t('projectDetail.procurement.detail.timelineHint', 'Steps can happen in any order; skipped steps are not recorded.')}</span>
              </div>
              <ol className="space-y-2 border-l border-border pl-4">
                {timeline.map((step) => (
                  <li key={step.key} className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 text-sm">
                    <span aria-hidden="true" className={`absolute -left-[21px] top-1.5 size-2.5 rounded-full border ${step.date ? 'border-success bg-success' : 'border-border bg-card'}`} />
                    <span className={step.date ? 'font-medium text-foreground' : 'text-muted-foreground'}>{stageText(step.key, t)}</span>
                    <time dateTime={step.date ?? undefined} className="text-xs tabular text-muted-foreground">
                      {step.date ? formatDate(step.date) : t('projectDetail.procurement.detail.notRecorded', 'Not recorded')}
                    </time>
                  </li>
                ))}
              </ol>
            </section>

            <section aria-labelledby="procurement-drawer-documents">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 id="procurement-drawer-documents" className="text-sm font-semibold">{t('projectDetail.procurement.detail.documents', 'Documents')}</h2>
                {canAttachDocument && (
                  <Link to={`/procurement/${selected.id}/files`} className="text-xs font-medium text-primary-text underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                    {t('procurement.rowMenu.linkFile', 'Link a file')}
                  </Link>
                )}
              </div>
              {detailQuery.isPending ? (
                <p className="text-sm text-muted-foreground">{t('projectDetail.procurement.detail.loadingDocuments', 'Loading linked documents…')}</p>
              ) : detailQuery.isError ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm text-muted-foreground">
                  <span>{t('projectDetail.procurement.detail.documentsError', 'Linked documents could not be loaded.')}</span>
                  <Button variant="outline" size="sm" onClick={() => { void detailQuery.refetch(); }}>{t('common.retry', 'Retry')}</Button>
                </div>
              ) : documents.length > 0 ? (
                <ul className="divide-y divide-border border-y border-border">
                  {documents.map((document) => (
                    <li key={document.label} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 text-sm">
                      <span>{document.label}</span>
                      <span className="text-right text-muted-foreground">{document.references.filter(Boolean).join(', ')}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t('projectDetail.procurement.detail.noDocuments', 'No linked documents yet.')}</p>
              )}
            </section>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={pendingDecision !== null}
        title={pendingDecision?.target === 'Approved'
          ? pendingDecision.rows.length > 1
            ? t('projectDetail.procurement.confirm.approveManyTitle', 'Approve {{count}} procurements?', { count: pendingDecision.rows.length })
            : t('projectDetail.procurement.confirm.approveTitle', 'Approve this procurement?')
          : pendingDecision?.target === 'Cancelled'
          ? pendingDecision.rows.length > 1
            ? t('projectDetail.procurement.confirm.cancelManyTitle', 'Cancel these procurements?')
            : t('projectDetail.procurement.confirm.cancelTitle', 'Cancel this procurement?')
          : (pendingDecision?.rows.length ?? 0) > 1
            ? t('projectDetail.procurement.confirm.returnManyTitle', 'Return these procurements?')
            : t('projectDetail.procurement.confirm.returnTitle', 'Return this procurement?')}
        description={pendingDecision?.target === 'Approved'
          ? pendingDecision.rows.length === 1
            ? t('projectDetail.procurement.confirm.approveDescription', '{{title}} · {{amount}}. Approving lets the order go ahead.', { title: pendingDecision.rows[0]!.title, amount: formatCurrency(Number(pendingDecision.rows[0]!.total_value), pendingDecision.rows[0]!.currency) })
            : t('projectDetail.procurement.confirm.approveManyDescription', 'Approving lets each order go ahead.')
          : pendingDecision?.target === 'Cancelled'
          ? t('projectDetail.procurement.confirm.cancelDescription', 'This procurement will be marked as cancelled.')
          : t('projectDetail.procurement.confirm.returnDescription', 'The procurement goes back to the person who raised it.')}
        confirmLabel={pendingDecision?.target === 'Approved'
          ? t('projectDetail.procurement.bulk.approve', 'Approve')
          : pendingDecision?.target === 'Cancelled'
          ? t('projectDetail.procurement.rowMenu.cancel', 'Cancel procurement')
          : t('projectDetail.procurement.bulk.return', 'Return')}
        tone={pendingDecision?.target === 'Cancelled' ? 'destructive' : 'default'}
        loading={transition.isPending}
        onConfirm={runDecisionFromDialog}
        onCancel={() => setPendingDecision(null)}
      />
    </div>
  );
};

export default ProcurementBlock;
