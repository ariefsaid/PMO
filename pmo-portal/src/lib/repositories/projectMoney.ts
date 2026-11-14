/** Project money repository implementation. */
import { getProjectBudgetPositions, getProjectsMoneyCollection } from '@/src/lib/db/projectMoney';
import { wrap } from './repositoryErrors';
import type { ProjectMoneyRepository } from './contracts/projectMoney';

export const projectMoneyRepository: ProjectMoneyRepository = {
  collection: (ids) => wrap(async () => {
    const [collection, positions] = await Promise.all([
      getProjectsMoneyCollection(ids),
      getProjectBudgetPositions(ids),
    ]);
    return Object.fromEntries(Object.entries(collection).map(([id, reading]) => [id, {
      ...reading,
      budgetPosition: positions[id],
    }]));
  }),
  budgetPositions: (ids) => wrap(() => getProjectBudgetPositions(ids)),
};
