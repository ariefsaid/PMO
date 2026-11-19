import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { CostSource, WorkOrderCostLine } from '@/src/lib/db/workOrderCosts';
import type { MoneyBySource } from '@/src/lib/workOrderCostView';

/**
 * Money behind a work order's cost lines (#2518, FR-WORP-022). The #2517 view carries no money: each source's own
 * read does (RLS decides). This version reads the two sources that carry an amount on the record itself. A source
 * whose read returns no rows for ids that exist is reported `null` = restricted; it is never shown as zero.
 */
const TABLE: Partial<Record<CostSource, 'purchase_requests' | 'purchase_orders'>> = {
  purchase_request: 'purchase_requests',
  purchase_order: 'purchase_orders',
};
const CHUNK = 200;

export async function listWorkOrderCostMoney(lines: readonly WorkOrderCostLine[]): Promise<MoneyBySource> {
  const out: MoneyBySource = {};
  for (const source of Object.keys(TABLE) as CostSource[]) {
    const ids = lines.filter((l) => l.source === source).map((l) => l.recordId);
    if (ids.length === 0) continue;
    const found: Record<string, { amount: number; currency: string }> = {};
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await supabase.from(TABLE[source] as 'purchase_orders').select('id, amount, currency').in('id', ids.slice(i, i + CHUNK));
      if (error) throw new AppError(error.message, error.code);
      for (const r of data ?? []) if (r.amount != null) found[r.id] = { amount: Number(r.amount), currency: r.currency };
    }
    out[source] = Object.keys(found).length === 0 ? null : found;
  }
  return out;
}
