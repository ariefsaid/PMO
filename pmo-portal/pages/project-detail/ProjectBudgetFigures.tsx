import React from 'react';
import { useTranslation } from 'react-i18next';
import { useBudgetUsed } from '@/src/hooks/useBudgetUsed';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { HeaderFact } from './HeaderFact';

export const ProjectBudgetFigures: React.FC<{ project: ProjectWithRefs; className?: string }> = ({ project, className }) => {
  const { t } = useTranslation('project');
  const used = useBudgetUsed(project);
  return <HeaderFact tabIndex={0} data-testid="project-budget-figures" className={className} title={t('projectDetail.cost.spentBasis', 'Spent as a share of budget, before tax')}
    label={t('projects:columns.budgetUsed', 'Budget used')}>{used.value ?? '—'}</HeaderFact>;
};
