import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { sumDecimal } from '@/src/lib/exactDecimal';

/**
 * Idle hours as cost (#2673, migrations 1255-1256). Data access only. The switch is written by Admin and Finance
 * (RPC is the authority, ADR-0016). The read returns nothing unless BOTH this switch and labour cost are on.
 * Money is exact text (scale two), never a float on the wire.
 */
export interface IdleCostRow {
  workOrderId: string; reasonId: string; reasonLabel: string; minutes: number; hours: string;
  hourlyCost: string | null; amount: string | null; currency: string; reason: 'counted' | 'no-rate';
}
const EXACT = /^-?\d{1,15}(\.\d{1,2})?$/;

export async function getIdleCostEnabled(): Promise<boolean> {
  const { data, error } = await supabase.from('idle_cost_settings').select('enabled').maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  return data?.enabled === true;
}

export async function setIdleCostEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('save_idle_cost_setting', { p_enabled: enabled });
  if (error) throw new AppError(error.message, error.code);
}

export async function listProjectIdleCost(projectId: string): Promise<IdleCostRow[]> {
  const { data, error } = await supabase.rpc('work_order_idle_cost', { p_project_id: projectId });
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []).map((r) => {
    if ((r.amount !== null && !EXACT.test(r.amount)) || !EXACT.test(r.hours) || (r.reason !== 'counted' && r.reason !== 'no-rate')) {
      throw new AppError('Idle cost read: unreadable row', 'malformed');
    }
    return {
      workOrderId: r.work_order_id, reasonId: r.reason_id, reasonLabel: r.reason_label, minutes: Number(r.minutes), hours: r.hours,
      hourlyCost: r.hourly_cost, amount: r.amount, currency: r.currency, reason: r.reason,
    };
  });
}

/** Sum of the priced rows of one work order, exact to the cent: the amount strings are summed as exact decimals, no float drift. */
export function totalIdleAmount(rows: readonly IdleCostRow[]): string | null {
  const priced = rows.filter((r) => r.amount !== null);
  if (priced.length === 0) return null;
  return sumDecimal(priced.map((r) => r.amount), 2);
}
