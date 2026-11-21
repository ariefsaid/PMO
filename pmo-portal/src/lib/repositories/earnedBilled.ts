/** repositories/earnedBilled.ts (#2733): the seam over earned and billed revenue (ADR-0017). */
import { listPackEarned, listWorkOrderEarnedBilled } from '@/src/lib/db/earnedBilled';
import { wrap } from './repositoryErrors';

export const earnedBilledRepository = {
  workOrders: (projectId: string) => wrap(() => listWorkOrderEarnedBilled(projectId)),
  packEarned: () => wrap(() => listPackEarned()),
};
