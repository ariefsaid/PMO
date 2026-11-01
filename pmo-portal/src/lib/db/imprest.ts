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
export type ImprestFloatChangeRow = Tables<'imprest_float_changes'>;
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
export async function getFloat(floatId: string): Promise<(ImprestFloatRow & { project: { name: string } | null; custodian: { full_name: string } | null }) | null> {
  const { data, error } = await supabase.from('imprest_floats')
    .select('*, project:projects(name), custodian:profiles!imprest_floats_custodian_id_fkey(full_name)')
    .eq('id', floatId).maybeSingle();
  fail(error);
  return data;
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
export type ImprestFloatChangeListRow = ImprestFloatChangeRow & { proposer: { full_name: string } | null; decider: { full_name: string } | null };
export async function listFloatChanges(floatId: string): Promise<Bounded<ImprestFloatChangeListRow>> {
  const { data, error } = await supabase.from('imprest_float_changes')
    .select('*, proposer:profiles!imprest_float_changes_proposed_by_fkey(full_name), decider:profiles!imprest_float_changes_decided_by_fkey(full_name)')
    .eq('float_id', floatId)
    .order('proposed_at', { ascending: false }).limit(LIST_LIMIT + 1);
  fail(error);
  return bounded(data);
}
export async function listCounts(floatId: string): Promise<Bounded<ImprestCountRow>> {
  const { data, error } = await supabase.from('imprest_cash_counts').select('*').eq('float_id', floatId)
    .order('counted_at', { ascending: false }).limit(LIST_LIMIT + 1);
  fail(error);
  return bounded(data);
}
/** The float's charged records (claims and advances), newest first: the screen derives Receipts waiting from them. */
export async function listFloatClaims(floatId: string): Promise<Bounded<Tables<'expense_claims'>>> {
  const { data, error } = await supabase.from('expense_claims').select('*').eq('imprest_float_id', floatId)
    .order('created_at', { ascending: false }).limit(LIST_LIMIT + 1);
  fail(error);
  return bounded(data);
}
/** The org's procurement limit (FR-IMP-024 hint); null when none is set. Readable by any active member (RLS). */
export async function getProcurementLimit(): Promise<number | null> {
  const { data, error } = await supabase.from('org_imprest_settings').select('procurement_limit').maybeSingle();
  fail(error);
  return data ? Number(data.procurement_limit) : null;
}
/** Charge a just-saved Draft claim to a float. The capture RPC does not carry the float; `imprest_float_id` is a granted column and the trigger re-checks project, category and advance. */
export async function setClaimFloat(claimId: string, floatId: string | null): Promise<void> {
  const { data, error } = await supabase.from('expense_claims').update({ imprest_float_id: floatId } as never).eq('id', claimId).select('id');
  fail(error);
  assertWriteLanded(data, 'the claim was not charged to the float: it can no longer be edited');
}
export type AwaitingPlan = ImprestPlanRow & { float: { custodian_id: string; currency: string; project: { name: string } | null } | null };
export type AwaitingReplenishment = ImprestReplenishmentRow & { float: { custodian_id: string; currency: string; project: { name: string } | null } | null };
const FLOAT_EMBED = 'float:imprest_floats(custodian_id, currency, project:projects(name))';
/** What waits on a decision, org-wide under RLS: Submitted plans and Requested/Approved replenishments (FR-IMP-073). */
export async function listAwaitingImprest(): Promise<{ plans: AwaitingPlan[]; replenishments: AwaitingReplenishment[] }> {
  const [plans, reps] = await Promise.all([
    supabase.from('imprest_plans').select(`*, ${FLOAT_EMBED}`).eq('status', 'Submitted').order('submitted_at').limit(LIST_LIMIT),
    supabase.from('imprest_replenishments').select(`*, ${FLOAT_EMBED}`).in('status', ['Requested', 'Approved']).order('requested_at').limit(LIST_LIMIT),
  ]);
  fail(plans.error);
  fail(reps.error);
  return { plans: (plans.data ?? []) as unknown as AwaitingPlan[], replenishments: (reps.data ?? []) as unknown as AwaitingReplenishment[] };
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
