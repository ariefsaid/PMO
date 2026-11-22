import { supabase } from '@/src/lib/supabase/client';
import { nullableArg } from './nullableArg';
import { AppError } from '@/src/lib/appError';
import { parseFigures, parseProject, type ProjectRevenuePlan, type RevenuePlanFigures } from '@/src/lib/revenuePlan';

/**
 * Revenue plan per work order (#2671, migrations 1275-1277). Data access only: the plan is written by three
 * security-definer RPCs and read by two; every figure is derived in SQL (FR-WRP-010). org_id is never sent.
 * A read returns `null` while the organisation's switch is off; a caller who may not see revenue is refused (42501).
 */
const fail = (error: { message: string; code?: string }): never => { throw new AppError(error.message, error.code); };

/** A `numeric` plan amount goes on the wire as the exact decimal TEXT the caller typed, which the generated argument
 * type cannot state: it says `number`. The one cast in this module, and it is the number's text, not a float. */
const asNumeric = (v: string) => v as unknown as number;

export interface RevenuePlanSettings { enabled: boolean; workingWeekdays: number[] }

const WEEKDAYS = [1, 2, 3, 4, 5];

/** The caller's own organisation's settings; no row = off with Monday to Friday (FR-WRP-001). */
export async function getRevenuePlanSettings(): Promise<RevenuePlanSettings> {
  const { data, error } = await supabase.from('org_revenue_plan_settings').select('enabled, working_weekdays').maybeSingle();
  if (error) fail(error);
  if (!data) return { enabled: false, workingWeekdays: WEEKDAYS };
  return { enabled: data.enabled === true, workingWeekdays: Array.isArray(data.working_weekdays) ? data.working_weekdays.map(Number) : WEEKDAYS };
}
export async function setRevenuePlanSettings(enabled: boolean, weekdays: number[]): Promise<void> {
  const { error } = await supabase.rpc('set_revenue_plan_settings', { p_enabled: enabled, p_weekdays: weekdays });
  if (error) fail(error);
}

export async function getWorkOrderRevenuePlan(workOrderId: string, asOf?: string): Promise<RevenuePlanFigures | null> {
  // `p_as_of` DEFAULTS to null; the module sends null, which is the same request. The read answers jsonb, which the
  // parser above validates field by field.
  const { data, error } = await supabase.rpc('wo_revenue_plan_vs_actual', { p_work_order: workOrderId, p_as_of: nullableArg(asOf ?? null) });
  if (error) fail(error);
  if (data === null || data === undefined) return null;
  return parseFigures(data as Record<string, unknown>);
}
export async function getProjectRevenuePlan(projectId: string, asOf?: string): Promise<ProjectRevenuePlan | null> {
  const { data, error } = await supabase.rpc('project_revenue_plan_vs_actual', { p_project: projectId, p_as_of: nullableArg(asOf ?? null) });
  if (error) fail(error);
  if (data === null || data === undefined) return null;
  return parseProject(data as Record<string, unknown>);
}

export async function setPlanDay(workOrderId: string, date: string, amount: string): Promise<void> {
  const { error } = await supabase.rpc('wo_revenue_plan_set_day', { p_work_order: workOrderId, p_date: date, p_amount: asNumeric(amount) });
  if (error) fail(error);
}
/** Returns the number of working days the month was spread over. */
export async function setPlanMonth(workOrderId: string, month: string, amount: string, keepEdited: boolean): Promise<number> {
  const { data, error } = await supabase.rpc('wo_revenue_plan_set_month', { p_work_order: workOrderId, p_month: month, p_amount: asNumeric(amount), p_keep_edited: keepEdited });
  if (error) fail(error);
  return Number(data);
}
export async function clearPlan(workOrderId: string, from: string, to: string): Promise<number> {
  const { data, error } = await supabase.rpc('wo_revenue_plan_clear', { p_work_order: workOrderId, p_from: from, p_to: to });
  if (error) fail(error);
  return Number(data);
}
