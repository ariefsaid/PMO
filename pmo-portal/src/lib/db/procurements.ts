import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';
import { resolveRange, type PageParams } from '@/src/lib/pagination';
import { attachApprovalRoutes } from './approvalRoutes';
import type { ApprovalRoute } from '@/src/lib/procurement/approvalRoute';

export type ProcurementRow = Tables<'procurements'>;

/** A procurement row with project/vendor/requester names resolved in SQL (kills render-time .find()). */
export type ProcurementWithRefs = ProcurementRow & {
  project: { name: string; code: string | null } | null;
  vendor: { name: string } | null;
  requested_by: { full_name: string } | null;
  /** #803: present only on a Requested row whose route was read (see attachApprovalRoutes). */
  approvalRoute?: ApprovalRoute;
  /** #769: the parent group's numbers on this case's PR / PO / vendor-invoice records (search + export). */
  pr_refs?: { external_ref: string | null }[];
  po_refs?: { external_ref: string | null }[];
  vi_refs?: { external_ref: string | null }[];
};

/** Every non-empty external reference on a case's PR / PO / vendor-invoice records, in that order. */
export function externalRefsOf(p: ProcurementWithRefs): string[] {
  return [...(p.pr_refs ?? []), ...(p.po_refs ?? []), ...(p.vi_refs ?? [])]
    .map((r) => r.external_ref)
    .filter((v): v is string => !!v);
}

const SELECT =
  '*, project:projects(name,code), vendor:companies(name), requested_by:profiles!procurements_requested_by_id_fkey(full_name)';

/** #769: the Procurement index's OWN select — adds the three record-reference embeds (search + export).
 *  Approvals, dashboards and every other `listProcurements` caller keep the lean `SELECT`. */
const SELECT_WITH_REFS =
  `${SELECT}, pr_refs:purchase_requests(external_ref), po_refs:purchase_orders(external_ref), vi_refs:procurement_invoices(external_ref)`;

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

export async function getProjectCommittedSpend(projectId: string): Promise<number> {
  const { data, error } = await supabase
    .from('procurements')
    .select('total_value')
    .eq('project_id', projectId)
    .in('status', COMMITTED_STATUSES);
  if (error) throw new Error(error.message);
  return (data ?? []).reduce(
    (sum, row) => sum + Number((row as { total_value: number }).total_value ?? 0),
    0,
  );
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

export async function getProjectReservedSpend(projectId: string): Promise<number> {
  const { data, error } = await supabase
    .from('procurements')
    .select('total_value')
    .eq('project_id', projectId)
    .in('status', RESERVED_STATUSES);
  if (error) throw new Error(error.message);
  return (data ?? []).reduce(
    (sum, row) => sum + Number((row as { total_value: number }).total_value ?? 0),
    0,
  );
}

/**
 * List procurements for the caller's org. org_id is NEVER sent — RLS (org_id = auth_org_id())
 * scopes rows (FR-DAL-PROC-001). Paginated (data-layer performance hardening #4, OPT-IN):
 * passing `params.page`/`params.pageSize` range-bounds the query; omitting `params` entirely
 * preserves the original unbounded read for every existing caller (e.g. the ⌘K CommandPalette
 * record search, which indexes the full cached list).
 */
export async function listProcurements(
  params?: PageParams,
  opts?: { withRefs?: boolean },
): Promise<ProcurementWithRefs[]> {
  const range = resolveRange(params);
  let q = supabase.from('procurements').select(opts?.withRefs ? SELECT_WITH_REFS : SELECT);
  if (range) q = q.range(range.from, range.to);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return attachApprovalRoutes((data ?? []) as unknown as ProcurementWithRefs[]);
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
