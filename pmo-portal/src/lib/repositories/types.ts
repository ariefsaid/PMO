import type { RecordHistoryRepository } from './recordHistory';
import type { OrgVendorTaxAccounts, ProjectClassificationOptions } from '@/src/lib/db/orgs';
import type { VendorTaxDefaultsInput } from '@/src/lib/vendorWithholding';
import type {
  BoqItemInput, BoqItemRow, ProgressAssessmentInput, ProgressClaimInput, ProgressClaimWithInvoice,
} from '@/src/lib/db/progressBilling';
import type { ProjectBillingFacts } from '@/src/lib/progressBilling';
import type { SpendApproverRow } from '@/src/lib/db/spendApprovers';
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
  SetProjectContractValueInput,
} from '@/src/lib/db/projects';
import type { OpportunityRow } from '@/src/lib/db/opportunity';
import type {
  WorkOrderRow,
  WorkOrderStatus,
  WorkOrderInput,
  WorkOrderPatch,
  SetWorkOrderValueInput,
  ProjectDrawdown,
} from '@/src/lib/db/workOrders';
import type { WorkOrderBillingRow, UnbilledWorkOrders } from '@/src/lib/db/workOrderBilling';
import type {
  ExpenseClaimWithRefs, ExpenseClaimLineRow, ExpenseClaimFilters, ExpenseClaimInput, ExpenseClaimPatch,
  ExpenseLineInput, ExpenseClaimStatus, ExpenseKind, ExpenseClaimRoute, ExpenseAdvanceAgingRow,
} from '@/src/lib/db/expenseClaims';
import type { ExpenseReceiptRow } from '@/src/lib/db/expenseReceipts';
import type { ExpenseAccountMapRow, ExpensePostingRow } from './expensePostings';
import type { TransitionProjectOpts, ProjectStatus } from '@/src/lib/db/projectTransitions';
import type { CompanyRow, CompanyType, CompanyInput } from '@/src/lib/db/companies';
import type {
  ProjectDocumentRow,
  ProjectDocumentInput,
  DocStatus,
} from '@/src/lib/db/documents';
import type { PreparedAgentAttachmentUpload } from '@/src/lib/db/agentAttachments';
import type { ActivateVersionResult } from '@/src/lib/db/budgets';
import type { ProfileRow } from '@/src/lib/db/profiles';
import type { UserRow, UserRole, InviteUserInput, SetUserStatusInput } from '@/src/lib/db/adminUsers';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type {
  ProcurementDetail,
  ProcurementStatus,
  ProcurementReceiptRow,
  ProcurementInvoiceRow,
  CreateInvoiceInput,
  TaxTreatment,
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
import type { ExpenseAccountKey } from '@/src/lib/adapterSeam/erpnext/expenseAccountRules';
import type {
  MeetingRow,
  MeetingWithRefs,
  ContactMeetingRef,
  MeetingInput,
  MeetingPatch,
  MeetingListParams,
  MeetingAttendeeRow,
  MeetingAttendeeWithRefs,
  MeetingAttendeeInput,
  MeetingGrantRow,
  MeetingGrantWithRefs,
} from '@/src/lib/db/meetings';
import type {
  TimesheetRow,
  TimesheetWithEntries,
} from '@/src/lib/db/timesheets';
import type {
  TimesheetApprovalViewerRole,
  TimesheetAwaitingApproval,
} from '@/src/lib/db/timesheetTransition';
import type { EntryUpsert } from '@/src/lib/timesheet-edit';
import type {
  BudgetVersionRow,
  BudgetVersionWithItems,
  BudgetLineItemRow,
  NewLineItem,
  ImportProvenance,
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
import type {
  SalesInvoiceRow,
  IncomingPaymentRow,
  RevenueByProjectRow,
} from '@/src/lib/db/revenue';
import type { ManagementPackFacts, ManagementPackRange, ProjectProgressInput } from '@/src/lib/db/managementPack';
import type { ProcPhase, ProcurementFileRow } from '@/src/lib/db/procurementFiles';
import type { ContactRow, ContactInput } from '@/src/lib/db/contacts';
import type { CrmActivityRow, CrmActivityInput, CrmActivityPatch } from '@/src/lib/db/crmActivities';
import type { UserViewRow, UserViewInput } from '@/src/lib/db/userViews';
import type { PageParams } from '@/src/lib/pagination';
import type { UsageSummaryRow, OperatorUsageSummaryRow, OperatorOrgRow, RunStatsRow, OperatorRunStatsRow } from '@/src/lib/db/usage';
import type { OrgFeatureKey } from '@/src/lib/features';
import type { ExternalDomainOwnershipRow } from '@/src/lib/db/externalDomainOwnership';
import type { ErpActualsSnapshotRow, ErpAgingSnapshotRow } from '@/src/lib/db/erpSnapshots';

/**
 * The identity of ONE user INTENT to write an externally-owned record (BLOCK 2, ADR-0058).
 *
 * `id` is the PMO record id the command mints; `idempotencyKey` is the outbox key. They are minted
 * TOGETHER, ONCE per form/mutation session (`newCommandIntent()`), and passed VERBATIM on every
 * attempt — so a human retry after a lost response ("external system unreachable — try again") lands
 * on the SAME outbox 4-tuple and is reconciled (the committed ERP doc is adopted) instead of opening a
 * fresh row and POSTing a SECOND money document. Omitting it keeps the legacy per-attempt minting,
 * which is safe only for a call site that never retries.
 */
export interface CommandIntent {
  id: string;
  idempotencyKey: string;
}

export interface ProjectRepository {
  list(
    params?: { status?: ProjectRow['status']; statuses?: ProjectRow['status'][]; pmId?: string } & PageParams,
  ): Promise<ProjectWithRefs[]>;
  get(id: string): Promise<OpportunityRow | null>;
  transition(id: string, to: ProjectStatus, opts?: TransitionProjectOpts): Promise<void>;
  /** Create a new opportunity (Leads / Internal Project only; org_id stamped by RLS). */
  create(input: CreateProjectInput): Promise<ProjectRow>;
  /** Update the project's header fields (name/code/client/end customer/PM/dates). */
  updateHeader(id: string, input: ProjectHeaderInput): Promise<void>;
  /** Soft-archive a project (stamps archived_at). */
  archive(id: string): Promise<void>;
  /** Hard-delete a project (Admin-only in the FE gate); rejects 23503 if referenced. */
  delete(id: string): Promise<void>;
  /**
   * Set contract_value through the SoD-scoped RPC (ADR-0019); rejects 42501 on SoD denial.
   *
   * #513: ONE object param, and `taxTreatment`/`taxAmount` are REQUIRED members of
   * `SetProjectContractValueInput` — mirroring 0197's P0001 gate, so a caller that omits either
   * fails to compile rather than failing at the RPC. Positional was no longer expressible:
   * TypeScript forbids a required parameter after an optional one.
   */
  setContractValue(input: SetProjectContractValueInput): Promise<void>;
  /** Reserve one editable PMO project-number proposal for the selected client. */
  proposeNumber(clientId: string): Promise<string>;
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
  /** Update only the PMO-local client-number segment; never dispatches to an external native adapter. */
  setProjectNumberSegment(id: string, segment: string | null): Promise<void>;
  /** #876 slice 2: set the vendor's default tax treatment (Admin/Finance; `set_vendor_tax_defaults`). */
  setTaxDefaults(id: string, input: VendorTaxDefaultsInput): Promise<void>;
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
  /** Tasks minuted out of one meeting (the /action seam, migration 0206). */
  listByMeeting(meetingId: string): Promise<TaskWithRefs[]>;
  /** A single task by id, or null when not found / not readable. */
  get(id: string): Promise<TaskWithRefs | null>;
  /** Create a task (org_id stamped by RLS, never sent). */
  create(input: TaskInput): Promise<TaskRow>;
  /** Update structure fields (name/assignee/dates/status) — managers. */
  update(id: string, patch: TaskPatch, projectId?: string): Promise<void>;
  /** Update ONLY the status column — the assignee (Engineer own-task) path. */
  updateStatus(id: string, status: TaskStatus, projectId?: string): Promise<void>;
  /** Hard-delete a task (cascades dependencies). */
  delete(id: string, projectId?: string): Promise<void>;
  /** PMO-owned reversible soft archive. */
  archive(id: string, projectId?: string): Promise<void>;
  /** PMO-owned reversible unarchive. */
  unarchive(id: string, projectId?: string): Promise<void>;
  /** Add a dependency edge (taskId depends on dependsOnId). */
  addDependency(taskId: string, dependsOnId: string): Promise<void>;
  /** Remove a dependency edge. */
  removeDependency(taskId: string, dependsOnId: string): Promise<void>;
}

/**
 * Meetings repository (#526, migrations 0205/0206). Reads are RLS-scoped to attendance ∪ author ∪
 * grant ∪ Admin (FR-MTG-031) — the repository never widens them. Grants are view-only, named
 * users (OD-MTG-2/FR-MTG-033).
 */
export interface MeetingRepository {
  /** Visible meetings, newest-first, capped; optional project filter + notes/title search. */
  list(params?: MeetingListParams): Promise<MeetingWithRefs[]>;
  /** Meetings a CONTACT attended, RLS-filtered to what the viewer may read (DD-MTG-6 timeline). */
  listForContact(contactId: string): Promise<ContactMeetingRef[]>;
  /** A single meeting by id, or null when not found / not readable (attendance-scoped). */
  get(id: string): Promise<MeetingWithRefs | null>;
  /** Create a meeting (org_id + created_by_id stamped server-side, never sent). */
  create(input: MeetingInput): Promise<MeetingRow>;
  /** Update header fields and/or the notes block array (author or Admin at RLS). */
  update(id: string, patch: MeetingPatch): Promise<void>;
  /** Soft-archive (stamps archived_at, ADR-0018). */
  archive(id: string): Promise<void>;
  /** Hard-delete (Admin-only at RLS); rejects 23503 while tasks reference the meeting. */
  delete(id: string): Promise<void>;
  /** A meeting's attendees with profile/contact identity. */
  listAttendees(meetingId: string): Promise<MeetingAttendeeWithRefs[]>;
  /** Add an attendee (exactly one of profile/contact/display_name — the table CHECK). */
  addAttendee(meetingId: string, identity: MeetingAttendeeInput): Promise<MeetingAttendeeRow>;
  /** Remove an attendee row. */
  removeAttendee(id: string): Promise<void>;
  /** A meeting's view grants (both profile embeds constraint-qualified). */
  listGrants(meetingId: string): Promise<MeetingGrantWithRefs[]>;
  /** Grant a named user view access (audit-logged server-side). */
  addGrant(meetingId: string, userId: string): Promise<MeetingGrantRow>;
  /** Revoke a grant (granter, author, or Admin; audit-logged server-side). */
  revokeGrant(id: string): Promise<void>;
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
    /** BLOCK 2: the per-INTENT command identity — pass the SAME value on every retry (see CommandIntent). */
    intent?: CommandIntent,
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
    /** BLOCK 2: the per-INTENT command identity — pass the SAME value on every retry (see CommandIntent). */
    intent?: CommandIntent,
  ): Promise<ProcurementReceiptRow>;
  /**
   * #505: a SINGLE object param, not the old positional list. `taxTreatment`/`taxAmount` are
   * REQUIRED members of `CreateInvoiceInput`, mirroring the NOT NULL columns 0196 added — a caller
   * that omits either fails to compile instead of failing at the RPC with P0001. Positional was no
   * longer expressible: TypeScript forbids a required parameter after an optional one.
   *
   * The supplier's `referenceNumber` and `invoiceDate` are forwarded to externally-owned invoices.
   * `amount` remains ERP-computed (`grand_total`, FR-ENA-115). Tax facts are ERP-owned on that path
   * and are not forwarded; the ERP's tax template determines them.
   */
  createInvoice(
    input: CreateInvoiceInput,
    /** BLOCK 2: the per-INTENT command identity — pass the SAME value on every retry (see CommandIntent). */
    intent?: CommandIntent,
  ): Promise<ProcurementInvoiceRow>;
  /** DD-EFK-1: edit the PMO-owned vendor e-Faktur facts through the guarded setter RPC. */
  setEfaktur(invoiceId: string, values: { efakturNumber: string | null; efakturDate: string | null }): Promise<void>;
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
    /** BLOCK 2: the per-INTENT command identity — pass the SAME value on every retry (see CommandIntent). */
    intent?: CommandIntent,
    /** #769: optional parent-group number (`external_ref`). PMO-owned path only — never forwarded to the ERP. */
    externalRef?: string | null,
  ): Promise<PurchaseRequestRow>;
  /** Create an RFQ record via RPC (mints RFQ#). */
  createRfq(
    procurementId: string,
    referenceNumber: string | null,
    status: string | null,
    date: string | null,
    amount: number | null,
    /** BLOCK 2: the per-INTENT command identity — pass the SAME value on every retry (see CommandIntent). */
    intent?: CommandIntent,
  ): Promise<RfqRow>;
  /** Create a purchase-order record via RPC (mints PO#). */
  createPurchaseOrder(
    procurementId: string,
    referenceNumber: string | null,
    status: string | null,
    date: string | null,
    amount: number | null,
    /** BLOCK 2: the per-INTENT command identity — pass the SAME value on every retry (see CommandIntent). */
    intent?: CommandIntent,
    /** #769: optional parent-group number (`external_ref`). PMO-owned path only — never forwarded to the ERP. */
    externalRef?: string | null,
  ): Promise<PurchaseOrderRow>;
  /** Create a payment record via RPC (mints PAY#). invoiceId is nullable (FR-PR-004b). */
  createPayment(
    procurementId: string,
    invoiceId: string | null,
    referenceNumber: string | null,
    status: string | null,
    date: string | null,
    amount: number | null,
    /** BLOCK 2: the per-INTENT command identity — pass the SAME value on every retry (see CommandIntent). */
    intent?: CommandIntent,
  ): Promise<PaymentRow>;
}

