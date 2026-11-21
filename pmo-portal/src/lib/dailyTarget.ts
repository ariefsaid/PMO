/**
 * Daily target per work order (#2672, spec docs/specs/work-order-daily-target.spec.md): pure helpers over what the database
 * derived. The target IS #2671's dated plan row; target, actual, month to date and the projection come from one SQL read
 * (FR-WDT-010..014); nothing here re-sums. The projection is a run-rate of the ACTUAL, never a target (OD-SCOPE-7).
 * Amounts travel as exact decimal strings (see `twoDecimals`).
 */
import { twoDecimals } from '@/src/lib/revenuePlan';

export interface DailyTargetDay {
  date: string;
  /** A working day under the organisation's weekdays and non-working dates. */
  working: boolean;
  /** The date is on the organisation's non-working list (a target may still sit on it, FR-WDT-002). */
  listed: boolean;
  nonWorkingLabel: string | null;
  hasTarget: boolean;
  target: string;
  actual: string;
  /** Actual less target for the day; negative = behind. */
  gap: string;
  /** Submitted daily reports not yet validated: named apart, never counted as actual (FR-WDT-012). */
  pendingReports: number;
}

export interface DailyTarget {
  workOrderId: string;
  currency: string;
  asOf: string;
  /** First of the as-of date's month. */
  month: string;
  hasTarget: boolean;
  monthTarget: string;
  mtdTarget: string;
  mtdActual: string;
  mtdGap: string;
  elapsedWorkingDays: number;
  remainingWorkingDays: number;
  /** Null when no working day has elapsed yet: "not enough days", never 0 (FR-WDT-013). */
  projection: string | null;
  projectedGap: string | null;
  days: DailyTargetDay[];
}

export interface DailyTargetRow {
  workOrderId: string;
  woNumber: string | null;
  title: string;
  status: string;
  currency: string;
  hasTarget: boolean;
  monthTarget: string;
  mtdTarget: string;
  mtdActual: string;
  mtdGap: string;
  projection: string | null;
  projectedGap: string | null;
}
export interface DailyTargetTotal {
  currency: string;
  monthTarget: string;
  mtdTarget: string;
  mtdActual: string;
  mtdGap: string;
  projection: string | null;
  targetedCount: number;
}
export interface ProjectDailyTarget { asOf: string; rows: DailyTargetRow[]; totals: DailyTargetTotal[] }

export interface NonWorkingDate { date: string; label: string | null }

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v)) || 0;
const str = (v: unknown): string => twoDecimals(v) ?? '0.00';
const optStr = (v: unknown): string | null => (v === null || v === undefined ? null : twoDecimals(v));

export function parseDailyTarget(j: Record<string, unknown>): DailyTarget {
  const days = Array.isArray(j.days) ? (j.days as Record<string, unknown>[]) : [];
  return {
    workOrderId: String(j.work_order_id), currency: String(j.currency), asOf: String(j.as_of), month: String(j.month),
    hasTarget: j.has_target === true, monthTarget: str(j.month_target), mtdTarget: str(j.mtd_target), mtdActual: str(j.mtd_actual), mtdGap: str(j.mtd_gap),
    elapsedWorkingDays: num(j.elapsed_working_days), remainingWorkingDays: num(j.remaining_working_days),
    projection: optStr(j.projection), projectedGap: optStr(j.projected_gap),
    days: days.map((d) => ({
      date: String(d.date), working: d.working === true, listed: d.is_listed === true,
      nonWorkingLabel: typeof d.non_working_label === 'string' ? d.non_working_label : null,
      hasTarget: d.has_target === true, target: str(d.target), actual: str(d.actual), gap: str(d.gap), pendingReports: num(d.pending_reports),
    })),
  };
}

export function parseProjectDailyTarget(j: Record<string, unknown>): ProjectDailyTarget {
  const rows = Array.isArray(j.rows) ? (j.rows as Record<string, unknown>[]) : [];
  const totals = Array.isArray(j.totals) ? (j.totals as Record<string, unknown>[]) : [];
  return {
    asOf: String(j.as_of),
    rows: rows.map((r) => ({
      workOrderId: String(r.work_order_id), woNumber: typeof r.wo_number === 'string' ? r.wo_number : null, title: String(r.title ?? ''),
      status: String(r.status ?? ''), currency: String(r.currency), hasTarget: r.has_target === true, monthTarget: str(r.month_target),
      mtdTarget: str(r.mtd_target), mtdActual: str(r.mtd_actual), mtdGap: str(r.mtd_gap), projection: optStr(r.projection), projectedGap: optStr(r.projected_gap),
    })),
    totals: totals.map((x) => ({
      currency: String(x.currency), monthTarget: str(x.month_target), mtdTarget: str(x.mtd_target), mtdActual: str(x.mtd_actual),
      mtdGap: str(x.mtd_gap), projection: optStr(x.projection), targetedCount: num(x.targeted_count),
    })),
  };
}

/**
 * The days worth a row: a working day, or any day that carries a target, revenue, a pending report or a non-working
 * listing. Plain weekends stay out of the table so a month reads as the days that were meant to be worked.
 */
export function visibleDays(days: DailyTargetDay[]): DailyTargetDay[] {
  return days.filter((d) => d.working || d.hasTarget || d.listed || d.pendingReports > 0 || !/^0+\.00$/.test(d.actual));
}

/** The first of the month `by` months from a month (or any ISO date). */
export function shiftMonth(iso: string, by: number): string {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** The last day of a month as ISO. */
export function monthEndOf(iso: string): string {
  return new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).toISOString().slice(0, 10);
}

/**
 * The as-of date to ask for when browsing to `month`, given the first-of-month of the organisation's current month:
 * a past month is read whole (its last day), a future month from its first day, the current month as of today (null =
 * let the database use the organisation's today).
 */
export function asOfForMonth(month: string, currentMonth: string): string | null {
  if (month === currentMonth) return null;
  return month < currentMonth ? monthEndOf(month) : month;
}
