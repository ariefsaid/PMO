import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import type { ProjectClassificationOptions } from '@/src/lib/db/orgs';

export const PROJECT_CLASSIFICATION_OPTIONS_KEY = 'project-classification-options';
export function useProjectClassificationOptions() {
  const { currentUser } = useAuth();
  return useQuery<ProjectClassificationOptions>({
    queryKey: [PROJECT_CLASSIFICATION_OPTIONS_KEY, currentUser?.org_id],
    queryFn: () => repositories.orgSettings.getProjectClassificationOptions(),
    enabled: Boolean(currentUser?.org_id),
    staleTime: Infinity,
  });
}
