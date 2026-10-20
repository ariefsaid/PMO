import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useDashboard, useFinanceBudgetReview } from '@/src/hooks/useDashboard';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useCompanies } from '@/src/hooks/useCompanies';
import { useProjectIdentity } from '@/src/hooks/useProjects';
import { useCompanyCollections } from '@/src/hooks/useCompanyCollections';
import { useActualsSnapshot, useApAgingSnapshot, useArAgingSnapshot } from '@/src/hooks/useErpSnapshots';
import { AccountingSnapshotsSection } from './AccountingSnapshotsSection';
import { KPITile } from '@/src/components/ui/KPITile';
import { AwaitingApprovalTile } from './AwaitingApprovalTile';
import { StillToInvoiceCard } from './StillToInvoiceCard';
import { Card, CardHead } from '@/src/components/ui/Card';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import { ProgressBar } from '@/src/components/ui/ProgressBar';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { ListState } from '@/src/components/ui/ListState';
import { formatCurrency, formatInstantDate } from '@/src/lib/format';
import { moneyFigure, shortMoney } from '@/src/lib/dashboardMoney';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { StatusBarChart } from './StatusBarChart';
import { procurementStatusTone } from './procurementStatusTone';
import { DashPageHead, DashGrid } from './layout';
import { isMoneyAtRisk } from '@/src/lib/dashboardConstants';
import type { BudgetReviewRow } from '@/src/lib/db/dashboard';
import type { Tables } from '@/src/lib/supabase/database.types';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

