/**
 * repositories/budgetProjection.ts (P3c slice 6, FR-BUD-151/153) — the read seam for PMO's forward
 * view (`get_budget_projection`, mig 0141) + the CRUD seam for the category↔account map
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
import { AppError, toAppError } from '@/src/lib/appError';
import { retryBudgetPush, type ActivateVersionResult } from '@/src/lib/db/budgets';
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
  pmoEtc: number;
  /** C-2 — `null` whenever `actualsToDate` is: nothing derived from an unknown is knowable. */
  projectedFinalCost: number | null;
  /** C-2 — `null` whenever `actualsToDate` is (never "the entire budget is still available"). */
  projectedVariance: number | null;
  /** `null` on a zero/absent budget, or on an unobtainable actual — never 0, never Infinity (AC-BUD-051). */
  projectedUtilization: number | null;
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
    pmoEtc: Number(row.pmo_etc ?? 0),
    projectedFinalCost: num(row.projected_final_cost),
    projectedVariance: num(row.projected_variance),
    projectedUtilization: num(row.projected_utilization),
  }));
}

/**
 * C-5 — reads the project's ERP push status (`get_budget_push_status`, mig 0141). Fiscal-year
 * INDEPENDENT on purpose: a failed push is a fact about the project's Active version, not about the
 * year the user happens to have selected, and hiding it behind that selection made the alarm's
 * visibility contingent on an unrelated navigation choice.
 *
 * Always resolves (never throws on "nothing to report") — an org with no ERP tier legitimately has no
 * status, and the RPC answers one all-NULL row for it.
 */
export async function fetchBudgetPushStatus(projectId: string): Promise<BudgetPushStatusRow> {
  const { data, error } = await supabase.rpc('get_budget_push_status', { p_project_id: projectId });
  if (error) throw toAppError(error);
  // A set-returning RPC yields an array (never `.single()` — a 0-row read would 406, the shipped lesson).
  const row = Array.isArray(data) ? data[0] : undefined;
  return {
    pushState: row?.push_state ?? null,
    pushError: row?.push_error ?? null,
    // NEW-6: an absent/empty array normalizes to `null` — "no category names on record" is one state,
    // and collapsing it here keeps every consumer from having to test both spellings of it.
    unmappedCategories: row?.unmapped_categories?.length ? row.unmapped_categories : null,
    erpBudgetName: row?.erp_budget_name ?? null,
    fiscalYear: row?.fiscal_year ?? null,
    pushedAt: row?.pushed_at ?? null,
  };
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
export async function retryActiveBudgetPush(projectId: string): Promise<ActivateVersionResult> {
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
  return retryBudgetPush(versionId);
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
  const { error } = await supabase.from('budget_category_account_map').delete().eq('category', category);
  if (error) throw toAppError(error);
}

/** Authors/updates the PMO estimate-to-complete for (project, fiscal_year, category) — OD-BUDGET-3
 *  role-gated (RLS `budget_projections_write`). NEVER pushed to ERP (FR-BUD-160). */
export async function upsertBudgetProjectionEtc(
  projectId: string,
  fiscalYear: string,
  category: BudgetCategory,
  pmoEtc: number,
): Promise<void> {
  const { error } = await supabase
    .from('budget_projections')
    .upsert(
      { project_id: projectId, fiscal_year: fiscalYear, category, pmo_etc: pmoEtc },
      { onConflict: 'org_id,project_id,fiscal_year,category' },
    );
  if (error) throw toAppError(error);
}
