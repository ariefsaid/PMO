import {
  attachBillingStageDocument, cancelRetentionRelease, completeBillingStage, getBillingReconciliation, getBillingStageTemplate,
  getClaimBillingTrace, getProjectBillingTerms, listRetentionReleases, noteBillingStage, skipBillingStage, releaseRetention, scheduleRetentionRelease, setBillingStageTemplate,
  setProjectInvoiceDeadline, setProjectRetention, setProjectBillingTerms,
} from '@/src/lib/db/billingStages';
import {
  addClaimStep, archiveStepTemplate, getOverdueStepsByClaim, getWaitingSteps, listStepTemplates, loadStepTemplateOntoClaim,
  loadStepTemplateOntoProject, moveClaimStep, removeClaimStep, saveStepTemplate, updateClaimStep,
} from '@/src/lib/db/billingSteps';
import { getBillingBoard } from '@/src/lib/db/billingBoard';
import { getPlanCandidates, getPlanSettings, saveMonthTarget, savePlanSettings } from '@/src/lib/db/billingPlan';
import { wrap } from './repositoryErrors';
import type { BillingStagesRepository } from './contracts/billingStages';

/**
 * Measurement to invoice (#2522, #1572). Every rule that gates invoicing lives in the database (0960–0962); this seam only
 * carries what a person decides. Nothing here dispatches to an ERP: the claim's invoice is raised by progressBilling.
 */
export const billingStagesRepository: BillingStagesRepository = {
  readBoard: (projectId) => wrap(() => getBillingBoard(projectId)),
  readPlanCandidates: (projectId) => wrap(() => getPlanCandidates(projectId)),
  getPlanSettings: () => wrap(() => getPlanSettings()),
  savePlanSettings: (input) => wrap(() => savePlanSettings(input)),
  saveMonthTarget: (month, target) => wrap(() => saveMonthTarget(month, target)),
  getTemplate: (projectId) => wrap(() => getBillingStageTemplate(projectId)),
  setTemplate: (projectId, stages) => wrap(() => setBillingStageTemplate(projectId, stages)),
  setTerms: (projectId, stages, day, warnDays, pct) => wrap(() => setProjectBillingTerms(projectId, stages, day, warnDays, pct)),
  getTerms: (projectId) => wrap(() => getProjectBillingTerms(projectId)),
  setInvoiceDeadline: (projectId, day, warnDays) => wrap(() => setProjectInvoiceDeadline(projectId, day, warnDays)),
  setRetention: (projectId, pct) => wrap(() => setProjectRetention(projectId, pct)),
  trace: (claimId, projectId) => wrap(() => getClaimBillingTrace(claimId, projectId)),
  attachDocument: (itemId, documentId) => wrap(() => attachBillingStageDocument(itemId, documentId)),
  completeStage: (input) => wrap(() => completeBillingStage(input)),
  noteStage: (stageId, note) => wrap(() => noteBillingStage(stageId, note)),
  skipStage: (stageId, reason) => wrap(() => skipBillingStage(stageId, reason)),
  reconciliation: (projectId, workOrderId) => wrap(() => getBillingReconciliation(projectId, workOrderId)),
  listReleases: (claimId) => wrap(() => listRetentionReleases(claimId)),
  scheduleRelease: (input) => wrap(() => scheduleRetentionRelease(input)),
  release: (releaseId, releasedOn, reference, documentId) => wrap(() => releaseRetention(releaseId, releasedOn, reference, documentId)),
  cancelRelease: (releaseId) => wrap(() => cancelRetentionRelease(releaseId)),
  listStepTemplates: () => wrap(() => listStepTemplates()),
  saveStepTemplate: (templateId, name, steps) => wrap(() => saveStepTemplate(templateId, name, steps)),
  archiveStepTemplate: (templateId) => wrap(() => archiveStepTemplate(templateId)),
  loadTemplateOntoProject: (projectId, templateId) => wrap(() => loadStepTemplateOntoProject(projectId, templateId)),
  loadTemplateOntoClaim: (claimId, templateId) => wrap(() => loadStepTemplateOntoClaim(claimId, templateId)),
  updateStep: (stageId, patch) => wrap(() => updateClaimStep(stageId, patch)),
  addStep: (claimId, afterPosition, step) => wrap(() => addClaimStep(claimId, afterPosition, step)),
  removeStep: (stageId, reason) => wrap(() => removeClaimStep(stageId, reason)),
  moveStep: (stageId, newPosition) => wrap(() => moveClaimStep(stageId, newPosition)),
  waitingSteps: () => wrap(() => getWaitingSteps()),
  overdueStepsByClaim: (projectId) => wrap(() => getOverdueStepsByClaim(projectId)),
};
