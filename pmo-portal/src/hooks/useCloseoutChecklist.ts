import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { CloseoutTemplateItem } from '@/src/lib/db/closeoutChecklist';

/** The organisation's close-out list (#2593). Keys carry org_id. */
export function useCloseoutTemplate(enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['closeout-template', orgId],
    queryFn: () => repositories.closeoutChecklist.getTemplate(),
    enabled: enabled && Boolean(orgId),
  });
}

/** Replaces the list whole; work orders already issued keep their own copy. */
export function useSaveCloseoutTemplate() {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  return useMutation({
    mutationFn: (items: CloseoutTemplateItem[]) => repositories.closeoutChecklist.setTemplate(items),
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['closeout-template', orgId] }); },
  });
}

/** One work order's checklist. Empty while the organisation had no list when it was issued. */
export function useWorkOrderCloseoutItems(workOrderId: string | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['work-order-closeout', orgId, workOrderId],
    queryFn: () => repositories.closeoutChecklist.listItems(workOrderId as string),
    enabled: Boolean(orgId) && Boolean(workOrderId),
  });
}

/** Who closed a work order and when; read only once it is Closed. */
export function useWorkOrderCloser(workOrderId: string | undefined, enabled: boolean) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['work-order-closer', orgId, workOrderId],
    queryFn: () => repositories.closeoutChecklist.getCloser(workOrderId as string),
    enabled: enabled && Boolean(orgId) && Boolean(workOrderId),
  });
}

/** An item write refreshes the checklist (a done item starts the next one; closing is decided by the database). */
export function useCloseoutItemMutations(workOrderId: string) {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['work-order-closeout', orgId, workOrderId] }); };
  const attachDocument = useMutation({
    mutationFn: ({ itemId, documentId }: { itemId: string; documentId: string }) => repositories.closeoutChecklist.attachDocument(itemId, documentId),
    onSuccess: invalidate,
  });
  const completeItem = useMutation({
    mutationFn: ({ itemId, doneOn }: { itemId: string; doneOn: string }) => repositories.closeoutChecklist.completeItem(itemId, doneOn),
    onSuccess: invalidate,
  });
  return { attachDocument, completeItem };
}
