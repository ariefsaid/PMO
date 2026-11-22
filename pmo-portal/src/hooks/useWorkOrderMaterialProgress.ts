import { workOrderMaterialProgressRepository } from '@/src/lib/repositories/workOrderMaterialProgress';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** Issued share against progress share for one work order (#2674). Empty items with a null threshold = the warning is off. */
export function useWorkOrderMaterialProgress(workOrderId: string, enabled = true) {
  return useOrgQuery(['wo-material-progress', workOrderId], () => workOrderMaterialProgressRepository.get(workOrderId), { enabled: Boolean(workOrderId) && enabled });
}
