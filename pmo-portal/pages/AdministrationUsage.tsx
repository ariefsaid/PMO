import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { AgentCostMetrics, type AgentCostRunStatsRow } from '@/src/components/admin/AgentCostMetrics';
import { DataTable, ListState, SelectField, type Column } from '@/src/components/ui';
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
  runStatsRows?: AgentCostRunStatsRow[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  isStatsPending?: boolean;
  isStatsError?: boolean;
  onRetryStats?: () => void;
}

export const AdministrationUsage: React.FC<AdministrationUsageProps> = ({
  rows,
  runStatsRows = [],
  isPending,
  isError,
  onRetry,
  isStatsPending = false,
  isStatsError = false,
  onRetryStats,
}) => {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const period = searchParams.get('period') ?? '';
  const action = searchParams.get('action') ?? '';
  const sort = searchParams.get('sort') === 'oldest' ? 'oldest' : 'newest';
  const updateSearch = (update: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(location.search);
    update(next);
    const serialized = next.toString();
    navigate(
      {
        pathname: location.pathname,
        search: serialized ? `?${serialized}` : '',
        hash: location.hash,
      },
      { replace: true, state: location.state },
    );
  };
  const updateFilter = (key: 'period' | 'action' | 'sort', value: string) => {
    updateSearch((next) => {
      if (!value || (key === 'sort' && value === 'newest')) next.delete(key);
      else next.set(key, value);
    });
  };
  const clearFilters = () => {
    updateSearch((next) => {
      next.delete('period');
      next.delete('action');
      next.delete('sort');
    });
  };
  const periods = useMemo(
    () => [...new Set(rows.map((row) => row.month))].sort((a, b) => b.localeCompare(a)),
    [rows],
  );
  const actions = useMemo(
    () => [...new Set(rows.map((row) => row.action))].sort((a, b) => a.localeCompare(b, i18n.resolvedLanguage ?? i18n.language)),
    [rows, i18n.language, i18n.resolvedLanguage],
  );
  const filteredRows = useMemo(
    () => rows
      .filter((row) => (!period || row.month === period) && (!action || row.action === action))
      .sort((a, b) => (sort === 'newest' ? b.month.localeCompare(a.month) : a.month.localeCompare(b.month))),
    [rows, period, action, sort],
  );
  const filteredStats = useMemo(
    () => runStatsRows.filter((row) => (!period || row.month === period) && (!action || row.action === action)),
    [runStatsRows, period, action],
  );

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
        title={t('admin.usage.loadError', "Couldn't load usage")}
        sub={t('admin.usage.loadErrorHelp', 'The request failed. Check your connection and try again.')}
        retryLabel={t('admin.retry', 'Retry')}
        onRetry={onRetry}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <ListState
        variant="empty"
        icon="admin"
        title={t('admin.usage.emptyTitle', 'No usage yet')}
        sub={t('admin.usage.emptyHelp', 'Agent usage appears here once your workspace starts using the assistant.')}
      />
    );
  }

  const noMatches = filteredRows.length === 0;
  // AC-USE-003: the margin column renders ONLY when at least one row has a computed margin
  // (CREDITS_PER_USD set server-side); otherwise it is hidden entirely (not shown as all-dashes).
  const hasMargin = filteredRows.some((r) => r.margin_usd !== null);
  // AC-USE-007: Provider cost is Operator-only — org_usage_summary() rows never carry
  // provider_cost_usd at all, so its presence on the FIRST row is the structural signal (every row
  // in a given render comes from the same RPC/persona; a mixed shape can't occur in practice).
  const hasProviderCost = filteredRows.length > 0 && 'provider_cost_usd' in filteredRows[0];
  const hasUnavailableProviderCost = hasProviderCost && filteredRows.some(
    (row) => 'provider_cost_usd' in row && row.provider_cost_usd === null,
  );

  const columns: Column<UsageRow>[] = [
    { key: 'action', header: t('admin.usage.actionColumn', 'Action'), cell: (r) => r.action },
    { key: 'month', header: t('admin.usage.monthColumn', 'Month'), cell: (r) => r.month },
    { key: 'runs', header: t('admin.usage.runsColumn', 'Runs'), cell: (r) => formatNumber(r.run_count) },
    {
      key: 'tokens',
      header: t('admin.usage.inputOutputTokens', 'Input / output tokens'),
      cell: (r) => `${formatNumber(r.prompt_tokens)} / ${formatNumber(r.completion_tokens)}`,
    },
    ...(hasProviderCost
      ? [
          {
            key: 'providerCost',
            header: t('admin.usage.providerCostColumn', 'Provider cost'),
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
    { key: 'cost', header: t('admin.usage.creditsChargedColumn', 'Credits charged'), cell: (r) => formatCurrencyFine(r.cost, PLATFORM_CURRENCY) },
    ...(hasMargin
      ? [{ key: 'margin', header: t('admin.usage.marginColumn', 'Margin'), cell: (r: UsageRow) => (r.margin_usd === null ? '—' : formatCurrencyFine(r.margin_usd, PLATFORM_CURRENCY)) } as Column<UsageRow>]
      : []),
  ];

  const periodOptions = [
    { value: '', label: t('admin.usage.allPeriods', 'All periods') },
    ...periods.map((value) => ({ value, label: value })),
  ];
  const actionOptions = [
    { value: '', label: t('admin.usage.allActions', 'All actions') },
    ...actions.map((value) => ({ value, label: value })),
  ];
  const sortOptions = [
    { value: 'newest', label: t('admin.usage.monthNewest', 'Month newest') },
    { value: 'oldest', label: t('admin.usage.monthOldest', 'Month oldest') },
  ];
  const periodLabel = period || t('admin.usage.allPeriodsShort', 'all periods');
  const actionLabel = action || t('admin.usage.allActionsShort', 'all actions');
  const scopeDescription = t('admin.usage.selectedScope', {
    period: periodLabel,
    action: actionLabel,
    defaultValue: 'Showing {{period}} · {{action}}.',
  });

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
        <SelectField label={t('admin.usage.period', 'Period')} value={period} onChange={(value) => updateFilter('period', value)} options={periodOptions} />
        <SelectField label={t('admin.usage.action', 'Action')} value={action} onChange={(value) => updateFilter('action', value)} options={actionOptions} />
        <SelectField label={t('admin.usage.sort', 'Sort')} value={sort} onChange={(value) => updateFilter('sort', value === 'oldest' ? 'oldest' : 'newest')} options={sortOptions} />
      </div>

      {noMatches ? (
        <div role="status" className="rounded-lg border border-border bg-card p-4">
          <p className="text-[13.5px] font-medium">{t('admin.usage.noMatches', 'No usage matches the selected filters.')}</p>
          <button
            type="button"
            className="mt-2 inline-flex min-h-11 items-center rounded-md px-2 text-[13px] font-medium text-nav-active-text underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            onClick={clearFilters}
          >
            {t('admin.usage.clearFilters', 'Clear filters')}
          </button>
        </div>
      ) : (
        <div>
          <p className="mb-2 text-[12.5px] text-muted-foreground">
            {t('admin.usage.creditsBasis', 'Credits charged use the platform USD billing unit; provider cost is separate.')}
          </p>
          <DataTable<UsageRow> rows={filteredRows} columns={columns} rowKey={(r) => `${r.month}-${r.owner_id}-${r.action}`} tableId="administrationusage-table" />
          {!hasMargin && (
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              {t('admin.usage.pricingUnavailable', 'Pricing not yet configured — margin will appear here once a per-credit USD rate is set.')}
            </p>
          )}
          {hasUnavailableProviderCost && (
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              {t('admin.usage.providerCostUnavailable', 'Provider cost is unavailable for this scope. Check provider pricing before comparing it with credits charged.')}
            </p>
          )}
        </div>
      )}

      <details className="rounded-lg border border-border bg-card">
        <summary className="flex min-h-11 cursor-pointer items-center px-4 py-2 text-[13.5px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {t('admin.usage.diagnostics', 'Diagnostics')}
        </summary>
        <div className="border-t border-border p-4">
          <AgentCostMetrics
            summaryRows={filteredRows}
            runStatsRows={filteredStats}
            isPending={isStatsPending}
            isError={isStatsError}
            onRetry={onRetryStats ?? onRetry}
            scopeDescription={scopeDescription}
          />
        </div>
      </details>
    </div>
  );
};
