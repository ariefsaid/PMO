/** Measurement to invoice (#2522, #1572): billing stages, per-item reconciliation, retention. Operational only — never dispatches. */
import type {
  ClaimBillingTrace,
  ProjectBillingTerms,
  CompleteStageInput,
  ReconciliationRow,
  RetentionReleaseInput,
  RetentionReleaseRow,
  StageTemplateInput,
} from '@/src/lib/db/billingStages';
import type { OverdueClaimStep, StepInput, StepPatch, StepTemplate, WaitingStep } from '@/src/lib/db/billingSteps';

import type { BillingBoardResult } from '@/src/lib/db/billingBoard';

export interface BillingStagesRepository {
  /** #2681: the billing board's rows (a read-only view over the claims' own steps). */
  readBoard(projectId: string | null): Promise<BillingBoardResult>;
  getTemplate(projectId: string): Promise<StageTemplateInput[]>;
  setTemplate(projectId: string, stages: StageTemplateInput[]): Promise<number>;
  setTerms(projectId: string, stages: StageTemplateInput[], day: number | null, warnDays: number, pct: number): Promise<void>;
  getTerms(projectId: string): Promise<ProjectBillingTerms | null>;
  setInvoiceDeadline(projectId: string, day: number | null, warnDays: number): Promise<void>;
  setRetention(projectId: string, pct: number): Promise<void>;
  trace(claimId: string, projectId: string): Promise<ClaimBillingTrace>;
  attachDocument(itemId: string, documentId: string): Promise<void>;
  completeStage(input: CompleteStageInput): Promise<void>;
  noteStage(stageId: string, note: string): Promise<void>;
  skipStage(stageId: string, reason: string): Promise<void>;
  reconciliation(projectId: string, workOrderId: string | null): Promise<ReconciliationRow[]>;
  listReleases(claimId: string): Promise<RetentionReleaseRow[]>;
  scheduleRelease(input: RetentionReleaseInput): Promise<string>;
  release(releaseId: string, releasedOn: string, reference: string | null, documentId: string | null): Promise<void>;
  cancelRelease(releaseId: string): Promise<void>;
  // Per-claim billing steps and templates (#2680)
  listStepTemplates(): Promise<StepTemplate[]>;
  saveStepTemplate(templateId: string | null, name: string, steps: StepInput[]): Promise<string>;
  archiveStepTemplate(templateId: string): Promise<void>;
  loadTemplateOntoProject(projectId: string, templateId: string): Promise<number>;
  loadTemplateOntoClaim(claimId: string, templateId: string): Promise<number>;
  updateStep(stageId: string, patch: StepPatch): Promise<void>;
  addStep(claimId: string, afterPosition: number, step: StepInput): Promise<string>;
  removeStep(stageId: string, reason: string): Promise<void>;
  moveStep(stageId: string, newPosition: number): Promise<void>;
  waitingSteps(): Promise<WaitingStep[]>;
  overdueStepsByClaim(projectId: string): Promise<OverdueClaimStep[]>;
}
