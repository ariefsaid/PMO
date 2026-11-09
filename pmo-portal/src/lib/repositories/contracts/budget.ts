/** Budget repository contract. */
import type { MicrosoftReferenceInput } from '@/src/lib/m365/reference';
import type { ActivateVersionResult, ArchiveVersionResult, BudgetImportRequest, BudgetDistributionPlan, BudgetModeSwitchAssignment, BudgetModeSwitchLineWitness, BudgetVersionMode } from '@/src/lib/db/budgets';
import type { BudgetActivationPrecheckResult } from '@/src/lib/budget/budgetGate';
import type {
  BudgetActivationMode,
  BudgetArchiveLiveTarget,
  BudgetArchiveTarget,
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
  /** #1462 — legacy (year-grained) live targets, read from the older mirror. */
  listLegacyArchiveLiveTargets(versionIds: readonly string[]): Promise<BudgetArchiveLiveTarget[]>;
  /** #1462 — the server's conservative inventory + eligibility for one version's archive decision. */
  listArchiveTargets(versionId: string): Promise<BudgetArchiveTarget[]>;
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
    /** #1472 FR-001: UI creation names `whole_project`; import names `per_year` explicitly, and
     *  other mode-less callers retain the column's `per_year` default. Never guess a mode. */
    budgetMode?: BudgetVersionMode,
  ): Promise<BudgetVersionRow>;
  /** #1472 S6A: one version's saved whole-project distribution, or `null` when none exists.
   *  All plan rows arrive in one deterministic, completely paged read (no per-cell requests). */
  getDistribution(versionId: string): Promise<BudgetDistributionPlan | null>;
  /** #1472 S6A: persists one snapshot atomically via `save_budget_distribution` (0577). Amounts are
   *  exact decimal strings; org scope is stamped server-side and is never a client argument. */
  saveDistribution(versionId: string, plan: BudgetDistributionPlan): Promise<void>;
  /** #1472 B2: atomically changes a Draft's mode after comparing its complete exact source witness. */
  switchDraftMode(
    versionId: string,
    targetMode: BudgetVersionMode,
    expectedLines: readonly BudgetModeSwitchLineWitness[],
    assignments: readonly BudgetModeSwitchAssignment[],
  ): Promise<void>;
  /** #495 import probes — see `src/lib/db/budgetImportSkip.ts` for why each is scoped as it is. */
  findImportTargetDraft(projectId: string): Promise<{ id: string } | null>;
  findImportedLine(versionId: string, importKey: string): Promise<{ id: string } | null>;
  cloneVersion(versionId: string): Promise<string>;
  /** Resolves on the PMO transition alone (`pushState: 'queued'`, ADR-0062); the ERP push runs in the
   *  background and `onPushSettled` fires when it ends so the caller re-reads the push status. */
  activateVersion(
    versionId: string,
    onPushSettled?: (pushState: Exclude<ActivateVersionResult['pushState'], 'queued'>) => void,
  ): Promise<ActivateVersionResult>;
  archiveVersion(versionId: string, cancelErp: boolean): Promise<ArchiveVersionResult>;
  deleteDraftVersion(versionId: string): Promise<void>;
  listDocumentLinks(versionId: string): Promise<BudgetDocumentLinkRow[]>;
  addDocumentLink(versionId: string, reference: MicrosoftReferenceInput): Promise<BudgetDocumentLinkRow>;
  removeDocumentLink(id: string): Promise<void>;
}
