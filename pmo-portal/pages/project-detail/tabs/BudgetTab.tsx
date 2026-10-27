import React from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState } from '@/src/components/ui';
import { useProject } from '@/src/hooks/useProjects';
import BudgetB from '../options/BudgetB';
import BudgetC from '../options/BudgetC';
import ProjectBudget from '../../ProjectBudget';

export interface BudgetTabProps {
  projectId: string;
}

const BudgetTab: React.FC<BudgetTabProps> = ({ projectId }) => {
  const [searchParams] = useSearchParams();
  const layout = searchParams.get('layout');
  const { t } = useTranslation();
  const projectQuery = useProject(projectId);

  if (projectQuery.isPending) {
    return <div data-testid="budget-loading"><ListState variant="loading" rows={4} /></div>;
  }
  if (projectQuery.isError || !projectQuery.data) {
    return (
      <ListState
        variant="error"
        title={t('projectDetail.budget.projectLoadError', "Couldn't load this project")}
        sub={t('projectDetail.budget.projectLoadErrorSub', 'Project details could not be checked for the budget. Try again.')}
        onRetry={() => void projectQuery.refetch()}
      />
    );
  }

  if (layout === 'b') return <BudgetB projectId={projectId} project={projectQuery.data} />;
  if (layout === 'c') return <BudgetC projectId={projectId} project={projectQuery.data} />;
  return <ProjectBudget projectId={projectId} project={projectQuery.data} />;
};

export default BudgetTab;
