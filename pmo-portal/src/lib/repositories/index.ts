/**
 * Supabase implementation of the repository interfaces — the API seam (ADR-0017).
 *
 * Assembles the `repositories` object whose methods are *thin wrappers* delegating to the
 * existing `pmo-portal/src/lib/db/*` DAL functions. Each wrapper normalizes any thrown value
 * to a shared `AppError` (preserving the Postgres/PostgREST `code`), so consumers catch a
 * single, code-bearing error type regardless of backend. New CRUD code imports `repositories`;
 * existing hooks continue to import the DAL directly (this seam is additive and low-risk).
 *
 * A future ERP/REST backend = a new module exporting the same `Repositories` shape; the FE
 * imports `repositories` and never changes.
 */
import { toAppError, AppError } from '@/src/lib/appError';
import { supabase } from '@/src/lib/supabase/client';
import {
  type IntegrationsRepository,
  type IntegrationBinding,
  type ConnectCredential,
  type ConnectResponse,
  type DisconnectResponse,
  type IntegrationHealth,
  type ExternalTier,
  type ClickUpListItem,
  type LinkInput,
  type LinkResponse,
  type UnlinkInput,
  type UnlinkResponse,
  type ProjectBinding,
} from './types';
import {
  listProjects,
  createProject,
  updateProjectHeader,
  archiveProject,
  deleteProject,
  setProjectContractValue,
} from '@/src/lib/db/projects';
import { getOpportunity } from '@/src/lib/db/opportunity';
import { transitionProject } from '@/src/lib/db/projectTransitions';
import {
  listClientCompanies,
  listCompanies,
  getCompany,
  createCompany,
  updateCompany,
  archiveCompany,
  deleteCompany,
  type CompanyRow,
  type CompanyType,
} from '@/src/lib/db/companies';
import {
  listProjectDocuments,
  getProjectDocument,
  createProjectDocument,
  updateProjectDocument,
  transitionProjectDocument,
  deleteProjectDocument,
  prepareUpload,
  confirmUpload,
  cleanupStorageObject,
  getSignedDownloadUrl,
  createDocumentRevision,
  getChildDocument,
} from '@/src/lib/db/documents';
import {
  prepareAgentAttachmentFileUpload,
  confirmAgentAttachmentUpload,
  cleanupAgentAttachmentObject,
} from '@/src/lib/db/agentAttachments';
import { createAgentThread } from '@/src/lib/db/agentThreads';
import { listProjectManagers, listOrgProfiles } from '@/src/lib/db/profiles';
import { listUsers, updateUserRole, assignUserManager, inviteUser, setUserStatus } from '@/src/lib/db/adminUsers';
import { isOperator } from '@/src/lib/db/operators';
import {
  getOrgUsageSummary,
  getOperatorUsageSummary,
  listOperatorOrgs,
  getOrgAgentRunStats,
  getOperatorAgentRunStats,
} from '@/src/lib/db/usage';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';
// P3b FR-TSP-041 — the ONE derivation of the timesheet push's deterministic key, shared with the Deno
// sweep backstop (see the re-export below for why it cannot be defined in this module).
import { timesheetPushKey } from '@/src/lib/adapterSeam/erpnext/timesheetPushKey';
import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  updateTaskStatus,
  deleteTask,
  archiveTask,
  unarchiveTask,
  addDependency,
  removeDependency,
} from '@/src/lib/db/tasks';
import { listProcurements } from '@/src/lib/db/procurements';
import {
  createPurchaseRequest,
  createRfq,
  createPurchaseOrder,
  createPayment,
  type PurchaseRequestRow,
  type RfqRow,
  type PurchaseOrderRow,
  type PaymentRow,
} from '@/src/lib/db/procurementRecords';
import {
  getProcurementDetail,
  transitionProcurement,
  createQuotation,
  createReceipt,
  createInvoice,
  type ProcurementReceiptRow,
  type ProcurementInvoiceRow,
} from '@/src/lib/db/procurementLifecycle';
import type { Tables } from '@/src/lib/supabase/database.types';
import {
  createProcurement,
  updateProcurementHeader,
  createProcurementItem,
  updateProcurementItem,
  deleteProcurementItem,
  selectProcurementQuote,
  listProcurementDocuments,
  createProcurementDocument,
  deleteProcurementDocument,
} from '@/src/lib/db/procurementCrud';
import {
  listTimesheets,
  createDraftTimesheet,
  upsertTimesheetEntries,
  deleteTimesheetEntry,
} from '@/src/lib/db/timesheets';
import {
  submitTimesheet,
  approveTimesheet,
  rejectTimesheet,
  listTimesheetsAwaitingApproval,
} from '@/src/lib/db/timesheetTransition';
import { approvedTimesheetForPush } from '@/src/lib/db/timesheetPush';
import {
  deriveProjectBudget,
  listBudgetVersions,
  createLineItem,
  updateLineItem,
  deleteLineItem,
  createBudgetVersion,
  cloneVersion,
  activateVersion,
  archiveVersion,
  deleteDraftVersion,
} from '@/src/lib/db/budgets';
import {
  listIncidents,
  getIncident,
  createIncident,
  updateIncident,
  transitionIncident,
  deleteIncident,
} from '@/src/lib/db/incidents';
import {
  listMilestones,
  getProjectsDelivery,
  getProjectsDeliverySummary,
  getProjectsMilestoneDates,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  updateTaskMilestone,
} from '@/src/lib/db/milestones';
import {
  listProcurementFiles,
  prepareUpload as prepareProcurementFileUpload,
  confirmUpload as confirmProcurementFileUpload,
  archiveProcurementFile,
  getSignedDownloadUrl as getProcurementFileSignedUrl,
  cleanupStorageObject as cleanupProcurementFileObject,
} from '@/src/lib/db/procurementFiles';
import {
  listContacts,
  listContactsByCompany,
  getContact,
  createContact,
  updateContact,
  archiveContact,
  deleteContact,
} from '@/src/lib/db/contacts';
import { listActivities, listActivitiesForContacts, createActivity, updateActivity, deleteActivity } from '@/src/lib/db/crmActivities';
import {
  listUserViews,
  getUserView,
  createUserView,
  updateUserView,
  archiveUserView,
  deleteUserView,
} from '@/src/lib/db/userViews';
import {
  listOwnOrgFeatures,
  toggleOrgFeature,
  getOrgCreditBalance,
  grantOrgCredits,
} from '@/src/lib/db/orgFeatures';
import { listOwnExternalDomainOwnership } from '@/src/lib/db/externalDomainOwnership';
import { listActualsSnapshot, listApAgingSnapshot, listArAgingSnapshot } from '@/src/lib/db/erpSnapshots';
import {
  listSalesInvoices,
  getSalesInvoice,
  listIncomingPayments,
  getIncomingPayment,
  getRevenueByProject,
  submitSalesInvoiceSod,
} from '@/src/lib/db/revenue';
import type {
  CommandIntent,
  Repositories,
  ProjectRepository,
  CompanyRepository,
  DocumentRepository,
  AgentAttachmentRepository,
  ProfileRepository,
  ProcurementRepository,
  RevenueRepository,
  TimesheetRepository,
  BudgetRepository,
  TaskRepository,
  IncidentRepository,
  MilestoneRepository,
  ProcurementFileRepository,
  ContactRepository,
  UserViewRepository,
  OperatorRepository,
  UsageRepository,
  OrgFeatureRepository,
  CreditsRepository,
  ExternalDomainOwnershipRepository,
  ErpSnapshotsRepository,
} from './types';

