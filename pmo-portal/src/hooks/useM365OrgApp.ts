import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { clearM365OrgApp, getM365OrgApp, saveM365OrgApp, type M365OrgAppInput } from '@/src/lib/m365/connectClient';

/** The org's own Microsoft app registration is an org setting: keyed by org only. */
export const m365OrgAppQueryKey = (orgId: string | null) => ['m365-org-app', orgId] as const;

/**
 * Read, save and clear the organisation's Microsoft app registration (#1017). `enabled` is the
 * caller's FE gate: a non-Admin never asks (the edge fn would refuse with FORBIDDEN). A tenant/client
 * change removes every personal connection in the org server-side, so a save or clear also drops the
 * cached connection status.
 */
export function useM365OrgApp(enabled: boolean) {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id ?? null;
  const key = m365OrgAppQueryKey(orgId);
  const query = useQuery({ queryKey: key, queryFn: getM365OrgApp, enabled: enabled && !!orgId, retry: false });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: key });
    await queryClient.invalidateQueries({ queryKey: ['m365-connection'] });
  };
  const save = useMutation({ mutationFn: (input: M365OrgAppInput) => saveM365OrgApp(input), onSuccess: refresh });
  const clear = useMutation({ mutationFn: () => clearM365OrgApp(), onSuccess: refresh });
  return { query, save, clear };
}
