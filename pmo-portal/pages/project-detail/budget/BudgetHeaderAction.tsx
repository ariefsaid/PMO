import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { Button } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useBudgetVersions } from '@/src/hooks/useBudget';

/** The search parameter the Budget tab answers: open the next budget step (create or update). */
export const BUDGET_ACTION_PARAM = 'budgetAction';

/**
 * On the Budget tab the record header's one filled action is "Update budget" when an approved budget has
 * no draft beside it; with no budget at all it is a quiet "Create budget" that moves focus to the tab's
 * own first-budget form (whose "Create draft" is the filled action). It renders
 * nothing otherwise (a draft already open, or no budget-edit permission), and the header then keeps Edit
 * as its main action. The click only asks the tab to start the step; the tab runs its existing flow
 * (the same confirm dialogs), so no budget rule lives here.
 */
const BudgetHeaderAction: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { t } = useTranslation('finance');
  const can = usePermission();
  const canWrite = can('edit', 'budgetLine');
  const versionsQuery = useBudgetVersions(projectId);
  const [searchParams, setSearchParams] = useSearchParams();
  const versions = versionsQuery.data;
  if (!canWrite || !versions) return null;
  if (versions.some((version) => version.status === 'Draft')) return null;
  const hasActive = versions.some((version) => version.status === 'Active');
  if (versions.length > 0 && !hasActive) return null;
  const label = versions.length === 0
    ? t('projectDetail.budget.createBudget', 'Create budget')
    : t('projectDetail.budget.updateBudget', 'Update budget');
  return (
    <Button
      // With no budget the filled action is the tab's own "Create draft", beside the name field; this one only takes you there.
      variant={versions.length === 0 ? 'outline' : 'primary'}
      size="sm"
      className="touch-target"
      onClick={() => {
        const next = new URLSearchParams(searchParams);
        next.set(BUDGET_ACTION_PARAM, 'next');
        setSearchParams(next, { replace: true });
      }}
    >
      {label}
    </Button>
  );
};

export default BudgetHeaderAction;
