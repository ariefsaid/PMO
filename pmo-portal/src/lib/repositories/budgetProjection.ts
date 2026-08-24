/**
 * repositories/budgetProjection.ts (P3c slice 6, FR-BUD-151/153) — the read seam for PMO's forward
 * view (`get_budget_projection`, mig 0149) + the CRUD seam for the category↔account map
 * (`budget_category_account_map`) + the ETC upsert (`budget_projections`).
 *
 * ⚑ "Projection" here = PMO's own forward-looking derived view — never ADR-0055 §6's "projected into
 * the ERP object" (that means PUSHED). Nothing this seam reads or writes is ever sent to ERP
 * (FR-BUD-160); it only reads `get_budget_projection` and writes the two PMO-owned tables.
 *
 * A standalone repository module (not wired into the shared `repositories` aggregator/`Repositories`
 * type in `./index.ts` — that file is shared across concurrent P3c slices; this module is imported
 * directly by its consumers, the same seam-over-the-DAL shape as `revenueDisplay.ts`).
 */
import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded, toAppError } from '@/src/lib/appError';
import { fetchAllRowsByKeyset, type PageResult } from '@/src/lib/pagedRead';
import { retryBudgetPush, type ActivateVersionResult } from '@/src/lib/db/budgets';
import { encodeFiscalYear } from '@/src/lib/adapterSeam/erpnext/fiscalYearEncoding';
import type { Database } from '@/src/lib/supabase/database.types';

export type BudgetCategory = Database['public']['Enums']['budget_category'];

/** One category's forward-view cell, camelCase (the RPC's snake_case columns, mapped). */
export interface BudgetProjectionCellRow {
  category: BudgetCategory;
  /** `null` when the Active version budgets no line for this category (FR-BUD-151) — never coerced to 0. */
  pmoBudgetAmount: number | null;
  /**
   * ⚑ C-1 — `null` means the figure is **UNOBTAINABLE**: the category has no ERP account mapped, so
   * there is no account to ask the ledger about. A mapped category with an empty ledger is `0`, a real
   * computed zero. Merging the two put a confident `$0` under a banner that had just said the category
   * was unmapped.
   */
  actualsToDate: number | null;
  /**
   * ⚑ NEW-4 — WHEN the ERP ledger was last read for this (project, fiscal year), ISO-8601. `null` =
   * PMO holds no reading for that project-year at all, which is exactly WHY `actualsToDate` is null on
   * every category of such a year — a different absence from "this category has no ERP account
   * mapped", and the surface says which. Non-null it is provenance: an undated `$0` is not a figure an
   * operator can weigh.
   */
  actualsAsOf: string | null;
  pmoEtc: number;
  /** C-2 — `null` whenever `actualsToDate` is: nothing derived from an unknown is knowable. */
  projectedFinalCost: number | null;
  /** C-2 — `null` whenever `actualsToDate` is (never "the entire budget is still available"). */
  projectedVariance: number | null;
  /** `null` on a zero/absent budget, or on an unobtainable actual — never 0, never Infinity (AC-BUD-051). */
  projectedUtilization: number | null;
  /**
   * ⚑ F-D (FR-BFY-054/055) — can PMO place this category's WHOLE budget in the selected year?
   *
   * `false` means at least one of its lines is un-placeable, so the category's total is unknown and the
   * RPC withholds the amount and everything derived from it (0153 §3a). That is a different absence
   * from "this category has no line", and the surface must not borrow that sentence for it. Fails OPEN
   * to `true` on an older RPC shape: claiming a suppression PMO cannot see would be its own false alarm.
   */
  attributionKnown: boolean;
}

/**
 * C-5 — the project's ERP push status, read at PROJECT grain (`get_budget_push_status`, mig 0141).
 *
 * It used to ride on every projection cell and be read off `rows[0]`. That made a project-wide alarm
 * hostage to the money grid having rows (C-3 makes the empty grid reachable), scoped it to whichever
 * fiscal year the user happened to be looking at, and left no room for the ERP document the push
 * actually created.
 */
