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
  /** Customer's payment terms in days (from companies.erp_payment_terms_days). */
  erp_payment_terms_days: number | null;
  /** ERP-computed due date from the mirrored SI (when available). */
  erp_due_date: string | null;
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
 * Includes customer's payment terms (erp_payment_terms_days) for due-date derivation.
 */
export async function listSalesInvoices(
  params?: { projectId?: string } & PageParams,
): Promise<SalesInvoiceRow[]> {
  let query = supabase
    .from('sales_invoices')
    .select('*, companies!sales_invoices_customer_id_fkey(erp_payment_terms_days)');
  if (params?.projectId) query = query.eq('project_id', params.projectId);
  const range = resolveRange(params);
  let ordered = query.order('invoice_date', { ascending: false }).order('created_at', { ascending: false });
  if (range) ordered = ordered.range(range.from, range.to);
  const { data, error } = await ordered;
  if (error) throwWrite(error);
  // Transform the joined company data into flat fields
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    erp_payment_terms_days: (row.companies as { erp_payment_terms_days: number | null } | null)?.erp_payment_terms_days ?? null,
    // erp_due_date will be populated when ERP mirror includes it (future enhancement)
    erp_due_date: null,
  })) as SalesInvoiceRow[];
}

/**
 * Fetch a single sales invoice by id, or null when not found / not readable.
 * RLS scopes the row to the caller's org.
 * Includes customer's payment terms (erp_payment_terms_days) for due-date derivation.
 */
export async function getSalesInvoice(id: string): Promise<SalesInvoiceRow | null> {
  const { data, error } = await supabase
    .from('sales_invoices')
    .select('*, companies!sales_invoices_customer_id_fkey(erp_payment_terms_days)')
    .eq('id', id)
    .maybeSingle();
  if (error) throwWrite(error);
  if (!data) return null;
  return {
    ...data,
    erp_payment_terms_days: (data.companies as { erp_payment_terms_days: number | null } | null)?.erp_payment_terms_days ?? null,
    erp_due_date: null,
  } as SalesInvoiceRow;
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
 * PostgREST refuses to return more than `max_rows` (1000, `supabase/config.toml`) rows in ONE
 * response — and signals nothing when it truncates. Any read that aggregates a whole table must
 * therefore page explicitly; this is that page size.
 */
const ROLLUP_PAGE_SIZE = 1000;

/**
 * Revenue rollup per project — SUM(amount) grouped by project_id.
 * Returns an 'Unassigned' bucket for rows where project_id IS NULL (when
 * process_gates.require_project_on_si is OFF).
 * This is a read-model aggregate; it never writes.
 *
 * Money-safety (audit SHOULD-FIX 3): the invoice scan is PAGED. An unpaged `select()` is silently
 * capped at PostgREST's `max_rows` (1000), so past 1000 in-scope invoices `total_amount`,
 * `open_ar` and `invoice_count` were all understated on every revenue view — with no error and no
 * truncation signal — and the understatement grew with the org. Paging keeps the figures exact.
 *
 * Draft exclusion (audit SHOULD-FIX 4, owner ruling 2026-07-20): revenue counts only invoices an
 * approver has SUBMITTED. P3a creates every SI as an ERP DRAFT (OD-SAR-DRAFT-SUBMIT) so the
 * SoD-gated submit is the real commitment — a draft has not hit the GL, and ADR-0048 makes the
 * ledger the oracle. So the scan is a POSITIVE allow-list of the submitted states
 * (`Submitted`/`Unpaid`/`Paid`), not merely "not Cancelled"; a Draft never inflates project revenue,
 * and any status added later is excluded until deliberately admitted here.
 */
const REVENUE_STATUSES = ['Submitted', 'Unpaid', 'Paid'] as const;
export async function getRevenueByProject(): Promise<
  Array<{ project_id: string | null; project_name: string | null; total_amount: number; open_ar: number; invoice_count: number }>
> {
  const agg = new Map<string, { total_amount: number; open_ar: number; invoice_count: number }>();
  for (let page = 0; ; page += 1) {
    const from = page * ROLLUP_PAGE_SIZE;
    const { data, error } = await supabase
      .from('sales_invoices')
      .select('project_id, amount, erp_outstanding_amount')
      .in('status', REVENUE_STATUSES as unknown as string[])
      .range(from, from + ROLLUP_PAGE_SIZE - 1);
    if (error) throwWrite(error);
    const rows = data ?? [];
    for (const row of rows) {
      const key = row.project_id ?? '__unassigned__';
      const existing = agg.get(key) ?? { total_amount: 0, open_ar: 0, invoice_count: 0 };
      existing.total_amount += Number(row.amount ?? 0);
      existing.open_ar += Number(row.erp_outstanding_amount ?? 0);
      existing.invoice_count += 1;
      agg.set(key, existing);
    }
    // A SHORT page proves the end of the set; a full one may or may not be the last, so ask again.
    if (rows.length < ROLLUP_PAGE_SIZE) break;
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