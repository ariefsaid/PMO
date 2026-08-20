import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';
import { AppError, toAppError } from '@/src/lib/appError';
import { activateAndPush } from '@/src/lib/budget/budgetPushConsequence';
import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';
import type { PmoRecord } from '@/src/lib/adapterSeam/contract';

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

/** What activating (or retrying the push for) a version did to the ERPNext side (HIGH-C). The PMO
 *  transition itself either succeeded or threw — this only ever describes the push CONSEQUENCE. */
export interface ActivateVersionResult {
  /**
   * ⚑ `'nothing-to-push'` (FU-2 round 2) is a THIRD outcome, not a flavour of the other two. A version
   * with no line items produces an EMPTY push plan: the served fan-out attempts no year, creates no ERP
   * `Budget` and writes no mirror row, then answers `200 { years: [] }`. Reading that as `'pushed'`
   * announced a push that never happened (the per-year banner underneath simultaneously said
   * `never-pushed`); reading it as `'failed'` would invent an attempt that was never made. Nothing was
   * sent because there was nothing to send, and the surface says exactly that.
   */
  pushState: 'pushed' | 'failed' | 'nothing-to-push';
}

export interface NewLineItem {
  category: BudgetLineItemRow['category'];
  description: string | null;
  budgeted_amount: number;
  /**
   * ⚑ BFY FR-BFY-060 — the ERPNext `Fiscal Year` NAME this line is phased to; `null`/omitted = un-phased.
   *
   * Optional and NULL-by-default on purpose: every existing line stays un-phased, and PMO never invents
   * a year for a line the operator deliberately left alone (ADR-0048). The value is the client's own
   * label ('2026', '2025-2026', …) and is validated at PUSH time against their live `Fiscal Year`
   * doctype — never here, because the write path cannot reach another system's calendar (FR-BFY-022).
   */
  fiscal_year?: string | null;
}

/**
 * Import provenance stamps (0195). Supplied ONLY by the bulk-import path; every other caller omits
 * the argument and the three columns stay NULL, which is what keeps them out of the partial unique
 * indexes and leaves every existing write path byte-identical.
 *
 * ⚑ `importKey` is optional on purpose (DD-BIMP-5): a VERSION carries the batch stamps but no key,
 * because a version's identity is "this project's open Draft", not a row in a sheet — key it and the
 * second legitimate import for a project, after the first was activated, is blocked forever by a row
 * that is no longer Draft. The line items carry the key.
 */
