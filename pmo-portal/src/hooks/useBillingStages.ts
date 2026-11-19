import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { CompleteStageInput } from '@/src/lib/db/billingStages';

/** One claim's billing stages, retention and the project's invoice deadline (#2522). Keys carry org_id. */
export function useClaimBillingTrace(claimId: string, projectId: string) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['claim-billing-trace', orgId, claimId],
    queryFn: () => repositories.billingStages.trace(claimId, projectId),
    enabled: Boolean(orgId) && Boolean(claimId) && Boolean(projectId),
  });
}

/** Per-item reconciliation of progress, measured and billed quantities (the server's one derivation). */
export function useBillingReconciliation(projectId: string, workOrderId: string | null) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['billing-reconciliation', orgId, projectId, workOrderId],
    queryFn: () => repositories.billingStages.reconciliation(projectId, workOrderId),
    enabled: Boolean(orgId) && Boolean(projectId),
  });
}

/**
 * A stage write refreshes the claim's trace, and the project's claims (an attached document becomes the claim's evidence,
 * and completing the last stage is what lets the invoice be raised).
 */
export function useBillingStageMutations(claimId: string, projectId: string) {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['claim-billing-trace', orgId, claimId] });
    void qc.invalidateQueries({ queryKey: ['progress-claims', orgId, projectId] });
  };
  const attachDocument = useMutation({
    mutationFn: ({ itemId, documentId }: { itemId: string; documentId: string }) => repositories.billingStages.attachDocument(itemId, documentId),
    onSuccess: invalidate,
  });
  const completeStage = useMutation({
    mutationFn: (input: CompleteStageInput) => repositories.billingStages.completeStage(input),
    onSuccess: invalidate,
  });
  return { attachDocument, completeStage };
}