/** The procurement status meaning "billed, awaiting payment" (plan Open Q6). */
const INVOICED_STATUS: Tables<'procurements'>['status'] = 'Vendor Invoiced';

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
  const navigate = useNavigate();
  const { t } = useTranslation('dashboard');

  const viRows = useMemo(
    () => procurements.filter((p) => p.status === INVOICED_STATUS),
    [procurements],
  );

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
        <span className="text-muted-foreground">{r.project?.name ?? '—'}</span>
      ),
    },
    {
      key: 'value',
      header: t('dashboard:finance.value', 'Value'),
      align: 'num',
      sortKey: 'value',
      cell: (r) => (
        /* tabular class applied automatically by DataTable on align:num cells */
        <span>{formatCurrency(r.total_value, r.currency)}</span>
      ),
    },
    {
      key: 'age',
      // FR-FIN-DEBT / OBS-FIN-DEBT-004: real vendor_invoiced_at (stamped on →'Vendor Invoiced',
      // migration 0022), falling back to updated_at only for legacy rows stamped before the migration.
      header: (
        <span title={t('dashboard:finance.invoicedHelp', 'Days since the vendor invoice was recorded; older records use their last update date.') }>
          {t('dashboard:finance.invoiced', 'Invoiced')}
        </span>
      ),
      align: 'num',
      cell: (r) => (
        /* Age in days since vendor_invoiced_at (real invoice date) — text signal, not color-only */
        <span className="text-muted-foreground">{daysAgoLabel(r.vendor_invoiced_at ?? r.updated_at, t)}</span>
      ),
    },
  ];

  const tableState: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError
      ? 'error'
      : viRows.length === 0
        ? 'empty'
        : undefined;

  return (
    <DataTable<ProcurementWithRefs>
      rows={viRows}
      columns={columns}
      rowKey={(r) => r.id}
      onActivate={(r) => navigate(`/procurement/${r.id}`)}
      rowLabel={(r) => t('dashboard:finance.openRequest', 'Open {{request}}', { request: r.title })}
      state={tableState}
      emptyTitle={t('dashboard:finance.nothingAwaitingPayment', 'Nothing awaiting payment')}
      emptySub={t('dashboard:finance.allInvoicesPaid', 'All vendor invoices have been paid or none are awaiting action.')}
      errorTitle={t('dashboard:finance.loadInvoicesError', "Couldn't load invoices")}
      onRetry={onRetry}
      className="rounded-t-none border-t-0"
    tableId="components-dashboard-financedashboard-1-table" />
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
  const { t, i18n } = useTranslation('dashboard');
  const { data, isPending, isError, refetch } = useDashboard();
  const { data: projects } = useProjectIdentity();
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

  // OD-MONEY-FMT: KPI cards show the short form; the exact amount rides in title + sr text.
  const notAvailable = t('uxs03.notAvailableYet', 'Not available yet');
  const money = (value: number | null) => shortMoney(value, orgCurrency, notAvailable);
  const figure = (value: number | null) => moneyFigure(value, orgCurrency, i18n.language, notAvailable);
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
  const outstanding = useMemo(() => {
    const invoiced = (procurements ?? []).filter((p) => p.status === INVOICED_STATUS);
    const currencies = new Set(invoiced.map((p) => p.currency));
    if (currencies.size > 1 || invoiced.some((p) => typeof p.total_value !== 'number' || !Number.isFinite(p.total_value))) return null;
    return invoiced.reduce((sum, p) => sum + p.total_value, 0);
  }, [procurements]);
  const procByStatus = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of procurements ?? []) counts.set(p.status, (counts.get(p.status) ?? 0) + 1);
    return [...counts.entries()].map(([status, count]) => ({
      status: status as Tables<'procurements'>['status'],
      count,
    }));
  }, [procurements]);

  // N17: portfolio-wide Active-budget variance ranking. Positive usable Active budget and default
  // variance ordering are applied SERVER-SIDE by get_finance_budget_review. Here we only honor the user's
  // column-header re-sort, then slice to the top 5 for the card. The RPC default = variance desc,
  // so the initial render shows the worst bleeders without any client sort.
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
        const atRisk = isMoneyAtRisk({
          status: p.status,
          budget: p.budget,
          budgetCurrency: p.budget_currency,
          projectCurrency: p.currency,
          spent: p.spent,
          actualCurrency: p.actual_currency,
          actualComplete: p.actual_complete,
        });
        return (
          <span className="inline-flex items-center gap-2">
            <Link
              to={`/projects/${p.id}/budget`}
              aria-label={t('dashboard.budgetReviewLink', 'Review {{project}} budget', { project: p.name })}
              className="font-medium text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              {p.name}
            </Link>
            {atRisk && <StatusPill variant="warn">{t('uxs03.atRisk', 'At risk')}</StatusPill>}
          </span>
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

  if (isError || (!data && !isPending)) {
    return (
      <div className="space-y-4">
        <DashPageHead
          title={t('uxs03.financeDashboardTitle', 'Finance Dashboard')}
          sub={t('uxs03.financeDashboardSubtitle', 'Portfolio revenue, spend, margin, and budget utilization.')}
        />
        <ListState variant="error" title={t('dashboard:finance.dashboardError', "Couldn't load the finance dashboard")} onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DashPageHead
        title={t('uxs03.financeDashboardTitle', 'Finance Dashboard')}
        sub={t('uxs03.financeDashboardSubtitle', 'Portfolio revenue, spend, margin, and budget utilization.')}
      />

      {/* KPI band — 5 tiles: reflows 5→3→2→1 at 1180/920/560 (unchanged from PR-A) */}
      <section aria-label={t('uxs03.attentionAndApprovals', 'Attention and approvals')} className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2">
        <AwaitingApprovalTile includeTimesheets={false} label={t('dashboard:finance.awaiting', 'Purchase requests awaiting your decision')} />
      </section>
      <section aria-label={t('dashboard:finance.kpiBand', 'Finance KPIs')} className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2 min-[920px]:grid-cols-3 min-[1180px]:grid-cols-5">
        {/* AC-IXD-DASH-W5-C2A: Contracted revenue → /projects?filter=Ongoing */}
        <KPITile testId="kpi-revenue" tone="green" icon="dollar" label={t('dashboard:finance.contractValue', 'Contract value in progress')}
          {...figure(data?.total_contract_value ?? null)} loading={isPending}
          to="/projects?filter=Ongoing"
          linkLabel={t('dashboard:finance.contractValueLink', 'Open active projects to see contract value')}
          help={t('dashboard:finance.contractValueHelp', 'Total contract value across active projects.')} />
        {/* AC-IXD-DASH-W5-C2A: Total project spend → /projects?filter=Ongoing */}
        <KPITile testId="kpi-spend" tone="red" icon="cart" label={t('dashboard:finance.recordedSpending', 'Recorded spending')}
          {...figure(totalSpend)} loading={isPending} vs={`${data && (data.on_hand_actual_project_count < data.on_hand_actual_project_total || data.on_hand_actual_coverage_count < data.on_hand_actual_coverage_total) ? `${t('dashboard:spend.partial', 'Partial')} · ` : ''}${actualCoverage}`}
          to="/projects?filter=Ongoing"
          linkLabel={t('dashboard:finance.spendingLink', 'Open active projects to see spending details')}
          help={t('dashboard:finance.spendingHelp', 'Actual spending recorded across the delivery portfolio.')} />
        {/* AC-IXD-DASH-W5-C2A: On-hand margin — PLAIN tile (OD-W5-C2-D: no single list view) */}
        <KPITile testId="kpi-margin" tone="blue" icon="up" label={t('dashboard:finance.margin', 'Margin to date')}
          {...figure(data?.on_hand_realized_margin ?? null)} loading={isPending}
          vs={t('uxs03.contractRemaining', 'Contract remaining after known Actual') + ': ' + money(data?.on_hand_contract_remaining ?? null)
            + ' · ' + marginLabel + ': ' + money(data?.on_hand_realized_margin ?? null) + ' · ' + actualCoverage}
          help={t('dashboard:finance.marginHelp', 'Billed-work revenue less recorded spending; this is not cash received.')} />
        {/* AC-IXD-DASH-W5-C2A: Outstanding invoices → /procurement?status=Vendor+Invoiced (N16) */}
        <KPITile testId="kpi-outstanding" tone="amber" icon="doc" label={t('dashboard:finance.payables', 'Vendor payables')}
          {...figure(outstanding)} loading={procPending}
          vs={t('dashboard:finance.payablesDetail', 'Vendor-invoiced, awaiting payment')}
          to="/procurement?status=Vendor+Invoiced"
          linkLabel={t('dashboard:finance.payablesLink', 'Open vendor invoices awaiting payment')}
          help={t('dashboard:finance.payablesHelp', 'Procurement value owed to vendors in the Vendor Invoiced state.')} />
      </section>

      {/* OD-BILL-1 / #786: what is still to invoice on the client's POs. */}
      <StillToInvoiceCard />

      {/* Finance "ledger" block: Ready to pay + Budget review stacked full-width (C1 fix).
          Previously a 2-up DashGrid which clipped the 5-col budget table (~626px intrinsic)
          inside a ~492px half-card at 1280, and left a large void when Ready-to-pay was 1-row
          next to a 5-row table. Full-width stack: both tables span the content width, all 5
          budget columns (incl. Utilization + "over"/"left" Variance word) are fully visible
          at 1280 and 1440 with no horizontal clip, and the lopsided-void rhythm (J4) is gone. */}
      <section aria-label="Finance ledger" className="flex flex-col gap-4">
        {/* N16 — Ready to pay table */}
        <Card seam>
          <CardHead className="rounded-t-lg">{t('uxs03.financeReadyToPay', 'Ready to pay')}</CardHead>
          <ReadyToPayTable
            procurements={procurements ?? []}
            isPending={procPending}
            isError={procError}
            onRetry={() => refetchProc()}
          />
        </Card>

        {/* N17 — Budget review by variance (OD-E: true portfolio-wide ranking) */}
        <Card seam>
          {/* OD-E honest label: this is now a TRUE portfolio-wide ranking. get_finance_budget_review
              ranks ALL budget>0 projects in the org by committed-basis variance (server-side); the
              card shows the worst 5. No longer a contract-value pre-slice re-sorted on the client. */}
          <CardHead className="rounded-t-lg">
            {t('uxs03.financeBudgetReviewTitle', 'Budget review — top 5 by variance (portfolio-wide)')}
          </CardHead>
          {/* B-0.3: RPC error must show an error/retry branch, not the "No project spend yet" empty.
              The DataTable's built-in empty state fires on error (budgetReview=undefined → topByVariance=[])
              — that's the false-empty. Mirror ReadyToPayTable: check isError first. */}
          {budgetError ? (
            <ListState
              variant="error"
              title={t('dashboard:finance.budgetReviewLoadError', "Couldn't load budget review")}
              onRetry={() => refetchBudget()}
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
            tableId="components-dashboard-financedashboard-2-table" />
          )}
        </Card>
      </section>

      {/* task FIX-2 (Discover CRITICAL 2): read-only ERP actuals + AP/AR aging snapshots
          (ADR-0048 ledger-sourced-display — renders mirrored figures as-is, never recomputes). */}
      <AccountingSnapshotsSection
        actuals={actuals ?? []}
        actualsPending={actualsPending}
        actualsError={actualsError}
        onRetryActuals={() => refetchActuals()}
        apAging={apAging ?? []}
        apAgingPending={apAgingPending}
        apAgingError={apAgingError}
        onRetryApAging={() => refetchApAging()}
        arAging={arAging ?? []}
        arAgingPending={arAgingPending}
        arAgingError={arAgingError}
        onRetryArAging={() => refetchArAging()}
        customerLinks={customerLinks}
        actualProjectNames={new Map((projects ?? []).map((project) => [project.id, project.name]))}
      />

      <DashGrid>
        <Card>
          <CardHead>{t('uxs03.pmoPurchasing', 'PMO purchasing requests')}</CardHead>
          <p className="px-4 text-xs text-muted-foreground">{t('uxs03.pmoPurchasingScope', 'ERP-native purchases are outside this PMO request chart.')}</p>
          <div className="px-4 pb-4 pt-2">
            {procError ? (
              <ListState variant="error" title="Couldn't load procurement" onRetry={() => refetchProc()} />
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
        </Card>
      </DashGrid>
    </div>
  );
};
