import { workOrderStepsQuery } from '@/src/lib/routeQueries/useBillingSteps';
export { workOrderStepsQuery } from '@/src/lib/routeQueries/useBillingSteps';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';
import type { StepInput, StepPatch } from '@/src/lib/db/billingSteps';

/** Organisation step templates (#2680). Keys carry org_id. */
export function useStepTemplates(enabled = true) {
  return useOrgQuery(['billing-step-templates'], () => repositories.billingStages.listStepTemplates(), { enabled });
}

export function useStepTemplateMutations() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['billing-step-templates', orgId] }); };
  const save = useMutation({
    mutationFn: ({ templateId, name, steps }: { templateId: string | null; name: string; steps: StepInput[] }) =>
      repositories.billingStages.saveStepTemplate(templateId, name, steps),
    onSuccess: invalidate,
  });
  const saveWorkOrder = useMutation({
    mutationFn: ({ workOrderId, name }: { workOrderId: string; name: string }) =>
      repositories.billingStages.saveWorkOrderChecklistAsTemplate(workOrderId, name),
    onSuccess: invalidate,
  });
  const archive = useMutation({
    mutationFn: (templateId: string) => repositories.billingStages.archiveStepTemplate(templateId),
    onSuccess: invalidate,
  });
  return { save, saveWorkOrder, archive };
}

/** Loading a template onto a project replaces its list; new claims take it (claims already made do not change). */
export function useLoadTemplateOntoProject(projectId: string) {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: (templateId: string) => repositories.billingStages.loadTemplateOntoProject(projectId, templateId),
    // Waits for the fresh list so the terms editor never re-initialises from the list it just replaced.
    onSuccess: () => qc.refetchQueries({ queryKey: ['project-billing-terms', orgId, projectId] }),
  });
}

/** Edits to one live claim's step list; every write refreshes the claim's trace, the waiting steps and the claim markers. */
export function useClaimStepMutations(claimId: string, projectId: string) {
  const qc = useQueryClient();
  const orgId = useOrgId();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['claim-billing-trace', orgId, claimId] });
    void qc.invalidateQueries({ queryKey: ['progress-claims', orgId, projectId] });
    void qc.invalidateQueries({ queryKey: ['waiting-billing-steps', orgId] });
    void qc.invalidateQueries({ queryKey: ['overdue-billing-steps', orgId, projectId] });
  };
  const update = useMutation({
    mutationFn: ({ stageId, patch }: { stageId: string; patch: StepPatch }) => repositories.billingStages.updateStep(stageId, patch),
    onSuccess: invalidate,
  });
  const add = useMutation({
    mutationFn: ({ afterPosition, step }: { afterPosition: number; step: StepInput }) => repositories.billingStages.addStep(claimId, afterPosition, step),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: ({ stageId, reason }: { stageId: string; reason: string }) => repositories.billingStages.removeStep(stageId, reason),
    onSuccess: invalidate,
  });
  const move = useMutation({
    mutationFn: ({ stageId, position }: { stageId: string; position: number }) => repositories.billingStages.moveStep(stageId, position),
    onSuccess: invalidate,
  });
  const loadTemplate = useMutation({
    mutationFn: (templateId: string) => repositories.billingStages.loadTemplateOntoClaim(claimId, templateId),
    onSuccess: invalidate,
  });
  return { update, add, remove, move, loadTemplate };
}

/** The viewer's waiting steps (the needs-you pointer). Derived on read: nothing to clear when a step completes. */
export function useWaitingSteps(enabled: boolean) {
  return useOrgQuery(['waiting-billing-steps'], () => repositories.billingStages.waitingSteps(), { enabled });
}

/** One overdue current step per claim of a project (the claim list marker). */
export function useOverdueClaimSteps(projectId: string) {
  return useOrgQuery(['overdue-billing-steps', projectId], () => repositories.billingStages.overdueStepsByClaim(projectId), { enabled: Boolean(projectId) });
}

/** A work order's billing step list (advisory), and the rights-checked writes on it. Every write refreshes the list and the waiting steps. */

export function useWorkOrderSteps(workOrderId: string | undefined) {
  return useQuery(workOrderStepsQuery(useOrgId(), workOrderId));
}

/** The rows of every issued work order the viewer may see, optionally one project (the billing board). */
export function useBoardWorkOrderSteps(projectId?: string) {
  return useOrgQuery(['work-order-billing-steps', 'board', projectId ?? 'all'], () => repositories.billingStages.boardWorkOrderSteps(projectId));
}

/** The viewer's waiting work-order steps (the shared needs-you list). Derived on read: nothing to clear when a step is done. */
export function useWaitingWorkOrderSteps(enabled: boolean) {
  return useOrgQuery(['waiting-work-order-steps'], () => repositories.billingStages.waitingWorkOrderSteps(), { enabled });
}

export function useWorkOrderStepMutations() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['work-order-billing-steps', orgId] });
    void qc.invalidateQueries({ queryKey: ['waiting-work-order-steps', orgId] });
  };
  const complete = useMutation({
    mutationFn: ({ stepId, doneOn }: { stepId: string; doneOn: string }) => repositories.billingStages.completeWorkOrderStep(stepId, doneOn),
    onSuccess: invalidate,
  });
  const skip = useMutation({
    mutationFn: ({ stepId, reason }: { stepId: string; reason: string }) => repositories.billingStages.skipWorkOrderStep(stepId, reason),
    onSuccess: invalidate,
  });
  const assign = useMutation({
    mutationFn: ({ stepId, personId }: { stepId: string; personId: string | null }) => repositories.billingStages.assignWorkOrderStep(stepId, personId),
    onSuccess: invalidate,
  });
  const attach = useMutation({
    mutationFn: ({ stepId, slotId, documentId }: { stepId: string; slotId: string | null; documentId: string }) =>
      repositories.billingStages.attachWorkOrderStepDocument(stepId, slotId, documentId),
    onSuccess: invalidate,
  });
  const markEvidence = useMutation({
    mutationFn: ({ stepId, enabled }: { stepId: string; enabled: boolean }) => repositories.billingStages.setWorkOrderStepClaimEvidence(stepId, enabled),
    onSuccess: invalidate,
  });
  // Adds a step to the list itself (migration 2180); the fresh list may hold a newly current step, so the waiting list refreshes too.
  const add = useMutation({
    mutationFn: ({ workOrderId, afterPosition, step }: { workOrderId: string; afterPosition: number | null; step: StepInput }) =>
      repositories.billingStages.addWorkOrderStep(workOrderId, afterPosition, step),
    onSuccess: invalidate,
  });
  return { complete, skip, assign, attach, add, markEvidence };
}

/** The organisation's default billing step template (none = no work order gets a list). */
export function useDefaultStepTemplate(enabled = true) {
  const qc = useQueryClient();
  const orgId = useOrgId();
  const query = useOrgQuery(['default-step-template'], () => repositories.billingStages.defaultStepTemplateId(), { enabled });
  const set = useMutation({
    mutationFn: (templateId: string | null) => repositories.billingStages.setDefaultStepTemplate(templateId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['default-step-template', orgId] }); },
  });
  return { query, set };
}
