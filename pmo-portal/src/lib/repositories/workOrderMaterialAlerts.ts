/** repositories/workOrderMaterialAlerts.ts — the seam over the ahead-of-progress alerts and who is told (ADR-0017). */
import { getAheadAlertRoles, getOpenMaterialAlertCount, getWaitingMaterialAlerts, setAheadAlertRoles,
  type OpenMaterialAlertCount, type WaitingMaterialAlert } from '@/src/lib/db/workOrderMaterialAlerts';
import { wrap } from './repositoryErrors';

export type { OpenMaterialAlertCount, WaitingMaterialAlert };

export const workOrderMaterialAlertsRepository = {
  openCount: (workOrderId: string) => wrap(() => getOpenMaterialAlertCount(workOrderId)),
  waiting: () => wrap(() => getWaitingMaterialAlerts()),
  roles: () => wrap(() => getAheadAlertRoles()),
  setRoles: (roles: string[]) => wrap(() => setAheadAlertRoles(roles)),
};
