import { useMutation, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';
import type { CloseoutTemplateItem } from '@/src/lib/db/closeoutChecklist';

/** The organisation's close-out list (#2593). Keys carry org_id. */
export function useCloseoutTemplate(enabled = true) {
  return useOrgQuery(['closeout-template'], () => repositories.closeoutChecklist.getTemplate(), { enabled });
}

/** Replaces the list whole; work orders already issued keep their own copy. */
export function useSaveCloseoutTemplate() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: (items: CloseoutTemplateItem[]) => repositories.closeoutChecklist.setTemplate(items),
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['closeout-template', orgId] }); },
  });
}

/** One work order's checklist. Empty while the organisation had no list when it was issued. */
export function useWorkOrderCloseoutItems(workOrderId: string | undefined) {
  return useOrgQuery(['work-order-closeout', workOrderId], () => repositories.closeoutChecklist.listItems(workOrderId as string), { enabled: Boolean(workOrderId) });
}

/**
 * Open, targeted close-out items across the reader's Issued work orders — ONE batch read for the work-orders list's
 * per-work-order overdue count (#2800). No per-row read, no organisation id from the client.
 */
export function useOpenCloseoutDue() {
  return useOrgQuery(['closeout-due'], () => repositories.closeoutChecklist.listOpenDue());
}

/** Who closed a work order and when; read only once it is Closed. */
export function useWorkOrderCloser(workOrderId: string | undefined, enabled: boolean) {
  return useOrgQuery(['work-order-closer', workOrderId], () => repositories.closeoutChecklist.getCloser(workOrderId as string), { enabled: enabled && Boolean(workOrderId) });
}

/** An item write refreshes the checklist (a done item starts the next one; closing is decided by the database). */
export function useCloseoutItemMutations(workOrderId: string) {
  const qc = useQueryClient();
  const orgId = useOrgId();
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
