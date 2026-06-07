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
import { listProjects } from '@/src/lib/db/projects';
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
} from '@/src/lib/db/companies';
import { listProjectManagers } from '@/src/lib/db/profiles';
import { listProcurements } from '@/src/lib/db/procurements';
import {
  getProcurementDetail,
  transitionProcurement,
  createQuotation,
  createReceipt,
  createInvoice,
} from '@/src/lib/db/procurementLifecycle';
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
import type {
  Repositories,
  ProjectRepository,
  CompanyRepository,
  ProfileRepository,
  ProcurementRepository,
  TimesheetRepository,
  BudgetRepository,
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
};

const company: CompanyRepository = {
  listClients: () => wrap(() => listClientCompanies()),
  list: (params) => wrap(() => listCompanies(params)),
  get: (id) => wrap(() => getCompany(id)),
  create: (input) => wrap(() => createCompany(input)),
  update: (id, input) => wrap(() => updateCompany(id, input)),
  archive: (id) => wrap(() => archiveCompany(id)),
  delete: (id) => wrap(() => deleteCompany(id)),
};

const profile: ProfileRepository = {
  listProjectManagers: () => wrap(() => listProjectManagers()),
};

const procurement: ProcurementRepository = {
  list: () => wrap(() => listProcurements()),
  get: (id) => wrap(() => getProcurementDetail(id)),
  transition: (id, to, notes) => wrap(() => transitionProcurement(id, to, notes)),
  createQuotation: (procurementId, vendorId, totalAmount, receivedDate) =>
    wrap(() => createQuotation(procurementId, vendorId, totalAmount, receivedDate)),
  createReceipt: (procurementId, status, receiptDate) =>
    wrap(() => createReceipt(procurementId, status, receiptDate)),
  createInvoice: (procurementId, status, invoiceDate) =>
    wrap(() => createInvoice(procurementId, status, invoiceDate)),
};

const timesheet: TimesheetRepository = {
  list: (userId) => wrap(() => listTimesheets(userId)),
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

/** The Supabase-backed repositories the FE/CRUD layer consumes (ADR-0017). */
export const repositories: Repositories = {
  project,
  company,
  profile,
  procurement,
  timesheet,
  budget,
};

export type {
  Repositories,
  ProjectRepository,
  CompanyRepository,
  ProfileRepository,
  ProcurementRepository,
  TimesheetRepository,
  BudgetRepository,
} from './types';
