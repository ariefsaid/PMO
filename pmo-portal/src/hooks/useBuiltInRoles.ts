import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';

/** #2709: has the organization turned the built-in role set on? Off (false) until an Admin turns it on; unreadable reads as off. */
export const BUILT_IN_ROLES_ENABLED_KEY = 'org-built-in-roles-enabled';

export function useBuiltInRolesEnabled() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: [BUILT_IN_ROLES_ENABLED_KEY, orgId],
    queryFn: () => repositories.orgSettings.getBuiltInRolesEnabled(),
    enabled: Boolean(orgId),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Give a person a built-in role key, or clear it with null; refreshes the Users directory and the people pickers. */
export function useBuiltInRoleMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, key }: { id: string; key: string | null }) => repositories.profile.updateUserBuiltInRole(id, key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['org-profiles'] });
      qc.invalidateQueries({ queryKey: ['profiles', 'pm'] });
    },
  });
}
