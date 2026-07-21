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
  actualsToDate: number;
  pmoEtc: number;
  projectedFinalCost: number;
  projectedVariance: number;
  /** `null` on a zero/absent budget — never 0, never Infinity (AC-BUD-051). */
  projectedUtilization: number | null;
  /** The category's Active-version push state, when a push exists for this project+FY (else `null`). */
  pushState: string | null;
  pushError: string | null;
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
  fiscalYear: string,
): Promise<BudgetProjectionCellRow[]> {
  const { data, error } = await supabase.rpc('get_budget_projection', {
    p_project_id: projectId,
    p_fiscal_year: fiscalYear,
  });
  if (error) throw toAppError(error);
  return (data ?? []).map((row) => ({
    category: row.category,
    pmoBudgetAmount: row.pmo_budget_amount === null || row.pmo_budget_amount === undefined ? null : Number(row.pmo_budget_amount),
    actualsToDate: Number(row.actuals_to_date ?? 0),
    pmoEtc: Number(row.pmo_etc ?? 0),
    projectedFinalCost: Number(row.projected_final_cost ?? 0),
    projectedVariance: Number(row.projected_variance ?? 0),
    projectedUtilization:
      row.projected_utilization === null || row.projected_utilization === undefined
        ? null
        : Number(row.projected_utilization),
    pushState: row.push_state ?? null,
    pushError: row.push_error ?? null,
  }));
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
