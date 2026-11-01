/**
 * Composition wiring net (T-29 repository domain split).
 *
 * The composition root (`./index`) must wire EVERY member of the `Repositories` aggregate
 * to its per-domain implementation module through the public seam. Since the split, each
 * domain implementation lives in its own module (`./projects`, `./companies`, …); these
 * tests call one method per aggregate member through `repositories` and prove it reaches
 * the real DAL entry point — so a member wired to the wrong object (or a module dropped
 * from the composition) cannot pass silently.
 *
 * DAL modules load their REAL implementations with only the asserted entry point
 * overridden (`importOriginal`), so every eval-time binding the modules need stays
 * present and the graph stays honest. The browser Supabase client is mocked at the
 * boundary (table reads resolve through a thenable chain), matching the other
 * repository-suite conventions.
 */
import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';

const invoke = vi.fn();
function thenableTable(result: { data: unknown; error: unknown } | null = { data: [], error: null }) {
  const promise = Promise.resolve(result);
  const make = (): unknown =>
    new Proxy(promise, {
      get(target, prop) {
        if (prop === 'then') return (target as Promise<unknown>).then.bind(target);
        if (prop === 'catch') return (target as Promise<unknown>).catch.bind(target);
        if (prop === 'finally') return (target as Promise<unknown>).finally.bind(target);
        if (prop === 'maybeSingle') return () => Promise.resolve({ data: null, error: null });
        if (prop === 'throwOnError') return () => make();
        return () => make();
      },
    });
  return make();
}
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) }, from: vi.fn(() => thenableTable()) },
}));

