import { workOrderMaterialAlertsRepository } from '@/src/lib/repositories/workOrderMaterialAlerts';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** Items ahead of progress on one work order, from the recorded alerts (the card badge). */
export function useWorkOrderMaterialAlertCount(workOrderId: string, enabled = true) {
  return useOrgQuery(['wo-material-alert-count', workOrderId], () => workOrderMaterialAlertsRepository.openCount(workOrderId), { enabled: Boolean(workOrderId) && enabled });
}

/** Open alerts on the work orders the viewer controls (needs-you). */
export function useWaitingMaterialAlerts(enabled: boolean) {
  return useOrgQuery(['waiting-material-alerts'], () => workOrderMaterialAlertsRepository.waiting(), { enabled });
}
