import { enabledOffWhenModuleOff } from '@/src/hooks/moduleGate';
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { workOrderPerformanceRepository } from '@/src/lib/repositories/workOrderPerformance';
import { SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';

export const PERFORMANCE_SETTINGS_KEY = 'org-performance-settings';

/** The organisation's switch and bands. Off (the default) means no performance panel and no performance request. */
export function usePerformanceSettings() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  // The app shell already loads the organisation row once per session (`org-locale-defaults`). This only watches that
  // cache entry (skipToken: it never fetches) and reads the setting once the shell's own read has landed, so a page
  // that mounts without the shell makes no organisation request, and navigating makes none (the answer is cached).
  const shellOrgRead = useQuery({ queryKey: ['org-locale-defaults', orgId], queryFn: skipToken });
  return enabledOffWhenModuleOff('moduleSiteDay', useQuery({
    queryKey: [PERFORMANCE_SETTINGS_KEY, orgId],
    queryFn: () => workOrderPerformanceRepository.getSettings(),
    enabled: Boolean(currentUser) && shellOrgRead.data !== undefined,
    ...SESSION_QUERY_OPTIONS,
  }));
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