export interface ImportProvenance {
  importBatchId: string;
  importedAt: string;
  importKey?: string | null;
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
  provenance?: ImportProvenance,
): Promise<BudgetLineItemRow> {
  const { data, error } = await supabase
    .from('budget_line_items')
    .insert({
      budget_version_id: versionId,
      category: item.category,
      description: item.description,
      budgeted_amount: item.budgeted_amount,
      // FR-BFY-060: omitted ⇒ the column's own NULL default (un-phased), never a synthesized year.
      fiscal_year: item.fiscal_year ?? null,
      // ⚑ `actual_amount` is DELIBERATELY absent and must stay absent (FR-BIMP-005): actuals are
      // READ from the ERP read-model, and a value written here would be a figure PMO computed
      // rather than read (ADR-0048/0055) — wrong in a way that still renders.
      ...(provenance
        ? {
            import_batch_id: provenance.importBatchId,
            imported_at: provenance.importedAt,
            import_key: provenance.importKey ?? null,
          }
        : {}),
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
  // FR-BFY-060/061: `fiscal_year` is an ordinary line-item column here. Re-phasing an Active version
  // is rejected by `enforce_draft_line_item` (0005) — the DB is the authority, this is the seam.
  patch: Partial<Pick<BudgetLineItemRow, 'category' | 'description' | 'budgeted_amount' | 'actual_amount' | 'fiscal_year'>>,
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
  provenance?: ImportProvenance,
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
      // ⚑ `currency` is DELIBERATELY absent (FR-BIMP-006 / DD-BIMP-2): 0187's `stamp_currency`
      // BEFORE-INSERT trigger resolves it from `organizations.default_currency`. A client
      // hand-carrying a currency is the thing that seam exists to prevent, exactly as with org_id.
      ...(provenance
        ? {
            import_batch_id: provenance.importBatchId,
            imported_at: provenance.importedAt,
            import_key: provenance.importKey ?? null,
          }
        : {}),
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
export async function activateVersion(versionId: string): Promise<ActivateVersionResult> {
  // ⚑ FU-2 round 2: the dispatch's own RESPONSE is kept, because "the promise resolved" and "a push
  // happened" are not the same fact — an empty fan-out resolves 200 having sent nothing.
  // `activateAndPush` owns only the money invariant (a push failure never fails the activation), so the
  // outcome is refined here rather than teaching that module the budget response shape.
  let dispatchResult: unknown = null;
  const result = await activateAndPush({
    versionId,
    rpc: async (_fn, args) => {
      const { error } = await supabase.rpc('activate_budget_version', args as { version_id: string });
      return { error };
    },
    dispatch: async (id) => {
      dispatchResult = await pushActivatedBudget(id);
      return dispatchResult;
    },
  });
  if (!result.activated) throw toAppError(result.error);
  // The whole fan-out is the unit here (activation names no year), and only a RESOLVED dispatch can be
  // refined — a rejected one already carries its own `'failed'`.
  if (result.pushState === 'pushed') return { pushState: pushStateForYear(dispatchResult, null) };
  // ⚑ HIGH-C (Luna re-audit round 2): the push outcome is RETURNED, not discarded. Every writer of
  // `budget_version_erp_mirror` lives INSIDE `adapter-dispatch`, so a dispatch that never REACHES the
  // function (a dropped connection, the tab closed mid-request, a 502 from the platform) leaves no
  // mirror row at all — and the sweep backstop's work queue IS that mirror, so nothing ever re-drives
  // it. Discarding this made the UI show a plain success while ERPNext kept enforcing the previous
  // budget (or none) forever, with nobody notified. The durable half of the same fix is
  // `get_budget_projection`'s `'never-pushed'` state (migration 0149) + the retry below.
  return { pushState: result.pushState ?? 'failed' };
}

/**
 * HIGH-D — the operator-invokable retry for a budget push that never landed.
 *
 * The stranding it removes is certain, not hypothetical: a line in a category the Admin has not mapped
 * yet makes `runBudgetGate` reject BEFORE the outbox, so `push_state='failed'` exists with NO outbox
 * row; the sweep backstop then finds no candidate and flips it to `'held'`, which its own candidate
 * query excludes. Fixing the category map afterwards did nothing at all — and re-activating is
 * impossible (`activate_budget_version` refuses a non-Draft version). Re-dispatching under the
 * operator's OWN JWT is what makes it recoverable: it re-runs the full gate with a real, authenticated
 * actor (which is exactly what the backstop cannot synthesize — FR-BUD-102's "never finalize with a
 * NULL actor"), and derives the SAME deterministic key from `activated_at`, so a push that DID reach
 * the outbox reconciles instead of duplicating.
 *
 * NEVER re-activates: the version is already Active and its activation stamp is the key's own input.
 */
export async function retryBudgetPush(
  versionId: string,
  fiscalYear: string | null,
): Promise<ActivateVersionResult> {
  // ⚑ BFY FR-BFY-056 — a retry is a PER-YEAR act whenever there IS a year: the operator is looking at
  // one year's failed status row, and "the push failed" beside a year that actually pushed is the
  // misattribution finding 6 is about. `null` is a real, different state, not a missing argument — the
  // status RPC reports exactly one YEAR-LESS row when the Active version has no phased line and no
  // mirror row at all (nothing is on record for any year). That row's retry is the whole fan-out, and
  // withholding it there would leave the never-pushed project — the one most likely to have ERPNext
  // enforcing nothing — with no route out.
  // ⚑ H-3 (Luna audit round 3), PRESERVED across the BFY key move: the activation stamp is re-read
  // BEFORE the dispatch so an UNSTAMPED version (Active but pre-0139) refuses client-side, before any
  // request. Nothing durable is written for such a refusal — no mirror row, no notification — so
  // reporting `pushState:'failed'` would claim an attempt that never happened and hide the only
  // sentence that explains the state. The stamp is no longer used to MINT a key (the server derives
  // one per year, FR-BFY-031); it is still the fact that decides whether a push is possible at all.
  requireActivationStamp(await readActivatedAt(versionId));
  try {
    // ⚑ HIGH 5 (FR-BFY-056): the year is a real dispatch TARGET, not merely a display filter. When the
    // operator retries one year's failed row, the server dispatches ONLY that plan year — never the
    // whole fan-out (which could re-drive another year that is still recoverable or has a changed
    // blocker). A `null` year is the year-less whole-fan-out retry (the never-pushed project).
    const result = await dispatchBudgetPush(versionId, fiscalYear);
    return { pushState: pushStateForYear(result, fiscalYear) };
  } catch {
    // Same money invariant as activation: a retry whose DISPATCH fails again is reported, never thrown
    // — that durable state (mirror row + notification) is written server-side by the dispatch itself.
    //
    // ⚑ On a fan-out the served boundary answers with the FIRST failing year's status, so a rejected
    // response does not prove THIS year failed (another year's rejection could have produced it). The
    // report is therefore deliberately CONSERVATIVE — never "pushed" on a rejection — and the screen's
    // per-year truth comes from `get_budget_push_status`, which the caller re-reads on settle. A
    // pessimistic toast beside an authoritative per-year banner is safe; an optimistic one is not.
    return { pushState: 'failed' };
  }
}

/** The per-year outcomes the served fan-out reports (FR-BFY-033). Absent for a pre-BFY response. */
interface BudgetFanOutResult {
  years?: Array<{ fiscal_year: string; pushed: boolean }>;
}

/**
 * Did THIS fiscal year land? The served boundary attempts every phased year and reports each one, so a
 * partially-successful fan-out must be read per year — never collapsed into one project-wide verdict.
 * A response that names no years at all (a single-year push, or an older server) is taken at face
 * value: it resolved, so the year the operator asked about is the year that pushed.
 */
function pushStateForYear(result: unknown, fiscalYear: string | null): ActivateVersionResult['pushState'] {
  const years = (result as BudgetFanOutResult | null | undefined)?.years;
  // A pre-BFY server names no years at all — taken at face value, as before.
  if (!Array.isArray(years)) return 'pushed';
  // ⚑ FU-2 round 2: an EMPTY array is a DIFFERENT statement from an absent key. This server enumerated
  // the years it attempted and there were none (an Active version with no line items ⇒ an empty push
  // plan), so no ERP `Budget` was created and no mirror row was written. "Pushed" was a lie about money.
  if (years.length === 0) return 'nothing-to-push';
  // No year named ⇒ the operator retried a project with nothing on record for any year, so the honest
  // verdict is the WHOLE fan-out: anything less than every year landing is not "pushed".
  if (fiscalYear === null) return years.every((y) => y.pushed) ? 'pushed' : 'failed';
  const row = years.find((y) => y.fiscal_year === fiscalYear);
  return row?.pushed ? 'pushed' : 'failed';
}

/**
 * The ONE budget-push dispatch (activation consequence AND retry).
 *
 * ⚑ BFY FR-BFY-031/032 (contract change, OQ-BFY-3): the client sends the BARE `budget_version_id` and
 * NO idempotency key. Only the server can enumerate the phased fiscal years — they are validated
 * against the client's live ERPNext `Fiscal Year` doctype, a read only the server-side gate makes — so
 * only the server can derive the per-year identity `<vid>:<encoded-fy>` and key
 * `bud:<vid>:<encoded-fy>:<epoch>`. A client-minted key would key every year on one string and
 * silently suppress all but the first.
 */
function dispatchBudgetPush(versionId: string, targetFiscalYear?: string | null): Promise<unknown> {
  // ⚑ HIGH 5 (FR-BFY-056): a per-year retry names the ONE fiscal year to dispatch; the server validates
  // it against the phased plan and drives only that entry. Activation passes no year → the whole fan-out.
  const record: PmoRecord = { id: versionId, erp_doc_kind: 'budget' };
  if (targetFiscalYear) record.target_fiscal_year = targetFiscalYear;
  return dispatchDomainCommand('budget', 'create', record);
}

/** Fails closed on a version with no activation stamp — the deterministic per-year key's own input.
 *  Inventing one would key a money command on a fiction and could mint a SECOND ERP `Budget`. */
function requireActivationStamp(activatedAt: string | null): string {
  if (!activatedAt) {
    throw new AppError('budget push: the version carries no activation stamp', 'commit-rejected');
  }
  return activatedAt;
}

/** The activation-consequence push. An unstamped version is a push FAILURE, never an activation
 *  failure — `activateAndPush` swallows it into the returned push state (ADR-0059 §3.2). */
async function pushActivatedBudget(versionId: string): Promise<unknown> {
  requireActivationStamp(await readActivatedAt(versionId));
  return dispatchBudgetPush(versionId);
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
 * org_id NEVER sent — RLS gates the write.
 *
 * ⚑ This docstring used to claim "DB trigger blocks non-Draft (OD-BUDGET-C)". **That trigger did not
 * exist.** Until migration 0177 any of the four write-roles could delete the *Active* version, and
 * because `budget_line_items_budget_version_id_fkey` is `ON DELETE CASCADE` every line item went with
 * it — straight past `budget_line_items_draft_guard`, which refuses to touch a line item whose owning
 * version is not Draft. Verified live as a plain Project Manager, with zero `audit_events` rows.
 * `0177_delete_path_sod_and_project_money_sod.sql` §A1 creates the trigger the comment described:
 * a non-Draft version is now **Admin-only** to delete (ADR-0019's destructive-delete shape, which also
 * keeps an Admin's project hard-delete cascading correctly), and every delete writes a
 * `budget_version.delete` audit row. A non-Admin attempt raises 42501 naming the cascade, so the
 * `classifyMutationError` toast surfaces it — it is not a silent no-op.
 */
export async function deleteDraftVersion(versionId: string): Promise<void> {
  const { error } = await supabase
    .from('budget_versions')
    .delete()
    .eq('id', versionId);
  if (error) throw toAppError(error);
}
