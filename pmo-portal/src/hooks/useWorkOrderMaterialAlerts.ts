import { workOrderMaterialAlertsRepository } from '@/src/lib/repositories/workOrderMaterialAlerts';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** Items ahead of progress on one work order, from the recorded alerts (the card badge). */
export function useWorkOrderMaterialAlertCount(workOrderId: string, enabled = true) {
  return useOrgQuery(['wo-material-alert-count', workOrderId], () => workOrderMaterialAlertsRepository.openCount(workOrderId), { enabled: Boolean(workOrderId) && enabled });
}

/** Items ahead of progress for many work orders at once (one batched read for a project's work-order cards). */
export function useWorkOrderMaterialAlertCounts(workOrderIds: string[], enabled = true) {
  const ids = [...new Set(workOrderIds)].sort();
  return useOrgQuery(['wo-material-alert-counts', ids], () => workOrderMaterialAlertsRepository.openCounts(ids), { enabled: ids.length > 0 && enabled });
}

/** Open alerts on the work orders the viewer controls (needs-you). */
export function useWaitingMaterialAlerts(enabled: boolean) {
  return useOrgQuery(['waiting-material-alerts'], () => workOrderMaterialAlertsRepository.waiting(), { enabled, startOnRender: true });
}
