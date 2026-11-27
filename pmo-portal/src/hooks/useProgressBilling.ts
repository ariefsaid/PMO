import { projectClaimsQuery } from '@/src/lib/routeQueries/useProgressBilling';
export { projectClaimsQuery } from '@/src/lib/routeQueries/useProgressBilling';
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
  return useQuery(projectClaimsQuery(useAuth().currentUser?.org_id, projectId));
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
    void qc.invalidateQueries({ queryKey: ['billing-reconciliation', orgId, projectId] });
    void qc.invalidateQueries({ queryKey: ['salesInvoices'] });
  };
  // OD-BILL-1: an unraised claim counts as pending against its work order, so a claim write also moves the
  // work-order billing (Work orders tab) and the org-wide still-to-invoice card (dashboards).
  const invalidateClaim = () => {
    invalidate();
    void qc.invalidateQueries({ queryKey: ['work-order-billing', orgId, projectId] });
    void qc.invalidateQueries({ queryKey: ['unbilled-work-orders', orgId] });
  };
  // ADR-0091: a BoQ line's quantity/rate/basis feeds the allocations and BAST quantities that cite it.
  const invalidateBoq = () => {
    invalidate();
    void qc.invalidateQueries({ queryKey: ['work-order-lines', orgId] });
    void qc.invalidateQueries({ queryKey: ['work-order-acceptances', orgId, projectId] });
  };
  const createBoq = useMutation({ mutationFn: (input: BoqItemInput) => repositories.progressBilling.createBoq(projectId, input), onSuccess: invalidateBoq });
  const updateBoq = useMutation({ mutationFn: ({ id, input }: { id: string; input: BoqItemInput }) => repositories.progressBilling.updateBoq(id, input), onSuccess: invalidateBoq });
  const savePricedBoq = useMutation({ mutationFn: ({ id, input, itemId, variantId, asOf }: { id: string | null; input: BoqItemInput; itemId: string; variantId: string; asOf: string }) => repositories.rateCatalogue.savePricedLine(projectId, id, input, itemId, variantId, asOf), onSuccess: invalidateBoq });
  const deleteBoq = useMutation({ mutationFn: (id: string) => repositories.progressBilling.deleteBoq(id), onSuccess: invalidateBoq });
  const recordAssessment = useMutation({
    mutationFn: (input: Omit<ProgressAssessmentInput, 'projectId'>) => repositories.progressBilling.recordAssessment({ ...input, projectId }),
    onSuccess: () => { invalidate(); void qc.invalidateQueries({ queryKey: ['managementPack'] }); },
  });
  const createClaim = useMutation({ mutationFn: (input: Omit<ProgressClaimInput, 'projectId'>) => repositories.progressBilling.createClaim({ ...input, projectId }), onSuccess: invalidateClaim });
  const attachEvidence = useMutation({
    mutationFn: ({ claimId, documentId }: { claimId: string; documentId: string }) => repositories.progressBilling.attachEvidence(claimId, documentId),
    onSuccess: invalidate,
  });
  const withdrawClaim = useMutation({ mutationFn: (id: string) => repositories.progressBilling.withdrawClaim(id), onSuccess: invalidateClaim });
  const raiseInvoice = useMutation({
    mutationFn: ({ claimId, customerId, intent }: { claimId: string; customerId: string; intent?: CommandIntent }) =>
      repositories.progressBilling.raiseInvoice({ claimId, projectId, customerId }, intent),
    onSettled: invalidateClaim,
  });
  // No ERP owns revenue: a PMO Draft invoice from the claim. The invoice lists and the receivables move with it.
  const raiseNativeInvoice = useMutation({
    mutationFn: (claimId: string) => repositories.progressBilling.raiseNativeInvoice(claimId),
    onSettled: invalidateClaim,
  });
  return { createBoq, updateBoq, savePricedBoq, deleteBoq, recordAssessment, createClaim, attachEvidence, withdrawClaim, raiseInvoice, raiseNativeInvoice };
}
