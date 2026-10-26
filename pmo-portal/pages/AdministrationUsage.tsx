import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { AgentCostMetrics, type AgentCostRunStatsRow } from '@/src/components/admin/AgentCostMetrics';
import { DataTable, DisclosureSummary, ListState, SelectField, type Column } from '@/src/components/ui';
import type { UsageSummaryRow, OperatorUsageSummaryRow } from '@/src/lib/db/usage';
import { formatNumber, formatNumberFine } from '@/src/lib/format';

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
        title={t('administration:admin.usage.loadError', "Couldn't load usage")}
        sub={t('administration:admin.usage.loadErrorHelp', 'The request failed. Check your connection and try again.')}
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
        title={t('administration:admin.usage.emptyTitle', 'No usage yet')}
        sub={t('administration:admin.usage.emptyHelp', 'Agent usage appears here once your workspace starts using the assistant.')}
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
  const creditsCharged = filteredRows.reduce((total, row) => total + row.cost, 0);

  const columns: Column<UsageRow>[] = [
    { key: 'action', header: t('administration:admin.usage.actionColumn', 'Action'), cell: (r) => r.action },
    { key: 'month', header: t('administration:admin.usage.monthColumn', 'Month'), cell: (r) => r.month },
    { key: 'runs', header: t('administration:admin.usage.runsColumn', 'Runs'), cell: (r) => formatNumber(r.run_count) },
    {
      key: 'tokens',
      header: t('administration:admin.usage.inputOutputTokens', 'Input / output tokens'),
      cell: (r) => `${formatNumber(r.prompt_tokens)} / ${formatNumber(r.completion_tokens)}`,
    },
    ...(hasProviderCost
      ? [
          {
            key: 'providerCost',
            header: t('administration:admin.usage.providerCostColumn', 'Provider cost'),
            // `in` tests key presence (the org row lacks this column entirely); it does NOT test null.
            // The RPC returns null when provider pricing is unconfigured; guard it explicitly so
            // an unknown cost never becomes a real-looking zero in this plain-number column.
            cell: (r: UsageRow) =>
              'provider_cost_usd' in r && r.provider_cost_usd !== null
                ? formatNumberFine(r.provider_cost_usd)
                : '—',
          } as Column<UsageRow>,
        ]
      : []),
    { key: 'cost', header: t('administration:admin.usage.creditsChargedColumn', 'Credits charged'), cell: (r) => formatNumberFine(r.cost) },
    ...(hasMargin
      ? [{ key: 'margin', header: t('administration:admin.usage.marginColumn', 'Margin'), cell: (r: UsageRow) => (r.margin_usd === null ? '—' : formatNumberFine(r.margin_usd)) } as Column<UsageRow>]
      : []),
  ];

  const periodOptions = [
    { value: '', label: t('administration:admin.usage.allPeriods', 'All periods') },
    ...periods.map((value) => ({ value, label: value })),
  ];
  const actionOptions = [
    { value: '', label: t('administration:admin.usage.allActions', 'All actions') },
    ...actions.map((value) => ({ value, label: value })),
  ];
  const sortOptions = [
    { value: 'newest', label: t('administration:admin.usage.monthNewest', 'Month newest') },
    { value: 'oldest', label: t('administration:admin.usage.monthOldest', 'Month oldest') },
  ];
  const periodLabel = period || t('administration:admin.usage.allPeriodsShort', 'all periods');
  const actionLabel = action || t('administration:admin.usage.allActionsShort', 'all actions');
  const scopeDescription = t('administration:admin.usage.selectedScope', {
    period: periodLabel,
    action: actionLabel,
    defaultValue: 'Showing {{period}} · {{action}}.',
  });

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
        <SelectField label={t('administration:admin.usage.period', 'Period')} value={period} onChange={(value) => updateFilter('period', value)} options={periodOptions} />
        <SelectField label={t('administration:admin.usage.action', 'Action')} value={action} onChange={(value) => updateFilter('action', value)} options={actionOptions} />
        <SelectField label={t('administration:admin.usage.sort', 'Sort')} value={sort} onChange={(value) => updateFilter('sort', value === 'oldest' ? 'oldest' : 'newest')} options={sortOptions} />
      </div>

      {noMatches ? (
        <div role="status" className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium">{t('administration:admin.usage.noMatches', 'No usage matches the selected filters.')}</p>
          <button
            type="button"
            className="mt-2 inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-nav-active-text underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            onClick={clearFilters}
          >
            {t('administration:admin.usage.clearFilters', 'Clear filters')}
          </button>
        </div>
      ) : (
        <section aria-labelledby="usage-consumption-heading" className="min-w-0">
          <h2 id="usage-consumption-heading" className="mb-4 text-xl font-bold tracking-[-0.01em]">
            {t('administration:admin.usage.creditsChargedColumn', 'Credits charged')} · USD{' '}
            <span className="tabular" data-testid="usage-primary-figure">{formatNumberFine(creditsCharged)}</span>
          </h2>
          <p className="mb-2 text-sm text-muted-foreground">{scopeDescription}</p>
          <p className="mb-2 text-sm text-muted-foreground">
            {t('administration:admin.usage.providerCostSeparate', 'Provider cost is reported separately from credits charged.')}
          </p>
          <DataTable<UsageRow> rows={filteredRows} columns={columns} rowKey={(r) => `${r.month}-${r.owner_id}-${r.action}`} tableId="administrationusage-table" />
          {!hasMargin && (
            <p className="mt-2 text-sm text-muted-foreground">
              {t('administration:admin.usage.pricingUnavailable', 'Pricing not yet configured — margin will appear once a per-credit rate is set.')}
            </p>
          )}
          {hasUnavailableProviderCost && (
            <p className="mt-2 text-sm text-muted-foreground">
              {t('administration:admin.usage.providerCostUnavailable', 'Provider cost is unavailable for this scope. Check provider pricing before comparing it with credits charged.')}
            </p>
          )}
        </section>
      )}

      <details className="group rounded-lg border border-border bg-card px-4">
        <DisclosureSummary className="py-2 text-sm font-semibold">
          {t('administration:admin.usage.diagnostics', 'Diagnostics')}
        </DisclosureSummary>
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
