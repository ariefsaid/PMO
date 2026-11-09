import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { orgSettingsRepository } from '@/src/lib/repositories/admin';
import type { ProjectClassificationOptions } from '@/src/lib/db/orgs';
import { SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';

export const PROJECT_CLASSIFICATION_OPTIONS_KEY = 'project-classification-options';
export function useProjectClassificationOptions() {
  const { currentUser } = useAuth();
  return useQuery<ProjectClassificationOptions>({
    queryKey: [PROJECT_CLASSIFICATION_OPTIONS_KEY, currentUser?.org_id],
    queryFn: () => orgSettingsRepository.getProjectClassificationOptions(),
    enabled: Boolean(currentUser?.org_id),
    ...SESSION_QUERY_OPTIONS,
  });
}
