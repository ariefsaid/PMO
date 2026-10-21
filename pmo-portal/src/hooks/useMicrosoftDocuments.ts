import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { getM365ConnectionStatus } from '@/src/lib/m365/connectClient';
import { repositories } from '@/src/lib/repositories';
import type { MicrosoftLibraryDefault } from '@/src/lib/m365/reference';

/**
 * Query keys for picker settings. The connection key carries BOTH org and caller: a Microsoft
 * connection belongs to a user, so two members of one org must never share a status (or any
 * Graph-derived cache keyed from it). The default library is an org setting, hence org-only.
 */
export const m365DocumentQueryKeys = {
  connection: (orgId: string | null, userId: string | null) => ['m365-connection', orgId, userId] as const,
  defaultLibrary: (orgId: string | null) => ['m365-document-default', orgId] as const,
};

/**
 * Caller-scoped Microsoft connection status + the org default library, read distinctly so a
 * settings failure is never mistaken for "no default" and a status failure never for "not
 * connected". Neither read retries on its own; callers offer an explicit retry via `refetch`.
 */
export function useMicrosoftDocuments() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id ?? null;
  const userId = currentUser?.id ?? null;
  const enabled = !!orgId && !!userId;
  const connectionQuery = useQuery({
    queryKey: m365DocumentQueryKeys.connection(orgId, userId),
    queryFn: getM365ConnectionStatus,
    enabled,
    retry: false,
  });
  const defaultQuery = useQuery({
    queryKey: m365DocumentQueryKeys.defaultLibrary(orgId),
    queryFn: () => repositories.m365DocumentSettings.getDefaultLibrary(),
    enabled,
    retry: false,
  });
  return {
    connection: connectionQuery.data,
    defaultLibrary: defaultQuery.data ?? null,
    isPending: enabled && (connectionQuery.isPending || defaultQuery.isPending),
    isError: connectionQuery.isError || defaultQuery.isError,
    connectionError: connectionQuery.error,
    defaultError: defaultQuery.error,
    refetch: async () => { await Promise.all([connectionQuery.refetch(), defaultQuery.refetch()]); },
  };
}

/**
 * Admin default-library write over the repository seam. Returns `null` while a real role is being
 * viewed as another (impersonation is view-only), so the affordance cannot be wired by accident.
 * RLS remains the enforcement authority; this only keeps the UI honest.
 */
export function useSetDefaultLibrary() {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const { realRole, effectiveRole } = useEffectiveRole();
  const orgId = currentUser?.org_id ?? null;
  const mutation = useMutation({
    mutationFn: (value: MicrosoftLibraryDefault | null) => repositories.m365DocumentSettings.setDefaultLibrary(value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: m365DocumentQueryKeys.defaultLibrary(orgId) }),
  });
  return realRole !== null && realRole === effectiveRole ? mutation : null;
}
