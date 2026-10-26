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
import { formatNumberExact } from '@/src/lib/format';
import { moneyFigure } from '@/src/lib/dashboardMoney';
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
          <Link to={`/procurement/${r.id}`} aria-label={t('dashboard:finance.requestIdentity', 'Request {{request}}', { request: r.title })} className="inline-flex min-h-11 max-w-full whitespace-normal break-words underline underline-offset-2">{r.title}</Link>
          {/* Mono identifier per DESIGN.md Mono-For-Identifiers Rule */}
          <div className="break-words font-mono text-[0.6875rem] font-semibold text-muted-foreground">
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
          ? <span>{formatNumberExact(r.total_value)}</span>
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
      header: t('dashboard:finance.openColumn', 'Open'),
      cell: (r) => (
        <Link
          to={`/procurement/${r.id}`}
          aria-label={t('dashboard:finance.reviewRequestNamed', 'Review request: {{request}}', { request: r.title })}
          className={buttonClasses('outline', 'default', 'min-h-11 px-3')}
        >
          {t('dashboard:finance.reviewRequest', 'Review request')}
        </Link>
      ),
    },
  ];

  const orderedColumns = [columns[0]!, columns[1]!, columns[3]!, columns[2]!, columns[4]!];
  const groups = totalsByCurrency.map(([currency, total]) => ({
    currency,
    total,
    rows: viRows.filter((row) => (row.currency || '???') === currency),
  }));

  return (
    <div>
      {isPending || isError ? <DataTable<ProcurementWithRefs>
        rows={[]}
        columns={orderedColumns}
        rowKey={(r) => r.id}
        state={isPending ? 'loading' : 'error'}
        errorTitle={t('dashboard:finance.loadInvoicesError', "Couldn't load invoices")}
        onRetry={onRetry}
        className="rounded-none border-0 bg-transparent"
        tableId="components-dashboard-financedashboard-ready-to-pay-v2-table"
      /> : viRows.length === 0 ? (
        <p role="status" data-testid="ready-to-pay-empty" className="px-4 py-3 text-sm text-muted-foreground">
          {t('dashboard:finance.nothingAwaitingPayment', 'Nothing awaiting payment')}
        </p>
      ) : <div className="space-y-4 px-4 pb-4" data-testid="ready-to-pay-total">
        {groups.map(({ currency: groupCurrency, total, rows }) => {
          const compactTotal = moneyFigure(
            total.complete ? total.value : null,
            groupCurrency,
            t('dashboard:finance.payablesUnavailableReason', 'A request value is unavailable, so this total cannot be calculated.'),
            { code: true },
          );
          const heading = t('dashboard:finance.payablesGroup', 'Vendor payables · {{figure}}', { figure: compactTotal.value === '—' ? `${groupCurrency} —` : compactTotal.value });
          return (
            <section key={groupCurrency} aria-label={heading}>
              <h3 className="mb-2 text-xl font-bold tabular">{heading}</h3>
              <p className="mb-2 text-sm tabular">{t('dashboard:finance.exactPayables', 'Exact payable total')} · {total.complete ? formatNumberExact(total.value) : <span aria-label={compactTotal.unavailableReason}>—</span>}</p>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">
                {t('dashboard:finance.payablesCount', '{{count}} vendor invoices', { count: total.count })}
              </p>
              <DataTable<ProcurementWithRefs>
                rows={rows}
                columns={orderedColumns}
                rowKey={(r) => r.id}
                accessibleName={heading}
                className="rounded-none border-0 bg-transparent"
                tableId={`components-dashboard-financedashboard-ready-to-pay-v2-${groupCurrency.toLowerCase()}`}
              />
            </section>
          );
        })}
      </div>}
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
function VarianceCell({ project, unavailableLabel, fieldLabel }: {
  project: BudgetReviewRow;
  unavailableLabel: string;
  fieldLabel: string;
}) {
  const { t } = useTranslation('dashboard');
  const v = project.variance;
  if (v === null || !Number.isFinite(v)) {
    return <span aria-label={`${fieldLabel}: ${unavailableLabel}`} className="text-muted-foreground">—</span>;
  }
  if (v > 0) {
    // Over budget: destructive text WITH the word "over" so color is reinforcement only.
    // tabular applied automatically by DataTable on align:num <td>s — no redundant inner span class.
    return (
      <span className="text-destructive">
        {`+${formatNumberExact(v)} ${t('dashboard:finance.over', 'over')}`}
      </span>
    );
  }
  // Under / on-budget: muted text WITH the word "left"
  return (
    <span className="text-muted-foreground">
      {`${formatNumberExact(Math.abs(v))} ${t('dashboard:finance.left', 'left')}`}
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

const NextCaseEvidence: React.FC<{
  evidence: React.ReactNode;
  action: string;
  to: string;
  amount: number | null | undefined;
  currency: string | null | undefined;
  amountLabel: string;
}> = ({ evidence, action, to, amount, currency, amountLabel }) => {
  const { t } = useTranslation('dashboard');
  const compact = moneyFigure(amount ?? null, currency || 'IDR', t('dashboard:finance.valueUnavailableReason', 'The amount is unavailable.'), { code: true });
  return (
  <div className="flex flex-col items-start gap-3 min-[560px]:flex-row min-[560px]:items-center min-[560px]:justify-between">
    <div className="min-w-0">
      <h3 className="break-words text-xl font-bold tabular">{evidence} · {compact.value}</h3>
      <p className="text-sm"><span className="text-muted-foreground">{amountLabel}</span> · {amount === null || amount === undefined ? <span aria-label={compact.unavailableReason}>—</span> : formatNumberExact(amount)}</p>
    </div>
    <Link to={to} className={buttonClasses('primary', 'default', 'min-h-11 px-4 text-xs font-semibold')}>
      {action}
    </Link>
  </div>
  );
};

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
  const budgetRowsByCurrency = useMemo(() => {
    const grouped = new Map<string, BudgetReviewRow[]>();
    for (const project of budgetReview ?? []) {
      const key = project.budget_currency || project.currency || orgCurrency;
      const rows = grouped.get(key) ?? [];
      rows.push(project);
      grouped.set(key, rows);
    }
    const direction = budgetSort.dir === 'desc' ? -1 : 1;
    const compare = (a: BudgetReviewRow, b: BudgetReviewRow) => {
      if (budgetSort.key === 'variance') {
        return compareNullable(canCompareActual(a) ? a.variance : null,
          canCompareActual(b) ? b.variance : null, direction, a.id, b.id);
      }
      if (budgetSort.key === 'budget') {
        return compareNullable(Number.isFinite(a.budget) ? a.budget : null,
          Number.isFinite(b.budget) ? b.budget : null, direction, a.id, b.id);
      }
      if (budgetSort.key === 'spent') {
        return compareNullable(canCompareActual(a) ? a.spent : null,
          canCompareActual(b) ? b.spent : null, direction, a.id, b.id);
      }
      const utilization = (project: BudgetReviewRow) => canCompareActual(project) && project.spent !== null
        ? project.spent / project.budget
        : null;
      return compareNullable(utilization(a), utilization(b), direction, a.id, b.id);
    };
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, rows]) => ({
      currency,
      rows: rows.sort(compare).slice(0, 5),
    }));
  }, [budgetReview, budgetSort, orgCurrency]);

  // N17 Budget review columns (sortable, with Variance column)
  const budgetColumns = (groupCurrency: string): Column<BudgetReviewRow>[] => [
    {
      key: 'name',
      header: t('uxs03.financeProjectColumn', 'Project'),
      kind: 'primary',
      size: 320,
      minSize: 280,
      cell: (p) => {
        return (
          <div>
          <Link
              to={`/projects/${p.id}/budget`}
              aria-label={t('dashboard.budgetReviewLink', 'Review {{project}} budget', { project: p.name })}
              className="flex min-h-11 min-w-0 max-w-full items-center whitespace-normal break-words text-primary-text underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              {p.name}
          </Link>
          {!canCompareActual(p) && <details className="mt-1 text-muted-foreground">
            <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold">{t('dashboard:exec.viewSourceDetails', 'View source details')}</summary>
            <p className="text-sm">{p.actual_currency && t('dashboard:finance.sourceCurrency', '{{currency}} source', { currency: p.actual_currency })}{' · '}{t('dashboard:finance.categoryCoverage', '{{known}}/{{total}} categories', { known: p.actual_coverage_count ?? '—', total: p.actual_coverage_total ?? '—' })}</p>
          </details>}
          </div>
        );
      },
    },
    {
      key: 'riskStatus',
      header: t('dashboard:finance.riskStatus', 'Risk / status'),
      size: 140,
      minSize: 120,
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
      size: 140,
      minSize: 120,
      sortKey: 'budget',
      // tabular applied automatically by DataTable on align:num <td>s — no redundant inner span
      cell: (p) => <span>{formatNumberExact(p.budget)}</span>,
    },
    {
      key: 'spent',
      header: t('uxs03.actual', 'Actual'),
      align: 'num',
      size: 130,
      minSize: 110,
      sortKey: 'spent',
      cell: (p) => {
        const known = hasKnownActual(p);
        const differentCurrency = Boolean(p.actual_currency && p.actual_currency !== groupCurrency);
        return (
          known
            ? <span>{differentCurrency ? `${p.actual_currency} · ` : ''}{formatNumberExact(p.spent!)}</span>
            : <a href="#budget-comparison-unavailable-note" aria-label={`${t('uxs03.actual', 'Actual')}: ${notAvailable}`} className="inline-flex min-h-11 min-w-11 items-center justify-end text-muted-foreground underline underline-offset-2">—</a>
        );
      },
    },
    {
      key: 'variance',
      header: t('uxs03.variance', 'Variance'),
      align: 'num',
      size: 125,
      minSize: 110,
      sortKey: 'variance',
      cell: (p) => <VarianceCell
        project={canCompareActual(p) ? p : { ...p, variance: null }}
        unavailableLabel={t('uxs03.notAvailableYet', 'Not available yet')}
        fieldLabel={t('uxs03.variance', 'Variance')}
      />,
    },
    {
      key: 'util',
      header: t('uxs03.utilization', 'Utilization'),
      align: 'num',
      size: 120,
      minSize: 105,
      sortKey: 'util',
      cell: (p) => canCompareActual(p) && p.spent !== null ? (
        <ProgressBar value={Math.round((p.spent / p.budget) * 100)} showValue compact aria-label={`${p.name} budget utilization`} />
      ) : <span aria-label={`${t('uxs03.utilization', 'Utilization')}: ${notAvailable}`} className="text-muted-foreground">—</span>,
    },
  ];

  const positionValue = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value)
    ? formatNumberExact(value)
    : <span title={notAvailable}>—<span className="sr-only"> {notAvailable}</span></span>;

  const firstDecision = pendingDecisions[0];
  const firstUnbilled = unbilled?.rows[0];
  const nextCaseIsUnbilled = !procError && !procPending && pendingDecisions.length === 0
    && !unbilledPending && !unbilledError && Boolean(firstUnbilled);
  const nextCase = procError || procPending
    ? procError
      ? <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{t('dashboard:finance.approvalsUnavailable', 'Purchase requests are unavailable, so the next case cannot be determined.')}</p><Link to="/approvals" className="min-h-11 inline-flex items-center text-xs font-semibold text-primary-text underline-offset-2 hover:underline">{t('dashboard:finance.openApprovals', 'Open approvals')}</Link></div>
      : <ListState variant="loading" rows={1} />
    : pendingDecisions.length > 0
      ? <NextCaseEvidence
        evidence={<>{firstDecision?.title ?? t('dashboard:finance.nextRequest', 'Purchase request')}<span className="text-muted-foreground"> · {firstDecision?.project?.name ?? ''}</span></>}
        action={t('dashboard:finance.reviewRequests', 'Review requests')}
        to="/approvals"
        amount={firstDecision?.total_value}
        currency={firstDecision?.currency}
        amountLabel={t('dashboard:finance.requestAmount', 'Request value')}
      />
      : unbilledPending
        ? <ListState variant="loading" rows={1} />
        : unbilledError
          ? <ListState variant="error" title={t('dashboard:finance.loadInvoiceableError', "Couldn't determine invoiceable work")}
            onRetry={() => { void refetchUnbilled(); }} />
          : unbilled?.rows[0]
            ? <NextCaseEvidence
              evidence={<><span>{unbilled.rows[0].woNumber ?? unbilled.rows[0].title}</span><span className="text-muted-foreground"> · {unbilled.rows[0].projectName}</span></>}
              action={t('dashboard:finance.reviewWorkOrder', 'Review work order')}
              to={`/projects/${unbilled.rows[0].projectId}/work-orders?wo=${encodeURIComponent(unbilled.rows[0].workOrderId)}`}
              amount={unbilled.rows[0].remaining}
              currency={unbilled.rows[0].currency}
              amountLabel={t('dashboard:finance.outstanding', 'Outstanding')}
            />
            : payableRows[0]
              ? <NextCaseEvidence
                evidence={<><span>{payableRows[0].title}</span><span className="text-muted-foreground"> · {payableRows[0].project?.name ?? t('dashboard:finance.projectUnavailable', 'Project unavailable')} · {daysAgoLabel(payableRows[0].vendor_invoiced_at ?? payableRows[0].updated_at, t)}</span></>}
                action={t('dashboard:finance.reviewPayableRequest', 'Review payable request')}
                to={`/procurement/${payableRows[0].id}`}
                amount={payableRows[0].total_value}
                currency={payableRows[0].currency}
                amountLabel={t('dashboard:finance.payableAmount', 'Invoice amount')}
              />
              : arAgingPending
                ? <ListState variant="loading" rows={1} />
                : arAgingError
                  ? <ListState variant="error" title={t('dashboard:finance.loadCollectionsError', "Couldn't determine customer collections")}
                    onRetry={() => { void refetchArAging(); }} />
                  : oldestMappedOverdue
                    ? <NextCaseEvidence
                      evidence={<><span>{oldestMappedOverdue.party}</span><span className="text-muted-foreground"> · {oldestMappedOverdue.reportDate ?? notAvailable}</span></>}
                      action={t('dashboard:finance.reviewCollections', 'Review collections')}
                      to={`/companies/${encodeURIComponent(customerLinks.get(oldestMappedOverdue.party!)!)}#collections`}
                      amount={oldestMappedOverdue.totalOutstanding}
                      currency={oldestMappedOverdue.currency}
                      amountLabel={t('dashboard:finance.outstanding', 'Outstanding')}
                    />
                    : <p className="text-sm text-muted-foreground">{t('dashboard:finance.noNextCase', 'No purchase decision, invoiceable work, payable request or mapped overdue customer needs action.')}</p>;

  const hasMissingSnapshot = (!actualsPending && !actualsError && (actuals ?? []).length === 0)
    || (!apAgingPending && !apAgingError && (apAging ?? []).length === 0)
    || (!arAgingPending && !arAgingError && (arAging ?? []).length === 0);
  const snapshotRemedy = may('manage', 'integration')
    ? <Link to="/administration/accounting" className="inline-flex min-h-11 items-center text-xs font-semibold text-primary-text underline-offset-2 hover:underline">{t('dashboard:finance.openAccountingSetup', 'Open accounting setup')}</Link>
    : t('dashboard:finance.askAdminToSync', 'Ask your administrator to sync accounting data.');

  return (
    <div className="space-y-4">
      <DashPageHead
        title={t('uxs03.financeDashboardTitle', 'Finance Dashboard')}
        sub={t('dashboard:finance.scope', 'Invoiceable work, vendor payments and customer collections.')}
      />

      <section aria-label={t('dashboard:finance.nextCase', 'Next case')} data-testid="finance-next-case">
        <Card>
          <CardHead className="text-xl font-bold">{t('dashboard:finance.nextCase', 'Next case')}</CardHead>
          <div className="p-4">{nextCase}</div>
        </Card>
      </section>

      <StillToInvoiceCard excludeWorkOrderId={nextCaseIsUnbilled ? firstUnbilled?.workOrderId : undefined} />

      <Card seam>
        <CardHead className="rounded-t-lg text-xl font-bold">{t('uxs03.financeReadyToPay', 'Ready to pay')}</CardHead>
        {!procPending && !procError && payableRows.length > 0 && <p className="px-4 pb-2 text-sm text-muted-foreground">{t('dashboard:finance.payablesSort', 'Oldest vendor-invoiced first; last update date is used when invoice date is missing.')}</p>}
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
        ariaLabel={t('dashboard:finance.collectionsData', 'Customer collections data')}
        arTitle={t('dashboard:finance.collectionsTitle', 'Customer collections')}
        actuals={[]}
        apAging={[]}
        arAging={arAging ?? []}
        arAgingPending={arAgingPending}
        arAgingError={arAgingError}
        onRetryArAging={() => { void refetchArAging(); }}
        customerLinks={customerLinks}
        compactEmpty
        compactEmptyAction={<a className="underline underline-offset-2" href="#finance-accounting-evidence">{t('dashboard:finance.reviewAccountingEvidence', 'View accounting evidence')}</a>}
      />

      <Card clip data-testid="finance-budget-review">
        <CardHead className="text-xl font-bold">{t('dashboard:finance.budgetReview', 'Budget review')}</CardHead>
        <p className="px-4 pb-2 text-sm text-muted-foreground">{t('dashboard:finance.budgetReviewScope', 'Five projects by budget variance')}</p>
        {budgetError ? (
          <ListState
            variant="error"
            title={t('dashboard:finance.budgetReviewLoadError', "Couldn't load budget review")}
            onRetry={() => { void refetchBudget(); }}
          />
        ) : budgetPending || budgetRowsByCurrency.length === 0 ? (
          <DataTable<BudgetReviewRow>
            rows={[]}
            columns={budgetColumns(orgCurrency)}
            rowKey={(p) => p.id}
            state={budgetPending ? 'loading' : 'empty'}
            emptyTitle={t('uxs03.activeBudgetReviewEmpty', 'No active budgets ready for review')}
            emptySub={t('uxs03.activeBudgetReviewEmptySub', 'Active, positive-value budgets appear here.')}
            className="rounded-none border-0 bg-transparent"
            tableId="components-dashboard-financedashboard-budget-review-v2-table"
          />
        ) : (
          <div className="space-y-4">
              {budgetRowsByCurrency.map(({ currency: groupCurrency, rows }) => {
                const title = t('dashboard:finance.budgetCurrencyGroup', '{{currency}} · Five projects by budget variance', { currency: groupCurrency });
                return <section key={groupCurrency} aria-label={title}>
                  <h3 className="mb-2 px-4 text-xl font-bold">{title}</h3>
                  <DataTable<BudgetReviewRow>
                    rows={rows}
                    columns={budgetColumns(groupCurrency)}
                    rowKey={(p) => p.id}
                    sort={budgetSort}
                    onSort={(key) => setBudgetSort((prev) => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }))}
                    className="rounded-none border-0 bg-transparent"
                    tableId={`components-dashboard-financedashboard-budget-review-v2-${groupCurrency.toLowerCase()}`}
                  />
                </section>;
              })}
          </div>
        )}
        {!budgetError && !budgetPending && (budgetReview ?? []).some((project) => !canCompareActual(project)) && (
          <p data-testid="budget-comparison-unavailable-note" className="px-4 pb-3 text-sm text-muted-foreground">
            {t('dashboard:finance.comparisonUnavailable', 'Actual comparisons need complete source coverage in the project budget currency.')}{' '}
            <a className="inline-flex min-h-11 items-center text-xs font-semibold text-primary-text underline underline-offset-2" href="#finance-accounting-evidence">{t('dashboard:finance.reviewAccountingEvidence', 'Review accounting evidence')}</a>
          </p>
        )}
      </Card>

      <section aria-label={t('dashboard:finance.financialEvidence', 'Financial position and accounting evidence')}>
        <details id="finance-accounting-evidence" className="rounded-lg border border-border bg-card">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-xl font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <span>{t('dashboard:finance.financialEvidence', 'Financial position and accounting evidence')}</span>
            <span aria-hidden="true" className="text-muted-foreground">⌄</span>
          </summary>
          <div className="flex flex-col gap-4 border-t border-border p-4">
            <section aria-label={t('dashboard:finance.position', 'Financial position')}>
              <h3 className="text-xl font-bold">{t('dashboard:finance.positionCurrency', 'Financial position · {{currency}}', { currency: orgCurrency })}</h3>
              {isError && <ListState variant="error" title={t('dashboard:finance.dashboardError', "Couldn't load the finance dashboard")} onRetry={() => { void refetch(); }} />}
              {isPending && !data ? <ListState variant="loading" rows={4} /> : data ? (
                <>
                  <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3">
                    <div><dt className="text-xs font-semibold text-muted-foreground">{t('dashboard:finance.contractInProgress', 'Contract in progress')}</dt><dd className="mt-0.5 text-sm tabular">{positionValue(data.total_contract_value)}</dd></div>
                    <div>
                      <dt className="text-xs font-semibold text-muted-foreground">{t('dashboard:finance.knownSpending', 'Known spending')}</dt>
                      <dd className="mt-0.5 text-sm tabular">{positionValue(totalSpend)}</dd>
                      {(data.on_hand_actual_project_count < data.on_hand_actual_project_total || data.on_hand_actual_coverage_count < data.on_hand_actual_coverage_total)
                        && <span className="text-[0.6875rem] font-semibold text-muted-foreground">{t('dashboard:spend.partial', 'Partial')}</span>}
                    </div>
                    <div><dt className="text-xs font-semibold text-muted-foreground">{marginLabel}</dt><dd className="mt-0.5 text-sm tabular">{positionValue(data.on_hand_realized_margin)}</dd></div>
                    <div><dt className="text-xs font-semibold text-muted-foreground">{t('uxs03.contractRemaining', 'Contract remaining after known Actual')}</dt><dd className="mt-0.5 text-sm tabular">{positionValue(data.on_hand_contract_remaining)}</dd></div>
                  </dl>
                  <p className="mt-3 text-sm text-muted-foreground">{actualCoverage} · {t('dashboard:finance.marginBasis', 'Margin is billed-work revenue less recorded spending; it is not cash received.')}</p>
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
              compactEmpty
            />
            {hasMissingSnapshot && <p data-testid="finance-snapshot-unavailable-note" className="text-sm text-muted-foreground">{t('dashboard:finance.snapshotUnavailable', 'An accounting snapshot is not available yet.')} {snapshotRemedy}</p>}
          </div>
        </details>
      </section>

      <section aria-label={t('dashboard:finance.purchasingRequests', 'Purchasing requests')}>
        <details className="rounded-lg border border-border bg-card">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-xl font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <span>{t('dashboard:finance.purchasingRequests', 'Purchasing requests')}</span>
            <span aria-hidden="true" className="text-muted-foreground">⌄</span>
          </summary>
          <div className="border-t border-border p-4">
            <p className="text-sm text-muted-foreground">{t('uxs03.pmoPurchasingScope', 'ERP-native purchases are outside this PMO request chart.')}</p>
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
