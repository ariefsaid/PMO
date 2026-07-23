import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';
import { AppError, toAppError } from '@/src/lib/appError';
import { activateAndPush } from '@/src/lib/budget/budgetPushConsequence';
import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';

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
  pushState: 'pushed' | 'failed';
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
      // FR-BFY-060: omitted ⇒ the column's own NULL default (un-phased), never a synthesized year.
      fiscal_year: item.fiscal_year ?? null,
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
export async function activateVersion(versionId: string): Promise<ActivateVersionResult> {
  const result = await activateAndPush({
    versionId,
    rpc: async (_fn, args) => {
      const { error } = await supabase.rpc('activate_budget_version', args as { version_id: string });
      return { error };
    },
    dispatch: (id) => pushActivatedBudget(id),
  });
  if (!result.activated) throw toAppError(result.error);
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
    const result = await dispatchBudgetPush(versionId);
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
function pushStateForYear(result: unknown, fiscalYear: string | null): 'pushed' | 'failed' {
  const years = (result as BudgetFanOutResult | null | undefined)?.years;
  if (!Array.isArray(years) || years.length === 0) return 'pushed';
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
function dispatchBudgetPush(versionId: string): Promise<unknown> {
  return dispatchDomainCommand('budget', 'create', { id: versionId, erp_doc_kind: 'budget' });
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
 * org_id NEVER sent — RLS gates the write + DB trigger blocks non-Draft (OD-BUDGET-C).
 */
export async function deleteDraftVersion(versionId: string): Promise<void> {
  const { error } = await supabase
    .from('budget_versions')
    .delete()
    .eq('id', versionId);
  if (error) throw toAppError(error);
}