vi.mock('@/src/lib/db/fxRates', async (importOriginal) => ({ ...(await importOriginal<object>()), fxContext: vi.fn() }));
vi.mock('@/src/lib/db/m365DocumentSettings', async (importOriginal) => ({ ...(await importOriginal<object>()), getDefaultLibrary: vi.fn() }));
vi.mock('@/src/lib/m365/recordFolders', async (importOriginal) => ({ ...(await importOriginal<object>()), linkExistingRecordFolders: vi.fn() }));
vi.mock('@/src/lib/db/recordChanges', async (importOriginal) => ({ ...(await importOriginal<object>()), listRecordHistory: vi.fn() }));
vi.mock('@/src/lib/db/vendorWithholdingSlips', async (importOriginal) => ({ ...(await importOriginal<object>()), listSlips: vi.fn() }));
vi.mock('@/src/lib/db/projects', async (importOriginal) => ({ ...(await importOriginal<object>()), listProjects: vi.fn() }));
vi.mock('@/src/lib/db/companies', async (importOriginal) => ({ ...(await importOriginal<object>()), listClientCompanies: vi.fn() }));
vi.mock('@/src/lib/db/documents', async (importOriginal) => ({ ...(await importOriginal<object>()), listProjectDocuments: vi.fn() }));
vi.mock('@/src/lib/db/agentThreads', async (importOriginal) => ({ ...(await importOriginal<object>()), createAgentThread: vi.fn() }));
vi.mock('@/src/lib/db/profiles', async (importOriginal) => ({ ...(await importOriginal<object>()), listProjectManagers: vi.fn() }));
vi.mock('@/src/lib/db/procurements', async (importOriginal) => ({ ...(await importOriginal<object>()), listProcurements: vi.fn() }));
vi.mock('@/src/lib/db/revenue', async (importOriginal) => ({ ...(await importOriginal<object>()), listSalesInvoices: vi.fn() }));
vi.mock('@/src/lib/db/timesheets', async (importOriginal) => ({ ...(await importOriginal<object>()), listTimesheets: vi.fn() }));
vi.mock('@/src/lib/db/budgets', async (importOriginal) => ({ ...(await importOriginal<object>()), listBudgetVersions: vi.fn() }));
vi.mock('@/src/lib/db/tasks', async (importOriginal) => ({ ...(await importOriginal<object>()), listTasks: vi.fn() }));
vi.mock('@/src/lib/db/incidents', async (importOriginal) => ({ ...(await importOriginal<object>()), listIncidents: vi.fn() }));
vi.mock('@/src/lib/db/milestones', async (importOriginal) => ({ ...(await importOriginal<object>()), listMilestones: vi.fn() }));
vi.mock('@/src/lib/db/workOrders', async (importOriginal) => ({ ...(await importOriginal<object>()), listProjectWorkOrders: vi.fn() }));
vi.mock('@/src/lib/db/progressBilling', async (importOriginal) => ({ ...(await importOriginal<object>()), listBoqItems: vi.fn() }));
vi.mock('@/src/lib/db/workOrderAcceptances', async (importOriginal) => ({ ...(await importOriginal<object>()), listProjectAcceptances: vi.fn() }));
vi.mock('@/src/lib/db/procurementFiles', async (importOriginal) => ({ ...(await importOriginal<object>()), listProcurementFiles: vi.fn() }));
vi.mock('@/src/lib/db/expenseClaims', async (importOriginal) => ({ ...(await importOriginal<object>()), listExpenseClaims: vi.fn() }));
vi.mock('@/src/lib/db/imprest', async (importOriginal) => ({ ...(await importOriginal<object>()), listCounts: vi.fn() }));
vi.mock('@/src/lib/db/expenseReceipts', async (importOriginal) => ({ ...(await importOriginal<object>()), listExpenseReceipts: vi.fn() }));
vi.mock('@/src/lib/db/contacts', async (importOriginal) => ({ ...(await importOriginal<object>()), listContacts: vi.fn() }));
vi.mock('@/src/lib/db/meetings', async (importOriginal) => ({ ...(await importOriginal<object>()), listMeetings: vi.fn() }));
vi.mock('@/src/lib/db/userViews', async (importOriginal) => ({ ...(await importOriginal<object>()), listUserViews: vi.fn() }));
vi.mock('@/src/lib/db/operators', async (importOriginal) => ({ ...(await importOriginal<object>()), isOperator: vi.fn() }));
vi.mock('@/src/lib/db/usage', async (importOriginal) => ({ ...(await importOriginal<object>()), getOrgUsageSummary: vi.fn() }));
vi.mock('@/src/lib/db/orgFeatures', async (importOriginal) => ({ ...(await importOriginal<object>()), listOwnOrgFeatures: vi.fn(), getOrgCreditBalance: vi.fn() }));
vi.mock('@/src/lib/db/orgs', async (importOriginal) => ({ ...(await importOriginal<object>()), getOrgTaxDefault: vi.fn() }));
vi.mock('@/src/lib/db/externalDomainOwnership', async (importOriginal) => ({ ...(await importOriginal<object>()), listOwnExternalDomainOwnership: vi.fn() }));
vi.mock('@/src/lib/db/erpSnapshots', async (importOriginal) => ({ ...(await importOriginal<object>()), listActualsSnapshot: vi.fn() }));
vi.mock('@/src/lib/db/managementPack', async (importOriginal) => ({ ...(await importOriginal<object>()), getManagementPackFacts: vi.fn() }));
vi.mock('@/src/lib/db/companyCollections', async (importOriginal) => ({ ...(await importOriginal<object>()), listCompanyPartyRefs: vi.fn() }));
vi.mock('@/src/lib/db/financialStatements', async (importOriginal) => ({ ...(await importOriginal<object>()), getFinancialStatementCatalogue: vi.fn() }));
vi.mock('@/src/lib/pagedRead', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchAllRowsByKeyset: vi.fn() }));

import { repositories } from './index';
import type { Repositories } from './types';

const SENTINEL = { wired: 'composition' } as unknown;

/** `passthrough` asserts the DAL result comes back verbatim; `called` only asserts the
 *  entry point ran once (the wrapper maps or reshapes the result by contract). */
type Row = {
  member: keyof Repositories;
  method: string;
  mod: string;
  fn: string;
  args: unknown[];
  mode?: 'passthrough' | 'called';
  resolve?: unknown;
};

