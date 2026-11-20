import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { workOrderSectionRepository as repo, type PlanChange, type Readiness, type SectionInput } from '@/src/lib/repositories/workOrderSections';

/** #2576: one work order's sections with their roll-up (one row per section plus the unsectioned remainder). Keys carry org_id. */
export function useWorkOrderSectionRollup(workOrderId: string | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['work-order-sections', orgId, workOrderId, 'rollup'],
    queryFn: () => repo.rollup(workOrderId as string),
    enabled: Boolean(orgId) && Boolean(workOrderId),
  });
}

/** The readiness roll-up (counts per readiness over live sections). */
export function useWorkOrderSectionReadiness(workOrderId: string | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['work-order-sections', orgId, workOrderId, 'readiness'],
    queryFn: () => repo.readiness(workOrderId as string),
    enabled: Boolean(orgId) && Boolean(workOrderId),
  });
}

export function useSectionReadinessEvents(sectionId: string | null) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['work-order-sections', orgId, 'events', sectionId],
    queryFn: () => repo.events(sectionId as string),
    enabled: Boolean(orgId) && Boolean(sectionId),
  });
}

function useInvalidate(workOrderId: string, projectId?: string) {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ['work-order-sections', orgId, workOrderId] }),
    qc.invalidateQueries({ queryKey: ['work-order-sections', orgId, 'events'] }),
    // The work order's plan total reads the same plan lines.
    projectId ? qc.invalidateQueries({ queryKey: ['work-order-plan-vs-actual', orgId, projectId] }) : Promise.resolve(),
  ]);
}

export function useSaveSection(workOrderId: string) {
  const invalidate = useInvalidate(workOrderId);
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: SectionInput }) =>
      id ? repo.update(id, input).then(() => id) : repo.create(workOrderId, input),
    onSuccess: invalidate,
  });
}

export function useSetSectionReadiness(workOrderId: string) {
  const invalidate = useInvalidate(workOrderId);
  return useMutation({
    mutationFn: ({ id, readiness, note }: { id: string; readiness: Readiness; note: string | null }) => repo.setReadiness(id, readiness, note),
    onSuccess: invalidate,
  });
}

export function useArchiveSection(workOrderId: string) {
  const invalidate = useInvalidate(workOrderId);
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => repo.setArchived(id, archived),
    onSuccess: invalidate,
  });
}

export function useDeleteSection(workOrderId: string) {
  const invalidate = useInvalidate(workOrderId);
  return useMutation({ mutationFn: (id: string) => repo.remove(id), onSuccess: invalidate });
}

export function useSaveSectionPlan(workOrderId: string, projectId: string) {
  const invalidate = useInvalidate(workOrderId, projectId);
  return useMutation({
    mutationFn: (changes: PlanChange[]) => repo.setPlan(projectId, workOrderId, changes),
    onSuccess: invalidate,
  });
}
