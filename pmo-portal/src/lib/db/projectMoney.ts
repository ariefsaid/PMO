import { AppError } from '@/src/lib/appError';
import { supabase } from '@/src/lib/supabase/client';

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
  categories: ProjectMoneyCategory[];
}

export interface ProjectMoneyRead {
  ledgerBasis: 'erp' | 'pmo';
  actuals: ProjectMoneyActuals;
  activeBudgetAmount: string | null;
  activeBudgetCurrency: string | null;
  hasActiveBudget: boolean;
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
