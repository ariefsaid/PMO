import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';

type ProjectStatus = Tables<'projects'>['status'];
type ProcurementStatus = Tables<'procurements'>['status'];

export interface StatusCount<S> {
  status: S;
  count: number;
}

export interface TopProject {
  id: string;
  name: string;
  client_name: string | null;
  contract_value: number;
  budget: number;
  spent: number;
  status: ProjectStatus;
}

/** Aggregates computed in SQL by get_executive_dashboard() (FR-API-003). snake_case mirrors the RPC. */
export interface ExecutiveDashboard {
  active_projects: number;
  total_contract_value: number;
  avg_gross_margin: number;
  projects_at_risk: number;
  projects_by_status: StatusCount<ProjectStatus>[];
  procurements_by_status: StatusCount<ProcurementStatus>[];
  top_projects: TopProject[];
}

/**
 * Executive dashboard aggregates for the caller's org. Calls the `get_executive_dashboard` RPC
 * (security invoker) — org_id is NEVER sent; base-table RLS scopes every read (FR-DAL-DASH-001,
 * NFR-DASH-SEC-001). On RPC error it throws.
 */
export async function getExecutiveDashboard(): Promise<ExecutiveDashboard> {
  // @ts-expect-error — database.types.ts does not yet have a generated Functions entry for
  // get_executive_dashboard (regenerate via `supabase gen types` once stack is stable, R3).
  // The local ExecutiveDashboard interface is the authoritative contract until then.
  const { data, error } = await supabase.rpc('get_executive_dashboard');
  if (error) throw new Error(error.message);
  return data as unknown as ExecutiveDashboard;
}
