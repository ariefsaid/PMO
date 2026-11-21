/** repositories/idleCost.ts (#2673) — the seam over idle hours as cost (ADR-0017). */
import { getIdleCostEnabled, listProjectIdleCost, setIdleCostEnabled } from '@/src/lib/db/idleCost';
import { wrap } from './repositoryErrors';

export const idleCostRepository = {
  enabled: () => wrap(getIdleCostEnabled),
  setEnabled: (on: boolean) => wrap(() => setIdleCostEnabled(on)),
  forProject: (projectId: string) => wrap(() => listProjectIdleCost(projectId)),
};
