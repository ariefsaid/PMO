/** Project Overview read-model repository implementation. */
import { getProjectOverviewRead } from '@/src/lib/db/projectOverview';
import { wrap } from './repositoryErrors';
import type { ProjectOverviewRepository } from './contracts/projectOverview';

export const projectOverviewRepository: ProjectOverviewRepository = {
  read: (projectId, flags) => wrap(() => getProjectOverviewRead(projectId, flags)),
};
