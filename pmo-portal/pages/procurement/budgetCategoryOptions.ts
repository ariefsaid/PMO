import { useTranslation } from 'react-i18next';
import { Constants } from '@/src/lib/supabase/database.types';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';

/** #803 FR-APR-033: the request forms' optional budget-category select ('' = "No category"), in the reader's language. */
export function useBudgetCategoryOptions(): { value: string; label: string }[] {
  const { t } = useTranslation();
  return [
    { value: '', label: t('procurementCreate:noCategory', 'No category') },
    ...Constants.public.Enums.budget_category.map((c) => ({ value: c, label: budgetCategoryLabel(c, t) })),
  ];
}

export const BUDGET_CATEGORY_HELPER =
  "Decides who approves: spend within the project's budget for this category goes to the project approver.";
