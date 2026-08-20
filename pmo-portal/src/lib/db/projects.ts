import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';
import { ON_HAND_STATUSES, INTERNAL_STATUSES } from './projectTransitions';
import { resolveRange, type PageParams } from '@/src/lib/pagination';
import type { TaxTreatment } from './procurementLifecycle';

// #513: `TaxTreatment` is the ONE two-value domain shared by every table that carries the four tax
// columns (`procurement_invoices` 0196, `sales_invoices`/`work_orders` 0187/0188, and now `projects`
// 0197). Re-exported rather than re-declared — a second copy is a second thing to keep in step with
// the CHECK constraint.
export type { TaxTreatment };

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

// ⚑ The `profiles` embed MUST name its constraint. `projects` has had TWO foreign keys to
// `profiles` since 0177 added `contract_value_set_by` (the money-SoD witness) alongside
// `project_manager_id`, and PostgREST refuses an ambiguous embed rather than guessing — so the
// unqualified `pm:profiles(full_name)` this used to be turned EVERY projects query into an error.
// Not a slow page: "Couldn't load projects". 19 e2e specs went red across projects, tasks,
// timesheets, documents, kanban and the pipeline, because they all list projects somewhere.
//
// ADDING A FOREIGN KEY IS A BREAKING CHANGE TO EVERY UNQUALIFIED EMBED OF ITS TARGET. Nothing
// below e2e can catch it: unit tests mock the Supabase client so the embed string is never
// resolved against a real schema, and pgTAP tests SQL rather than PostgREST. `companies` is
// still safe to leave unqualified — `projects` has exactly one FK to it — and the guard in
// supabase/tests asserts that stays true.
const SELECT =
  '*, client:companies(name), pm:profiles!projects_project_manager_id_fkey(full_name)';

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
 * options and re-checked in `createProject` before any insert.
 *
 * WHERE THE RULE IS ENFORCED (migration 0173, docs/specs/project-create-sod.spec.md): in the
 * DATABASE — a BEFORE INSERT trigger on `public.projects` rejects a non-origination status, and
 * `authenticated` holds no INSERT privilege on `decided_at`/`customer_contract_ref`/
 * `contract_date`. That is the authority. Until 0173 this docstring claimed the TypeScript check
 * below was "defence in depth"; it was not — the DB had no guard at all, so a check running in the
 * browser in front of a public PostgREST endpoint was the ONLY defence, and one `curl` bypassed it
 * (a PM could create a project already won, at any contract value, with a forged decision date, and
 * no audit row). The check below is now what it always should have been: a UX fast-path that fails
 * before the round trip and with a better sentence than the backend's, never the enforcement layer.
 */
export const PROJECT_ORIGINATION_STATUSES: readonly ProjectStatus[] = [
  'Leads',
  'Internal Project',
];

/**
 * The tax facts a STATED contract value must carry (#513, migration 0197).
 *
 * Snake_case, unlike the camelCase `SetProjectContractValueInput` below, because these members are
 * inserted as COLUMNS by `createProject` (like its `client_id`/`contract_value` neighbours), where
 * the RPC input names PARAMETERS. Same four facts, two writers, each named after what it writes.
 */
export interface ProjectContractTaxColumns {
  /** Does `contract_value` already include `tax_amount`? Not inferable later — state it. */
  tax_treatment: TaxTreatment;
  /** Total tax on the contract value, in the project's currency. 0 = no tax; never "unknown". */
  tax_amount: number;
  /** Authored tax percentage (e.g. 11 for PPN 11%). null = not recorded — never 0%. */
  tax_rate?: number | null;
  /** ERPNext taxes-and-charges template name; absent for a standalone org. */
  tax_template?: string | null;
}

/** The create-form fields that have nothing to do with the contract value. */
interface CreateProjectBase {
  name: string;
  /** Must be an origination status (Leads / Internal Project). */
  status: ProjectStatus;
  client_id: string | null;
  project_manager_id: string | null;
  start_date: string | null;
  end_date: string | null;
}

