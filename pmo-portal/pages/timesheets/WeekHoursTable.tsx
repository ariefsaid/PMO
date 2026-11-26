import React from 'react';
import { useTranslation } from 'react-i18next';
import { ProjectNameLink } from '@/src/components/ui';
import type { TimesheetDay, TimesheetGridRow } from '@/src/components/ui/TimesheetGrid';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { formatNumberMax2 } from '@/src/lib/format';

const fmt = (h: number) => (h > 0 ? formatNumberMax2(h) : '');

/** Project name, its code on its own line, and the work order under it. */
const ProjectCell: React.FC<{ row: TimesheetGridRow }> = ({ row }) => (
  <div className="min-w-0">
    <ProjectNameLink projectId={row.projectId} name={row.project} legalName={row.projectLegalName} className="break-words text-control font-medium" />
    {row.code && <div className="min-w-0"><span className="record-id">{row.code}</span></div>}
    {row.workOrderLabel && <div className="break-words text-control text-muted-foreground">{row.workOrderLabel}</div>}
  </div>
);

/**
 * One read-only week of hours, compact enough for a side drawer: one row per project, Mon..Sun then Total, hours
 * right-aligned, an empty day left blank, a totals row at the foot. On a phone each project lists only the days that
 * have hours, with its total; the week total closes the list.
 */
export const WeekHoursTable: React.FC<{ days: TimesheetDay[]; rows: TimesheetGridRow[] }> = ({ days, rows }) => {
  const { t } = useTranslation(['common', 'timesheets']);
  const isDesktop = useIsDesktop();
  const rowTotal = (r: TimesheetGridRow) => r.hours.reduce((a, b) => a + b, 0);
  const dayTotals = days.map((_, i) => rows.reduce((sum, r) => sum + (r.hours[i] ?? 0), 0));
  const weekTotal = dayTotals.reduce((a, b) => a + b, 0);
  const totalLabel = t('timesheets:weekHours.total', 'Total');
  const dailyTotalLabel = t('timesheets:weekHours.dailyTotal', 'Daily total');

  if (!isDesktop) {
    return (
      <div data-testid="week-hours-stacked" className="divide-y divide-border">
        {rows.map((r) => (
          <section key={r.id} className="py-3 first:pt-0" aria-label={r.project}>
            <ProjectCell row={r} />
            <dl className="mt-2 space-y-1 text-control">
              {days.map((d, i) => ((r.hours[i] ?? 0) > 0 ? (
                <div key={i} className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{d.label} {d.dateNum}</dt>
                  <dd className="tabular-nums text-foreground">{fmt(r.hours[i])}</dd>
                </div>
              ) : null))}
              <div className="flex items-center justify-between gap-3 border-t border-border pt-1">
                <dt className="text-muted-foreground">{totalLabel}</dt>
                <dd className="font-semibold tabular-nums text-foreground">{formatNumberMax2(rowTotal(r))}</dd>
              </div>
            </dl>
          </section>
        ))}
        <div className="flex items-center justify-between gap-3 pt-3 text-control">
          <span className="font-semibold text-foreground">{t('timesheets:weekHours.weekTotal', 'Week total')}</span>
          <span className="font-semibold tabular-nums text-foreground">{formatNumberMax2(weekTotal)}</span>
        </div>
      </div>
    );
  }

  return (
    <table className="w-full table-fixed text-control" data-testid="week-hours-table">
      <colgroup>
        <col />
        {days.map((_, i) => <col key={i} className="w-10" />)}
        <col className="w-14" />
      </colgroup>
      <thead>
        <tr className="border-b border-border text-muted-foreground">
          <th scope="col" className="py-2 pr-2 text-left font-normal">{t('timesheets:weekHours.project', 'Project')}</th>
          {days.map((d, i) => (
            <th key={i} scope="col" className="py-2 text-right font-normal">
              <span className="block">{d.label}</span>
              <span className="block tabular-nums">{d.dateNum}</span>
            </th>
          ))}
          <th scope="col" className="py-2 text-right font-normal">{totalLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-border align-top">
            <th scope="row" className="py-2 pr-2 text-left font-normal"><ProjectCell row={r} /></th>
            {days.map((_, i) => (
              <td key={i} className="py-2 text-right tabular-nums text-foreground"
                aria-label={(r.hours[i] ?? 0) > 0 ? undefined : t('timesheets:weekHours.noHours', 'No hours')}>
                {fmt(r.hours[i] ?? 0)}
              </td>
            ))}
            <td className="py-2 text-right font-semibold tabular-nums text-foreground">{formatNumberMax2(rowTotal(r))}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" className="py-2 pr-2 text-left font-semibold text-foreground">{dailyTotalLabel}</th>
          {dayTotals.map((h, i) => <td key={i} className="py-2 text-right font-semibold tabular-nums text-foreground">{fmt(h)}</td>)}
          <td className="py-2 text-right font-semibold tabular-nums text-foreground">{formatNumberMax2(weekTotal)}</td>
        </tr>
      </tfoot>
    </table>
  );
};
