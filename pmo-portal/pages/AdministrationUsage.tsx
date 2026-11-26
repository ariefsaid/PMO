import React from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, ListState, type Column } from '@/src/components/ui';
import type { UsageSummaryRow, OperatorUsageSummaryRow } from '@/src/lib/db/usage';
import { PLATFORM_CURRENCY, formatCurrencyFine, formatNumber, formatUtcMonthYearFull } from '@/src/lib/format';

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

/** "Jul 2026" from the RPC's month-start date; missing or unparseable values have no display month. */
function monthBucket(month: string | null): string | null {
  if (!month) return null;
  const parsed = new Date(month);
  return Number.isNaN(parsed.getTime()) ? null : formatUtcMonthYearFull(parsed);
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
  const { t } = useTranslation('administration');
  if (isPending) {
    return (
      <div className="rounded-lg border border-border bg-card">
        <ListState variant="loading" shape="table" rows={4} />
      </div>
    );
  }

  if (isError) {
    return (
      <ListState
        variant="error"
        title={t('usage.errorTitle', "Couldn't load usage")}
        sub={t('usage.errorSub', 'The request failed. Check your connection and try again.')}
        onRetry={onRetry}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <ListState
        variant="empty"
        icon="admin"
        title={t('usage.emptyTitle', 'No usage yet')}
        sub={t('usage.emptySub', 'Agent usage appears here once your workspace starts using the assistant.')}
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
    // The RPC's month bucket is a UTC month-start DATE; a raw `2026-07-01` is an ISO string on
    // screen (ux/1110 rule 1), so it goes through the shared UTC-pinned month formatter — the same
    // UTC pin the sibling agent-cost dashboard uses for its month buckets.
    { key: 'month', size: 125, header: t('usage.month', 'Month'), cell: (r) => monthBucket(r.month) ?? t('usage.monthUnavailable', 'Month unavailable') },
    { key: 'action', size: 140, header: t('usage.action', 'Action'), cell: (r) => r.action },
    { key: 'runs', kind: 'number', size: 75, header: t('usage.runs', 'Runs'), cell: (r) => formatNumber(r.run_count) },
    {
      key: 'promptTokens', kind: 'number', size: 125,
      header: t('usage.promptTokens', 'Input tokens'),
      cell: (r) => formatNumber(r.prompt_tokens),
    },
    {
      key: 'completionTokens', kind: 'number', size: 125,
      header: t('usage.completionTokens', 'Output tokens'),
      cell: (r) => formatNumber(r.completion_tokens),
    },
    ...(hasProviderCost
      ? [
          {
            key: 'providerCost',
            kind: 'money',
            size: 135,
            header: t('usage.providerCost', 'Provider cost'),
            keepWhenBlank: true,
            // `in` tests key presence (the org row lacks this column entirely); it does NOT test null.
            // The RPC returns null when provider pricing is unconfigured, and formatting null
            // renders $0.00 — a real-looking zero for "unknown". Guard both, as margin does below.
            cell: (r: UsageRow) =>
              'provider_cost_usd' in r && r.provider_cost_usd !== null
                ? formatCurrencyFine(r.provider_cost_usd, PLATFORM_CURRENCY)
                : t('usage.providerPricingUnavailable', 'Provider pricing unavailable'),
          } as Column<UsageRow>,
        ]
      : []),
    { key: 'cost', kind: 'money', size: 105, header: t('usage.cost', 'Cost (USD)'), cell: (r) => formatCurrencyFine(r.cost, PLATFORM_CURRENCY) },
    ...(hasMargin
      ? [{ key: 'margin', kind: 'money', size: 105, header: t('usage.margin', 'Margin'), cell: (r: UsageRow) => (r.margin_usd === null ? t('usage.marginUnavailable', 'Pricing unavailable') : formatCurrencyFine(r.margin_usd, PLATFORM_CURRENCY)) } as Column<UsageRow>]
      : []),
  ];

  return (
    <div>
      <DataTable<UsageRow> rows={rows} columns={columns} rowKey={(r) => `${r.month}-${r.owner_id}-${r.action}`} tableId="administrationusage-table" cardBelow={810} />
      {!hasMargin && (
        <p className="mt-2 text-control text-muted-foreground">
          {t('usage.pricingNote', 'Pricing not yet configured — margin will appear here once a per-credit USD rate is set.')}
        </p>
      )}
    </div>
  );
};
