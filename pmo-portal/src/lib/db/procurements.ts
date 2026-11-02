import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';
import { fetchAllRowsByKeyset } from '@/src/lib/pagedRead';
import { attachApprovalRoutes } from './approvalRoutes';
import type { ApprovalRoute } from '@/src/lib/procurement/approvalRoute';

export type ProcurementRow = Tables<'procurements'>;

/** A procurement row with project/vendor/requester names resolved in SQL (kills render-time .find()). */
export type ProcurementWithRefs = ProcurementRow & {
  project: { name: string; short_name?: string | null; code: string | null; pmo_project_number?: string | null; project_manager_id?: string | null } | null;
  vendor: { name: string } | null;
  requested_by: { full_name: string } | null;
  /** #803: present only on a Requested row whose route was read (see attachApprovalRoutes). */
  approvalRoute?: ApprovalRoute;
  /** #769: the parent group's numbers on this case's PR / PO / vendor-invoice records (search + export). */
  pr_refs?: { external_ref: string | null }[];
  po_refs?: { external_ref: string | null }[];
  vi_refs?: { external_ref: string | null }[];
  /** FR-PFE-037: the server's open commitment (SQL `procurement_open_commitment`); the list sums this, not total_value. */
  open_commitment?: number | null;
  /** Project-detail stage dates, loaded in one embedded query rather than one detail request per row. */
  status_events?: Pick<Tables<'procurement_status_events'>, 'to_status' | 'created_at'>[];
  /** Shared procurement list calculation inputs, fetched in the same query (no row-by-row detail reads). */
  purchase_requests?: Pick<Tables<'purchase_requests'>, 'amount' | 'date' | 'created_at' | 'external_ref'>[];
  purchase_orders?: Pick<Tables<'purchase_orders'>, 'amount' | 'date' | 'created_at' | 'external_ref'>[];
  receipts?: Pick<Tables<'procurement_receipts'>, 'receipt_date' | 'created_at'>[];
  procurement_invoices?: Pick<Tables<'procurement_invoices'>, 'amount' | 'invoice_date' | 'created_at' | 'erp_outstanding_amount' | 'external_ref'>[];
  payments?: Pick<Tables<'payments'>, 'amount' | 'date' | 'created_at' | 'status'>[];
};

/** Every non-empty external reference on a case's PR / PO / vendor-invoice records, in that order. */
export function externalRefsOf(p: ProcurementWithRefs): string[] {
  return [...(p.pr_refs ?? []), ...(p.po_refs ?? []), ...(p.vi_refs ?? [])]
    .map((r) => r.external_ref)
    .filter((v): v is string => !!v);
}

const SELECT =
  '*, project:projects(name,short_name,code), vendor:companies(name), requested_by:profiles!procurements_requested_by_id_fkey(full_name), open_commitment:procurement_open_commitment';

const SELECT_SHARED_LIST =
  '*, project:projects(name,short_name,code,project_manager_id), vendor:companies(name), requested_by:profiles!procurements_requested_by_id_fkey(full_name), open_commitment:procurement_open_commitment';

const PROCUREMENT_LIST_DETAILS = [
  'status_events:procurement_status_events(to_status,created_at)',
  'purchase_requests(amount,date,created_at,external_ref)',
  'purchase_orders(amount,date,created_at,external_ref)',
  'receipts:procurement_receipts(receipt_date,created_at)',
  'procurement_invoices(amount,invoice_date,created_at,erp_outstanding_amount,external_ref)',
  'payments(amount,date,created_at,status)',
].join(', ');

/** Procurement index select: references for search plus the shared list's money/stage inputs.
 *  Approvals, dashboards and every other `listProcurements` caller keep the lean `SELECT`. */
const SELECT_WITH_REFS =
  `${SELECT}, pr_refs:purchase_requests(external_ref), po_refs:purchase_orders(external_ref), vi_refs:procurement_invoices(external_ref)`;

const SELECT_WITH_SHARED_DETAILS =
  `${SELECT_SHARED_LIST}, ${PROCUREMENT_LIST_DETAILS}, pr_refs:purchase_requests(external_ref), po_refs:purchase_orders(external_ref), vi_refs:procurement_invoices(external_ref)`;

/** The shared project list carries the same finance and stage inputs as the company-wide list. */
const PROJECT_DETAIL_SELECT = `${SELECT_WITH_SHARED_DETAILS}`;

/**
 * Committed-spend basis for ONE project (OD-W5-4): Σ procurement total_value where the PR is
 * Ordered / Received / Vendor Invoiced / Paid — the EXACT basis the dashboards use
 * (0009_dashboard_margin.sql `on_hand.spent`). org_id is NEVER sent — RLS scopes by org.
 * Returns 0 when the project has no committed POs.
 *
 * SINGLE DEFINITION (OD-BUDGET-2): committed spend = Σ(total_value) for statuses Ordered,
 * Received, Vendor Invoiced, Paid. The three implementations of this basis — this client hook,
 * projects.spent (0009), and get_projects_delivery.committed_spend (0026) — MUST agree. A pgTAP
 * drift guard (0069_dashboard_at_risk_boundary.test.sql) asserts the SQL pair stays in sync.
 */
export const COMMITTED_STATUSES: ProcurementRow['status'][] = [
  'Ordered',
  'Received',
  'Vendor Invoiced',
  'Paid',
];

