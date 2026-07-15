import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { IntegrationBinding, ConnectCredential, IntegrationHealth, ExternalTier, ClickUpListItem, LinkInput, UnlinkInput, ProjectBinding } from '@/src/lib/repositories/types';
import { useAuth } from '@/src/auth/useAuth';

/**
 * Hook for managing integrations (connect/disconnect/status/health).
 * Wraps the IntegrationsRepository with React Query for query/mutation management.
 */
export function useIntegrations() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const qc = useQueryClient();

  // Query: list all bindings for the org
  const { data: bindings = [], isPending, isError, isSuccess, error, refetch } = useQuery<IntegrationBinding[]>({
    queryKey: ['integrations', 'bindings', orgId],
    queryFn: () => repositories.integrations.listBindings(orgId!),
    enabled: Boolean(orgId),
  });

  // Mutation: connect
  const connect = useMutation({
    mutationFn: (credential: ConnectCredential) => repositories.integrations.connectIntegration(orgId!, credential),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['integrations', 'bindings', orgId] });
      qc.invalidateQueries({ queryKey: ['integrations', 'health', orgId, vars.tier] });
    },
  });

  // Mutation: disconnect
  const disconnect = useMutation({
    mutationFn: (tier: ExternalTier) => repositories.integrations.disconnectIntegration(orgId!, tier),
    onSuccess: (_data, tier) => {
      qc.invalidateQueries({ queryKey: ['integrations', 'bindings', orgId] });
      qc.invalidateQueries({ queryKey: ['integrations', 'health', orgId, tier] });
    },
  });

  // Helper: get binding for a specific tier from cached list
  const getBinding = (tier: ExternalTier): IntegrationBinding | undefined =>
    bindings.find((b) => b.external_tier === tier);

  // Helper: fetch health for a specific tier (direct call, not a hook)
  const getHealth = async (tier: ExternalTier): Promise<IntegrationHealth> => {
    if (!orgId) throw new Error('No orgId available');
    return repositories.integrations.getIntegrationHealth(orgId, tier);
  };

  // Query: list ClickUp lists for the org
  const { data: clickupLists = [], isPending: isListsPending, isError: isListsError, error: listsError, refetch: refetchLists } = useQuery<ClickUpListItem[]>({
    queryKey: ['integrations', 'clickup-lists', orgId],
    queryFn: () => repositories.integrations.listProjectLists(orgId!),
    enabled: Boolean(orgId),
  });

  // Mutation: link project
  const linkProject = useMutation({
    mutationFn: (input: LinkInput) => repositories.integrations.linkProject(orgId!, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations', 'project-bindings', orgId] });
    },
  });

  // Mutation: unlink project
  const unlinkProject = useMutation({
    mutationFn: (input: UnlinkInput) => repositories.integrations.unlinkProject(orgId!, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations', 'project-bindings', orgId] });
    },
  });

  // Query: list project bindings for the org
  const { data: projectBindings = [], isPending: isBindingsPending, isError: isBindingsError, error: bindingsError, refetch: refetchBindings } = useQuery<ProjectBinding[]>({
    queryKey: ['integrations', 'project-bindings', orgId],
    queryFn: () => repositories.integrations.listProjectBindings(orgId!),
    enabled: Boolean(orgId),
  });

  return {
    bindings,
    isPending,
    isError,
    isSuccess,
    error,
    refetch,
    connect,
    disconnect,
    getBinding,
    getHealth,
    clickupLists,
    isListsPending,
    isListsError,
    listsError,
    refetchLists,
    linkProject,
    unlinkProject,
    projectBindings,
    isBindingsPending,
    isBindingsError,
    bindingsError,
    refetchBindings,
  };
}