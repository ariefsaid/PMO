import { Constants } from '@/src/lib/supabase/database.types';

/** #803 FR-APR-033: the request forms' optional budget-category select ('' = "No category"). */
export const BUDGET_CATEGORY_OPTIONS = [
  { value: '', label: 'No category' },
  ...Constants.public.Enums.budget_category.map((c) => ({ value: c, label: c })),
];

export const BUDGET_CATEGORY_HELPER =
  "Decides who approves: spend within the project's budget for this category goes to the project approver.";
