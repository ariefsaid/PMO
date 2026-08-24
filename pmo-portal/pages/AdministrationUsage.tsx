import React from 'react';
import { DataTable, ListState, type Column } from '@/src/components/ui';
import type { UsageSummaryRow, OperatorUsageSummaryRow } from '@/src/lib/db/usage';
import { PLATFORM_CURRENCY, formatCurrencyFine, formatNumber } from '@/src/lib/format';

/**
 * Administration › Usage section (ops-admin-surface S5, FR-USE-002/003/004/006). Sourced ONLY
 * from `org_usage_summary()` / `operator_usage_summary()` — the privacy line (NFR-PRIV-001): no
 * agent_events/agent_runs/agent_threads read ever reaches this component. `margin_usd` renders
 * conditionally (AC-USE-003): when every row's margin is null (CREDITS_PER_USD unset server-side,
 * FR-USE-006), the column is hidden and a "Pricing not yet configured" note explains why.
 *
 * AC-USE-007 (owner decision, ops-admin Discover round 2026-07-06): "Provider cost" is PMO's raw
 * provider spend (the markup over credits charged) — Operator-only. `org_usage_summary()` (org-Admin
 * rows) no longer returns `provider_cost_usd` at all; the column renders ONLY when the rows carry
 * that field (Operator rows, from `operator_usage_summary()`).
 */

type UsageRow = UsageSummaryRow | OperatorUsageSummaryRow;

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
  // AC-USE-007: Provider cost is Operator-only — org_usage_summary() rows never carry
  // provider_cost_usd at all, so its presence on the FIRST row is the structural signal (every row
  // in a given render comes from the same RPC/persona; a mixed shape can't occur in practice).
  const hasProviderCost = rows.length > 0 && 'provider_cost_usd' in rows[0];

  const columns: Column<UsageRow>[] = [
    { key: 'month', header: 'Month', cell: (r) => r.month },
    { key: 'action', header: 'Action', cell: (r) => r.action },
    { key: 'runs', header: 'Runs', cell: (r) => formatNumber(r.run_count) },
    {
      key: 'tokens',
      header: 'Tokens',
      cell: (r) => `${formatNumber(r.prompt_tokens)} / ${formatNumber(r.completion_tokens)}`,
    },
    ...(hasProviderCost
      ? [
          {
            key: 'providerCost',
            header: 'Provider cost',
            // `in` tests key presence (the org row lacks this column entirely); it does NOT test null.
            // The RPC returns null when provider pricing is unconfigured, and formatting null
            // renders $0.00 — a real-looking zero for "unknown". Guard both, as margin does below.
            cell: (r: UsageRow) =>
              'provider_cost_usd' in r && r.provider_cost_usd !== null
                ? formatCurrencyFine(r.provider_cost_usd, PLATFORM_CURRENCY)
                : '—',
          } as Column<UsageRow>,
        ]
      : []),
    { key: 'cost', header: 'Credits spent', cell: (r) => formatCurrencyFine(r.cost, PLATFORM_CURRENCY) },
    ...(hasMargin
      ? [{ key: 'margin', header: 'Margin', cell: (r: UsageRow) => (r.margin_usd === null ? '—' : formatCurrencyFine(r.margin_usd, PLATFORM_CURRENCY)) } as Column<UsageRow>]
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
