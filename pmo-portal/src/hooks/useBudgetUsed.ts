import { useProjectBudgetPositions } from '@/src/hooks/useProjectBudgetPositions';
import { useFxIdrRate } from '@/src/hooks/useFxIdrRate';
import { budgetUsedFigure, type BudgetUsed } from '@/src/lib/budget/budgetUsed';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

export type { BudgetUsed };

/**
 * The one reader of "Budget used" for a project. The header and the Budget tab card both show this value,
 * so they cannot disagree: known in both or "—" in both. It reads the position the header already fetches
 * (one request), plus the rupiah rate only when budget and spending are in different currencies.
 */
export function useBudgetUsed(project: ProjectWithRefs): BudgetUsed {
  const positions = useProjectBudgetPositions([project.id], { refetchOnMount: false });
  const idrRate = useFxIdrRate();
  return budgetUsedFigure(positions.data?.[project.id], project.currency, idrRate.status === 'ready' ? idrRate.match.rate : null);
}
