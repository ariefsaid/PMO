import React from 'react';
import { usePermission } from '@/src/auth/usePermission';
import { useBudgetVersions } from '@/src/hooks/useBudget';
import ProjectDetailHeader from '../ProjectDetailHeader';

/**
 * The record header on the Budget tab. While a budget draft is open its own body holds the one filled
 * action (Save lines), so header Edit sits in the record menu instead of competing with it.
 */
const BudgetTabHeader: React.FC<React.ComponentProps<typeof ProjectDetailHeader>> = (props) => {
  const can = usePermission();
  const versionsQuery = useBudgetVersions(props.project.id);
  const draftOpen = can('edit', 'budgetLine') && (versionsQuery.data?.some((version) => version.status === 'Draft') ?? false);
  return <ProjectDetailHeader {...props} editInMenuOnly={draftOpen} />;
};

export default BudgetTabHeader;
