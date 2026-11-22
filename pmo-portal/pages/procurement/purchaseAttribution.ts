import type { CostAttribution } from '@/src/lib/repositories/workOrderCosts';

interface AttributedRecord { work_order_id?: string | null; discipline_id?: string | null }

/**
 * Where a purchase's cost already goes: its order's work order and discipline, else the purchase's own, so the receipt and
 * bill forms start from what was chosen at the request. The person can still change it on the form.
 */
export function purchaseAttribution(p: AttributedRecord & { purchase_orders?: readonly AttributedRecord[] | null }): CostAttribution {
  const order = p.purchase_orders?.find((o) => o.work_order_id || o.discipline_id);
  const source = order ?? p;
  return { workOrderId: source.work_order_id ?? null, disciplineId: source.discipline_id ?? null };
}
