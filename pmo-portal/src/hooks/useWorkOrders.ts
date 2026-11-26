import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  repositories,
  type WorkOrderInput,
  type WorkOrderPatch,
  type WorkOrderStatus,
  type SetWorkOrderValueInput,
} from '@/src/lib/repositories';
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
    queryKey: ['work-orders', orgId, projectId, currentUser?.id, currentUser?.role, currentUser?.manager_id],
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
  /** The Work orders page chooses the project at submit; a project's own tab uses the hook's. */
  projectId?: string;
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

/** Every derived surface that reads a project's work-order allocations or billing facts. */
export function invalidateWorkOrderQueries(qc: QueryClient, orgId: string | undefined, projectId: string) {
  void qc.invalidateQueries({ queryKey: ['work-orders', orgId, projectId] });
  void qc.invalidateQueries({ queryKey: ['project-drawdown', orgId, projectId] });
  void qc.invalidateQueries({ queryKey: ['work-order-billing', orgId, projectId] });
  void qc.invalidateQueries({ queryKey: ['unbilled-work-orders', orgId] });
  void qc.invalidateQueries({ queryKey: ['project-billing', orgId, projectId] });
  void qc.invalidateQueries({ queryKey: ['work-order-lines', orgId] });
  void qc.invalidateQueries({ queryKey: ['work-order-acceptances', orgId, projectId] });
  void qc.invalidateQueries({ queryKey: ['work-order', orgId] }); // the work order's own page (#2898: issued or cancelled there)
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
    // OD-BILL-1: a status move changes whether a work order can be invoiced.
    // Contract quantities (ADR-0091): ordered/balance facts count Issued and Closed allocations only, and a
    // status move freezes or releases the allocation list and BAST actions.
    invalidateWorkOrderQueries(qc, orgId, projectId);
  };

  const create = useMutation({
    mutationFn: ({ input, projectId: chosen }: CreateArgs) => repositories.workOrder.create(chosen ?? projectId, input),
    onSuccess: (_created, { projectId: chosen }) => {
      invalidateWorkOrderQueries(qc, orgId, chosen ?? projectId);
      // The org-wide list and its figures (the Work orders page) read other keys than one project's.
      void qc.invalidateQueries({ queryKey: ['work-orders', orgId, 'all'] });
      void qc.invalidateQueries({ queryKey: ['work-order-dashboard', orgId] });
    },
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

  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => repositories.workOrder.cancel(id, reason),
    onSuccess: invalidate,
  });

  return { create, update, setValue, transition, cancel };
}

/** Every work order the reader may see, across projects (the menu's Work orders page). RLS-scoped, no money. */
export function useAllWorkOrders(enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['work-orders', orgId, 'all', currentUser?.id, currentUser?.role],
    queryFn: () => repositories.workOrder.listAll(),
    enabled: enabled && Boolean(orgId),
  });
}
