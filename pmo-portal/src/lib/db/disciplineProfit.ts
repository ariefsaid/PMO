import { supabase } from '@/src/lib/supabase/client';
import { nullableArg } from './nullableArg';
import { AppError } from '@/src/lib/appError';
import type { DisciplineRevenueRow } from '@/src/lib/disciplineProfit';

/**
 * Profit per discipline (#2669, migrations 1265/1266). Data access only: the figures are joined in
 * `src/lib/disciplineProfit.ts`. org_id is never sent; the RPCs scope everything to the caller's organisation.
 */
const SCALE_TWO = /^-?\d+\.\d{2}$/;

export async function getDisciplineProfitEnabled(): Promise<boolean> {
  const { data, error } = await supabase.rpc('get_org_discipline_profit_enabled');
  if (error) throw new AppError(error.message, error.code);
  return data === true;
}

/** Admin only (the server enforces it). */
export async function setDisciplineProfitEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_org_discipline_profit_enabled', { p_enabled: enabled });
  if (error) throw new AppError(error.message, error.code);
}

/**
 * Validated revenue per discipline. A caller who may not see revenue is refused by the server (42501): that is
 * returned as `'restricted'`, never as an empty list.
 */
export async function listDisciplineRevenue(projectId: string): Promise<DisciplineRevenueRow[] | 'restricted'> {
  const { data, error } = await supabase.rpc('project_discipline_revenue', { p_project: projectId });
  if (error) {
    if (error.code === '42501') return 'restricted';
    throw new AppError(error.message, error.code);
  }
  return (data ?? []).map((r) => {
    const revenue = String(r.revenue);
    const text = SCALE_TWO.test(revenue) ? revenue : Number(revenue).toFixed(2);
    if (!Number.isFinite(Number(revenue)) || typeof r.basis !== 'string' || typeof r.currency !== 'string') {
      throw new AppError('Discipline revenue read: unexpected row', 'malformed-response');
    }
    return {
      basis: r.basis, disciplineId: r.discipline_id, currency: r.currency, revenue: text,
      validatedLines: Number(r.validated_lines), unratedLines: Number(r.unrated_lines),
    };
  });
}

export async function setBoqItemDiscipline(itemId: string, disciplineId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_boq_item_discipline', { p_item: itemId, p_discipline: nullableArg(disciplineId) });
  if (error) throw new AppError(error.message, error.code);
}
