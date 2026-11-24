import { supabase } from '@/src/lib/supabase/client';
import { toAppError } from '@/src/lib/appError';
export async function getStockIssueCostSettings(): Promise<{ effectiveOn: string | null }> {
  const { data, error } = await supabase.from('stock_issue_cost_settings').select('effective_on').maybeSingle();
  if (error) throw toAppError(error);
  return { effectiveOn: data?.effective_on ?? null };
}
export async function setStockIssueCostDate(effectiveOn: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_stock_issue_cost_date', { p_effective_on: effectiveOn });
  if (error) throw toAppError(error);
}
