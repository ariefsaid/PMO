import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon, ProjectNameLink, TextField, type TimesheetDay, type TimesheetGridRow } from '@/src/components/ui';
import { NoteCell } from '@/src/components/ui/TimesheetGrid';
import { cn } from '@/src/components/ui/cn';
import { formatDay, formatNumberExact, formatWeekday } from '@/src/lib/format';
import { dayKey } from './timesheetWeekModel';

type Props = {
  days: TimesheetDay[];
  dates: Date[];
  rows: TimesheetGridRow[];
  dayTotals: number[];
  rowTotals: number[];
  weekTotal: number;
  editable?: boolean;
  notes?: Record<string, string>;
  rawHours?: Record<string, string[]>;
  invalidCells?: Set<string>;
  onCellChange?: (rowId: string, dayIndex: number, raw: string) => void;
  onNoteChange?: (rowId: string, note: string) => void;
  onDeleteRow?: (rowId: string) => void;
  /** Add project / copy last week, placed after the day's rows (editable only). */
  children?: React.ReactNode;
};

/** Today when it falls in the shown week, else the week's first day. */
const initialDay = (dates: Date[]) => Math.max(0, dates.findIndex((d) => dayKey(d) === dayKey(new Date())));

/**
 * The phone week (#2440): one day at a time under a strip of the week's seven days. Each day in the
 * strip carries its total; the head carries the selected day and the week total and stays pinned
 * while the person scrolls or types. Rows are the week's projects, one hour field each for the
 * selected day; every other day is one tap away in the strip.
 */
export function TimesheetDayView({ days, dates, rows, dayTotals, rowTotals, weekTotal, editable = false, notes, rawHours,
  invalidCells, onCellChange, onNoteChange, onDeleteRow, children }: Props) {
  const { t } = useTranslation(['common', 'timesheets']);
  const [day, setDay] = React.useState(() => initialDay(dates));
  const weekKey = dates[0] ? dayKey(dates[0]) : '';
  React.useEffect(() => { setDay(initialDay(dates)); }, [weekKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const hours = (n: number) => (n > 0 ? formatNumberExact(n) : '·');
  const invalidOn = (i: number) => rows.some((r) => invalidCells?.has(`${r.id}:${i}`));

  return (
    <div data-testid="tsgrid-mobile">
      {/* Pinned head: the selected day and the week total stay in view while typing. */}
      <div className="sticky top-0 z-10 border-b border-border bg-card px-3.5 pb-2 pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-base font-semibold text-foreground">{dates[day] ? `${formatWeekday(dates[day])} ${formatDay(dates[day])}` : ''}</span>
          <span data-testid="tsgrid-grand-total" className="whitespace-nowrap text-control font-semibold tabular text-foreground">
            {t('timesheets.hoursThisWeek', '{{hours}} hours this week', { hours: formatNumberExact(weekTotal) })}
          </span>
        </div>
        <div role="group" aria-label={t('timesheets:dayView.daysOfWeek', 'Days of the week')} className="mt-2 grid grid-cols-7">
          {days.map((d, i) => {
            const selected = i === day;
            const invalid = editable && invalidOn(i);
            return (
              <button
                key={i}
                type="button"
                aria-pressed={selected}
                aria-label={`${t('timesheets:dayView.dayStripLabel', '{{day}} {{date}}, {{hours}} hours', { day: d.label, date: d.dateNum, hours: formatNumberExact(dayTotals[i] ?? 0) })}${invalid ? ` · ${t('timesheets.invalidHours', '0–24 only')}` : ''}`}
                onClick={() => setDay(i)}
                className={cn(
                  'flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-md text-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
                  d.weekend && 'bg-secondary/60',
                )}
              >
                <span className="text-muted-foreground">{d.label}</span>
                <span className={cn('grid size-7 place-items-center rounded-full tabular', selected ? 'bg-primary font-semibold text-primary-foreground' : 'text-foreground')}>
                  {d.dateNum}
                </span>
                <span data-testid={`tsgrid-daily-total-${i}`} className={cn('tabular', invalid ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
                  {invalid ? '!' : hours(dayTotals[i] ?? 0)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <ul className="divide-y divide-border">
        {rows.map((r, rowIdx) => {
          const h = r.hours[day] ?? 0;
          const invalid = editable && (invalidCells?.has(`${r.id}:${day}`) ?? false);
          const raw = rawHours?.[r.id]?.[day];
          const cellLabel = t('timesheets.hoursCell', '{{project}}, {{day}} hours', { project: r.project, day: days[day]?.label });
          return (
            <li key={r.id} className="px-3.5 py-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="min-w-0 flex-1 pt-0.5">
                  {editable ? (
                    <div className="break-words text-control font-medium text-foreground" title={r.projectLegalName ?? r.project}>{r.project}</div>
                  ) : (
                    <ProjectNameLink projectId={r.projectId} name={r.project} legalName={r.projectLegalName} className="break-words text-control font-medium" />
                  )}
                  <div data-testid={`tsgrid-row-total-${r.id}`} className="text-control tabular text-muted-foreground">
                    {r.code && <><span className="record-id">{r.code}</span>{' · '}</>}
                    {t('timesheets.hoursThisWeek', '{{hours}} hours this week', { hours: formatNumberExact(rowTotals[rowIdx] ?? 0) })}
                  </div>
                </div>
                {editable ? (
                  <div className="w-20 shrink-0">
                    <TextField
                      label=""
                      hideLabel
                      fullWidth
                      aria-label={cellLabel}
                      aria-invalid={invalid || undefined}
                      value={raw !== undefined ? raw : h === 0 ? '' : formatNumberExact(h)}
                      onChange={(next) => onCellChange?.(r.id, day, next)}
                      inputMode="decimal"
                      autoComplete="off"
                      className={cn('touch-target block w-full text-center tabular', invalid ? 'border-destructive' : 'border-border')}
                    />
                  </div>
                ) : (
                  <div aria-label={cellLabel} className={cn('min-w-11 shrink-0 pt-0.5 text-right text-control tabular', h > 0 ? 'text-foreground' : 'text-muted-foreground')}>
                    {hours(h)}
                  </div>
                )}
                {editable && (
                  <Button
                    className="touch-target -mr-2 shrink-0"
                    variant="ghost"
                    size="icon"
                    aria-label={t('timesheets.deleteProjectRow', 'Delete {{project}} row', { project: r.project })}
                    onClick={() => onDeleteRow?.(r.id)}
                  >
                    <Icon name="x" />
                  </Button>
                )}
              </div>
              {invalid && (
                <p role="alert" className="mt-1 text-right text-control text-destructive">{t('timesheets.invalidHours', '0–24 only')}</p>
              )}
              {editable && <NoteCell rowId={r.id} project={r.project} value={notes?.[r.id] ?? ''} onNoteChange={onNoteChange} />}
            </li>
          );
        })}
      </ul>
      {children}
    </div>
  );
}
