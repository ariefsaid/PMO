import React from 'react';
import { useTranslation } from 'react-i18next';
import { ListState, RecordSection } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { formatExactMoney, formatIsoDay } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { parseExactCents } from '@/src/lib/exactDecimal';
import { useProjectPerformance, usePerformanceSettings } from '@/src/hooks/useWorkOrderPerformance';
import {
  deriveWorkOrderPerformance,
  type Bands,
  type Index,
  type Performance,
} from '@/src/lib/workOrderPerformance';

/**
 * Cost and schedule performance (#2597): the two indices, their readings in words (never colour alone, FR-CSP-012),
 * and the figures behind them. Presentational: every number was derived by `workOrderPerformance.ts` from the
 * database's exact amounts. An uncomputable index shows its reason in one line, never 0 (FR-CSP-013).
 */
export const PerformanceFigures: React.FC<{
  performance: Performance;
  currency: string;
  bands: Bands;
  idPrefix: string;
}> = ({ performance, currency, bands, idPrefix }) => {
  const { t } = useTranslation('workOrderPva');
  const money = (v: string | null) =>
    v === null ? t('performance.unknown', 'Unknown') : formatExactMoney(v, currency, getNumberLocale()) ?? t('performance.unknown', 'Unknown');
  const abs = (v: string) => (v.startsWith('-') ? v.slice(1) : v);
  const sign = (v: string | null): 'positive' | 'negative' | 'zero' | null => {
    if (v === null) return null;
    const c = parseExactCents(v);
    if (c === null) return null;
    return c > 0n ? 'positive' : c < 0n ? 'negative' : 'zero';
  };
  const hidden = (i: Exclude<Index, { state: 'value' }>): string => {
    switch (i.state) {
      case 'no-cost': return t('performance.hidden.noCost', 'No cost recorded yet');
      case 'no-dates': return t('performance.hidden.noDates', 'Add a start and end date to see the schedule index');
      case 'no-plan-yet': return t('performance.hidden.noPlanYet', 'Planned work has not started yet');
      case 'unrated': return t('performance.hidden.unrated', { count: i.count, defaultValue_one: '1 validated progress line has no rate, so no index is shown', defaultValue_other: '{{count}} validated progress lines have no rate, so no index is shown' });
      case 'ac-incomplete':
        return i.undated > 0
          ? t('performance.hidden.acIncompleteUndated', { count: i.undated, defaultValue_one: 'Cost cannot be totalled yet: 1 cost line has no date', defaultValue_other: 'Cost cannot be totalled yet: {{count}} cost lines have no date' })
          : t('performance.hidden.acIncomplete', 'Cost cannot be totalled yet: a cost line has no date or no amount');
      case 'not-comparable': return t('performance.hidden.notComparable', 'Not comparable: some cost is in another currency');
      default: return t('performance.hidden.excluded', 'No figures for a draft or cancelled work order');
    }
  };
  const readingText = (kind: 'cpi' | 'spi', r: 'below' | 'within' | 'above') => {
    const defaults = {
      cpi: { below: 'Actual cost exceeds earned value', within: 'Within range', above: 'Earned value exceeds actual cost' },
      spi: { below: 'Behind plan', within: 'Within range', above: 'Ahead of plan' },
    } as const;
    return t(`performance.reading.${kind}.${r}`, defaults[kind][r]);
  };
  const card = (kind: 'cpi' | 'spi', index: Index) => (
    <div key={kind} data-testid={`${idPrefix}-${kind}`}>
      <dt className="text-muted-foreground">{kind === 'cpi' ? t('performance.cpi', 'Cost performance index') : t('performance.spi', 'Schedule performance index')}</dt>
      <dd>
        {index.state === 'value' ? (
          <>
            <div className="text-lg font-semibold tabular-nums" data-testid={`${idPrefix}-${kind}-value`}>{index.value}</div>
            <div data-testid={`${idPrefix}-${kind}-reading`}>{readingText(kind, index.reading)}</div>
          </>
        ) : (
          <div className="text-muted-foreground" data-testid={`${idPrefix}-${kind}-hidden`}>{hidden(index)}</div>
        )}
      </dd>
    </div>
  );
  const cv = sign(performance.costVariance);
  const sv = sign(performance.scheduleVariance);
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-control sm:grid-cols-2">
        {card('cpi', performance.cpi)}
        {card('spi', performance.spi)}
      </dl>
      <dl className="grid grid-cols-3 gap-x-6 gap-y-3 text-control">
        <div><dt className="text-muted-foreground">{t('performance.ev', 'Earned value')}</dt><dd className="tabular-nums" data-testid={`${idPrefix}-ev`}>{money(performance.ev)}</dd></div>
        <div><dt className="text-muted-foreground">{t('performance.pv', 'Planned value')}</dt><dd className="tabular-nums" data-testid={`${idPrefix}-pv`}>{money(performance.pv)}</dd></div>
        <div><dt className="text-muted-foreground">{t('performance.ac', 'Actual cost')}</dt><dd className="tabular-nums" data-testid={`${idPrefix}-ac`}>{money(performance.ac)}</dd></div>
      </dl>
      {(cv || sv) && (
        <ul className="space-y-1 text-control text-muted-foreground">
          {cv && performance.costVariance !== null && (
            <li data-testid={`${idPrefix}-cost-variance`}>
              {cv === 'zero'
                ? t('performance.costVariance.zero', 'Earned value equals actual cost')
                : t(`performance.costVariance.${cv}`, cv === 'positive' ? 'Earned value exceeds actual cost by {{amount}}' : 'Actual cost exceeds earned value by {{amount}}', { amount: money(abs(performance.costVariance)) })}
            </li>
          )}
          {sv && performance.scheduleVariance !== null && (
            <li data-testid={`${idPrefix}-schedule-variance`}>
              {sv === 'zero'
                ? t('performance.scheduleVariance.zero', 'On plan')
                : t(`performance.scheduleVariance.${sv}`, sv === 'positive' ? 'Ahead of plan by {{amount}}' : 'Behind plan by {{amount}}', { amount: money(abs(performance.scheduleVariance)) })}
            </li>
          )}
        </ul>
      )}
      <p className="text-control text-muted-foreground" data-testid={`${idPrefix}-band`}>
        {t('performance.band', 'Within range is {{low}} to {{high}}.', { low: bands.low, high: bands.high })}
      </p>
    </div>
  );
};