/** Committed spend for one project: the figure in the project's currency, and each other currency kept apart. */
export interface ProjectCommittedSpend {
  /** Open commitment in the project's currency. */
  amount: number;
  /** Open commitments in other currencies — never added to `amount` and never shown as the project currency. */
  otherCurrencies: Array<{ currency: string; amount: number }>;
}

/**
 * Committed spend for ONE project — SINGLE DEFINITION is SQL `project_committed_spend` (0361, FR-PFE-037; per currency
 * since 0373): Σ open commitment over Ordered..Paid purchases; in an ERP-ledger org an invoice already on the ledger is
 * not counted again (ADR-0093). No conversion: a purchase in another currency is its own position.
 */
export async function getProjectCommittedSpend(projectId: string): Promise<ProjectCommittedSpend> {
  const { data, error } = await supabase.rpc('project_committed_spend', { p_project_id: projectId });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const own = rows.find((row) => row.is_project_currency);
  return {
    amount: Number(own?.amount ?? 0),
    otherCurrencies: rows.filter((row) => !row.is_project_currency)
      .map((row) => ({ currency: row.currency, amount: Number(row.amount) })),
  };
}

/**
 * Reserved-spend basis for ONE project (ADR-0034): Σ procurement total_value where status ∈
 * {Approved, Vendor Quoted, Quote Selected} — approved-but-not-yet-ordered demand ("encumbrance").
 * DISTINCT from Committed (which is Ordered..Paid) — RESERVED_STATUSES and COMMITTED_STATUSES are
 * disjoint. org_id is NEVER sent — RLS scopes by org. Returns 0 when the project has none.
 */
export const RESERVED_STATUSES: ProcurementRow['status'][] = [
  'Approved',
  'Vendor Quoted',
  'Quote Selected',
];

export interface ProjectReservedSpend {
  amount: number;
  projectCurrency: string | null;
  budgetCurrency: string | null;
  otherCurrencies: Array<{ currency: string | null; amount: number }>;
}

export async function getProjectReservedSpend(projectId: string): Promise<ProjectReservedSpend> {
  const { data, error } = await supabase.rpc('project_reserved_position', { p_project_id: projectId });
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('Project budget position unavailable');
  const { project_currency: projectCurrency, budget_currency: budgetCurrency, positions } = data[0];
  if (!Array.isArray(positions)) throw new Error('Project budget position unavailable');
  const amounts = positions.map((position) => {
    if (!position || typeof position !== 'object' || Array.isArray(position) ||
        !(typeof position.currency === 'string' || position.currency === null) ||
        !['string', 'number'].includes(typeof position.amount) || !Number.isFinite(Number(position.amount)) ||
        Math.abs(Number(position.amount)) >= 2 ** 46) {
      throw new Error('Project budget position unavailable');
    }
    return { currency: position.currency, amount: Number(position.amount) };
  });
  const own = projectCurrency ? amounts.find((row) => row.currency === projectCurrency) : undefined;
  return {
    amount: own?.amount ?? 0, projectCurrency, budgetCurrency,
    otherCurrencies: amounts.filter((row) => (!projectCurrency || row.currency !== projectCurrency) && row.amount !== 0),
  };
}

/**
 * List procurements for the caller's org. org_id is NEVER sent — RLS (org_id = auth_org_id())
 * scopes rows (FR-DAL-PROC-001). Reads every page by keyset (ordered by id) so the list is never cut at the row cap: the ⌘K CommandPalette record search indexes
 * the full cached list.
 */
export async function listProcurements(
  opts?: { withRefs?: boolean; withSharedDetails?: boolean },
): Promise<ProcurementWithRefs[]> {
  const selection = opts?.withSharedDetails ? SELECT_WITH_SHARED_DETAILS : opts?.withRefs ? SELECT_WITH_REFS : SELECT;
  const data = await fetchAllRowsByKeyset((afterId, limit) => {
    let query = supabase.from('procurements').select(selection).order('id', { ascending: true }).limit(limit);
    if (afterId !== null) query = query.gt('id', afterId);
    return query as unknown as PromiseLike<{ data: ProcurementWithRefs[] | null; error: { message: string; code?: string } | null }>;
  });
  return attachApprovalRoutes(data);
}

/**
 * List procurements for ONE project (project detail Overview + Procurement tabs). Filters
 * server-side with `.eq('project_id', …)` instead of loading the org's whole list and filtering in
 * the browser; same row shape as `listProcurements` (refs + approval routes). org_id is NEVER sent —
 * RLS scopes rows.
 */
export async function listProcurementsByProject(projectId: string): Promise<ProcurementWithRefs[]> {
  const data = await fetchAllRowsByKeyset((afterId, limit) => {
    let query = supabase.from('procurements').select(PROJECT_DETAIL_SELECT)
      .eq('project_id', projectId).order('id', { ascending: true }).limit(limit);
    if (afterId !== null) query = query.gt('id', afterId);
    return query as unknown as PromiseLike<{ data: ProcurementWithRefs[] | null; error: { message: string; code?: string } | null }>;
  });
  return attachApprovalRoutes(data);
}

/**
 * List procurements for a given vendor company (AC-IFW-COMPANY-01). Returns all PRs where
 * `vendor_id = vendorId` so the company record shows the full procurement history. org_id is
 * NEVER sent — RLS (procurements select: org_id = auth_org_id()) scopes rows. No new RLS.
 */
export async function listProcurementsByVendor(vendorId: string): Promise<ProcurementWithRefs[]> {
  const { data, error } = await supabase
    .from('procurements')
    .select(SELECT)
    .eq('vendor_id', vendorId);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ProcurementWithRefs[];
}
