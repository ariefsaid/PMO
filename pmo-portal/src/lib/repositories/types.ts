/**
 * Typed repository interfaces — the API seam (ADR-0017).
 *
 * One interface per entity, mirroring the *existing* DAL function signatures
 * (`pmo-portal/src/lib/db/*`). These interfaces are the backend-agnostic contract the
 * FE/CRUD layer consumes: today the only implementation is the Supabase DAL (assembled
 * in `./index`); a future ERP/REST backend is a new implementation behind the same
 * interface with ZERO FE change. All methods reject with `AppError` (code preserved) on failure.
 *
 * NOTE (additive seam): existing hooks keep importing the DAL directly — this seam is
 * consumed only by new CRUD code. No signature here diverges from its DAL counterpart;
 * the repository is a thin wrapper that normalizes the thrown error type.
 */
import type {
  ProjectRow,
  ProjectWithRefs,
  CreateProjectInput,
  ProjectHeaderInput,
} from '@/src/lib/db/projects';
import type { OpportunityRow } from '@/src/lib/db/opportunity';
import type { TransitionProjectOpts, ProjectStatus } from '@/src/lib/db/projectTransitions';
import type { CompanyRow, CompanyType, CompanyInput } from '@/src/lib/db/companies';
import type { ProfileRow } from '@/src/lib/db/profiles';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type {
  ProcurementDetail,
  ProcurementStatus,
  ProcurementReceiptRow,
  ProcurementInvoiceRow,
} from '@/src/lib/db/procurementLifecycle';
import type {
  NewProcurementInput,
  ProcurementHeaderPatch,
  ProcurementItemInput,
  ProcurementItemPatch,
  ProcurementItemRow,
  ProcurementDocumentInput,
  ProcurementDocumentRow,
} from '@/src/lib/db/procurementCrud';
import type { Tables } from '@/src/lib/supabase/database.types';
import type {
  TimesheetRow,
  TimesheetWithEntries,
} from '@/src/lib/db/timesheets';
import type { TimesheetAwaitingApproval } from '@/src/lib/db/timesheetTransition';
import type { EntryUpsert } from '@/src/lib/timesheet-edit';
import type {
  BudgetVersionRow,
  BudgetVersionWithItems,
  BudgetLineItemRow,
  NewLineItem,
} from '@/src/lib/db/budgets';

export interface ProjectRepository {
  list(params?: { status?: ProjectRow['status']; pmId?: string }): Promise<ProjectWithRefs[]>;
  get(id: string): Promise<OpportunityRow | null>;
  transition(id: string, to: ProjectStatus, opts?: TransitionProjectOpts): Promise<void>;
  /** Create a new opportunity (Leads / Internal Project only; org_id stamped by RLS). */
  create(input: CreateProjectInput): Promise<ProjectRow>;
  /** Update the project's header fields (name/code/client/PM/dates). */
  updateHeader(id: string, input: ProjectHeaderInput): Promise<void>;
  /** Soft-archive a project (stamps archived_at). */
  archive(id: string): Promise<void>;
  /** Set contract_value through the SoD-scoped RPC (ADR-0019); rejects 42501 on SoD denial. */
  setContractValue(id: string, value: number): Promise<void>;
}

export interface CompanyRepository {
  /** Client companies only — the FK picker for project/opportunity clients. */
  listClients(): Promise<CompanyRow[]>;
  /** All companies in the org (archived hidden by default), optionally filtered by type. */
  list(params?: { type?: CompanyType }): Promise<CompanyRow[]>;
  /** A single company by id, or null when not found / not readable. */
  get(id: string): Promise<CompanyRow | null>;
  /** Create a company (org_id stamped by RLS, never sent). */
  create(input: CompanyInput): Promise<CompanyRow>;
  /** Update a company's name + type. */
  update(id: string, input: CompanyInput): Promise<void>;
  /** Soft-archive a company (stamps archived_at). */
  archive(id: string): Promise<void>;
  /** Hard-delete a company; rejects with AppError code 23503 if referenced. */
  delete(id: string): Promise<void>;
}

