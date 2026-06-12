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
import type {
  ProjectDocumentRow,
  ProjectDocumentInput,
  DocStatus,
} from '@/src/lib/db/documents';
import type { ProfileRow } from '@/src/lib/db/profiles';
import type { UserRow, UserRole } from '@/src/lib/db/adminUsers';
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
import type { TaskRow, TaskWithRefs, TaskInput, TaskPatch, TaskStatus } from '@/src/lib/db/tasks';
import type {
  IncidentRow,
  IncidentInput,
  IncidentStatus,
} from '@/src/lib/db/incidents';
import type {
  MilestoneRow,
  MilestoneWithProgress,
  MilestoneInput,
  MilestonePatch,
  ProjectDeliverySummary,
} from '@/src/lib/db/milestones';

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
  /** Hard-delete a project (Admin-only in the FE gate); rejects 23503 if referenced. */
  delete(id: string): Promise<void>;
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
  /** All profiles in the org — the Tasks assignee picker source. */
  listOrgProfiles(): Promise<ProfileRow[]>;
  /** All profiles in the caller's org — the Administration › Users directory + manager FK picker. */
  listUsers(): Promise<UserRow[]>;
  /** Change a user's role (Admin-only via profiles_admin_write RLS). */
  updateUserRole(id: string, role: UserRole): Promise<void>;
  /** Assign (or clear, with null) a user's line manager (Admin-only via profiles_admin_write RLS). */
  assignUserManager(id: string, managerId: string | null): Promise<void>;
}

export interface TaskRepository {
  /** Per-project tasks with assignee + dependency edges. */
  list(projectId: string): Promise<TaskWithRefs[]>;
  /** A single task by id, or null when not found / not readable. */
  get(id: string): Promise<TaskWithRefs | null>;
  /** Create a task (org_id stamped by RLS, never sent). */
  create(input: TaskInput): Promise<TaskRow>;
  /** Update structure fields (name/assignee/dates/status) — managers. */
  update(id: string, patch: TaskPatch): Promise<void>;
  /** Update ONLY the status column — the assignee (Engineer own-task) path. */
  updateStatus(id: string, status: TaskStatus): Promise<void>;
  /** Hard-delete a task (cascades dependencies). */
  delete(id: string): Promise<void>;
  /** Add a dependency edge (taskId depends on dependsOnId). */
  addDependency(taskId: string, dependsOnId: string): Promise<void>;
  /** Remove a dependency edge. */
  removeDependency(taskId: string, dependsOnId: string): Promise<void>;
}

export interface DocumentRepository {
  /** The per-project document register (metadata only; ordered by code). */
  list(projectId: string): Promise<ProjectDocumentRow[]>;
  /** A single document by id, or null when not found / not readable. */
  get(id: string): Promise<ProjectDocumentRow | null>;
  /** Create a register entry (org_id stamped by RLS; author_id stamped from the current user). */
  create(
    projectId: string,
    input: ProjectDocumentInput,
    authorId: string | null,
  ): Promise<ProjectDocumentRow>;
  /** Update a document's metadata (never status / author_id / org_id). */
  update(id: string, input: ProjectDocumentInput): Promise<void>;
  /** Move the document to the next workflow status (Draft→Issued→Approved/Rejected→Closed). */
  transition(id: string, status: DocStatus): Promise<void>;
  /** Hard-delete a document (Admin-only in the FE gate). */
  delete(id: string): Promise<void>;
  /** Prepare a signed upload URL for a Draft document (DAL fetches row internally). */
  prepareUpload(docId: string, fileName: string): Promise<{ signedUrl: string; path: string; oldPath: string | null }>;
  /** Confirm upload by updating file_path on the document row. */
  confirmUpload(docId: string, path: string): Promise<void>;
  /** Delete a storage object (non-fatal cleanup). */
  cleanupObject(filePath: string): Promise<void>;
  /** Generate a signed download URL for a document file. `opts.download` forces attachment (true download); omit for inline preview. */
  getSignedUrl(filePath: string, opts?: { download?: boolean }): Promise<string>;
  /** Create a revision (child) document row. */
  createRevision(
    parentId: string,
    input: Pick<ProjectDocumentInput, 'title' | 'code' | 'category' | 'revision' | 'doc_date'>,
    authorId: string | null,
  ): Promise<ProjectDocumentRow>;
  /** Get the child (successor) document for lineage display. */
  getChild(parentId: string): Promise<ProjectDocumentRow | null>;
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

export interface IncidentRepository {
  /** All incidents in the org (newest first), optionally filtered by workflow status. */
  list(params?: { status?: IncidentStatus }): Promise<IncidentRow[]>;
  /** A single incident by id, or null when not found / not readable. */
  get(id: string): Promise<IncidentRow | null>;
  /** File an incident — any member; org_id/status/reporter server-stamped, never sent. */
  create(input: IncidentInput): Promise<IncidentRow>;
  /** Update an incident's editable detail fields (managers only at the RLS layer). */
  update(id: string, input: IncidentInput): Promise<void>;
  /** Advance the workflow status (Open→Investigating→Closed); managers only (RLS). */
  transition(id: string, status: IncidentStatus): Promise<void>;
  /** Hard-delete an incident (Admin only). */
  delete(id: string): Promise<void>;
}

export interface MilestoneRepository {
  list: (projectId: string) => Promise<MilestoneWithProgress[]>;
  deliveryForProjects: (ids: string[]) => Promise<Record<string, number>>;
  deliverySummaryForProjects: (ids: string[]) => Promise<Record<string, ProjectDeliverySummary>>;
  create: (input: MilestoneInput, projectId: string) => Promise<MilestoneRow>;
  update: (id: string, patch: MilestonePatch) => Promise<void>;
  delete: (id: string) => Promise<void>;
  setTaskMilestone: (taskId: string, milestoneId: string | null) => Promise<void>;
}

/** The assembled set of repositories the FE/CRUD layer consumes (one per entity). */
export interface Repositories {
  project: ProjectRepository;
  company: CompanyRepository;
  document: DocumentRepository;
  profile: ProfileRepository;
  procurement: ProcurementRepository;
  timesheet: TimesheetRepository;
  budget: BudgetRepository;
  task: TaskRepository;
  incident: IncidentRepository;
  milestone: MilestoneRepository;
}
