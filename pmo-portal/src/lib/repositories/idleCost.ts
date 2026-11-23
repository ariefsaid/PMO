/** repositories/idleCost.ts (#2673) — the seam over idle hours as cost (ADR-0017). */
import { getIdleCostEnabled, getIdleCostScope, listProjectIdleCost, setIdleCostEnabled, setIdleCostScope, type IdleCostScope } from '@/src/lib/db/idleCost';
import { wrap } from './repositoryErrors';

export const idleCostRepository = {
  enabled: () => wrap(getIdleCostEnabled),
  setEnabled: (on: boolean) => wrap(() => setIdleCostEnabled(on)),
  scope: () => wrap(getIdleCostScope),
  setScope: (scope: IdleCostScope) => wrap(() => setIdleCostScope(scope)),
  forProject: (projectId: string) => wrap(() => listProjectIdleCost(projectId)),
};