export interface BudgetPushStatusRow {
  /** One of `pending`/`pushing`/`pushed`/`failed`/`held`, or the derived `never-pushed`/
   *  `unstamped-activation`. `null` = nothing to report (no Active version, or no ERP tier). */
  pushState: string | null;
  /** The machine token as persisted. NEVER render it — pass it through `describePushError`. */
  pushError: string | null;
  /**
   * NEW-6 — the PMO categories that have no `budget_category_account_map` row, i.e. exactly what an
   * operator must fix. `null` when the failure had nothing to do with the map (never `[]`: an empty
   * list would read as "the map is fine" and force every consumer to special-case it).
   */
  unmappedCategories: string[] | null;
  /** C-5 — the ERP `Budget` document a successful push created. Stored since 0137, never shown until now. */
  erpBudgetName: string | null;
  /** The fiscal year this status is ABOUT, so the banner can name it instead of hiding on other years. */
  fiscalYear: string | null;
  pushedAt: string | null;
  /**
   * ⚑ MEDIUM-1 (audit round 7) — is there a genuinely `held` outbox command to release?
   *
   * `pushState === 'held'` alone does NOT mean there is: the sweep also parks a mirror row it may not
   * re-drive (`budget-push-attempts-exhausted` / `budget-push-no-outbox-candidate`), and in that case
   * the outbox row is `failed`/`pending`/absent. Offering "Release the hold" there produced a button
   * whose only possible outcome was "There is no held ERP command to release for this project." — on
   * the screen reporting that ERPNext is enforcing the wrong budget or none. The RPC derives this from
   * `external_command_outbox.state = 'held'`, under the caller's own RLS.
   */
  holdReleasable: boolean;
  /**
   * ⚑ FR-BFY-056 — WHY this year's budget column went blank. `true` means a push SUCCEEDED for this
   * year, the Active version still has un-phased lines, and the project's dates have since moved off
   * the span that push recorded — so those lines now attribute to NO year (0153 §3a). The fix is a PMO
   * act ("phase these lines"), not a retry, which is exactly why it is reported beside the push state
   * rather than as a push failure. Fails CLOSED (`false`) on an older RPC shape: claiming staleness
   * PMO cannot see would be its own false alarm.
   */
  staleAttribution: boolean;
}

/** One fiscal year that actually exists for a project, in the CLIENT'S own calendar (H-4). */
export interface BudgetFiscalYearRow {
  /** The ERPNext `Fiscal Year` NAME as stored — '2026' for a calendar client, '2025-2026' for a Jul–Jun
   *  one. PMO never parses, orders-by-parsing, or synthesizes this: it is the client's own label. */
  fiscalYear: string;
  /** True for the year the project's ACTIVE budget version was pushed against — the sensible default. */
  isActivePush: boolean;
}

/** One `budget_category_account_map` row, camelCase. */
export interface CategoryAccountMapRow {
  category: BudgetCategory;
  erpAccount: string;
}

/** Reads PMO's forward view for a project + fiscal year (SECURITY INVOKER RPC — RLS scopes the org).
 *  Never throws on an empty result (no versions/actuals/ETC yet is a legitimate empty state, not an
 *  error) — only on an actual RPC failure (e.g. cross-org / RLS 42501). */
export async function fetchBudgetProjection(
  projectId: string,
  fiscalYear: string | null,
): Promise<BudgetProjectionCellRow[]> {
  const { data, error } = await supabase.rpc('get_budget_projection', {
    p_project_id: projectId,
    // H-4: `null` means "this project has no fiscal year on record". The empty string is the sentinel
    // for that: it matches no ERP `Fiscal Year` name, so the FY-scoped figures (actuals, ETC, the push
    // row) stay honestly empty — while the FY-INDEPENDENT parts still render, which is what keeps the
    // never-pushed / unstamped-activation alarm reachable on a project that has never synced a year.
    p_fiscal_year: fiscalYear ?? '',
  });
  if (error) throw toAppError(error);
  // ⚑ C-1/C-2: NULL is LOAD-BEARING on every money column here — it is the difference between "zero"
  // and "not knowable". `?? 0` on any of them re-introduces the exact defect the RPC change removed.
  const num = (v: number | string | null | undefined): number | null =>
    v === null || v === undefined ? null : Number(v);
  return (data ?? []).map((row) => ({
    category: row.category,
    pmoBudgetAmount: num(row.pmo_budget_amount),
    actualsToDate: num(row.actuals_to_date),
    actualsAsOf: row.actuals_as_of ?? null,
    pmoEtc: Number(row.pmo_etc ?? 0),
    projectedFinalCost: num(row.projected_final_cost),
    projectedVariance: num(row.projected_variance),
    projectedUtilization: num(row.projected_utilization),
    attributionKnown: row.attribution_known !== false,
  }));
}

