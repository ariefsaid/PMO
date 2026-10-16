import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { formatDashboardMoney } from '@/src/lib/dashboardMoney';
import { ProgressBar } from '@/src/components/ui/ProgressBar';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { chartTheme } from '@/src/components/ui/chartTheme';
import type { TopProject } from '@/src/lib/db/dashboard';
import { isMoneyAtRisk } from '@/src/lib/dashboardConstants';
import { isActualComplete } from '@/src/lib/projectFinances';

export interface BvACardProps {
  projects: TopProject[];
  /** Org operating currency (the top-projects RPC carries no per-row currency) — FR-L10N-020. */
  currency: string;
}

/**
 * Plain-language contract comparison with a separate Active-budget risk signal.
 * Unknown Actual is never rendered as zero and never produces a progress bar.
 */
export const BvACard: React.FC<BvACardProps> = ({ projects, currency }) => {
  const { t, i18n } = useTranslation();
  const money = (value: number | null, rowCurrency: string = currency) => formatDashboardMoney(value, rowCurrency, i18n.language)
    ?? t('uxs03.notAvailableYet', 'Not available yet');
  return (
  <div role="group" aria-label={t('uxs03.spendingContract', 'Spending vs contract')} className="flex flex-col">
    {projects.map((p, i) => {
      const contract = p.contract_value;
      const actualComplete = isActualComplete({ basis: 'erp', readSucceeded: p.spent !== null, complete: p.actual_complete,
        coverageCount: p.actual_coverage_count, coverageTotal: p.actual_coverage_total });
      const pct = contract !== null && contract > 0 && actualComplete && (p.actual_currency ?? p.currency) === p.currency
        ? Math.round(((p.spent ?? 0) / contract) * 100) : null;
      const currenciesMatch = (p.actual_currency ?? p.currency) === (p.budget_currency ?? p.currency)
        && (p.actual_currency ?? p.currency) === p.currency;
      const utilization = p.budget !== null && p.budget > 0 && actualComplete && currenciesMatch ? (p.spent ?? 0) / p.budget : null;
      const atRisk = isMoneyAtRisk({ status: p.status, budget: p.budget, budgetCurrency: p.budget_currency ?? p.currency, projectCurrency: p.currency,
        spent: p.spent, actualCurrency: p.actual_currency ?? p.currency, actualComplete });
      const dot = chartTheme.categorical[i % chartTheme.categorical.length];

      return (
        <div
          key={p.id}
          data-row
          className="flex flex-col gap-2 border-b border-border/70 py-3 last:border-b-0"
        >
          {/* flex-wrap: at 390px the name + money values wrap to a second line (C-Mobile). */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: dot }}
            />
            <Link
              to={`/projects/${p.id}`}
              className="min-w-0 truncate text-[13px] font-semibold hover:text-primary-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              {p.name}
            </Link>
            {atRisk && <StatusPill variant="warn">{t('dashboard.bva.atRisk', 'At risk')}</StatusPill>}
            <span className="ml-auto shrink-0 text-[12px] tabular text-muted-foreground">
              {money(actualComplete ? p.spent : null, p.actual_currency ?? p.currency)} / {money(contract, p.currency)}
            </span>
            {/* D-2 (AC-JR-W3B-04): decorative trailing chevron removed — it was a false
                affordance implying the row is clickable while only the name Link above is
                interactive. The "At risk" StatusPill above is the exception badge; the name
                Link is the affordance. No chevron needed. */}
          </div>
          {/* widthless: no outer min-w so the bar fills the flex row at any viewport width.
              [&>span:first-child]:flex-1 ensures the track expands in the flex container. */}
          {pct !== null && <ProgressBar
            value={pct}
            widthless
            className="w-full [&>span:first-child]:flex-1"
            aria-label={t('uxs03.spendingContractBar', '{{name}}: {{percent}}% of contract', { name: p.name, percent: pct })}
          />}
          <span className="text-[12px] text-muted-foreground">
            {t('uxs03.activeBudgetRisk', 'Active-budget risk')}: {p.budget !== null && p.budget > 0 && utilization !== null
              ? `${Math.round(utilization * 100)}%` : p.budget !== null && p.budget > 0
                ? t('uxs03.notAvailableYet', 'Not available yet') : t('uxs03.noActiveBudget', 'No active budget')}
          </span>
          {p.actual_coverage_total != null && p.actual_coverage_total > (p.actual_coverage_count ?? 0) && (
            <span className="text-[12px] text-muted-foreground">
              {t('uxs03.coverageCategories', 'Actual coverage: {{known}} of {{total}} mapped cost categories', {
                known: p.actual_coverage_count ?? 0, total: p.actual_coverage_total,
              })}
            </span>
          )}
        </div>
      );
    })}
  </div>
  );
};
