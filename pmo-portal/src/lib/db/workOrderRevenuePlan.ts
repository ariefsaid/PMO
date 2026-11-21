import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { parseFigures, parseProject, type ProjectRevenuePlan, type RevenuePlanFigures } from '@/src/lib/revenuePlan';

/**
 * Revenue plan per work order (#2671, migrations 1275-1277). Data access only: the plan is written by three
 * security-definer RPCs and read by two; every figure is derived in SQL (FR-WRP-010). org_id is never sent.
 * A read returns `null` while the organisation's switch is off; a caller who may not see revenue is refused (42501).
 */
type Err = { message: string; code?: string } | null;
interface Loose {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: Err }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the PostgREST builder chain; generated types predate 1275
  from(table: string): any;
}
const db = supabase as unknown as Loose;

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new AppError(error.message, error.code);
  return data;
}

export interface RevenuePlanSettings { enabled: boolean; workingWeekdays: number[] }

/** The caller's own organisation's settings; no row = off with Monday to Friday (FR-WRP-001). */
export async function getRevenuePlanSettings(): Promise<RevenuePlanSettings> {
  const { data, error } = await db.from('org_revenue_plan_settings').select('enabled, working_weekdays').maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  if (!data) return { enabled: false, workingWeekdays: [1, 2, 3, 4, 5] };
  return { enabled: data.enabled === true, workingWeekdays: Array.isArray(data.working_weekdays) ? data.working_weekdays.map(Number) : [1, 2, 3, 4, 5] };
}
export async function setRevenuePlanSettings(enabled: boolean, weekdays: number[]): Promise<void> {
  await call('set_revenue_plan_settings', { p_enabled: enabled, p_weekdays: weekdays });
}

export async function getWorkOrderRevenuePlan(workOrderId: string, asOf?: string): Promise<RevenuePlanFigures | null> {
  const data = await call('wo_revenue_plan_vs_actual', { p_work_order: workOrderId, p_as_of: asOf ?? null });
  if (data === null || data === undefined) return null;
  return parseFigures(data as Record<string, unknown>);
}
export async function getProjectRevenuePlan(projectId: string, asOf?: string): Promise<ProjectRevenuePlan | null> {
  const data = await call('project_revenue_plan_vs_actual', { p_project: projectId, p_as_of: asOf ?? null });
  if (data === null || data === undefined) return null;
  return parseProject(data as Record<string, unknown>);
}

export async function setPlanDay(workOrderId: string, date: string, amount: string): Promise<void> {
  await call('wo_revenue_plan_set_day', { p_work_order: workOrderId, p_date: date, p_amount: amount });
}
/** Returns the number of working days the month was spread over. */
export async function setPlanMonth(workOrderId: string, month: string, amount: string, keepEdited: boolean): Promise<number> {
  return Number(await call('wo_revenue_plan_set_month', { p_work_order: workOrderId, p_month: month, p_amount: amount, p_keep_edited: keepEdited }));
}
export async function clearPlan(workOrderId: string, from: string, to: string): Promise<number> {
  return Number(await call('wo_revenue_plan_clear', { p_work_order: workOrderId, p_from: from, p_to: to }));
}
