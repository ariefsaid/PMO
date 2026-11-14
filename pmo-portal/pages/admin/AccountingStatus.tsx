import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { Constants } from '@/src/lib/supabase/database.types';
import { EXPENSES_EMPLOYABLE } from '@/src/lib/adapterSeam/erpnext/expenseEnablement';
import { externalDomainOwnershipKey } from '@/src/hooks/approvalsQueryKeys';
import { repositories } from '@/src/lib/repositories';
import { listBudgetCategoryAccountMap, listBudgetPostingAccountCatalogue } from '@/src/lib/repositories/budgetProjection';
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
  const budgetCatalogue = useQuery({
    queryKey: ['budget-posting-account-catalogue'],
    queryFn: listBudgetPostingAccountCatalogue,
    enabled: false,
  });
  const taxCatalogue = useQuery({
    queryKey: ['uxs11', 'account-catalogue', orgId],
    queryFn: listBudgetPostingAccountCatalogue,
    enabled: false,
  });

  const mappedCategories = new Set((budgetMap.data ?? []).map((row) => row.category));
  const unmappedCategoryCount = budgetMap.data
    ? BUDGET_CATEGORIES.filter((category) => !mappedCategories.has(category)).length
    : 0;
  const expensePostingOff = Boolean(
    !binding.isPending
      && !binding.isError
      && binding.data?.status === 'active'
      && !ownership.isPending
      && !ownership.isError
      && (!EXPENSES_EMPLOYABLE || !ownership.data?.some((row) => row.externalTier === 'erpnext' && row.domain === 'expenses')),
  );
  const chartUnavailable = budgetCatalogue.isError || taxCatalogue.isError;

  if (unmappedCategoryCount === 0 && !expensePostingOff && !chartUnavailable) return null;

  const retryFailedCharts = () => {
    const retries: Promise<unknown>[] = [];
    if (budgetCatalogue.isError) retries.push(budgetCatalogue.refetch());
    if (taxCatalogue.isError) retries.push(taxCatalogue.refetch());
    void Promise.all(retries);
  };

  return (
    <p role="status" className="mb-4 flex flex-wrap items-center gap-x-2 text-control">
      {unmappedCategoryCount > 0 && (
        <a href="#budget-account-map" className="touch-target inline-flex items-center text-primary-text underline underline-offset-2">
          {t('admin.accountingFinding.categories', { defaultValue_one: '{{count}} category not mapped', defaultValue_other: '{{count}} categories not mapped', count: unmappedCategoryCount })}
        </a>
      )}
      {unmappedCategoryCount > 0 && (expensePostingOff || chartUnavailable) && <span aria-hidden>·</span>}
      {expensePostingOff && (
        <a href="#expense-account-map" className="touch-target inline-flex items-center text-primary-text underline underline-offset-2">
          {t('admin.accountingFinding.expensePostingOff', 'Expense posting off')}
        </a>
      )}
      {expensePostingOff && chartUnavailable && <span aria-hidden>·</span>}
      {chartUnavailable && (
        <>
          <a href="#budget-account-map" className="touch-target inline-flex items-center text-primary-text underline underline-offset-2">
            {t('uxs10.catalogueError', 'The account chart is unavailable.')}
          </a>
          <Button type="button" variant="outline" size="sm" onClick={retryFailedCharts}>
            {t('admin.retry', 'Retry')}
          </Button>
        </>
      )}
    </p>
  );
}
