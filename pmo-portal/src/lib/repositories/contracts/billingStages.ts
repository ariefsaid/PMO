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

import type { BoardWorkOrderStep, WaitingWorkOrderStep, WorkOrderStep } from '@/src/lib/db/workOrderBillingSteps';
import type { BillingBoardResult } from '@/src/lib/db/billingBoard';
import type { PlanCandidatesResult, PlanSettings, UnacceptedProgressResult } from '@/src/lib/db/billingPlan';

export interface BillingStagesRepository {
  /** #2681: the billing board's rows (a read-only view over the claims' own steps). */
  readBoard(projectId: string | null): Promise<BillingBoardResult>;
  /** #2682: accepted-not-yet-claimed candidates for the monthly billing plan (read only; never raises a claim). */
  readPlanCandidates(projectId: string | null): Promise<PlanCandidatesResult>;
  readUnacceptedProgress(projectId: string | null): Promise<UnacceptedProgressResult>;
  /** #2682: the plan's target, its currency, the month overrides and the done-not-claimed reminder switch (off by default). */
  getPlanSettings(): Promise<PlanSettings>;
  savePlanSettings(input: { monthlyTarget: number | null; targetCurrency: string | null; reminderOn: boolean }): Promise<void>;
  /** #2675: the done-not-claimed reminder switch and its day limit (null = none). Admin/Finance, DB enforced. */
  savePlanReminder(input: { reminderOn: boolean; afterDays: number | null }): Promise<void>;
  saveMonthTarget(month: string, target: number | null): Promise<void>;
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
  /** A work order's billing step list (advisory; migrations 1770-1774). */
  workOrderSteps(workOrderId: string): Promise<WorkOrderStep[]>;
  boardWorkOrderSteps(projectId?: string): Promise<BoardWorkOrderStep[]>;
  waitingWorkOrderSteps(): Promise<WaitingWorkOrderStep[]>;
  completeWorkOrderStep(stepId: string, doneOn: string): Promise<void>;
  skipWorkOrderStep(stepId: string, reason: string): Promise<void>;
  assignWorkOrderStep(stepId: string, personId: string | null): Promise<void>;
  setWorkOrderStepClaimEvidence(stepId: string, enabled: boolean): Promise<void>;
  /** Adds a step to one work order's own checklist after the given position (null = database-resolved end); migration 2181. */
  addWorkOrderStep(workOrderId: string, afterPosition: number | null, step: StepInput): Promise<string>;
  saveWorkOrderChecklistAsTemplate(workOrderId: string, name: string): Promise<string>;
  workOrderChecklistEnabled(): Promise<boolean>;
  setWorkOrderChecklistEnabled(enabled: boolean): Promise<void>;
  attachWorkOrderStepDocument(stepId: string, slotId: string | null, documentId: string): Promise<void>;
  defaultStepTemplateId(): Promise<string | null>;
  setDefaultStepTemplate(templateId: string | null): Promise<void>;
}