/** Runs a DAL call and rethrows any failure as a normalized `AppError` (code preserved). */
async function wrap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toAppError(err);
  }
}

const project: ProjectRepository = {
  list: (params) => wrap(() => listProjects(params)),
  get: (id) => wrap(() => getOpportunity(id)),
  transition: (id, to, opts) => wrap(() => transitionProject(id, to, opts)),
  create: (input) => wrap(() => createProject(input)),
  updateHeader: (id, input) => wrap(() => updateProjectHeader(id, input)),
  archive: (id) => wrap(() => archiveProject(id)),
  delete: (id) => wrap(() => deleteProject(id)),
  setContractValue: (id, value) => wrap(() => setProjectContractValue(id, value)),
};

// BLOCK 2 (MONEY-CRITICAL): `newCommandIntent()` lives in ./commandIntent (a leaf module) and is
// re-exported here so the public seam is unchanged — see that file for the full rationale.
export { newCommandIntent } from './commandIntent';
import { newCommandIntent } from './commandIntent';

/** The identity of a `create` command: the caller's intent, or a fresh per-attempt one (legacy default). */
const identityFor = (intent?: CommandIntent): CommandIntent => intent ?? newCommandIntent();

/** The dispatch options bag of a `transition` command — the record id is the EXISTING record, so only
 *  the idempotency key comes from the intent (a retry of the same click reuses it verbatim). */
const keyFor = (intent?: CommandIntent) => ({ idempotencyKey: intent?.idempotencyKey ?? crypto.randomUUID() });

/** Dispatch a `create` under ONE command identity — the caller's intent when supplied, else a fresh
 *  per-attempt one. The record id and the idempotency key come from the SAME identity, so they cannot
 *  drift apart (the 4-tuple is what the outbox de-duplicates on). */
const dispatchCreate = (
  domain: string,
  record: Record<string, unknown>,
  intent: CommandIntent | undefined,
): ReturnType<typeof dispatchDomainCommand> => {
  const identity = identityFor(intent);
  // `id` is written LAST so the intent's id is authoritative — a record that happens to carry its own
  // `id` can never silently decouple the PMO record id from the idempotency key it is paired with.
  return dispatchDomainCommand(domain, 'create', { ...record, id: identity.id }, { idempotencyKey: identity.idempotencyKey });
};

