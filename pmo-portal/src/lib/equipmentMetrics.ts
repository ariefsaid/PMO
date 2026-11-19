// #2526 — equipment availability and utilisation. Pure and exact: every figure is
// derived from integers (BigInt) and rounded half-up only for display. Mirrors the SQL read model
// (`equipment_metrics`, migration 0986); docs/specs/equipment-availability.spec.md.
import { parseExactCents } from './exactDecimal';

export type EquipmentStatus = 'ready' | 'standby' | 'broken' | 'at_vendor' | 'waiting_parts';
export const DOWN_STATUSES: readonly EquipmentStatus[] = ['broken', 'at_vendor', 'waiting_parts'];
export const isDownStatus = (s: EquipmentStatus): boolean => DOWN_STATUSES.includes(s);

export interface StatusDay { date: string; status: EquipmentStatus }
export interface UsageEntry {
  date: string;
  quantity: string;
  unit: 'hours' | 'days';
  kind: 'work' | 'standby';
  status: 'Draft' | 'Submitted' | 'Approved' | 'Rejected';
}
export type Grain = 'day' | 'week' | 'month';

export interface MetricsInput {
  from: string;
  to: string;
  /** First day the asset was in service; days before it are outside both terms. */
  inServiceOn?: string | null;
  workingHoursPerDay: string;
  statuses: StatusDay[];
  usage: UsageEntry[];
}
export interface DayRow { date: string; status: EquipmentStatus | null; available: boolean; workTenThousandthsHours: number }
export interface GrainRow {
  start: string;
  inServiceDays: number;
  availableDays: number;
  unrecordedDays: number;
  availabilityPct: string | null;
  utilisationPct: string | null;
}
export interface EquipmentMetrics {
  inServiceDays: number;
  availableDays: number;
  unrecordedDays: number;
  availabilityPct: string | null;
  utilisationPct: string | null;
  /** Submitted or Draft entries excluded from utilisation (FR-EAV-012). */
  pendingUsageEntries: number;
  days: DayRow[];
  byGrain: (g: Grain) => GrainRow[];
}

const MS = 86_400_000;
const toUtc = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const fromUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function mondayOf(iso: string): string {
  const dow = new Date(toUtc(iso)).getUTCDay(); // 0 = Sunday
  return fromUtc(toUtc(iso) - ((dow + 6) % 7) * MS);
}
/** n/d as a percentage with one decimal, rounded half up (non-negative n, positive d). */
function pct1(n: bigint, d: bigint): string | null {
  if (d <= 0n) return null;
  const tenths = (n * 2000n + d) / (2n * d); // round(n * 1000 / d)
  return `${tenths / 10n}.${tenths % 10n}`;
}
const hundredths = (v: string): bigint => {
  const c = parseExactCents(v);
  if (c === null || c < 0n) throw new Error(`invalid decimal: ${v}`);
  return c;
};

export function computeEquipmentMetrics(input: MetricsInput): EquipmentMetrics {
  const whC = hundredths(input.workingHoursPerDay); // hundredths of an hour per working day
  if (whC === 0n) throw new Error('working hours per day must be positive');
  const status = new Map(input.statuses.map((s) => [s.date, s.status]));
  const workByDay = new Map<string, bigint>();
  let pending = 0;
  for (const e of input.usage) {
    if (e.status === 'Submitted' || e.status === 'Draft') pending += 1;
    if (e.status !== 'Approved' || e.kind !== 'work') continue;
    const q = hundredths(e.quantity);
    // ten-thousandths of an hour: hours x100, days x working hours (both carry 2 decimals), so no precision is lost
    workByDay.set(e.date, (workByDay.get(e.date) ?? 0n) + (e.unit === 'days' ? q * whC : q * 100n));
  }

  const days: DayRow[] = [];
  let inService = 0, available = 0, unrecorded = 0;
  for (let t = toUtc(input.from); t <= toUtc(input.to); t += MS) {
    const date = fromUtc(t);
    const st = status.get(date) ?? null;
    const outside = input.inServiceOn != null && date < input.inServiceOn;
    const isAvail = !outside && st !== null && !isDownStatus(st);
    if (!outside) {
      if (st === null) unrecorded += 1; else inService += 1;
      if (isAvail) available += 1;
    }
    days.push({ date, status: outside ? null : st, available: isAvail, workTenThousandthsHours: outside || st === null ? 0 : Number(workByDay.get(date) ?? 0n) });
  }

  const sumWork = (rows: DayRow[]) => rows.reduce((s, r) => s + BigInt(r.workTenThousandthsHours), 0n);
  const figures = (rows: DayRow[]): Omit<GrainRow, 'start'> => {
    let svc = 0, av = 0, un = 0;
    for (const r of rows) {
      const outside = input.inServiceOn != null && r.date < input.inServiceOn;
      if (outside) continue;
      if (r.status === null) un += 1; else svc += 1;
      if (r.available) av += 1;
    }
    return {
      inServiceDays: svc, availableDays: av, unrecordedDays: un,
      availabilityPct: pct1(BigInt(av), BigInt(svc)),
      utilisationPct: av > 0 ? pct1(sumWork(rows), BigInt(av) * whC * 100n) : null,
    };
  };

  return {
    inServiceDays: inService, availableDays: available, unrecordedDays: unrecorded,
    availabilityPct: pct1(BigInt(available), BigInt(inService)),
    utilisationPct: available > 0 ? pct1(sumWork(days), BigInt(available) * whC * 100n) : null,
    pendingUsageEntries: pending,
    days,
    byGrain(g) {
      const key = (d: string) => (g === 'day' ? d : g === 'week' ? mondayOf(d) : `${d.slice(0, 7)}-01`);
      const groups = new Map<string, DayRow[]>();
      for (const r of days) (groups.get(key(r.date)) ?? groups.set(key(r.date), []).get(key(r.date))!).push(r);
      return [...groups.entries()].map(([start, rows]) => ({ start, ...figures(rows) }));
    },
  };
}
