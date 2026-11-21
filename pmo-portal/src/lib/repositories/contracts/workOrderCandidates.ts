import type {
  CandidateInput, ChecklistTemplateItem, DecisionResult, ItemPatch, TemplateItemInput, WorkOrderCandidate,
} from '@/src/lib/db/workOrderCandidates';

/** #2595 candidate work order seam (ADR-0017). Create, decide and the template are server RPCs; org_id never leaves the server. */
export interface WorkOrderCandidateRepository {
  list(projectId: string): Promise<WorkOrderCandidate[]>;
  listTemplate(): Promise<ChecklistTemplateItem[]>;
  saveTemplate(items: TemplateItemInput[]): Promise<number>;
  create(input: CandidateInput): Promise<string>;
  decide(candidateId: string, decision: 'accepted' | 'rejected', reason: string): Promise<DecisionResult>;
  updateItem(itemId: string, patch: ItemPatch): Promise<void>;
  addItem(candidateId: string, label: string, required: boolean): Promise<void>;
  uploadProof(candidate: Pick<WorkOrderCandidate, 'id' | 'org_id'>, itemId: string, file: File): Promise<void>;
  archiveProof(proofId: string): Promise<void>;
  proofUrl(path: string): Promise<string>;
}