// task 3.8 (finding-3 path fix, FR-ENA-090/091): the ERP party kind is DERIVED from the company's
// own type — Vendor->'supplier', Client->'customer'. 'Internal' is never ERP-flipped (it is PMO's
// own org marker, FR-ENA-090/091) — no `erp_doc_kind` exists for it in DOCTYPE_REGISTRY, so an
// Internal-type write ALWAYS takes the direct DAL path regardless of the org's companies routing.
function erpPartyDocKind(type: CompanyType): 'supplier' | 'customer' | null {
  if (type === 'Vendor') return 'supplier';
  if (type === 'Client') return 'customer';
  return null;
}

const company: CompanyRepository = {
  listClients: () => wrap(() => listClientCompanies()),
  list: (params) => wrap(() => listCompanies(params)),
  get: (id) => wrap(() => getCompany(id)),
  create: (input) => {
    const kind = erpPartyDocKind(input.type);
    return routeDomainWrite('companies') === 'external' && kind
      ? dispatchCreate('companies', { ...input, erp_doc_kind: kind }, undefined)
          .then((res) => res.canonical as unknown as CompanyRow)
      : wrap(() => createCompany(input));
  },
  update: (id, input) => {
    const kind = erpPartyDocKind(input.type);
    return routeDomainWrite('companies') === 'external' && kind
      ? dispatchDomainCommand(
          'companies',
          'update',
          { id, ...input, erp_doc_kind: kind },
          keyFor(),
        ).then(() => undefined)
      : wrap(() => updateCompany(id, input));
  },
  archive: (id) => wrap(() => archiveCompany(id)),
  delete: (id) => wrap(() => deleteCompany(id)),
};

const document: DocumentRepository = {
  list: (projectId) => wrap(() => listProjectDocuments(projectId)),
  get: (id) => wrap(() => getProjectDocument(id)),
  create: (projectId, input, authorId) =>
    wrap(() => createProjectDocument(projectId, input, authorId)),
  update: (id, input) => wrap(() => updateProjectDocument(id, input)),
  transition: (id, status) => wrap(() => transitionProjectDocument(id, status)),
  delete: (id) => wrap(() => deleteProjectDocument(id)),
  prepareUpload: (docId, fileName) => wrap(() => prepareUpload(docId, fileName)),
  confirmUpload: (docId, path) => wrap(() => confirmUpload(docId, path)),
  cleanupObject: (filePath) => wrap(() => cleanupStorageObject(filePath)),
  getSignedUrl: (filePath, opts) => wrap(() => getSignedDownloadUrl(filePath, opts)),
  createRevision: (parentId, input, authorId) =>
    wrap(() => createDocumentRevision(parentId, input, authorId)),
  getChild: (parentId) => wrap(() => getChildDocument(parentId)),
};

const agentAttachment: AgentAttachmentRepository = {
  prepareUpload: (threadId, file) => wrap(() => prepareAgentAttachmentFileUpload(threadId, file)),
  confirmUpload: (attachmentId) => wrap(() => confirmAgentAttachmentUpload(attachmentId)),
  cleanupObject: (path) => wrap(() => cleanupAgentAttachmentObject(path)),
  createThread: (title) => wrap(() => createAgentThread(title)),
};

const profile: ProfileRepository = {
  listProjectManagers: () => wrap(() => listProjectManagers()),
  listOrgProfiles: () => wrap(() => listOrgProfiles()),
  listUsers: () => wrap(() => listUsers()),
  updateUserRole: (id, role) => wrap(() => updateUserRole(id, role)),
  assignUserManager: (id, managerId) => wrap(() => assignUserManager(id, managerId)),
  inviteUser: (input) => wrap(() => inviteUser(input)),
  setUserStatus: (input) => wrap(() => setUserStatus(input)),
};

const operator: OperatorRepository = {
  isOperator: () => wrap(() => isOperator()),
};

const usage: UsageRepository = {
  getOrgUsageSummary: () => wrap(() => getOrgUsageSummary()),
  getOperatorUsageSummary: (orgId) => wrap(() => getOperatorUsageSummary(orgId)),
  listOperatorOrgs: () => wrap(() => listOperatorOrgs()),
  getOrgAgentRunStats: () => wrap(() => getOrgAgentRunStats()),
  getOperatorAgentRunStats: (orgId) => wrap(() => getOperatorAgentRunStats(orgId)),
};

