import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { ProfileRow } from '@/src/lib/db/profiles';
import { useAuth } from '@/src/auth/useAuth';

/**
 * A picker's profile loader on the shared `['org-profiles', orgId]` cache (the key `useAssignableProfiles`
 * reads), so opening a picker twice sends one request. The returned function keeps its identity until the
 * org changes: a `<Combobox loadOptions>` reloads when that identity changes.
 */
export function useOrgProfilesLoader(): () => Promise<ProfileRow[]> {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  return useCallback(
    () => qc.fetchQuery({ queryKey: ['org-profiles', orgId], queryFn: () => repositories.profile.listOrgProfiles(), staleTime: 5 * 60_000 }),
    [qc, orgId],
  );
}
