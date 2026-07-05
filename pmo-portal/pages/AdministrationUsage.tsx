import React from 'react';
import { DataTable, ListState, type Column } from '@/src/components/ui';
import type { UsageSummaryRow, OperatorUsageSummaryRow } from '@/src/lib/db/usage';

/**
 * Administration › Usage section (ops-admin-surface S5, FR-USE-002/003/004/006). Sourced ONLY
 * from `org_usage_summary()` / `operator_usage_summary()` — the privacy line (NFR-PRIV-001): no
 * agent_events/agent_runs/agent_threads read ever reaches this component. `margin_usd` renders
 * conditionally (AC-USE-003): when every row's margin is null (CREDITS_PER_USD unset server-side,
 * FR-USE-006), the column is hidden and a "Pricing not yet configured" note explains why.
 */

type UsageRow = UsageSummaryRow | OperatorUsageSummaryRow;

/** Fine-grained USD formatter (formatCurrency's 0-decimal rounding is too coarse for sub-$1 costs). */
const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
function formatUsd(value: number): string {
  return usdFormatter.format(value);
}

export interface AdministrationUsageProps {
  rows: UsageRow[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
}

export const AdministrationUsage: React.FC<AdministrationUsageProps> = ({
  rows,
  isPending,
  isError,
  onRetry,
}) => {
  if (isPending) {
    return (
      <div className="rounded-lg border border-border bg-card">
        <ListState variant="loading" rows={4} />
      </div>
    );
  }

  if (isError) {
    return (
      <ListState
        variant="error"
        title="Couldn't load usage"
        sub="The request failed. Check your connection and try again."
        onRetry={onRetry}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <ListState
        variant="empty"
        icon="admin"
        title="No usage yet"
        sub="Agent usage appears here once your workspace starts using the assistant."
      />
    );
  }

  // AC-USE-003: the margin column renders ONLY when at least one row has a computed margin
  // (CREDITS_PER_USD set server-side); otherwise it is hidden entirely (not shown as all-dashes).
  const hasMargin = rows.some((r) => r.margin_usd !== null);

  const columns: Column<UsageRow>[] = [
    { key: 'month', header: 'Month', cell: (r) => r.month },
    { key: 'action', header: 'Action', cell: (r) => r.action },
    { key: 'runs', header: 'Runs', cell: (r) => r.run_count.toLocaleString() },
    {
      key: 'tokens',
      header: 'Tokens',
      cell: (r) => `${r.prompt_tokens.toLocaleString()} / ${r.completion_tokens.toLocaleString()}`,
    },
    { key: 'providerCost', header: 'Provider cost', cell: (r) => formatUsd(r.provider_cost_usd) },
    { key: 'cost', header: 'Credits spent', cell: (r) => formatUsd(r.cost) },
    ...(hasMargin
      ? [{ key: 'margin', header: 'Margin', cell: (r: UsageRow) => (r.margin_usd === null ? '—' : formatUsd(r.margin_usd)) } as Column<UsageRow>]
      : []),
  ];

  return (
    <div>
      <DataTable<UsageRow> rows={rows} columns={columns} rowKey={(r) => `${r.month}-${r.owner_id}-${r.action}`} />
      {!hasMargin && (
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          Pricing not yet configured — margin will appear here once a per-credit USD rate is set.
        </p>
      )}
    </div>
  );
};
