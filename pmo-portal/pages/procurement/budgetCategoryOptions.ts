import { Constants } from '@/src/lib/supabase/database.types';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';

/** #803 FR-APR-033: the request forms' optional budget-category select ('' = "No category"). */
export function budgetCategoryOptions(t: (key: string, fallback: string) => string) {
  return [
    { value: '', label: t('expenses.form.category.none', 'No category') },
    ...Constants.public.Enums.budget_category.map((c) => ({ value: c, label: budgetCategoryLabel(c, t) })),
  ];
}

export const BUDGET_CATEGORY_HELPER =
  "Decides who approves: spend within the project's budget for this category goes to the project approver.";
