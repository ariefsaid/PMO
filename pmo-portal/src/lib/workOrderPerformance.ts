import { formatExactCents, parseExactCents } from './exactDecimal';

/**
 * Cost and schedule performance per work order and project (#2597, docs/specs/work-order-performance-indices.spec.md).
 *
 * Pure: no I/O. EV, PV and AC arrive as exact decimal strings computed in the database
 * (`get_work_order_performance`); this module only forms ratios from integer cents, rounds half up, and reads them
 * against the organisation's bands. No float arithmetic touches money. Project figures are the ratio of sums.
 */

export type PerformanceWorkOrderStatus = 'Draft' | 'Issued' | 'Closed' | 'Cancelled';
export type AcStatus = 'complete' | 'incomplete' | 'not_comparable';

export interface PerformanceRow {
  workOrderId: string;
  woNumber: string | null;
  title: string;
  status: PerformanceWorkOrderStatus;
  currency: string;
  /** The as-of date the figures were computed for (the earlier of the request and the close date for Closed). */
  asOf: string;
  startDate: string | null;
  endDate: string | null;
  /** Budget at completion (net order value, or closing value when Closed). */
  bac: string | null;
  ev: string | null;
  unratedLines: number;
  pv: string | null;
  ac: string | null;
  acStatus: AcStatus;
  undatedCostLines: number;
}

export interface Bands { low: string; high: string }
export type Reading = 'below' | 'within' | 'above';

export type Index =
  | { state: 'value'; value: string; reading: Reading }
  | { state: 'excluded' }
  | { state: 'unrated'; count: number }
  | { state: 'ac-incomplete'; undated: number }
  | { state: 'not-comparable' }
  | { state: 'no-cost' }
  | { state: 'no-dates' }
  | { state: 'no-plan-yet' };

export interface Performance {
  ev: string | null;
  pv: string | null;
  ac: string | null;
  cpi: Index;
  spi: Index;
  /** EV - AC; null when either is unknown. */
  costVariance: string | null;
  /** EV - PV; null when either is unknown. */
  scheduleVariance: string | null;
}

export interface ProjectPerformance extends Performance {
  includedCount: number;
  excludedCount: number;
}

/** Index in hundredths (integer) against the bands: below low, above high, else within. */
export function readIndex(hundredths: number, bands: Bands): Reading {
  const low = parseBand(bands.low);
  const high = parseBand(bands.high);
  if (hundredths < low) return 'below';
  if (hundredths > high) return 'above';
  return 'within';
}

function parseBand(v: string): number {
  const c = parseExactCents(v);
  if (c === null) throw new Error(`Invalid performance band: ${v}`);
  return Number(c);
}

/** round-half-up of n/d to two decimals, from integers. n >= 0, d > 0. */
function ratioHundredths(n: bigint, d: bigint): bigint {
  return (n * 200n + d) / (2n * d);
}

function formatRatio(h: bigint): string {
  return formatExactCents(h);
}

function makeIndex(n: bigint, d: bigint, bands: Bands): Index {
  const h = ratioHundredths(n < 0n ? 0n : n, d);
  return { state: 'value', value: formatRatio(h), reading: readIndex(Number(h), bands) };
}

interface Cents { ev: bigint | null; pv: bigint | null; ac: bigint | null }

function toCents(v: string | null): bigint | null {
  return v === null ? null : parseExactCents(v);
}

function build(
  c: Cents,
  flags: { unrated: number; acStatus: AcStatus; undated: number; hasDates: boolean },
  bands: Bands,
): Performance {
  const evKnown = flags.unrated === 0 && c.ev !== null;
  const acKnown = flags.acStatus === 'complete' && c.ac !== null;
  let cpi: Index;
  if (flags.unrated > 0) cpi = { state: 'unrated', count: flags.unrated };
  else if (flags.acStatus === 'not_comparable') cpi = { state: 'not-comparable' };
  else if (flags.acStatus === 'incomplete') cpi = { state: 'ac-incomplete', undated: flags.undated };
  else if (!evKnown || c.ac === null || c.ac === 0n) cpi = { state: 'no-cost' };
  else cpi = makeIndex(c.ev as bigint, c.ac, bands);

  let spi: Index;
  if (flags.unrated > 0) spi = { state: 'unrated', count: flags.unrated };
  else if (!flags.hasDates || c.pv === null) spi = { state: 'no-dates' };
  else if (c.pv === 0n) spi = { state: 'no-plan-yet' };
  else if (c.ev === null) spi = { state: 'no-plan-yet' };
  else spi = makeIndex(c.ev, c.pv, bands);

  return {
    ev: c.ev === null ? null : formatExactCents(c.ev),
    pv: c.pv === null ? null : formatExactCents(c.pv),
    ac: c.ac === null ? null : formatExactCents(c.ac),
    cpi,
    spi,
    costVariance: evKnown && acKnown ? formatExactCents((c.ev as bigint) - (c.ac as bigint)) : null,
    scheduleVariance: evKnown && c.pv !== null ? formatExactCents((c.ev as bigint) - c.pv) : null,
  };
}

const NO_FIGURES: Performance = {
  ev: null, pv: null, ac: null,
  cpi: { state: 'excluded' }, spi: { state: 'excluded' },
  costVariance: null, scheduleVariance: null,
};

export function deriveWorkOrderPerformance(row: PerformanceRow, bands: Bands): Performance {
  if (row.status === 'Draft' || row.status === 'Cancelled') return NO_FIGURES;
  return build(
    { ev: toCents(row.ev), pv: toCents(row.pv), ac: toCents(row.ac) },
    { unrated: row.unratedLines, acStatus: row.acStatus, undated: row.undatedCostLines, hasDates: row.startDate !== null && row.endDate !== null },
    bands,
  );
}

/** A work order joins the project figures when its own figures are complete (EV rated, AC complete and comparable, PV defined). */
function includable(row: PerformanceRow): boolean {
  return (row.status === 'Issued' || row.status === 'Closed')
    && row.unratedLines === 0 && row.acStatus === 'complete'
    && row.ev !== null && row.ac !== null && row.pv !== null;
}

/** Project figures: sums of EV, PV and AC over complete Issued/Closed work orders, then the ratios. Never an average. */
export function deriveProjectPerformance(rows: readonly PerformanceRow[], bands: Bands): ProjectPerformance {
  const inc = rows.filter(includable);
  const excludedCount = rows.length - inc.length;
  if (inc.length === 0) return { ...NO_FIGURES, includedCount: 0, excludedCount };
  let ev = 0n; let pv = 0n; let ac = 0n;
  for (const r of inc) {
    ev += toCents(r.ev) ?? 0n;
    pv += toCents(r.pv) ?? 0n;
    ac += toCents(r.ac) ?? 0n;
  }
  const p = build({ ev, pv, ac }, { unrated: 0, acStatus: 'complete', undated: 0, hasDates: true }, bands);
  return { ...p, includedCount: inc.length, excludedCount };
}

/** The limits are valid when 0 < low < 1 < high (the database enforces the same rule, `organizations_performance_bands`). */
export function bandsValid(low: number | null, high: number | null): boolean {
  return low !== null && high !== null && low > 0 && low < 1 && high > 1;
}
