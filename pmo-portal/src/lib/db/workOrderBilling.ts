import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { WorkOrderStatus } from '@/src/lib/db/workOrders';

/**
 * Work-order billing reads (OD-BILL-1, migration 0262). Both sources are SECURITY INVOKER — the caller's RLS is the
 * tenancy boundary; org_id is never sent. Every figure is validated: a missing or non-numeric one is an ERROR, never a
 * plausible 0 (#508, NFR-BWO-005).
 */
export interface WorkOrderBillingRow {
  workOrderId: string;
  projectId: string;
  status: WorkOrderStatus;
  currency: string;
  /** All figures excl. tax in `currency`. */
  orderNet: number;
  invoiced: number;
  pending: number;
  paid: number;
  remaining: number;
  figuresComplete: boolean;
  lineCount: number;
  unpaidCount: number;
}

export interface UnbilledWorkOrderTotal { currency: string; remaining: number; count: number }
export interface UnbilledWorkOrderRow {
  workOrderId: string;
  woNumber: string | null;
  title: string;
  projectId: string;
  projectName: string;
  status: 'Issued' | 'Closed';
  currency: string;
  remaining: number;
  daysSinceClosed: number | null;
}
export interface UnbilledWorkOrders { totals: UnbilledWorkOrderTotal[]; incompleteCount: number; rows: UnbilledWorkOrderRow[] }

export const WORK_ORDER_BILLING_ROW_LIMIT = 500;
const MALFORMED = 'malformed-billing';
const STATUSES: readonly string[] = ['Draft', 'Issued', 'Closed', 'Cancelled'];
const COLS = 'work_order_id, project_id, status, currency, order_net, invoiced, pending, paid, remaining, figures_complete, line_count, unpaid_count';

function num(v: unknown, field: string): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) throw new AppError(`Work order billing: ${field} is missing or not a number`, MALFORMED);
  return n;
}
function text(v: unknown, field: string): string {
  if (typeof v !== 'string' || v === '') throw new AppError(`Work order billing: ${field} is missing`, MALFORMED);
  return v;
}
function flag(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw new AppError(`Work order billing: ${field} is missing`, MALFORMED);
  return v;
}
function status(v: unknown): WorkOrderStatus {
  const s = text(v, 'status');
  if (!STATUSES.includes(s)) throw new AppError(`Work order billing: unknown status ${s}`, MALFORMED);
  return s as WorkOrderStatus;
}

/** One row per work order on the project (view `work_order_billing`). */
export async function listWorkOrderBilling(projectId: string): Promise<WorkOrderBillingRow[]> {
  const { data, error } = await supabase
    .from('work_order_billing')
    .select(COLS)
    .eq('project_id', projectId)
    .limit(WORK_ORDER_BILLING_ROW_LIMIT + 1);
  if (error) throw new AppError(error.message, error.code);
  const rows: ReadonlyArray<Record<string, unknown>> = data ?? [];
  if (rows.length > WORK_ORDER_BILLING_ROW_LIMIT) {
    throw new AppError(`This project has more than ${WORK_ORDER_BILLING_ROW_LIMIT} work orders; billing cannot be shown in one view.`, 'too-many-work-orders');
  }
  return rows.map((r) => ({
    workOrderId: text(r.work_order_id, 'work_order_id'),
    projectId: text(r.project_id, 'project_id'),
    status: status(r.status),
    currency: text(r.currency, 'currency'),
    orderNet: num(r.order_net, 'order_net'),
    invoiced: num(r.invoiced, 'invoiced'),
    pending: num(r.pending, 'pending'),
    paid: num(r.paid, 'paid'),
    remaining: num(r.remaining, 'remaining'),
    figuresComplete: flag(r.figures_complete, 'figures_complete'),
    lineCount: num(r.line_count, 'line_count'),
    unpaidCount: num(r.unpaid_count, 'unpaid_count'),
  }));
}

/** What is still to invoice across the org (rpc `get_unbilled_work_orders`, aggregated server-side). */
export async function getUnbilledWorkOrders(limit: number): Promise<UnbilledWorkOrders> {
  const { data, error } = await supabase.rpc('get_unbilled_work_orders', { p_limit: limit });
  if (error) throw new AppError(error.message, error.code);
  return parseUnbilledWorkOrders(data);
}

export function parseUnbilledWorkOrders(data: unknown): UnbilledWorkOrders {
  const doc = data as { totals?: unknown; incomplete_count?: unknown; rows?: unknown } | null;
  if (!doc || !Array.isArray(doc.totals) || !Array.isArray(doc.rows)) {
    throw new AppError('Work order billing: the still-to-invoice document is malformed', MALFORMED);
  }
  return {
    totals: (doc.totals as Array<Record<string, unknown>>).map((t) => ({
      currency: text(t.currency, 'currency'), remaining: num(t.remaining, 'remaining'), count: num(t.count, 'count'),
    })),
    incompleteCount: num(doc.incomplete_count, 'incomplete_count'),
    rows: (doc.rows as Array<Record<string, unknown>>).map((r) => {
      const s = text(r.status, 'status');
      if (s !== 'Issued' && s !== 'Closed') throw new AppError(`Work order billing: unexpected status ${s}`, MALFORMED);
      return {
        workOrderId: text(r.work_order_id, 'work_order_id'),
        woNumber: r.wo_number == null ? null : text(r.wo_number, 'wo_number'),
        title: text(r.title, 'title'),
        projectId: text(r.project_id, 'project_id'),
        projectName: text(r.project_name, 'project_name'),
        status: s,
        currency: text(r.currency, 'currency'),
        remaining: num(r.remaining, 'remaining'),
        daysSinceClosed: r.days_since_closed == null ? null : num(r.days_since_closed, 'days_since_closed'),
      };
    }),
  };
}
