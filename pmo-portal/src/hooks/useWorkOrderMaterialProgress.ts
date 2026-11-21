import { useQuery } from '@tanstack/react-query';
import { workOrderMaterialProgressRepository } from '@/src/lib/repositories/workOrderMaterialProgress';
import { useAuth } from '@/src/auth/useAuth';

/** Issued share against progress share for one work order (#2674). Empty items with a null threshold = the warning is off. */
export function useWorkOrderMaterialProgress(workOrderId: string, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['wo-material-progress', orgId, workOrderId],
    queryFn: () => workOrderMaterialProgressRepository.get(workOrderId),
    enabled: Boolean(orgId) && Boolean(workOrderId) && enabled,
  });
}