export interface RevenueRepository {
  /** Create a Sales Invoice (Draft) — mints a PMO id, dispatches when revenue is externally-owned. The number is null
   *  for a PMO Draft (#784 DD-NAR-9 mints it on approval). */
  createInvoice(input: {
    customerId: string;
    projectId?: string | null;
    items: Array<{ item_code: string; qty: number; rate: number; description?: string }>;
    /** OD-BILL-1: the work order this invoice bills ("Invoice this work order"). */
    workOrderId?: string | null;
  }, intent?: CommandIntent): Promise<{ id: string; si_number: string | null }>;
  /** Create an Incoming Payment — mints a PMO id, dispatches when revenue is externally-owned. The number is null for a
   *  PMO receipt (#784: the RPC returns only the id; the list read carries its PMO number). */
  createPayment(input: {
    customerId: string;
    salesInvoiceId?: string | null;
    paidAmount: number;
    receivedAmount?: number;
    withheldAmount?: number;
    withholdingSlipNumber?: string | null;
    date: string;
  }, intent?: CommandIntent): Promise<{ id: string; ip_number: string | null }>;
  /** #767: record/clear the date the client received the invoice (Admin/Finance, RPC-enforced). */
  setReceivedDate(siId: string, receivedDate: string | null): Promise<void>;
  /** DD-EFK-1: edit the PMO-owned sales e-Faktur facts through the guarded setter RPC. */
  setEfaktur(siId: string, values: { efakturNumber: string | null; efakturDate: string | null }): Promise<void>;
  /** Submit a Sales Invoice (docstatus 0→1) — SoD-gated at RPC layer (slice 3). */
  submitInvoice(siId: string, intent?: CommandIntent): Promise<void>;
  /** Cancel a Sales Invoice (docstatus 1→2) — mirrors ERP cancel. */
  cancelInvoice(siId: string, intent?: CommandIntent): Promise<void>;
  /** #912: the ERP's own print-format PDF of a SUBMITTED, ERP-owned invoice (Admin/Finance; the edge
   *  function `external-invoice-pdf` enforces role, tenancy and docstatus). */
  downloadInvoicePdf(siId: string): Promise<Blob>;
  /** Cancel an Incoming Payment (docstatus 1→2) — mirrors ERP cancel. */
  cancelPayment(ipId: string, intent?: CommandIntent): Promise<void>;
  /** List sales invoices in the caller's org (RLS scopes org). */
  listInvoices(params?: { projectId?: string; status?: SalesInvoiceRow['status']; nativeOnly?: boolean } & PageParams): Promise<SalesInvoiceRow[]>;
  /** Get a single sales invoice by id. */
  getInvoice(id: string): Promise<SalesInvoiceRow | null>;
  /** List incoming payments in the caller's org (RLS scopes org). */
  listPayments(params?: { customerId?: string } & PageParams): Promise<IncomingPaymentRow[]>;
  /** Get a single incoming payment by id. */
  getPayment(id: string): Promise<IncomingPaymentRow | null>;
  /** Revenue rollup per project — SUM(amount) grouped by project_id. */
  getRevenueByProject(): Promise<RevenueByProjectRow[]>;
}

