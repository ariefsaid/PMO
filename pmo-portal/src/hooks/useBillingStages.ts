import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { CompleteStageInput, RetentionReleaseInput, StageTemplateInput } from '@/src/lib/db/billingStages';

/** One claim's billing-stage trace, org-scoped (#2522). BillingTab's deep-link prefetch shares this key (#2893). */
export const claimBillingTraceKey = (orgId: string | undefined, claimId: string) =>
  ['claim-billing-trace', orgId, claimId] as const;

/** One claim's billing stages, retention and the project's invoice deadline (#2522). Keys carry org_id. */
export function useClaimBillingTrace(claimId: string, projectId: string) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: claimBillingTraceKey(orgId, claimId),
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
    staleTime: 0,
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
  const skipStage = useMutation({
    mutationFn: ({ stageId, reason }: { stageId: string; reason: string }) => repositories.billingStages.skipStage(stageId, reason),
    onSuccess: invalidate,
  });
  return { attachDocument, completeStage, skipStage };
}

/** The project's billing terms: its stage list, monthly invoice deadline and retention percentage. */
export function useProjectBillingTerms(projectId: string, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['project-billing-terms', orgId, projectId],
    queryFn: async () => {
      const [stages, terms] = await Promise.all([repositories.billingStages.getTemplate(projectId), repositories.billingStages.getTerms(projectId)]);
      return { stages, terms };
    },
    enabled: enabled && Boolean(orgId) && Boolean(projectId),
  });
}

export interface SaveBillingTermsInput {
  stages: StageTemplateInput[];
  deadlineDay: number | null;
  warnDays: number;
  retentionPct: number;
}

/** Saves all terms in one transaction; new claims take the new stage list. */
export function useSaveBillingTerms(projectId: string) {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  return useMutation({
    mutationFn: (input: SaveBillingTermsInput) => repositories.billingStages.setTerms(projectId, input.stages, input.deadlineDay, input.warnDays, input.retentionPct),
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['project-billing-terms', orgId, projectId] }); },
  });
}

/** Retention releases share the claim's totals and refresh after every write. */
export function useRetentionReleases(claimId: string, projectId: string) {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['retention-releases', orgId, claimId] });
    void qc.invalidateQueries({ queryKey: ['claim-billing-trace', orgId, claimId] });
    void qc.invalidateQueries({ queryKey: ['progress-claims', orgId, projectId] });
  };
  const releases = useQuery({ queryKey: ['retention-releases', orgId, claimId], queryFn: () => repositories.billingStages.listReleases(claimId), enabled: Boolean(orgId && claimId) });
  const schedule = useMutation({ mutationFn: (input: RetentionReleaseInput) => repositories.billingStages.scheduleRelease(input), onSuccess: invalidate });
  const release = useMutation({ mutationFn: (input: { releaseId: string; releasedOn: string; reference: string | null; documentId: string | null }) => repositories.billingStages.release(input.releaseId, input.releasedOn, input.reference, input.documentId), onSuccess: invalidate });
  const cancel = useMutation({ mutationFn: (releaseId: string) => repositories.billingStages.cancelRelease(releaseId), onSuccess: invalidate });
  return { releases, schedule, release, cancel };
}