/**
 * C-5 + ⚑ FR-BFY-056 (finding 6) — reads the project's ERP push status, ONE ROW PER EXPECTED FISCAL
 * YEAR. Fiscal-year INDEPENDENT on purpose: a failed push is a fact about the project's Active
 * version, not about the year the user happens to have selected, and hiding it behind that selection
 * made the alarm's visibility contingent on an unrelated navigation choice.
 *
 * ⚑ IT RETURNS AN ARRAY, and that is the contract. It used to take `data[0]`, which on a fan-out
 * (FY2026 pushed, FY2027 failed) commonly selected the PUSHED row — the RPC orders by `pushed_at`, and
 * only the pushed row has one — so the operator saw "Enforced by ERPNext" while ERPNext enforced NO
 * overspend control for the other year. An aggregate may be derived by a consumer; the per-year list
 * is what this seam promises.
 *
 * Always resolves (never throws on "nothing to report") — an org with no ERP tier legitimately has no
 * status, and the RPC answers one all-NULL row for it.
 */
export async function fetchBudgetPushStatus(projectId: string): Promise<BudgetPushStatusRow[]> {
  const { data, error } = await supabase.rpc('get_budget_push_status', { p_project_id: projectId });
  if (error) throw toAppError(error);
  // A set-returning RPC yields an array (never `.single()` — a 0-row read would 406, the shipped lesson).
  return (Array.isArray(data) ? data : []).map((row) => ({
    pushState: row?.push_state ?? null,
    pushError: row?.push_error ?? null,
    // NEW-6: an absent/empty array normalizes to `null` — "no category names on record" is one state,
    // and collapsing it here keeps every consumer from having to test both spellings of it.
    unmappedCategories: row?.unmapped_categories?.length ? row.unmapped_categories : null,
    erpBudgetName: row?.erp_budget_name ?? null,
    fiscalYear: row?.fiscal_year ?? null,
    pushedAt: row?.pushed_at ?? null,
    // Fails CLOSED: an older RPC shape (or a null) withholds the affordance rather than offering a
    // button that can only error.
    holdReleasable: row?.hold_releasable === true,
    staleAttribution: row?.stale_attribution === true,
  }));
}

/** Which fiscal years each category is phased to on the project's ACTIVE version (F-C). */
export type BudgetCategoryFiscalYears = Partial<Record<BudgetCategory, string[]>>;

/**
 * How the ACTIVE version's lines are PHASED, per category — both halves of it.
 *
 * `years` is what PMO can place; `unphased` marks the categories holding at least one line phased to no
 * year at all. The second is not decoration: without it, `years` alone reads as "this category is
 * budgeted in 2027" for a category whose $50,000 sibling belongs to no year PMO can name.
 */
export interface ActiveBudgetCategoryPhasing {
  years: BudgetCategoryFiscalYears;
  /** `true` iff the category has ≥1 line with no fiscal year — sparse, so absence means "none". */
  unphased: Partial<Record<BudgetCategory, true>>;
}

