import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';
import { ON_HAND_STATUSES, INTERNAL_STATUSES } from './projectTransitions';
import { resolveRange, type PageParams } from '@/src/lib/pagination';

/**
 * The active Projects (delivery) list partition (Model B, ADR-0020): on-hand ∪ internal.
 * A pre-win pipeline/lost record is NOT here — it lives in the Sales Pipeline — so the two
 * lists are disjoint stage partitions of the one `projects` table. `listProjects()` defaults
 * to this scope; a caller wanting a specific status (e.g. a future "Lost" filter) passes
 * `params.status` to override.
 */
export const ACTIVE_PROJECT_STATUSES: readonly ProjectStatus[] = [
  ...ON_HAND_STATUSES,
  ...INTERNAL_STATUSES,
] as ProjectStatus[];

export type ProjectRow = Tables<'projects'>;
export type ProjectStatus = ProjectRow['status'];

/** A project row with client + PM names resolved in SQL (kills render-time .find(), F-7). */
export type ProjectWithRefs = ProjectRow & {
  client: { name: string } | null;
  pm: { full_name: string } | null;
};

const SELECT = '*, client:companies(name), pm:profiles(full_name)';

/** Shape of a PostgREST/Postgres error we surface (only the fields we read). */
interface PostgrestErrorLike {
  message: string;
  code?: string;
}

/** Re-throws an `AppError` preserving the Postgres error `code` for `classifyMutationError`. */
function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

/**
 * The only two statuses a project/opportunity may be CREATED in (Director decision,
 * crud-components §9.1): a sales `Leads` opportunity or an `Internal Project`. An
 * on-hand/won project is reached ONLY via the `transition_project` win path — never
 * created directly — so the state-machine seam stays intact. Used by the create form
 * options and guarded again here (defence in depth) before any insert.
 */
export const PROJECT_ORIGINATION_STATUSES: readonly ProjectStatus[] = [
  'Leads',
  'Internal Project',
];

/** The fields a create-deal form supplies. org_id is NEVER among them — RLS stamps it. */
export interface CreateProjectInput {
  name: string;
  /** Must be an origination status (Leads / Internal Project). */
  status: ProjectStatus;
  client_id: string | null;
  project_manager_id: string | null;
  contract_value: number;
  start_date: string | null;
  end_date: string | null;
}

/** The editable header fields (name/code/client/PM/dates). NOT contract_value (SoD) / status (RPC). */
export interface ProjectHeaderInput {
  name: string;
  code: string | null;
  client_id: string | null;
  project_manager_id: string | null;
  start_date: string | null;
  end_date: string | null;
}

/**
 * List projects for the caller's org. org_id is NEVER sent — RLS (org_id = auth_org_id())
 * scopes rows (FR-DAL-004).
 *
 * Model B (ADR-0020): by default the list is the ACTIVE Projects partition (on-hand ∪
 * internal) — a single `.in('status', [...])` filter — so a pre-win pipeline/lost deal is
 * NOT in the active Projects list (it lives in the Sales Pipeline). A caller wanting a
 * specific status (e.g. a future "Lost" filter) passes `params.status` to override the
 * default partition with a precise `.eq('status', …)`.
 *
 * Paginated (data-layer performance hardening #4, OPT-IN): passing `params.page`/
 * `params.pageSize` range-bounds the query; omitting both preserves the original unbounded
 * read for every existing caller (e.g. the ⌘K CommandPalette record search).
 */
export async function listProjects(
  params?: { status?: ProjectRow['status']; pmId?: string } & PageParams,
): Promise<ProjectWithRefs[]> {
  // `any` is a localized escape hatch: PostgREST's TypeScript builder types
  // make it difficult to accumulate `.eq()`/`.in()` chains conditionally without
  // widening the type here. The pattern is intentional and contained — do not
  // propagate `any` beyond this function.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase.from('projects').select(SELECT);
  if (params?.status) {
    // Explicit override → a precise single-status filter (e.g. the Lost partition).
    q = q.eq('status', params.status);
  } else {
    // Default → the active Projects partition (on-hand ∪ internal), disjoint from the pipeline.
    q = q.in('status', ACTIVE_PROJECT_STATUSES as string[]);
  }
  if (params?.pmId) q = q.eq('project_manager_id', params.pmId);
  const range = resolveRange(params);
  if (range) q = q.range(range.from, range.to);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ProjectWithRefs[];
}

/**
 * Create a new opportunity (AC-PRJ-003). org_id is NEVER sent — the column default +
 * the `projects_write` WITH CHECK (org_id = auth_org_id() AND role in the 4 write-roles)
 * are the authority. The origination status is constrained to Leads / Internal Project
 * (an on-hand/won project is reached only via `transition_project`); a non-origination
 * status is rejected here BEFORE any insert (defence in depth — the state machine, not a
 * direct create, owns the win). Returns the new row. Throws an `AppError` (code preserved,
 * e.g. `42501` when a non-write-role is denied) on failure.
 */