export interface TimesheetRepository {
  list(userId: string, params?: PageParams): Promise<TimesheetWithEntries[]>;
  createDraft(weekStartDate: string, userId: string): Promise<TimesheetRow>;
  upsertEntries(entries: EntryUpsert[]): Promise<void>;
  deleteEntry(id: string): Promise<void>;
  submit(id: string): Promise<void>;
  approve(id: string, notes?: string): Promise<void>;
  reject(id: string, notes?: string): Promise<void>;
  listAwaitingApproval(
    selfId: string,
    viewerRole: TimesheetApprovalViewerRole | null,
  ): Promise<TimesheetAwaitingApproval[]>;
  /** P3b (FR-TSP-005/041): push an already-APPROVED sheet to the org's external system. A no-op when
   *  the org does not employ one for `timesheets` — never a rejection (the approval already committed). */
  pushApproved(timesheetId: string): Promise<void>;
}

export interface BudgetRepository {
  deriveProjectBudget(projectId: string): Promise<number>;
  listVersions(projectId: string): Promise<BudgetVersionWithItems[]>;
  createLineItem(
    versionId: string,
    item: NewLineItem,
    provenance?: ImportProvenance,
  ): Promise<BudgetLineItemRow>;
  updateLineItem(
    id: string,
    patch: Partial<Pick<BudgetLineItemRow, 'category' | 'description' | 'budgeted_amount' | 'actual_amount'>>,
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

/**
 * Work orders (#566) — the CLIENT's inbound PO drawing down against a project's committed ceiling.
 *
 * ⚑ The asymmetry is the contract, not an accident: `create` and `update` are table writes over
 * two DIFFERENT granted column lists, while the value+basis and every status move go through
 * security-definer RPCs. A future ERP-backed implementation must preserve the same split — folding
 * `setValue` into `update` would discard the witness the issue SoD reads.
 */
export interface WorkOrderRepository {
  list(projectId: string): Promise<WorkOrderRow[]>;
  get(id: string): Promise<WorkOrderRow | null>;
  create(projectId: string, input: WorkOrderInput): Promise<WorkOrderRow>;
  /** Body only — never the value or its tax basis (0197 §5(a) revoked those from the grant). */
  update(id: string, patch: WorkOrderPatch): Promise<void>;
  /** The value AND the basis that describes it, in one witnessed call. */
  setValue(input: SetWorkOrderValueInput): Promise<void>;
  /** Status moves; `overCommitAck` is sent only for an issue that actually exceeds the ceiling. */
  transition(id: string, to: WorkOrderStatus, opts?: { overCommitAck?: boolean }): Promise<void>;
  /** The derived drawdown, or null when the project is invisible/absent (never a fabricated zero). */
  drawdown(projectId: string): Promise<ProjectDrawdown | null>;
  /** OD-BILL-1: per-work-order billing for one project (view work_order_billing, RLS-scoped). */
  billing(projectId: string): Promise<WorkOrderBillingRow[]>;
  /** OD-BILL-1 / #786: what is still to invoice across the org's issued and closed work orders. */
  unbilled(limit: number): Promise<UnbilledWorkOrders>;
}

/** Progress billing (#766): BoQ, assessments (operational), billing claims + evidence, the summary. */
export interface ProgressBillingRepository {
  listBoq(projectId: string): Promise<BoqItemRow[]>;
  createBoq(projectId: string, input: BoqItemInput): Promise<BoqItemRow>;
  updateBoq(id: string, input: BoqItemInput): Promise<void>;
  deleteBoq(id: string): Promise<void>;
  /** Records the month's quantities done to date; returns the derived percent. Never reaches the ERP. */
  recordAssessment(input: ProgressAssessmentInput): Promise<number>;
  listClaims(projectId: string): Promise<ProgressClaimWithInvoice[]>;
  /** Returns the new claim id. The server computes gross and recovery. */
  createClaim(input: ProgressClaimInput): Promise<string>;
  attachEvidence(claimId: string, documentId: string): Promise<void>;
  withdrawClaim(id: string): Promise<void>;
  /** Raise the claim's ERP invoice; the claim id IS the invoice's PMO record id (ADR-0077). */
  raiseInvoice(claim: { claimId: string; projectId: string; customerId: string }, intent?: CommandIntent): Promise<{ id: string; si_number: string }>;
  /** Null when the project is invisible — never a zero summary. */
  summary(projectId: string): Promise<ProjectBillingFacts | null>;
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

/**
 * Expense claims and cash advances (#775, migration 0247). One-to-one with the DAL: header writes over granted
 * columns, lines as plain writes, every status move through the transition RPC, a cash return through its own
 * RPC — collapsing any pair would hide a control behind a convenience.
 */
export interface ExpenseClaimRepository {
  list(filters?: ExpenseClaimFilters): Promise<{ rows: ExpenseClaimWithRefs[]; truncated: boolean }>;
  get(id: string): Promise<ExpenseClaimWithRefs | null>;
  lines(claimId: string): Promise<ExpenseClaimLineRow[]>;
  create(input: ExpenseClaimInput): Promise<ExpenseClaimWithRefs>;
  update(id: string, kind: ExpenseKind, patch: ExpenseClaimPatch): Promise<void>;
  addLine(claimId: string, input: ExpenseLineInput): Promise<ExpenseClaimLineRow>;
  updateLine(id: string, input: ExpenseLineInput): Promise<void>;
  removeLine(id: string): Promise<void>;
  transition(id: string, to: ExpenseClaimStatus, opts?: { notes?: string | null; paymentReference?: string | null }): Promise<void>;
  recordReturn(id: string, amount: number, reference: string | null): Promise<void>;
  outstanding(advanceId: string): Promise<number | null>;
  routes(ids: string[]): Promise<ExpenseClaimRoute[]>;
  aging(): Promise<{ rows: ExpenseAdvanceAgingRow[]; truncated: boolean }>;
}

export interface ExpenseReceiptRepository {
  list(claimId: string): Promise<ExpenseReceiptRow[]>;
  prepareUpload(claimId: string, fileName: string): Promise<{ signedUrl: string; path: string }>;
  confirmUpload(claimId: string, path: string, title: string | null): Promise<ExpenseReceiptRow>;
  archive(id: string): Promise<void>;
  getSignedUrl(path: string, opts?: { download?: boolean }): Promise<string>;
  cleanupObject(path: string): Promise<void>;
}

/** #775 phase B — read-only views of the expense posting side mirror and the account map (RLS-scoped, 0270). */
export interface ExpensePostingRepository {
  /** What one claim posted to ERPNext (FR-EXP-117). */
  listForClaim(claimId: string): Promise<ExpensePostingRow[]>;
  /** The org's expense account map (FR-EXP-116). Writes go through `integrations.saveExpenseAccount`. */
  listAccountMap(): Promise<ExpenseAccountMapRow[]>;
}

/** #765 — the monthly management pack (ADR-0076). */
export interface ReportsRepository {
  /** Facts for the pack from ONE SECURITY INVOKER RPC; RLS scopes the org. */
  managementPack(range: ManagementPackRange): Promise<ManagementPackFacts>;
  /** Record a project's month-end percent complete (one entry per project per month). */
  recordProgress(input: ProjectProgressInput): Promise<void>;
}

/** The assembled set of repositories the FE/CRUD layer consumes (one per entity). */
export interface Repositories {
  recordHistory: RecordHistoryRepository;
  project: ProjectRepository;
  company: CompanyRepository;
  document: DocumentRepository;
  agentAttachment: AgentAttachmentRepository;
  profile: ProfileRepository;
  procurement: ProcurementRepository;
  revenue: RevenueRepository;
  timesheet: TimesheetRepository;
  budget: BudgetRepository;
  task: TaskRepository;
  incident: IncidentRepository;
  milestone: MilestoneRepository;
  workOrder: WorkOrderRepository;
  progressBilling: ProgressBillingRepository;
  procurementFiles: ProcurementFileRepository;
  expenseClaim: ExpenseClaimRepository;
  expenseReceipts: ExpenseReceiptRepository;
  expensePostings: ExpensePostingRepository;
  contact: ContactRepository;
  meeting: MeetingRepository;
  userView: UserViewRepository;
  operator: OperatorRepository;
  usage: UsageRepository;
  orgFeature: OrgFeatureRepository;
  orgSettings: OrgSettingsRepository;
  credits: CreditsRepository;
  externalDomainOwnership: ExternalDomainOwnershipRepository;
  erpSnapshots: ErpSnapshotsRepository;
  integrations: IntegrationsRepository;
  reports: ReportsRepository;
}

/**
 * Org accounting settings (`OD-TAX-1`, migration 0207). Read is own-org (RLS-scoped, every member
 * needs it to pre-select a form control); the write is Admin-only, enforced by an RLS policy plus a
 * column-scoped UPDATE grant so `default_tax_treatment` is the only column a client can move.
 *
 * ⛔ `getTaxDefault` returns a form-time hint and nothing else. It must never be consulted to
 * decide what a STORED figure means — see `src/lib/db/orgs.ts` for why that inference is
 * unrecoverable.
 */
export interface OrgSettingsRepository {
  /** The stored PMO project-number pattern; null is the system default. */
  getProjectNumberPattern(): Promise<string | null>;
  /** Admin-only: set the PMO project-number pattern; the system default normalizes to null. */
  setProjectNumberPattern(value: string | null): Promise<void>;
  getWithholdingAccount(): Promise<string | null>;
  setWithholdingAccount(account: string | null): Promise<void>;
  /** #876 slice 2: the ERPNext accounts a vendor bill's entered VAT / PPh post to (Admin writes). */
  getVendorTaxAccounts(): Promise<OrgVendorTaxAccounts>;
  setVendorTaxAccounts(input: OrgVendorTaxAccounts): Promise<void>;
  getDownPaymentItem(): Promise<string | null>;
  setDownPaymentItem(item: string | null): Promise<void>;
  getProjectClassificationOptions(): Promise<ProjectClassificationOptions>;
  setProjectClassificationOptions(options: ProjectClassificationOptions): Promise<void>;
  /** The org's pre-selection for a NEW row's tax treatment; null when it cannot be read. */
  getTaxDefault(): Promise<TaxTreatment | null>;
  /** Admin-only: change the org's pre-selection. Does not touch a single existing row. */
  setTaxDefault(value: TaxTreatment): Promise<void>;
  /** #803: the org's spend approvers (senior set + project approvers); every active member reads. */
  listSpendApprovers(): Promise<SpendApproverRow[]>;
  /** #803, Admin-only (RLS): name an approver — `projectId` null = the overhead/over-budget set. */
  addSpendApprover(profileId: string, projectId: string | null): Promise<void>;
  /** #803, Admin-only (RLS): remove one approver row. */
  removeSpendApprover(id: string): Promise<void>;
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
  config: Record<string, unknown>;
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

export interface ErpSetupReadiness {
  defaults: Record<string, string | null>;
  domains: string[];
  unmappedProjects: Array<{ id: string; name: string; code: string | null }>;
  budgetMappedCategories: string[];
  unlinkedEmployeeCount: number;
}
export interface ErpProjectOption { name: string; project_name: string; company: string; is_active: string }
export interface ErpProjectLink { ok: true; erpProject: string }
export interface IntegrationsRepository {
  getErpSetup(): Promise<ErpSetupReadiness>;
  saveErpDefaults(input: { activityType: string; receivableAccount: string }): Promise<{ ok: true }>;
  listErpProjects(query: string): Promise<ErpProjectOption[]>;
  linkErpProject(projectId: string, erpProject: string): Promise<ErpProjectLink>;
  ensureErpProject(projectId: string): Promise<ErpProjectLink>;
  employErpDomain(domain: string): Promise<{ ok: true }>;
  /** #775 phase B — save one key of the expense account map (validated against ERPNext server-side, FR-EXP-112). */
  saveExpenseAccount(input: { accountKey: ExpenseAccountKey; erpAccount: string }): Promise<{ ok: true }>;
  /** #775 phase B — remove one key of the expense account map. */
  clearExpenseAccount(accountKey: ExpenseAccountKey): Promise<{ ok: true }>;
  onboardErpParties(): Promise<{ ok: true }>;
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
  /** List ERPNext companies for the org (calls external-companies edge fn). */
  listCompanies(orgId: string, tier: ExternalTier): Promise<Array<{ name: string }>>;
  /** Current enabled items; org is resolved from the caller JWT at the endpoint. */
  listItems(purpose: 'sales' | 'purchase'): Promise<Array<{ code: string; name: string }>>;
  /** #520: the ERP company's enabled Purchase Taxes and Charges Templates (flipped-org vendor-invoice picker). */
  listPurchaseTaxTemplates(): Promise<Array<{ name: string }>>;
  /** Set ERPNext company on org binding (calls external-set-company edge fn). */
  setCompany(orgId: string, tier: ExternalTier, companyId: string): Promise<{ ok: true; companyId: string }>;
}
