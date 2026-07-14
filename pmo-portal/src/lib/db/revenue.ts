import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { resolveRange, type PageParams } from '@/src/lib/pagination';

/** Row shapes matching the DB schema (snake_case) from migration 0104. */
export interface SalesInvoiceRow {
  id: string;
  org_id: string;
  project_id: string | null;
  customer_id: string | null;
  si_number: string | null;
  reference_number: string | null;
  invoice_date: string | null;
  amount: number | null;
  erp_outstanding_amount: number | null;
  status: 'Draft' | 'Submitted' | 'Unpaid' | 'Paid' | 'Cancelled';
  erp_docstatus: number | null;
  erp_modified: string | null;
  erp_amended_from: string | null;
  erp_cancelled_at: string | null;
  created_at: string;
  author_user_id: string | null;
}

export interface IncomingPaymentRow {
  id: string;
  org_id: string;
  customer_id: string | null;
  sales_invoice_id: string | null;
  ip_number: string | null;
  reference_number: string | null;
  date: string | null;
  amount: number | null;
  status: 'Scheduled' | 'Paid';
  erp_docstatus: number | null;
  erp_modified: string | null;
  erp_amended_from: string | null;
  erp_cancelled_at: string | null;
  created_at: string;
}

export type SalesInvoiceStatus = SalesInvoiceRow['status'];
export type IncomingPaymentStatus = IncomingPaymentRow['status'];

interface PostgrestErrorLike {
  message: string;
  code?: string;
}

function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

/**
 * List all sales invoices in the caller's org (RLS scopes org).
 * Optional `projectId` filters to a single project.
 * Ordered by invoice_date desc for a stable, scannable list.
 */
export async function listSalesInvoices(
  params?: { projectId?: string } & PageParams,
): Promise<SalesInvoiceRow[]> {
  let query = supabase.from('sales_invoices').select('*');
  if (params?.projectId) query = query.eq('project_id', params.projectId);
  const range = resolveRange(params);
  let ordered = query.order('invoice_date', { ascending: false }).order('created_at', { ascending: false });
  if (range) ordered = ordered.range(range.from, range.to);
  const { data, error } = await ordered;
  if (error) throwWrite(error);
  return (data ?? []) as SalesInvoiceRow[];
}

/**
 * Fetch a single sales invoice by id, or null when not found / not readable.
 * RLS scopes the row to the caller's org.
 */
export async function getSalesInvoice(id: string): Promise<SalesInvoiceRow | null> {
  const { data, error } = await supabase.from('sales_invoices').select('*').eq('id', id).maybeSingle();
  if (error) throwWrite(error);
  return (data ?? null) as SalesInvoiceRow | null;
}

/**
 * List all incoming payments in the caller's org (RLS scopes org).
 * Optional `customerId` filters to one customer.
 * Ordered by date desc then created_at desc.
 */
export async function listIncomingPayments(
  params?: { customerId?: string } & PageParams,
): Promise<IncomingPaymentRow[]> {
  let query = supabase.from('incoming_payments').select('*');
  if (params?.customerId) query = query.eq('customer_id', params.customerId);
  const range = resolveRange(params);
  let ordered = query.order('date', { ascending: false }).order('created_at', { ascending: false });
  if (range) ordered = ordered.range(range.from, range.to);
  const { data, error } = await ordered;
  if (error) throwWrite(error);
  return (data ?? []) as IncomingPaymentRow[];
}

/**
 * Fetch a single incoming payment by id, or null when not found / not readable.
 * RLS scopes the row to the caller's org.
 */
export async function getIncomingPayment(id: string): Promise<IncomingPaymentRow | null> {
  const { data, error } = await supabase.from('incoming_payments').select('*').eq('id', id).maybeSingle();
  if (error) throwWrite(error);
  return (data ?? null) as IncomingPaymentRow | null;
}

/**
 * Submit a Sales Invoice through the SoD-gated RPC.
 * Enforces approver ≠ author (42501 on self-approval) BEFORE any ERP dispatch.
 * Throws AppError with code '42501' if SoD check fails.
 */
export async function submitSalesInvoiceSod(siId: string): Promise<void> {
  const { error } = await supabase.rpc('submit_sales_invoice', { p_si_id: siId });
  if (error) throw error;
}

/**
 * Revenue rollup per project — SUM(amount) grouped by project_id.
 * Returns an 'Unassigned' bucket for rows where project_id IS NULL (when
 * process_gates.require_project_on_si is OFF).
 * This is a read-model aggregate; it never writes.
 */
export async function getRevenueByProject(): Promise<
  Array<{ project_id: string | null; project_name: string | null; total_amount: number; open_ar: number; invoice_count: number }>
> {
  const { data, error } = await supabase
    .from('sales_invoices')
    .select('project_id, amount, erp_outstanding_amount')
    .neq('status', 'Cancelled');
  if (error) throwWrite(error);

  const agg = new Map<string, { total_amount: number; open_ar: number; invoice_count: number }>();
  for (const row of data ?? []) {
    const key = row.project_id ?? '__unassigned__';
    const existing = agg.get(key) ?? { total_amount: 0, open_ar: 0, invoice_count: 0 };
    existing.total_amount += Number(row.amount ?? 0);
    existing.open_ar += Number(row.erp_outstanding_amount ?? 0);
    existing.invoice_count += 1;
    agg.set(key, existing);
  }

  // Resolve project names for non-null project_ids
  const projectIds = Array.from(agg.keys()).filter((k) => k !== '__unassigned__');
  let projectNames = new Map<string, string>();
  if (projectIds.length > 0) {
    const { data: projects } = await supabase
      .from('projects')
      .select('id, name')
      .in('id', projectIds);
    if (projects) {
      projectNames = new Map(projects.map((p: { id: string; name: string }) => [p.id, p.name]));
    }
  }

  const result: Array<{ project_id: string | null; project_name: string | null; total_amount: number; open_ar: number; invoice_count: number }> = [];
  for (const [key, value] of agg.entries()) {
    if (key === '__unassigned__') {
      result.push({ project_id: null, project_name: null, ...value });
    } else {
      const pName = projectNames.get(key) ?? null;
      result.push({ project_id: key, project_name: pName, ...value });
    }
  }
  return result;
}