const task: TaskRepository = {
  list: (projectId) => wrap(() => listTasks(projectId)),
  get: (id) => wrap(() => getTask(id)),
  create: (input) => wrap(() => createTask(input)),
  update: (id, patch, projectId) =>
    wrap(() => (projectId === undefined ? updateTask(id, patch) : updateTask(id, patch, projectId))),
  updateStatus: (id, status, projectId) =>
    wrap(() => (projectId === undefined ? updateTaskStatus(id, status) : updateTaskStatus(id, status, projectId))),
  delete: (id, projectId) => wrap(() => (projectId === undefined ? deleteTask(id) : deleteTask(id, projectId))),
  archive: (id, projectId) => wrap(() => (projectId === undefined ? archiveTask(id) : archiveTask(id, projectId))),
  unarchive: (id, projectId) =>
    wrap(() => (projectId === undefined ? unarchiveTask(id) : unarchiveTask(id, projectId))),
  addDependency: (taskId, dependsOnId) => wrap(() => addDependency(taskId, dependsOnId)),
  removeDependency: (taskId, dependsOnId) => wrap(() => removeDependency(taskId, dependsOnId)),
};

const procurement: ProcurementRepository = {
  list: (params) => wrap(() => listProcurements(params)),
  get: (id) => wrap(() => getProcurementDetail(id)),
  // Task 4.9 (finding-3 path fix): the case-AGGREGATE status transition is PMO-derived, never an ERP
  // command (`to` is a PMO `ProcurementStatus` like 'Approved' — the erpnext adapter has no concept of
  // it, FR-ENA-101/073). This ALWAYS stays on the direct DAL path, even when `procurement` is
  // externally-owned — unlike every other method below, it carries no routeDomainWrite guard at all.
  transition: (id, to, notes) => wrap(() => transitionProcurement(id, to, notes)),
  createQuotation: (procurementId, vendorId, totalAmount, receivedDate, intent) =>
    routeDomainWrite('procurement') === 'external'
      ? dispatchCreate(
          'procurement',
          { procurementId, vendorId, totalAmount, receivedDate, erp_doc_kind: 'quotation' },
          intent,
        ).then((res) => res.canonical as unknown as Tables<'procurement_quotations'>)
      : wrap(() => createQuotation(procurementId, vendorId, totalAmount, receivedDate)),
  // task FIX-1: referenceNumber is a PMO-direct-DAL-only param (see types.ts) — appended to the DAL
  // call ONLY when the caller actually supplied one, so a bare 3-arg call keeps its exact pre-existing
  // shape (index.test.ts's byte-for-byte assertion). Never forwarded on the external-dispatch payload
  // (FR-ENA-114 — it is mirrored back from the ERP doc, not client-supplied at creation).
  createReceipt: (procurementId, status, receiptDate, referenceNumber, intent) =>
    routeDomainWrite('procurement') === 'external'
      ? dispatchCreate(
          'procurement',
          { procurementId, status, receiptDate, erp_doc_kind: 'goods-receipt' },
          intent,
        ).then((res) => res.canonical as unknown as ProcurementReceiptRow)
      : wrap(() =>
          referenceNumber !== undefined
            ? createReceipt(procurementId, status, receiptDate, referenceNumber)
            : createReceipt(procurementId, status, receiptDate),
        ),
  createInvoice: (procurementId, status, invoiceDate, referenceNumber, amount, intent) =>
    routeDomainWrite('procurement') === 'external'
      ? dispatchCreate(
          'procurement',
          { procurementId, status, invoiceDate, erp_doc_kind: 'purchase-invoice' },
          intent,
        ).then((res) => res.canonical as unknown as ProcurementInvoiceRow)
      : wrap(() =>
          referenceNumber !== undefined || amount !== undefined
            ? createInvoice(procurementId, status, invoiceDate, referenceNumber, amount)
            : createInvoice(procurementId, status, invoiceDate),
        ),
  create: (input, requestedById) => wrap(() => createProcurement(input, requestedById)),
  updateHeader: (id, patch) => wrap(() => updateProcurementHeader(id, patch)),
  createItem: (procurementId, input) => wrap(() => createProcurementItem(procurementId, input)),
  updateItem: (id, patch) => wrap(() => updateProcurementItem(id, patch)),
  deleteItem: (id) => wrap(() => deleteProcurementItem(id)),
  selectQuote: (quotationId) => wrap(() => selectProcurementQuote(quotationId)),
  listDocuments: (procurementId) => wrap(() => listProcurementDocuments(procurementId)),
  createDocument: (procurementId, input) =>
    wrap(() => createProcurementDocument(procurementId, input)),
  deleteDocument: (id) => wrap(() => deleteProcurementDocument(id)),
  // ── New ERP-canonical record creators (Slice 5.4; P2 routes them per-domain, task 1.10) ──
  createPurchaseRequest: (procurementId, referenceNumber, status, date, amount, intent) =>
    routeDomainWrite('procurement') === 'external'
      ? dispatchCreate(
          'procurement',
          { procurementId, referenceNumber, status, date, amount, erp_doc_kind: 'purchase-request' },
          intent,
        ).then((res) => res.canonical as unknown as PurchaseRequestRow)
      : wrap(() => createPurchaseRequest(procurementId, referenceNumber, status, date, amount)),
  createRfq: (procurementId, referenceNumber, status, date, amount, intent) =>
    routeDomainWrite('procurement') === 'external'
      ? dispatchCreate(
          'procurement',
          { procurementId, referenceNumber, status, date, amount, erp_doc_kind: 'rfq' },
          intent,
        ).then((res) => res.canonical as unknown as RfqRow)
      : wrap(() => createRfq(procurementId, referenceNumber, status, date, amount)),
  createPurchaseOrder: (procurementId, referenceNumber, status, date, amount, intent) =>
    routeDomainWrite('procurement') === 'external'
      ? dispatchCreate(
          'procurement',
          { procurementId, referenceNumber, status, date, amount, erp_doc_kind: 'purchase-order' },
          intent,
        ).then((res) => res.canonical as unknown as PurchaseOrderRow)
      : wrap(() => createPurchaseOrder(procurementId, referenceNumber, status, date, amount)),
  createPayment: (procurementId, invoiceId, referenceNumber, status, date, amount, intent) =>
    routeDomainWrite('procurement') === 'external'
      ? dispatchCreate(
          'procurement',
          { procurementId, invoiceId, referenceNumber, status, date, amount, erp_doc_kind: 'payment' },
          intent,
        ).then((res) => res.canonical as unknown as PaymentRow)
      : wrap(() => createPayment(procurementId, invoiceId, referenceNumber, status, date, amount)),
};