/**
 * ⚑ THE DIRECTOR'S RULING (spec §6.2) — the surface must distinguish two facts that both reach it as a
 * NULL budget.
 *
 * `attribution_known = false` is doing two jobs. One is "we CANNOT attribute this" (the category's only
 * lines are un-phased and their attribution was suppressed — a refused push, or a project whose dates
 * drifted off the span the push recorded). The other is "this category is budgeted in a DIFFERENT
 * fiscal year" — spend landing in FY1 against work budgeted in FY2, an ordinary timing difference. The
 * SQL is right to fail closed for both (a `-EAC` there would be a false overspend alarm on real money),
 * but the second fact is FULLY KNOWN, and rendering a knowable fact as "unavailable" is its own
 * dishonesty. This read is how the screen knows it: PMO's OWN phased line items, nothing inferred.
 *
 * ⚑ SHOULD-FIX 1 (FU-2 round 3) — AND THE UN-PHASED ROWS ARE COUNTED, NOT DROPPED. PMO still refuses to
 * give them a year (a NULL year is not a year — inventing one is exactly what ADR-0048 forbids), but
 * THAT THEY EXIST is itself a fact, and the one the reason-string ladder cannot decide without: "all of
 * this category is budgeted in 2027, so FY2026 spend is a timing difference and not an overspend" is
 * only true when EVERY line is placed. Dropping these rows made that claim unfalsifiable on screen.
 *
 * ⚑ FINDING 2 (FU-2 round 4) — AND IT IS PAGED, for the same reason. Unpaged, this read is silently
 * capped at PostgREST's `db-max-rows` (HTTP 200, a short body, `error === null`), and the truncation lands on
 * the fail-open guard's own PRECONDITION: a missing `unphased` fact reads as "every line is placed", so
 * a version whose un-phased line sorts past the cap resurrects the exact "not an overspend" claim the
 * SHOULD-FIX above removed. KEYSET (`readBudgetLineItems`'s loop, the shared `pagedRead` seam) rather
 * than offset — a duplicated or skipped line here is a wrong claim about money.
 */
export async function fetchActiveBudgetCategoryPhasing(projectId: string): Promise<ActiveBudgetCategoryPhasing> {
  type PhasingRow = { id: string; category: BudgetCategory; fiscal_year: string | null };
  const data = await fetchAllRowsByKeyset<PhasingRow>((afterId, limit) => {
    const q = supabase
      .from('budget_line_items')
      // `id` is SELECTED because it is the cursor; the `!inner` join scopes to the Active version
      // without a second round trip; RLS scopes the org.
      .select('id, category, fiscal_year, budget_versions!inner(project_id, status)')
      .eq('budget_versions.project_id', projectId)
      .eq('budget_versions.status', 'Active')
      .order('id', { ascending: true });
    return (afterId === null ? q : q.gt('id', afterId)).limit(limit) as PromiseLike<PageResult<PhasingRow>>;
  });
  const phasing: ActiveBudgetCategoryPhasing = { years: {}, unphased: {} };
  for (const row of data) {
    if (!row.fiscal_year) {
      phasing.unphased[row.category] = true;
      continue;
    }
    const years = (phasing.years[row.category] ??= []);
    if (!years.includes(row.fiscal_year)) years.push(row.fiscal_year);
  }
  return phasing;
}

/**
 * H-4 — the fiscal years a user may ask for, read from the data that exists (`list_budget_fiscal_years`,
 * mig 0141).
 *
 * PMO does not own the client's fiscal calendar and must never invent it: `fiscal_year` everywhere in
 * this slice is the ERPNext `Fiscal Year` NAME the client declared ('2025-2026' for a Jul–Jun client),
 * and every read joins it by EQUALITY. A synthesized calendar year therefore joins nothing and shows a
 * zeroed money screen. Ordered newest-first by the RPC; an empty list is a legitimate "no fiscal year
 * on record" state, never a reason to guess one.
 */
export async function listBudgetFiscalYears(projectId: string): Promise<BudgetFiscalYearRow[]> {
  const { data, error } = await supabase.rpc('list_budget_fiscal_years', { p_project_id: projectId });
  if (error) throw toAppError(error);
  return (data ?? []).map((row) => ({ fiscalYear: row.fiscal_year, isActivePush: row.is_active_push }));
}

