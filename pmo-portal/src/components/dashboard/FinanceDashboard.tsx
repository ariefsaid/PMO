import { projectDisplayName } from '@/src/lib/projectDisplayName';
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useDashboard, useFinanceBudgetReview } from '@/src/hooks/useDashboard';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useCompanies } from '@/src/hooks/useCompanies';
import { useProjectIdentity } from '@/src/hooks/useProjects';
import { useCompanyCollections } from '@/src/hooks/useCompanyCollections';
import { useActualsSnapshot, useApAgingSnapshot, useArAgingSnapshot } from '@/src/hooks/useErpSnapshots';
import { AccountingSnapshotsSection } from './AccountingSnapshotsSection';
import { StillToInvoiceCard } from './StillToInvoiceCard';
import { Card, CardHead } from '@/src/components/ui/Card';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import { ProgressBar } from '@/src/components/ui/ProgressBar';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { ListState } from '@/src/components/ui/ListState';
import { buttonClasses } from '@/src/components/ui/buttonClasses';
import { formatCurrency, formatInstantDate } from '@/src/lib/format';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { StatusBarChart } from './StatusBarChart';
import { procurementStatusTone } from './procurementStatusTone';
import { DashPageHead } from './layout';
import { isMoneyAtRisk } from '@/src/lib/dashboardConstants';
import type { BudgetReviewRow } from '@/src/lib/db/dashboard';
import type { Tables } from '@/src/lib/supabase/database.types';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { useUnbilledWorkOrders } from '@/src/hooks/useWorkOrderBilling';
import { pendingProcurementApprovals } from '@/src/lib/selectors/approvals';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { can } from '@/src/auth/policy';
import type { ErpAgingSnapshotRow } from '@/src/lib/db/erpSnapshots';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { pillVariantForProjectStatus } from '@/components/projects';

/** The procurement status meaning "billed, awaiting payment" (plan Open Q6). */
const INVOICED_STATUS: Tables<'procurements'>['status'] = 'Vendor Invoiced';