const revenue: RevenueRepository = {
  // Read methods (ADR-0017)
  listInvoices: (params) => wrap(() => listSalesInvoices(params)),
  getInvoice: (id) => wrap(() => getSalesInvoice(id)),
  listPayments: (params) => wrap(() => listIncomingPayments(params)),
  getPayment: (id) => wrap(() => getIncomingPayment(id)),
  getRevenueByProject: () => wrap(() => getRevenueByProject()),
  // Write methods — route through dispatch when externally-owned
  createInvoice: (input, intent) =>
    routeDomainWrite('revenue') === 'external'
      ? dispatchCreate('revenue', { ...input, erp_doc_kind: 'sales-invoice' }, intent)
          .then((res) => ({ id: String(res.canonical.id), si_number: String(res.canonical.si_number ?? '') }))
      : Promise.reject(new AppError('revenue is not enabled for this org', 'revenue-not-enabled')),
  createPayment: (input, intent) =>
    routeDomainWrite('revenue') === 'external'
      ? dispatchCreate(
          'revenue',
          // Luna BLOCK 5 (MONEY-CRITICAL): map the camelCase input to the snake_case command record the
          // dispatch/body (peReceiveToBody reads paid_amount/received_amount/references) AND the recovery
          // composite-probe payload all read. references[] is resolved downstream by resolveRevenueRefs
          // (the resolved SI ERP name + allocated_amount) — the repo only knows the PMO salesInvoiceId.
          {
            erp_doc_kind: 'incoming-payment',
            customerId: input.customerId,
            salesInvoiceId: input.salesInvoiceId ?? null,
            paid_amount: input.paidAmount,
            received_amount: input.receivedAmount ?? input.paidAmount,
            date: input.date,
          },
          intent,
        ).then((res) => ({ id: String(res.canonical.id), ip_number: String(res.canonical.ip_number ?? '') }))
      : Promise.reject(new AppError('revenue is not enabled for this org', 'revenue-not-enabled')),
  submitInvoice: (siId, intent) =>
    wrap(async () => {
      if (routeDomainWrite('revenue') === 'external') {
        await submitSalesInvoiceSod(siId);   // SoD: server-enforced approver≠author (42501 on self-approval) BEFORE any ERP submit
        const si = await getSalesInvoice(siId);
        if (!si || !si.si_number) throw new AppError('sales invoice not found or missing si_number', 'not-found');
        await dispatchDomainCommand(
          'revenue',
          'transition',
          { id: siId, erp_doc_kind: 'sales-invoice', verb: 'submit', externalRecordId: si.si_number },
          keyFor(intent),
        );
      } else {
        throw new AppError('revenue is not enabled for this org', 'revenue-not-enabled');
      }
    }),
  cancelInvoice: (siId, intent) =>
    routeDomainWrite('revenue') === 'external'
      ? wrap(async () => {
          const si = await getSalesInvoice(siId);
          if (!si || !si.si_number) throw new AppError('sales invoice not found or missing si_number', 'not-found');
          await dispatchDomainCommand(
            'revenue',
            'transition',
            { id: siId, erp_doc_kind: 'sales-invoice', verb: 'cancel', externalRecordId: si.si_number },
            keyFor(intent),
          );
        })
      : Promise.reject(new AppError('revenue is not enabled for this org', 'revenue-not-enabled')),
  cancelPayment: (ipId, intent) =>
    routeDomainWrite('revenue') === 'external'
      ? wrap(async () => {
          const ip = await getIncomingPayment(ipId);
          if (!ip || !ip.ip_number) throw new AppError('incoming payment not found or missing ip_number', 'not-found');
          await dispatchDomainCommand(
            'revenue',
            'transition',
            { id: ipId, erp_doc_kind: 'incoming-payment', verb: 'cancel', externalRecordId: ip.ip_number },
            keyFor(intent),
          );
        })
      : Promise.reject(new AppError('revenue is not enabled for this org', 'revenue-not-enabled')),
};

