import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { idleCostRepository } from '@/src/lib/repositories/idleCost';

/** #2673: idle hours as cost. Keys carry org_id (tenant scope). */
export function useIdleCostEnabled(enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['idle-cost', orgId, 'enabled'], queryFn: idleCostRepository.enabled, enabled: enabled && Boolean(orgId), staleTime: 60_000 });
}

/** Per work order and idle reason for one project; empty unless both switches are on. */
export function useProjectIdleCost(projectId: string | undefined, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['idle-cost', orgId, 'project', projectId],
    queryFn: () => idleCostRepository.forProject(projectId as string),
    enabled: enabled && Boolean(orgId) && Boolean(projectId),
    staleTime: 60_000,
    retry: false,
  });
}

export function useSetIdleCostEnabled() {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  return useMutation({
    mutationFn: (on: boolean) => idleCostRepository.setEnabled(on),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['idle-cost', orgId] }),
  });
}