export interface ProfileRepository {
  listProjectManagers(): Promise<ProfileRow[]>;
}

export interface ProcurementRepository {
  list(): Promise<ProcurementWithRefs[]>;
  get(id: string): Promise<ProcurementDetail>;
  transition(id: string, to: ProcurementStatus, notes?: string): Promise<void>;
  createQuotation(
    procurementId: string,
    vendorId: string,
    totalAmount: number,
    receivedDate: string,
  ): Promise<Tables<'procurement_quotations'>>;
  createReceipt(
    procurementId: string,
    status: 'Partial' | 'Complete',
    receiptDate: string,
  ): Promise<ProcurementReceiptRow>;
  createInvoice(
    procurementId: string,
    status: 'Received' | 'Scheduled' | 'Paid',
    invoiceDate: string,
  ): Promise<ProcurementInvoiceRow>;
  // ── CRUD slice (editing paths) ──
  /** Raise a new PR (Draft); requester stamped from the caller's identity. */
  create(input: NewProcurementInput, requestedById: string): Promise<Tables<'procurements'>>;
  /** Edit the PR header (requester while Draft/Rejected; RLS is the authority). */
  updateHeader(id: string, patch: ProcurementHeaderPatch): Promise<void>;
  /** Add a line item (Draft-gated by RLS). */
  createItem(procurementId: string, input: ProcurementItemInput): Promise<ProcurementItemRow>;
  /** Edit a line item (Draft-gated by RLS). */
  updateItem(id: string, patch: ProcurementItemPatch): Promise<void>;
  /** Remove a line item (Draft-gated by RLS). */
  deleteItem(id: string): Promise<void>;
  /** Select a quotation (sets is_selected + syncs header + advances stage; RPC). */
  selectQuote(quotationId: string): Promise<void>;
  /** List the document-metadata register for a PR. */
  listDocuments(procurementId: string): Promise<ProcurementDocumentRow[]>;
  /** Add a document-metadata row (file upload deferred). */
  createDocument(
    procurementId: string,
    input: ProcurementDocumentInput,
  ): Promise<ProcurementDocumentRow>;
  /** Remove a document-metadata row. */
  deleteDocument(id: string): Promise<void>;
}

export interface TimesheetRepository {
  list(userId: string): Promise<TimesheetWithEntries[]>;
  createDraft(weekStartDate: string, userId: string): Promise<TimesheetRow>;
  upsertEntries(entries: EntryUpsert[]): Promise<void>;
  deleteEntry(id: string): Promise<void>;
  submit(id: string): Promise<void>;
  approve(id: string, notes?: string): Promise<void>;
  reject(id: string, notes?: string): Promise<void>;
  listAwaitingApproval(selfId: string): Promise<TimesheetAwaitingApproval[]>;
}

export interface BudgetRepository {
  deriveProjectBudget(projectId: string): Promise<number>;
  listVersions(projectId: string): Promise<BudgetVersionWithItems[]>;
  createLineItem(versionId: string, item: NewLineItem): Promise<BudgetLineItemRow>;
  updateLineItem(
    id: string,
    patch: Partial<Pick<BudgetLineItemRow, 'category' | 'description' | 'budgeted_amount' | 'actual_amount'>>,
  ): Promise<void>;
  deleteLineItem(id: string): Promise<void>;
  createVersion(projectId: string, name: string): Promise<BudgetVersionRow>;
  cloneVersion(versionId: string): Promise<string>;
  activateVersion(versionId: string): Promise<void>;
  archiveVersion(versionId: string): Promise<void>;
  deleteDraftVersion(versionId: string): Promise<void>;
}

/** The assembled set of repositories the FE/CRUD layer consumes (one per entity). */
export interface Repositories {
  project: ProjectRepository;
  company: CompanyRepository;
  profile: ProfileRepository;
  procurement: ProcurementRepository;
  timesheet: TimesheetRepository;
  budget: BudgetRepository;
}