/**
 * P3b (FR-TSP-041, ADR-0059 §4): the timesheet push key is DETERMINISTIC, not `freshIdempotencyKey()`.
 *
 * ⚑ The derivation MOVED to `@/src/lib/adapterSeam/erpnext/timesheetPushKey` and is re-exported here so
 * existing consumers keep resolving. It could not stay in this module: the push's SECOND originator is
 * the Deno sweep backstop, and this file is a client module (38 imports, including the browser Supabase
 * singleton) that no edge function can load — which would have forced the sweep to RE-IMPLEMENT the key.
 * Two derivations drift, the outbox 4-tuple then fails to collide for what is really one command, and the
 * client is billed a DUPLICATED WEEK of hours. See that module's header for the full reasoning.
 */
export { timesheetPushKey };

const timesheet: TimesheetRepository = {
  list: (userId, params) => wrap(() => listTimesheets(userId, params)),
  createDraft: (weekStartDate, userId) => wrap(() => createDraftTimesheet(weekStartDate, userId)),
  upsertEntries: (entries) => wrap(() => upsertTimesheetEntries(entries)),
  deleteEntry: (id) => wrap(() => deleteTimesheetEntry(id)),
  submit: (id) => wrap(() => submitTimesheet(id)),
  approve: (id, notes) => wrap(() => approveTimesheet(id, notes)),
  reject: (id, notes) => wrap(() => rejectTimesheet(id, notes)),
  listAwaitingApproval: (selfId) => wrap(() => listTimesheetsAwaitingApproval(selfId)),
  // P3b (FR-TSP-005/006/041) — push an ALREADY-APPROVED sheet to the external system. Called AFTER
  // `transition_timesheet` has committed, never inside it: the approval must never depend on external
  // liveness (ADR-0059 §3.2), so a rejection here surfaces as durable push state, never as a failed
  // approval.
  pushApproved: (timesheetId) =>
    wrap(async () => {
      // FR-TSP-005: a cold/absent ownership map ⇒ 'pmo' ⇒ a benign NO-OP. Deliberately NOT a rejection
      // (contrast `revenue`'s `revenue-not-enabled`): `timesheets` is a shipped PMO feature and the
      // approval has already succeeded — rejecting here would break approval for every existing client.
      if (routeDomainWrite('timesheets') !== 'external') return;
      // The gate RPC is server truth for status + authorization + the entries (FR-TSP-010/011); the
      // client asserts nothing. It throws 42501/P0001 before a command is ever built, and the edge
      // function re-reads it under the caller's JWT before any ERP call.
      const gate = await approvedTimesheetForPush(timesheetId);
      await dispatchDomainCommand(
        'timesheets',
        'create',
        {
          id: timesheetId,
          erp_doc_kind: 'timesheet',
          user_id: gate.user_id,
          approved_at: gate.approved_at,
          entries: gate.entries,
        },
        { idempotencyKey: timesheetPushKey(timesheetId, gate.approved_at) },
      );
    }),
};

const budget: BudgetRepository = {
  deriveProjectBudget: (projectId) => wrap(() => deriveProjectBudget(projectId)),
  listVersions: (projectId) => wrap(() => listBudgetVersions(projectId)),
  createLineItem: (versionId, item) => wrap(() => createLineItem(versionId, item)),
  updateLineItem: (id, patch) => wrap(() => updateLineItem(id, patch)),
  deleteLineItem: (id) => wrap(() => deleteLineItem(id)),
  createVersion: (projectId, name) => wrap(() => createBudgetVersion(projectId, name)),
  cloneVersion: (versionId) => wrap(() => cloneVersion(versionId)),
  activateVersion: (versionId) => wrap(() => activateVersion(versionId)),
  archiveVersion: (versionId) => wrap(() => archiveVersion(versionId)),
  deleteDraftVersion: (versionId) => wrap(() => deleteDraftVersion(versionId)),
};

const incident: IncidentRepository = {
  list: (params) => wrap(() => listIncidents(params)),
  get: (id) => wrap(() => getIncident(id)),
  create: (input) => wrap(() => createIncident(input)),
  update: (id, input) => wrap(() => updateIncident(id, input)),
  transition: (id, status) => wrap(() => transitionIncident(id, status)),
  delete: (id) => wrap(() => deleteIncident(id)),
};

