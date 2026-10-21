import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { ProcurementDocumentRow } from '@/src/lib/db/procurementCrud';
import type { MicrosoftReferenceInput } from '@/src/lib/m365/reference';
import { useAuth } from '@/src/auth/useAuth';

export interface CreateProcurementReferenceArgs {
  reference: MicrosoftReferenceInput;
  metadata?: { referenceNumber?: string | null; date?: string | null };
}

/**
 * Case-scoped document register (Microsoft references AND legacy plain links) over the repository
 * seam. Keyed by the case id alone (never project or stage) so an overhead case with no project and
 * a late purchase stage read the same rows. Every write invalidates ONLY this case's register: an
 * evidence reference never touches a financial record (AC-M365DOC-051/062).
 */
export function useProcurementMicrosoftReferences(procurementId: string) {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const queryKey = ['procurement-documents', orgId, procurementId] as const;
  const invalidate = () => qc.invalidateQueries({ queryKey });

  const query = useQuery<ProcurementDocumentRow[]>({
    queryKey,
    queryFn: () => repositories.procurement.listDocuments(procurementId),
    enabled: Boolean(orgId && procurementId),
  });
  const create = useMutation({
    mutationFn: ({ reference, metadata }: CreateProcurementReferenceArgs) =>
      repositories.procurement.createMicrosoftDocument(procurementId, reference, metadata),
    onSuccess: invalidate,
  });
  const link = useMutation({
    mutationFn: ({ id, reference }: { id: string; reference: MicrosoftReferenceInput }) =>
      repositories.procurement.linkMicrosoftDocument(id, reference),
    onSuccess: invalidate,
  });
  const unlink = useMutation({
    mutationFn: (id: string) => repositories.procurement.unlinkMicrosoftDocument(id),
    onSuccess: invalidate,
  });
  const clearLegacy = useMutation({
    mutationFn: (id: string) => repositories.procurement.clearDocumentLink(id),
    onSuccess: invalidate,
  });
  return { query, create, link, unlink, clearLegacy, invalidate };
}
