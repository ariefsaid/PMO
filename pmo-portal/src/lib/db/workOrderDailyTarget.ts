import { supabase } from '@/src/lib/supabase/client';
import { nullableArg } from './nullableArg';
import { AppError } from '@/src/lib/appError';
import {
  parseDailyTarget, parseProjectDailyTarget, type DailyTarget, type NonWorkingDate, type ProjectDailyTarget,
} from '@/src/lib/dailyTarget';

/**
 * Daily target per work order (#2672, migrations 1280-1282). Data access only. The target is #2671's plan row (written by
 * its RPCs); this adds the two month reads and the organisation's non-working dates. Every figure is derived in SQL
 * (FR-WDT-010). org_id is never sent. A read returns `null` while the organisation's switch is off; a caller who may not
 * see revenue is refused (42501).
 */
const fail = (error: { message: string; code?: string }): never => { throw new AppError(error.message, error.code); };

export async function getWorkOrderDailyTarget(workOrderId: string, asOf?: string | null): Promise<DailyTarget | null> {
  // `p_as_of` DEFAULTS to null; the module sends null, which is the same request. Both reads answer jsonb, which the
  // parser above validates field by field.
  const { data, error } = await supabase.rpc('wo_daily_target_vs_actual', { p_work_order: workOrderId, p_as_of: nullableArg(asOf ?? null) });
  if (error) fail(error);
  if (data === null || data === undefined) return null;
  return parseDailyTarget(data as Record<string, unknown>);
}

export async function getProjectDailyTarget(projectId: string, asOf?: string | null): Promise<ProjectDailyTarget | null> {
  const { data, error } = await supabase.rpc('project_daily_target_vs_actual', { p_project: projectId, p_as_of: nullableArg(asOf ?? null) });
  if (error) fail(error);
  if (data === null || data === undefined) return null;
  return parseProjectDailyTarget(data as Record<string, unknown>);
}

/** The caller's own organisation's non-working dates, earliest first (empty while the plan is off). One row per calendar date, so 1000 covers decades. */
export async function listNonWorkingDates(): Promise<NonWorkingDate[]> {
  const { data, error } = await supabase.from('org_non_working_dates').select('work_date, label').order('work_date', { ascending: true }).limit(1000);
  if (error) fail(error);
  return (data ?? []).map((r) => ({ date: r.work_date, label: r.label ?? null }));
}
export async function addNonWorkingDate(date: string, label: string): Promise<void> {
  const { error } = await supabase.rpc('non_working_date_add', { p_date: date, p_label: nullableArg(label.trim() === '' ? null : label.trim()) });
  if (error) fail(error);
}
export async function removeNonWorkingDate(date: string): Promise<void> {
  const { error } = await supabase.rpc('non_working_date_remove', { p_date: date });
  if (error) fail(error);
}
