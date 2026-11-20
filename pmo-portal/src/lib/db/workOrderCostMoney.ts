import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { CostSource, WorkOrderCostLine } from '@/src/lib/db/workOrderCosts';
import type { MoneyBySource } from '@/src/lib/workOrderCostView';

/**
 * Money behind a work order's cost lines (#2518, FR-WORP-022). The #2517 view carries no money: each source's own
 * read does (RLS decides). Reads the sources that carry a monetary amount on the record itself. A source
 * whose read returns no rows for ids that exist is reported `null` = restricted; it is never shown as zero.
 */
const TABLE: Partial<Record<CostSource, 'purchase_requests' | 'purchase_orders' | 'procurement_invoices'>> = {
  purchase_request: 'purchase_requests',
  purchase_order: 'purchase_orders',
  vendor_bill: 'procurement_invoices',
};
const CHUNK = 200;

export async function listWorkOrderCostMoney(lines: readonly WorkOrderCostLine[]): Promise<MoneyBySource> {
  const out: MoneyBySource = {};
  for (const source of Object.keys(TABLE) as CostSource[]) {
    const ids = lines.filter((l) => l.source === source).map((l) => l.recordId);
    if (ids.length === 0) continue;
    const found: Record<string, { amount: number; currency: string }> = {};
    let readableCount = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await supabase.from(TABLE[source] as 'purchase_orders').select('id, amount, currency').in('id', ids.slice(i, i + CHUNK));
      if (error) throw new AppError(error.message, error.code);
      readableCount += data?.length ?? 0;
      for (const r of data ?? []) if (r.amount != null) found[r.id] = { amount: Number(r.amount), currency: r.currency };
    }
    out[source] = readableCount < new Set(ids).size ? null : found;
  }
  return out;
}

/** Resolve a purchase record to the timeline of its caller-visible parent case. */
export async function listWorkOrderCostLinks(lines: readonly WorkOrderCostLine[]): Promise<Record<string, string>> {
  const tables = {
    purchase_request: 'purchase_requests', purchase_order: 'purchase_orders',
    goods_receipt: 'procurement_receipts', vendor_bill: 'procurement_invoices',
  } as const;
  const links: Record<string, string> = {};
  for (const source of Object.keys(tables) as Array<keyof typeof tables>) {
    const ids = lines.filter((line) => line.source === source).map((line) => line.recordId);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await supabase.from(tables[source]).select('id, procurement_id').in('id', ids.slice(i, i + CHUNK));
      if (error) throw new AppError(error.message, error.code);
      for (const row of data ?? []) links[`${source}:${row.id}`] = `/procurement/${encodeURIComponent(row.procurement_id)}/timeline#cost-${encodeURIComponent(row.id)}`;
    }
  }
  return links;
}

/** Caller-visible timesheet owner and week, for readable labels on attributed entries. */
export async function listWorkOrderTimesheetLabels(lines: readonly WorkOrderCostLine[]): Promise<Record<string, { person: string; weekStart: string }>> {
  const ids = lines.filter((line) => line.source === 'timesheet_entry').map((line) => line.recordId);
  const labels: Record<string, { person: string; weekStart: string }> = {};
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase.from('timesheet_entries')
      .select('id, timesheet:timesheets(week_start_date, owner:profiles!timesheets_user_id_fkey(full_name))')
      .in('id', ids.slice(i, i + CHUNK)).limit(CHUNK);
    if (error) throw new AppError(error.message, error.code);
    for (const row of data ?? []) {
      const sheet = row.timesheet;
      if (sheet?.week_start_date && sheet.owner?.full_name) labels[row.id] = { person: sheet.owner.full_name, weekStart: sheet.week_start_date };
    }
  }
  return labels;
}