/**
 * HIGH-D — re-drive the ERPNext push for this project's ACTIVE budget version.
 *
 * The operator-invokable half of the recovery story: a `failed` push whose gate rejected before the
 * outbox (an unmapped category) leaves the sweep backstop nothing to reconcile, and the backstop then
 * parks it as `held`, which its own candidate query excludes — so once the Admin maps the category,
 * ONLY a re-dispatch under a real, authenticated actor can land it (re-activating is impossible: the
 * version is no longer Draft). Resolves the Active version from DB truth rather than trusting anything
 * on screen, then delegates to the ONE push in `db/budgets.ts` (same command, same deterministic key).
 */
export async function retryActiveBudgetPush(projectId: string, fiscalYear: string | null): Promise<ActivateVersionResult> {
  return retryBudgetPush(await activeBudgetVersionId(projectId), fiscalYear);
}

/** The project's ACTIVE budget version, from DB truth — never from anything on screen. Throws rather
 *  than inventing one when the project has none. */
async function activeBudgetVersionId(projectId: string): Promise<string> {
  const { data, error } = await supabase
    .from('budget_versions')
    .select('id')
    .eq('project_id', projectId)
    .eq('status', 'Active')
    .maybeSingle();
  if (error) throw toAppError(error);
  const versionId = (data as { id: string } | null)?.id;
  if (!versionId) {
    // Nothing to push: no Active version at all. Never invent one — say so.
    throw new AppError('This project has no Active budget version to push.', 'not-found');
  }
  return versionId;
}

/**
 * ⚑ MED-2 (money-safety audit round 6) — THE OPERATOR'S ROUTE OUT OF A HELD BUDGET PUSH.
 *
 * `release_outbox_hold` (mig 0137 §4) shipped correct and with ZERO callers, so the wedge its own
 * header states in the present tense stayed literally true: a `held` row sits inside
 * `external_command_outbox_one_inflight_per_record`, so every subsequent key for the same record 409s
 * forever, and the only in-app exit was none — the operator's route out was `psql`.
 *
 * It touches no external system and fabricates no outcome: the RPC moves `held` → `failed`, which is
 * outside the one-in-flight index and inside `outbox_reconcile_candidates`, so the ORDINARY bounded
 * recovery resumes and re-runs every gate (re-authorization, the recovery probe, the claim budget).
 * The operator asserts "the CONDITION that caused the hold is resolved", never "the command succeeded"
 * — releasing a still-broken condition simply holds again.
 *
 * Admin-only, enforced by the RPC itself (org + Admin + `is_active_member`, re-asserted after the row
 * lock, under SECURITY DEFINER). `can('manage','pushHold')` is the UX half only (ADR-0016).
 */
export async function releaseActiveBudgetPushHold(projectId: string, fiscalYear: string | null): Promise<void> {
  const versionId = await activeBudgetVersionId(projectId);
  const { data, error } = await supabase
    .from('external_command_outbox')
    .select('id')
    // ⚑ FU-2 MEDIUM 6 — scope to the budget domain. Without it a colliding held row from ANOTHER domain
    // (a random PMO-id collision) could be selected and released by the budget banner. The RPC below
    // re-verifies the domain server-side (`p_expected_domain`), but the read must be scoped too so it
    // never even surfaces a non-budget row as "the held command for this project".
    .eq('domain', 'budget')
    // ⚑ FR-BFY-032 — the held command is keyed on the YEAR-QUALIFIED identity. Two identities are
    // accepted, exactly as `get_budget_push_status.hold_releasable` derives the affordance: the
    // year-qualified one this release introduces, and the LEGACY bare `<vid>`, which by construction
    // was written by the pre-fan-out single-FY dispatcher and therefore names this one year. Releasing
    // "whatever is held for this project" would clear a DIFFERENT year's money command.
    // A year-less status row (nothing on record for any year) can only ever be the legacy bare key.
    .in('pmo_record_id', fiscalYear ? [`${versionId}:${encodeFiscalYear(fiscalYear)}`, versionId] : [versionId])
    .eq('state', 'held')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw toAppError(error);
  const outboxId = (data as { id: string } | null)?.id;
  if (!outboxId) {
    // Never release "whatever is there": if the hold is gone (an operator released it in another tab,
    // or the backstop already moved it on), say so rather than acting on a different command.
    throw new AppError('There is no held ERP command to release for this project.', 'not-found');
  }
  const { error: rpcError } = await supabase.rpc('release_outbox_hold', {
    p_outbox_id: outboxId,
    p_reason: 'Released from the budget push banner',
    // ⚑ FU-2 MEDIUM 6 — the server re-verifies the locked row is a budget command before releasing.
    p_expected_domain: 'budget',
  });
  if (rpcError) throw toAppError(rpcError);
}

