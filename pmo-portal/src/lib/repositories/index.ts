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
import { toAppError } from '@/src/lib/appError';
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
import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  updateTaskStatus,
  deleteTask,
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
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';
import type {
  Repositories,
  ProjectRepository,
  CompanyRepository,
  DocumentRepository,
  AgentAttachmentRepository,
  ProfileRepository,
  ProcurementRepository,
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

const company: CompanyRepository = {
  listClients: () => wrap(() => listClientCompanies()),
  list: (params) => wrap(() => listCompanies(params)),
  get: (id) => wrap(() => getCompany(id)),
  create: (input) =>
    routeDomainWrite('companies') === 'external'
      ? dispatchDomainCommand(
          'companies',
          'create',
          { id: crypto.randomUUID(), ...input, erp_doc_kind: 'supplier' },
          freshIdempotencyKey(),
        ).then((res) => res.canonical as unknown as CompanyRow)
      : wrap(() => createCompany(input)),
  update: (id, input) =>
    routeDomainWrite('companies') === 'external'
      ? dispatchDomainCommand(
          'companies',
          'update',
          { id, ...input, erp_doc_kind: 'supplier' },
          freshIdempotencyKey(),
        ).then(() => undefined)
      : wrap(() => updateCompany(id, input)),
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
  update: (id, patch) => wrap(() => updateTask(id, patch)),
  updateStatus: (id, status) => wrap(() => updateTaskStatus(id, status)),
  delete: (id) => wrap(() => deleteTask(id)),
  addDependency: (taskId, dependsOnId) => wrap(() => addDependency(taskId, dependsOnId)),
  removeDependency: (taskId, dependsOnId) => wrap(() => removeDependency(taskId, dependsOnId)),
};

// Task 1.10/1.11 (ADR-0055/ADR-0057): a fresh-key options bag for the erpnext money path — minted
// ONLY on the 'external' branch. P0/P1 (and every 'pmo'-routed call) never mint one (byte-for-byte).
const freshIdempotencyKey = () => ({ idempotencyKey: crypto.randomUUID() });

const procurement: ProcurementRepository = {
  list: (params) => wrap(() => listProcurements(params)),
  get: (id) => wrap(() => getProcurementDetail(id)),
  // Task 4.9 (finding-3 path fix): the case-AGGREGATE status transition is PMO-derived, never an ERP
  // command (`to` is a PMO `ProcurementStatus` like 'Approved' — the erpnext adapter has no concept of
  // it, FR-ENA-101/073). This ALWAYS stays on the direct DAL path, even when `procurement` is
  // externally-owned — unlike every other method below, it carries no routeDomainWrite guard at all.
  transition: (id, to, notes) => wrap(() => transitionProcurement(id, to, notes)),
  createQuotation: (procurementId, vendorId, totalAmount, receivedDate) =>
    routeDomainWrite('procurement') === 'external'
      ? dispatchDomainCommand(
          'procurement',
          'create',
          { id: crypto.randomUUID(), procurementId, vendorId, totalAmount, receivedDate, erp_doc_kind: 'quotation' },
          freshIdempotencyKey(),
        ).then((res) => res.canonical as unknown as Tables<'procurement_quotations'>)
      : wrap(() => createQuotation(procurementId, vendorId, totalAmount, receivedDate)),
  createReceipt: (procurementId, status, receiptDate) =>
    routeDomainWrite('procurement') === 'external'
      ? dispatchDomainCommand(
          'procurement',
          'create',
          { id: crypto.randomUUID(), procurementId, status, receiptDate, erp_doc_kind: 'goods-receipt' },
          freshIdempotencyKey(),
        ).then((res) => res.canonical as unknown as ProcurementReceiptRow)
      : wrap(() => createReceipt(procurementId, status, receiptDate)),
  createInvoice: (procurementId, status, invoiceDate) =>
    routeDomainWrite('procurement') === 'external'
      ? dispatchDomainCommand(
          'procurement',
          'create',
          { id: crypto.randomUUID(), procurementId, status, invoiceDate, erp_doc_kind: 'purchase-invoice' },
          freshIdempotencyKey(),
        ).then((res) => res.canonical as unknown as ProcurementInvoiceRow)
      : wrap(() => createInvoice(procurementId, status, invoiceDate)),
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
  createPurchaseRequest: (procurementId, referenceNumber, status, date, amount) =>
    routeDomainWrite('procurement') === 'external'
      ? dispatchDomainCommand(
          'procurement',
          'create',
          { id: crypto.randomUUID(), procurementId, referenceNumber, status, date, amount, erp_doc_kind: 'purchase-request' },
          freshIdempotencyKey(),
        ).then((res) => res.canonical as unknown as PurchaseRequestRow)
      : wrap(() => createPurchaseRequest(procurementId, referenceNumber, status, date, amount)),
  createRfq: (procurementId, referenceNumber, status, date, amount) =>
    routeDomainWrite('procurement') === 'external'
      ? dispatchDomainCommand(
          'procurement',
          'create',
          { id: crypto.randomUUID(), procurementId, referenceNumber, status, date, amount, erp_doc_kind: 'rfq' },
          freshIdempotencyKey(),
        ).then((res) => res.canonical as unknown as RfqRow)
      : wrap(() => createRfq(procurementId, referenceNumber, status, date, amount)),
  createPurchaseOrder: (procurementId, referenceNumber, status, date, amount) =>
    routeDomainWrite('procurement') === 'external'
      ? dispatchDomainCommand(
          'procurement',
          'create',
          { id: crypto.randomUUID(), procurementId, referenceNumber, status, date, amount, erp_doc_kind: 'purchase-order' },
          freshIdempotencyKey(),
        ).then((res) => res.canonical as unknown as PurchaseOrderRow)
      : wrap(() => createPurchaseOrder(procurementId, referenceNumber, status, date, amount)),
  createPayment: (procurementId, invoiceId, referenceNumber, status, date, amount) =>
    routeDomainWrite('procurement') === 'external'
      ? dispatchDomainCommand(
          'procurement',
          'create',
          { id: crypto.randomUUID(), procurementId, invoiceId, referenceNumber, status, date, amount, erp_doc_kind: 'payment' },
          freshIdempotencyKey(),
        ).then((res) => res.canonical as unknown as PaymentRow)
      : wrap(() => createPayment(procurementId, invoiceId, referenceNumber, status, date, amount)),
};

const timesheet: TimesheetRepository = {
  list: (userId, params) => wrap(() => listTimesheets(userId, params)),
  createDraft: (weekStartDate, userId) => wrap(() => createDraftTimesheet(weekStartDate, userId)),
  upsertEntries: (entries) => wrap(() => upsertTimesheetEntries(entries)),
  deleteEntry: (id) => wrap(() => deleteTimesheetEntry(id)),
  submit: (id) => wrap(() => submitTimesheet(id)),
  approve: (id, notes) => wrap(() => approveTimesheet(id, notes)),
  reject: (id, notes) => wrap(() => rejectTimesheet(id, notes)),
  listAwaitingApproval: (selfId) => wrap(() => listTimesheetsAwaitingApproval(selfId)),
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

/** The Supabase-backed repositories the FE/CRUD layer consumes (ADR-0017). */
export const repositories: Repositories = {
  project,
  company,
  document,
  agentAttachment,
  profile,
  procurement,
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
};

export type {
  Repositories,
  ProjectRepository,
  CompanyRepository,
  DocumentRepository,
  AgentAttachmentRepository,
  ProfileRepository,
  ProcurementRepository,
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
} from './types';
