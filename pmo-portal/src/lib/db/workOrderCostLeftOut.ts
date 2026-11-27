import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { sumDecimal } from '@/src/lib/exactDecimal';
import type { ExactMoney } from '@/src/lib/projectFinances';

export const LEFT_OUT_KINDS = [
  'unpaid_bill',
  'purchase_order',
  'goods_receipt',
  'uncounted_stock',
  'unapproved_claim',
  'unapproved_labour',
  'unrated_labour',
  'unapproved_equipment',
  'unrated_equipment',
] as const;

export type LeftOutKind = typeof LEFT_OUT_KINDS[number];

export interface LeftOutItem {
  kind: LeftOutKind;
  count: number;
  currency: string | null;
  total: ExactMoney | null;
}

export interface WorkOrderCostLeftOut {
  workOrderId: string;
  pricesHidden: boolean;
  labourCostEnabled: boolean;
  stockIssueCostEnabled: boolean;
  items: LeftOutItem[];
}

export interface LeftOutSummary {
  totalCount: number;
  /** Non-null only when every left-out kind carries a reliable total in the same currency. */
  combinedTotal: { amount: ExactMoney; currency: string } | null;
}

const MALFORMED = 'malformed-response';
const EXACT = /^-?\d+(\.\d{1,2})?$/;

function isRefused(code: unknown): boolean {
  return code === '42501' || code === 'P0002';
}

export function parseWorkOrderCostLeftOut(raw: unknown): WorkOrderCostLeftOut {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError('Work-order left-out cost: unexpected response', MALFORMED);
  }
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.workOrderId !== 'string' ||
    typeof obj.pricesHidden !== 'boolean' ||
    typeof obj.labourCostEnabled !== 'boolean' ||
    typeof obj.stockIssueCostEnabled !== 'boolean' ||
    !Array.isArray(obj.items)
  ) {
    throw new AppError('Work-order left-out cost: unexpected shape', MALFORMED);
  }

  const items: LeftOutItem[] = obj.items.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new AppError('Work-order left-out cost: unexpected item', MALFORMED);
    }
    const r = entry as Record<string, unknown>;
    if (!LEFT_OUT_KINDS.includes(r.kind as LeftOutKind) || typeof r.count !== 'number' || !Number.isInteger(r.count) || r.count <= 0) {
      throw new AppError('Work-order left-out cost: invalid item', MALFORMED);
    }
    const total = r.total === null || r.total === undefined ? null : String(r.total);
    if (total !== null && !EXACT.test(total)) {
      throw new AppError('Work-order left-out cost: unreadable total', MALFORMED);
    }
    const currency = typeof r.currency === 'string' && r.currency.length > 0 ? r.currency : null;
    if ((total !== null && currency === null) || (total === null && currency !== null)) {
      throw new AppError('Work-order left-out cost: mismatched total and currency', MALFORMED);
    }
    return {
      kind: r.kind as LeftOutKind,
      count: r.count,
      currency,
      total,
    };
  });

  return {
    workOrderId: obj.workOrderId,
    pricesHidden: obj.pricesHidden,
    labourCostEnabled: obj.labourCostEnabled,
    stockIssueCostEnabled: obj.stockIssueCostEnabled,
    items,
  };
}

/**
 * Pure summary for the collapsed single line: total record count across all left-out kinds,
 * plus the combined money total only when EVERY kind has a reliable total in ONE currency.
 */
export function summarizeLeftOut(data: WorkOrderCostLeftOut): LeftOutSummary {
  const totalCount = data.items.reduce((sum, item) => sum + item.count, 0);
  if (data.items.length === 0 || data.pricesHidden) {
    return { totalCount, combinedTotal: null };
  }
  const allPriced = data.items.every((item) => item.total !== null && item.currency !== null);
  if (!allPriced) {
    return { totalCount, combinedTotal: null };
  }
  const currencies = new Set(data.items.map((item) => item.currency as string));
  if (currencies.size !== 1) {
    return { totalCount, combinedTotal: null };
  }
  const currency = data.items[0].currency as string;
  const amount = sumDecimal(data.items.map((item) => item.total as string), 2);
  return { totalCount, combinedTotal: { amount, currency } };
}

/** One set-based read of uncounted costs for a work order; returns null if caller is refused (42501/P0002). */
export async function getWorkOrderCostLeftOut(workOrderId: string): Promise<WorkOrderCostLeftOut | null> {
  const { data, error } = await supabase.rpc('work_order_cost_left_out', { p_work_order_id: workOrderId });
  if (error) {
    if (isRefused(error.code)) return null;
    throw new AppError(error.message, error.code);
  }
  return parseWorkOrderCostLeftOut(data);
}
