import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { REVENUE_STATUSES } from '@/src/lib/projectInvoicing';
import { resolveRange, type PageParams } from '@/src/lib/pagination';
import { fetchAllPages, fetchAllRowsByKeyset, type PageResult } from '@/src/lib/pagedRead';

/** Row shapes matching the DB schema (snake_case) from migration 0104. */
export interface SalesInvoiceRow {
  id: string;
  org_id: string;
  project_id: string | null;
  customer_id: string | null;
  /** #781 (AC-FIN-001): the customer's company NAME, resolved in the same read (never rendered as the opaque `customer_id`). Null when the relation is missing. */
  customer_name: string | null;
  si_number: string | null;
  reference_number: string | null;
  invoice_date: string | null;
  amount: number | null;
  /** FR-L10N-020: the invoice's OWN denomination (0187). `select('*')` already returned it — the
   *  hand-written interface simply never declared it, so the column was invisible to every caller. */
  currency: string;
  /**
   * OD-TAX-1 §2 / migration 0188: does `amount` ALREADY include its tax? NOT NULL in the database —
   * the marker exists on every sales invoice, so no invoice total may be rendered bare. Declared
   * here for the same reason `currency` above had to be: `select('*')` has always returned it, and
   * an undeclared column is invisible to every caller and to the compiler alike.
   */
  tax_treatment: string;
  /** Stored tax value used to convert this invoice to a comparable basis (0188). */
  tax_amount: number;
  tax_rate?: number | null;
  tax_base_numerator?: number;
  tax_base_denominator?: number;
  erp_outstanding_amount: number | null;
  status: 'Draft' | 'Submitted' | 'Unpaid' | 'Paid' | 'Cancelled';
  erp_docstatus: number | null;
  erp_modified: string | null;
  erp_amended_from: string | null;
  erp_cancelled_at: string | null;
  created_at: string;
  author_user_id: string | null;
  /**
   * EVERY user who has built this invoice's ERP body — migration 0113's append-only
   * `sales_invoice_authors` set, which is the SoD oracle `submit_sales_invoice` actually enforces.
   * `author_user_id` alone is last-writer-wins: a co-worker's edit moves it, so comparing only the
   * scalar showed an earlier body writer an ENABLED "Submit" that then 403'd (round-6 re-audit NIT 1).
   * Always an array — `[]` for an invoice with no recorded writer (which the RPC refuses outright).
   */
  author_user_ids: string[];
  /** Customer's payment terms in days (from companies.erp_payment_terms_days). */
  erp_payment_terms_days: number | null;
  /** ERP-computed due date from the mirrored SI (when available). */
  erp_due_date: string | null;
  /** #767: the date the client received the invoice; due = this + the customer's terms when set. */
  received_date: string | null;
}

