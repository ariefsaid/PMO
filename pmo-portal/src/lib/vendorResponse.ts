// #2702 — vendor response time on an equipment breakdown. Pure and exact (whole minutes, integers only).
// The SQL read `list_equipment_breakdowns` (migration 1374) supplies each breakdown's minutes; this is the one place
// the per-vendor summary is defined. docs/specs/equipment-vendor-response.spec.md § Definitions.

export interface BreakdownResponse {
  vendorId: string;
  /** Whole minutes from report to response; null while the vendor has not responded (awaiting). */
  responseMinutes: number | null;
}

export interface VendorResponseSummary {
  vendorId: string;
  breakdowns: number;
  responded: number;
  awaiting: number;
  /** Absent (null), never 0, when the vendor has no response yet. */
  medianMinutes: number | null;
  averageMinutes: number | null;
  slowestMinutes: number | null;
}

/** Whole minutes between two instants (floor); null when not yet responded, or when the order is impossible. */
export function responseMinutes(reportedAt: string | Date, respondedAt: string | Date | null | undefined): number | null {
  if (respondedAt == null) return null;
  const ms = new Date(respondedAt).getTime() - new Date(reportedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 60000);
}

/** Integer division rounded half up (non-negative operands). */
const divRoundHalfUp = (num: number, den: number): number => Math.floor((2 * num + den) / (2 * den));

/** Median: the middle value, or with an even count the mean of the two middle values rounded half up. */
export function medianMinutes(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : divRoundHalfUp(sorted[mid - 1] + sorted[mid], 2);
}

/** Average: sum / count rounded half up. */
export function averageMinutes(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return divRoundHalfUp(values.reduce((s, v) => s + v, 0), values.length);
}

/** Per vendor, in first-seen order: counts, median, average, slowest. Awaiting breakdowns are counted, never averaged. */
export function vendorResponseSummary(rows: readonly BreakdownResponse[]): VendorResponseSummary[] {
  const byVendor = new Map<string, BreakdownResponse[]>();
  for (const r of rows) byVendor.set(r.vendorId, [...(byVendor.get(r.vendorId) ?? []), r]);
  return [...byVendor].map(([vendorId, list]) => {
    const done = list.flatMap((r) => (r.responseMinutes == null ? [] : [r.responseMinutes]));
    return {
      vendorId,
      breakdowns: list.length,
      responded: done.length,
      awaiting: list.length - done.length,
      medianMinutes: medianMinutes(done),
      averageMinutes: averageMinutes(done),
      slowestMinutes: done.length ? Math.max(...done) : null,
    };
  });
}

/** "1 h 30 min" style parts for display; the caller localises the unit words. */
export function splitMinutes(total: number): { days: number; hours: number; minutes: number } {
  return { days: Math.floor(total / 1440), hours: Math.floor((total % 1440) / 60), minutes: total % 60 };
}