export async function createProject(input: CreateProjectInput): Promise<ProjectRow> {
  if (!PROJECT_ORIGINATION_STATUSES.includes(input.status)) {
    throw new AppError(
      `Invalid origination status "${input.status}". A project can only be created as a Lead or an Internal Project; an on-hand project is reached by winning a deal.`,
      'P0001',
    );
  }
  const { data, error } = await supabase
    .from('projects')
    .insert({
      name: input.name,
      status: input.status,
      client_id: input.client_id,
      project_manager_id: input.project_manager_id,
      contract_value: input.contract_value,
      start_date: input.start_date,
      end_date: input.end_date,
    })
    .select()
    .single();
  if (error) throwWrite(error);
  return data as ProjectRow;
}

/**
 * List projects for a given client company (AC-IFW-COMPANY-01). Returns all projects where
 * `client_id = clientId`, across all statuses (pipeline + delivery), so the company record
 * shows the full work history. org_id is NEVER sent — RLS (projects_select: org_id =
 * auth_org_id()) scopes rows. No new RLS or migration — the existing select policy covers this.
 */
export async function listProjectsByClient(clientId: string): Promise<ProjectWithRefs[]> {
  const { data, error } = await supabase
    .from('projects')
    .select(SELECT)
    .eq('client_id', clientId);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ProjectWithRefs[];
}

/**
 * Update a project's HEADER fields (name/code/client/PM/dates) by id (AC-PRJ-004). org_id
 * is NEVER sent — `projects_write` scopes the update to the caller's org and gates the role.
 * Deliberately excludes `contract_value` (SoD-gated → `setProjectContractValue` RPC) and the
 * RPC-only `status`/`decided_at`/`customer_contract_ref`/`contract_date` columns (0008 grant).
 * Throws an `AppError` (code preserved) on failure.
 */
export async function updateProjectHeader(id: string, input: ProjectHeaderInput): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({
      name: input.name,
      code: input.code,
      client_id: input.client_id,
      project_manager_id: input.project_manager_id,
      start_date: input.start_date,
      end_date: input.end_date,
    })
    .eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Soft-archive a project by stamping `archived_at` (AC-PRJ-005) so it drops out of the
 * default list (ADR-0018). org_id is NEVER sent — `projects_write` scopes the update; the
 * `archived_at` column UPDATE grant comes from 0012. Throws an `AppError` (code preserved).
 */
export async function archiveProject(id: string): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Hard-delete a project by id (AC-PRJ-007). org_id is NEVER sent — RLS scopes the row.
 * Throws an `AppError` (code preserved) so the caller can classify the toast.
 *
 * GATING NOTE (FE stricter than RLS — flagged, not a bug): the FE gate
 * `can('delete','project')` is Admin-only (rbac-visibility §K). The current server
 * `projects_write` policy (0002) is `FOR ALL` to the 4 write-roles, so it does NOT yet
 * restrict DELETE to Admin the way `companies_admin_delete` (0013) / `project_documents`
 * (0017) do. The FE hide is therefore the only Admin-only narrowing today — a deliberate
 * UI stricture, never the security boundary. The matching `projects_admin_delete`
 * restrictive policy + pgTAP are a SERVER gap to close (see report). A project that has
 * procurement requests or logged timesheet entries (FK RESTRICT) fails with 23503, which
 * the destructive confirm surfaces as a classified toast; budget/task/document children
 * cascade-delete (0001 `on delete cascade`). Archive (soft) stays the recommended path;
 * this hard delete is the irreversible escape hatch.
 */
export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Set a project's `contract_value` through the SoD-scoped security-definer RPC (AC-PRJ-006,
 * ADR-0019). `contract_value` is removed from the direct-UPDATE column grant in 0014, so this
 * RPC is the SOLE writer of that column. The RPC re-asserts org + role + status: a PM may set
 * it while the project is pre-win; on a WON/on-hand project only Executive/Finance/Admin may
 * (segregation of duties). org_id is NEVER sent — the RPC re-derives org from auth context.
 * A rejection surfaces as an `AppError` preserving the Postgres code (`42501` SoD/role,
 * `P0001` illegal state, `P0002` not found) for `classifyMutationError`.
 */
export async function setProjectContractValue(id: string, value: number): Promise<void> {
  const { error } = await supabase.rpc('set_project_contract_value', {
    p_id: id,
    p_value: value,
  });
  if (error) throwWrite(error as PostgrestErrorLike);
}
