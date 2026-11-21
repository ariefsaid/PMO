import { supabase } from '@/src/lib/supabase/client';
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
type Err = { message: string; code?: string } | null;
interface Loose {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: Err }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the PostgREST builder chain; generated types predate 1280
  from(table: string): any;
}
const db = supabase as unknown as Loose;

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new AppError(error.message, error.code);
  return data;
}

export async function getWorkOrderDailyTarget(workOrderId: string, asOf?: string | null): Promise<DailyTarget | null> {
  const data = await call('wo_daily_target_vs_actual', { p_work_order: workOrderId, p_as_of: asOf ?? null });
  if (data === null || data === undefined) return null;
  return parseDailyTarget(data as Record<string, unknown>);
}

export async function getProjectDailyTarget(projectId: string, asOf?: string | null): Promise<ProjectDailyTarget | null> {
  const data = await call('project_daily_target_vs_actual', { p_project: projectId, p_as_of: asOf ?? null });
  if (data === null || data === undefined) return null;
  return parseProjectDailyTarget(data as Record<string, unknown>);
}

/** The caller's own organisation's non-working dates, earliest first (empty while the plan is off). One row per calendar date, so 1000 covers decades. */
export async function listNonWorkingDates(): Promise<NonWorkingDate[]> {
  const { data, error } = await db.from('org_non_working_dates').select('work_date, label').order('work_date', { ascending: true }).limit(1000);
  if (error) throw new AppError(error.message, error.code);
  return ((data ?? []) as { work_date: string; label: string | null }[]).map((r) => ({ date: r.work_date, label: r.label ?? null }));
}
export async function addNonWorkingDate(date: string, label: string): Promise<void> {
  await call('non_working_date_add', { p_date: date, p_label: label.trim() === '' ? null : label.trim() });
}
export async function removeNonWorkingDate(date: string): Promise<void> {
  await call('non_working_date_remove', { p_date: date });
}
