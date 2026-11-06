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

/**
 * Per-entity lazy repository (perf): every method is async, so a route that uses `repositories.procurement`
 * downloads only the procurement module (and its DAL), not all 50 repositories (105 kB gzip) on first paint.
 * The module loads on first call; the typed seam and every `repositories.x.y(...)` call site are unchanged.
 */
type Loader = () => Promise<unknown>;

/** Callable proxy at `path` inside the loaded repository: a property read descends, a call loads + forwards. */
function lazyAt(load: Loader, path: string[]): unknown {
  // Children are materialised on the target on first touch (get / descriptor), so they are real own
  // properties: `vi.spyOn(repositories.x, 'm')` and restore work exactly as on the eager object.
  const materialise = (target: Record<string, unknown>, key: PropertyKey) => {
    if (typeof key !== 'string' || key === 'then' || Object.hasOwn(target, key)) return; // `then`: never thenable
    target[key] = lazyAt(load, [...path, key]);
  };
  const call = async (...args: unknown[]) => {
    let owner = (await load()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const key of path.slice(0, -1)) owner = owner[key];
    return owner[path[path.length - 1]](...args);
  };
  // Own `name`/`length` would shadow methods of those names; inherited Function members are shadowed once materialised.
  Reflect.deleteProperty(call, 'name');
  Reflect.deleteProperty(call, 'length');
  return new Proxy(call as unknown as Record<string, unknown>, {
    apply: (_t, _this, args) => call(...(args as unknown[])),
    get: (target, key) => (materialise(target, key), target[key as string]),
    getOwnPropertyDescriptor: (target, key) => (materialise(target, key), Reflect.getOwnPropertyDescriptor(target, key)),
  });
}

/** One import per entity however many calls race it. */
function memo(load: Loader): Loader {
  let p: Promise<unknown> | undefined;
  return () => (p ??= load());
}

const loaders: { [K in keyof Repositories]: () => Promise<Repositories[K]> } = {
  fxRates: () => import('./fxRates').then((x) => x.fxRatesRepository),
  m365DocumentSettings: () => import('./documents').then((x) => x.m365DocumentSettingsRepository),
  m365RecordFolders: () => import('./documents').then((x) => x.m365RecordFoldersRepository),
  recordHistory: () => import('./recordHistory').then((x) => x.recordHistoryRepository),
  vendorWithholdingSlips: () => import('./vendorWithholdingSlips').then((x) => x.vendorWithholdingSlipsRepository),
  project: () => import('./projects').then((x) => x.projectRepository),
  projectStage: () => import('./projectStages').then((x) => x.projectStageRepository),
  projectMoney: () => import('./projectMoney').then((x) => x.projectMoneyRepository),
  projectOverview: () => import('./projectOverview').then((x) => x.projectOverviewRepository),
  dashboard: () => import('./dashboard').then((x) => x.dashboardRepository),
  agentRun: () => import('./agentRuns').then((x) => x.agentRunRepository),
  notification: () => import('./notifications').then((x) => x.notificationRepository),
  company: () => import('./companies').then((x) => x.companyRepository),
  document: () => import('./documents').then((x) => x.documentRepository),
  agentAttachment: () => import('./documents').then((x) => x.agentAttachmentRepository),
  profile: () => import('./admin').then((x) => x.profileRepository),
  procurement: () => import('./procurement').then((x) => x.procurementRepository),
  subcontracts: () => import('./subcontracts').then((x) => x.subcontractRepository),
  revenue: () => import('./revenue').then((x) => x.revenueRepository),
  timesheet: () => import('./timesheets').then((x) => x.timesheetRepository),
  budget: () => import('./budget').then((x) => x.budgetRepository),
  task: () => import('./tasks').then((x) => x.taskRepository),
  incident: () => import('./incidents').then((x) => x.incidentRepository),
  comment: () => import('./comments').then((x) => x.commentRepository),
  milestone: () => import('./workOrders').then((x) => x.milestoneRepository),
  workOrder: () => import('./workOrders').then((x) => x.workOrderRepository),
  progressBilling: () => import('./workOrders').then((x) => x.progressBillingRepository),
  stock: () => import('./stock').then((x) => x.stockRepository),
  workOrderAcceptance: () => import('./workOrders').then((x) => x.workOrderAcceptanceRepository),
  procurementFiles: () => import('./procurement').then((x) => x.procurementFilesRepository),
  expenseClaim: () => import('./expenses').then((x) => x.expenseClaimRepository),
  imprest: () => import('./imprest').then((x) => x.imprestRepository),
  equipment: () => import('./equipment').then((x) => x.equipmentRepository),
  timeAndMaterials: () => import('./timeAndMaterials').then((x) => x.timeAndMaterialsRepository),
  expenseReceipts: () => import('./expenses').then((x) => x.expenseReceiptsRepository),
  expensePostings: () => import('./expensePostings').then((x) => x.expensePostingsRepository),
  erpPurchases: () => import('./erpPurchases').then((x) => x.erpPurchasesRepository),
  erpJournalLines: () => import('./erpJournalLines').then((x) => x.erpJournalLinesRepository),
  contact: () => import('./companies').then((x) => x.contactRepository),
  meeting: () => import('./meetings').then((x) => x.meetingRepository),
  userView: () => import('./admin').then((x) => x.userViewRepository),
  operator: () => import('./admin').then((x) => x.operatorRepository),
  usage: () => import('./admin').then((x) => x.usageRepository),
  orgFeature: () => import('./admin').then((x) => x.orgFeatureRepository),
  orgSettings: () => import('./admin').then((x) => x.orgSettingsRepository),
  credits: () => import('./admin').then((x) => x.creditsRepository),
  externalDomainOwnership: () => import('./admin').then((x) => x.externalDomainOwnershipRepository),
  erpSnapshots: () => import('./reporting').then((x) => x.erpSnapshotsRepository),
  companyCollections: () => import('./companyCollections').then((x) => x.companyCollectionsRepository),
  financialStatements: () => import('./financialStatements').then((x) => x.financialStatementsRepository),
  integrations: () => import('./integrations').then((x) => x.integrationsRepository),
  odoo: () => import('./odoo').then((x) => x.odooRepository),
  reports: () => import('./reporting').then((x) => x.reportsRepository),
};

/** The Supabase-backed repositories the FE/CRUD layer consumes (ADR-0017). Each entity loads on first use. */
export const repositories = Object.fromEntries(
  Object.entries(loaders).map(([name, load]) => [name, lazyAt(memo(load), [])]),
) as unknown as Repositories;

/**
 * Resolves every repository module, for tests that assert the full shape (`Object.keys`) of the aggregate.
 * Sequential on purpose: concurrent first imports of a `vi.mock(..., importOriginal)` module can build it twice.
 */
export async function loadAllRepositories(): Promise<Repositories> {
  const all: Record<string, unknown> = {};
  for (const [name, load] of Object.entries(loaders)) all[name] = await load();
  return all as unknown as Repositories;
}

export type {
  Repositories,
  FieldChange,
  HistoryCursor,
  HistoryEvent,
  HistoryNameKind,
  HistoryPage,
  RecordHistoryRepository,
  ProjectStageRepository,
  DirectoryKind,
  ListMasterInput,
  MasterRecord,
  OdooConnectionRead,
  OdooRepository,
  SubcontractRepository,
  CaptureSubcontractVendorInvoiceInput,
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
  EquipmentRepository,
  TimeAndMaterialsRepository,
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
