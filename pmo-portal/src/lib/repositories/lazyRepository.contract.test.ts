import { beforeAll, expect, it, vi } from 'vitest';

// Public domains and their implementation exports are an independent API inventory.
// Methods are discovered from the real exported objects, not from the forwarding configuration.
const contracts = [
  { domain: 'fxRates', module: './fxRates', exported: 'fxRatesRepository' },
  { domain: 'm365DocumentSettings', module: './documents', exported: 'm365DocumentSettingsRepository' },
  { domain: 'm365RecordFolders', module: './documents', exported: 'm365RecordFoldersRepository' },
  { domain: 'recordHistory', module: './recordHistory', exported: 'recordHistoryRepository' },
  { domain: 'vendorWithholdingSlips', module: './vendorWithholdingSlips', exported: 'vendorWithholdingSlipsRepository' },
  { domain: 'supplyRisk', module: './supplyRisk', exported: 'supplyRiskRepository' },
  { domain: 'project', module: './projects', exported: 'projectRepository' },
  { domain: 'projectStage', module: './projectStages', exported: 'projectStageRepository' },
  { domain: 'projectMoney', module: './projectMoney', exported: 'projectMoneyRepository' },
  { domain: 'projectOverview', module: './projectOverview', exported: 'projectOverviewRepository' },
  { domain: 'dashboard', module: './dashboard', exported: 'dashboardRepository' },
  { domain: 'agentRun', module: './agentRuns', exported: 'agentRunRepository' },
  { domain: 'notification', module: './notifications', exported: 'notificationRepository' },
  { domain: 'company', module: './companies', exported: 'companyRepository' },
  { domain: 'document', module: './documents', exported: 'documentRepository' },
  { domain: 'agentAttachment', module: './documents', exported: 'agentAttachmentRepository' },
  { domain: 'profile', module: './admin', exported: 'profileRepository' },
  { domain: 'procurement', module: './procurement', exported: 'procurementRepository' },
  { domain: 'subcontracts', module: './subcontracts', exported: 'subcontractRepository' },
  { domain: 'subcontractCertificates', module: './subcontractCertificates', exported: 'subcontractCertificateRepository' },
  { domain: 'revenue', module: './revenue', exported: 'revenueRepository' },
  { domain: 'timesheet', module: './timesheets', exported: 'timesheetRepository' },
  { domain: 'budget', module: './budget', exported: 'budgetRepository' },
  { domain: 'task', module: './tasks', exported: 'taskRepository' },
  { domain: 'taskProof', module: './taskProofs', exported: 'taskProofRepository' },
  { domain: 'thirdPartyInspection', module: './thirdPartyInspections', exported: 'thirdPartyInspectionRepository' },
  { domain: 'incident', module: './incidents', exported: 'incidentRepository' },
  { domain: 'issueClosingReport', module: './issueClosingReport', exported: 'issueClosingReportRepository' },
  { domain: 'incidentType', module: './incidentTypes', exported: 'incidentTypeRepository' },
  { domain: 'comment', module: './comments', exported: 'commentRepository' },
  { domain: 'milestone', module: './workOrders', exported: 'milestoneRepository' },
  { domain: 'workOrder', module: './workOrders', exported: 'workOrderRepository' },
  { domain: 'progressBilling', module: './workOrders', exported: 'progressBillingRepository' },
  { domain: 'rateCatalogue', module: './rateCatalogue', exported: 'rateCatalogueRepository' },
  { domain: 'billingStages', module: './billingStages', exported: 'billingStagesRepository' },
  { domain: 'closeoutChecklist', module: './closeoutChecklist', exported: 'closeoutChecklistRepository' },
  { domain: 'surveyRecord', module: './surveyRecords', exported: 'surveyRecordRepository' },
  { domain: 'dailySiteReport', module: './dailySiteReports', exported: 'dailySiteReportRepository' },
  { domain: 'workOrderCheckTemplate', module: './workOrderCheckTemplate', exported: 'workOrderCheckTemplateRepository' },
  { domain: 'safetyDay', module: './safetyDays', exported: 'safetyDayRepository' },
  { domain: 'workInHand', module: './workInHand', exported: 'workInHandRepository' },
  { domain: 'openingBalances', module: './openingBalances', exported: 'openingBalanceRepository' },
  { domain: 'quantityChange', module: './quantityChanges', exported: 'quantityChangeRepository' },
  { domain: 'stock', module: './stock', exported: 'stockRepository' },
  { domain: 'stockOpening', module: './stockOpening', exported: 'stockOpeningRepository' },
  { domain: 'workOrderAcceptance', module: './workOrders', exported: 'workOrderAcceptanceRepository' },
  { domain: 'procurementFiles', module: './procurement', exported: 'procurementFilesRepository' },
  { domain: 'expenseClaim', module: './expenses', exported: 'expenseClaimRepository' },
  { domain: 'imprest', module: './imprest', exported: 'imprestRepository' },
  { domain: 'journal', module: './journals', exported: 'journalRepository' },
  { domain: 'equipment', module: './equipment', exported: 'equipmentRepository' },
  { domain: 'documentExpiry', module: './documentExpiry', exported: 'documentExpiryRepository' },
  { domain: 'documentCategory', module: './documentCategories', exported: 'documentCategoryRepository' },
  { domain: 'equipmentAvailability', module: './equipmentAvailability', exported: 'equipmentAvailabilityRepository' },
  { domain: 'people', module: './people', exported: 'peopleRepository' },
  { domain: 'timeAndMaterials', module: './timeAndMaterials', exported: 'timeAndMaterialsRepository' },
  { domain: 'expenseReceipts', module: './expenses', exported: 'expenseReceiptsRepository' },
  { domain: 'expensePostings', module: './expensePostings', exported: 'expensePostingsRepository' },
  { domain: 'erpPurchases', module: './erpPurchases', exported: 'erpPurchasesRepository' },
  { domain: 'erpJournalLines', module: './erpJournalLines', exported: 'erpJournalLinesRepository' },
  { domain: 'odooLedger', module: './odooLedger', exported: 'odooLedgerRepository' },
  { domain: 'contact', module: './companies', exported: 'contactRepository' },
  { domain: 'meeting', module: './meetings', exported: 'meetingRepository' },
  { domain: 'userView', module: './admin', exported: 'userViewRepository' },
  { domain: 'operator', module: './admin', exported: 'operatorRepository' },
  { domain: 'usage', module: './admin', exported: 'usageRepository' },
  { domain: 'orgFeature', module: './admin', exported: 'orgFeatureRepository' },
  { domain: 'orgSettings', module: './admin', exported: 'orgSettingsRepository' },
  { domain: 'credits', module: './admin', exported: 'creditsRepository' },
  { domain: 'externalDomainOwnership', module: './admin', exported: 'externalDomainOwnershipRepository' },
  { domain: 'erpSnapshots', module: './reporting', exported: 'erpSnapshotsRepository' },
  { domain: 'companyCollections', module: './companyCollections', exported: 'companyCollectionsRepository' },
  { domain: 'financialStatements', module: './financialStatements', exported: 'financialStatementsRepository' },
  { domain: 'integrations', module: './integrations', exported: 'integrationsRepository' },
  { domain: 'odoo', module: './odoo', exported: 'odooRepository' },
  { domain: 'reports', module: './reporting', exported: 'reportsRepository' },
];
type Tree = Record<string, unknown>;
const loads = new Map<string, number>();
const implementations = new Map<string, Tree>();
const returns = new WeakMap<object, object>();

