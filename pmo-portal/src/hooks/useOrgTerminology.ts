import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { i18next } from '@/src/lib/i18n';
import { listOrgTerminology } from '@/src/lib/db/orgTerminology';
import { setOrgTerms, getOrgTerms, type OrgTerms } from '@/src/lib/i18n/orgTerms';
import { useAuth } from '@/src/auth/useAuth';

export const ORG_TERMINOLOGY_KEY = ['org-terminology'] as const;

export function useOrgTerminology() {
  const { currentUser } = useAuth();
  return useQuery({
    queryKey: [...ORG_TERMINOLOGY_KEY, currentUser?.org_id],
    queryFn: listOrgTerminology,
    enabled: Boolean(currentUser),
    staleTime: 5 * 60_000,
  });
}

/**
 * Mount once under the auth + query providers: loads the org's overrides, hands them to the
 * i18next `orgTerms` post-processor and re-renders subscribers (changeLanguage to the same
 * language fires `languageChanged`, which react-i18next is bound to).
 */
export function useApplyOrgTerminology(): void {
  const { data } = useOrgTerminology();
  useEffect(() => {
    const next: OrgTerms = data ?? {};
    if (JSON.stringify(next) === JSON.stringify(getOrgTerms())) return;
    setOrgTerms(next);
    if (i18next.isInitialized) void i18next.changeLanguage(i18next.language);
  }, [data]);
}
