import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the entire DAL surface the seam delegates to. Each repository method is a
// thin wrapper, so the contract under test is: (a) the method exists, (b) it calls
// the matching DAL fn with the same args, (c) it returns the DAL result, and
// (d) a thrown DAL error is normalized to an AppError (code preserved).
// ---------------------------------------------------------------------------

vi.mock('@/src/lib/db/projects', () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProjectHeader: vi.fn(),
  archiveProject: vi.fn(),
  deleteProject: vi.fn(),
  setProjectContractValue: vi.fn(),
}));
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
vi.mock('@/src/lib/db/documents', () => ({
  listProjectDocuments: vi.fn(),
  getProjectDocument: vi.fn(),
  createProjectDocument: vi.fn(),
  updateProjectDocument: vi.fn(),
  transitionProjectDocument: vi.fn(),
  deleteProjectDocument: vi.fn(),
}));
vi.mock('@/src/lib/db/profiles', () => ({ listProjectManagers: vi.fn(), listOrgProfiles: vi.fn() }));
vi.mock('@/src/lib/db/adminUsers', () => ({
  listUsers: vi.fn(),
  updateUserRole: vi.fn(),
  assignUserManager: vi.fn(),
}));
vi.mock('@/src/lib/db/tasks', () => ({
  listTasks: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  updateTaskStatus: vi.fn(),
  deleteTask: vi.fn(),
  addDependency: vi.fn(),
  removeDependency: vi.fn(),
}));
vi.mock('@/src/lib/db/procurements', () => ({ listProcurements: vi.fn() }));
vi.mock('@/src/lib/db/procurementLifecycle', () => ({
  getProcurementDetail: vi.fn(),
  transitionProcurement: vi.fn(),
  createQuotation: vi.fn(),
  createReceipt: vi.fn(),
  createInvoice: vi.fn(),
}));
vi.mock('@/src/lib/db/procurementCrud', () => ({
  createProcurement: vi.fn(),
  updateProcurementHeader: vi.fn(),
  createProcurementItem: vi.fn(),
  updateProcurementItem: vi.fn(),
  deleteProcurementItem: vi.fn(),
  selectProcurementQuote: vi.fn(),
  listProcurementDocuments: vi.fn(),
  createProcurementDocument: vi.fn(),
  deleteProcurementDocument: vi.fn(),
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
vi.mock('@/src/lib/db/milestones', () => ({
  listMilestones: vi.fn(),
  getProjectsDelivery: vi.fn(),
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  updateTaskMilestone: vi.fn(),
}));

import { repositories } from './index';
import { AppError } from '@/src/lib/appError';
import * as projectsDal from '@/src/lib/db/projects';
import * as opportunityDal from '@/src/lib/db/opportunity';
import * as projectTransitionsDal from '@/src/lib/db/projectTransitions';
import * as companiesDal from '@/src/lib/db/companies';
import * as documentsDal from '@/src/lib/db/documents';
import * as profilesDal from '@/src/lib/db/profiles';
import * as adminUsersDal from '@/src/lib/db/adminUsers';
import * as procurementsDal from '@/src/lib/db/procurements';
import * as procLifecycleDal from '@/src/lib/db/procurementLifecycle';
import * as procCrudDal from '@/src/lib/db/procurementCrud';
import * as timesheetsDal from '@/src/lib/db/timesheets';
import * as tsTransitionDal from '@/src/lib/db/timesheetTransition';
import * as budgetsDal from '@/src/lib/db/budgets';
import * as tasksDal from '@/src/lib/db/tasks';
import * as incidentsDal from '@/src/lib/db/incidents';
import * as milestonesDal from '@/src/lib/db/milestones';

beforeEach(() => vi.clearAllMocks());

describe('repositories object shape (ADR-0017 API seam)', () => {
  it('exposes one repository per entity', () => {
    expect(Object.keys(repositories).sort()).toEqual(
      ['budget', 'company', 'document', 'incident', 'milestone', 'procurement', 'profile', 'project', 'task', 'timesheet'].sort(),
    );
  });

  it('each repository exposes its expected methods', () => {
    expect(Object.keys(repositories.project).sort()).toEqual(
      ['archive', 'create', 'delete', 'get', 'list', 'setContractValue', 'transition', 'updateHeader'].sort(),
    );
    expect(Object.keys(repositories.company).sort()).toEqual(
      ['archive', 'create', 'delete', 'get', 'list', 'listClients', 'update'].sort(),
    );
    expect(Object.keys(repositories.document).sort()).toEqual(
      ['create', 'delete', 'get', 'list', 'transition', 'update'].sort(),
    );
    expect(Object.keys(repositories.profile).sort()).toEqual(
      ['assignUserManager', 'listOrgProfiles', 'listProjectManagers', 'listUsers', 'updateUserRole'].sort(),
    );
    expect(Object.keys(repositories.task).sort()).toEqual(
      ['addDependency', 'create', 'delete', 'get', 'list', 'removeDependency', 'update', 'updateStatus'].sort(),
    );
    expect(Object.keys(repositories.procurement).sort()).toEqual(
      [
        'create',
        'createDocument',
        'createInvoice',
        'createItem',
        'createQuotation',
        'createReceipt',
        'deleteDocument',
        'deleteItem',
        'get',
        'list',
        'listDocuments',
        'selectQuote',
        'transition',
        'updateHeader',
        'updateItem',
      ].sort(),
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

  it('project.create delegates to createProject', async () => {
    const input = { name: 'New', status: 'Leads' } as never;
    vi.mocked(projectsDal.createProject).mockResolvedValue({ id: 'p9' } as never);
    const result = await repositories.project.create(input);
    expect(projectsDal.createProject).toHaveBeenCalledWith(input);
    expect((result as { id: string }).id).toBe('p9');
  });

  it('project.updateHeader delegates to updateProjectHeader', async () => {
    const input = { name: 'Renamed' } as never;
    vi.mocked(projectsDal.updateProjectHeader).mockResolvedValue(undefined);
    await repositories.project.updateHeader('p1', input);
    expect(projectsDal.updateProjectHeader).toHaveBeenCalledWith('p1', input);
  });

  it('project.archive delegates to archiveProject', async () => {
    vi.mocked(projectsDal.archiveProject).mockResolvedValue(undefined);
    await repositories.project.archive('p1');
    expect(projectsDal.archiveProject).toHaveBeenCalledWith('p1');
  });

  it('AC-PRJ-007: project.delete delegates to deleteProject and normalizes the error to AppError', async () => {
    vi.mocked(projectsDal.deleteProject).mockResolvedValue(undefined);
    await repositories.project.delete('p1');
    expect(projectsDal.deleteProject).toHaveBeenCalledWith('p1');

    const fk = Object.assign(new Error('referenced'), { code: '23503' });
    vi.mocked(projectsDal.deleteProject).mockRejectedValue(fk);
    await expect(repositories.project.delete('p1')).rejects.toMatchObject({ code: '23503' });
    await expect(repositories.project.delete('p1')).rejects.toBeInstanceOf(AppError);
  });

  it('project.setContractValue delegates to setProjectContractValue (SoD RPC)', async () => {
    vi.mocked(projectsDal.setProjectContractValue).mockResolvedValue(undefined);
    await repositories.project.setContractValue('p1', 5140000);
    expect(projectsDal.setProjectContractValue).toHaveBeenCalledWith('p1', 5140000);
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

  it('AC-DOC-001..006: document CRUD + transition methods delegate to the documents DAL fns', async () => {
    vi.mocked(documentsDal.listProjectDocuments).mockResolvedValue([] as never);
    vi.mocked(documentsDal.getProjectDocument).mockResolvedValue({ id: 'd1' } as never);
    vi.mocked(documentsDal.createProjectDocument).mockResolvedValue({ id: 'new' } as never);
    vi.mocked(documentsDal.updateProjectDocument).mockResolvedValue(undefined);
    vi.mocked(documentsDal.transitionProjectDocument).mockResolvedValue(undefined);
    vi.mocked(documentsDal.deleteProjectDocument).mockResolvedValue(undefined);

    await repositories.document.list('p1');
    expect(documentsDal.listProjectDocuments).toHaveBeenCalledWith('p1');

    await repositories.document.get('d1');
    expect(documentsDal.getProjectDocument).toHaveBeenCalledWith('d1');

    const input = { code: 'DOC-1', category: 'Drawing', title: 'T', revision: 'A', doc_date: '2026-06-08' };
    await repositories.document.create('p1', input, 'author-1');
    expect(documentsDal.createProjectDocument).toHaveBeenCalledWith('p1', input, 'author-1');

    await repositories.document.update('d1', input);
    expect(documentsDal.updateProjectDocument).toHaveBeenCalledWith('d1', input);

    await repositories.document.transition('d1', 'Issued' as never);
    expect(documentsDal.transitionProjectDocument).toHaveBeenCalledWith('d1', 'Issued');

    await repositories.document.delete('d1');
    expect(documentsDal.deleteProjectDocument).toHaveBeenCalledWith('d1');
  });

  it('profile.listProjectManagers delegates', async () => {
    vi.mocked(profilesDal.listProjectManagers).mockResolvedValue([] as never);
    await repositories.profile.listProjectManagers();
    expect(profilesDal.listProjectManagers).toHaveBeenCalledTimes(1);
  });

  it('AC-TASK-008: profile.listOrgProfiles delegates to listOrgProfiles', async () => {
    vi.mocked(profilesDal.listOrgProfiles).mockResolvedValue([] as never);
    await repositories.profile.listOrgProfiles();
    expect(profilesDal.listOrgProfiles).toHaveBeenCalledTimes(1);
  });

  it('AC-AU-001/003/004: profile admin-users methods delegate to the adminUsers DAL', async () => {
    vi.mocked(adminUsersDal.listUsers).mockResolvedValue([] as never);
    vi.mocked(adminUsersDal.updateUserRole).mockResolvedValue(undefined);
    vi.mocked(adminUsersDal.assignUserManager).mockResolvedValue(undefined);

    await repositories.profile.listUsers();
    expect(adminUsersDal.listUsers).toHaveBeenCalledTimes(1);

    await repositories.profile.updateUserRole('u2', 'Executive' as never);
    expect(adminUsersDal.updateUserRole).toHaveBeenCalledWith('u2', 'Executive');

    await repositories.profile.assignUserManager('u3', 'mgr-1');
    expect(adminUsersDal.assignUserManager).toHaveBeenCalledWith('u3', 'mgr-1');

    await repositories.profile.assignUserManager('u3', null);
    expect(adminUsersDal.assignUserManager).toHaveBeenLastCalledWith('u3', null);
  });

  it('AC-TASK-001..007: task methods delegate to the tasks DAL fns', async () => {
    vi.mocked(tasksDal.listTasks).mockResolvedValue([] as never);
    vi.mocked(tasksDal.getTask).mockResolvedValue({ id: 't1' } as never);
    vi.mocked(tasksDal.createTask).mockResolvedValue({ id: 'new' } as never);
    vi.mocked(tasksDal.updateTask).mockResolvedValue(undefined);
    vi.mocked(tasksDal.updateTaskStatus).mockResolvedValue(undefined);
    vi.mocked(tasksDal.deleteTask).mockResolvedValue(undefined);
    vi.mocked(tasksDal.addDependency).mockResolvedValue(undefined);
    vi.mocked(tasksDal.removeDependency).mockResolvedValue(undefined);

    await repositories.task.list('p1');
    expect(tasksDal.listTasks).toHaveBeenCalledWith('p1');

    await repositories.task.get('t1');
    expect(tasksDal.getTask).toHaveBeenCalledWith('t1');

    const input = { project_id: 'p1', name: 'T', status: 'To Do' as never, assignee_id: null };
    await repositories.task.create(input);
    expect(tasksDal.createTask).toHaveBeenCalledWith(input);

    await repositories.task.update('t1', { name: 'X' });
    expect(tasksDal.updateTask).toHaveBeenCalledWith('t1', { name: 'X' });

    await repositories.task.updateStatus('t1', 'Done' as never);
    expect(tasksDal.updateTaskStatus).toHaveBeenCalledWith('t1', 'Done');

    await repositories.task.delete('t1');
    expect(tasksDal.deleteTask).toHaveBeenCalledWith('t1');

    await repositories.task.addDependency('t2', 't1');
    expect(tasksDal.addDependency).toHaveBeenCalledWith('t2', 't1');

    await repositories.task.removeDependency('t2', 't1');
    expect(tasksDal.removeDependency).toHaveBeenCalledWith('t2', 't1');
  });

  it('AC-TASK-005: task.updateStatus normalizes a 42501 RLS denial to AppError preserving the code', async () => {
    const denied = Object.assign(new Error('permission denied'), { code: '42501' });
    vi.mocked(tasksDal.updateTaskStatus).mockRejectedValue(denied);
    await expect(repositories.task.updateStatus('t1', 'Done' as never)).rejects.toMatchObject({
      name: 'AppError',
      code: '42501',
    });
    await expect(repositories.task.updateStatus('t1', 'Done' as never)).rejects.toBeInstanceOf(AppError);
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

  it('procurement CRUD methods (create/header/items/selectQuote/documents) delegate', async () => {
    vi.mocked(procCrudDal.createProcurement).mockResolvedValue({ id: 'pr9' } as never);
    vi.mocked(procCrudDal.updateProcurementHeader).mockResolvedValue(undefined);
    vi.mocked(procCrudDal.createProcurementItem).mockResolvedValue({ id: 'it1' } as never);
    vi.mocked(procCrudDal.updateProcurementItem).mockResolvedValue(undefined);
    vi.mocked(procCrudDal.deleteProcurementItem).mockResolvedValue(undefined);
    vi.mocked(procCrudDal.selectProcurementQuote).mockResolvedValue(undefined);
    vi.mocked(procCrudDal.listProcurementDocuments).mockResolvedValue([] as never);
    vi.mocked(procCrudDal.createProcurementDocument).mockResolvedValue({ id: 'd1' } as never);
    vi.mocked(procCrudDal.deleteProcurementDocument).mockResolvedValue(undefined);

    await repositories.procurement.create({ title: 'T', projectId: null, vendorId: null }, 'u1');
    expect(procCrudDal.createProcurement).toHaveBeenCalledWith(
      { title: 'T', projectId: null, vendorId: null },
      'u1',
    );

    await repositories.procurement.updateHeader('pr9', { title: 'T2', projectId: null, vendorId: null });
    expect(procCrudDal.updateProcurementHeader).toHaveBeenCalledWith('pr9', {
      title: 'T2',
      projectId: null,
      vendorId: null,
    });

    await repositories.procurement.createItem('pr9', { name: 'W', quantity: 2, rate: 5 });
    expect(procCrudDal.createProcurementItem).toHaveBeenCalledWith('pr9', { name: 'W', quantity: 2, rate: 5 });

    await repositories.procurement.updateItem('it1', { rate: 6 });
    expect(procCrudDal.updateProcurementItem).toHaveBeenCalledWith('it1', { rate: 6 });

    await repositories.procurement.deleteItem('it1');
    expect(procCrudDal.deleteProcurementItem).toHaveBeenCalledWith('it1');

    await repositories.procurement.selectQuote('q1');
    expect(procCrudDal.selectProcurementQuote).toHaveBeenCalledWith('q1');

    await repositories.procurement.listDocuments('pr9');
    expect(procCrudDal.listProcurementDocuments).toHaveBeenCalledWith('pr9');

    await repositories.procurement.createDocument('pr9', {
      type: 'PO',
      referenceNumber: null,
      status: 'Draft',
    });
    expect(procCrudDal.createProcurementDocument).toHaveBeenCalledWith('pr9', {
      type: 'PO',
      referenceNumber: null,
      status: 'Draft',
    });

    await repositories.procurement.deleteDocument('d1');
    expect(procCrudDal.deleteProcurementDocument).toHaveBeenCalledWith('d1');
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

  it('AC-DEL-008: milestone.list delegates to listMilestones', async () => {
    const rows = [{ id: 'm1', name: 'Phase 1' }];
    vi.mocked(milestonesDal.listMilestones).mockResolvedValue(rows as never);
    const result = await repositories.milestone.list('p1');
    expect(milestonesDal.listMilestones).toHaveBeenCalledWith('p1');
    expect(result).toBe(rows);
  });

  it('AC-DEL-017: milestone.deliveryForProjects delegates to getProjectsDelivery', async () => {
    const delivery = { p1: 75, p2: 50 };
    vi.mocked(milestonesDal.getProjectsDelivery).mockResolvedValue(delivery);
    const ids = ['p1', 'p2'];
    const result = await repositories.milestone.deliveryForProjects(ids);
    expect(milestonesDal.getProjectsDelivery).toHaveBeenCalledWith(ids);
    expect(result).toBe(delivery);
  });

  it('AC-DEL-008: milestone.create normalizes a thrown error to AppError (code preserved)', async () => {
    const denied = Object.assign(new Error('new row violates RLS'), { code: '42501' });
    vi.mocked(milestonesDal.createMilestone).mockRejectedValue(denied);
    const input = { name: 'M1', sort_order: 0, target_date: null, weight: 1 };
    await expect(repositories.milestone.create(input, 'p1')).rejects.toMatchObject({
      name: 'AppError',
      code: '42501',
    });
    await expect(repositories.milestone.create(input, 'p1')).rejects.toBeInstanceOf(AppError);
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
