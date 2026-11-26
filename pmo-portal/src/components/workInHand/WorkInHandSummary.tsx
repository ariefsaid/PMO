import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, ListState } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useWorkInHand } from '@/src/hooks/useWorkInHand';
import { formatExactCents } from '@/src/lib/exactDecimal';
import { formatExactMoney } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { formatBacklogTenths, workInHandSummary } from '@/src/lib/workInHand';

export interface WorkInHandSummaryProps {
  /** Destination link on Projects and Management Dashboard; omit on the Work in hand page itself. */
  showLink?: boolean;
  /** Omit CardHead when embedded under a page that already renders the Work in hand PageHeader. */
  showHeader?: boolean;
  /** Optional className on the outer card. */
  className?: string;
  testId?: string;
}

/**
 * M8: Value of work in hand and capacity-based months of work in hand, shared by Projects,
 * Management Dashboard (Executive, Admin, Finance, PM), and the Work in hand page.
 *
 * Rulings:
 * - Capacity is in the organisation's currency.
 * - Months = work in hand in that currency / capacity.
 * - Other currencies are shown beside it, labelled, and stated as not included in months (no conversion).
 * - When no capacity is set, the months line states so (with a settings link for Admin).
 */
export const WorkInHandSummary: React.FC<WorkInHandSummaryProps> = ({
  showLink = true,
  showHeader = true,
  className,
  testId = 'work-in-hand-summary',
}) => {
  const { t } = useTranslation('workInHand');
  const locale = getNumberLocale();
  const may = usePermission();
  const canView = may('view', 'workInHand');
  const isProjectManager = may('viewAssigned', 'workInHand');
  const canManageCapacity = may('manage', 'workInHandCapacity');
  const query = useWorkInHand(canView);

  if (!canView) return null;

  const money = (cents: bigint, currency: string) =>
    formatExactMoney(formatExactCents(cents), currency, locale, { wholeUnits: true }) ?? `${currency} ${formatExactCents(cents)}`;

  const title = isProjectManager
    ? t('titleManaged', 'My work in hand')
    : t('title', 'Work in hand');

  const actions = showLink ? (
    <Link
      to="/projects/work-in-hand"
      className="touch-target touch-target-overlay inline-flex items-center text-control font-medium text-primary-text underline-offset-4 hover:underline"
      data-testid={`${testId}-link`}
    >
      {t('summary.openLink', 'Open work in hand')}
    </Link>
  ) : undefined;

  if (query.isLoading) {
    return (
      <Card role="region" aria-label={title} data-testid={testId} className={className}>
        {showHeader && <CardHead level={2} actions={actions}>{title}</CardHead>}
        <CardPad><ListState variant="loading" shape="figure" /></CardPad>
      </Card>
    );
  }

  if (query.isError) {
    return (
      <Card role="region" aria-label={title} data-testid={testId} className={className}>
        {showHeader && <CardHead level={2} actions={actions}>{title}</CardHead>}
        <CardPad>
          <ListState
            variant="error"
            quiet
            title={t('error.title', "Couldn't load work in hand")}
            retryLabel={t('error.retry', 'Try again')}
            onRetry={() => void query.refetch()}
          />
        </CardPad>
      </Card>
    );
  }

  if (!query.facts) return null;

  const summary = workInHandSummary(query.rows, query.facts.orgCurrency, query.facts.monthlyCapacity ?? null);
  const otherCurrencyTexts = summary.otherCurrencies.map((item) => money(item.leftToBillCents, item.currency));
  const otherCurrencyCodes = summary.otherCurrencies.map((item) => item.currency).join(', ');

  return (
    <Card role="region" aria-label={title} data-testid={testId} className={className}>
      {showHeader && <CardHead level={2} actions={actions}>{title}</CardHead>}
      <div className={`grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 ${showHeader ? '[&>:first-child]:pt-0 sm:[&>*]:pt-0' : ''}`}>
        <div className="flex min-w-0 flex-col gap-1.5 px-[var(--panel-inset)] py-4" data-testid={`${testId}-value`}>
          <div className="text-control font-medium text-foreground">
            {t('summary.value', 'Value of work in hand')}
          </div>
          <div className="text-metric font-semibold tracking-[-0.02em] tabular text-foreground">
            {money(summary.orgLeftToBillCents, summary.orgCurrency)}
          </div>
          {summary.otherCurrencies.length > 0 && (
            <div className="mt-auto text-control text-muted-foreground" data-testid={`${testId}-other-currencies`}>
              {t('summary.otherCurrencies', 'Other currencies (not included in months): {{amounts}}', {
                amounts: otherCurrencyTexts.join(' · '),
              })}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 px-[var(--panel-inset)] py-4" data-testid={`${testId}-months`}>
          <div className="text-control font-medium text-foreground">
            {t('summary.months', 'Months of work in hand')}
          </div>
          {summary.monthsTenths !== null && summary.capacityCents !== null ? (
            <>
              <div className="text-metric font-semibold tracking-[-0.02em] tabular text-foreground">
                {t('summary.monthsValue', '{{months}} months', { months: formatBacklogTenths(summary.monthsTenths) })}
              </div>
              <div className="mt-auto text-control text-muted-foreground">
                {t('summary.capacityBasis', 'Based on {{capacity}}/month', {
                  capacity: money(summary.capacityCents, summary.orgCurrency),
                })}
                {summary.otherCurrencies.length > 0 && (
                  <>
                    {' · '}
                    {t('summary.excludedFromMonths', '{{currencies}} not included in months (no conversion)', {
                      currencies: otherCurrencyCodes,
                    })}
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="text-metric font-semibold tracking-[-0.02em] tabular text-muted-foreground">—</div>
              <div className="mt-auto text-control text-muted-foreground">
                {t('summary.noCapacity', 'No monthly capacity set')}
                {canManageCapacity && (
                  <>
                    {' · '}
                    <Link
                      to="/administration/projects#work-in-hand-capacity"
                      className="font-medium text-primary-text underline-offset-4 hover:underline"
                    >
                      {t('summary.setCapacity', 'Set capacity')}
                    </Link>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {(summary.excludedIncompleteCount > 0 || query.facts.truncated) && (
        <div
          className="border-t border-border px-[var(--panel-inset)] py-3 text-control text-muted-foreground"
          data-testid={`${testId}-exclusions`}
        >
          {summary.excludedIncompleteCount > 0 && (
            <span>
              {t('summary.excludedIncomplete', {
                count: summary.excludedIncompleteCount,
                defaultValue_one: '{{count}} contract excluded because its invoices cannot be totalled',
                defaultValue_other: '{{count}} contracts excluded because their invoices cannot be totalled',
              })}
            </span>
          )}
          {summary.excludedIncompleteCount > 0 && query.facts.truncated && ' · '}
          {query.facts.truncated && (
            <span>
              {t('summary.excludedTruncated', 'Contracts beyond the 500-contract limit are excluded because the list is capped at 500 contracts.')}
            </span>
          )}
        </div>
      )}
    </Card>
  );
};
