import React, { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { Avatar } from '@/src/components/ui/Avatar';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Button,
  buttonClasses,
  ConfirmDialog,
  DataTable,
  Drawer,
  FilterBar,
  Icon,
  ListState,
  MenuButton,
  ReasonDialog,
  Tooltip,
  useToast,
  type Column,
  type DataTableProps,
  type FilterBarFilter,
  type RowMenuItem,
  type SortState,
} from '@/src/components/ui';
import { ExportButton, useExport } from '@/src/components/export';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { safeTrack, trackPurchaseApproved } from '@/src/lib/analytics';
import { useAuth } from '@/src/auth/useAuth';
import { useProject } from '@/src/hooks/useProjects';
import { useProcurements, useProjectProcurements } from '@/src/hooks/useProcurements';
import { useProcurementDetail } from '@/src/hooks/useProcurementDetail';
import { useErpPurchases } from '@/src/hooks/useErpPurchases';
import { useListReturn } from '@/src/hooks/useListReturn';
import { repositories } from '@/src/lib/repositories';
import { PROCUREMENT_LIFECYCLE_ORDER, type ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatQuantity } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { formatCurrency, formatDay, formatPercent, formatShortMoney } from '@/src/lib/format';
import { mayDecideRoutedApproval } from '@/src/lib/procurement/approvalRoute';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { ProcurementStatusPill } from './ProcurementStatusPill';
import { nextStepText } from './nextStepText';
import { useProcurementStatusName } from './useProcurementStatusName';
import { pendingProcurementApprovals } from '@/src/lib/selectors/approvals';
import {
  type ProcurementStage,
  PROCUREMENT_STAGES,
  stageForStatus,
  stageDates,
  payStepLabel,
} from '@/src/lib/procurement/stage';
import { procurementMoney, type ProcurementMoneyResult } from '@/src/lib/procurement/procurementMoney';
import {
  deriveProcurementRow,
  groupErpDocumentsByProcurement,
  type ProcurementRowDerivation,
} from '@/src/lib/procurement/rowDerivations';
import { allowedActions, sortActions, stateMainAction } from '@/src/lib/procurement/mainAction';
import { purchaseHasValue } from '@/src/lib/procurement/purchaseValue';
import { useBudgetPosition } from '@/src/hooks/useProjectPosition';
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
  /** The host page renders the search and filters itself (one filter bar above all its views). */
  filtersOutside?: boolean;
  /** Clears the host page's filters too when the user clears a zero-match table. */
  onClearFilters?: () => void;
  /** Reports the already-loaded project list count to its host tab. */
  onCountChange?: (count: number | null) => void;
}

/** Four stage tiles: a 2×2 grid on phones (nothing clipped), one row from `sm` up. */
export const ProcurementStageBand: React.FC<React.PropsWithChildren<{ label: string }>> = ({ label, children }) => (
  // Owner tidy ruling 2026-10-29: one surface level — the stage tiles are segments
  // of this band, not cards inside it (hairline gaps between the segments, the
  // panel edge closes the group; no nested rounded borders).
  <section aria-label={label} className="panel-card overflow-hidden">
    <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4 [&>*]:bg-card">{children}</div>
  </section>
);

type DistributiveOmit<T, Keys extends PropertyKey> = T extends unknown ? Omit<T, Keys> : never;
type ProcurementListTableProps = DistributiveOmit<
  DataTableProps<ProcurementWithRefs>,
  'rows' | 'columns' | 'rowKey' | 'tableId'
>;

export type ProcurementListProps = ProcurementListTableProps & {
  tableId: string;
  label: string;
  rows: ProcurementWithRefs[];
  columns: Column<ProcurementWithRefs>[];
  children: React.ReactNode;
  embedded?: boolean;
  /** N7: with nothing to list at all, the empty state stands alone — no column headers over a void. */
  bareEmpty?: boolean;
};

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

const LIFECYCLE_RANK = new Map<string, number>(PROCUREMENT_LIFECYCLE_ORDER.map((status, index) => [status, index]));
const TERMINAL_STATUSES: ProcurementStatus[] = ['Paid', 'Rejected', 'Cancelled'];
const UNCATEGORIZED_FILTER = '__uncategorized__';
const UNASSIGNED_FILTER = '__unassigned__';

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


