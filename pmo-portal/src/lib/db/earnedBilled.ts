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
  projectName: string | null;
  currency: string;
  earned: ExactMoney | null;
  billed: ExactMoney | null;
  cost: ExactMoney | null;
  comparable: boolean;
  restricted: boolean;
  unratedLines: number;
  workOrders: number;
  workOrdersWithoutProgress: number;
}

/** A single scalar response keeps the full project set outside PostgREST's row cap. */
export async function listPackEarned(): Promise<PackEarnedRow[]> {
  const { data, error } = await supabase.rpc('management_pack_project_totals');
  if (error) throw new AppError(error.message, error.code);
  if (!Array.isArray(data)) throw new AppError('Earned and billed read: unexpected response', 'malformed-response');
  return data.map((r) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)
      || typeof r.project_id !== 'string' || typeof r.currency !== 'string'
      || (r.project_name !== null && typeof r.project_name !== 'string')
      || (r.earned !== null && typeof r.earned !== 'number')
      || (r.billed !== null && typeof r.billed !== 'string')
      || (r.cost !== null && typeof r.cost !== 'string')
      || typeof r.comparable !== 'boolean' || typeof r.restricted !== 'boolean'
      || typeof r.unrated_lines !== 'number' || typeof r.work_orders !== 'number'
      || typeof r.work_orders_without_progress !== 'number') {
      throw new AppError('Earned and billed read: unexpected row', 'malformed-response');
    }
    return {
      projectId: r.project_id, projectName: r.project_name, currency: r.currency,
      earned: r.earned === null ? null : money(r.earned), billed: r.billed, cost: r.cost,
      comparable: r.comparable, restricted: r.restricted,
      unratedLines: r.unrated_lines, workOrders: r.work_orders,
      workOrdersWithoutProgress: r.work_orders_without_progress,
    };
  });
}
