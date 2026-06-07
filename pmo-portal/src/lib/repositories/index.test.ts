import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the entire DAL surface the seam delegates to. Each repository method is a
// thin wrapper, so the contract under test is: (a) the method exists, (b) it calls
// the matching DAL fn with the same args, (c) it returns the DAL result, and
// (d) a thrown DAL error is normalized to an AppError (code preserved).
// ---------------------------------------------------------------------------

vi.mock('@/src/lib/db/projects', () => ({ listProjects: vi.fn() }));
vi.mock('@/src/lib/db/opportunity', () => ({ getOpportunity: vi.fn() }));
vi.mock('@/src/lib/db/projectTransitions', () => ({ transitionProject: vi.fn() }));
vi.mock('@/src/lib/db/companies', () => ({
  listClientCompanies: vi.fn(),
  listCompanies: vi.fn(),
  getCompany: vi.fn(),
  createCompany: vi.fn(),
  updateCompany: vi.fn(),
  archiveCompany: vi.fn(),
  deleteCompany: vi.fn(),
}));
vi.mock('@/src/lib/db/profiles', () => ({ listProjectManagers: vi.fn() }));
vi.mock('@/src/lib/db/procurements', () => ({ listProcurements: vi.fn() }));
vi.mock('@/src/lib/db/procurementLifecycle', () => ({
  getProcurementDetail: vi.fn(),
  transitionProcurement: vi.fn(),
  createQuotation: vi.fn(),
  createReceipt: vi.fn(),
  createInvoice: vi.fn(),
}));
vi.mock('@/src/lib/db/timesheets', () => ({
  listTimesheets: vi.fn(),
  createDraftTimesheet: vi.fn(),
  upsertTimesheetEntries: vi.fn(),
  deleteTimesheetEntry: vi.fn(),
}));
vi.mock('@/src/lib/db/timesheetTransition', () => ({
  submitTimesheet: vi.fn(),
  approveTimesheet: vi.fn(),
  rejectTimesheet: vi.fn(),
  listTimesheetsAwaitingApproval: vi.fn(),
}));
vi.mock('@/src/lib/db/budgets', () => ({
  deriveProjectBudget: vi.fn(),
  listBudgetVersions: vi.fn(),
  createLineItem: vi.fn(),
  updateLineItem: vi.fn(),
  deleteLineItem: vi.fn(),
  createBudgetVersion: vi.fn(),
  cloneVersion: vi.fn(),
  activateVersion: vi.fn(),
  archiveVersion: vi.fn(),
  deleteDraftVersion: vi.fn(),
}));
vi.mock('@/src/lib/db/incidents', () => ({
  listIncidents: vi.fn(),
  getIncident: vi.fn(),
  createIncident: vi.fn(),
  updateIncident: vi.fn(),
  transitionIncident: vi.fn(),
  deleteIncident: vi.fn(),
}));

import { repositories } from './index';
import { AppError } from '@/src/lib/appError';
import * as projectsDal from '@/src/lib/db/projects';
import * as opportunityDal from '@/src/lib/db/opportunity';
import * as projectTransitionsDal from '@/src/lib/db/projectTransitions';
import * as companiesDal from '@/src/lib/db/companies';
import * as profilesDal from '@/src/lib/db/profiles';
import * as procurementsDal from '@/src/lib/db/procurements';
import * as procLifecycleDal from '@/src/lib/db/procurementLifecycle';
import * as timesheetsDal from '@/src/lib/db/timesheets';
import * as tsTransitionDal from '@/src/lib/db/timesheetTransition';
import * as budgetsDal from '@/src/lib/db/budgets';
import * as incidentsDal from '@/src/lib/db/incidents';

beforeEach(() => vi.clearAllMocks());

describe('repositories object shape (ADR-0017 API seam)', () => {
  it('exposes one repository per entity', () => {
    expect(Object.keys(repositories).sort()).toEqual(
      ['budget', 'company', 'incident', 'procurement', 'profile', 'project', 'timesheet'].sort(),
    );
  });

  it('each repository exposes its expected methods', () => {
    expect(Object.keys(repositories.project).sort()).toEqual(['get', 'list', 'transition']);
    expect(Object.keys(repositories.company).sort()).toEqual(
      ['archive', 'create', 'delete', 'get', 'list', 'listClients', 'update'].sort(),
    );
    expect(Object.keys(repositories.profile).sort()).toEqual(['listProjectManagers']);
    expect(Object.keys(repositories.procurement).sort()).toEqual(
      ['createInvoice', 'createQuotation', 'createReceipt', 'get', 'list', 'transition'].sort(),
    );
    expect(Object.keys(repositories.timesheet).sort()).toEqual(
      ['approve', 'createDraft', 'deleteEntry', 'list', 'listAwaitingApproval', 'reject', 'submit', 'upsertEntries'].sort(),
    );
    expect(Object.keys(repositories.budget).sort()).toEqual(
      ['activateVersion', 'archiveVersion', 'cloneVersion', 'createLineItem', 'createVersion', 'deriveProjectBudget', 'deleteDraftVersion', 'deleteLineItem', 'listVersions', 'updateLineItem'].sort(),
    );
    expect(Object.keys(repositories.incident).sort()).toEqual(
      ['create', 'delete', 'get', 'list', 'transition', 'update'].sort(),
    );
  });
});

