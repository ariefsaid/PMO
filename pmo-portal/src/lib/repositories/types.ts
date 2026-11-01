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
 *
 * Since the domain split (T-29) the per-domain contracts live in `./contracts/*`, grouped
 * by domain. This module keeps the `Repositories` aggregate plus TYPE-ONLY re-exports of
 * every contract, so the external import surface of the seam is unchanged.
 */
import type { RecordHistoryRepository } from './recordHistory';
import type { ProjectMoneyRepository } from './contracts/projectMoney';
import type { DashboardRepository } from './contracts/dashboard';
import type { AgentRunRepository } from './contracts/agentRuns';
import type {
  CreditsRepository,
  ExternalDomainOwnershipRepository,
  OperatorRepository,
  OrgFeatureRepository,
  OrgSettingsRepository,
  ProfileRepository,
  UsageRepository,
  UserViewRepository,
} from './contracts/admin';
import type {
  StockRepository,
} from './contracts/stock';
import type {
  BudgetRepository,
} from './contracts/budget';
import type {
  CompanyCollectionsRepository,
  CompanyRepository,
  ContactRepository,
} from './contracts/companies';
import type {
  AgentAttachmentRepository,
  DocumentRepository,
  M365DocumentSettingsRepository,
  M365RecordFoldersRepository,
} from './contracts/documents';
import type {
  ErpPurchaseRepository,
} from './contracts/erpPurchases';
import type {
  ExpenseClaimRepository,
  ExpensePostingRepository,
  ExpenseReceiptRepository,
} from './contracts/expenses';
import type { ImprestRepository } from './contracts/imprest';
import type {
  IncidentRepository,
} from './contracts/incidents';
import type { CommentRepository } from './contracts/comments';
import type {
  IntegrationsRepository,
} from './contracts/integrations';
import type {
  MeetingRepository,
} from './contracts/meetings';
import type {
  ProcurementFileRepository,
  ProcurementRepository,
} from './contracts/procurement';
import type {
  ProjectRepository,
} from './contracts/projects';
import type {
  ErpSnapshotsRepository,
  FinancialStatementsRepository,
  FxRatesRepository,
  ReportsRepository,
} from './contracts/reporting';
import type {
  RevenueRepository,
} from './contracts/revenue';
import type {
  TaskRepository,
} from './contracts/tasks';
import type {
  TimesheetRepository,
} from './contracts/timesheets';
import type {
  VendorWithholdingSlipsRepository,
} from './contracts/vendorWithholdingSlips';
import type {
  MilestoneRepository,
  ProgressBillingRepository,
  WorkOrderAcceptanceRepository,
  WorkOrderRepository,
} from './contracts/workOrders';

import type { OdooRepository } from './odoo';

export interface Repositories {
  fxRates: FxRatesRepository;
  m365DocumentSettings: M365DocumentSettingsRepository;
  m365RecordFolders: M365RecordFoldersRepository;
  recordHistory: RecordHistoryRepository;
  vendorWithholdingSlips: VendorWithholdingSlipsRepository;
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
  comment: CommentRepository;
  milestone: MilestoneRepository;
  workOrder: WorkOrderRepository;
  progressBilling: ProgressBillingRepository;
  stock: StockRepository;
  workOrderAcceptance: WorkOrderAcceptanceRepository;
  procurementFiles: ProcurementFileRepository;
  expenseClaim: ExpenseClaimRepository;
  imprest: ImprestRepository;
  expenseReceipts: ExpenseReceiptRepository;
  expensePostings: ExpensePostingRepository;
  erpPurchases: ErpPurchaseRepository;
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
  companyCollections: CompanyCollectionsRepository;
  financialStatements: FinancialStatementsRepository;
  integrations: IntegrationsRepository;
  odoo: OdooRepository;
  reports: ReportsRepository;
  projectMoney: ProjectMoneyRepository;
  dashboard: DashboardRepository;
  agentRun: AgentRunRepository;
}

export type { CommandIntent } from './contracts/commandIntent';
export type { ProjectRepository } from './contracts/projects';
export type { CompanyCollectionsRepository, CompanyRepository, ContactRepository } from './contracts/companies';
export type { TaskRepository } from './contracts/tasks';
export type { MeetingRepository } from './contracts/meetings';
export type { AgentAttachmentRepository, DocumentRepository, M365DocumentSettingsRepository, M365RecordFoldersRepository } from './contracts/documents';
export type { ProcurementFileRepository, ProcurementListOptions, ProcurementListRow, ProcurementRepository } from './contracts/procurement';
export type { ProjectMoneyRepository } from './contracts/projectMoney';
export type { DashboardRepository } from './contracts/dashboard';
export type { AgentRunRepository } from './contracts/agentRuns';
export type { RevenueRepository } from './contracts/revenue';
export type { TimesheetRepository } from './contracts/timesheets';
export type { BudgetRepository } from './contracts/budget';
export type { StockMasterRepository, StockRepository } from './contracts/stock';
export type { IncidentRepository } from './contracts/incidents';
export type { CommentRepository } from './contracts/comments';
export type { MilestoneRepository, ProgressBillingRepository, WorkOrderAcceptanceRepository, WorkOrderRepository } from './contracts/workOrders';
export type { ExpenseClaimRepository, ExpensePostingRepository, ExpenseReceiptRepository } from './contracts/expenses';
export type { ImprestRepository } from './contracts/imprest';
export type { ErpPurchaseRepository } from './contracts/erpPurchases';
export type { VendorWithholdingSlipsRepository } from './contracts/vendorWithholdingSlips';
export type { CreditsRepository, ExternalDomainOwnershipRepository, OperatorRepository, OrgFeatureRepository, OrgSettingsRepository, ProfileRepository, UsageRepository, UserViewRepository } from './contracts/admin';
export type { ErpSnapshotsRepository, FinancialStatementsRepository, FxCommitCounts, FxRateInput, FxRateMatch, FxRatePage, FxRateRow, FxRatesRepository, ReportsRepository } from './contracts/reporting';
export type { ClickUpListItem, ConnectCredential, ConnectResponse, DisconnectResponse, ErpProjectLink, ErpProjectOption, ErpSetupReadiness, ExternalTier, IntegrationBinding, IntegrationHealth, IntegrationStatus, IntegrationsRepository, LinkClickUpProjectInput, LinkDirection, LinkErpNextOrgInput, LinkInput, LinkResponse, ProjectBinding, UnlinkInput, UnlinkResponse } from './contracts/integrations';
