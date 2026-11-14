import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { Constants } from '@/src/lib/supabase/database.types';
import { EXPENSES_EMPLOYABLE } from '@/src/lib/adapterSeam/erpnext/expenseEnablement';
import { externalDomainOwnershipKey } from '@/src/hooks/approvalsQueryKeys';
import { repositories } from '@/src/lib/repositories';
import { listBudgetCategoryAccountMap } from '@/src/lib/repositories/budgetProjection';
import type { CategoryAccountMapRow } from '@/src/lib/repositories/budgetProjection';

const BUDGET_CATEGORIES = Constants.public.Enums.budget_category;

/** Live, route-level facts that link the accounting setup's missing items to their owners. */
export default function AccountingStatus() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;

  // These disabled observers read the same cache entries as the existing panels. They do not start
  // reads; they let this one finding line describe the data those panels already loaded.
  const budgetMap = useQuery<CategoryAccountMapRow[]>({
    queryKey: ['budget-category-account-map'],
    queryFn: listBudgetCategoryAccountMap,
    enabled: false,
  });
  const binding = useQuery({
    queryKey: ['integrations', 'binding', orgId, 'erpnext'],
    queryFn: () => repositories.integrations.getBinding(orgId!, 'erpnext'),
    enabled: false,
  });
  const ownership = useQuery({
    queryKey: externalDomainOwnershipKey(orgId),
    queryFn: () => repositories.externalDomainOwnership.listOwn(),
    enabled: false,
  });

  const mappedCategories = new Set((budgetMap.data ?? []).map((row) => row.category));
  const unmappedCategoryCount = BUDGET_CATEGORIES.filter((category) => !mappedCategories.has(category)).length;
  const expensePostingOff = Boolean(
    !binding.isPending
      && !binding.isError
      && binding.data?.status === 'active'
      && !ownership.isPending
      && !ownership.isError
      && (!EXPENSES_EMPLOYABLE || !ownership.data?.some((row) => row.externalTier === 'erpnext' && row.domain === 'expenses')),
  );

  if (unmappedCategoryCount === 0 && !expensePostingOff) return null;

  return (
    <p role="status" className="mb-4 flex flex-wrap items-center gap-x-2 text-control">
      {unmappedCategoryCount > 0 && (
        <a href="#budget-account-map" className="touch-target inline-flex items-center text-primary-text underline underline-offset-2">
          {t('admin.accountingFinding.categories', { defaultValue_one: '{{count}} category not mapped', defaultValue_other: '{{count}} categories not mapped', count: unmappedCategoryCount })}
        </a>
      )}
      {unmappedCategoryCount > 0 && expensePostingOff && <span aria-hidden>·</span>}
      {expensePostingOff && (
        <a href="#expense-account-map" className="touch-target inline-flex items-center text-primary-text underline underline-offset-2">
          {t('admin.accountingFinding.expensePostingOff', 'Expense posting off')}
        </a>
      )}
    </p>
  );
}
