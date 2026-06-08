import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { AppError } from '@/src/lib/appError';
import type {
  NewProcurementInput,
  ProcurementHeaderPatch,
  ProcurementItemInput,
  ProcurementItemPatch,
  ProcurementItemRow,
  ProcurementDocumentInput,
  ProcurementDocumentRow,
} from '@/src/lib/db/procurementCrud';
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

const procurementDetailKey = (orgId: string | undefined, id: string) =>
  ['procurement', orgId, id] as const;

const procurementDocsKey = (orgId: string | undefined, id: string) =>
  ['procurement-docs', orgId, id] as const;

/**
 * The document-metadata register for a PR (AC-PROC-005). Org-scoped cache key;
 * the document mutations below invalidate it so the register refetches.
 */
export function useProcurementDocuments(id: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ProcurementDocumentRow[]>({
    queryKey: procurementDocsKey(orgId, id ?? ''),
    queryFn: () => repositories.procurement.listDocuments(id!),
    enabled: Boolean(orgId && id),
  });
}

/**
 * Raise a new Purchase Request (AC-PROC-001). The requester id is supplied from
 * the auth context (`currentUser.id`) — the FE form never carries it, and the
 * requester widening RLS (migration 0015) keys off this exact id. Invalidates
 * the `['procurements', …]` list family so the index refetches.
 */
export function useCreateProcurement() {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  return useMutation<Tables<'procurements'>, AppError, NewProcurementInput>({
    mutationFn: (input) => repositories.procurement.create(input, currentUser?.id ?? ''),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['procurements'] }),
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
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: procurementDetailKey(orgId, id) });
  // Document mutations refresh both the detail key (in case a count surfaces there)
  // and the dedicated document-register query.
  const invalidateDocs = () => {
    invalidate();
    qc.invalidateQueries({ queryKey: procurementDocsKey(orgId, id) });
  };

  const updateHeader = useMutation<void, AppError, ProcurementHeaderPatch>({
    mutationFn: (patch) => repositories.procurement.updateHeader(id, patch),
    onSuccess: invalidate,
  });

  const createItem = useMutation<ProcurementItemRow, AppError, ProcurementItemInput>({
    mutationFn: (input) => repositories.procurement.createItem(id, input),
    onSuccess: invalidate,
  });

  const updateItem = useMutation<void, AppError, UpdateItemArgs>({
    mutationFn: ({ id: itemId, patch }) => repositories.procurement.updateItem(itemId, patch),
    onSuccess: invalidate,
  });

  const deleteItem = useMutation<void, AppError, string>({
    mutationFn: (itemId) => repositories.procurement.deleteItem(itemId),
    onSuccess: invalidate,
  });

  const selectQuote = useMutation<void, AppError, string>({
    mutationFn: (quotationId) => repositories.procurement.selectQuote(quotationId),
    onSuccess: invalidate,
  });

  const createDocument = useMutation<ProcurementDocumentRow, AppError, ProcurementDocumentInput>({
    mutationFn: (input) => repositories.procurement.createDocument(id, input),
    onSuccess: invalidateDocs,
  });

  const deleteDocument = useMutation<void, AppError, string>({
    mutationFn: (docId) => repositories.procurement.deleteDocument(docId),
    onSuccess: invalidateDocs,
  });

  return { updateHeader, createItem, updateItem, deleteItem, selectQuote, createDocument, deleteDocument };
}
