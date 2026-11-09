import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { orgSettingsRepository } from '@/src/lib/repositories/admin';
import { SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';

export const ORG_PROJECT_NUMBER_PATTERN_KEY = 'org-project-number-pattern';
export const ORG_PROJECT_NUMBER_TIMEZONE_KEY = 'org-project-number-timezone';

export function useOrgProjectNumberPatternQuery() {
  const { currentUser } = useAuth();
  return useQuery<string | null>({
    queryKey: [ORG_PROJECT_NUMBER_PATTERN_KEY, currentUser?.org_id],
    queryFn: () => orgSettingsRepository.getProjectNumberPattern(),
    enabled: Boolean(currentUser),
    ...SESSION_QUERY_OPTIONS,
  });
}

export function useOrgProjectNumberTimezoneQuery() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<{ timezone: string | null }>({
    queryKey: [ORG_PROJECT_NUMBER_TIMEZONE_KEY, orgId],
    queryFn: () => orgSettingsRepository.getProjectNumberTimezone(),
    enabled: Boolean(orgId),
    ...SESSION_QUERY_OPTIONS,
  });
}
