import React from 'react';
import { cn } from './cn';

export interface TimesheetDay {
  /** Short weekday label, e.g. "Mon". */
  label: string;
  /** Day-of-month number, e.g. "2". */
  dateNum: string;
  /** Weekend day → quiet tint. */
  weekend: boolean;
}

export interface TimesheetGridRow {
  id: string;
  project: string;
  code: string | null;
  /** Hours per day, parallel to `days` (length 7). */
  hours: number[];
}

export interface TimesheetGridProps {
  days: TimesheetDay[];
  rows: TimesheetGridRow[];
  className?: string;
}

/** Format hours with a tabular figure; trims trailing zeros (8 not 8.00). */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}

/**
 * Weekly hours grid (DESIGN.md `tsgrid`): project rows × 7 day cells, weekend
 * tinting, per-row + per-day + grand totals. Cells are read-only here (entry
 * editing is a separate, deferred capability) but carry per-cell `aria-label`s
 * so screen readers can address each {project, day} figure. Filled cells get a
 * faint `primary` wash; empty cells show a centred dot placeholder.
 */
export const TimesheetGrid: React.FC<TimesheetGridProps> = ({ days, rows, className }) => {
  const dailyTotals = days.map((_, i) => rows.reduce((sum, r) => sum + (r.hours[i] ?? 0), 0));
  const grandTotal = dailyTotals.reduce((a, b) => a + b, 0);

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-[13.5px]">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-[1] h-[38px] min-w-[220px] border-b border-border bg-card px-3 text-left text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground"
            >
              Project
            </th>
            {days.map((d, i) => (
              <th
                key={i}
                scope="col"
                className={cn(
                  'h-[38px] min-w-[64px] border-b border-border px-2 text-center text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground',
                  d.weekend && 'weekend bg-secondary/60'
                )}
              >
                {d.label}
                <span className="mt-0.5 block text-[11px] font-normal tabular text-muted-foreground">
                  {d.dateNum}
                </span>
              </th>
            ))}
            <th
              scope="col"
              className="h-[38px] min-w-[64px] border-b border-border bg-secondary/40 px-2 text-center text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground"
            >
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rowTotal = r.hours.reduce((a, b) => a + b, 0);
            return (
              <tr key={r.id} className="border-b border-border/70">
                <td className="sticky left-0 z-[1] bg-card px-3 py-2.5 align-middle">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium" title={r.project}>
                      {r.project}
                    </div>
                    {r.code && (
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {r.code}
                      </div>
                    )}
                  </div>
                </td>
                {r.hours.map((h, i) => {
                  const filled = h > 0;
                  const weekend = days[i]?.weekend;
                  return (
                    <td
                      key={i}
                      className={cn('p-1 text-center align-middle', weekend && 'bg-secondary/60')}
                    >
                      <div
                        aria-label={`${r.project}, ${days[i]?.label} hours`}
                        className={cn(
                          'mx-auto grid h-9 min-w-[44px] place-items-center rounded-md text-[13.5px] tabular',
                          filled
                            ? 'bg-primary/[0.07] font-semibold text-foreground'
                            : 'text-muted-foreground/45'
                        )}
                      >
                        {filled ? fmt(h) : '·'}
                      </div>
                    </td>
                  );
                })}
                <td
                  data-testid={`tsgrid-row-total-${r.id}`}
                  className="bg-secondary/30 px-2 py-2.5 text-center align-middle text-sm font-semibold tabular"
                >
                  {rowTotal > 0 ? fmt(rowTotal) : '·'}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-[1.5px] border-border bg-secondary/40">
            <td className="sticky left-0 z-[1] bg-secondary/40 px-3 py-3 text-right text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
              Daily total
            </td>
            {dailyTotals.map((t, i) => (
              <td
                key={i}
                data-testid={`tsgrid-daily-total-${i}`}
                className={cn(
                  'px-2 py-3 text-center text-sm font-semibold tabular',
                  days[i]?.weekend && 'bg-secondary/60'
                )}
              >
                {t > 0 ? fmt(t) : '·'}
              </td>
            ))}
            <td
              data-testid="tsgrid-grand-total"
              className="bg-secondary/60 px-2 py-3 text-center text-sm font-bold tabular"
            >
              {fmt(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};