function instrument(value: Tree, label: string): Tree {
  return Object.fromEntries(Object.entries(value).map(([key, member]) => {
    if (typeof member !== 'function') return [key, instrument(member as Tree, label + '.' + key)];
    const result = { method: label + '.' + key };
    const spy = vi.fn(() => result);
    returns.set(spy, result);
    return [key, spy];
  }));
}

function methods(value: Tree, parent: string[] = []): string[][] {
  return Object.entries(value).flatMap(([key, member]) => typeof member === 'function'
    ? [[...parent, key]]
    : methods(member as Tree, [...parent, key]));
}

function at(value: Tree, path: string[]): unknown {
  return path.reduce<unknown>((node, key) => (node as Tree)[key], value);
}

let repositories: Tree;
beforeAll(async () => {
  for (const module of new Set(contracts.map((contract) => contract.module))) {
    vi.doMock(module, async () => {
      loads.set(module, (loads.get(module) ?? 0) + 1);
      const actual = await vi.importActual<Tree>(module);
      const replacements: Tree = {};
      for (const contract of contracts.filter((item) => item.module === module)) {
        const implementation = instrument(actual[contract.exported] as Tree, contract.exported);
        implementations.set(contract.domain, implementation);
        replacements[contract.exported] = implementation;
      }
      return { ...actual, ...replacements };
    });
  }
  repositories = (await import('./index')).repositories as unknown as Tree;
  expect(Object.keys(repositories).sort()).toEqual(contracts.map((contract) => contract.domain).sort());
  // Merely importing/spreading the API must not execute a domain loader.
  expect(loads.size).toBe(0);
  expect(Object.keys({ ...repositories })).toHaveLength(contracts.length);
});

it.each(contracts)('$domain forwards every real method, preserves results/errors, and loads its module once', async (contract) => {
  const lazy = repositories[contract.domain] as Tree;
  const paths = methods(lazy);
  expect(paths.length).toBeGreaterThan(0);
  const args = [Symbol(contract.domain), { identity: contract.domain }, undefined, ['unchanged']];
  const first = at(lazy, paths[0]) as (...args: unknown[]) => Promise<unknown>;
  await first(...args);
  const real = implementations.get(contract.domain)!;
  expect(methods(lazy).map((path) => path.join('.')).sort())
    .toEqual(methods(real).map((path) => path.join('.')).sort());
  for (const path of methods(real)) {
    const forward = at(lazy, path) as (...args: unknown[]) => Promise<unknown>;
    const spy = vi.mocked(at(real, path) as (...args: unknown[]) => unknown);
    await expect(forward(...args)).resolves.toBe(returns.get(spy));
    expect(spy).toHaveBeenLastCalledWith(...args);
    expect(spy.mock.calls.at(-1)![1]).toBe(args[1]);
    expect(spy.mock.contexts.at(-1)).toBe(path.length === 1 ? real : at(real, path.slice(0, -1)));
  }
  const error = new Error(contract.domain + ' refused');
  vi.mocked(at(real, paths[0]) as (...args: unknown[]) => unknown).mockRejectedValueOnce(error);
  await expect(first(...args)).rejects.toBe(error);
  expect(loads.get(contract.module)).toBe(1);
});
