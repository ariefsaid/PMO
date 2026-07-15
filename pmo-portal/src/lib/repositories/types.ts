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
import type { PreparedAgentAttachmentUpload } from '@/src/lib/db/agentAttachments';
import type { ProfileRow } from '@/src/lib/db/profiles';
import type { UserRow, UserRole, InviteUserInput, SetUserStatusInput } from '@/src/lib/db/adminUsers';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type {
  ProcurementDetail,
  ProcurementStatus,
  ProcurementReceiptRow,
  ProcurementInvoiceRow,
} from '@/src/lib/db/procurementLifecycle';
import type {
  PurchaseRequestRow,
  RfqRow,
  PurchaseOrderRow,
  PaymentRow,
} from '@/src/lib/db/procurementRecords';
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
  MilestoneDate,
} from '@/src/lib/db/milestones';
import type { ProcPhase, ProcurementFileRow } from '@/src/lib/db/procurementFiles';
import type { ContactRow, ContactInput } from '@/src/lib/db/contacts';
import type { CrmActivityRow, CrmActivityInput, CrmActivityPatch } from '@/src/lib/db/crmActivities';
import type { UserViewRow, UserViewInput } from '@/src/lib/db/userViews';
import type { PageParams } from '@/src/lib/pagination';
import type { UsageSummaryRow, OperatorUsageSummaryRow, OperatorOrgRow, RunStatsRow, OperatorRunStatsRow } from '@/src/lib/db/usage';
import type { OrgFeatureKey } from '@/src/lib/features';
import type { ExternalDomainOwnershipRow } from '@/src/lib/db/externalDomainOwnership';
import type { ErpActualsSnapshotRow, ErpAgingSnapshotRow } from '@/src/lib/db/erpSnapshots';

export interface ProjectRepository {
  list(
    params?: { status?: ProjectRow['status']; pmId?: string } & PageParams,
  ): Promise<ProjectWithRefs[]>;
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
  list(params?: { type?: CompanyType } & PageParams): Promise<CompanyRow[]>;
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
  /** Invite a new user via the admin-invite-user edge fn (Admin-in-org OR Operator). */
  inviteUser(input: InviteUserInput): Promise<void>;
  /** Disable/re-enable a user via the admin_set_user_status RPC (Admin-in-org OR Operator). */
  setUserStatus(input: SetUserStatusInput): Promise<void>;
}

export interface OperatorRepository {
  /** Clarity projection ONLY (ADR-0049) — every Operator power is re-asserted server-side. */
  isOperator(): Promise<boolean>;
}

