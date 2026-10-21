import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { getM365ConnectionStatus } from '@/src/lib/m365/connectClient';
import { repositories } from '@/src/lib/repositories';

export const m365DocumentQueryKeys = {
  connection: (orgId: string | null, userId: string | null) => ['m365-connection', orgId, userId] as const,
  defaultLibrary: (orgId: string | null) => ['m365-document-default', orgId] as const,
};

export function useMicrosoftDocuments() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id ?? null;
  const userId = currentUser?.id ?? null;
  const connectionQuery = useQuery({
    queryKey: m365DocumentQueryKeys.connection(orgId, userId),
    queryFn: getM365ConnectionStatus,
    enabled: !!orgId && !!userId,
    retry: false,
  });
  const defaultQuery = useQuery({
    queryKey: m365DocumentQueryKeys.defaultLibrary(orgId),
    queryFn: () => repositories.m365DocumentSettings.getDefaultLibrary(),
    enabled: !!orgId && !!userId,
    retry: false,
  });
  return {
    connection: connectionQuery.data,
    defaultLibrary: defaultQuery.data ?? null,
    isPending: connectionQuery.isPending || defaultQuery.isPending,
    isError: connectionQuery.isError || defaultQuery.isError,
    connectionError: connectionQuery.error,
    defaultError: defaultQuery.error,
    refetch: async () => { await Promise.all([connectionQuery.refetch(), defaultQuery.refetch()]); },
  };
}