export interface IncomingPaymentRow {
  received_amount?: number | null;
  withheld_amount?: number | null;
  withholding_slip_number?: string | null;
  id: string;
  org_id: string;
  customer_id: string | null;
  /** #781 (AC-FIN-001): the customer's company NAME, resolved in the same read (never rendered as the opaque `customer_id`). Null when the relation is missing. */
  customer_name: string | null;
  sales_invoice_id: string | null;
  ip_number: string | null;
  reference_number: string | null;
  date: string | null;
  amount: number | null;
  /** FR-L10N-020: the payment's OWN denomination (0187). See SalesInvoiceRow. */
  currency: string;
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
 * PostgREST refuses to return more than `max_rows` (1000, `supabase/config.toml`) rows in ONE
 * response — and signals nothing when it truncates. Any read that must see a WHOLE table
 * (the revenue rollup, and the money lists whose client-side search indexes them) therefore
 * pages explicitly, via the shared `fetchAllPages` seam (`src/lib/pagedRead.ts`) — the ONE
 * definition every scope with this hazard uses, so a fix here can never again be "fixed in one
 * place, alive in another" (Luna audit round 8).
 */

/**
 * List all sales invoices in the caller's org (RLS scopes org).
 * Optional `projectId` filters to a single project.
 * Ordered by invoice_date desc for a stable, scannable list.
 * Includes customer's payment terms (erp_payment_terms_days) for due-date derivation.
 *
 * Money-safety (read-model audit S6): with no explicit `page`/`pageSize` this scans the WHOLE
 * list in `PAGE_SCAN_SIZE` pages. A single unpaged request is silently capped at PostgREST's
 * `max_rows`, so past 1000 invoices the list — and the client-side search that indexes it —
 * saw only the newest 1000 and answered "No invoices match your filters" for an invoice that
 * exists. An explicit `page`/`pageSize` still issues exactly one bounded request.
 */
/**
 * The invoice projection every SI read shares: the row, the customer's payment terms, and the
 * append-only AUTHOR SET (0113) that the submit SoD is really enforced on — the affordance must
 * consult the same oracle as the RPC, or it offers a "Submit" that 403s (round-6 re-audit NIT 1).
 */
const SALES_INVOICE_SELECT =
  '*, companies!sales_invoices_customer_id_fkey(erp_payment_terms_days,name), sales_invoice_authors(user_id)';

/** One joined SI row → the flat `SalesInvoiceRow` (payment terms + author set + customer name flattened). */
function toSalesInvoiceRow(row: Record<string, unknown>): SalesInvoiceRow {
  const authors = (row.sales_invoice_authors as Array<{ user_id: string }> | null) ?? [];
  const companies = row.companies as { erp_payment_terms_days: number | null; name: string | null } | null;
  return {
    ...row,
    erp_payment_terms_days: companies?.erp_payment_terms_days ?? null,
    customer_name: companies?.name ?? null,
    author_user_ids: authors.map((a) => a.user_id),
    erp_due_date: (row.erp_due_date as string | null | undefined) ?? null,
    received_date: (row.received_date as string | null | undefined) ?? null,
  } as unknown as SalesInvoiceRow;
}

export async function listSalesInvoices(
  params?: { projectId?: string } & PageParams,
): Promise<SalesInvoiceRow[]> {
  const build = (from: number, to: number) => {
    let query = supabase
      .from('sales_invoices')
      .select(SALES_INVOICE_SELECT);
    if (params?.projectId) query = query.eq('project_id', params.projectId);
    return query
      .order('invoice_date', { ascending: false })
      .order('created_at', { ascending: false })
      // Total, stable ordering — the tiebreaker that makes the paged scan repeatable.
      .order('id', { ascending: true })
      .range(from, to);
  };

  const range = resolveRange(params);
  let data: Array<Record<string, unknown>>;
  if (range) {
    const res = await build(range.from, range.to);
    if (res.error) throwWrite(res.error);
    data = (res.data ?? []) as Array<Record<string, unknown>>;
  } else {
    data = await fetchAllPages<Record<string, unknown>>((from, to) =>
      build(from, to) as unknown as PromiseLike<PageResult<Record<string, unknown>>>,
    );
  }
  return data.map(toSalesInvoiceRow);
}

/**
 * Fetch a single sales invoice by id, or null when not found / not readable.
 * RLS scopes the row to the caller's org.
 * Includes customer's payment terms (erp_payment_terms_days) for due-date derivation.
 */
export async function getSalesInvoice(id: string): Promise<SalesInvoiceRow | null> {
  const { data, error } = await supabase
    .from('sales_invoices')
    .select(SALES_INVOICE_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throwWrite(error);
  if (!data) return null;
  return toSalesInvoiceRow(data as Record<string, unknown>);
}

/**
 * The incoming-payment projection every IP read shares, embedding the customer's company NAME in
 * the SAME read (AC-FIN-001). The join is explicit-FK qualified (`incoming_payments_customer_id_fkey`)
 * exactly like `projects.ts` — PostgREST embeds break when the target gains a second FK to the same
 * row, and the inline `references public.companies(id)` in migration 0123 yields that default name.
 */
const INCOMING_PAYMENT_SELECT =
  '*, customer:companies!incoming_payments_customer_id_fkey(name)';

/** One joined IP row → the flat `IncomingPaymentRow` (customer name flattened). */
function toIncomingPaymentRow(row: Record<string, unknown>): IncomingPaymentRow {
  const customer = row.customer as { name: string | null } | null;
  return {
    ...row,
    customer_name: customer?.name ?? null,
  } as unknown as IncomingPaymentRow;
}

/**
 * List all incoming payments in the caller's org (RLS scopes org).
 * Optional `customerId` filters to one customer.
 * Ordered by date desc then created_at desc, with an `id` tiebreaker so the scan is stable.
 *
 * Same money-safety contract as `listSalesInvoices` (audit S6): unpaged callers get the WHOLE
 * list via successive pages, never a silently-capped first 1000.
 */
export async function listIncomingPayments(
  params?: { customerId?: string } & PageParams,
): Promise<IncomingPaymentRow[]> {
  const build = (from: number, to: number) => {
    let query = supabase.from('incoming_payments').select(INCOMING_PAYMENT_SELECT);
    if (params?.customerId) query = query.eq('customer_id', params.customerId);
    return query
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to);
  };

  const range = resolveRange(params);
  if (range) {
    const { data, error } = await build(range.from, range.to);
    if (error) throwWrite(error);
    return ((data ?? []) as Array<Record<string, unknown>>).map(toIncomingPaymentRow);
  }
  const data = await fetchAllPages<Record<string, unknown>>((from, to) =>
    build(from, to) as unknown as PromiseLike<PageResult<Record<string, unknown>>>,
  );
  return data.map(toIncomingPaymentRow);
}

/**
 * Fetch a single incoming payment by id, or null when not found / not readable.
 * RLS scopes the row to the caller's org.
 */
export async function getIncomingPayment(id: string): Promise<IncomingPaymentRow | null> {
  const { data, error } = await supabase
    .from('incoming_payments')
    .select(INCOMING_PAYMENT_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throwWrite(error);
  if (!data) return null;
  return toIncomingPaymentRow(data as Record<string, unknown>);
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
 * #767 (AC-DUE-001): record (or clear, with null) the date the client received the invoice.
 * Admin/Finance, draft or submitted — enforced by the SECURITY DEFINER RPC, not the UI.
 */
export async function setSalesInvoiceReceivedDate(siId: string, receivedDate: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_sales_invoice_received_date', {
    p_si_id: siId,
    p_received_date: receivedDate as string,
  });
  if (error) throwWrite(error);
}

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
export interface RevenueByProjectRow {
  project_id: string | null;
  project_name: string | null;
  /** The invoices' own currency — totals are per (project, currency), never converted (#831). */
  currency: string;
  /** NET of tax, from the shared `sales_invoice_work_billed` view (the management pack's definition). */
  total_amount: number;
  open_ar: number;
  invoice_count: number;
}

type RevenueAgg = { currency: string; total_amount: number; open_ar: number; invoice_count: number };

/**
 * #831: Total Revenue is billed WORK, net of tax, read from the one shared definition the management
 * pack uses (`sales_invoice_work_billed`, DD-PBL-9): a down-payment invoice is an advance, not work
 * (excluded), and a claim invoice counts at net plus the recovery its negative line removed. Totals are
 * grouped per (project, currency) and never converted. Open AR stays the invoices' outstanding amount
 * (what is owed, tax included), read from `sales_invoices` and grouped the same way.
 */
export async function getRevenueByProject(): Promise<RevenueByProjectRow[]> {
  const agg = new Map<string, RevenueAgg & { project_id: string | null }>();
  const bucket = (projectId: string | null, currency: string) => {
    const key = `${projectId ?? '__unassigned__'}|${currency}`;
    let entry = agg.get(key);
    if (!entry) {
      entry = { project_id: projectId, currency, total_amount: 0, open_ar: 0, invoice_count: 0 };
      agg.set(key, entry);
    }
    return entry;
  };
  // NIT 2 (round-6 re-audit) / audit round 8: KEYSET, not OFFSET — the shared money-sum loop
  // (`src/lib/pagedRead.ts`). The cursor names the row to RESUME AFTER, so a concurrent insert can
  // neither duplicate nor skip an already-scanned invoice. S1: a total ORDER BY id makes it repeatable.
  type WorkRow = { id: string; project_id: string | null; currency: string | null; net: number | null; recovery: number | null };
  const work = await fetchAllRowsByKeyset<WorkRow>((afterId, limit) => {
    let query = supabase
      .from('sales_invoice_work_billed')
      .select('id, project_id, currency, net, recovery')
      .in('status', REVENUE_STATUSES as unknown as string[])
      .eq('is_down_payment', false)
      .order('id', { ascending: true });
    if (afterId !== null) query = query.gt('id', afterId);
    return query.limit(limit) as unknown as PromiseLike<PageResult<WorkRow>>;
  });
  for (const row of work) {
    if (row.net === null || row.net === undefined) continue;
    const entry = bucket(row.project_id, row.currency ?? '');
    entry.total_amount += Number(row.net) + Number(row.recovery ?? 0);
    entry.invoice_count += 1;
  }

  type ArRow = { id: string; project_id: string | null; currency: string | null; erp_outstanding_amount: number | null };
  const ar = await fetchAllRowsByKeyset<ArRow>((afterId, limit) => {
    let query = supabase
      .from('sales_invoices')
      .select('id, project_id, currency, erp_outstanding_amount')
      .in('status', REVENUE_STATUSES as unknown as string[])
      .order('id', { ascending: true });
    if (afterId !== null) query = query.gt('id', afterId);
    return query.limit(limit) as unknown as PromiseLike<PageResult<ArRow>>;
  });
  for (const row of ar) {
    const outstanding = Number(row.erp_outstanding_amount ?? 0);
    if (outstanding === 0) continue;
    bucket(row.project_id, row.currency ?? '').open_ar += outstanding;
  }

  // Resolve project names for non-null project_ids
  const projectIds = Array.from(new Set(Array.from(agg.values()).map((v) => v.project_id).filter((id): id is string => id !== null)));
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

  return Array.from(agg.values()).map((v) => ({
    project_id: v.project_id,
    project_name: v.project_id ? (projectNames.get(v.project_id) ?? null) : null,
    currency: v.currency,
    total_amount: v.total_amount,
    open_ar: v.open_ar,
    invoice_count: v.invoice_count,
  }));
}
