import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { BoqItemInput, ProgressAssessmentInput, ProgressClaimInput } from '@/src/lib/db/progressBilling';
import type { CommandIntent } from '@/src/lib/repositories/types';

/** Progress billing reads + writes for one project (#766). Keys carry org_id + project_id. */
export function useBoqItems(projectId: string) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['boq-items', orgId, projectId], queryFn: () => repositories.progressBilling.listBoq(projectId), enabled: Boolean(orgId) && Boolean(projectId) });
}

export function useProjectClaims(projectId: string) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['progress-claims', orgId, projectId], queryFn: () => repositories.progressBilling.listClaims(projectId), enabled: Boolean(orgId) && Boolean(projectId) });
}

/** Resolves to null for an invisible project — the card renders that as an error, never as zeros. */
export function useProjectBilling(projectId: string) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['project-billing', orgId, projectId], queryFn: () => repositories.progressBilling.summary(projectId), enabled: Boolean(orgId) && Boolean(projectId) });
}

/**
 * Every write refreshes the BoQ, the claims and the summary — one view of one fact. An assessment also
 * refreshes the management pack (it reads the same percent). Raising refreshes on SETTLE: a lost response can
 * still mean the ERP committed the invoice.
 */
export function useProgressBillingMutations(projectId: string) {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['boq-items', orgId, projectId] });
    void qc.invalidateQueries({ queryKey: ['progress-claims', orgId, projectId] });
    void qc.invalidateQueries({ queryKey: ['project-billing', orgId, projectId] });
    void qc.invalidateQueries({ queryKey: ['salesInvoices'] });
  };
  const createBoq = useMutation({ mutationFn: (input: BoqItemInput) => repositories.progressBilling.createBoq(projectId, input), onSuccess: invalidate });
  const updateBoq = useMutation({ mutationFn: ({ id, input }: { id: string; input: BoqItemInput }) => repositories.progressBilling.updateBoq(id, input), onSuccess: invalidate });
  const deleteBoq = useMutation({ mutationFn: (id: string) => repositories.progressBilling.deleteBoq(id), onSuccess: invalidate });
  const recordAssessment = useMutation({
    mutationFn: (input: Omit<ProgressAssessmentInput, 'projectId'>) => repositories.progressBilling.recordAssessment({ ...input, projectId }),
    onSuccess: () => { invalidate(); void qc.invalidateQueries({ queryKey: ['managementPack'] }); },
  });
  const createClaim = useMutation({ mutationFn: (input: Omit<ProgressClaimInput, 'projectId'>) => repositories.progressBilling.createClaim({ ...input, projectId }), onSuccess: invalidate });
  const attachEvidence = useMutation({
    mutationFn: ({ claimId, documentId }: { claimId: string; documentId: string }) => repositories.progressBilling.attachEvidence(claimId, documentId),
    onSuccess: invalidate,
  });
  const withdrawClaim = useMutation({ mutationFn: (id: string) => repositories.progressBilling.withdrawClaim(id), onSuccess: invalidate });
  const raiseInvoice = useMutation({
    mutationFn: ({ claimId, customerId, intent }: { claimId: string; customerId: string; intent?: CommandIntent }) =>
      repositories.progressBilling.raiseInvoice({ claimId, projectId, customerId }, intent),
    onSettled: invalidate,
  });
  return { createBoq, updateBoq, deleteBoq, recordAssessment, createClaim, attachEvidence, withdrawClaim, raiseInvoice };
}
