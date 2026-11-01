import { Constants } from '@/src/lib/supabase/database.types';
import type { ErpSetupReadiness } from '@/src/lib/repositories/types';

export const COMPANY_DEFAULTS = [
  'company',
  'default_payable_account',
  'default_expense_account',
  'default_cash_account',
  'default_bank_account',
  'cost_center',
] as const;

/** #1326: categories an org need map only once it budgets in them (they were split out of Special expenses). */
export const OPTIONAL_BUDGET_CATEGORIES: readonly string[] = ['Travel & accommodation', 'Vehicle'];

/** The budget categories this org must map before its budget setup is complete. */
export function requiredBudgetCategories(setup: ErpSetupReadiness): string[] {
  const used = setup.budgetUsedOptionalCategories ?? [];
  return Constants.public.Enums.budget_category.filter(
    (category) => !OPTIONAL_BUDGET_CATEGORIES.includes(category) || used.includes(category),
  );
}

/** FR-ECA-020: PMO never creates accounts, so a required category with no linked account is the accountant's task. */
export function missingAccountCategories(setup: ErpSetupReadiness): string[] {
  return requiredBudgetCategories(setup).filter((category) => !setup.budgetMappedCategories.includes(category));
}

export function getErpSetupIncompleteness(setup: ErpSetupReadiness) {
  return {
    domains: setup.domains.length === 0,
    company: COMPANY_DEFAULTS.some((key) => !setup.defaults[key]),
    activity: !setup.defaults.default_activity_type || !setup.defaults.default_receivable_account,
    budget: requiredBudgetCategories(setup).some((category) => !setup.budgetMappedCategories.includes(category)),
    employees: setup.unlinkedEmployeeCount > 0,
    projects: setup.unmappedProjects.length > 0,
  };
}