describe('delegation — methods pass args through and return the DAL result', () => {
  it('project.list delegates to listProjects', async () => {
    const rows = [{ id: 'p1' }];
    vi.mocked(projectsDal.listProjects).mockResolvedValue(rows as never);
    const params = { status: 'Leads' as never };
    const result = await repositories.project.list(params);
    expect(projectsDal.listProjects).toHaveBeenCalledWith(params);
    expect(result).toBe(rows);
  });

  it('project.get delegates to getOpportunity', async () => {
    vi.mocked(opportunityDal.getOpportunity).mockResolvedValue({ id: 'o1' } as never);
    await repositories.project.get('o1');
    expect(opportunityDal.getOpportunity).toHaveBeenCalledWith('o1');
  });

  it('project.transition delegates to transitionProject with opts', async () => {
    vi.mocked(projectTransitionsDal.transitionProject).mockResolvedValue(undefined);
    const opts = { customerContractRef: 'PO-9' };
    await repositories.project.transition('p1', 'Won, Pending KoM' as never, opts);
    expect(projectTransitionsDal.transitionProject).toHaveBeenCalledWith('p1', 'Won, Pending KoM', opts);
  });

  it('company.listClients delegates to listClientCompanies', async () => {
    vi.mocked(companiesDal.listClientCompanies).mockResolvedValue([] as never);
    await repositories.company.listClients();
    expect(companiesDal.listClientCompanies).toHaveBeenCalledTimes(1);
  });

  it('AC-CO-001..006: company CRUD methods delegate to the companies DAL fns', async () => {
    vi.mocked(companiesDal.listCompanies).mockResolvedValue([] as never);
    vi.mocked(companiesDal.getCompany).mockResolvedValue({ id: 'c1' } as never);
    vi.mocked(companiesDal.createCompany).mockResolvedValue({ id: 'new' } as never);
    vi.mocked(companiesDal.updateCompany).mockResolvedValue(undefined);
    vi.mocked(companiesDal.archiveCompany).mockResolvedValue(undefined);
    vi.mocked(companiesDal.deleteCompany).mockResolvedValue(undefined);

    const params = { type: 'Vendor' as never };
    await repositories.company.list(params);
    expect(companiesDal.listCompanies).toHaveBeenCalledWith(params);

    await repositories.company.list();
    expect(companiesDal.listCompanies).toHaveBeenLastCalledWith(undefined);

    await repositories.company.get('c1');
    expect(companiesDal.getCompany).toHaveBeenCalledWith('c1');

    const input = { name: 'Globex', type: 'Vendor' as never };
    await repositories.company.create(input);
    expect(companiesDal.createCompany).toHaveBeenCalledWith(input);

    await repositories.company.update('c1', input);
    expect(companiesDal.updateCompany).toHaveBeenCalledWith('c1', input);

    await repositories.company.archive('c1');
    expect(companiesDal.archiveCompany).toHaveBeenCalledWith('c1');

    await repositories.company.delete('c1');
    expect(companiesDal.deleteCompany).toHaveBeenCalledWith('c1');
  });

  it('AC-CO-006: company.delete normalizes a 23503 FK violation to AppError preserving the code', async () => {
    const fk = Object.assign(new Error('violates foreign key constraint'), { code: '23503' });
    vi.mocked(companiesDal.deleteCompany).mockRejectedValue(fk);
    await expect(repositories.company.delete('c1')).rejects.toMatchObject({
      name: 'AppError',
      code: '23503',
    });
    await expect(repositories.company.delete('c1')).rejects.toBeInstanceOf(AppError);
  });

  it('profile.listProjectManagers delegates', async () => {
    vi.mocked(profilesDal.listProjectManagers).mockResolvedValue([] as never);
    await repositories.profile.listProjectManagers();
    expect(profilesDal.listProjectManagers).toHaveBeenCalledTimes(1);
  });

  it('procurement.list / get / transition / create* delegate', async () => {
    vi.mocked(procurementsDal.listProcurements).mockResolvedValue([] as never);
    vi.mocked(procLifecycleDal.getProcurementDetail).mockResolvedValue({ id: 'pr1' } as never);
    vi.mocked(procLifecycleDal.transitionProcurement).mockResolvedValue(undefined);
    vi.mocked(procLifecycleDal.createQuotation).mockResolvedValue({} as never);
    vi.mocked(procLifecycleDal.createReceipt).mockResolvedValue({} as never);
    vi.mocked(procLifecycleDal.createInvoice).mockResolvedValue({} as never);

    await repositories.procurement.list();
    expect(procurementsDal.listProcurements).toHaveBeenCalledTimes(1);

    await repositories.procurement.get('pr1');
    expect(procLifecycleDal.getProcurementDetail).toHaveBeenCalledWith('pr1');

    await repositories.procurement.transition('pr1', 'Requested' as never, 'note');
    expect(procLifecycleDal.transitionProcurement).toHaveBeenCalledWith('pr1', 'Requested', 'note');

    await repositories.procurement.createQuotation('pr1', 'v1', 100, '2026-06-07');
    expect(procLifecycleDal.createQuotation).toHaveBeenCalledWith('pr1', 'v1', 100, '2026-06-07');

    await repositories.procurement.createReceipt('pr1', 'Complete', '2026-06-07');
    expect(procLifecycleDal.createReceipt).toHaveBeenCalledWith('pr1', 'Complete', '2026-06-07');

    await repositories.procurement.createInvoice('pr1', 'Received', '2026-06-07');
    expect(procLifecycleDal.createInvoice).toHaveBeenCalledWith('pr1', 'Received', '2026-06-07');
  });

  it('timesheet methods delegate to the timesheet DAL fns', async () => {
    vi.mocked(timesheetsDal.listTimesheets).mockResolvedValue([] as never);
    vi.mocked(timesheetsDal.createDraftTimesheet).mockResolvedValue({} as never);
    vi.mocked(timesheetsDal.upsertTimesheetEntries).mockResolvedValue(undefined);
    vi.mocked(timesheetsDal.deleteTimesheetEntry).mockResolvedValue(undefined);
    vi.mocked(tsTransitionDal.submitTimesheet).mockResolvedValue(undefined);
    vi.mocked(tsTransitionDal.approveTimesheet).mockResolvedValue(undefined);
    vi.mocked(tsTransitionDal.rejectTimesheet).mockResolvedValue(undefined);
    vi.mocked(tsTransitionDal.listTimesheetsAwaitingApproval).mockResolvedValue([] as never);

    await repositories.timesheet.list('u1');
    expect(timesheetsDal.listTimesheets).toHaveBeenCalledWith('u1');

    await repositories.timesheet.createDraft('2026-06-01', 'u1');
    expect(timesheetsDal.createDraftTimesheet).toHaveBeenCalledWith('2026-06-01', 'u1');

    const entries = [{ timesheet_id: 't1' }] as never;
    await repositories.timesheet.upsertEntries(entries);
    expect(timesheetsDal.upsertTimesheetEntries).toHaveBeenCalledWith(entries);

    await repositories.timesheet.deleteEntry('e1');
    expect(timesheetsDal.deleteTimesheetEntry).toHaveBeenCalledWith('e1');

    await repositories.timesheet.submit('t1');
    expect(tsTransitionDal.submitTimesheet).toHaveBeenCalledWith('t1');

    await repositories.timesheet.approve('t1', 'ok');
    expect(tsTransitionDal.approveTimesheet).toHaveBeenCalledWith('t1', 'ok');

    await repositories.timesheet.reject('t1', 'no');
    expect(tsTransitionDal.rejectTimesheet).toHaveBeenCalledWith('t1', 'no');

    await repositories.timesheet.listAwaitingApproval('u1');
    expect(tsTransitionDal.listTimesheetsAwaitingApproval).toHaveBeenCalledWith('u1');
  });

  it('budget methods delegate to the budget DAL fns', async () => {
    vi.mocked(budgetsDal.deriveProjectBudget).mockResolvedValue(0);
    vi.mocked(budgetsDal.listBudgetVersions).mockResolvedValue([] as never);
    vi.mocked(budgetsDal.createLineItem).mockResolvedValue({} as never);
    vi.mocked(budgetsDal.updateLineItem).mockResolvedValue(undefined);
    vi.mocked(budgetsDal.deleteLineItem).mockResolvedValue(undefined);
    vi.mocked(budgetsDal.createBudgetVersion).mockResolvedValue({} as never);
    vi.mocked(budgetsDal.cloneVersion).mockResolvedValue('v2');
    vi.mocked(budgetsDal.activateVersion).mockResolvedValue(undefined);
    vi.mocked(budgetsDal.archiveVersion).mockResolvedValue(undefined);
    vi.mocked(budgetsDal.deleteDraftVersion).mockResolvedValue(undefined);

    await repositories.budget.deriveProjectBudget('p1');
    expect(budgetsDal.deriveProjectBudget).toHaveBeenCalledWith('p1');

    await repositories.budget.listVersions('p1');
    expect(budgetsDal.listBudgetVersions).toHaveBeenCalledWith('p1');

    const item = { category: 'Labour', description: null, budgeted_amount: 5 } as never;
    await repositories.budget.createLineItem('v1', item);
    expect(budgetsDal.createLineItem).toHaveBeenCalledWith('v1', item);

    await repositories.budget.updateLineItem('li1', { budgeted_amount: 9 } as never);
    expect(budgetsDal.updateLineItem).toHaveBeenCalledWith('li1', { budgeted_amount: 9 });

    await repositories.budget.deleteLineItem('li1');
    expect(budgetsDal.deleteLineItem).toHaveBeenCalledWith('li1');

    await repositories.budget.createVersion('p1', 'v2');
    expect(budgetsDal.createBudgetVersion).toHaveBeenCalledWith('p1', 'v2');

    await repositories.budget.cloneVersion('v1');
    expect(budgetsDal.cloneVersion).toHaveBeenCalledWith('v1');

    await repositories.budget.activateVersion('v1');
    expect(budgetsDal.activateVersion).toHaveBeenCalledWith('v1');

    await repositories.budget.archiveVersion('v1');
    expect(budgetsDal.archiveVersion).toHaveBeenCalledWith('v1');

    await repositories.budget.deleteDraftVersion('v1');
    expect(budgetsDal.deleteDraftVersion).toHaveBeenCalledWith('v1');
  });

  it('AC-IN-001..005: incident methods delegate to the incidents DAL fns', async () => {
    vi.mocked(incidentsDal.listIncidents).mockResolvedValue([] as never);
    vi.mocked(incidentsDal.getIncident).mockResolvedValue({ id: 'i1' } as never);
    vi.mocked(incidentsDal.createIncident).mockResolvedValue({ id: 'new' } as never);
    vi.mocked(incidentsDal.updateIncident).mockResolvedValue(undefined);
    vi.mocked(incidentsDal.transitionIncident).mockResolvedValue(undefined);
    vi.mocked(incidentsDal.deleteIncident).mockResolvedValue(undefined);

    const params = { status: 'Open' as never };
    await repositories.incident.list(params);
    expect(incidentsDal.listIncidents).toHaveBeenCalledWith(params);

    await repositories.incident.list();
    expect(incidentsDal.listIncidents).toHaveBeenLastCalledWith(undefined);

    await repositories.incident.get('i1');
    expect(incidentsDal.getIncident).toHaveBeenCalledWith('i1');

    const input = { incident_date: '2026-06-08', type: 'Near Miss', severity: 'Low' as never };
    await repositories.incident.create(input);
    expect(incidentsDal.createIncident).toHaveBeenCalledWith(input);

    await repositories.incident.update('i1', input);
    expect(incidentsDal.updateIncident).toHaveBeenCalledWith('i1', input);

    await repositories.incident.transition('i1', 'Investigating' as never);
    expect(incidentsDal.transitionIncident).toHaveBeenCalledWith('i1', 'Investigating');

    await repositories.incident.delete('i1');
    expect(incidentsDal.deleteIncident).toHaveBeenCalledWith('i1');
  });

  it('AC-IN-004: incident.transition normalizes a 42501 RLS denial to AppError preserving the code', async () => {
    const sod = Object.assign(new Error('permission denied'), { code: '42501' });
    vi.mocked(incidentsDal.transitionIncident).mockRejectedValue(sod);
    await expect(repositories.incident.transition('i1', 'Closed' as never)).rejects.toMatchObject({
      name: 'AppError',
      code: '42501',
    });
    await expect(
      repositories.incident.transition('i1', 'Closed' as never),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('error normalization — DAL errors become AppError with code preserved', () => {
  it('rethrows a code-bearing DAL error as AppError preserving code (e.g. 42501 SoD)', async () => {
    const sod = Object.assign(new Error('permission denied'), { code: '42501' });
    vi.mocked(procLifecycleDal.transitionProcurement).mockRejectedValue(sod);
    await expect(repositories.procurement.transition('pr1', 'Approved' as never)).rejects.toMatchObject({
      name: 'AppError',
      message: 'permission denied',
      code: '42501',
    });
    await expect(
      repositories.procurement.transition('pr1', 'Approved' as never),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rethrows a plain DAL error as AppError with undefined code', async () => {
    vi.mocked(projectsDal.listProjects).mockRejectedValue(new Error('network down'));
    await expect(repositories.project.list()).rejects.toMatchObject({
      name: 'AppError',
      message: 'network down',
      code: undefined,
    });
  });
});
