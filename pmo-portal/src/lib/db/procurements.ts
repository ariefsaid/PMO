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
 */
const COMMITTED_STATUSES: ProcurementRow['status'][] = [
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
 * List procurements for the caller's org. org_id is NEVER sent — RLS (org_id = auth_org_id())
 * scopes rows (FR-DAL-PROC-001). The page filters the cached list client-side this issue.
 */
export async function listProcurements(): Promise<ProcurementWithRefs[]> {
  const { data, error } = await supabase.from('procurements').select(SELECT);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ProcurementWithRefs[];
}
