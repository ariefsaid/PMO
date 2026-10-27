import React from 'react';
import { useTranslation } from 'react-i18next';
import { ListState } from '@/src/components/ui';
import { useProject } from '@/src/hooks/useProjects';
import ProjectBudget from '../../ProjectBudget';

export interface BudgetTabProps {
  projectId: string;
}

const BudgetTab: React.FC<BudgetTabProps> = ({ projectId }) => {
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

  return <ProjectBudget projectId={projectId} project={projectQuery.data} />;
};

export default BudgetTab;
