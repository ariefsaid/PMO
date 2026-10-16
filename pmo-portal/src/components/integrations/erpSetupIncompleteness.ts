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

export function getErpSetupIncompleteness(setup: ErpSetupReadiness) {
  return {
    domains: setup.domains.length === 0,
    company: COMPANY_DEFAULTS.some((key) => !setup.defaults[key]),
    activity: !setup.defaults.default_activity_type || !setup.defaults.default_receivable_account,
    budget: setup.budgetMappedCategories.length < Constants.public.Enums.budget_category.length,
    employees: setup.unlinkedEmployeeCount > 0,
    projects: setup.unmappedProjects.length > 0,
  };
}
