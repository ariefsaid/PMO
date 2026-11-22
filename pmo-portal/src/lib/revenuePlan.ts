/**
 * Revenue plan per work order (#2671, spec docs/specs/work-order-revenue-plan.spec.md): pure helpers over what the
 * database derived. Plan to date, actual to date and the gap come from one SQL read (FR-WRP-010); nothing here re-sums.
 * Amounts travel as exact decimal strings and are formatted by `formatExactMoney`, never as floats.
 */
export interface RevenuePlanPoint { date: string; plan: string; actual: string; cumPlan: string; cumActual: string }

export interface RevenuePlanFigures {
  workOrderId: string;
  currency: string;
  asOf: string;
  hasPlan: boolean;
  planToDate: string;
  actualToDate: string;
  /** Actual less plan to date; negative = behind plan. */
  gap: string;
  planTotal: string;
  /** Submitted daily reports not yet validated: named apart, never counted as actual (FR-WRP-013). */
  pendingReports: number;
  series: RevenuePlanPoint[];
}

export interface RevenuePlanRow extends Omit<RevenuePlanFigures, 'asOf' | 'series'> {
  woNumber: string | null;
  title: string;
  status: string;
}
export interface RevenuePlanTotal { currency: string; planToDate: string; actualToDate: string; gap: string; planTotal: string; plannedCount: number }
export interface ProjectRevenuePlan { asOf: string; rows: RevenuePlanRow[]; totals: RevenuePlanTotal[] }

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** A decimal as exactly two fraction digits ("300" → "300.00"), or null when it is not a plain decimal. */
export function twoDecimals(v: unknown): string | null {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v : null;
  if (s === null || !DECIMAL.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return `${whole}.${frac.padEnd(2, '0').slice(0, 2)}`;
}

export type GapState = 'behind' | 'ahead' | 'on-plan';

/** Gap in words (FR-WRP-020): the sign is never carried by colour alone. `by` is the magnitude. */
export function revenueGap(gap: string): { state: GapState; by: string } {
  const g = twoDecimals(gap) ?? '0.00';
  const negative = g.startsWith('-');
  const by = negative ? g.slice(1) : g;
  if (/^0+\.00$/.test(by)) return { state: 'on-plan', by: '0.00' };
  return { state: negative ? 'behind' : 'ahead', by };
}

/** The first of a month as ISO, for any ISO date or month. */
export function monthStartOf(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Month options from `before` months back to `after` months ahead of a given ISO date, as first-of-month ISO values. */
export function monthRange(todayIso: string, before: number, after: number): string[] {
  const y = Number(todayIso.slice(0, 4));
  const m = Number(todayIso.slice(5, 7)) - 1;
  const out: string[] = [];
  for (let i = -before; i <= after; i++) {
    const d = new Date(Date.UTC(y, m + i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`);
  }
  return out;
}

/** A plan amount as typed: zero or more, at most two decimals. Returns a problem key or null (FR-WRP-005). */
export function planAmountProblem(raw: string): 'required' | 'format' | null {
  const s = raw.trim();
  if (s === '') return 'required';
  return /^\d{1,13}(\.\d{1,2})?$/.test(s) ? null : 'format';
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
const str = (v: unknown): string => twoDecimals(v) ?? '0.00';

export function parseFigures(j: Record<string, unknown>): RevenuePlanFigures {
  const series = Array.isArray(j.series) ? (j.series as Record<string, unknown>[]) : [];
  return {
    workOrderId: String(j.work_order_id), currency: String(j.currency), asOf: String(j.as_of), hasPlan: j.has_plan === true,
    planToDate: str(j.plan_to_date), actualToDate: str(j.actual_to_date), gap: str(j.gap), planTotal: str(j.plan_total),
    pendingReports: num(j.pending_reports) || 0,
    series: series.map((p) => ({ date: String(p.date), plan: str(p.plan), actual: str(p.actual), cumPlan: str(p.cum_plan), cumActual: str(p.cum_actual) })),
  };
}

export function parseProject(j: Record<string, unknown>): ProjectRevenuePlan {
  const rows = Array.isArray(j.rows) ? (j.rows as Record<string, unknown>[]) : [];
  const totals = Array.isArray(j.totals) ? (j.totals as Record<string, unknown>[]) : [];
  return {
    asOf: String(j.as_of),
    rows: rows.map((r) => ({
      workOrderId: String(r.work_order_id), woNumber: typeof r.wo_number === 'string' ? r.wo_number : null, title: String(r.title ?? ''),
      status: String(r.status ?? ''), currency: String(r.currency), hasPlan: r.has_plan === true, planToDate: str(r.plan_to_date),
      actualToDate: str(r.actual_to_date), gap: str(r.gap), planTotal: str(r.plan_total), pendingReports: num(r.pending_reports) || 0,
    })),
    totals: totals.map((x) => ({ currency: String(x.currency), planToDate: str(x.plan_to_date), actualToDate: str(x.actual_to_date), gap: str(x.gap), planTotal: str(x.plan_total), plannedCount: num(x.planned_count) || 0 })),
  };
}