const milestone: MilestoneRepository = {
  list: (projectId) => wrap(() => listMilestones(projectId)),
  deliveryForProjects: (ids) => wrap(() => getProjectsDelivery(ids)),
  deliverySummaryForProjects: (ids) => wrap(() => getProjectsDeliverySummary(ids)),
  milestoneDatesForProjects: (ids) => wrap(() => getProjectsMilestoneDates(ids)),
  create: (input, projectId) => wrap(() => createMilestone(input, projectId)),
  update: (id, patch) => wrap(() => updateMilestone(id, patch)),
  delete: (id) => wrap(() => deleteMilestone(id)),
  setTaskMilestone: (taskId, milestoneId) => wrap(() => updateTaskMilestone(taskId, milestoneId)),
};

const procurementFiles: ProcurementFileRepository = {
  list: (phase, parentId) => wrap(() => listProcurementFiles(phase, parentId)),
  prepareUpload: (phase, procurementId, fileName) =>
    wrap(() => prepareProcurementFileUpload(phase, procurementId, fileName)),
  confirmUpload: (phase, parentId, path, title, uploadedById) =>
    wrap(() => confirmProcurementFileUpload(phase, parentId, path, title, uploadedById)),
  archive: (phase, id) => wrap(() => archiveProcurementFile(phase, id)),
  getSignedUrl: (filePath, opts) => wrap(() => getProcurementFileSignedUrl(filePath, opts)),
  cleanupObject: (filePath) => wrap(() => cleanupProcurementFileObject(filePath)),
};

const contact: ContactRepository = {
  list: (params) => wrap(() => listContacts(params)),
  listByCompany: (id) => wrap(() => listContactsByCompany(id)),
  get: (id) => wrap(() => getContact(id)),
  create: (input) => wrap(() => createContact(input)),
  update: (id, input) => wrap(() => updateContact(id, input)),
  archive: (id) => wrap(() => archiveContact(id)),
  delete: (id) => wrap(() => deleteContact(id)),
  listActivities: (id) => wrap(() => listActivities(id)),
  listActivitiesForContacts: (ids) => wrap(() => listActivitiesForContacts(ids)),
  createActivity: (input, loggedById) => wrap(() => createActivity(input, loggedById)),
  updateActivity: (id, patch) => wrap(() => updateActivity(id, patch)),
  deleteActivity: (id) => wrap(() => deleteActivity(id)),
};

const userView: UserViewRepository = {
  list: () => wrap(() => listUserViews()),
  get: (id) => wrap(() => getUserView(id)),
  create: (input) => wrap(() => createUserView(input)),
  update: (id, input) => wrap(() => updateUserView(id, input)),
  archive: (id) => wrap(() => archiveUserView(id)),
  delete: (id) => wrap(() => deleteUserView(id)),
};

const orgFeature: OrgFeatureRepository = {
  listOwn: () => wrap(() => listOwnOrgFeatures()),
  toggle: (args) => wrap(() => toggleOrgFeature(args)),
};

const credits: CreditsRepository = {
  getOrgBalance: (orgId) => wrap(() => getOrgCreditBalance(orgId)),
  grant: (args) => wrap(() => grantOrgCredits(args)),
};

const externalDomainOwnership: ExternalDomainOwnershipRepository = {
  listOwn: () => wrap(() => listOwnExternalDomainOwnership()),
};

const erpSnapshots: ErpSnapshotsRepository = {
  actuals: () => wrap(() => listActualsSnapshot()),
  apAging: () => wrap(() => listApAgingSnapshot()),
  arAging: () => wrap(() => listArAgingSnapshot()),
};

