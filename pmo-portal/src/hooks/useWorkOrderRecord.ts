import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';

/** One work order by id for its record page (#2518); null = absent / another org / unreadable (RLS). */
export function useWorkOrder(id: string | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['work-order', orgId, id],
    queryFn: () => repositories.workOrder.get(id as string),
    enabled: Boolean(orgId) && Boolean(id),
  });
}

/** This work order's BoQ allocations. */
export function useWorkOrderAllocations(id: string | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['work-order-lines', orgId, 'wo', id],
    queryFn: () => repositories.workOrderAcceptance.listLines(id as string),
    enabled: Boolean(orgId) && Boolean(id),
  });
}

/** Visible T&M sign-off documents linked to this work order. */
export function useWorkOrderClaimDocuments(id: string | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['work-order-claim-documents', orgId, id],
    queryFn: () => repositories.workOrder.claimDocuments(id as string),
    enabled: Boolean(orgId) && Boolean(id),
  });
}

/** Issues (#2521) that name this work order, for its record page (FR-WORP-025). */
export function useWorkOrderIssues(id: string | undefined, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['incidents', orgId, 'work-order', id],
    queryFn: () => repositories.incident.list({ workOrderId: id as string }),
    enabled: enabled && Boolean(orgId) && Boolean(id),
  });
}

/** Open tasks (#2531) that name this work order; same key as the project tab's open-task list. */
export function useWorkOrderOpenTasks(id: string | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['tasks', orgId, 'work-order', id],
    queryFn: () => repositories.task.listOpenByWorkOrder(id as string),
    enabled: Boolean(orgId) && Boolean(id),
  });
}
