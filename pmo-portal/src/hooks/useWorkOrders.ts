import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type {
  WorkOrderInput,
  WorkOrderPatch,
  WorkOrderStatus,
  SetWorkOrderValueInput,
} from '@/src/lib/db/workOrders';
import { useAuth } from '@/src/auth/useAuth';

/**
 * Work-order reads + writes for one project (#566), over the repository seam (ADR-0017).
 * Query keys carry org_id (tenant scope) + project_id, matching `useMilestones`.
 */

/** Every work order on a project, newest first. */
export function useProjectWorkOrders(projectId: string) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['work-orders', orgId, projectId],
    queryFn: () => repositories.workOrder.list(projectId),
    enabled: Boolean(orgId) && Boolean(projectId),
  });
}

/**
 * The project's derived drawdown. Resolves to `null` for a project the caller cannot see — the
 * card renders that as an error state, never as a zero ceiling.
 */
export function useProjectDrawdown(projectId: string) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['project-drawdown', orgId, projectId],
    queryFn: () => repositories.workOrder.drawdown(projectId),
    enabled: Boolean(orgId) && Boolean(projectId),
  });
}

interface CreateArgs {
  input: WorkOrderInput;
}
interface UpdateArgs {
  id: string;
  patch: WorkOrderPatch;
}
interface TransitionArgs {
  id: string;
  to: WorkOrderStatus;
  overCommitAck?: boolean;
}

/**
 * The four write paths, each invalidating BOTH the list and the drawdown.
 *
 * ⚑ The drawdown MUST be invalidated by every one of them, including `update` — a body edit does
 * not move money today, but the drawdown card and the list sit on the same screen, and a card that
 * refreshes on three of four writes is the shape that eventually shows a stale committed figure
 * next to a fresh list. The two reads are one view of one fact.
 */
export function useWorkOrderMutations(projectId: string) {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['work-orders', orgId, projectId] });
    void qc.invalidateQueries({ queryKey: ['project-drawdown', orgId, projectId] });
  };

  const create = useMutation({
    mutationFn: ({ input }: CreateArgs) => repositories.workOrder.create(projectId, input),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: UpdateArgs) => repositories.workOrder.update(id, patch),
    onSuccess: invalidate,
  });

  const setValue = useMutation({
    mutationFn: (input: SetWorkOrderValueInput) => repositories.workOrder.setValue(input),
    onSuccess: invalidate,
  });

  const transition = useMutation({
    mutationFn: ({ id, to, overCommitAck }: TransitionArgs) =>
      repositories.workOrder.transition(
        id,
        to,
        // Omitted unless the caller actually has an acknowledgement to make: the RPC refuses one
        // attached to a non-issue transition, and refuses one when nothing is over the ceiling.
        overCommitAck === undefined ? undefined : { overCommitAck },
      ),
    onSuccess: invalidate,
  });

  return { create, update, setValue, transition };
}
