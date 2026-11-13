import React from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectBudgetPositions } from '@/src/hooks/useProjectBudgetPositions';
import { projectBudgetUsedPercent } from '@/src/lib/projectFinances';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

export const ProjectBudgetFigures: React.FC<{ project: ProjectWithRefs; className?: string }> = ({ project, className }) => {
  const { t } = useTranslation('project');
  const positions = useProjectBudgetPositions([project.id]);
  const used = projectBudgetUsedPercent(positions.data?.[project.id], project.currency);
  return <span data-testid="project-budget-figures" className={className} title={t('projectDetail.cost.spentBasis', 'Spent as a share of budget, before tax')}>
    {t('projects:columns.budgetUsed', 'Budget used')} {used === null ? '—' : `${used}%`}
  </span>;
};
