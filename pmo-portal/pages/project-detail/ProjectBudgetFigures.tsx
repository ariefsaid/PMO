import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { StatTiles, type StatTile } from '@/src/components/ui';
import { useProjectBudgetPositions } from '@/src/hooks/useProjectBudgetPositions';
import { projectBudgetSpentPercent, projectBudgetUsedPercent } from '@/src/lib/projectFinances';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

export interface ProjectBudgetFiguresProps {
  project: ProjectWithRefs;
  className?: string;
}

/** Canonical before-tax budget consumption and recorded spending for the project record header. */
export const ProjectBudgetFigures: React.FC<ProjectBudgetFiguresProps> = ({ project, className }) => {
  const { t } = useTranslation('project');
  const helpId = useId();
  const positions = useProjectBudgetPositions([project.id]);
  const reading = positions.data?.[project.id];
  const usedPercent = projectBudgetUsedPercent(reading, project.currency);
  const spentPercent = projectBudgetSpentPercent(reading, project.currency);
  const budgetUsedBasis = reading?.ledgerBasis === 'pmo'
    ? t('projectDetail.cost.budgetUsedBasis', 'Spent + open orders, before tax')
    : t('projectDetail.cost.budgetUsedBasisLedger', 'Ledger spending, before tax');
  const spentBasis = t('projectDetail.cost.spentBasis', 'Spending share of budget, before tax');
  const tiles: StatTile[] = [
    ...(usedPercent === null ? [] : [{
      label: t('projects:columns.budgetUsed', 'Budget used before tax'),
      value: `${usedPercent}%`,
    }]),
    ...(spentPercent === null ? [] : [{
      label: t('projectDetail.header.tile.spent', 'Spent (% of budget before tax)'),
      value: `${spentPercent}%`,
    }]),
  ];
  if (tiles.length === 0) return null;

  return (
    <div
      data-testid="project-budget-figures"
      role="group"
      aria-label={t('projectDetail.budget.figures', 'Budget figures')}
      aria-describedby={helpId}
      className={`min-w-0 max-w-full flex-[2_1_30rem] ${className ?? ''}`}
    >
      <span id={helpId} className="sr-only">{budgetUsedBasis}. {spentBasis}</span>
      <StatTiles tiles={tiles} columns={tiles.length} density="compact" variant="bare" className="grid-cols-2 gap-x-3 gap-y-0 [&>div]:py-0" />
    </div>
  );
};

ProjectBudgetFigures.displayName = 'ProjectBudgetFigures';
