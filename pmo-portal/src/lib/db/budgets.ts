import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';
import { toAppError } from '@/src/lib/appError';
import { activateAndPush } from '@/src/lib/budget/budgetPushConsequence';
import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';
import { budgetPushKey } from '@/src/lib/adapterSeam/erpnext/budgetPushKey';

// ---------------------------------------------------------------------------
// Type contract (plan §3 "Type contract used across tasks")
// ---------------------------------------------------------------------------

export type BudgetVersionRow = Tables<'budget_versions'>;
export type BudgetLineItemRow = Tables<'budget_line_items'>;

export type BudgetVersionWithItems = BudgetVersionRow & {
  /** All line-items belonging to this version. */
  line_items: BudgetLineItemRow[];
  /** Σ budgeted_amount of this version's line-items, normalised to JS number. */
  total: number;
};

export interface NewLineItem {
  category: BudgetLineItemRow['category'];
  description: string | null;
  budgeted_amount: number;
}

// ---------------------------------------------------------------------------
// Phase B — reads
// ---------------------------------------------------------------------------

/**
 * Returns the derived project budget: Σ budgeted_amount of all line-items on
 * the project's Active version (FR-BV-001). Zero when no Active version exists
 * (FR-BV-002). The stale `projects.budget` header is never read (FR-BV-003).
 * org_id is NEVER sent — RLS scopes via `auth_org_id()` (NFR-BV-PERF-001).
 */
export async function deriveProjectBudget(projectId: string): Promise<number> {
  const { data, error } = await supabase.rpc('get_project_budget', {
    p_project_id: projectId,
  });
  if (error) throw toAppError(error);
  return Number(data);
}

const VERSIONS_SELECT = '*, line_items:budget_line_items(*)';

type RawVersionWithItems = BudgetVersionRow & { line_items: BudgetLineItemRow[] };

/**
 * Returns all budget versions for a project, ordered ascending by version number,
 * with their line_items nested and a normalised numeric `total` (FR-BV-010 read side).
 * org_id is NEVER sent — RLS scopes via `auth_org_id()`.
 */
export async function listBudgetVersions(projectId: string): Promise<BudgetVersionWithItems[]> {
  const { data, error } = await supabase
    .from('budget_versions')
    .select(VERSIONS_SELECT)
    .eq('project_id', projectId)
    .order('version', { ascending: true });
  if (error) throw toAppError(error);
  const rows = (data ?? []) as unknown as RawVersionWithItems[];
  return rows.map((v) => ({
    ...v,
    line_items: v.line_items ?? [],
    total: (v.line_items ?? []).reduce((sum, li) => sum + Number(li.budgeted_amount), 0),
  }));
}

// ---------------------------------------------------------------------------
// Phase C — writes (line-item CRUD)
// ---------------------------------------------------------------------------

/**
 * Creates a new line-item on the given version. org_id is NEVER sent — the
 * column default + RLS `with check` stamps and verifies it (FR-BV-010).
 * The DB trigger `enforce_draft_line_item` rejects writes when the owning
 * version is not Draft (FR-BV-011 / AC-723).
 */
export async function createLineItem(
  versionId: string,
  item: NewLineItem,
): Promise<BudgetLineItemRow> {
  const { data, error } = await supabase
    .from('budget_line_items')
    .insert({
      budget_version_id: versionId,
      category: item.category,
      description: item.description,
      budgeted_amount: item.budgeted_amount,
    })
    .select()
    .single();
  if (error) throw toAppError(error);
  return data as unknown as BudgetLineItemRow;
}

/**
 * Updates an existing line-item. Throws (surfaces the DB trigger error) when
 * the owning version is not Draft (AC-723, FR-BV-006/009/011).
 * org_id is NEVER sent.
 */
export async function updateLineItem(
  id: string,
  patch: Partial<Pick<BudgetLineItemRow, 'category' | 'description' | 'budgeted_amount' | 'actual_amount'>>,
): Promise<void> {
  const { error } = await supabase
    .from('budget_line_items')
    .update(patch)
    .eq('id', id);
  if (error) throw toAppError(error);
}

/**
 * Deletes a line-item by id. Throws when the owning version is not Draft
 * (DB trigger; AC-723, FR-BV-011). org_id is NEVER sent.
 */
export async function deleteLineItem(id: string): Promise<void> {
  const { error } = await supabase
    .from('budget_line_items')
    .delete()
    .eq('id', id);
  if (error) throw toAppError(error);
}

// ---------------------------------------------------------------------------
// Phase C — writes (version lifecycle)
// ---------------------------------------------------------------------------