const ROWS: Row[] = [
  { member: 'fxRates', method: 'context', mod: '@/src/lib/db/fxRates', fn: 'fxContext', args: [] },
  { member: 'm365DocumentSettings', method: 'getDefaultLibrary', mod: '@/src/lib/db/m365DocumentSettings', fn: 'getDefaultLibrary', args: [] },
  { member: 'm365RecordFolders', method: 'linkExisting', mod: '@/src/lib/m365/recordFolders', fn: 'linkExistingRecordFolders', args: [] },
  { member: 'recordHistory', method: 'list', mod: '@/src/lib/db/recordChanges', fn: 'listRecordHistory', args: [{ entityType: 'project', entityId: 'p1' }], mode: 'called', resolve: [] },
  { member: 'vendorWithholdingSlips', method: 'listSlips', mod: '@/src/lib/db/vendorWithholdingSlips', fn: 'listSlips', args: [], mode: 'called' },
  { member: 'project', method: 'list', mod: '@/src/lib/db/projects', fn: 'listProjects', args: [] },
  { member: 'company', method: 'listClients', mod: '@/src/lib/db/companies', fn: 'listClientCompanies', args: [] },
  { member: 'document', method: 'list', mod: '@/src/lib/db/documents', fn: 'listProjectDocuments', args: ['p1'] },
  { member: 'agentAttachment', method: 'createThread', mod: '@/src/lib/db/agentThreads', fn: 'createAgentThread', args: ['weekly'] },
  { member: 'profile', method: 'listProjectManagers', mod: '@/src/lib/db/profiles', fn: 'listProjectManagers', args: [] },
  { member: 'procurement', method: 'list', mod: '@/src/lib/db/procurements', fn: 'listProcurements', args: [] },
  { member: 'revenue', method: 'listInvoices', mod: '@/src/lib/db/revenue', fn: 'listSalesInvoices', args: [] },
  { member: 'timesheet', method: 'list', mod: '@/src/lib/db/timesheets', fn: 'listTimesheets', args: ['u1'] },
  { member: 'budget', method: 'listVersions', mod: '@/src/lib/db/budgets', fn: 'listBudgetVersions', args: ['p1'] },
  { member: 'task', method: 'list', mod: '@/src/lib/db/tasks', fn: 'listTasks', args: ['p1'] },
  { member: 'incident', method: 'list', mod: '@/src/lib/db/incidents', fn: 'listIncidents', args: [] },
  { member: 'milestone', method: 'list', mod: '@/src/lib/db/milestones', fn: 'listMilestones', args: ['p1'] },
  { member: 'workOrder', method: 'list', mod: '@/src/lib/db/workOrders', fn: 'listProjectWorkOrders', args: ['p1'] },
  { member: 'progressBilling', method: 'listBoq', mod: '@/src/lib/db/progressBilling', fn: 'listBoqItems', args: ['p1'] },
  { member: 'workOrderAcceptance', method: 'listByProject', mod: '@/src/lib/db/workOrderAcceptances', fn: 'listProjectAcceptances', args: ['p1'] },
  { member: 'procurementFiles', method: 'list', mod: '@/src/lib/db/procurementFiles', fn: 'listProcurementFiles', args: ['quotation', 'p1'] },
  { member: 'expenseClaim', method: 'list', mod: '@/src/lib/db/expenseClaims', fn: 'listExpenseClaims', args: [], mode: 'called' },
  { member: 'imprest', method: 'listCounts', mod: '@/src/lib/db/imprest', fn: 'listCounts', args: ['f1'] },
  { member: 'expenseReceipts', method: 'list', mod: '@/src/lib/db/expenseReceipts', fn: 'listExpenseReceipts', args: ['c1'] },
  { member: 'expensePostings', method: 'listAccountMap', mod: '@/src/lib/supabase/client', fn: 'supabase', args: [], mode: 'called' },
  { member: 'erpPurchases', method: 'list', mod: '@/src/lib/pagedRead', fn: 'fetchAllRowsByKeyset', args: [], mode: 'called', resolve: [] },
  { member: 'contact', method: 'list', mod: '@/src/lib/db/contacts', fn: 'listContacts', args: [] },
  { member: 'meeting', method: 'list', mod: '@/src/lib/db/meetings', fn: 'listMeetings', args: [] },
  { member: 'userView', method: 'list', mod: '@/src/lib/db/userViews', fn: 'listUserViews', args: [] },
  { member: 'operator', method: 'isOperator', mod: '@/src/lib/db/operators', fn: 'isOperator', args: [] },
  { member: 'usage', method: 'getOrgUsageSummary', mod: '@/src/lib/db/usage', fn: 'getOrgUsageSummary', args: [] },
  { member: 'orgFeature', method: 'listOwn', mod: '@/src/lib/db/orgFeatures', fn: 'listOwnOrgFeatures', args: [], mode: 'called' },
  { member: 'orgSettings', method: 'getTaxDefault', mod: '@/src/lib/db/orgs', fn: 'getOrgTaxDefault', args: [] },
  { member: 'credits', method: 'getOrgBalance', mod: '@/src/lib/db/orgFeatures', fn: 'getOrgCreditBalance', args: ['org-1'] },
  { member: 'externalDomainOwnership', method: 'listOwn', mod: '@/src/lib/db/externalDomainOwnership', fn: 'listOwnExternalDomainOwnership', args: [] },
  { member: 'erpSnapshots', method: 'actuals', mod: '@/src/lib/db/erpSnapshots', fn: 'listActualsSnapshot', args: [] },
  { member: 'companyCollections', method: 'listPartyIds', mod: '@/src/lib/db/companyCollections', fn: 'listCompanyPartyRefs', args: [['c1', 'c2']] },
  { member: 'financialStatements', method: 'catalogue', mod: '@/src/lib/db/financialStatements', fn: 'getFinancialStatementCatalogue', args: [] },
  { member: 'reports', method: 'managementPack', mod: '@/src/lib/db/managementPack', fn: 'getManagementPackFacts', args: [{ from: '2026-01-01', to: '2026-02-01' }] },
];

