import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';
import { useAuth } from '@/src/auth/useAuth';

/**
 * The full opportunity row for the detail page (Director decision 2). Selects
 * directly from `projects` — snake_case, consumed as the DB shape (no
 * `as unknown as` camelCase bridge). org_id is NEVER sent: RLS
 * (org_id = auth_org_id()) scopes the read. Surfaces `code`, the PM join,
 * `customer_contract_ref`, `contract_date`, `decided_at` that the pipeline RPC
 * does not project.
 */
export type OpportunityRow = Pick<
  Tables<'projects'>,
  | 'id'
  | 'name'
  | 'code'
  | 'status'
  | 'client_id'
  | 'project_manager_id'
  | 'contract_value'
  | 'customer_contract_ref'
  | 'contract_date'
  | 'decided_at'
> & {
  client: { name: string } | null;
  pm: { full_name: string } | null;
};

const SELECT =
  'id, name, code, status, client_id, project_manager_id, contract_value, ' +
  'customer_contract_ref, contract_date, decided_at, ' +
  // ⚑ Constraint-qualified: `projects` has TWO FKs to `profiles` since 0177 added
  // `contract_value_set_by` next to `project_manager_id`, and PostgREST rejects an ambiguous
  // embed. This is the PRE-WIN fallback path, so leaving it unqualified broke the canonical
  // detail route for every pipeline record while the active-list query looked fine.
  'client:companies(name), pm:profiles!projects_project_manager_id_fkey(full_name)';

/** Fetch one opportunity by id, or null when absent / not visible to the caller. */
export async function getOpportunity(id: string): Promise<OpportunityRow | null> {
  const { data, error } = await supabase
    .from('projects')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as OpportunityRow) ?? null;
}

/** Org-scoped opportunity detail query. queryKey includes org_id for cache isolation. */
export function useOpportunity(id: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<OpportunityRow | null>({
    queryKey: ['opportunity', orgId, id],
    queryFn: () => getOpportunity(id!),
    enabled: Boolean(orgId && id),
  });
}
