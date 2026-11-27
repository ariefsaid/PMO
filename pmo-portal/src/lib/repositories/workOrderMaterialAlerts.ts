/** repositories/workOrderMaterialAlerts.ts — the seam over the ahead-of-progress alerts (ADR-0017). */
import { getOpenMaterialAlertCount, getOpenMaterialAlertCounts, getWaitingMaterialAlerts, type OpenMaterialAlertCount, type WaitingMaterialAlert } from '@/src/lib/db/workOrderMaterialAlerts';
import { wrap } from './repositoryErrors';

export type { OpenMaterialAlertCount, WaitingMaterialAlert };

export const workOrderMaterialAlertsRepository = {
  openCount: (workOrderId: string) => wrap(() => getOpenMaterialAlertCount(workOrderId)),
  openCounts: (workOrderIds: string[]) => wrap(() => getOpenMaterialAlertCounts(workOrderIds)),
  waiting: () => wrap(() => getWaitingMaterialAlerts()),
};