export interface UsageRepository {
  /** The caller's own-org usage aggregate (org-Admin path). Aggregates ONLY — NFR-PRIV-001. */
  getOrgUsageSummary(): Promise<UsageSummaryRow[]>;
  /** The Operator's usage aggregate — all orgs when orgId is omitted, one org when supplied. */
  getOperatorUsageSummary(orgId?: string | null): Promise<OperatorUsageSummaryRow[]>;
  /** Directory columns ONLY (FR-OPR-004) — the Operator org-switcher source. */
  listOperatorOrgs(): Promise<OperatorOrgRow[]>;
  /** The caller's own-org per-run cost/latency stats (org-Admin path). Aggregates ONLY — NFR-PRIV-001. */
  getOrgAgentRunStats(): Promise<RunStatsRow[]>;
  /** The Operator's per-run cost/latency stats — all orgs when orgId is omitted, one org when supplied. */
  getOperatorAgentRunStats(orgId?: string | null): Promise<OperatorRunStatsRow[]>;
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

export interface AgentAttachmentRepository {
  /** Prepare a signed upload URL by creating the owner-private metadata row first. */
  prepareUpload(threadId: string, file: File): Promise<PreparedAgentAttachmentUpload>;
  /** Confirm a successfully uploaded object so the resolver can pick it up. */
  confirmUpload(attachmentId: string): Promise<void>;
  /** Best-effort object cleanup + metadata soft-archive. */
  cleanupObject(path: string): Promise<void>;
  /**
   * Create an agent thread for an attach-before-send upload (ADR-0017 seam — the hook
   * never imports the DAL directly). The thread is owner-private + org-scoped at rest
   * (RLS stamps org_id/owner_id via defaults; ADR-0001/0043).
   */
  createThread(title?: string): Promise<{ id: string }>;
}

export interface ProcurementRepository {
  list(params?: PageParams): Promise<ProcurementWithRefs[]>;
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
    // task FIX-1 (Discover CRITICAL 1): optional so pre-existing 3-arg call sites/tests keep their
    // exact byte-for-byte shape; the supplier reference number is only forwarded on the PMO-owned
    // direct-DAL path — when externally-owned it is mirrored FROM the ERP doc (FR-ENA-114), never
    // sent as part of the outbound create body.
    referenceNumber?: string | null,
  ): Promise<ProcurementReceiptRow>;
  createInvoice(
    procurementId: string,
    status: 'Received' | 'Scheduled' | 'Paid',
    invoiceDate: string,
    // task FIX-1 — same rationale as createReceipt's referenceNumber; `amount` is likewise
    // ERP-computed (`grand_total`) when externally-owned (FR-ENA-115), so it is never sent outbound.
    referenceNumber?: string | null,
    amount?: number | null,
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
  // ── New ERP-canonical record creators (Slice 5.4) ──
  /** Create a purchase-request record via RPC (mints PR#). referenceNumber bounded at form layer. */
  createPurchaseRequest(
    procurementId: string,
    referenceNumber: string | null,
    status: string | null,
    date: string | null,
    amount: number | null,
  ): Promise<PurchaseRequestRow>;
  /** Create an RFQ record via RPC (mints RFQ#). */
  createRfq(
    procurementId: string,
    referenceNumber: string | null,
    status: string | null,
    date: string | null,
    amount: number | null,
  ): Promise<RfqRow>;
  /** Create a purchase-order record via RPC (mints PO#). */
  createPurchaseOrder(
    procurementId: string,
    referenceNumber: string | null,
    status: string | null,
    date: string | null,
    amount: number | null,
  ): Promise<PurchaseOrderRow>;
  /** Create a payment record via RPC (mints PAY#). invoiceId is nullable (FR-PR-004b). */
  createPayment(
    procurementId: string,
    invoiceId: string | null,
    referenceNumber: string | null,
    status: string | null,
    date: string | null,
    amount: number | null,
  ): Promise<PaymentRow>;
}

export interface TimesheetRepository {
  list(userId: string, params?: PageParams): Promise<TimesheetWithEntries[]>;
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
  /** Dated milestones for a set of projects — the read-only calendar view (one batched read). */
  milestoneDatesForProjects: (ids: string[]) => Promise<MilestoneDate[]>;
  create: (input: MilestoneInput, projectId: string) => Promise<MilestoneRow>;
  update: (id: string, patch: MilestonePatch) => Promise<void>;
  delete: (id: string) => Promise<void>;
  setTaskMilestone: (taskId: string, milestoneId: string | null) => Promise<void>;
}

export interface ProcurementFileRepository {
  /** Non-archived files for a phase parent (quotation/receipt/invoice), newest first. */
  list(phase: ProcPhase, parentId: string): Promise<ProcurementFileRow[]>;
  /**
   * Prepare a signed upload URL + a minted file path (DAL validates the extension).
   * org_id is fetched server-side from the procurement row — never passed by the caller
   * (ADR-0017 seam; matches the documents.ts pattern).
   */
  prepareUpload(
    phase: ProcPhase,
    procurementId: string,
    fileName: string,
  ): Promise<{ signedUrl: string; path: string; fileId: string }>;
  /** Confirm an upload by inserting the child file row (org_id stamped by RLS). */
  confirmUpload(
    phase: ProcPhase,
    parentId: string,
    path: string,
    title: string | null,
    uploadedById: string | null,
  ): Promise<ProcurementFileRow>;
  /** Soft-archive a file (stamps archived_at; ADR-0018). */
  archive(phase: ProcPhase, id: string): Promise<void>;
  /** Generate a signed download URL for a file. `opts.download` forces attachment. */
  getSignedUrl(filePath: string, opts?: { download?: boolean }): Promise<string>;
  /** Delete a storage object (non-fatal orphan cleanup). */
  cleanupObject(filePath: string): Promise<void>;
}

export interface ContactRepository {
  /** All non-archived contacts in the org, ordered by name. */
  list(params?: PageParams): Promise<ContactRow[]>;
  /** A company's non-archived contacts (the company-detail list). */
  listByCompany(companyId: string): Promise<ContactRow[]>;
  /** A single contact by id, or null when not found / not readable. */
  get(id: string): Promise<ContactRow | null>;
  /** Create a contact (org_id stamped by RLS, never sent). */
  create(input: ContactInput): Promise<ContactRow>;
  /** Update a contact's fields. */
  update(id: string, input: ContactInput): Promise<void>;
  /** Soft-archive a contact (stamps archived_at). */
  archive(id: string): Promise<void>;
  /** Hard-delete a contact (Admin-only at the RLS layer); cascades its activities. */
  delete(id: string): Promise<void>;
  /** A contact's activities, newest-first by occurred_at. */
  listActivities(contactId: string): Promise<CrmActivityRow[]>;
  /** Batch-fetch activities for N contacts in one query (C3 N+1 fix), merged newest-first. */
  listActivitiesForContacts(contactIds: string[]): Promise<CrmActivityRow[]>;
  /** Log an activity (org_id trigger-stamped from the parent; logged_by from the caller). */
  createActivity(input: CrmActivityInput, loggedById: string | null): Promise<CrmActivityRow>;
  /** Update an activity's editable fields (kind/subject/body/occurred_at). */
  updateActivity(id: string, patch: CrmActivityPatch): Promise<void>;
  /** Hard-delete an activity by id (RLS gate: MASTER_DATA roles + org). */
  deleteActivity(id: string): Promise<void>;
}

export interface UserViewRepository {
  /** The caller's non-archived visible views (owner + shared_org in-org), newest write first. */
  list(): Promise<UserViewRow[]>;
  /** A single view by id, or null when not found / not readable (RLS-scoped out). */
  get(id: string): Promise<UserViewRow | null>;
  /** Create a view (org_id + user_id stamped by RLS, never sent; spec is opaque). */
  create(input: UserViewInput): Promise<UserViewRow>;
  /** Update a view's editable fields (owner or Admin at the RLS layer). */
  update(id: string, input: UserViewInput): Promise<void>;
  /** Soft-archive a view (stamps archived_at; ADR-0018). */
  archive(id: string): Promise<void>;
  /** Hard-delete a view (owner or Admin at the RLS layer). */
  delete(id: string): Promise<void>;
}

/** The assembled set of repositories the FE/CRUD layer consumes (one per entity). */
export interface Repositories {
  project: ProjectRepository;
  company: CompanyRepository;
  document: DocumentRepository;
  agentAttachment: AgentAttachmentRepository;
  profile: ProfileRepository;
  procurement: ProcurementRepository;
  timesheet: TimesheetRepository;
  budget: BudgetRepository;
  task: TaskRepository;
  incident: IncidentRepository;
  milestone: MilestoneRepository;
  procurementFiles: ProcurementFileRepository;
  contact: ContactRepository;
  userView: UserViewRepository;
  operator: OperatorRepository;
  usage: UsageRepository;
  orgFeature: OrgFeatureRepository;
  credits: CreditsRepository;
  externalDomainOwnership: ExternalDomainOwnershipRepository;
  erpSnapshots: ErpSnapshotsRepository;
  integrations: IntegrationsRepository;
}

/**
 * org_features repository (ops-admin-surface S6, FR-ENT-001..004). Read is own-org (RLS-scoped);
 * toggle is the Operator-only `operator_toggle_feature` RPC (rejects core keys with `P0001`).
 */
export interface OrgFeatureRepository {
  /** The caller's own-org feature rows projected into a map (absent keys = env default upstream). */
  listOwn(): Promise<Record<OrgFeatureKey, boolean>>;
  /** Upsert a feature row for an org via the Operator-only RPC. */
  toggle(args: { orgId: string; key: OrgFeatureKey; enabled: boolean }): Promise<void>;
}

/**
 * Credits repository (ops-admin-surface S6). Balance read is own-org via the security-definer
 * `org_credit_balance` RPC (FR-CRE-002); grant is the Operator-only `operator_grant_credits`
 * RPC (FR-CRE-005, rejects `amount <= 0` with errcode `23514`).
 */
export interface CreditsRepository {
  /** The org's credit-pool balance (grants − usage). */
  getOrgBalance(orgId: string): Promise<number>;
  /** Operator-only credit grant into the org pool. */
  grant(args: { orgId: string; amount: number; note: string }): Promise<void>;
}

/**
 * external_domain_ownership repository (ADR-0055 P0, FR-EAS-007, AC-EAS-015). READ ONLY by
 * design — the caller's own-org employed external tiers + externally-owned domains (the
 * read-only Integrations view source). No write method exists here: writes are Operator-only
 * via the `operator_set_domain_ownership` RPC, never a client-side repository writer.
 */
export interface ExternalDomainOwnershipRepository {
  listOwn(): Promise<ExternalDomainOwnershipRow[]>;
}

/** Read-only accounting snapshot surface (Slice 7, ADR-0048). RLS-scoped; no write path. */
export interface ErpSnapshotsRepository {
  actuals(): Promise<ErpActualsSnapshotRow[]>;
  apAging(): Promise<ErpAgingSnapshotRow[]>;
  arAging(): Promise<ErpAgingSnapshotRow[]>;
}

// ============================================================================
// INTEGRATIONS REPOSITORY (Phase 2, task 2.6)
// ============================================================================

/** Integration binding status from external_org_bindings. */
export type IntegrationStatus = 'active' | 'disconnected';

/** The tier of external system. */
export type ExternalTier = 'clickup' | 'erpnext';

/** Integration binding row (mirrors external_org_bindings). */
export interface IntegrationBinding {
  org_id: string;
  external_tier: ExternalTier;
  site_url: string;
  secret_ref: string;
  status: IntegrationStatus;
  connected_by: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
}

/** Credential payload for connect. */
export interface ConnectCredential {
  tier: ExternalTier;
  credential: {
    token?: string;           // ClickUp personal access token
    apiKey?: string;          // ERPNext API key
    apiSecret?: string;       // ERPNext API secret
    siteUrl?: string;         // ERPNext site URL
  };
}

/** Response from connect edge function. */
export interface ConnectResponse {
  ok: true;
  binding: {
    secret_ref: string;
    status: IntegrationStatus;
  };
}

/** Response from disconnect edge function. */
export interface DisconnectResponse {
  ok: true;
}

/** Integration health data (Phase 4). */
export interface IntegrationHealth {
  tier: ExternalTier;
  status: IntegrationStatus;
  connected_by: string | null;
  connected_at: string | null;
  last_sync: string | null;
  error_count: number;
}

// ============================================================================
// PROJECT LINK/UNLINK (Phase 3, tasks 3.2-3.4, 3.6)
// ============================================================================

/** Direction for ClickUp project link. */
export type LinkDirection = 'push-seed' | 'pull-adopt';

/** ClickUp list item (from external-lists edge fn). */
export interface ClickUpListItem {
  id: string;
  name: string;
  space_name: string;
  folder_name: string | null;
}

/** Request payload for linking a project to ClickUp. */
export interface LinkClickUpProjectInput {
  tier: 'clickup';
  projectId: string;
  listId: string;
  direction: LinkDirection;
}

/** Request payload for linking ERPNext org to a Company. */
export interface LinkErpNextOrgInput {
  tier: 'erpnext';
  companyId: string;
}

/** Union of link inputs. */
export type LinkInput = LinkClickUpProjectInput | LinkErpNextOrgInput;

/** Response from link edge function. */
export interface LinkResponse {
  ok: true;
  binding?: {
    id: string;
    direction?: LinkDirection;
    listId?: string;
  };
  companyId?: string;
}

/** Request payload for unlinking. */
export interface UnlinkInput {
  tier: ExternalTier;
  projectId?: string; // required for ClickUp, not used for ERPNext
}

/** Response from unlink edge function. */
export interface UnlinkResponse {
  ok: true;
}

/** Project binding row (mirrors external_project_bindings). */
export interface ProjectBinding {
  id: string;
  org_id: string;
  project_id: string;
  external_tier: ExternalTier;
  external_container_id: string;
  config: Record<string, unknown>;
  linked_by: string | null;
  linked_at: string | null;
  disconnected_at: string | null;
}

export interface IntegrationsRepository {
  /** Get the binding status for a specific tier. */
  getBinding(orgId: string, tier: ExternalTier): Promise<IntegrationBinding | null>;
  /** List all bindings for the org. */
  listBindings(orgId: string): Promise<IntegrationBinding[]>;
  /** Connect an org to an external tier (calls external-connect edge fn). */
  connectIntegration(orgId: string, credential: ConnectCredential): Promise<ConnectResponse>;
  /** Disconnect an org from an external tier (calls external-disconnect edge fn). */
  disconnectIntegration(orgId: string, tier: ExternalTier): Promise<DisconnectResponse>;
  /** Get health data for a tier (Phase 4). */
  getIntegrationHealth(orgId: string, tier: ExternalTier): Promise<IntegrationHealth>;
  /** List ClickUp lists for the org (calls external-lists edge fn). */
  listProjectLists(orgId: string): Promise<ClickUpListItem[]>;
  /** Link a project/org to external system (calls external-link edge fn). */
  linkProject(orgId: string, input: LinkInput): Promise<LinkResponse>;
  /** Unlink a project/org from external system (calls external-unlink edge fn). */
  unlinkProject(orgId: string, input: UnlinkInput): Promise<UnlinkResponse>;
  /** List project bindings for the org (reads external_project_bindings). */
  listProjectBindings(orgId: string): Promise<ProjectBinding[]>;
}
