import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';

export const ORG_PROJECT_NUMBER_PATTERN_KEY = 'org-project-number-pattern';

export function useOrgProjectNumberPatternQuery() {
  const { currentUser } = useAuth();
  return useQuery<string | null>({
    queryKey: [ORG_PROJECT_NUMBER_PATTERN_KEY, currentUser?.org_id],
    queryFn: () => repositories.orgSettings.getProjectNumberPattern(),
    enabled: Boolean(currentUser),
    staleTime: Infinity,
  });
}
