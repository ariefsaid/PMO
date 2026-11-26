import React from 'react';
import { useTranslation } from 'react-i18next';
import { ListState, RecordSection } from '@/src/components/ui';
import { PerformanceGate } from '@/src/components/performance/PerformanceGate';
import { formatIsoDay, formatTableMoney } from '@/src/lib/format';
import { parseExactCents } from '@/src/lib/exactDecimal';
import { useProjectPerformance } from '@/src/hooks/useWorkOrderPerformance';
import { useAreaHelp } from './useAreaHelp';
import { OtherCurrencyNote } from './AreaHelp';
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
  /** `false`: the range is defined elsewhere (the work-order page's help), not as a line under the figures. */
  showBand?: boolean;
  recordedProgress?: number | null;
  /** `true`: an index that mixes currencies shows a dash; the page says why once for the area. */
  otherCurrencyNoted?: boolean;
}> = ({ performance, currency, bands, idPrefix, showBand = true, otherCurrencyNoted = false, recordedProgress = null }) => {
  const { t } = useTranslation('workOrderPva');
  const money = (v: string | null) =>
    v === null ? '—' : formatTableMoney(v, currency) ?? '—';
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
      case 'not-comparable': return otherCurrencyNoted ? '—' : t('performance.hidden.notComparable', 'Not comparable: some cost is in another currency');
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
  const card = (kind: 'cpi' | 'spi', index: Index) => {
    const hiddenText = index.state === 'value' ? null : hidden(index);
    return (
      <div key={kind} data-testid={`${idPrefix}-${kind}`}>
        <dt className="text-muted-foreground">{kind === 'cpi' ? t('performance.cpi', 'Cost performance index') : t('performance.spi', 'Schedule performance index')}</dt>
        <dd>
          {index.state === 'value' ? (
            <>
              <div className="text-metric font-semibold tabular-nums" data-testid={`${idPrefix}-${kind}-value`}>{index.value}</div>
              <div data-testid={`${idPrefix}-${kind}-reading`}>{readingText(kind, index.reading)}</div>
            </>
          ) : (
            <div className="text-metric font-semibold tabular-nums text-muted-foreground" data-testid={hiddenText === '—' ? `${idPrefix}-${kind}-hidden` : undefined}>—</div>
          )}
        </dd>
      </div>
    );
  };
  const noRecordedData = performance.ev !== null && performance.ac !== null && parseExactCents(performance.ev) === 0n && parseExactCents(performance.ac) === 0n;
  const cv = noRecordedData ? null : sign(performance.costVariance);
  const sv = noRecordedData ? null : sign(performance.scheduleVariance);
  if (noRecordedData) return <p className="text-control text-muted-foreground">{recordedProgress !== null && recordedProgress > 0 ? t('performance.recordCostsNext', 'Record actual costs or enter a cost plan to see performance.') : t('performance.recordNext', 'Record progress or costs to see performance.')}</p>;
  const acText = performance.ac === null && otherCurrencyNoted && performance.cpi.state === 'not-comparable'
    ? '—'
    : money(performance.ac);
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-control sm:grid-cols-2">
        {card('cpi', performance.cpi)}
        {card('spi', performance.spi)}
      </dl>
      <div className="text-control text-muted-foreground">{(['cpi', 'spi'] as const).map((kind) => { const index = performance[kind]; return index.state !== 'value' && hidden(index) !== '—' ? <p key={kind} data-testid={`${idPrefix}-${kind}-hidden`}>{hidden(index)}</p> : null; })}</div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-control sm:grid-cols-3 sm:gap-x-6">
        <div className="min-w-0"><dt className="text-muted-foreground">{t('performance.ev', 'Earned value')}</dt><dd className="tabular-nums" data-testid={`${idPrefix}-ev`}>{money(performance.ev)}</dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">{t('performance.pv', 'Planned value')}</dt><dd className="tabular-nums" data-testid={`${idPrefix}-pv`}>{money(performance.pv)}</dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">{t('performance.ac', 'Actual cost')}</dt><dd className="tabular-nums" data-testid={`${idPrefix}-ac`}>{acText}</dd></div>
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
      {showBand && (
        <p className="text-control text-muted-foreground" data-testid={`${idPrefix}-band`}>
          {t('performance.band', 'Within range is {{low}} to {{high}}.', { low: bands.low, high: bands.high })}
        </p>
      )}
    </div>
  );
};

/** The work-order page's panel. Renders nothing at all, and issues no request, until the organisation turns it on. */
export const PerformanceIndices: React.FC<{ projectId: string; workOrderId: string; recordedProgress?: number | null }> = ({ projectId, workOrderId, recordedProgress }) => (
  <PerformanceGate><PerformancePanel projectId={projectId} workOrderId={workOrderId} recordedProgress={recordedProgress} /></PerformanceGate>
);

const PerformancePanel: React.FC<{ projectId: string; workOrderId: string; recordedProgress?: number | null }> = ({ projectId, workOrderId, recordedProgress }) => {
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
  const perf = row ? deriveWorkOrderPerformance(row, bands) : null;
  const asOfText = row ? formatIsoDay(row.asOf) : asOf ? formatIsoDay(asOf) : '';
  return (
    <RecordSection title={title} data-testid="wo-page-performance">
      <PerformanceHelp title={title} bands={bands} />
      {asOfText && <p className="mb-3 text-control text-muted-foreground" data-testid="wo-page-performance-asof">{t('performance.asOf', 'As of {{date}}', { date: asOfText })}</p>}
      {perf && (perf.cpi.state === 'not-comparable' || perf.spi.state === 'not-comparable') && <OtherCurrencyNote />}
      {row && perf
        ? <PerformanceFigures performance={perf} currency={row.currency} bands={bands} idPrefix="wo-page-performance" showBand={false} otherCurrencyNoted recordedProgress={recordedProgress} />
        : <p className="text-control text-muted-foreground">{t('performance.nothing', 'Nothing is recorded yet for this work order.')}</p>}
    </RecordSection>
  );
};

/** What earned, planned and actual mean, and the range, for the page's one help control. */
const PerformanceHelp: React.FC<{ title: string; bands: Bands }> = ({ title, bands }) => {
  const { t } = useTranslation('workOrderPva');
  useAreaHelp('performance', title, `${t('performance.basis', "Earned value is validated daily-report progress at contract rate. Planned value runs in a straight line between the work order's start and end dates. Actual cost is the direct cost recorded to the work order.")} ${t('performance.band', 'Within range is {{low}} to {{high}}.', { low: bands.low, high: bands.high })}`);
  return null;
};