/**
 * Creates a new Draft budget version at max(version)+1 for the project.
 * org_id is NEVER sent (AC-724, FR-BV-004).
 */
export async function createBudgetVersion(
  projectId: string,
  name: string,
): Promise<BudgetVersionRow> {
  // Step 1: read current max version for this project
  const { data: maxData, error: maxError } = await supabase
    .from('budget_versions')
    .select('version')
    .eq('project_id', projectId)
    .order('version', { ascending: false })
    .limit(1);
  if (maxError) throw new Error(maxError.message);

  const rows = (maxData ?? []) as { version: number }[];
  const nextVersion = rows.length > 0 ? rows[0].version + 1 : 1;

  // Step 2: insert new Draft at next version
  const { data, error } = await supabase
    .from('budget_versions')
    .insert({
      project_id: projectId,
      version: nextVersion,
      name,
      status: 'Draft',
    })
    .select()
    .single();
  if (error) throw toAppError(error);
  return data as unknown as BudgetVersionRow;
}

/**
 * Clones any version into a new Draft (via security-definer RPC that resets
 * actual_amount to 0 on all copied line-items). Returns the new version's id.
 * org_id is NEVER sent — the RPC re-asserts org from auth context (AC-725, FR-BV-007).
 */
export async function cloneVersion(versionId: string): Promise<string> {
  const { data, error } = await supabase.rpc('clone_budget_version', {
    version_id: versionId,
  });
  if (error) throw toAppError(error);
  return data as string;
}

/**
 * Re-reads the version's own `activated_at` witness right after `activate_budget_version` commits — the
 * RPC itself returns void, and the ADR-0059 §4 deterministic key (`budgetPushKey`) MUST be derived from
 * the SAME server-stamped value the sweep backstop will later read, never a client-side `Date.now()`
 * (a locally-minted timestamp could disagree with the DB by the width of the round trip and mint two keys
 * for the SAME activation).
 */
async function readActivatedAt(versionId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('budget_versions')
    .select('activated_at')
    .eq('id', versionId)
    .maybeSingle();
  if (error) throw toAppError(error);
  return (data as { activated_at: string | null } | null)?.activated_at ?? null;
}

/**
 * Activates a Draft version via the `activate_budget_version` security-definer RPC (atomic archive-prior
 * + activate, UNTOUCHED — ADR-0059 §3.1), then pushes the consequence into the org's ERPNext binding, if
 * any (ADR-0055 §6 / ADR-0059 Posture B). org_id NEVER sent (FR-BV-005).
 *
 * ⚑ THE MONEY INVARIANT (ADR-0059 §3.2): the push is a CONSEQUENCE, never a precondition. Every failure
 * class the push can produce — no ERPNext binding configured, ERP unreachable, an unmapped category, a
 * multi-fiscal-year project — is swallowed by `activateAndPush` into durable side-mirror state (written
 * server-side by the `adapter-dispatch` budget gate into `budget_version_erp_mirror`) and is NEVER
 * re-thrown here: this function still only throws for a REAL activation failure (the RPC's own
 * authorization/state-machine rejection), exactly as it did before P3c.
 */
export async function activateVersion(versionId: string): Promise<void> {
  const result = await activateAndPush({
    versionId,
    rpc: async (_fn, args) => {
      const { error } = await supabase.rpc('activate_budget_version', args as { version_id: string });
      return { error };
    },
    dispatch: async (id) => {
      const activatedAt = await readActivatedAt(id);
      // `budgetPushKey` fails closed (throws `commit-rejected`) on a missing/unparseable stamp — caught
      // by `activateAndPush`'s try/catch like any other push failure, never surfaced as an activation one.
      return dispatchDomainCommand(
        'budget',
        'create',
        { id, erp_doc_kind: 'budget' },
        { idempotencyKey: budgetPushKey(id, activatedAt) },
      );
    },
  });
  if (!result.activated) throw toAppError(result.error);
}

/**
 * Archives the Active version via a plain update (FR-BV-008).
 * org_id NEVER sent — RLS gates the write.
 */
export async function archiveVersion(versionId: string): Promise<void> {
  const { error } = await supabase
    .from('budget_versions')
    .update({ status: 'Archived' })
    .eq('id', versionId);
  if (error) throw toAppError(error);
}

/**
 * Hard-deletes a Draft version (cascade FK removes its line-items).
 * org_id NEVER sent — RLS gates the write + DB trigger blocks non-Draft (OD-BUDGET-C).
 */
export async function deleteDraftVersion(versionId: string): Promise<void> {
  const { error } = await supabase
    .from('budget_versions')
    .delete()
    .eq('id', versionId);
  if (error) throw toAppError(error);
}
