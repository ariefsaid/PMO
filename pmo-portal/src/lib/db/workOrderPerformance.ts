import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import { wireValidator, type WireRecord } from '@/src/lib/wireDoc';
import type { AcStatus, Bands, PerformanceRow, PerformanceWorkOrderStatus } from '@/src/lib/workOrderPerformance';

/**
 * Cost and schedule performance reads and settings (#2597, migrations 1285 and 1286). Every figure is validated: a
 * missing or malformed one is an ERROR, never a plausible 0. Money stays an exact decimal string; the pure module
 * `workOrderPerformance.ts` forms the ratios. `org_id` is never sent.
 */
export interface PerformanceSettings { enabled: boolean; bands: Bands }

export interface ProjectPerformanceRead {
  /** False when the organisation has not turned the panels on; then there are no rows. */
  enabled: boolean;
  asOf: string | null;
  bands: Bands;
  rows: PerformanceRow[];
  truncated: boolean;
  omitted: number;
}

const STATUSES: readonly PerformanceWorkOrderStatus[] = ['Draft', 'Issued', 'Closed', 'Cancelled'];
const AC_STATUSES: readonly AcStatus[] = ['complete', 'incomplete', 'not_comparable'];
export const DEFAULT_BANDS: Bands = { low: '0.90', high: '1.10' };

const v = wireValidator('Work order performance', 'malformed-performance');
const { str, nonEmptyStrOrNull: strOrNull } = v;
const decimalOrNull = (val: unknown, f: string): string | null =>
  val === null || val === undefined ? null : typeof val === 'string' && /^-?\d+\.\d{2}$/.test(val) ? val : v.fail(f);
const count = (val: unknown, f: string): number => v.int(val, f, { min: 0 });
const band = (val: unknown, f: string): string => (typeof val === 'string' && /^\d+\.\d{2}$/.test(val) ? val : v.fail(f));

function parseRow(r: WireRecord): PerformanceRow {
  return {
    workOrderId: str(r.work_order_id, 'work_order_id'),
    woNumber: strOrNull(r.wo_number, 'wo_number'),
    title: str(r.title, 'title'),
    status: v.oneOf(r.status, STATUSES, 'status'),
    currency: str(r.currency, 'currency'),
    asOf: str(r.as_of, 'as_of'),
    startDate: strOrNull(r.start_date, 'start_date'),
    endDate: strOrNull(r.end_date, 'end_date'),
    bac: decimalOrNull(r.bac, 'bac'),
    ev: decimalOrNull(r.ev, 'ev'),
    unratedLines: count(r.unrated_lines, 'unrated_lines'),
    pv: decimalOrNull(r.pv, 'pv'),
    ac: decimalOrNull(r.ac, 'ac'),
    acStatus: v.oneOf(r.ac_status, AC_STATUSES, 'ac_status'),
    undatedCostLines: count(r.undated_cost_lines, 'undated_cost_lines'),
  };
}

export function parseProjectPerformance(data: unknown): ProjectPerformanceRead {
  const d = v.rec(data, 'response');
  if (d.enabled === false) {
    return { enabled: false, asOf: null, bands: DEFAULT_BANDS, rows: [], truncated: false, omitted: 0 };
  }
  if (d.enabled !== true) return v.fail('enabled');
  const bands = v.rec(d.bands, 'bands');
  return {
    enabled: true,
    asOf: str(d.as_of, 'as_of'),
    bands: { low: band(bands.low, 'bands.low'), high: band(bands.high, 'bands.high') },
    rows: v.arr(d.rows, 'rows').map((r, i) => parseRow(v.rec(r, `rows[${i}]`))),
    truncated: d.truncated === true,
    omitted: count(d.omitted, 'omitted'),
  };
}

export async function getProjectPerformance(projectId: string, asOf?: string): Promise<ProjectPerformanceRead> {
  const { data, error } = await supabase.rpc('get_work_order_performance', { p_project_id: projectId, ...(asOf ? { p_as_of: asOf } : {}) });
  if (error) throw new AppError(error.message, error.code);
  return parseProjectPerformance(data);
}

/** The organisation's switch and bands; readable by every active member (the panels gate on it). */
export async function getPerformanceSettings(): Promise<PerformanceSettings> {
  const { data, error } = await supabase.from('organizations')
    .select('performance_indices_enabled, performance_band_low, performance_band_high').limit(1);
  if (error) throw new AppError(error.message, error.code);
  const row = data?.[0];
  if (!row) return { enabled: false, bands: DEFAULT_BANDS };
  const fix = (n: unknown, f: string) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : band(n, f));
  return {
    enabled: row.performance_indices_enabled === true,
    bands: { low: fix(row.performance_band_low, 'low'), high: fix(row.performance_band_high, 'high') },
  };
}

/** Admin only: the database refuses anyone else (no row changes, surfaced as a refusal). */
export async function setPerformanceSettings(patch: { enabled?: boolean; low?: number; high?: number }): Promise<void> {
  const { data: orgs, error } = await supabase.from('organizations').select('id').limit(2);
  if (error) throw new AppError(error.message, error.code);
  if (orgs?.length !== 1) throw new Error('Exactly one organization must be readable before changing this setting.');
  const update: { performance_indices_enabled?: boolean; performance_band_low?: number; performance_band_high?: number } = {};
  if (patch.enabled !== undefined) update.performance_indices_enabled = patch.enabled;
  if (patch.low !== undefined) update.performance_band_low = patch.low;
  if (patch.high !== undefined) update.performance_band_high = patch.high;
  const { data: changed, error: updateError } = await supabase.from('organizations').update(update).eq('id', orgs[0].id).select('id');
  if (updateError) throw new AppError(updateError.message, updateError.code);
  assertWriteLanded(changed, 'You do not have permission to change the performance settings.');
}
