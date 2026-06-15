import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDashboard, useFinanceBudgetReview } from '@/src/hooks/useDashboard';
import { useProcurements } from '@/src/hooks/useProcurements';
import { KPITile } from '@/src/components/ui/KPITile';
import { AwaitingApprovalTile } from './AwaitingApprovalTile';
import { Card, CardHead } from '@/src/components/ui/Card';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import { ProgressBar } from '@/src/components/ui/ProgressBar';
import { ListState } from '@/src/components/ui/ListState';
import { formatCurrency } from '@/src/lib/format';
import { StatusBarChart } from './StatusBarChart';
import { procurementStatusTone } from './procurementStatusTone';
import { DashPageHead, DashGrid } from './layout';
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
function daysAgoLabel(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const days = Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  return `${days} days`;
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

  const viRows = useMemo(
    () => procurements.filter((p) => p.status === INVOICED_STATUS),
    [procurements],
  );

  const columns: Column<ProcurementWithRefs>[] = [
    {
      key: 'request',
      header: 'Request',
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
      header: 'Project',
      cell: (r) => (
        <span className="text-muted-foreground">{r.project?.name ?? '—'}</span>
      ),
    },
    {
      key: 'value',
      header: 'Value',
      align: 'num',
      sortKey: 'value',
      cell: (r) => (
        /* tabular class applied automatically by DataTable on align:num cells */
        <span>{formatCurrency(r.total_value)}</span>
      ),
    },
    {
      key: 'age',
      // FR-FIN-DEBT / OBS-FIN-DEBT-004: real vendor_invoiced_at (stamped on →'Vendor Invoiced',
      // migration 0022), falling back to updated_at only for legacy rows stamped before the migration.
      header: (
        <span title="Days since this vendor invoice was recorded (vendor_invoiced_at; falls back to last update for pre-2026-06 rows)">
          Invoiced
        </span>
      ),
      align: 'num',
      cell: (r) => (
        /* Age in days since vendor_invoiced_at (real invoice date) — text signal, not color-only */
        <span className="text-muted-foreground">{daysAgoLabel(r.vendor_invoiced_at ?? r.updated_at)}</span>
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
      rowLabel={(r) => `Open ${r.title}`}
      state={tableState}
      emptyTitle="Nothing awaiting payment"
      emptySub="All vendor invoices have been paid or none are awaiting action."
      errorTitle="Couldn't load invoices"
      onRetry={onRetry}
      className="rounded-t-none border-t-0"
    />
  );
};

// ── Variance helpers ─────────────────────────────────────────────────────

/**
 * Render the variance cell: "+$X over" (text-destructive) for over-budget,
 * "$Y left" (text-muted-foreground) for under-budget.
 * Reads the server-computed `variance` (committed basis, OD-BUDGET-2) — single source of truth.
 * Text + sign — NOT color-only (DESIGN.md a11y posture, plan §6).
 */
function VarianceCell({ project }: { project: BudgetReviewRow }) {
  const v = project.variance;
  if (v > 0) {
    // Over budget: destructive text WITH the word "over" so color is reinforcement only.
    // tabular applied automatically by DataTable on align:num <td>s — no redundant inner span class.
    return (
      <span className="text-destructive">
        {`+${formatCurrency(v)} over`}
      </span>
    );
  }
  // Under / on-budget: muted text WITH the word "left"
  return (
    <span className="text-muted-foreground">
      {`${formatCurrency(Math.abs(v))} left`}
    </span>
  );
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
  const { data, isPending, isError, refetch } = useDashboard();
  const { data: procurements, isPending: procPending, isError: procError, refetch: refetchProc } = useProcurements();
  // N17: portfolio-wide budget review — ALL budget>0 projects ranked by committed-basis variance,
  // computed server-side by get_finance_budget_review (OD-E). Replaces the FE re-sort of top_projects.
  // B-0.3: capture isError/refetch so the budget-review card can surface an error branch instead
  // of rendering the "No project spend yet" empty state on RPC failure (mirror ReadyToPayTable).
  const { data: budgetReview, isPending: budgetPending, isError: budgetError, refetch: refetchBudget } = useFinanceBudgetReview();

  // N17 client-side sort state. The RPC returns rows already ranked variance-desc (the default);
  // this only re-sorts when the user clicks another column header.
  const [budgetSort, setBudgetSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({
    key: 'variance',
    dir: 'desc',
  });

  const totalSpend = useMemo(
    () => (data?.top_projects ?? []).reduce((s, p) => s + (p.spent || 0), 0),
    [data?.top_projects],
  );
  const outstanding = useMemo(
    () => (procurements ?? [])
      .filter((p) => p.status === INVOICED_STATUS)
      .reduce((s, p) => s + (p.total_value || 0), 0),
    [procurements],
  );
  const procByStatus = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of procurements ?? []) counts.set(p.status, (counts.get(p.status) ?? 0) + 1);
    return [...counts.entries()].map(([status, count]) => ({
      status: status as Tables<'procurements'>['status'],
      count,
    }));
  }, [procurements]);

  // N17: portfolio-wide variance ranking (OD-E). budget>0 + variance-desc ordering are applied
  // SERVER-SIDE by get_finance_budget_review (committed basis). Here we only honor the user's
  // column-header re-sort, then slice to the top 5 for the card. The RPC default = variance desc,
  // so the initial render shows the worst bleeders without any client sort.
  const topByVariance = useMemo(() => {
    const sorted = [...(budgetReview ?? [])];
    const mul = budgetSort.dir === 'desc' ? -1 : 1;
    sorted.sort((a, b) => {
      if (budgetSort.key === 'variance') return (a.variance - b.variance) * mul;
      if (budgetSort.key === 'budget') return (a.budget - b.budget) * mul;
      if (budgetSort.key === 'spent') return (a.spent - b.spent) * mul;
      // utilization
      const uA = a.budget > 0 ? a.spent / a.budget : 0;
      const uB = b.budget > 0 ? b.spent / b.budget : 0;
      return (uA - uB) * mul;
    });
    return sorted.slice(0, 5);
  }, [budgetReview, budgetSort]);

  // N17 Budget review columns (sortable, with Variance column)
  const budgetColumns: Column<BudgetReviewRow>[] = [
    {
      key: 'name',
      header: 'Project',
      cell: (p) => <span className="font-medium">{p.name}</span>,
    },
    {
      key: 'budget',
      header: 'Budget',
      align: 'num',
      sortKey: 'budget',
      // tabular applied automatically by DataTable on align:num <td>s — no redundant inner span
      cell: (p) => <span>{formatCurrency(p.budget)}</span>,
    },
    {
      key: 'spent',
      header: 'Spent',
      align: 'num',
      sortKey: 'spent',
      cell: (p) => <span>{formatCurrency(p.spent)}</span>,
    },
    {
      key: 'variance',
      header: 'Variance',
      align: 'num',
      sortKey: 'variance',
      cell: (p) => <VarianceCell project={p} />,
    },
    {
      key: 'util',
      header: 'Utilization',
      align: 'num',
      sortKey: 'util',
      cell: (p) => (
        <ProgressBar
          value={p.budget > 0 ? Math.round((p.spent / p.budget) * 100) : 0}
          showValue
          compact
          aria-label={`${p.name} budget utilization`}
        />
      ),
    },
  ];

  if (isError || (!data && !isPending)) {
    return (
      <div className="space-y-4">
        <DashPageHead title="Finance Dashboard" sub="Portfolio revenue, spend, margin, and budget utilization." />
        <ListState variant="error" title="Couldn't load the finance dashboard" onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DashPageHead title="Finance Dashboard" sub="Portfolio revenue, spend, margin, and budget utilization." />

      {/* KPI band — 5 tiles: reflows 5→3→2→1 at 1180/920/560 (unchanged from PR-A) */}
      <section aria-label="Finance KPIs" className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2 min-[920px]:grid-cols-3 min-[1180px]:grid-cols-5">
        {/* AC-IXD-DASH-W5-C2A: Contracted revenue → /projects?filter=Ongoing */}
        <KPITile testId="kpi-revenue" tone="green" icon="dollar" label="Contracted revenue"
          value={formatCurrency(data?.total_contract_value ?? 0)} loading={isPending}
          to="/projects?filter=Ongoing"
          linkLabel="Open active projects to see contracted revenue"
          help="Total contract value across active and closed-out projects." />
        {/* AC-IXD-DASH-W5-C2A: Total project spend → /projects?filter=Ongoing */}
        <KPITile testId="kpi-spend" tone="red" icon="cart" label="Total project spend"
          value={formatCurrency(totalSpend)} loading={isPending}
          to="/projects?filter=Ongoing"
          linkLabel="Open active projects to see spend breakdown"
          help="Sum of actual spend across the portfolio's top projects." />
        {/* AC-IXD-DASH-W5-C2A: On-hand margin — PLAIN tile (OD-W5-C2-D: no single list view) */}
        <KPITile testId="kpi-margin" tone="blue" icon="up" label="On-hand margin"
          value={`${((data?.on_hand_margin ?? 0) * 100).toFixed(1)}%`} loading={isPending}
          vs={`${formatCurrency(data?.on_hand_value ?? 0)} on hand`}
          help="Realized actual margin on active + closed-out contracts." />
        {/* AC-IXD-DASH-W5-C2A: Outstanding invoices → /procurement?status=Vendor+Invoiced (N16) */}
        <KPITile testId="kpi-outstanding" tone="amber" icon="doc" label="Outstanding invoices"
          value={formatCurrency(outstanding)} loading={procPending}
          vs="vendor-invoiced, awaiting payment"
          to="/procurement?status=Vendor+Invoiced"
          linkLabel="Open vendor-invoiced requests awaiting payment"
          help="Sum of procurement value in the Vendor Invoiced state." />
        {/* N15: PRs-only approvals shortcut (Finance has no timesheet approval) → /approvals. */}
        <AwaitingApprovalTile includeTimesheets={false} label="PRs awaiting you" />
      </section>

      {/* Finance "ledger" block: Ready to pay + Budget review stacked full-width (C1 fix).
          Previously a 2-up DashGrid which clipped the 5-col budget table (~626px intrinsic)
          inside a ~492px half-card at 1280, and left a large void when Ready-to-pay was 1-row
          next to a 5-row table. Full-width stack: both tables span the content width, all 5
          budget columns (incl. Utilization + "over"/"left" Variance word) are fully visible
          at 1280 and 1440 with no horizontal clip, and the lopsided-void rhythm (J4) is gone. */}
      <section aria-label="Finance ledger" className="flex flex-col gap-4">
        {/* N16 — Ready to pay table */}
        <Card seam>
          <CardHead className="rounded-t-lg">Ready to pay</CardHead>
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
            Budget review — top 5 by variance (portfolio-wide)
          </CardHead>
          {/* B-0.3: RPC error must show an error/retry branch, not the "No project spend yet" empty.
              The DataTable's built-in empty state fires on error (budgetReview=undefined → topByVariance=[])
              — that's the false-empty. Mirror ReadyToPayTable: check isError first. */}
          {budgetError ? (
            <ListState
              variant="error"
              title="Couldn't load budget review"
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
              emptyTitle="No project spend yet"
              className="rounded-t-none border-t-0"
            />
          )}
        </Card>
      </section>

      <DashGrid>
        <Card>
          <CardHead>Procurement by Status</CardHead>
          <div className="px-4 pb-4 pt-2">
            {procError ? (
              <ListState variant="error" title="Couldn't load procurement" onRetry={() => refetchProc()} />
            ) : procPending ? (
              <ListState variant="loading" rows={6} />
            ) : procByStatus.length === 0 ? (
              <ListState variant="empty" icon="cart" title="No procurement activity yet" />
            ) : (
              <StatusBarChart data={procByStatus} toneFor={procurementStatusTone}
                label="Procurement by status" noun="requests" />
            )}
          </div>
        </Card>
      </DashGrid>
    </div>
  );
};