/** Lists the caller org's category→account map, ordered by category (RLS scopes the org). */
export async function listBudgetCategoryAccountMap(): Promise<CategoryAccountMapRow[]> {
  const { data, error } = await supabase
    .from('budget_category_account_map')
    .select('category, erp_account')
    .order('category');
  if (error) throw toAppError(error);
  return (data ?? []).map((r) => ({ category: r.category, erpAccount: r.erp_account }));
}

/** Maps a previously-unmapped category to an account (Admin-only — RLS `budget_category_account_map_
 *  write`, FR-BUD-112). A conflicting account (the map's BIJECTION, FR-BUD-111) surfaces as 23505,
 *  preserved on the thrown `AppError` so the caller can name the conflict. */
export async function createBudgetCategoryAccountMapRow(
  category: BudgetCategory,
  erpAccount: string,
): Promise<CategoryAccountMapRow> {
  const { data, error } = await supabase
    .from('budget_category_account_map')
    .insert({ category, erp_account: erpAccount })
    .select('category, erp_account')
    .single();
  if (error) throw toAppError(error);
  return { category: data.category, erpAccount: data.erp_account };
}

/** Repoints an already-mapped category to a different account. Same bijection/Admin-only constraints
 *  as create. */
export async function updateBudgetCategoryAccountMapRow(
  category: BudgetCategory,
  erpAccount: string,
): Promise<CategoryAccountMapRow> {
  const { data, error } = await supabase
    .from('budget_category_account_map')
    .update({ erp_account: erpAccount })
    .eq('category', category)
    .select('category, erp_account')
    .single();
  if (error) throw toAppError(error);
  return { category: data.category, erpAccount: data.erp_account };
}

/** Unmaps a category (Admin-only). A category with no map row FAILS CLOSED at the next push
 *  (FR-BUD-113) rather than silently defaulting — deleting the map row is a deliberate Admin act. */
export async function deleteBudgetCategoryAccountMapRow(category: BudgetCategory): Promise<void> {
  const { data, error } = await supabase
    .from('budget_category_account_map')
    .delete()
    .eq('category', category)
    .select('category');
  if (error) throw toAppError(error);
  // #541: a `using`-denied DELETE (non-Admin, wrong org) removes 0 rows and reports no error. Here
  // that inverts the fail-closed contract above: the Admin believes the category is unmapped and
  // will fail closed at the next push, while the stale mapping is still live and pushing.
  assertWriteLanded(data, 'Category mapping not found or you do not have permission to remove it.');
}

/** Authors/updates the PMO estimate-to-complete for (project, fiscal_year, category) — OD-BUDGET-3
 *  role-gated (RLS `budget_projections_write`). NEVER pushed to ERP (FR-BUD-160). */
export async function upsertBudgetProjectionEtc(
  projectId: string,
  fiscalYear: string,
  category: BudgetCategory,
  pmoEtc: number,
): Promise<void> {
  const { data, error } = await supabase
    .from('budget_projections')
    .upsert(
      { project_id: projectId, fiscal_year: fiscalYear, category, pmo_etc: pmoEtc },
      { onConflict: 'org_id,project_id,fiscal_year,category' },
    )
    .select('project_id');
  if (error) throw toAppError(error);
  // #541: one row in, so the count oracle collapses to "did anything come back?". A `using`-denied
  // upsert writes nothing and reports no error — the estimate-to-complete on screen would be a
  // number the author typed and nobody stored.
  assertWriteLanded(data, 'Estimate could not be saved — you do not have permission to change it.');
}
