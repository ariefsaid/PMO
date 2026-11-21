import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { ExactMoney } from '@/src/lib/projectFinances';
import type { WorkOrderEarnedBilledRow } from '@/src/lib/earnedBilledProfit';

/**
 * Earned and billed revenue (#2733, migrations 1270-1272). Data access only: figures are joined in
 * `src/lib/earnedBilledProfit.ts`. org_id is never sent; the RPCs scope to the caller's organisation and return
 * nothing while the organisation setting (`discipline_profit_enabled`) is off.
 */
const SCALE_TWO = /^-?\d+\.\d{2}$/;
const money = (v: unknown): ExactMoney => {
  const text = String(v);
  if (!Number.isFinite(Number(text))) throw new AppError('Earned and billed read: unexpected row', 'malformed-response');
  return SCALE_TWO.test(text) ? text : Number(text).toFixed(2);
};

/** A caller who may not see revenue is refused by the server (42501): returned as `'restricted'`, never as an empty list. */
export async function listWorkOrderEarnedBilled(projectId: string): Promise<WorkOrderEarnedBilledRow[] | 'restricted'> {
  const { data, error } = await supabase.rpc('project_work_order_earned_billed', { p_project: projectId });
  if (error) {
    if (error.code === '42501') return 'restricted';
    throw new AppError(error.message, error.code);
  }
  return (data ?? []).map((r) => ({
    workOrderId: r.work_order_id, currency: r.currency,
    earned: r.earned === null ? null : money(r.earned),
    earnedLines: Number(r.earned_lines), unratedLines: Number(r.unrated_lines),
    billed: r.billed === null ? null : money(r.billed), billedComplete: r.billed_complete === true,
  }));
}

export interface PackEarnedRow {
  projectId: string;
  currency: string;
  earned: ExactMoney;
  unratedLines: number;
  workOrders: number;
  workOrdersWithoutProgress: number;
}

/** Earned revenue per project for the management pack; only projects whose revenue the caller may see. */
export async function listPackEarned(): Promise<PackEarnedRow[]> {
  const { data, error } = await supabase.rpc('management_pack_earned');
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []).map((r) => ({
    projectId: r.project_id, currency: r.currency, earned: money(r.earned), unratedLines: Number(r.unrated_lines),
    workOrders: Number(r.work_orders), workOrdersWithoutProgress: Number(r.work_orders_without_progress),
  }));
}
