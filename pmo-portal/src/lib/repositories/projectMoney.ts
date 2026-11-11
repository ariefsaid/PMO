/** Project money repository implementation. */
import { getProjectsMoneyCollection } from '@/src/lib/db/projectMoney';
import { wrap } from './repositoryErrors';
import type { ProjectMoneyRepository } from './contracts/projectMoney';

export const projectMoneyRepository: ProjectMoneyRepository = {
  collection: (ids) => wrap(() => getProjectsMoneyCollection(ids)),
};
