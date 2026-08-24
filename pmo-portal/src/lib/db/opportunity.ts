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
/**
 * ⚑ THE COLUMN LIST IS THE CONTRACT, so it is data rather than a string literal — `AC-SP-210`
 * asserts it covers every field `pages/project-detail/**` reads off the record.
 *
 * **Why that gate exists.** The active-projects query is `select('*')`; this one is an explicit
 * list. Any column the detail page formats that is named there and not here reaches the PRE-WIN
 * lens as `undefined` while the on-hand lens looks perfect. That has now shipped twice on this one
 * path — the unqualified `profiles` embed (see below), and `currency`, whose absence made
 * `formatCurrency(contract, project.currency)` throw inside `ProjectDetailHeader` and took the
 * whole page down behind the error boundary. Neither was visible to the compiler (this function
 * casts) or to a mocked unit test (the mock returns whatever the test hands it).
 *
 * `budget` / `spent` are deliberately absent: a pre-win record has neither, and `ProjectDetail`
 * defaults them to 0.
 */
export const OPPORTUNITY_COLUMNS = [
  'id',
  'name',
  'code',
  'status',
  'client_id',
  'project_manager_id',
  'contract_value',
  // The money-shape columns. `currency` is required by every formatCurrency call on the header;
  // the tax trio travels with it so the contract figure keeps its basis (OD-TAX-1 — a money value
  // whose inclusive/exclusive status is unknown cannot be disambiguated later).
  'currency',
  'tax_treatment',
  'tax_amount',
  'tax_rate',
  'customer_contract_ref',
  'contract_date',
  'decided_at',
  'start_date',
  'end_date',
] as const;

export type OpportunityRow = Pick<
  Tables<'projects'>,
  (typeof OPPORTUNITY_COLUMNS)[number]
> & {
  client: { name: string } | null;
  pm: { full_name: string } | null;
};

const SELECT =
  OPPORTUNITY_COLUMNS.join(', ') +
  ', ' +
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
