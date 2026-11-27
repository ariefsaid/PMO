import type {
  OverContractRow, QcrApprovalState, QcrBudget, QcrDetail, QcrFile, QcrFileKind, QcrListFilter, QcrListRow, QcrRaiseInput, QcrRequest,
} from '@/src/lib/db/quantityChanges';
import type { QuantityVersion } from '@/src/lib/quantityChangeRules';

/** #2578 quantity change request seam (ADR-0017). Every write is a server function; org_id and the actor never leave the server. */
export interface QuantityChangeRepository {
  list(filter: QcrListFilter, page?: number): Promise<{ rows: QcrListRow[]; hasMore: boolean }>;
  get(id: string): Promise<QcrDetail | null>;
  overContract(projectId: string, onlyOver?: boolean): Promise<OverContractRow[]>;
  workOrderBudget(workOrderId: string): Promise<QcrBudget>;
  approvalState(requestId: string): Promise<QcrApprovalState>;
  versions(boqItemId: string): Promise<QuantityVersion[]>;
  raise(input: QcrRaiseInput): Promise<string>;
  updateDraft(id: string, lines: QcrRaiseInput['lines'] | null, note?: string | null): Promise<void>;
  submit(id: string): Promise<void>;
  approve(id: string): Promise<void>;
  returnRequest(id: string, reason: string): Promise<void>;
  withdraw(id: string, reason: string): Promise<void>;
  recordSent(id: string, sentDate: string, clientReference: string): Promise<void>;
  recordDecision(id: string, decision: 'accepted' | 'declined', decisionDate: string, note?: string | null): Promise<void>;
  recordForecast(boqItemId: string, quantity: string, note?: string | null): Promise<string>;
  getLimit(): Promise<number | null>;
  setLimit(limit: number | null): Promise<void>;
  getApproverRoles(): Promise<string[]>;
  setApproverRoles(roles: string[]): Promise<void>;
  uploadFile(request: Pick<QcrRequest, 'id' | 'org_id'>, kind: QcrFileKind, file: File, title?: string | null): Promise<void>;
  archiveFile(fileId: string): Promise<void>;
  fileUrl(path: string): Promise<string>;
}
export type { QcrFile };
