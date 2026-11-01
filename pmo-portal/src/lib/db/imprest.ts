import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import type { Database, Tables } from '@/src/lib/supabase/database.types';

/**
 * Site imprest DAL (#1515, migrations 0422-0424). Floats, changes, replenishments and counts move only through RPCs;
 * plan headers and lines are table writes over granted columns (author, Draft/Rejected). Never sends org_id (a column default stamps it; hence
 * `as never` on the insert bodies), status, number, amount or a stamp. Lists bounded at LIST_LIMIT + 1 sentinel (money-path primer bucket 5).
 */
export type ImprestFloatRow = Tables<'imprest_floats'>;
export type ImprestPlanRow = Tables<'imprest_plans'>;
export type ImprestPlanLineRow = Tables<'imprest_plan_lines'>;
export type ImprestReplenishmentRow = Tables<'imprest_replenishments'>;
export type ImprestCountRow = Tables<'imprest_cash_counts'>;
export type BudgetCategory = Database['public']['Enums']['budget_category'];
export type ImprestPosition = Database['public']['Functions']['get_imprest_position']['Returns'][number];
export type ImprestPlanUsageRow = Database['public']['Functions']['get_imprest_plan_usage']['Returns'][number];
export type ImprestFloatChoice = Database['public']['Functions']['imprest_float_choices']['Returns'][number];

export const LIST_LIMIT = 200;
export interface Bounded<T> { rows: T[]; truncated: boolean }
const bounded = <T>(rows: T[] | null): Bounded<T> =>
  ({ rows: (rows ?? []).slice(0, LIST_LIMIT), truncated: (rows ?? []).length > LIST_LIMIT });
const fail = (error: { message: string; code?: string } | null): void => { if (error) throw new AppError(error.message, error.code); };

export async function listFloats(): Promise<Bounded<ImprestFloatRow & { project: { name: string } | null; custodian: { full_name: string } | null }>> {
  const { data, error } = await supabase.from('imprest_floats')
    .select('*, project:projects(name), custodian:profiles!imprest_floats_custodian_id_fkey(full_name)')
    .is('archived_at', null).order('created_at', { ascending: false }).limit(LIST_LIMIT + 1);
  fail(error);
  return bounded(data);
}
export async function getPosition(floatId: string): Promise<ImprestPosition | null> {
  const { data, error } = await supabase.rpc('get_imprest_position', { p_float: floatId });
  fail(error);
  return data?.[0] ?? null;
}
export async function getPlanUsage(floatId: string, month: string): Promise<ImprestPlanUsageRow[]> {
  const { data, error } = await supabase.rpc('get_imprest_plan_usage', { p_float: floatId, p_month: month });
  fail(error);
  return data ?? [];
}
export async function floatChoices(projectId: string, category: BudgetCategory | null): Promise<ImprestFloatChoice[]> {
  const { data, error } = await supabase.rpc('imprest_float_choices', { p_project: projectId, p_category: category ?? undefined });
  fail(error);
  return data ?? [];
}
export async function listPlans(floatId: string): Promise<Bounded<ImprestPlanRow>> {
  const { data, error } = await supabase.from('imprest_plans').select('*').eq('float_id', floatId)
    .order('month', { ascending: false }).limit(LIST_LIMIT + 1);
  fail(error);
  return bounded(data);
}
export async function listPlanLines(planId: string): Promise<ImprestPlanLineRow[]> {
  const { data, error } = await supabase.from('imprest_plan_lines').select('*').eq('plan_id', planId).order('budget_category');
  fail(error);
  return data ?? [];
}
export async function listReplenishments(floatId: string): Promise<Bounded<ImprestReplenishmentRow>> {
  const { data, error } = await supabase.from('imprest_replenishments').select('*').eq('float_id', floatId)
    .order('requested_at', { ascending: false }).limit(LIST_LIMIT + 1);
  fail(error);
  return bounded(data);
}
export async function listCounts(floatId: string): Promise<Bounded<ImprestCountRow>> {
  const { data, error } = await supabase.from('imprest_cash_counts').select('*').eq('float_id', floatId)
    .order('counted_at', { ascending: false }).limit(LIST_LIMIT + 1);
  fail(error);
  return bounded(data);
}
export async function createPlan(floatId: string, month: string): Promise<string> {
  const { data, error } = await supabase.from('imprest_plans').insert({ float_id: floatId, month } as never).select('id').single();
  fail(error);
  return data!.id;
}
export async function savePlanLine(planId: string, budgetCategory: BudgetCategory, plannedAmount: number): Promise<void> {
  const { data, error } = await supabase.from('imprest_plan_lines')
    .upsert({ plan_id: planId, budget_category: budgetCategory, planned_amount: plannedAmount } as never, { onConflict: 'plan_id,budget_category' })
    .select('id');
  fail(error);
  assertWriteLanded(data, 'the plan line was not saved: the plan is no longer a Draft you authored');
}
export async function deletePlanLine(lineId: string): Promise<void> {
  const { data, error } = await supabase.from('imprest_plan_lines').delete().eq('id', lineId).select('id');
  fail(error);
  assertWriteLanded(data, 'the plan line was not removed: the plan is no longer a Draft you authored');
}
const rpc = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  fail(error);
  return data;
};
export const setProcurementLimit = (amount: number) => rpc('set_imprest_procurement_limit', { p_amount: amount });
export const establishFloat = (projectId: string, custodianId: string, amount: number) =>
  rpc('establish_imprest_float', { p_project: projectId, p_custodian: custodianId, p_amount: amount }) as Promise<string>;
export const proposeFloatAmount = (floatId: string, amount: number) =>
  rpc('propose_imprest_float_amount', { p_float: floatId, p_amount: amount }) as Promise<string>;
export const decideFloatChange = (changeId: string, approve: boolean, notes?: string) =>
  rpc('decide_imprest_float_change', { p_change: changeId, p_approve: approve, p_notes: notes ?? null });
export const transitionPlan = (planId: string, to: 'Submitted' | 'Approved' | 'Rejected' | 'Cancelled' | 'Draft', notes?: string) =>
  rpc('transition_imprest_plan', { p_id: planId, p_to: to, p_notes: notes ?? null });
export const requestReplenishment = (floatId: string, kind: 'replenishment' | 'funding' = 'replenishment') =>
  rpc('request_imprest_replenishment', { p_float: floatId, p_kind: kind }) as Promise<string>;
export const transitionReplenishment = (id: string, to: 'Approved' | 'Rejected' | 'Paid' | 'Cancelled',
                                        opts: { notes?: string; paymentReference?: string } = {}) =>
  rpc('transition_imprest_replenishment', { p_id: id, p_to: to, p_notes: opts.notes ?? null,
                                            p_payment_reference: to === 'Paid' ? (opts.paymentReference ?? null) : null });
export const recordCount = (floatId: string, counted: number, note?: string) =>
  rpc('record_imprest_count', { p_float: floatId, p_counted: counted, p_note: note ?? null }) as Promise<string>;