/**
 * The fields a create-deal form supplies. org_id is NEVER among them — RLS stamps it.
 *
 * #513 — WHY THIS IS A UNION rather than four more required members. `createProject` INSERTs
 * straight into `projects`, so it meets 0197's constraint head-on:
 *
 *     check (contract_value = 0 or (tax_treatment is not null and tax_amount is not null))
 *
 * "You may not record a contract value without saying what it means." That is a CONDITIONAL rule,
 * and the type mirrors it exactly: the literal-`0` branch needs no basis (a lead, an internal
 * project, anything pre-win states nothing and is asked nothing), and every other branch requires
 * one. Four flat required members would have been the easy shape and the wrong one — it would force
 * a tax treatment onto a row with no value to describe, which is not a fact, it is ceremony, and it
 * is what the migration header explicitly refused for the DB.
 *
 * The safety property falls out of TypeScript's own rules and is the whole point: a `contract_value`
 * whose type is plain `number` (a parsed form field, a spreadsheet cell — anything not provably 0 at
 * compile time) does NOT match the `0` branch, so it MUST supply the basis or fail `tsc`. Only a
 * literal `0` is exempt. A caller can never send a non-zero value with no basis and have it compile,
 * which is the P0001/23514 that would otherwise land in front of a user mid-import.
 *
 * ⚑ The zero branch carries `Partial<ProjectContractTaxColumns>` rather than nothing, and that is
 * load-bearing in two ways, neither of them a loosening: stating a basis at 0 is legal (net and
 * gross are the same number there, so it cannot be wrong), and `keyof` a union is the INTERSECTION
 * of its members' keys — without the optional members the tax columns would vanish from
 * `keyof CreateProjectInput` and the import descriptor could not name them as fields.
 */
export type CreateProjectInput = CreateProjectBase &
  (
    | ({ contract_value: 0 } & Partial<ProjectContractTaxColumns>)
    | ({ contract_value: number } & ProjectContractTaxColumns)
  );

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
 * (an on-hand/won project is reached only via `transition_project`); the check below is a
 * UX fast-path that fails before the round trip with a better sentence than the backend's —
 * the ENFORCEMENT is migration 0173's BEFORE INSERT trigger + the narrowed column-level
 * INSERT grant, which also stop the same request made outside this function. See the
 * PROJECT_ORIGINATION_STATUSES docstring. Returns the new row. Throws an `AppError` (code
 * preserved, e.g. `42501` when a non-write-role is denied) on failure.
 */
export async function createProject(input: CreateProjectInput): Promise<ProjectRow> {
  if (!PROJECT_ORIGINATION_STATUSES.includes(input.status)) {
    throw new AppError(
      `Invalid origination status "${input.status}". A project can only be created as a Lead or an Internal Project; an on-hand project is reached by winning a deal.`,
      'P0001',
    );
  }
  // #513: the basis travels WITH the value or not at all. The `in` narrowing is what the union
  // (see CreateProjectInput) buys us — a non-zero value cannot reach here without one, so there is
  // no `?? 'exclusive'` to write and no P0001 to hit. 0197 grants INSERT on all four columns.
  const tax =
    input.tax_treatment !== undefined && input.tax_amount !== undefined
      ? {
          tax_treatment: input.tax_treatment,
          tax_amount: input.tax_amount,
          tax_rate: input.tax_rate ?? null,
          tax_template: input.tax_template ?? null,
        }
      : {};
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
      ...tax,
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
export interface SetProjectContractValueInput {
  id: string;
  value: number;
  /** Does `value` already include `taxAmount`? Not inferable later — the caller must state it. */
  taxTreatment: TaxTreatment;
  /** Total tax on the contract value. 0 means "no tax"; it never means "unknown". */
  taxAmount: number;
  /** Authored tax percentage (e.g. 11 for PPN 11%). null/undefined = not recorded — never 0%. */
  taxRate?: number | null;
  /** ERPNext taxes-and-charges template name; absent for a standalone org. */
  taxTemplate?: string | null;
}

/**
 * #513 (migration 0197). `taxTreatment` and `taxAmount` are REQUIRED members and the function takes
 * ONE object, exactly as #505 reshaped `createInvoice`: the RPC raises P0001 when either is missing,
 * so the type system MIRRORS THAT GATE and a caller that forgets one fails to compile instead of
 * failing in front of a user. Positional was no longer expressible anyway — TypeScript forbids a
 * required parameter after an optional one, and appending them as OPTIONAL trailing params would
 * have re-created exactly the omission this issue exists to make impossible.
 *
 * Unlike `createProject` there is no zero-value exemption here: 0197's RPC demands the basis on
 * EVERY set, including a set back to 0, because it is `contract_value`'s sole writer and a value
 * that moved while its treatment stayed behind would describe the OLD number.
 *
 * ⛔ Never give `taxTreatment` a default, a fallback, or a `?? 'exclusive'` on this path. A
 * silently-wrong marker is indistinguishable from a deliberate one, which is the defect itself.
 */
export async function setProjectContractValue(
  input: SetProjectContractValueInput,
): Promise<void> {
  const { error } = await supabase.rpc('set_project_contract_value', {
    p_id: input.id,
    p_value: input.value,
    // Sent unconditionally — required by the type, so there is no `?? undefined` to fall through
    // to the RPC's P0001 gate.
    p_tax_treatment: input.taxTreatment,
    p_tax_amount: input.taxAmount,
    p_tax_rate: input.taxRate ?? undefined,
    p_tax_template: input.taxTemplate ?? undefined,
  });
  if (error) throwWrite(error as PostgrestErrorLike);
}
