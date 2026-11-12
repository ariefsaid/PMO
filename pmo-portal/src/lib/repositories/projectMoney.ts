/** Project money repository implementation. */
import { getProjectBudgetPositions, getProjectsMoneyCollection } from '@/src/lib/db/projectMoney';
import { wrap } from './repositoryErrors';
import type { ProjectMoneyRepository } from './contracts/projectMoney';

export const projectMoneyRepository: ProjectMoneyRepository = {
  collection: (ids) => wrap(() => getProjectsMoneyCollection(ids)),
  budgetPositions: (ids) => wrap(() => getProjectBudgetPositions(ids)),
};