function invoiceAgeTimestamp(row: ProcurementWithRefs): number {
  const timestamp = Date.parse(row.vendor_invoiced_at ?? row.updated_at ?? '');
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

const OLDEST_FIRST_BUCKETS = ['bucketOver90', 'bucket61to90', 'bucket31to60', 'bucket0to30'] as const;

function compareAgingOldestFirst(left: ErpAgingSnapshotRow, right: ErpAgingSnapshotRow): number {
  const currencyOrder = (left.currency ?? '').localeCompare(right.currency ?? '');
  if (currencyOrder !== 0) return currencyOrder;
  for (const bucket of OLDEST_FIRST_BUCKETS) {
    const a = left[bucket];
    const b = right[bucket];
    if (a === null && b === null) continue;
    if (a === null) return 1;
    if (b === null) return -1;
    if (a !== b) return b - a;
  }
  return (left.party ?? '').localeCompare(right.party ?? '');
}

function isOverdueCustomer(row: ErpAgingSnapshotRow): boolean {
  return row.partyType === 'Customer'
    && [row.bucket0to30, row.bucket31to60, row.bucket61to90, row.bucketOver90]
      .some((amount) => typeof amount === 'number' && Number.isFinite(amount) && amount > 0);
}

/**
 * Compute days since a given ISO date string (the row's `vendor_invoiced_at` — the real time the
 * PR entered 'Vendor Invoiced', stamped by transition_procurement (migration 0022) — falling back
 * to `updated_at` only for legacy rows stamped before the migration).
 * Returns a compact label: "N days" or "Today".
 * Guards against clock-skew (negative delta clamped to 0).
 */
function daysAgoLabel(isoDate: string, t: (key: string, fallback: string, options?: { count?: number }) => string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const days = Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
  if (days === 0) return t('dashboard:finance.today', 'Today');
  if (days === 1) return t('dashboard:finance.oneDay', '1 day');
  return t('dashboard:finance.days', '{{count}} days', { count: days });
}

// ── ReadyToPayTable — exported for unit testing ──────────────────────────

export interface ReadyToPayTableProps {
  procurements: ProcurementWithRefs[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
}

/**
 * N16 — "Ready to pay" table.
 * Shows only Vendor Invoiced PRs. Each row activates → /procurement/:id (Mark-as-Paid lives there).
 * Honest empty state: "Nothing awaiting payment".
 * J4 console reframe: tabular numerics, right-aligned money/age columns.
 */
export const ReadyToPayTable: React.FC<ReadyToPayTableProps> = ({
  procurements,
  isPending,
  isError,
  onRetry,
}) => {
  const { t } = useTranslation('dashboard');

  const viRows = useMemo(
    () => procurements
      .filter((p) => p.status === INVOICED_STATUS)
      .sort((left, right) => {
        return invoiceAgeTimestamp(left) - invoiceAgeTimestamp(right) || left.id.localeCompare(right.id);
      }),
    [procurements],
  );
  const totalsByCurrency = useMemo(() => {
    const totals = new Map<string, { value: number; complete: boolean; count: number }>();
    for (const row of viRows) {
      const currency = row.currency || '???';
      const current = totals.get(currency) ?? { value: 0, complete: true, count: 0 };
      if (typeof row.total_value === 'number' && Number.isFinite(row.total_value)) current.value += row.total_value;
      else current.complete = false;
      current.count += 1;
      totals.set(currency, current);
    }
    return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [viRows]);

  const columns: Column<ProcurementWithRefs>[] = [
    {
      key: 'request',
      header: t('dashboard:finance.request', 'Request'),
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-semibold" title={r.title}>
            {r.title}
          </div>
          {/* Mono identifier per DESIGN.md Mono-For-Identifiers Rule */}
          <div className="font-mono text-[11px] text-muted-foreground">
            {r.code ?? r.id.slice(0, 8)}
          </div>
        </div>
      ),
    },
    {
      key: 'project',
      header: t('uxs03.financeProjectColumn', 'Project'),
      cell: (r) => (
        <span className="text-muted-foreground" title={r.project?.name}>{r.project ? projectDisplayName(r.project) : '—'}</span>
      ),
    },
    {
      key: 'value',
      header: t('dashboard:finance.value', 'Value'),
      align: 'num',
      sortKey: 'value',
      cell: (r) => (
        /* tabular class applied automatically by DataTable on align:num cells */
        typeof r.total_value === 'number' && Number.isFinite(r.total_value)
          ? <span>{formatCurrency(r.total_value, r.currency)}</span>
          : <span title={t('dashboard:finance.valueUnavailableReason', 'The request value is unavailable.')}>—<span className="sr-only"> {t('dashboard:finance.valueUnavailableReason', 'The request value is unavailable.')}</span></span>
      ),
    },
    {
      key: 'age',
      // FR-FIN-DEBT / OBS-FIN-DEBT-004: real vendor_invoiced_at (stamped on →'Vendor Invoiced',
      // migration 0022), falling back to updated_at only for legacy rows stamped before the migration.
      header: (
        <span title={t('dashboard:finance.invoicedHelp', 'Days since the vendor invoice was recorded; older records use their last update date.') }>
          {t('dashboard:finance.invoicedAge', 'Invoiced age')}
        </span>
      ),
      align: 'num',
      cell: (r) => (
        /* Age in days since vendor_invoiced_at (real invoice date) — text signal, not color-only */
        <span className="text-muted-foreground">{daysAgoLabel(r.vendor_invoiced_at ?? r.updated_at, t)}</span>
      ),
    },
    {
      key: 'open',
      header: t('dashboard:finance.open', 'Open'),
      cell: (r) => (
        <Link
          to={`/procurement/${r.id}`}
          aria-label={t('dashboard:finance.openRequest', 'Open {{request}}', { request: r.title })}
          className={buttonClasses('outline', 'default', 'min-h-11 px-3')}
        >
          {t('dashboard:finance.open', 'Open')}
        </Link>
      ),
    },
  ];

  const orderedColumns = [columns[0]!, columns[1]!, columns[3]!, columns[2]!, columns[4]!];

  const tableState: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError
      ? 'error'
      : viRows.length === 0
        ? 'empty'
        : undefined;

  return (
    <div>
      {!isPending && !isError && totalsByCurrency.length > 0 && (
        <dl data-testid="ready-to-pay-total" className="grid grid-cols-1 gap-x-6 gap-y-2 border-b border-border px-4 py-3 min-[560px]:grid-cols-2">
          {totalsByCurrency.map(([currency, total]) => (
            <div key={currency}>
              <dt className="text-xs text-muted-foreground">{t('dashboard:finance.payablesTotal', 'Vendor payables')} · {currency}</dt>
              <dd className="mt-0.5 font-semibold tabular">
                {total.complete ? formatCurrency(total.value, currency) : <span title={t('dashboard:finance.payablesUnavailableReason', 'A request value is unavailable, so this total cannot be calculated.')}>—<span className="sr-only"> {t('dashboard:finance.payablesUnavailableReason', 'A request value is unavailable, so this total cannot be calculated.')}</span></span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <DataTable<ProcurementWithRefs>
        rows={viRows}
        columns={orderedColumns}
        rowKey={(r) => r.id}
        state={tableState}
        emptyTitle={t('dashboard:finance.nothingAwaitingPayment', 'Nothing awaiting payment')}
        emptySub={t('dashboard:finance.allInvoicesPaid', 'All vendor invoices have been paid or none are awaiting action.')}
        errorTitle={t('dashboard:finance.loadInvoicesError', "Couldn't load invoices")}
        onRetry={onRetry}
        className="rounded-t-none border-t-0"
      tableId="components-dashboard-financedashboard-ready-to-pay-v2-table" />
    </div>
  );
};

// ── Variance helpers ─────────────────────────────────────────────────────

/**
 * Render the variance cell: "+$X over" (text-destructive) for over-budget,
 * "$Y left" (text-muted-foreground) for under-budget.
 * Reads the server-computed `variance` (committed basis, OD-BUDGET-2) — single source of truth.
 * Text + sign — NOT color-only (DESIGN.md a11y posture, plan §6).
 */
function VarianceCell({ project, currency, unavailableLabel }: {
  project: BudgetReviewRow;
  currency: string;
  unavailableLabel: string;
}) {
  const v = project.variance;
  if (v === null || !Number.isFinite(v)) {
    return <span className="text-muted-foreground">{unavailableLabel}</span>;
  }
  if (v > 0) {
    // Over budget: destructive text WITH the word "over" so color is reinforcement only.
    // tabular applied automatically by DataTable on align:num <td>s — no redundant inner span class.
    return (
      <span className="text-destructive">
        {`+${formatCurrency(v, currency)} over`}
      </span>
    );
  }
  // Under / on-budget: muted text WITH the word "left"
  return (
    <span className="text-muted-foreground">
      {`${formatCurrency(Math.abs(v), currency)} left`}
    </span>
  );
}

function hasKnownActual(project: BudgetReviewRow): boolean {
  return project.actual_complete && project.spent !== null && Number.isFinite(project.spent)
    && typeof project.actual_currency === 'string' && project.actual_currency.length > 0;
}

function canCompareActual(project: BudgetReviewRow): boolean {
  return hasKnownActual(project)
    && Number.isFinite(project.budget) && project.budget > 0
    && typeof project.currency === 'string' && project.currency.length > 0
    && project.budget_currency === project.currency
    && project.actual_currency === project.currency;
}

function compareNullable(
  left: number | null,
  right: number | null,
  direction: 1 | -1,
  leftId: string,
  rightId: string,
): number {
  if (left === null && right === null) return leftId.localeCompare(rightId);
  if (left === null) return 1;
  if (right === null) return -1;
  if (left === right) return leftId.localeCompare(rightId);
  return (left - right) * direction;
}

const NextCaseEvidence: React.FC<{ evidence: React.ReactNode; action: string; to: string }> = ({ evidence, action, to }) => (
  <div className="flex flex-col items-start gap-3 min-[560px]:flex-row min-[560px]:items-center min-[560px]:justify-between">
    <p className="min-w-0 text-sm">{evidence}</p>
    <Link to={to} className={buttonClasses('primary', 'default', 'min-h-11 px-4')}>
      {action}
    </Link>
  </div>
);

// ── FinanceDashboard ──────────────────────────────────────────────────────

/**
 * Finance pane — real off the exec RPC (revenue / spend / margin / top-projects)
 * + `useProcurements` (outstanding invoices = Σ value of Vendor-Invoiced rows,
 * never a `* 0.4` fabrication). The legacy per-category cost donut is repurposed
 * to the real, status-toned Procurement-by-status chart (plan §4.2 / Open Q4).
 *
 * PR-B additions (AC-IXD-DASH-W5-C2B):
 * - N16 "Ready to pay" DataTable (Vendor Invoiced PRs → /procurement/:id)
 * - N17 Budget review by variance (variance-desc, Variance column with over/left text)
 * - J4 console reframe: tabular nums everywhere, right-aligned money columns
 */
export const FinanceDashboard: React.FC = () => {
  const { t } = useTranslation('dashboard');
  const { data, isPending, isError, refetch } = useDashboard();
  const { data: projects } = useProjectIdentity();
  const { currentUser } = useAuth();
  const { realRole } = useEffectiveRole();
  const may = usePermission();
  const projectStatusLabel = useProjectStatusLabel();
  const { data: unbilled, isPending: unbilledPending, isError: unbilledError, refetch: refetchUnbilled } = useUnbilledWorkOrders();
  // Org-denominated figures (RPC aggregates, BudgetReviewRow) — the org currency, not a record's.
  const orgCurrency = useOrgCurrency();
  const { data: procurements, isPending: procPending, isError: procError, refetch: refetchProc } = useProcurements();
  const { data: clientCompanies } = useCompanies('Client');
  const clientCompanyIds = useMemo(() => (clientCompanies ?? []).map((company) => company.id), [clientCompanies]);
  const { customerLinks } = useCompanyCollections(clientCompanyIds);
  // N17: portfolio-wide budget review — ALL budget>0 projects ranked by committed-basis variance,
  // computed server-side by get_finance_budget_review (OD-E). Replaces the FE re-sort of top_projects.
  // B-0.3: capture isError/refetch so the budget-review card can surface an error branch instead
  // of rendering the "No project spend yet" empty state on RPC failure (mirror ReadyToPayTable).
  const { data: budgetReview, isPending: budgetPending, isError: budgetError, refetch: refetchBudget } = useFinanceBudgetReview();

  // task FIX-2 (Discover CRITICAL 2, ADR-0048): read-only actuals/AP-AR aging snapshot surface.
  // Empty by default (the unflipped-org state) — never a fabricated figure.
  const { data: actuals, isPending: actualsPending, isError: actualsError, refetch: refetchActuals } = useActualsSnapshot();
  const { data: apAging, isPending: apAgingPending, isError: apAgingError, refetch: refetchApAging } = useApAgingSnapshot();
  const { data: arAging, isPending: arAgingPending, isError: arAgingError, refetch: refetchArAging } = useArAgingSnapshot();

  // The RPC returns known variance first, nulls last, and a stable id tie-break. Client sorts keep
  // unknown values last in either direction and retain that tie-break for predictable ordering.
  const [budgetSort, setBudgetSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({
    key: 'variance',
    dir: 'desc',
  });

  const notAvailable = t('uxs03.notAvailableYet', 'Not available yet');
  const totalSpend = data?.on_hand_actual_known ?? null;
  const actualCoverage = t('uxs03.coverage', 'Actual available for {{known}} of {{total}} delivery projects', {
    known: data?.on_hand_actual_project_count ?? 0, total: data?.on_hand_actual_project_total ?? 0,
  }) + ' · ' + t('uxs03.coverageCategories', 'Actual coverage: {{known}} of {{total}} mapped cost categories', {
    known: data?.on_hand_actual_coverage_count ?? 0, total: data?.on_hand_actual_coverage_total ?? 0,
  });
  const unknownMarginProjects = (data?.on_hand_realized_margin_by_currency ?? [])
    .reduce((sum, item) => sum + item.unknown_projects, 0);
  const marginLabel = unknownMarginProjects > 0
    ? t('uxs03.realizedMarginKnown', 'Known margin on billed work')
    : t('uxs03.realizedMargin', 'Margin on billed work');
  const payableRows = useMemo(() => (procurements ?? [])
    .filter((p) => p.status === INVOICED_STATUS)
    .sort((left, right) => invoiceAgeTimestamp(left) - invoiceAgeTimestamp(right) || left.id.localeCompare(right.id)), [procurements]);
  const oldestMappedOverdue = useMemo(() => (arAging ?? [])
    .filter((row) => isOverdueCustomer(row) && row.party !== null && customerLinks.has(row.party))
    .sort(compareAgingOldestFirst)[0], [arAging, customerLinks]);
  const pendingDecisions = useMemo(() => can('transition', 'procurement', { realRole })
    ? pendingProcurementApprovals(procurements, currentUser?.id, realRole === 'Admin')
    : [], [currentUser?.id, procurements, realRole]);
  const procByStatus = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of procurements ?? []) counts.set(p.status, (counts.get(p.status) ?? 0) + 1);
    return [...counts.entries()].map(([status, count]) => ({
      status: status as Tables<'procurements'>['status'],
      count,
    }));
  }, [procurements]);

  // The RPC is the portfolio-wide source; the dashboard displays its five highest variance rows.
  const topByVariance = useMemo(() => {
    const sorted = [...(budgetReview ?? [])];
    const direction = budgetSort.dir === 'desc' ? -1 : 1;
    sorted.sort((a, b) => {
      if (budgetSort.key === 'variance') {
        return compareNullable(Number.isFinite(a.variance) ? a.variance : null,
          Number.isFinite(b.variance) ? b.variance : null, direction, a.id, b.id);
      }
      if (budgetSort.key === 'budget') {
        return compareNullable(Number.isFinite(a.budget) ? a.budget : null,
          Number.isFinite(b.budget) ? b.budget : null, direction, a.id, b.id);
      }
      if (budgetSort.key === 'spent') {
        return compareNullable(hasKnownActual(a) ? a.spent : null,
          hasKnownActual(b) ? b.spent : null, direction, a.id, b.id);
      }
      const utilization = (project: BudgetReviewRow) => canCompareActual(project) && project.spent !== null
        ? project.spent / project.budget
        : null;
      return compareNullable(utilization(a), utilization(b), direction, a.id, b.id);
    });
    return sorted.slice(0, 5);
  }, [budgetReview, budgetSort]);

  // N17 Budget review columns (sortable, with Variance column)
  const budgetColumns: Column<BudgetReviewRow>[] = [
    {
      key: 'name',
      header: t('uxs03.financeProjectColumn', 'Project'),
      cell: (p) => {
        return (
          <span className="inline-flex items-center gap-2">
            <Link
              to={`/projects/${p.id}/budget`}
              aria-label={t('dashboard.budgetReviewLink', 'Review {{project}} budget', { project: p.name })}
              className="inline-flex min-h-11 items-center font-medium text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              {p.name}
            </Link>
          </span>
        );
      },
    },
    {
      key: 'riskStatus',
      header: t('dashboard:finance.riskStatus', 'Risk / status'),
      cell: (p) => {
        const atRisk = isMoneyAtRisk({
          status: p.status,
          budget: p.budget,
          budgetCurrency: p.budget_currency,
          projectCurrency: p.currency,
          spent: p.spent,
          actualCurrency: p.actual_currency,
          actualComplete: p.actual_complete,
        });
        const statusVariant = pillVariantForProjectStatus(p.status);
        return (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {atRisk && <StatusPill variant="warn">{t('uxs03.atRisk', 'At risk')}</StatusPill>}
            <StatusPill variant={statusVariant === 'progress' ? 'neutral' : statusVariant}>{projectStatusLabel(p.status)}</StatusPill>
          </div>
        );
      },
    },
    {
      key: 'budget',
      header: t('uxs03.activeBudget', 'Active budget'),
      align: 'num',
      sortKey: 'budget',
      // tabular applied automatically by DataTable on align:num <td>s — no redundant inner span
      cell: (p) => <span>{formatCurrency(p.budget, p.budget_currency || p.currency || orgCurrency)}</span>,
    },
    {
      key: 'spent',
      header: t('uxs03.actual', 'Actual'),
      align: 'num',
      sortKey: 'spent',
      cell: (p) => {
        const known = hasKnownActual(p);
        const details = [
          !known && p.actual_currency
            ? t('uxs03.actualSourceCurrency', 'Source currency: {{currency}}', { currency: p.actual_currency })
            : null,
          !p.actual_complete && p.actual_coverage_total > 0
            ? t('uxs03.coverageCategories', 'Actual coverage: {{known}} of {{total}} mapped cost categories', {
              known: p.actual_coverage_count, total: p.actual_coverage_total,
            })
            : null,
          p.actual_as_of
            ? t('uxs03.actualAsOf', 'As of {{date}}', { date: formatInstantDate(p.actual_as_of) })
            : null,
        ].filter((detail): detail is string => detail !== null);
        return (
          <span className="inline-flex flex-col items-end gap-0.5">
            <span>{known ? formatCurrency(p.spent!, p.actual_currency!) : t('uxs03.notAvailableYet', 'Not available yet')}</span>
            {details.length > 0 && <span className="text-[11px] text-muted-foreground">{details.join(' · ')}</span>}
          </span>
        );
      },
    },
    {
      key: 'variance',
      header: t('uxs03.variance', 'Variance'),
      align: 'num',
      sortKey: 'variance',
      cell: (p) => <VarianceCell
        project={canCompareActual(p) ? p : { ...p, variance: null }}
        currency={p.currency || orgCurrency}
        unavailableLabel={t('uxs03.notAvailableYet', 'Not available yet')}
      />,
    },
    {
      key: 'util',
      header: t('uxs03.utilization', 'Utilization'),
      align: 'num',
      sortKey: 'util',
      cell: (p) => canCompareActual(p) && p.spent !== null ? (
        <ProgressBar value={Math.round((p.spent / p.budget) * 100)} showValue compact aria-label={`${p.name} budget utilization`} />
      ) : <span className="text-muted-foreground">{t('uxs03.notAvailableYet', 'Not available yet')}</span>,
    },
  ];

  const positionValue = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value)
    ? formatCurrency(value, orgCurrency)
    : <span title={notAvailable}>—<span className="sr-only"> {notAvailable}</span></span>;

  const nextCase = procError || procPending
    ? procError
      ? <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{t('dashboard:finance.approvalsUnavailable', 'Purchase requests are unavailable, so the next case cannot be determined.')}</p><Link to="/approvals" className="min-h-11 inline-flex items-center text-sm font-medium text-primary-text underline-offset-2 hover:underline">{t('dashboard:finance.openApprovals', 'Open approvals')}</Link></div>
      : <ListState variant="loading" rows={1} />
    : pendingDecisions.length > 0
      ? <NextCaseEvidence
        evidence={t('dashboard:finance.awaitingRequestsEvidence', '{{count}} purchase requests are awaiting your decision.', { count: pendingDecisions.length })}
        action={t('dashboard:finance.reviewRequests', 'Review requests')}
        to="/approvals"
      />
      : unbilledPending
        ? <ListState variant="loading" rows={1} />
        : unbilledError
          ? <ListState variant="error" title={t('dashboard:finance.loadInvoiceableError', "Couldn't determine invoiceable work")}
            onRetry={() => { void refetchUnbilled(); }} />
          : unbilled?.rows[0]
            ? <NextCaseEvidence
              evidence={<><span className="font-medium">{unbilled.rows[0].woNumber ?? unbilled.rows[0].title}</span><span className="text-muted-foreground"> · {unbilled.rows[0].projectName}</span></>}
              action={t('dashboard:finance.reviewWorkOrder', 'Review work order')}
              to={`/projects/${unbilled.rows[0].projectId}/work-orders?wo=${encodeURIComponent(unbilled.rows[0].workOrderId)}`}
            />
            : payableRows[0]
              ? <NextCaseEvidence
                evidence={<><span className="font-medium">{payableRows[0].title}</span><span className="text-muted-foreground"> · {payableRows[0].project?.name ?? t('dashboard:finance.projectUnavailable', 'Project unavailable')} · {daysAgoLabel(payableRows[0].vendor_invoiced_at ?? payableRows[0].updated_at, t)}</span></>}
                action={t('dashboard:finance.reviewPayableRequest', 'Review payable request')}
                to={`/procurement/${payableRows[0].id}`}
              />
              : arAgingPending
                ? <ListState variant="loading" rows={1} />
                : arAgingError
                  ? <ListState variant="error" title={t('dashboard:finance.loadCollectionsError', "Couldn't determine customer collections")}
                    onRetry={() => { void refetchArAging(); }} />
                  : oldestMappedOverdue
                    ? <NextCaseEvidence
                      evidence={<><span className="font-medium">{oldestMappedOverdue.party}</span><span className="text-muted-foreground"> · {oldestMappedOverdue.reportDate ?? notAvailable}</span></>}
                      action={t('dashboard:finance.reviewCollections', 'Review collections')}
                      to={`/companies/${encodeURIComponent(customerLinks.get(oldestMappedOverdue.party!)!)}#collections`}
                    />
                    : <p className="text-sm text-muted-foreground">{t('dashboard:finance.noNextCase', 'No purchase decision, invoiceable work, payable request or mapped overdue customer needs action.')}</p>;

  const hasMissingSnapshot = (!actualsPending && !actualsError && (actuals ?? []).length === 0)
    || (!apAgingPending && !apAgingError && (apAging ?? []).length === 0)
    || (!arAgingPending && !arAgingError && (arAging ?? []).length === 0);
  const snapshotRemedy = may('manage', 'integration')
    ? <Link to="/administration/accounting" className="font-medium text-primary-text underline-offset-2 hover:underline">{t('dashboard:finance.openAccountingSetup', 'Open accounting setup')}</Link>
    : t('dashboard:finance.askAdminToSync', 'Ask your administrator to sync accounting data.');

  return (
    <div className="space-y-4">
      <DashPageHead
        title={t('uxs03.financeDashboardTitle', 'Finance Dashboard')}
        sub={t('dashboard:finance.scope', 'Invoiceable work, vendor payments and customer collections.')}
      />

      <section aria-label={t('dashboard:finance.nextCase', 'Next case')} data-testid="finance-next-case">
        <Card>
          <CardHead>{t('dashboard:finance.nextCase', 'Next case')}</CardHead>
          <div className="p-4">{nextCase}</div>
        </Card>
      </section>

      <StillToInvoiceCard />

      <Card seam>
        <CardHead className="rounded-t-lg">{t('uxs03.financeReadyToPay', 'Ready to pay')}</CardHead>
        <ReadyToPayTable
          procurements={procurements ?? []}
          isPending={procPending}
          isError={procError}
          onRetry={() => { void refetchProc(); }}
        />
      </Card>

      <AccountingSnapshotsSection
        showActuals={false}
        showApAging={false}
        ariaLabel={t('dashboard:finance.collectionsTitle', 'Customer collections')}
        arTitle={t('dashboard:finance.collectionsTitle', 'Customer collections')}
        actuals={[]}
        apAging={[]}
        arAging={arAging ?? []}
        arAgingPending={arAgingPending}
        arAgingError={arAgingError}
        onRetryArAging={() => { void refetchArAging(); }}
        customerLinks={customerLinks}
      />
      {hasMissingSnapshot && <p className="text-sm text-muted-foreground">{t('dashboard:finance.snapshotUnavailable', 'An accounting snapshot is not available yet.')} {snapshotRemedy}</p>}

      <Card>
        <CardHead>{t('dashboard:finance.budgetReview', 'Budget review')}</CardHead>
        <p className="px-4 pb-2 text-sm text-muted-foreground">{t('dashboard:finance.budgetReviewScope', 'Five projects by budget variance')}</p>
        {budgetError ? (
          <ListState
            variant="error"
            title={t('dashboard:finance.budgetReviewLoadError', "Couldn't load budget review")}
            onRetry={() => { void refetchBudget(); }}
          />
        ) : (
          <DataTable<BudgetReviewRow>
            rows={topByVariance}
            columns={budgetColumns}
            rowKey={(p) => p.id}
            sort={budgetSort}
            onSort={(key) =>
              setBudgetSort((prev) => ({
                key,
                dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc',
              }))
            }
            state={budgetPending ? 'loading' : topByVariance.length === 0 ? 'empty' : undefined}
            emptyTitle={t('uxs03.activeBudgetReviewEmpty', 'No active budgets ready for review')}
            emptySub={t('uxs03.activeBudgetReviewEmptySub', 'Active, positive-value budgets appear here.')}
            className="rounded-t-none border-t-0"
          tableId="components-dashboard-financedashboard-budget-review-v2-table" />
        )}
      </Card>

      <section aria-label={t('dashboard:finance.financialEvidence', 'Financial position and accounting evidence')}>
        <details className="rounded-lg border border-border bg-card">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <span>{t('dashboard:finance.financialEvidence', 'Financial position and accounting evidence')}</span>
            <span aria-hidden="true" className="text-muted-foreground">⌄</span>
          </summary>
          <div className="flex flex-col gap-4 border-t border-border p-4">
            <section aria-label={t('dashboard:finance.position', 'Financial position')}>
              <h2 className="text-base font-semibold">{t('dashboard:finance.position', 'Financial position')}</h2>
              {isError && <ListState variant="error" title={t('dashboard:finance.dashboardError', "Couldn't load the finance dashboard")} onRetry={() => { void refetch(); }} />}
              {isPending && !data ? <ListState variant="loading" rows={4} /> : data ? (
                <>
                  <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 min-[560px]:grid-cols-2">
                    <div><dt className="text-sm text-muted-foreground">{t('dashboard:finance.contractInProgress', 'Contract in progress')}</dt><dd className="mt-0.5 text-base font-semibold tabular">{positionValue(data.total_contract_value)}</dd></div>
                    <div>
                      <dt className="text-sm text-muted-foreground">{t('dashboard:finance.knownSpending', 'Known spending')}</dt>
                      <dd className="mt-0.5 text-base font-semibold tabular">{positionValue(totalSpend)}</dd>
                      {(data.on_hand_actual_project_count < data.on_hand_actual_project_total || data.on_hand_actual_coverage_count < data.on_hand_actual_coverage_total)
                        && <span className="text-xs text-muted-foreground">{t('dashboard:spend.partial', 'Partial')}</span>}
                    </div>
                    <div><dt className="text-sm text-muted-foreground">{marginLabel}</dt><dd className="mt-0.5 text-base font-semibold tabular">{positionValue(data.on_hand_realized_margin)}</dd></div>
                    <div><dt className="text-sm text-muted-foreground">{t('uxs03.contractRemaining', 'Contract remaining after known Actual')}</dt><dd className="mt-0.5 text-base font-semibold tabular">{positionValue(data.on_hand_contract_remaining)}</dd></div>
                  </dl>
                  <p className="mt-3 text-xs text-muted-foreground">{actualCoverage} · {t('dashboard:finance.marginBasis', 'Margin is billed-work revenue less recorded spending; it is not cash received.')}</p>
                </>
              ) : !isError && <ListState variant="empty" title={notAvailable} />}
            </section>

            <p className="text-sm text-muted-foreground">{t('dashboard:finance.pmoErpSeparation', 'PMO vendor requests and ERP Accounts Payable are separate sources; their totals are not combined.')}</p>
            <AccountingSnapshotsSection
              showArAging={false}
              actuals={actuals ?? []}
              actualsPending={actualsPending}
              actualsError={actualsError}
              onRetryActuals={() => { void refetchActuals(); }}
              apAging={apAging ?? []}
              apAgingPending={apAgingPending}
              apAgingError={apAgingError}
              onRetryApAging={() => { void refetchApAging(); }}
              arAging={[]}
              actualProjectNames={new Map((projects ?? []).map((project) => [project.id, projectDisplayName(project)]))}
            />
          </div>
        </details>
      </section>

      <section aria-label={t('dashboard:finance.purchasingRequests', 'Purchasing requests')}>
        <details className="rounded-lg border border-border bg-card">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <span>{t('dashboard:finance.purchasingRequests', 'Purchasing requests')}</span>
            <span aria-hidden="true" className="text-muted-foreground">⌄</span>
          </summary>
          <div className="border-t border-border p-4">
            <p className="text-xs text-muted-foreground">{t('uxs03.pmoPurchasingScope', 'ERP-native purchases are outside this PMO request chart.')}</p>
            <div className="pt-3">
              {procError ? (
                <ListState variant="error" title={t('dashboard:finance.procurementError', "Couldn't load procurement")} onRetry={() => { void refetchProc(); }} />
              ) : procPending ? (
                <ListState variant="loading" rows={6} />
              ) : procByStatus.length === 0 ? (
                <ListState variant="empty" icon="cart" title={t('dashboard.chart.procStatus.empty', 'No procurement activity yet')} />
              ) : (
                <StatusBarChart data={procByStatus} toneFor={procurementStatusTone}
                  label={t('dashboard.chart.procStatus.chartLabel', 'Procurement by status')}
                  noun={t('dashboard.chart.procStatus.noun', 'requests')} />
              )}
            </div>
          </div>
        </details>
      </section>
    </div>
  );
};
