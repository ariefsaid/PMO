import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { workOrderPerformanceRepository } from '@/src/lib/repositories/workOrderPerformance';
import { SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';

export const PERFORMANCE_SETTINGS_KEY = 'org-performance-settings';

/** The organisation's switch and bands. Off (the default) means no performance panel and no performance request. */
export function usePerformanceSettings() {
  const { currentUser } = useAuth();
  return useQuery({
    queryKey: [PERFORMANCE_SETTINGS_KEY, currentUser?.org_id],
    queryFn: () => workOrderPerformanceRepository.getSettings(),
    enabled: Boolean(currentUser),
    ...SESSION_QUERY_OPTIONS,
  });
}

export function useSavePerformanceSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { enabled?: boolean; low?: number; high?: number }) => workOrderPerformanceRepository.setSettings(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: [PERFORMANCE_SETTINGS_KEY] }),
  });
}

/** One project's per-work-order figures. `enabled` must already include the setting and the role gate. */
export function useProjectPerformance(projectId: string, enabled: boolean) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['work-order-performance', orgId, projectId],
    queryFn: () => workOrderPerformanceRepository.project(projectId),
    enabled: enabled && Boolean(orgId) && Boolean(projectId),
  });
}
