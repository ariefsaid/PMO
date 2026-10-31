/** Budget repository contract. */
import type { MicrosoftReferenceInput } from '@/src/lib/m365/reference';
import type { ActivateVersionResult, ArchiveVersionResult, BudgetImportRequest } from '@/src/lib/db/budgets';
import type { BudgetActivationPrecheckResult } from '@/src/lib/budget/budgetGate';
import type {
  BudgetActivationMode,
  BudgetArchiveLiveTarget,
  BudgetVersionRow,
  BudgetVersionWithItems,
  BudgetDocumentLinkRow,
  BudgetLineItemRow,
  NewLineItem,
  ImportProvenance,
} from '@/src/lib/db/budgets';

export interface BudgetRepository {
  importLine(request: BudgetImportRequest): Promise<{ outcome: 'created' | 'skipped' | 'conflict'; line_id: string }>;
  deriveProjectBudget(projectId: string): Promise<number>;
  getActivationMode(versionId: string): Promise<BudgetActivationMode>;
  precheckActivation(versionId: string): Promise<BudgetActivationPrecheckResult>;
  listArchiveLiveTargets(versionIds: readonly string[]): Promise<BudgetArchiveLiveTarget[]>;
  listVersions(projectId: string): Promise<BudgetVersionWithItems[]>;
  createLineItem(
    versionId: string,
    item: NewLineItem,
    provenance?: ImportProvenance,
  ): Promise<BudgetLineItemRow>;
  updateLineItem(
    id: string,
    patch: Partial<Pick<BudgetLineItemRow, 'category' | 'description' | 'budgeted_amount' | 'actual_amount' | 'fiscal_year'>>,
  ): Promise<void>;
  deleteLineItem(id: string): Promise<void>;
  createVersion(
    projectId: string,
    name: string,
    provenance?: ImportProvenance,
  ): Promise<BudgetVersionRow>;
  /** #495 import probes — see `src/lib/db/budgetImportSkip.ts` for why each is scoped as it is. */
  findImportTargetDraft(projectId: string): Promise<{ id: string } | null>;
  findImportedLine(versionId: string, importKey: string): Promise<{ id: string } | null>;
  cloneVersion(versionId: string): Promise<string>;
  /** HIGH-C: returns the ERP push CONSEQUENCE (the PMO transition itself either succeeded or threw).
   *  Never `void` — a push that failed (or never reached the edge function) must be surfaced. */
  activateVersion(versionId: string): Promise<ActivateVersionResult>;
  archiveVersion(versionId: string, cancelErp: boolean): Promise<ArchiveVersionResult>;
  deleteDraftVersion(versionId: string): Promise<void>;
  listDocumentLinks(versionId: string): Promise<BudgetDocumentLinkRow[]>;
  addDocumentLink(versionId: string, reference: MicrosoftReferenceInput): Promise<BudgetDocumentLinkRow>;
  removeDocumentLink(id: string): Promise<void>;
}
