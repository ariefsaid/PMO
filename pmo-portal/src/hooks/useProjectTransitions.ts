import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult, UseMutationResult } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import {
  listPipelineStageConfig,
  transitionProject,
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
    queryFn: listPipelineStageConfig,
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
export function useProjectTransition(): UseMutationResult<void, Error, TransitionVars> {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;

  return useMutation<void, Error, TransitionVars>({
    mutationFn: ({ id, to, opts }) => transitionProject(id, to, opts),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', orgId] });
    },
  });
}
