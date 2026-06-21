import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';

export type ProcurementRow = Tables<'procurements'>;

/** A procurement row with project/vendor/requester names resolved in SQL (kills render-time .find()). */
export type ProcurementWithRefs = ProcurementRow & {
  project: { name: string; code: string | null } | null;
  vendor: { name: string } | null;
  requested_by: { full_name: string } | null;
};

const SELECT =
  '*, project:projects(name,code), vendor:companies(name), requested_by:profiles!procurements_requested_by_id_fkey(full_name)';

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
 * scopes rows (FR-DAL-PROC-001). The page filters the cached list client-side this issue.
 */
export async function listProcurements(): Promise<ProcurementWithRefs[]> {
  const { data, error } = await supabase.from('procurements').select(SELECT);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ProcurementWithRefs[];
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