function moneyBasisText(kind: NonNullable<ProcurementMoneyResult['mostReal']>['kind'], t: (key: string, fallback: string) => string): string {
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
  derivationFor: (row: ProcurementWithRefs) => ProcurementRowDerivation,
  defaultCurrency?: string | null,
): Map<ProcurementStage, CurrencyTotal[]> {
  const values = new Map<ProcurementStage, Map<string, number>>();
  for (const stage of PROCUREMENT_STAGES) values.set(stage, new Map());
  for (const row of rows) {
    const stage = stageForStatus(row.status);
    if (!canSeeMoney) continue;
    const amount = derivationFor(row).money.mostReal?.amount;
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
      <div className="text-sm text-muted-foreground">
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

/**
 * The company-wide procurement list also appears on the project detail page; both surfaces read their own
 * data (`useProcurements` / `useProjectProcurements` + `useErpPurchases`), so this block is memoised on its
 * PROPS only. A host page re-rendering for a reason the list does not care about (a reference-query settle,
 * a wizard opening) now skips the whole table, while a change to its own query data or a filter callback
 * still re-renders it — the queries and the store subscriptions trigger it directly.
 */
/** Amber means waiting on someone: a request left undecided for over a month. A purchase order that has been open a long time is not an exception by itself. */
const waitingLong = (row: { status: string }, days: number) => row.status === 'Requested' && days > 30;

export const ProcurementBlock: React.FC<ProcurementBlockProps> = React.memo(function ProcurementBlock({ projectId, rowFilter, rowOrder, showCreate = true, filtersOutside = false, onClearFilters, onCountChange }) {
  const { t } = useTranslation('procurement');
  // The state main action reuses the record page's labels, which live in the common catalogue.
  const { t: tCommon } = useTranslation();
  const { currentUser, role } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { openRecord } = useListReturn({ list: 'procurement' });
  const may = usePermission();
  const { realRole } = useEffectiveRole();
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
  // #2101: one grouping pass per ERP data change, then one derivation per row — read by cells,
  // export accessors, the value/age comparators and the stage totals instead of 17 rescans.
  const erpDocuments = erp.data;
  const erpByProcurement = useMemo(() => groupErpDocumentsByProcurement(erpDocuments), [erpDocuments]);
  const derivations = useMemo(() => {
    const byId = new Map<string, ProcurementRowDerivation>();
    for (const row of scopedRows) byId.set(row.id, deriveProcurementRow(row, erpByProcurement.get(row.id) ?? []));
    return byId;
  }, [scopedRows, erpByProcurement]);
  const derivationFor = useCallback((row: ProcurementWithRefs): ProcurementRowDerivation => (
    derivations.get(row.id) ?? deriveProcurementRow(row, erpByProcurement.get(row.id) ?? [])
  ), [derivations, erpByProcurement]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  // Stage chips read and write `?stage=` — the key this list's other filters already use
  // (`stageFromSearch` / `matchesStage` on the procurement page) — so a reload, a shared link or
  // Back from a record restores the stage. The write follows the `?open=` setter below: preserve
  // every unrelated parameter, replace the history entry.
  const selectedStage = PROCUREMENT_STAGES.find((stage) => stage.toLowerCase() === searchParams.get('stage')) ?? null;
  const setSelectedStage = useCallback((stage: ProcurementStage | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (stage) next.set('stage', stage.toLowerCase());
      else next.delete('stage');
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const [search, setSearch] = useState('');
  // The input keeps the value the user just typed; the expensive filter/derive pass reads the
  // deferred copy, so a keystroke never waits on the 300-row recompute (#2101).
  const deferredSearch = useDeferredValue(search);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [sort, setSort] = useState<SortState>();
  const [pendingDecision, setPendingDecision] = useState<PendingDecision | null>(null);
  const openId = searchParams.get('open');
  // A shared ?open= link opens its record even when the current tab or filter hides the row.
  const selected = scopedRows.find((row) => row.id === openId) ?? null;
  const focusRow = selected;
  const { data: project } = useProject(projectId ?? focusRow?.project_id ?? undefined);
  const detailQuery = useProcurementDetail(selected?.id);
  const setSelected = useCallback((row: ProcurementWithRefs | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (row) next.set('open', row.id);
      else next.delete('open');
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const transition = useMutation({
    mutationFn: ({ id, to, notes }: { id: string; to: ProcurementStatus; notes?: string }) => (
      notes === undefined ? repositories.procurement.transition(id, to) : repositories.procurement.transition(id, to, notes)
    ),
    onSuccess: (_data, { to }) => {
      if (to === 'Approved') safeTrack(() => trackPurchaseApproved(realRole ?? 'unknown'));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['procurements'] });
      void queryClient.invalidateQueries({ queryKey: ['procurement'] });
    },
  });

  const statusName = useProcurementStatusName();
  const categoryLabel = useCallback((category: string | null) => category
    ? budgetCategoryLabel(category, t)
    : t('projectDetail.procurement.uncategorized', 'Uncategorized'), [t]);
  const categories = useMemo(() => [...new Set(rows.map((row) => row.budget_category).filter((value): value is ProcurementBudgetCategory => value !== null))]
    .sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b))), [rows, categoryLabel]);
  const owners = useMemo(() => [...new Map(rows.filter((row) => row.requested_by_id).map((row) => [
    row.requested_by_id!,
    row.requested_by?.full_name ?? t('projectDetail.procurement.unassigned', 'Unassigned'),
  ])).entries()].sort(([, a], [, b]) => a.localeCompare(b)), [rows, t]);

  const blockFilters = useMemo<FilterBarFilter[]>(() => [
    ...(categories.length > 0 ? [{
      key: 'category', label: t('projectDetail.procurement.table.category', 'Category'), kind: 'select' as const,
      options: [
        ...(rows.some((row) => !row.budget_category) ? [{ value: UNCATEGORIZED_FILTER, label: t('projectDetail.procurement.uncategorized', 'Uncategorized') }] : []),
        ...categories.map((category) => ({ value: category, label: categoryLabel(category) })),
      ],
    }] : []),
    {
      key: 'owner', label: t('procurement.raisedBy', 'Raised by'), kind: 'select' as const,
      options: [
        ...(rows.some((row) => !row.requested_by_id) ? [{ value: UNASSIGNED_FILTER, label: t('projectDetail.procurement.unassigned', 'Unassigned') }] : []),
        ...owners.map(([id, name]) => ({ value: id, label: name })),
      ],
    },
  ], [categories, categoryLabel, owners, rows, t]);

  const filteredRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (selectedStage && stageForStatus(row.status) !== selectedStage) return false;
      if (categoryFilter === UNCATEGORIZED_FILTER && row.budget_category) return false;
      if (categoryFilter && categoryFilter !== UNCATEGORIZED_FILTER && row.budget_category !== categoryFilter) return false;
      if (ownerFilter === UNASSIGNED_FILTER && row.requested_by_id) return false;
      if (ownerFilter && ownerFilter !== UNASSIGNED_FILTER && row.requested_by_id !== ownerFilter) return false;
        return matchesSearch(row, deferredSearch);
    });
    if (!sort) return filtered;
    const direction = sort.dir === 'asc' ? 1 : -1;
    // #1459/#2101: money and age-in-stage come from the row's cached derivation, never a rescan.
    const sortValue = (row: ProcurementWithRefs): number | string => {
      switch (sort.key) {
        case 'title': return row.title;
        case 'category': return categoryLabel(row.budget_category);
        case 'value': return derivationFor(row).money.mostReal?.amount ?? 0;
        // #2497: the status column carries the age too, so it sorts by lifecycle step, then by days in that step.
        case 'stage': return (LIFECYCLE_RANK.get(row.status) ?? 99) * 1_000_000 + derivationFor(row).age;
        case 'age': return derivationFor(row).age;
        case 'owner': return row.requested_by?.full_name ?? '';
        case 'project': return row.project ? projectDisplayName(row.project) : '';
        default: return row.updated_at;
      }
    };
    const values = new Map(filtered.map((row) => [row.id, sortValue(row)]));
    return filtered.sort((a, b) => {
      const left = values.get(a.id);
      const right = values.get(b.id);
      const comparison = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right));
      return comparison * direction;
    });
  }, [rows, selectedStage, categoryFilter, ownerFilter, deferredSearch, sort, categoryLabel, derivationFor]);

  const selectedRows = rows.filter((row) => selectedIds.has(row.id));
  const visibleIds = filteredRows.map((row) => row.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const projectCurrency = project?.currency ?? rows[0]?.currency ?? null;
  const totalsByStage = useMemo(() => stageTotals(rows, canSeeMoney, derivationFor, projectCurrency), [rows, canSeeMoney, derivationFor, projectCurrency]);

  const toggleVisibleSelection = () => setSelectedIds((current) => {
    const next = new Set(current);
    if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
    else visibleIds.forEach((id) => next.add(id));
    return next;
  });

  const runTransition = async (targets: ProcurementWithRefs[], to: DecisionTarget, notes?: string) => {
    const results = await Promise.allSettled(targets.map((row) => transition.mutateAsync({ id: row.id, to, notes })));
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
  // The drawer's Open full page carries the same list-return context a direct row open captures
  // (useListReturn → openRecord, as ProcurementListRow does), so the record's Back returns to the
  // list the buyer came from — query string included. Where no /procurement context can be
  // captured (the project page's block), openRecord declines and the plain navigation stands.
  const openFullPage = (row: ProcurementWithRefs) => {
    if (openRecord(`/procurement/${row.id}`)) return;
    openFullRecord(row);
  };
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
      // In the drawer Return is a visible header button beside Approve, not a menu entry.
      if (!inDrawer) items.push({ label: t('projectDetail.procurement.rowMenu.return', 'Return'), onClick: () => decide([row], 'Rejected') });
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
    const dates = derivationFor(row).dates;
    const linked = erpByProcurement.get(row.id) ?? [];
    const steps = [
      { key: 'Request' as const, date: dates.request },
      { key: 'Order' as const, date: dates.order },
      { key: 'Receive' as const, date: dates.receive },
      { key: payStepLabel(Boolean(row.payments?.some((payment) => payment.status === 'Paid')) || linked.some((document) => document.doctype === 'Payment Entry')), date: dates.pay },
    ];
    const done = steps.filter((step) => step.date);
    if (done.length === 0) return t('procurement.noStepDates', 'No step dates recorded yet.');
    return (
      <div className="space-y-1">
        {done.map((step) => (
          <div key={step.key} className="flex justify-between gap-4">
            <span>{stageText(step.key, t)}</span><span>{formatDay(step.date)}</span>
          </div>
        ))}
      </div>
    );
  }, [t, derivationFor, erpByProcurement]);

  /** One amount per row; the unpaid balance remains available in its tooltip. */
  const rowAmount = useCallback((row: ProcurementWithRefs, inline = false) => {
    const money = derivationFor(row).money;
    const amount = money.mostReal?.amount;
    const unpaid = unpaidVisibleToRole(role) ? unpaidText(money, row.currency, t) : null;
    const tip = [
      t('procurement.moneyTooltip', 'Most recorded amount: paid, invoiced, ordered, then requested. Source: procurement records.'),
      unpaid ? `${unpaid}. ${t('procurement.unpaidTooltip', 'Invoice amount less recorded payments, or the ERP outstanding balance.')}` : null,
    ].filter(Boolean).join(' ');
    if (amount === undefined) return <span className="text-sm text-muted-foreground">{t('procurement.moneyUnknown', 'Not recorded')}</span>;
    // Owner tidy ruling 2026-10-29: the stage word under the amount is gone — the
    // Stage pill in its own column already says it (the balance stays in the tooltip).
    return (
      <span className={inline ? 'inline-flex items-baseline gap-1.5' : 'block text-right'}>
        <Tooltip content={tip}>
          <span tabIndex={0} className="rounded-sm font-medium tabular focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            {formatCurrency(amount, row.currency)}
          </span>
        </Tooltip>
      </span>
    );
  }, [derivationFor, role, t]);

  /** Days in the current stage, said as a person would: "today" rather than a column of zeros. */
  const ageText = useCallback((days: number) => (days === 0
    ? t('procurement.inStageToday', 'Today')
    : t('procurement.inStageDays', { count: days, defaultValue_one: '{{count}} day', defaultValue_other: '{{count}} days' })), [t]);

  const columns = useMemo<Column<ProcurementWithRefs>[]>(() => {
    // Owner tidy ruling 2026-10-29: when every row in view is uncategorized the category carries no information.
    const hideCategory = filteredRows.length > 0 && filteredRows.every((row) => !row.budget_category);
    // #2497: one money column at 1440 — the amount in full, with how much of the invoiced amount is paid under it.
    const paidShare = (row: ProcurementWithRefs) => {
      const money = derivationFor(row).money;
      if (money.invoiced.unknown || money.paid.unknown || !money.invoiced.amount) return null;
      const paid = money.paid.amount ?? 0;
      return { paid, invoiced: money.invoiced.amount, percent: Math.max(0, Math.min(100, (paid / money.invoiced.amount) * 100)) };
    };
    const valueColumn: Column<ProcurementWithRefs> = {
      key: 'value',
      header: t('projectDetail.procurement.table.value', 'Value'),
      kind: 'money',
      align: 'num',
      size: 172,
      minSize: 172,
      sortKey: 'value',
      cell: (row) => {
        const share = paidShare(row);
        return (
          <div className="flex flex-col items-end gap-1">
            {rowAmount(row)}
            {share && (
              <Tooltip content={t('procurement.settlementTooltip', 'Recorded paid amount compared with recorded invoices.')}>
                <span tabIndex={0} title={`${formatCurrency(share.paid, row.currency)} / ${formatCurrency(share.invoiced, row.currency)}`} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm text-sm text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                  <span aria-hidden="true" className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-secondary"><span className={`block h-full ${share.percent >= 100 ? 'bg-success' : 'bg-primary'}`} style={{ width: `${share.percent}%` }} /></span>
                  {/* #2089: the share is a locale-formatted percent, never a raw float. */}
                  {t('procurement.paidShare', '{{percent}} paid', { percent: formatPercent(share.percent / 100, 0) })}
                </span>
              </Tooltip>
            )}
          </div>
        );
      },
      exportValue: (row) => derivationFor(row).money.mostReal?.amount ?? '',
    };
    const exportOnly = (column: Column<ProcurementWithRefs>): Column<ProcurementWithRefs> => ({ ...column, exportOnly: true, cell: () => null });
    const tableColumns: Column<ProcurementWithRefs>[] = [
      {
        key: 'procurement',
        header: t('projectDetail.procurement.table.procurement', 'Procurement'),
        kind: 'text',
        rowHeader: true,
        // #2497: the one flexible column; every other column holds its widest value whole at 1440.
        minSize: 220,
        sortKey: 'title',
        cell: (row) => (
          <div className="min-w-0 space-y-0.5">
            <button type="button" aria-label={t('table.openRow', 'Open {{name}}', { name: row.title })} onClick={() => setSelected(row)} title={row.title} className="w-full min-w-0 line-clamp-2 break-words text-left font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
              {row.title}
            </button>
            {(row.code || row.pr_number || row.vendor?.name) && (
              <span className="block min-w-0 break-words text-sm font-normal text-muted-foreground">
                {(row.code || row.pr_number) && <span className="record-id">{row.code || row.pr_number}</span>}{(row.code || row.pr_number) && row.vendor?.name && ' · '}{row.vendor?.name}
              </span>
            )}
            {!projectId && (
              <span className="block min-w-0 break-words text-sm font-normal text-muted-foreground xl:hidden">
                {[row.project ? projectDisplayName(row.project) : null, row.requested_by?.full_name].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
        ),
        exportValue: (row) => row.title,
      },
      ...(projectId ? [] : [{
        key: 'project',
        header: t('procurement.projectColumn', 'Project'),
        kind: 'text' as const,
        // Below 1280 the amount and status keep their room; project and requester move into the purchase cell.
        colClassName: 'hidden xl:table-cell',
        size: 232,
        minSize: 232,
        sortKey: 'project',
        // The budget category belongs to the project's budget, so it rides under the project name.
        cell: (row: ProcurementWithRefs) => (
          <div className="min-w-0 space-y-0.5">
            {/* Only the purchase and its amount take the primary ink; the context columns read grey. */}
            <span className="block break-words text-muted-foreground">{row.project ? projectDisplayName(row.project) : '—'}</span>
            {!hideCategory && row.budget_category && <span className="block break-words text-sm text-muted-foreground">{categoryLabel(row.budget_category)}</span>}
          </div>
        ),
        exportValue: (row: ProcurementWithRefs) => (row.project ? projectDisplayName(row.project) : ''),
      }]),
      ...(projectId && !hideCategory ? [{
        key: 'category',
        header: t('projectDetail.procurement.table.category', 'Category'),
        kind: 'text' as const,
        // #1791: the longest category word stays whole in English and Bahasa ("Subkontraktor" is 80.1px at 14px).
        size: 128,
        minSize: 128,
        sortKey: 'category',
        cell: (row: ProcurementWithRefs) => <span className="break-normal">{categoryLabel(row.budget_category)}</span>,
        exportValue: (row: ProcurementWithRefs) => categoryLabel(row.budget_category),
      }] : [exportOnly({ key: 'category', header: t('projectDetail.procurement.table.category', 'Category'), kind: 'text', cell: () => null, exportValue: (row) => categoryLabel(row.budget_category) })]),
      ...(projectId ? [] : [{
        key: 'owner',
        header: t('procurement.raisedBy', 'Raised by'),
        kind: 'text' as const,
        colClassName: 'hidden xl:table-cell',
        size: 156,
        minSize: 156,
        sortKey: 'owner',
        // Names wrap at a space, never cut: a person reads the whole name.
        cell: (row: ProcurementWithRefs) => <span className="break-words text-muted-foreground">{row.requested_by?.full_name ?? t('projectDetail.procurement.unassigned', 'Unassigned')}</span>,
        exportValue: (row: ProcurementWithRefs) => row.requested_by?.full_name ?? '',
      }]),
      ...(canSeeMoney ? [valueColumn, exportOnly({
        key: 'settlement',
        header: t('procurement.settlement', 'Paid / invoiced'),
        kind: 'text',
        cell: () => null,
        exportValue: (row) => {
          const money = derivationFor(row).money;
          return money.invoiced.unknown || money.paid.unknown ? '' : `${money.paid.amount ?? 0} / ${money.invoiced.amount ?? 0}`;
        },
      })] : []),
      {
        key: 'stage',
        header: t('projectDetail.procurement.table.status', 'Status'),
        // #2497: where it stands and what comes next, read together: the status in full, then the next step and its age.
        kind: 'text',
        size: 240,
        minSize: 240,
        sortKey: 'stage',
        cell: (row) => {
          const days = derivationFor(row).age;
          const terminal = TERMINAL_STATUSES.includes(row.status);
          const next = terminal ? null : nextStepText(row.status, canDecideRow(row), t);
          return (
            <div className="min-w-0 space-y-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Tooltip content={stageDateTooltip(row)}>
                  <span tabIndex={0} className="inline-flex rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                    <ProcurementStatusPill status={row.status} />
                  </span>
                </Tooltip>
                {!terminal && <span className={`whitespace-nowrap text-sm tabular ${waitingLong(row, days) ? 'text-warning-foreground' : 'text-muted-foreground'}`}>{ageText(days)}</span>}
              </span>
              {next && <span className={`block text-sm ${row.status === 'Requested' && canDecideRow(row) ? 'font-medium text-primary-text' : 'text-muted-foreground'}`}>{next}</span>}
            </div>
          );
        },
        exportValue: (row) => statusName(row.status),
      },
      exportOnly({ key: 'next-step', header: t('projectDetail.procurement.table.nextStep', 'Next step'), kind: 'text', cell: () => null, exportValue: (row) => nextStepText(row.status, canDecideRow(row), t) }),
      exportOnly({ key: 'age', header: t('procurement.inStage', 'In stage'), kind: 'number', cell: () => null, exportValue: (row) => derivationFor(row).age }),
    ];
    return tableColumns;
  }, [canSeeMoney, t, statusName, categoryLabel, canDecideRow, stageDateTooltip, derivationFor, projectId, setSelected, rowAmount, filteredRows, ageText]);

  const exportColumns = columns;
  const selectedForExport = selectedRows;
  const onSort = (key: string) => setSort((current) => ({
    key,
    dir: current?.key === key && current.dir === 'asc' ? 'desc' : 'asc',
  }));

  const heading = t('projectDetail.procurement.title', 'Procurement');
  // A host page that filters outside hands over already-narrowed rows; an empty result is still "no match", not "none yet".
  const hasUnfilteredRows = (filtersOutside ? scopedRows : rows).length > 0;
  const hasVisibleErpPurchases = canSeeMoney && (
    erp.isError || (erp.data ?? []).some((row) => row.procurementId === null || Number(row.outstanding ?? 0) > 0)
  );
  const globalErrorSub = projectId
    ? t('projectDetail.procurement.error.sub', "Something went wrong fetching this project's procurement.")
    : t('procurement.error.sub', 'Something went wrong fetching procurement.');

  const runDecisionFromDialog = (reason?: string) => {
    if (!pendingDecision) return;
    const decision = pendingDecision;
    setPendingDecision(null);
    void runTransition(decision.rows, decision.target, decision.target === 'Rejected' ? reason : undefined);
  };

  const drawerDetails = detailQuery.data;
  const documents = drawerDetails ? recordDocuments(drawerDetails, t) : [];
  const drawerErpDocuments = selected ? erpByProcurement.get(selected.id) ?? [] : [];
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
  // The stage band is a funnel: its bars share ONE scale (the largest stage in the first currency), so the
  // stages compare by length as well as by number.
  const scaleCurrency = stageStats.flatMap((stage) => stage.currencyTotals)[0]?.currency;
  const scaleMax = Math.max(0, ...stageStats.map((stage) => stage.currencyTotals.find((item) => item.currency === scaleCurrency)?.value ?? 0));
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
              ? t('projectDetail.procurement.stageCountTooltip', 'Count of procurements currently in {{stage}}. Source: project procurement cases.', { stage: stageLabel })
              : t('procurement.stageCountTooltip', 'Count of procurements currently in {{stage}}. Source: company procurement cases.', { stage: stageLabel });
            const source = canSeeMoney ? `${countTooltip} ${moneyTooltip}` : countTooltip;
            return (
              <Tooltip key={key} content={source} block>
                <button
                  type="button"
                  aria-pressed={selectedStage === key}
                  onClick={() => setSelectedStage(selectedStage === key ? null : key)}
                  className={`flex min-h-[68px] w-full min-w-0 flex-col items-start justify-center px-3 py-2 text-left transition-colors focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${selectedStage === key ? 'bg-accent outline outline-1 -outline-offset-1 outline-primary/30' : 'bg-card hover:bg-accent/40'}`}
                >
                  <span className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-2 text-sm font-semibold text-muted-foreground">
                    <span>{stageLabel}</span>
                    {forYou > 0 && <span className="shrink-0 font-medium text-primary-text">{t('projectDetail.procurement.forYou', '{{count}} for you', { count: forYou })}</span>}
                  </span>
                  <span className="mt-1 flex w-full min-w-0 flex-wrap items-baseline justify-start gap-x-2">
                    <span className="text-[18px] font-semibold leading-tight tabular text-foreground">{stageRows.length}</span>
                  {canSeeMoney && currencyTotals.length > 0 && (
                    <span className="flex min-w-0 flex-wrap justify-start gap-x-2 text-sm text-muted-foreground">
                      {currencyTotals.map((item) => <span key={item.currency} title={formatCurrency(item.value, item.currency)}>{formatShortMoney(item.value, item.currency)}</span>)}
                    </span>
                  )}
                  </span>
                  {canSeeMoney && scaleMax > 0 && (
                    <span aria-hidden="true" data-testid={`stage-bar-${key}`} className="mt-2 block h-1.5 w-full rounded-full bg-secondary">
                      <span className="block h-full rounded-full bg-mark-neutral/60" style={{ width: `${Math.max(0, Math.min(100, ((currencyTotals.find((item) => item.currency === scaleCurrency)?.value ?? 0) / scaleMax) * 100))}%` }} />
                    </span>
                  )}
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
          const days = derivationFor(row).age;
          return (
            <div className="space-y-1.5">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="inline-flex min-w-0 items-center gap-2">
                  <ProcurementStatusPill status={row.status} />
                  <span className={`text-sm tabular ${waitingLong(row, days) ? 'text-warning-foreground' : 'text-muted-foreground'}`}>
                    {days === 0 ? ageText(days) : t('procurement.inStageDaysLong', { count: days, defaultValue_one: '{{count}} day in stage', defaultValue_other: '{{count}} days in stage' })}
                  </span>
                </span>
                {canSeeMoney && rowAmount(row, true)}
              </div>
              {next && (
                <div className="flex min-w-0">
                  <Button variant="outline" size="sm" onClick={() => navigate(`/procurement/${row.id}`)}>{next}</Button>
                </div>
              )}
              {/* #2434: the owner takes its own line under the action, so a long Bahasa label never cuts the name. */}
              <span className="block min-w-0 break-words text-sm text-muted-foreground">
                <span className="sr-only">{t('procurement.raisedBy', 'Raised by')}</span>
                {owner}
              </span>
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
        {(selectedRows.length > 0 || !filtersOutside) && <div className="flex min-h-[58px] flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 sm:px-4">
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
                  <Button variant="outline" size="sm" onClick={() => decide(selectedRows.filter(canDecideRow), 'Rejected')} disabled={transition.isPending}>
                    {t('projectDetail.procurement.bulk.return', 'Return')}
                  </Button>
                  <Button size="sm" onClick={() => decide(selectedRows.filter(canDecideRow), 'Approved')} disabled={transition.isPending}>
                    <Icon name="check" />{t('projectDetail.procurement.bulk.approve', 'Approve')}
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
              {/* The host page that owns its filters (the purchases list) shows them above every view; a project tab keeps its own here. */}
              <FilterBar
                className="min-w-0 flex-1"
                searchKey="q"
                searchLabel={t('projectDetail.procurement.searchLabel', 'Search procurement')}
                searchPlaceholder={t('projectDetail.procurement.search', 'Search procurement…')}
                filters={blockFilters}
                values={{ q: search, category: categoryFilter, owner: ownerFilter }}
                onChange={(key, value) => {
                  if (key === 'q') setSearch(value);
                  else if (key === 'category') setCategoryFilter(value);
                  else setOwnerFilter(value);
                }}
                onClear={() => { setSearch(''); setCategoryFilter(''); setOwnerFilter(''); setSelectedStage(null); }}
                shown={filteredRows.length}
                total={rows.length}
              />
              {canCreate && showCreate && (
                <Button size="sm" onClick={() => navigate(projectId ? `/procurement/new?project=${encodeURIComponent(projectId)}` : '/procurement/new')}>
                  <Icon name="plus" />{t('projectDetail.procurement.newRequest', 'New procurement')}
                </Button>
              )}
            </>
          )}
        </div>}

      </ProcurementList>

      <Drawer
        open={selected !== null}
        title={selected?.title ?? t('projectDetail.procurement.detail.title', 'Procurement details')}
        subtitle={selected ? [selected.code, selected.vendor?.name].filter(Boolean).join(' · ') || undefined : undefined}
        status={selected ? <ProcurementStatusPill status={selected.status} /> : undefined}
        width="lg"
        loading={transition.isPending}
        nestedOpen={pendingDecision !== null}
        onClose={() => setSelected(null)}
        headerActions={selected ? <>
          {drawerMain?.transition.to === 'Approved' && canDecideRow(selected) && (
            <Button size="sm" variant="outline" onClick={() => decide([selected], 'Rejected')} disabled={transition.isPending}>
              {t('projectDetail.procurement.rowMenu.return', 'Return')}
            </Button>
          )}
          {drawerMain && <Button size="sm" onClick={runDrawerMain} disabled={transition.isPending || (drawerMain.transition.to === 'Requested' && (drawerDetails?.items?.length ?? 0) === 0)}>
            {drawerMain.label}
          </Button>}
          <Link
            to={`/procurement/${selected.id}`}
            onClick={(event) => {
              // Modified / new-tab clicks keep the plain href (no return context crosses into
              // another browsing context); a plain left-click routes through the shared opener.
              if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
              event.preventDefault();
              openFullPage(selected);
            }}
            className={buttonClasses('outline', 'sm')}
          >
            {t('projectDetail.procurement.detail.openFullRecord', 'Open full page')}
          </Link>
          <MenuButton items={rowMenu(selected, true)} ariaLabel={t('procurement.moreActions', 'More procurement actions')} />
        </> : undefined}
      >
        {selected && (
          <div className="space-y-6">
            <section className="grid grid-cols-2 gap-x-5 gap-y-4 border-b border-border/70 pb-5 text-sm">
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">{t('projectDetail.procurement.detail.category', 'Category')}</div>
                <div className="font-medium">{categoryLabel(selected.budget_category)}</div>
              </div>
              {canSeeMoney && (
                <div className="space-y-1">
                  <div className="text-sm text-muted-foreground">{t('projectDetail.procurement.detail.value', 'Value')}</div>
                  <Tooltip content={moneyTooltip}>
                    <span tabIndex={0} className="inline-flex rounded-sm font-medium tabular focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                      {drawerMoney?.mostReal ? formatCurrency(drawerMoney.mostReal.amount, selected.currency) : t('procurement.moneyUnknown', 'Not recorded')}
                    </span>
                  </Tooltip>
                  {drawerMoney?.mostReal && <div className="text-sm text-muted-foreground">{moneyBasisText(drawerMoney.mostReal.kind, t)}</div>}
                  {drawerUnpaid && (
                    <Tooltip content={t('procurement.unpaidTooltip', 'Invoice amount less recorded payments, or the ERP outstanding balance.')}>
                      <div tabIndex={0} className="rounded-sm text-sm font-medium text-warning-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                        {drawerUnpaid}
                      </div>
                    </Tooltip>
                  )}
                </div>
              )}
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">{t('projectDetail.procurement.detail.owner', 'Owner')}</div>
                <div className="inline-flex min-w-0 items-center gap-2 font-medium">
                  <Avatar name={selected.requested_by?.full_name} decorative />
                  <span className="truncate">{selected.requested_by?.full_name ?? t('projectDetail.procurement.unassigned', 'Unassigned')}</span>
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">{t('procurement.ageInStage', 'Age in stage')}</div>
                <Tooltip content={t('procurement.ageInStageTooltip', 'Days since the current procurement stage was most recently entered.')}>
                  <span tabIndex={0} className="inline-flex rounded-sm tabular text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                    {t('procurement.ageInStageDays', '{{count}}d', { count: selected ? derivationFor(selected).age : 0 })}
                  </span>
                </Tooltip>
              </div>
              {canSeeMoney && project && drawerMoney?.mostReal && (
                <ProcurementBudgetLeft project={project} row={selected} amount={drawerMoney.mostReal.amount} t={t} />
              )}
              <div className="col-span-full space-y-1">
                <div className="text-sm text-muted-foreground">{t('projectDetail.procurement.table.nextStep', 'Next step')}</div>
                <div className={selected.status === 'Requested' && canApprove ? 'font-medium text-primary-text' : 'text-muted-foreground'}>
                  {nextStepText(selected.status, canDecideRow(selected), t)}
                </div>
              </div>
            </section>

            <section aria-labelledby="procurement-drawer-timeline">
              <h2 id="procurement-drawer-timeline" className="mb-2 text-sm font-semibold">{t('projectDetail.procurement.detail.timeline', 'Step timeline')}</h2>
              <ol className="space-y-2 border-l border-border pl-4">
                {timeline.map((step) => (
                  <li key={step.key} className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 text-sm">
                    <span aria-hidden="true" className={`absolute -left-[21px] top-1.5 size-2.5 rounded-full border ${step.date ? 'border-success bg-success' : 'border-border bg-card'}`} />
                    <span className={step.date ? 'font-medium text-foreground' : 'text-muted-foreground'}>{stageText(step.key, t)}</span>
                    <time dateTime={step.date ?? undefined} className="text-sm tabular text-muted-foreground">
                      {step.date ? formatDay(step.date) : t('projectDetail.procurement.detail.notRecorded', 'Not recorded')}
                    </time>
                  </li>
                ))}
              </ol>
            </section>

            <section aria-labelledby="procurement-drawer-documents">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 id="procurement-drawer-documents" className="text-sm font-semibold">{t('projectDetail.procurement.detail.documents', 'Documents')}</h2>
                {canAttachDocument && (
                  <Link to={`/procurement/${selected.id}/files`} className="text-sm font-medium text-primary-text underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                    {t('procurement.rowMenu.linkFile', 'Link a file')}
                  </Link>
                )}
              </div>
              {detailQuery.isPending ? (
                <p className="text-sm text-muted-foreground">{t('projectDetail.procurement.detail.loadingDocuments', 'Loading linked documents…')}</p>
              ) : detailQuery.isError ? (
                <ListState
                  variant="error"
                  title={t('projectDetail.procurement.detail.documentsError', 'Linked documents could not be loaded.')}
                  retryLabel={t('common.retry', 'Retry')}
                  onRetry={() => { void detailQuery.refetch(); }}
                />
              ) : documents.length > 0 ? (
                <ul className="divide-y divide-border">
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

            <section aria-labelledby="procurement-drawer-items">
              <h2 id="procurement-drawer-items" className="mb-2 text-sm font-semibold">{t('procurement.lineItems', 'Line items')}</h2>
              {detailQuery.isPending ? (
                <p className="text-sm text-muted-foreground">{t('common.loading', 'Loading…')}</p>
              ) : detailQuery.isError ? (
                <ListState
                  variant="error"
                  title={t('procurement.lineItemsUnavailable', 'Line items could not be loaded.')}
                  retryLabel={t('common.retry', 'Retry')}
                  onRetry={() => { void detailQuery.refetch(); }}
                />
              ) : (drawerDetails?.items?.length ?? 0) > 0 ? (
                <ul className="divide-y divide-border">
                  {drawerDetails!.items.map((item) => (
                    <li key={item.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 text-sm">
                      <span>{item.name}{item.description ? ` · ${item.description}` : ''}</span>
                      <span className="tabular text-muted-foreground">{formatQuantity(String(item.quantity), getNumberLocale())}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t('procurement.noLineItems', 'No line items recorded.')}</p>
              )}
            </section>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={pendingDecision !== null && pendingDecision.target !== 'Rejected'}
        title={pendingDecision?.target === 'Approved'
          ? pendingDecision.rows.length > 1
            ? t('projectDetail.procurement.confirm.approveManyTitle', 'Approve {{count}} procurements?', { count: pendingDecision.rows.length })
            : t('projectDetail.procurement.confirm.approveTitle', 'Approve this procurement?')
          : pendingDecision && pendingDecision.rows.length > 1
            ? t('projectDetail.procurement.confirm.cancelManyTitle', 'Cancel these procurements?')
            : t('projectDetail.procurement.confirm.cancelTitle', 'Cancel this procurement?')}
        description={pendingDecision?.target === 'Approved'
          ? pendingDecision.rows.length === 1
            ? t('projectDetail.procurement.confirm.approveDescription', '{{title}} · {{amount}}. Approving lets the order go ahead.', { title: pendingDecision.rows[0]!.title, amount: formatCurrency(Number(pendingDecision.rows[0]!.total_value), pendingDecision.rows[0]!.currency) })
            : t('projectDetail.procurement.confirm.approveManyDescription', 'Approving lets each order go ahead.')
          : t('projectDetail.procurement.confirm.cancelDescription', 'This procurement will be marked as cancelled.')}
        confirmLabel={pendingDecision?.target === 'Approved'
          ? t('projectDetail.procurement.bulk.approve', 'Approve')
          : t('projectDetail.procurement.rowMenu.cancel', 'Cancel procurement')}
        tone={pendingDecision?.target === 'Cancelled' ? 'destructive' : 'default'}
        loading={transition.isPending}
        onConfirm={() => runDecisionFromDialog()}
        onCancel={() => setPendingDecision(null)}
      />
      <ReasonDialog
        open={pendingDecision?.target === 'Rejected'}
        kind="return"
        subject={pendingDecision && pendingDecision.rows.length > 1
          ? t('projectDetail.procurement.confirm.returnSubjectMany', '{{count}} procurements', { count: pendingDecision.rows.length })
          : t('projectDetail.procurement.confirm.returnSubject', 'procurement')}
        context={pendingDecision && pendingDecision.rows.length === 1 ? pendingDecision.rows[0]!.title : undefined}
        loading={transition.isPending}
        onConfirm={(reason) => runDecisionFromDialog(reason)}
        onCancel={() => setPendingDecision(null)}
      />
    </div>
  );
});

export default ProcurementBlock;
