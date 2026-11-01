import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult, UseMutationResult } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { useState } from 'react';
import { invalidateProjectProjections } from './projectQueryKeys';
import { repositories } from '@/src/lib/repositories';
import { synchronizeErpProject } from '@/src/lib/repositories/projectErpSetup';
import {
  type PipelineStageConfig,
  type ProjectStatus,
  type TransitionProjectOpts,
} from '@/src/lib/db/projectTransitions';

// ---------------------------------------------------------------------------
// Read hook — pipeline stage config (C1, supports AC-1003)
// ---------------------------------------------------------------------------

/**
 * Fetches the org's pipeline stage win-probability config.
 * Cache key: ['pipeline-stage-config', orgId] — org-scoped (FR-PR-013).
 * Disabled when orgId is absent.
 */
export function usePipelineStageConfig(): UseQueryResult<PipelineStageConfig[]> {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;

  return useQuery<PipelineStageConfig[]>({
    queryKey: ['pipeline-stage-config', orgId],
    queryFn: () => repositories.project.listPipelineStageConfig(),
    enabled: Boolean(orgId),
  });
}

// ---------------------------------------------------------------------------
// Mutation hook — project transition (C2, supports AC-1011)
// Invalidates ['projects', orgId] on success (mirrors useTimesheetMutations).
// ---------------------------------------------------------------------------

type TransitionVars = {
  id: string;
  to: ProjectStatus;
  opts?: TransitionProjectOpts;
};

/**
 * Mutation hook for transitioning a project status.
 * On success, invalidates the ['projects', orgId] cache so the list refetches.
 * org_id is NEVER sent to the RPC (FR-PR-010).
 */
export function useProjectTransition(): UseMutationResult<void, Error, TransitionVars> & { erpSetupPending: boolean } {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const [erpSetupPending, setErpSetupPending] = useState(false);

  const mutation = useMutation<void, Error, TransitionVars>({
    mutationFn: ({ id, to, opts }) => repositories.project.transition(id, to, opts),
    onSuccess: async (_data, { id, to }) => {
      setErpSetupPending(to === 'Won, Pending KoM' && await synchronizeErpProject(id, orgId) === 'pending');
      invalidateProjectProjections(queryClient, orgId);
      queryClient.invalidateQueries({ queryKey: ['integrations', 'bindings', orgId] });
      queryClient.invalidateQueries({ queryKey: ['integrations', 'project-erp', orgId] });
      queryClient.invalidateQueries({ queryKey: ['integrations', 'setup', orgId] });
    },
  });
  return { ...mutation, erpSetupPending };
}

/** Query options for the read-only win preflight, shared by the status menu and the board drop. */
export const winEligibilityQueryOptions = (
  user: { org_id?: string; id?: string; role?: string | null; manager_id?: string | null } | null | undefined,
  projectId: string,
  revision?: string | null,
) => ({
  queryKey: ['project-win-eligibility', user?.org_id, user?.id, user?.role, user?.manager_id, projectId, revision] as const,
  queryFn: () => repositories.project.winEligibility(projectId),
  staleTime: 0,
});

/** Read-only preflight; the transition RPC remains authoritative. */
export function useProjectWinEligibility(projectId: string, enabled: boolean, revision?: string | null) {
  const { currentUser } = useAuth();
  return useQuery({
    ...winEligibilityQueryOptions(currentUser, projectId, revision),
    enabled: Boolean(enabled && currentUser?.id),
  });
}
