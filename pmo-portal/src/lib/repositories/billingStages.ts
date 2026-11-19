import {
  attachBillingStageDocument, cancelRetentionRelease, completeBillingStage, getBillingReconciliation, getBillingStageTemplate,
  getClaimBillingTrace, getProjectBillingTerms, listRetentionReleases, noteBillingStage, releaseRetention, scheduleRetentionRelease, setBillingStageTemplate,
  setProjectInvoiceDeadline, setProjectRetention,
} from '@/src/lib/db/billingStages';
import { wrap } from './repositoryErrors';
import type { BillingStagesRepository } from './contracts/billingStages';

/**
 * Measurement to invoice (#2522, #1572). Every rule that gates invoicing lives in the database (0960–0962); this seam only
 * carries what a person decides. Nothing here dispatches to an ERP: the claim's invoice is raised by progressBilling.
 */
export const billingStagesRepository: BillingStagesRepository = {
  getTemplate: (projectId) => wrap(() => getBillingStageTemplate(projectId)),
  setTemplate: (projectId, stages) => wrap(() => setBillingStageTemplate(projectId, stages)),
  getTerms: (projectId) => wrap(() => getProjectBillingTerms(projectId)),
  setInvoiceDeadline: (projectId, day, warnDays) => wrap(() => setProjectInvoiceDeadline(projectId, day, warnDays)),
  setRetention: (projectId, pct) => wrap(() => setProjectRetention(projectId, pct)),
  trace: (claimId, projectId) => wrap(() => getClaimBillingTrace(claimId, projectId)),
  attachDocument: (itemId, documentId) => wrap(() => attachBillingStageDocument(itemId, documentId)),
  completeStage: (input) => wrap(() => completeBillingStage(input)),
  noteStage: (stageId, note) => wrap(() => noteBillingStage(stageId, note)),
  reconciliation: (projectId, workOrderId) => wrap(() => getBillingReconciliation(projectId, workOrderId)),
  listReleases: (claimId) => wrap(() => listRetentionReleases(claimId)),
  scheduleRelease: (input) => wrap(() => scheduleRetentionRelease(input)),
  release: (releaseId, releasedOn, reference, documentId) => wrap(() => releaseRetention(releaseId, releasedOn, reference, documentId)),
  cancelRelease: (releaseId) => wrap(() => cancelRetentionRelease(releaseId)),
};
