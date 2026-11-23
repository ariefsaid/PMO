import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';
import type { IdleCostScope } from '@/src/lib/db/idleCost';
import { idleCostRepository } from '@/src/lib/repositories/idleCost';
import { useOffWhenModuleOff } from '@/src/hooks/moduleGate';

/** #2673: idle hours as cost. Keys carry org_id (tenant scope). */
export function useIdleCostEnabled(enabled = true) {
  return useOffWhenModuleOff('moduleBillingExtras', useOrgQuery(['idle-cost', 'enabled'], idleCostRepository.enabled, { enabled, staleness: 'live' }));
}

/** Per work order and idle reason for one project; empty unless both switches are on. */
export function useProjectIdleCost(projectId: string | undefined, enabled = true) {
  const orgId = useOrgId();
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
  const orgId = useOrgId();
  return useMutation({
    mutationFn: (on: boolean) => idleCostRepository.setEnabled(on),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['idle-cost', orgId] }),
  });
}

/** What idle cost covers (1730); the default is labour_average. */
export function useIdleCostScope(enabled = true) {
  return useOrgQuery(['idle-cost', 'scope'], idleCostRepository.scope, { enabled, staleness: 'live' });
}

export function useSetIdleCostScope() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: (scope: IdleCostScope) => idleCostRepository.setScope(scope),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['idle-cost', orgId] }),
  });
}
