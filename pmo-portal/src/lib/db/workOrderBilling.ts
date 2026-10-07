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
  /** Only on a work order that cannot be totalled, and only when the cause could be read: what stops it (DD-BWO-3). */
  problems?: WorkOrderBillingProblem[];
}

/** One record that stops a work order being totalled: an invoice with no amount, or one in another currency. */
export interface WorkOrderBillingProblem {
  recordId: string;
  /** The invoice's number; null for a claim not raised yet, or an invoice whose number could not be read. */
  number: string | null;
  cause: 'no-amount' | 'other-currency';
  currency: string | null;
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
  /** The client's PO on the work order, when it has one (read beside the document, for the row's label). */
  clientPoNumber: string | null;
}
/** A work order the dashboard could not total — listed so the user can go and fix it (#786 Discover). */
export interface UnbilledIncompleteWorkOrder {
  workOrderId: string;
  woNumber: string | null;
  title: string;
  projectId: string;
  projectName: string;
}
export interface UnbilledWorkOrders {
  totals: UnbilledWorkOrderTotal[];
  incompleteCount: number;
  rows: UnbilledWorkOrderRow[];
  /** Up to the dashboard's row limit; `incompleteCount` is the full count. */
  incomplete: UnbilledIncompleteWorkOrder[];
}

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
  const parsed: WorkOrderBillingRow[] = rows.map((r) => ({
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
  const incomplete = parsed.filter((r) => !r.figuresComplete);
  if (incomplete.length > 0) await attachBillingProblems(incomplete);
  return parsed;
}

/**
 * Names what stops each untotallable work order (DD-BWO-3): a line with no amount, or in a currency other than the work
 * order's. Diagnostic copy only — when it cannot be read the row still says "Can't total", so a failure here never fails
 * the billing read (and never turns into a figure).
 */
async function attachBillingProblems(rows: WorkOrderBillingRow[]): Promise<void> {
  const byId = new Map(rows.map((r) => [r.workOrderId, r] as const));
  const lines = await supabase
    .from('work_order_billing_lines')
    .select('record_id, work_order_id, billed, currency')
    .in('work_order_id', [...byId.keys()]);
  if (lines.error) return;
  const found: Array<{ wo: WorkOrderBillingRow; problem: WorkOrderBillingProblem }> = [];
  for (const l of (lines.data ?? []) as ReadonlyArray<Record<string, unknown>>) {
    const wo = byId.get(String(l.work_order_id));
    if (!wo || typeof l.record_id !== 'string') continue;
    const currency = typeof l.currency === 'string' ? l.currency : null;
    const cause = l.billed == null ? 'no-amount' : currency !== wo.currency ? 'other-currency' : null;
    if (cause) found.push({ wo, problem: { recordId: l.record_id, number: null, cause, currency } });
  }
  if (found.length === 0) return;
  const numbers = new Map<string, string>();
  const invoices = await supabase.from('sales_invoices').select('id, si_number').in('id', found.map((f) => f.problem.recordId));
  if (!invoices.error) {
    for (const i of (invoices.data ?? []) as ReadonlyArray<Record<string, unknown>>) {
      if (typeof i.id === 'string' && typeof i.si_number === 'string' && i.si_number) numbers.set(i.id, i.si_number);
    }
  }
  for (const { wo, problem } of found) {
    (wo.problems ??= []).push({ ...problem, number: numbers.get(problem.recordId) ?? null });
  }
}

/** What is still to invoice across the org (rpc `get_unbilled_work_orders`, aggregated server-side). */
export async function getUnbilledWorkOrders(limit: number): Promise<UnbilledWorkOrders> {
  const { data, error } = await supabase.rpc('get_unbilled_work_orders', { p_limit: limit });
  if (error) throw new AppError(error.message, error.code);
  const doc = parseUnbilledWorkOrders(data);
  const [incomplete, poById] = await Promise.all([
    doc.incompleteCount > 0 ? listIncompleteWorkOrders(limit) : Promise.resolve([]),
    doc.rows.length > 0 ? readClientPos(doc.rows.map((r) => r.workOrderId)) : Promise.resolve(new Map<string, string>()),
  ]);
  return {
    ...doc,
    incomplete,
    rows: doc.rows.map((r) => ({ ...r, clientPoNumber: poById.get(r.workOrderId) ?? null })),
  };
}

/**
 * The work orders behind the dashboard's "not totalled" count, so it can link to them (#786 Discover). Same scope as
 * get_unbilled_work_orders: Issued/Closed, on a project that is not archived. Labels only — a failed read lists none and
 * the count still shows.
 */
async function listIncompleteWorkOrders(limit: number): Promise<UnbilledIncompleteWorkOrder[]> {
  const wos = await supabase
    .from('work_order_billing')
    .select('work_order_id, wo_number, title, project_id')
    .eq('figures_complete', false)
    .in('status', ['Issued', 'Closed'])
    .limit(limit);
  if (wos.error) return [];
  const rows = (wos.data ?? []) as ReadonlyArray<Record<string, unknown>>;
  if (rows.length === 0) return [];
  const projects = await supabase
    .from('projects')
    .select('id, name')
    .in('id', [...new Set(rows.map((r) => String(r.project_id)))])
    .is('archived_at', null);
  if (projects.error) return [];
  const names = new Map(((projects.data ?? []) as ReadonlyArray<Record<string, unknown>>).map((p) => [String(p.id), String(p.name ?? '')] as const));
  return rows
    .filter((r) => names.has(String(r.project_id)))
    .map((r) => ({
      workOrderId: String(r.work_order_id),
      woNumber: typeof r.wo_number === 'string' ? r.wo_number : null,
      title: String(r.title ?? ''),
      projectId: String(r.project_id),
      projectName: names.get(String(r.project_id)) ?? '',
    }));
}

async function readClientPos(ids: string[]): Promise<Map<string, string>> {
  const res = await supabase.from('work_orders').select('id, client_po_number').in('id', ids);
  const out = new Map<string, string>();
  if (res.error) return out;
  for (const r of (res.data ?? []) as ReadonlyArray<Record<string, unknown>>) {
    if (typeof r.client_po_number === 'string' && r.client_po_number) out.set(String(r.id), r.client_po_number);
  }
  return out;
}

/** The RPC document alone, before the labels read beside it. */
type UnbilledDocument = Pick<UnbilledWorkOrders, 'totals' | 'incompleteCount'> & {
  rows: Array<Omit<UnbilledWorkOrderRow, 'clientPoNumber'>>;
};

export function parseUnbilledWorkOrders(data: unknown): UnbilledDocument {
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
