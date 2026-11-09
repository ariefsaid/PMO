import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useStartRecordFolder } from '@/src/hooks/useStartRecordFolder';
import { useAuth } from '@/src/auth/useAuth';
import type { AppError } from '@/src/lib/appError';
import { procurementRepository } from '@/src/lib/repositories/procurement';
import type { AtomicProcurementInput, NewProcurementInput, ProcurementHeaderPatch, ProcurementItemInput, ProcurementItemPatch, ProcurementItemRow } from '@/src/lib/repositories/dataTypes';
import {
  procurementDetailKey,
  cachedProcurementProjectId,
  invalidateProcurementCase,
} from '@/src/hooks/procurementQueryKeys';
import type { Tables } from '@/src/lib/supabase/database.types';

// ---------------------------------------------------------------------------
// Procurement CRUD mutation hooks over the repository seam (ADR-0017). The
// editing companions to useProcurementMutations (the lifecycle hook):
//   • useCreateProcurement — raise a new PR; stamps the requester from the auth
//     context (the form never sends it) and invalidates the procurement LIST.
//   • useProcurementCrudMutations(id) — header edit, line-items CRUD, select-
//     quote, and document-metadata CRUD; each invalidates the DETAIL key
//     ['procurement', orgId, id] so the open detail page refetches.
// All errors propagate as AppError (code preserved) for classifyMutationError.
// ---------------------------------------------------------------------------

/**
 * Raise a new Purchase Request (AC-PROC-001). The requester id is supplied from
 * the auth context (`currentUser.id`) — the FE form never carries it, and the
 * requester widening RLS (migration 0015) keys off this exact id. Invalidates
 * the `['procurements', …]` list family so the index refetches.
 */
export function useCreateProcurement() {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const startRecordFolder = useStartRecordFolder();
  return useMutation<Tables<'procurements'>, AppError, NewProcurementInput>({
    mutationFn: async (input) => {
      const row = await procurementRepository.create(input, currentUser?.id ?? '');
      // #1020: link/create the case's SharePoint folder. The folder name needs the case's request
      // number (`pr_number`, else the imported `code`), so a number-less Draft starts nothing here —
      // it gets its folder when it is submitted to Requested (useProcurementMutations.transition).
      // Fire-and-forget: the saved case is returned unchanged whatever the folder does.
      if (row.pr_number || row.code) startRecordFolder({ kind: 'procurement', id: row.id });
      return row;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['procurements'] }),
  });
}

/** Create the complete draft at a single transactional boundary. */
export function useCreateProcurementWithItems() {
  const qc = useQueryClient();
  const startRecordFolder = useStartRecordFolder();
  return useMutation<Tables<'procurements'>, AppError, AtomicProcurementInput>({
    mutationFn: async (input) => {
      const row = await procurementRepository.createWithItems(input);
      if (row.pr_number || row.code) startRecordFolder({ kind: 'procurement', id: row.id });
      return row;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['procurements'] }),
  });
}

/** Create a line on a newly-created Draft through the procurement repository seam. */
export function useCreateProcurementItem() {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  return useMutation<ProcurementItemRow, AppError, { procurementId: string; input: ProcurementItemInput }>({
    mutationFn: ({ procurementId, input }) => procurementRepository.createItem(procurementId, input),
    onSuccess: (_row, { procurementId }) =>
      qc.invalidateQueries({ queryKey: procurementDetailKey(currentUser?.org_id, procurementId) }),
  });
}

export interface UpdateItemArgs {
  id: string;
  patch: ProcurementItemPatch;
}

/**
 * Detail-scoped CRUD mutations for one PR (header / line items / select-quote /
 * documents). Each invalidates the org-scoped detail key on success (AC-816 shape).
 */
export function useProcurementCrudMutations(id: string) {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const invalidate = (extraProjectIds: ReadonlyArray<string | null> = []) =>
    invalidateProcurementCase(qc, orgId, id, [cachedProcurementProjectId(qc, orgId, id), ...extraProjectIds]);

  const updateHeader = useMutation<void, AppError, ProcurementHeaderPatch>({
    mutationFn: (patch) => procurementRepository.updateHeader(id, patch),
    // the cached detail still holds the OLD project here; the patch carries the new one.
    onSuccess: (_d, patch) => invalidate([patch.projectId]),
  });

  const updateVendor = useMutation<void, AppError, string>({
    mutationFn: (vendorId) => procurementRepository.updateVendor(id, vendorId),
    onSuccess: () => invalidate(),
  });

  const createItem = useMutation<ProcurementItemRow, AppError, ProcurementItemInput>({
    mutationFn: (input) => procurementRepository.createItem(id, input),
    onSuccess: () => invalidate(),
  });

  const updateItem = useMutation<void, AppError, UpdateItemArgs>({
    mutationFn: ({ id: itemId, patch }) => procurementRepository.updateItem(itemId, patch),
    onSuccess: () => invalidate(),
  });

  const deleteItem = useMutation<void, AppError, string>({
    mutationFn: (itemId) => procurementRepository.deleteItem(itemId),
    onSuccess: () => invalidate(),
  });

  const selectQuote = useMutation<void, AppError, string>({
    mutationFn: (quotationId) => procurementRepository.selectQuote(quotationId),
    onSuccess: () => invalidate(),
  });

  // OE13R02-002: the former createDocument/deleteDocument mutations had no production consumer
  // (document metadata CRUD stays reachable at procurementRepository + the DAL, AC-PROC-005);
  // they only dressed uncalled paths as live hook operations.

  return { updateHeader, updateVendor, createItem, updateItem, deleteItem, selectQuote };
}