const integrationsImpl: IntegrationsRepository = {
  getBinding: async (orgId: string, tier: ExternalTier): Promise<IntegrationBinding | null> => {
    return wrap(async () => {
      const { data, error } = await supabase
        .from('external_org_bindings')
        .select('org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at, disconnected_at, config')
        .eq('org_id', orgId)
        .eq('external_tier', tier)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as IntegrationBinding | null;
    });
  },
  listBindings: async (orgId: string): Promise<IntegrationBinding[]> => {
    return wrap(async () => {
      const { data, error } = await supabase
        .from('external_org_bindings')
        .select('org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at, disconnected_at, config')
        .eq('org_id', orgId);
      if (error) throw error;
      return (data ?? []) as unknown as IntegrationBinding[];
    });
  },
  connectIntegration: async (orgId: string, credential: ConnectCredential): Promise<ConnectResponse> => {
    return wrap(async () => {
      const { data, error } = await supabase.functions.invoke('external-connect', {
        body: { tier: credential.tier, credential: credential.credential },
      });
      if (error) throw error;
      return data as ConnectResponse;
    });
  },
  disconnectIntegration: async (orgId: string, tier: ExternalTier): Promise<DisconnectResponse> => {
    return wrap(async () => {
      const { data, error } = await supabase.functions.invoke('external-disconnect', {
        body: { tier },
      });
      if (error) throw error;
      return data as DisconnectResponse;
    });
  },
  getIntegrationHealth: async (orgId: string, tier: ExternalTier): Promise<IntegrationHealth> => {
    return wrap(async () => {
      const binding = await integrationsImpl.getBinding(orgId, tier);

      const { data: watermark, error: watermarkError } = await supabase
        .from('external_sync_watermarks')
        .select('updated_at')
        .eq('org_id', orgId)
        .eq('external_tier', tier)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (watermarkError) throw watermarkError;

      const { count: errorCount, error: outboxError } = await supabase
        .from('external_command_outbox')
        // `id`, NOT `*`: migration 0134 revoked the table-level SELECT and re-issued it per column,
        // deliberately withholding `idempotency_key`. A `*` count therefore 403s for every member,
        // which threw here and made the whole health surface null. Count a granted column instead —
        // this respects the narrowing rather than re-granting it.
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('external_tier', tier)
        .in('state', ['pending', 'failed', 'quarantined', 'held']);

      if (outboxError) throw outboxError;

      return {
        tier,
        status: binding?.status ?? 'disconnected',
        connected_by: binding?.connected_by ?? null,
        connected_at: binding?.connected_at ?? null,
        last_sync: (watermark as { updated_at?: string } | null)?.updated_at ?? null,
        error_count: errorCount ?? 0,
      };
    });
  },
  listProjectLists: async (_orgId: string): Promise<ClickUpListItem[]> => {
    return wrap(async () => {
      const { data, error } = await supabase.functions.invoke('external-lists', {
        body: { tier: 'clickup' },
      });
      if (error) throw error;
      return (data as { lists: ClickUpListItem[] }).lists;
    });
  },
  linkProject: async (_orgId: string, input: LinkInput): Promise<LinkResponse> => {
    return wrap(async () => {
      const { data, error } = await supabase.functions.invoke('external-link', {
        body: { ...input },
      });
      if (error) throw error;
      return data as LinkResponse;
    });
  },
  unlinkProject: async (_orgId: string, input: UnlinkInput): Promise<UnlinkResponse> => {
    return wrap(async () => {
      const { data, error } = await supabase.functions.invoke('external-unlink', {
        body: { ...input },
      });
      if (error) throw error;
      return data as UnlinkResponse;
    });
  },
  listProjectBindings: async (orgId: string): Promise<ProjectBinding[]> => {
    return wrap(async () => {
      const { data, error } = await supabase
        .from('external_project_bindings')
        .select('id, org_id, project_id, external_tier, external_container_id, config, linked_by, linked_at, disconnected_at')
        .eq('org_id', orgId)
        .is('disconnected_at', null);
      if (error) throw error;
      return (data ?? []) as unknown as ProjectBinding[];
    });
  },
  listCompanies: async (orgId: string, tier: ExternalTier): Promise<{ name: string }[]> => {
    return wrap(async () => {
      if (tier !== 'erpnext') {
        return [];
      }
      const { data, error } = await supabase.functions.invoke('external-companies', {
        body: { tier: 'erpnext' },
      });
      if (error) throw error;
      return (data as { companies: { name: string }[] }).companies;
    });
  },
  setCompany: async (orgId: string, tier: ExternalTier, companyId: string): Promise<{ ok: true; companyId: string }> => {
    return wrap(async () => {
      if (tier !== 'erpnext') {
        throw new Error('Only erpnext tier supports company selection');
      }
      const { data, error } = await supabase.functions.invoke('external-set-company', {
        body: { tier: 'erpnext', companyId },
      });
      if (error) throw error;
      return data as { ok: true; companyId: string };
    });
  },
};

/** The Supabase-backed repositories the FE/CRUD layer consumes (ADR-0017). */
export const repositories: Repositories = {
  project,
  company,
  document,
  agentAttachment,
  profile,
  procurement,
  revenue,
  timesheet,
  budget,
  task,
  incident,
  milestone,
  procurementFiles,
  contact,
  userView,
  operator,
  usage,
  orgFeature,
  credits,
  externalDomainOwnership,
  erpSnapshots,
  integrations: integrationsImpl,
};

export type {
  Repositories,
  ProjectRepository,
  CompanyRepository,
  DocumentRepository,
  AgentAttachmentRepository,
  ProfileRepository,
  ProcurementRepository,
  RevenueRepository,
  TimesheetRepository,
  BudgetRepository,
  TaskRepository,
  IncidentRepository,
  MilestoneRepository,
  ProcurementFileRepository,
  ContactRepository,
  UserViewRepository,
  OperatorRepository,
  UsageRepository,
  OrgFeatureRepository,
  CreditsRepository,
  ExternalDomainOwnershipRepository,
  ErpSnapshotsRepository,
  IntegrationsRepository,
} from './types';
