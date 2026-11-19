/** Measurement to invoice (#2522, #1572): billing stages, per-item reconciliation, retention. Operational only — never dispatches. */
import type {
  ClaimBillingTrace,
  CompleteStageInput,
  ReconciliationRow,
  RetentionReleaseInput,
  RetentionReleaseRow,
  StageTemplateInput,
} from '@/src/lib/db/billingStages';

export interface BillingStagesRepository {
  getTemplate(projectId: string): Promise<StageTemplateInput[]>;
  setTemplate(projectId: string, stages: StageTemplateInput[]): Promise<number>;
  setInvoiceDeadline(projectId: string, day: number | null, warnDays: number): Promise<void>;
  setRetention(projectId: string, pct: number): Promise<void>;
  trace(claimId: string, projectId: string): Promise<ClaimBillingTrace>;
  attachDocument(itemId: string, documentId: string): Promise<void>;
  completeStage(input: CompleteStageInput): Promise<void>;
  noteStage(stageId: string, note: string): Promise<void>;
  reconciliation(projectId: string, workOrderId: string | null): Promise<ReconciliationRow[]>;
  listReleases(claimId: string): Promise<RetentionReleaseRow[]>;
  scheduleRelease(input: RetentionReleaseInput): Promise<string>;
  release(releaseId: string, releasedOn: string, reference: string | null, documentId: string | null): Promise<void>;
  cancelRelease(releaseId: string): Promise<void>;
}
