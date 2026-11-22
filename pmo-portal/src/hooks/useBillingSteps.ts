import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { StepInput, StepPatch } from '@/src/lib/db/billingSteps';

/** Organisation step templates (#2680). Keys carry org_id. */
export function useStepTemplates(enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['billing-step-templates', orgId],
    queryFn: () => repositories.billingStages.listStepTemplates(),
    enabled: enabled && Boolean(orgId),
  });
}

export function useStepTemplateMutations() {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['billing-step-templates', orgId] }); };
  const save = useMutation({
    mutationFn: ({ templateId, name, steps }: { templateId: string | null; name: string; steps: StepInput[] }) =>
      repositories.billingStages.saveStepTemplate(templateId, name, steps),
    onSuccess: invalidate,
  });
  const archive = useMutation({
    mutationFn: (templateId: string) => repositories.billingStages.archiveStepTemplate(templateId),
    onSuccess: invalidate,
  });
  return { save, archive };
}

/** Loading a template onto a project replaces its list; new claims take it (claims already made do not change). */
export function useLoadTemplateOntoProject(projectId: string) {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  return useMutation({
    mutationFn: (templateId: string) => repositories.billingStages.loadTemplateOntoProject(projectId, templateId),
    // Waits for the fresh list so the terms editor never re-initialises from the list it just replaced.
    onSuccess: () => qc.refetchQueries({ queryKey: ['project-billing-terms', orgId, projectId] }),
  });
}

/** Edits to one live claim's step list; every write refreshes the claim's trace, the waiting steps and the claim markers. */
export function useClaimStepMutations(claimId: string, projectId: string) {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
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
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['waiting-billing-steps', orgId],
    queryFn: () => repositories.billingStages.waitingSteps(),
    enabled: enabled && Boolean(orgId),
  });
}

/** One overdue current step per claim of a project (the claim list marker). */
export function useOverdueClaimSteps(projectId: string) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['overdue-billing-steps', orgId, projectId],
    queryFn: () => repositories.billingStages.overdueStepsByClaim(projectId),
    enabled: Boolean(orgId) && Boolean(projectId),
  });
}
