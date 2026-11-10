import React, { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { tintStatusFill } from '@/src/components/ui/chartTheme';
import type { StatusDatum } from './StatusBarChart';

export interface StageSegmentsProps<S extends string> {
  data: StatusDatum<S>[];
  toneFor: (status: S) => string;
  label: string;
  noun: string;
  hrefFor?: (status: S) => string;
  labelFor?: (status: S) => string;
}

/** Compact linked stages for narrow dashboard cards; this module has no chart-vendor dependency. */
export function StageSegments<S extends string>({
  data,
  toneFor,
  label,
  noun,
  hrefFor,
  labelFor,
}: StageSegmentsProps<S>) {
  const { t } = useTranslation();
  const descriptionId = useId();
  const { total, topStatus } = useMemo(() => {
    const sum = data.reduce((amount, datum) => amount + datum.count, 0);
    const top = data.reduce<StatusDatum<S> | null>(
      (best, datum) => (best === null || datum.count > best.count ? datum : best),
      null,
    );
    return { total: sum, topStatus: top?.status ?? '—' };
  }, [data]);
  const displayStatus = labelFor?.(topStatus as S) ?? topStatus;
  const summary = labelFor
    ? t('dashboard.procurementStatus.summary', '{{label}}, {{total}} {{noun}}, most in {{status}}.', { label, total, noun, status: displayStatus })
    : `${label}, ${total} ${noun}, most in ${topStatus}.`;
  const chartDataDescription = t('dashboard:executive.chartDataTableDescription', 'The chart values are listed in the following data table.');
  const chartDataTable = (
    <table className="sr-only" aria-label={t('dashboard:executive.chartDataTableLabel', 'Data for {{label}}', { label })}>
      <thead>
        <tr>
          <th scope="col">{t('dashboard:executive.chartTableStatus', 'Status')}</th>
          <th scope="col">{t('dashboard:executive.chartTableCount', 'Count')}</th>
        </tr>
      </thead>
      <tbody>
        {data.map((datum) => (
          <tr key={datum.status}>
            <th scope="row">{labelFor?.(datum.status) ?? datum.status}</th>
            <td>{datum.count}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">{t('dashboard:executive.chartTableTotal', 'Total')}</th>
          <td>{total}</td>
        </tr>
      </tfoot>
    </table>
  );

  return (
    <figure className="m-0 grid gap-2">
      <div role="group" aria-label={label} aria-describedby={descriptionId} className="flex h-8 overflow-hidden rounded-md bg-secondary">
        {data.map((datum) => {
          const name = labelFor?.(datum.status) ?? datum.status;
          return hrefFor ? (
            <Link
              key={datum.status}
              to={hrefFor(datum.status)}
              aria-label={`${name}: ${datum.count}`}
              title={`${name}: ${datum.count}`}
              className="min-w-0 border-r border-background/60 last:border-r-0 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              style={{ width: `${total > 0 ? (datum.count / total) * 100 : 0}%`, background: tintStatusFill(toneFor(datum.status)) }}
            />
          ) : (
            <span
              key={datum.status}
              aria-label={`${name}: ${datum.count}`}
              className="min-w-0 border-r border-background/60 last:border-r-0"
              style={{ width: `${total > 0 ? (datum.count / total) * 100 : 0}%`, background: tintStatusFill(toneFor(datum.status)) }}
            />
          );
        })}
      </div>
      <figcaption role="group" aria-label={label} className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-muted-foreground">
        {data.map((datum) => {
          const name = labelFor?.(datum.status) ?? datum.status;
          const entry = <><span aria-hidden="true" data-testid="legend-dot" className="size-1.5 shrink-0 rounded-full" style={{ background: toneFor(datum.status) }} />{name}<span className="tabular font-semibold text-foreground">{datum.count}</span></>;
          return hrefFor ? <Link key={datum.status} to={hrefFor(datum.status)} className="inline-flex items-center gap-1.5 hover:text-primary-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring">{entry}</Link> : <span key={datum.status} className="inline-flex items-center gap-1.5">{entry}</span>;
        })}
      </figcaption>
      <p id={descriptionId} className="sr-only">{chartDataDescription}</p>
      {chartDataTable}
      <span className="sr-only">{summary}</span>
    </figure>
  );
}
