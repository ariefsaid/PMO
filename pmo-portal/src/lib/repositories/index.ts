/**
 * The repository composition root — the API seam (ADR-0017).
 *
 * Assembles the `repositories` object consumed by the FE/CRUD layer from the per-domain
 * implementation modules (`./projects`, `./companies`, `./procurement`, …). Each wrapper
 * delegates to the existing `pmo-portal/src/lib/db/*` DAL functions and normalizes any
 * thrown value to a shared `AppError` (code preserved) through `./repositoryErrors`, so
 * consumers catch a single, code-bearing error type regardless of backend. New CRUD code
 * imports `repositories`; existing hooks continue to import the DAL directly (this seam
 * is additive and low-risk).
 *
 * A future ERP/REST backend = a new module exporting the same `Repositories` shape; the FE
 * imports `repositories` and never changes. Since the domain split (T-29) this module is
 * the composition root and public re-export seam only: implementations live in the domain
 * modules, shared dispatch/error helpers in `./repositoryDispatch` / `./repositoryErrors`,
 * and the per-domain contracts in `./contracts/*` (re-exported through `./types`).
 */
import { companyCollectionsRepository } from './companyCollections';
import { recordHistoryRepository } from './recordHistory';
import { vendorWithholdingSlipsRepository } from './vendorWithholdingSlips';
import { fxRatesRepository } from './fxRates';
import { financialStatementsRepository } from './financialStatements';
import { expensePostingsRepository } from './expensePostings';
import { erpPurchasesRepository } from './erpPurchases';
import { projectRepository } from './projects';
import { projectMoneyRepository } from './projectMoney';
import { dashboardRepository } from './dashboard';
import { agentRunRepository } from './agentRuns';
import { companyRepository, contactRepository } from './companies';
import {
  documentRepository,
  agentAttachmentRepository,
  m365DocumentSettingsRepository,
  m365RecordFoldersRepository,
} from './documents';
import {
  profileRepository,
  operatorRepository,
  usageRepository,
  userViewRepository,
  orgFeatureRepository,
  orgSettingsRepository,
  creditsRepository,
  externalDomainOwnershipRepository,
} from './admin';
import { taskRepository } from './tasks';
import { commentRepository } from './comments';
import { meetingRepository } from './meetings';
import { incidentRepository } from './incidents';
import { procurementRepository, procurementFilesRepository } from './procurement';
import { subcontractRepository } from './subcontracts';
import { revenueRepository } from './revenue';
import { timesheetRepository } from './timesheets';
import { stockRepository } from './stock';
import { budgetRepository } from './budget';
import {
  milestoneRepository,
  workOrderRepository,
  progressBillingRepository,
  workOrderAcceptanceRepository,
} from './workOrders';
import { expenseClaimRepository, expenseReceiptsRepository } from './expenses';
import { imprestRepository } from './imprest';
import { integrationsRepository } from './integrations';
import { odooRepository } from './odoo';
import { erpSnapshotsRepository, reportsRepository } from './reporting';
import type { Repositories } from './types';

// BLOCK 2 (MONEY-CRITICAL): `newCommandIntent()` lives in ./commandIntent (a leaf module) and is
// re-exported here so the public seam is unchanged — see that file for the full rationale.
export { newCommandIntent } from './commandIntent';

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
export { timesheetPushKey } from '@/src/lib/adapterSeam/erpnext/timesheetPushKey';

/** The Supabase-backed repositories the FE/CRUD layer consumes (ADR-0017). */
export const repositories: Repositories = {
  fxRates: fxRatesRepository,
  m365DocumentSettings: m365DocumentSettingsRepository,
  m365RecordFolders: m365RecordFoldersRepository,
  recordHistory: recordHistoryRepository,
  vendorWithholdingSlips: vendorWithholdingSlipsRepository,
  project: projectRepository,
  projectMoney: projectMoneyRepository,
  dashboard: dashboardRepository,
  agentRun: agentRunRepository,
  company: companyRepository,
  document: documentRepository,
  agentAttachment: agentAttachmentRepository,
  profile: profileRepository,
  procurement: procurementRepository,
  subcontracts: subcontractRepository,
  revenue: revenueRepository,
  timesheet: timesheetRepository,
  budget: budgetRepository,
  task: taskRepository,
  incident: incidentRepository,
  comment: commentRepository,
  milestone: milestoneRepository,
  workOrder: workOrderRepository,
  progressBilling: progressBillingRepository,
  stock: stockRepository,
  workOrderAcceptance: workOrderAcceptanceRepository,
  procurementFiles: procurementFilesRepository,
  expenseClaim: expenseClaimRepository,
  imprest: imprestRepository,
  expenseReceipts: expenseReceiptsRepository,
  expensePostings: expensePostingsRepository,
  erpPurchases: erpPurchasesRepository,
  contact: contactRepository,
  meeting: meetingRepository,
  userView: userViewRepository,
  operator: operatorRepository,
  usage: usageRepository,
  orgFeature: orgFeatureRepository,
  orgSettings: orgSettingsRepository,
  credits: creditsRepository,
  externalDomainOwnership: externalDomainOwnershipRepository,
  erpSnapshots: erpSnapshotsRepository,
  companyCollections: companyCollectionsRepository,
  financialStatements: financialStatementsRepository,
  integrations: integrationsRepository,
  odoo: odooRepository,
  reports: reportsRepository,
};

export type {
  Repositories,
  ProjectRepository,
  CompanyRepository,
  DocumentRepository,
  M365DocumentSettingsRepository,
  AgentAttachmentRepository,
  ProfileRepository,
  ProcurementRepository,
  RevenueRepository,
  TimesheetRepository,
  BudgetRepository,
  TaskRepository,
  IncidentRepository,
  MilestoneRepository,
  WorkOrderRepository,
  ProgressBillingRepository,
  WorkOrderAcceptanceRepository,
  ProcurementFileRepository,
  ExpenseClaimRepository,
  ImprestRepository,
  ExpenseReceiptRepository,
  ExpensePostingRepository,
  ContactRepository,
  MeetingRepository,
  UserViewRepository,
  OperatorRepository,
  UsageRepository,
  OrgFeatureRepository,
  OrgSettingsRepository,
  CreditsRepository,
  ExternalDomainOwnershipRepository,
  ErpSnapshotsRepository,
  CompanyCollectionsRepository,
  ReportsRepository,
  FinancialStatementsRepository,
  IntegrationsRepository,
  VendorWithholdingSlipsRepository,
  FxRatesRepository,
  FxRateRow,
  FxRateInput,
  FxRateMatch,
  FxRatePage,
  FxCommitCounts,
} from './types';
export type * from './dataTypes';