/** The work-order page's panel. Renders nothing at all, and issues no request, until the organisation turns it on. */
export const PerformanceIndices: React.FC<{ projectId: string; workOrderId: string }> = ({ projectId, workOrderId }) => {
  const may = usePermission();
  const settings = usePerformanceSettings();
  if (!may('view', 'workOrderPerformance') || settings.data?.enabled !== true) return null;
  return <PerformancePanel projectId={projectId} workOrderId={workOrderId} />;
};

const PerformancePanel: React.FC<{ projectId: string; workOrderId: string }> = ({ projectId, workOrderId }) => {
  const { t } = useTranslation('workOrderPva');
  const query = useProjectPerformance(projectId, true);
  const title = t('performance.title', 'Cost and schedule performance');
  if (query.isPending) return <RecordSection title={title} data-testid="wo-page-performance"><ListState variant="loading" rows={2} /></RecordSection>;
  if (query.isError || !query.data) {
    return (
      <RecordSection title={title} data-testid="wo-page-performance">
        <ListState variant="error" title={t('performance.loadError', "Couldn't load cost and schedule performance")} retryLabel={t('performance.retry', 'Try again')} onRetry={() => void query.refetch()} />
      </RecordSection>
    );
  }
  const { rows, bands, asOf } = query.data;
  const row = rows.find((r) => r.workOrderId === workOrderId);
  const asOfText = row ? formatIsoDay(row.asOf) : asOf ? formatIsoDay(asOf) : '';
  return (
    <RecordSection
      title={title}
      subline={<>{asOfText ? <span data-testid="wo-page-performance-asof">{t('performance.asOf', 'As of {{date}}', { date: asOfText })}</span> : null}{' '}{t('performance.basis', "Earned value is validated daily-report progress at contract rate. Planned value runs in a straight line between the work order's start and end dates. Actual cost is the direct cost recorded to the work order.")}</>}
      data-testid="wo-page-performance"
    >
      {row
        ? <PerformanceFigures performance={deriveWorkOrderPerformance(row, bands)} currency={row.currency} bands={bands} idPrefix="wo-page-performance" />
        : <p className="text-control text-muted-foreground">{t('performance.nothing', 'Nothing is recorded yet for this work order.')}</p>}
    </RecordSection>
  );
};