// The integrations member reads `external_org_bindings` through the (mocked) Supabase client.
const AGGREGATE_MEMBERS = Object.keys(repositories);

type AnyRepo = Record<string, (...args: unknown[]) => unknown>;

describe('composition — every aggregate member is wired to its domain implementation (T-29)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes a callable surface on every aggregate member', () => {
    expect(AGGREGATE_MEMBERS.length).toBeGreaterThan(0);
    for (const member of AGGREGATE_MEMBERS) {
      const repo = repositories[member as keyof Repositories] as unknown as Record<string, unknown>;
      expect(Object.keys(repo as Record<string, unknown>).length, member).toBeGreaterThan(0);
      for (const [method, impl] of Object.entries(repo)) {
        // `stock` nests its methods one level down (`stock.master.*`); check those leaves.
        const leaves = typeof impl === 'object' && impl !== null ? Object.entries(impl) : [[method, impl]];
        expect(leaves.length, `${member}.${method}`).toBeGreaterThan(0);
        for (const [leaf, fn] of leaves) {
          expect(typeof fn, `${member}.${method}.${leaf}`).toBe('function');
        }
      }
    }
  });

  for (const row of ROWS) {
    it(`wires repositories.${row.member}.${row.method} to ${row.mod.replace('@/src/lib/', '')}.${row.fn} through the public seam`, async () => {
      const dal = (await import(row.mod)) as unknown as Record<string, unknown>;
      if (row.mod === '@/src/lib/supabase/client') {
        // the table read travels through the mocked client's from() chain
        const fromSpy = (dal.supabase as unknown as { from: Mock }).from;
        await (repositories[row.member] as unknown as AnyRepo)[row.method](...row.args);
        expect(fromSpy).toHaveBeenCalled();
        return;
      }
      const mocked = dal[row.fn] as Mock;
      mocked.mockResolvedValueOnce(row.resolve ?? SENTINEL);
      const result = await (repositories[row.member] as unknown as AnyRepo)[row.method](...row.args);
      expect(mocked).toHaveBeenCalledTimes(1);
      if ((row.mode ?? 'passthrough') === 'passthrough') {
        expect(result).toBe(row.resolve ?? SENTINEL);
      }
    });
  }

  it('wires repositories.integrations.getBinding to the bindings table through the public seam', async () => {
    const client = (await import('@/src/lib/supabase/client')) as unknown as { supabase: { from: Mock } };
    await expect(repositories.integrations.getBinding('org-1', 'erpnext')).resolves.toBeNull();
    expect(client.supabase.from).toHaveBeenCalledWith('external_org_bindings');
  });
});
