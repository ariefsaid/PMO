import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
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

const MALFORMED = 'malformed-performance';
const STATUSES: readonly string[] = ['Draft', 'Issued', 'Closed', 'Cancelled'];
const AC_STATUSES: readonly string[] = ['complete', 'incomplete', 'not_comparable'];
export const DEFAULT_BANDS: Bands = { low: '0.90', high: '1.10' };

const bad = (field: string): never => { throw new AppError(`Work order performance: ${field} is missing or malformed`, MALFORMED); };
const str = (v: unknown, f: string): string => (typeof v === 'string' && v !== '' ? v : bad(f));
const strOrNull = (v: unknown, f: string): string | null => (v === null || v === undefined ? null : str(v, f));
const decimal = (v: unknown, f: string): string => (typeof v === 'string' && /^-?\d+\.\d{2}$/.test(v) ? v : bad(f));
const decimalOrNull = (v: unknown, f: string): string | null => (v === null || v === undefined ? null : decimal(v, f));
const count = (v: unknown, f: string): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : bad(f));
const band = (v: unknown, f: string): string => (typeof v === 'string' && /^\d+\.\d{2}$/.test(v) ? v : bad(f));

function parseRow(r: Record<string, unknown>): PerformanceRow {
  const status = str(r.status, 'status');
  const acStatus = str(r.ac_status, 'ac_status');
  if (!STATUSES.includes(status)) bad('status');
  if (!AC_STATUSES.includes(acStatus)) bad('ac_status');
  return {
    workOrderId: str(r.work_order_id, 'work_order_id'),
    woNumber: strOrNull(r.wo_number, 'wo_number'),
    title: str(r.title, 'title'),
    status: status as PerformanceWorkOrderStatus,
    currency: str(r.currency, 'currency'),
    asOf: str(r.as_of, 'as_of'),
    startDate: strOrNull(r.start_date, 'start_date'),
    endDate: strOrNull(r.end_date, 'end_date'),
    bac: decimalOrNull(r.bac, 'bac'),
    ev: decimalOrNull(r.ev, 'ev'),
    unratedLines: count(r.unrated_lines, 'unrated_lines'),
    pv: decimalOrNull(r.pv, 'pv'),
    ac: decimalOrNull(r.ac, 'ac'),
    acStatus: acStatus as AcStatus,
    undatedCostLines: count(r.undated_cost_lines, 'undated_cost_lines'),
  };
}

export function parseProjectPerformance(data: unknown): ProjectPerformanceRead {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return bad('response');
  const d = data as Record<string, unknown>;
  if (d.enabled === false) {
    return { enabled: false, asOf: null, bands: DEFAULT_BANDS, rows: [], truncated: false, omitted: 0 };
  }
  if (d.enabled !== true) return bad('enabled');
  const bands = d.bands as Record<string, unknown> | undefined;
  if (!bands) return bad('bands');
  if (!Array.isArray(d.rows)) return bad('rows');
  return {
    enabled: true,
    asOf: str(d.as_of, 'as_of'),
    bands: { low: band(bands.low, 'bands.low'), high: band(bands.high, 'bands.high') },
    rows: d.rows.map((r) => parseRow(r as Record<string, unknown>)),
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
