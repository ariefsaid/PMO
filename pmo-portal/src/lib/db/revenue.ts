import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { resolveRange, type PageParams } from '@/src/lib/pagination';
import { fetchAllPages, fetchAllRowsByKeyset, type PageResult } from '@/src/lib/pagedRead';

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
  '*, companies!sales_invoices_customer_id_fkey(erp_payment_terms_days), sales_invoice_authors(user_id)';

/** One joined SI row → the flat `SalesInvoiceRow` (payment terms + author set flattened). */
function toSalesInvoiceRow(row: Record<string, unknown>): SalesInvoiceRow {
  const authors = (row.sales_invoice_authors as Array<{ user_id: string }> | null) ?? [];
  return {
    ...row,
    erp_payment_terms_days: (row.companies as { erp_payment_terms_days: number | null } | null)?.erp_payment_terms_days ?? null,
    author_user_ids: authors.map((a) => a.user_id),
    // erp_due_date will be populated when ERP mirror includes it (future enhancement)
    erp_due_date: null,
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
    let query = supabase.from('incoming_payments').select('*');
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
    return (data ?? []) as IncomingPaymentRow[];
  }
  return fetchAllPages<IncomingPaymentRow>((from, to) =>
    build(from, to) as unknown as PromiseLike<PageResult<IncomingPaymentRow>>,
  );
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
  // NIT 2 (round-6 re-audit) / audit round 8: KEYSET, not OFFSET — the shared money-sum loop
  // (`src/lib/pagedRead.ts`). A stable ORDER BY makes an offset scan repeatable but not
  // concurrency-safe: an invoice raised between two page reads with a lower-sorting id shifts every
  // later row one slot right, so the next page re-reads the row already counted at the end of the
  // previous one (and a delete skips one). The cursor names the row to RESUME AFTER.
  const invoices = await fetchAllRowsByKeyset<{ id: string; project_id: string | null; amount: number | null; erp_outstanding_amount: number | null }>(
    (afterId, limit) => {
      let query = supabase
        .from('sales_invoices')
        .select('id, project_id, amount, erp_outstanding_amount')
        .in('status', REVENUE_STATUSES as unknown as string[])
        // S1: Postgres guarantees NO row order across statements, so a paged scan without a total
        // ORDER BY can count one invoice twice and skip another when a concurrent write moves a
        // tuple between page reads — Total Revenue then drifts by a whole invoice, silently.
        .order('id', { ascending: true });
      if (afterId !== null) query = query.gt('id', afterId);
      return query.limit(limit) as unknown as PromiseLike<PageResult<{ id: string; project_id: string | null; amount: number | null; erp_outstanding_amount: number | null }>>;
    },
  );
  for (const row of invoices) {
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