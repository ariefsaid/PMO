import { AppError } from '@/src/lib/appError';
import { supabase } from '@/src/lib/supabase/client';
import type { ExactMoney } from '@/src/lib/projectFinances';

export interface ProjectMoneyCategory {
  category: string;
  mapped: boolean;
  amount: string | null;
}

export interface ProjectMoneyActuals {
  currency: string;
  total: string | null;
  asOf: string | null;
  excludesRestrictedRows: boolean;
  complete?: boolean;
  /**
   * PMO basis only (0700, #1739): the project's open commitment — the unpaid remainder of its committed purchases,
   * the Budget tab's Committed figure. `null`/absent on an ERP-ledger read or a pre-0700 payload.
   */
  committedTotal?: string | null;
  /** Whether every committed purchase was readable in the project currency; false withholds the commitment. */
  committedComplete?: boolean;
  categories: ProjectMoneyCategory[];
}

export interface ProjectMoneyRead {
  ledgerBasis: 'erp' | 'pmo';
  actuals: ProjectMoneyActuals;
  activeBudgetAmount: string | null;
  activeBudgetCurrency: string | null;
  hasActiveBudget: boolean;
  /** Canonical S03 project budget position, joined by the repository for shared list consumers. */
  budgetPosition?: CanonicalBudgetReading;
}

/** Set-based project budget reading from project_budget_positions (0859). */
export interface CanonicalBudgetReading {
  projectId: string;
  ledgerBasis: 'erp' | 'pmo';
  currency: string | null;
  budgetCurrency: string | null;
  activeBudgetAmount: ExactMoney | null;
  spent: ExactMoney | null;
  openCommitment: ExactMoney | null;
  consumption: ExactMoney | null;
  complete: boolean;
  usedRatio: string | null;
  usedPercent: string | null;
  consumptionVariance: ExactMoney | null;
  riskEligible: boolean;
  atRisk: boolean | null;
}

/** Batched, canonical project Actual + Active-budget read for the visible collection. */
export async function getProjectsMoneyCollection(ids: string[]): Promise<Record<string, ProjectMoneyRead>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase.rpc('get_projects_money_collection', { p_project_ids: ids });
  if (error) throw new AppError(error.message, error.code);

  const result: Record<string, ProjectMoneyRead> = {};
  for (const row of (data ?? []) as Array<{
    project_id: string | null;
    ledger_basis: 'erp' | 'pmo';
    actuals: {
      currency?: string | null;
      total?: string | null;
      as_of?: string | null;
      excludes_restricted_rows?: boolean | null;
      complete?: boolean | null;
      committed_total?: string | null;
      committed_complete?: boolean | null;
      categories?: Array<{ category: string; mapped: boolean; amount: string | null }> | null;
    } | null;
    active_budget_amount: string | null;
    active_budget_currency: string | null;
    has_active_budget: boolean;
  }>) {
    if (!row.project_id || !row.actuals) continue;
    result[row.project_id] = {
      ledgerBasis: row.ledger_basis,
      actuals: {
        currency: row.actuals.currency ?? 'USD',
        total: row.actuals.total ?? null,
        asOf: row.actuals.as_of ?? null,
        excludesRestrictedRows: row.actuals.excludes_restricted_rows ?? false,
        complete: row.actuals.complete ?? false,
        committedTotal: row.actuals.committed_total ?? null,
        committedComplete: row.actuals.committed_complete ?? false,
        categories: (row.actuals.categories ?? []).map((category) => ({
          category: category.category,
          mapped: category.mapped,
          amount: category.amount ?? null,
        })),
      },
      activeBudgetAmount: row.active_budget_amount ?? null,
      activeBudgetCurrency: row.active_budget_currency ?? null,
      hasActiveBudget: row.has_active_budget,
    };
  }
  return result;
}

/** Batched canonical consumption/risk facts; decimal fields stay strings and category coverage stays separate. */
export async function getProjectBudgetPositions(ids: string[]): Promise<Record<string, CanonicalBudgetReading>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase.rpc('project_budget_positions', { p_project_ids: ids });
  if (error) throw new AppError(error.message, error.code);

  const result: Record<string, CanonicalBudgetReading> = {};
  for (const row of data ?? []) {
    if (!row.project_id || (row.ledger_basis !== 'erp' && row.ledger_basis !== 'pmo')) continue;
    result[row.project_id] = {
      projectId: row.project_id,
      ledgerBasis: row.ledger_basis,
      currency: row.currency ?? null,
      budgetCurrency: row.budget_currency ?? null,
      activeBudgetAmount: row.active_budget_amount ?? null,
      spent: row.spent ?? null,
      openCommitment: row.open_commitment ?? null,
      consumption: row.consumption ?? null,
      complete: row.complete === true,
      usedRatio: row.used_ratio ?? null,
      usedPercent: row.used_percent ?? null,
      consumptionVariance: row.consumption_variance ?? null,
      riskEligible: row.risk_eligible === true,
      atRisk: row.at_risk === true ? true : row.at_risk === false ? false : null,
    };
  }
  return result;
}
