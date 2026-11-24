// Job-role rights mirrored from migrations 2040–2047. Each right: the named job role is allowed, another job role at the same
// access level is refused, and a person with no job role is judged by access level exactly as before. UX only; the database decides.
import { describe, expect, it } from 'vitest';
import { can, type PolicyContext } from './policy';
import type { Role } from './policy';

const as = (realRole: Role, builtInRoleKey: string | null, extra: Partial<PolicyContext> = {}): PolicyContext =>
  ({ realRole, builtInRoleKey, currentUserId: 'me', ...extra });

describe('job-role rights (2040–2047)', () => {
  it('the Material Coordinator posts a count drafted by someone else, never its own', () => {
    const record = { kind: 'count', created_by: 'other' };
    expect(can('post', 'stockDocument', as('Engineer', 'material_coordinator', { record }))).toBe(true);
    expect(can('post', 'stockDocument', as('Engineer', 'storekeeper', { record }))).toBe(false);
    expect(can('post', 'stockDocument', as('Engineer', null, { record }))).toBe(false);
    expect(can('post', 'stockDocument', as('Engineer', 'material_coordinator', { record: { kind: 'count', created_by: 'me' } }))).toBe(false);
  });

  it('the Material Coordinator records a reservation and its release', () => {
    const record = { status: 'open' };
    expect(can('recordReservation', 'clientRequisition', as('Engineer', 'material_coordinator', { record }))).toBe(true);
    expect(can('recordRelease', 'clientRequisition', as('Engineer', 'material_coordinator', { record }))).toBe(true);
    expect(can('recordReservation', 'clientRequisition', as('Engineer', 'planner', { record }))).toBe(false);
  });

  it('a close-out item names an owner job role whose holder marks it', () => {
    expect(can('transition', 'closeoutItem', as('Engineer', 'quality_inspector', { record: { owner_job_role: 'quality_inspector' } }))).toBe(true);
    expect(can('transition', 'closeoutItem', as('Engineer', 'planner', { record: { owner_job_role: 'quality_inspector' } }))).toBe(false);
    expect(can('transition', 'closeoutItem', as('Engineer', null, { record: { owner_job_role: null } }))).toBe(false);
  });

  it('the Storekeeper manages and reports tools only for a crew at a site it keeps', () => {
    expect(can('manage', 'crewTool', as('Engineer', 'storekeeper', { record: { keepsCrewSite: true } }))).toBe(true);
    expect(can('report', 'crewTool', as('Engineer', 'storekeeper', { record: { keepsCrewSite: true } }))).toBe(true);
    expect(can('manage', 'crewTool', as('Engineer', 'storekeeper', { record: { keepsCrewSite: false } }))).toBe(false);
    expect(can('manage', 'crewTool', as('Engineer', 'planner', { record: { keepsCrewSite: true } }))).toBe(false);
  });

  it('the Site Supervisor lends a worker only when it leads a crew', () => {
    expect(can('manage', 'crewLoan', as('Engineer', 'site_supervisor', { record: { leadsACrew: true } }))).toBe(true);
    expect(can('manage', 'crewLoan', as('Engineer', 'site_supervisor', { record: { leadsACrew: false } }))).toBe(false);
    expect(can('manage', 'crewLoan', as('Engineer', 'storekeeper', { record: { leadsACrew: true } }))).toBe(false);
    expect(can('manage', 'crewLoan', as('Project Manager', null))).toBe(true);
  });

  it('a supervisor with a scoped crew read can lend without controlling the crew', () => {
    expect(can('manage', 'crewLoan', as('Engineer', 'site_supervisor', { record: { supervisesACrew: true } }))).toBe(true);
  });

  it('the HR Officer adds and edits people and ticks the checklist, never on its own record', () => {
    expect(can('create', 'person', as('Engineer', 'hr_officer'))).toBe(true);
    expect(can('edit', 'person', as('Engineer', 'hr_officer'))).toBe(true);
    expect(can('archive', 'person', as('Engineer', 'hr_officer'))).toBe(false);
    expect(can('create', 'person', as('Engineer', 'storekeeper'))).toBe(false);
    expect(can('create', 'person', as('Engineer', null))).toBe(false);
    expect(can('view', 'clearanceItem', as('Engineer', 'hr_officer'))).toBe(true);
    expect(can('edit', 'personClearance', as('Engineer', 'hr_officer'))).toBe(true);
    expect(can('edit', 'personClearance', as('Engineer', 'hr_officer', { record: { own: true } }))).toBe(false);
    expect(can('view', 'personClearance', as('Engineer', 'storekeeper'))).toBe(false);
  });

  it('the HR Manager manages person document types that are not medical', () => {
    expect(can('manage', 'documentType', as('Project Manager', 'hr_manager', { record: { applies_to: 'person', medical: false } }))).toBe(true);
    expect(can('manage', 'documentType', as('Project Manager', 'hr_manager', { record: { applies_to: 'person', medical: true } }))).toBe(false);
    expect(can('manage', 'documentType', as('Project Manager', 'hr_manager', { record: { applies_to: 'equipment', medical: false } }))).toBe(false);
    expect(can('manage', 'documentType', as('Project Manager', 'quality_manager', { record: { applies_to: 'person', medical: false } }))).toBe(false);
    expect(can('manage', 'documentType', as('Admin', null, { record: { applies_to: 'equipment' } }))).toBe(true);
  });

  it('report validation reads the capability: nobody holds it by default, an Admin-assigned role validates, the author never validates', () => {
    const record = { author_id: 'other' };
    expect(can('approve', 'dailySiteReport', as('Engineer', 'site_supervisor', { record }))).toBe(false);
    expect(can('approve', 'dailySiteReport', as('Engineer', 'site_supervisor', { record, dailyReportValidateRoles: ['site_supervisor'] }))).toBe(true);
    expect(can('revise', 'dailySiteReport', as('Engineer', 'site_supervisor', { record, dailyReportValidateRoles: ['site_supervisor'] }))).toBe(true);
    expect(can('approve', 'dailySiteReport', as('Engineer', 'site_supervisor', { record: { author_id: 'me' }, dailyReportValidateRoles: ['site_supervisor'] }))).toBe(false);
    expect(can('approve', 'dailySiteReport', as('Project Manager', 'project_control_manager', { record, dailyReportValidateRoles: ['site_supervisor'] }))).toBe(false);
    expect(can('approve', 'dailySiteReport', as('Finance', null, { record }))).toBe(true);
    expect(can('approve', 'dailySiteReport', as('Finance', null, { record: { author_id: 'me' } }))).toBe(false);
  });

  it('AC-HTR-001 the HR Officer reviews timesheets; other Engineers and Finance do not', () => {
    expect(can('review', 'timesheet', as('Engineer', 'hr_officer'))).toBe(true);
    expect(can('review', 'timesheet', as('Engineer', 'storekeeper'))).toBe(false);
    expect(can('review', 'timesheet', as('Engineer', null))).toBe(false);
    expect(can('review', 'timesheet', as('Finance', null))).toBe(false);
    expect(can('review', 'timesheet', as('Admin', null))).toBe(true);
  });

  it('the Project Control Manager reads revenue and checkpoints on every project; others keep their scope', () => {
    const record = { project_manager_id: 'someone-else' };
    expect(can('view', 'dailySiteReportRevenue', as('Project Manager', 'project_control_manager', { record }))).toBe(true);
    expect(can('view', 'dailySiteReportRevenue', as('Project Manager', 'construction_manager', { record }))).toBe(false);
    expect(can('view', 'dailySiteReportRevenue', as('Engineer', 'planner', { record }))).toBe(false);
    expect(can('view', 'siteCheckpoint', as('Project Manager', 'project_control_manager', { record }))).toBe(true);
    expect(can('view', 'siteCheckpoint', as('Project Manager', 'construction_manager', { record }))).toBe(false);
  });

  it('the Quantity Surveyor records surveys and reads claims and steps', () => {
    expect(can('create', 'surveyRecord', as('Engineer', 'quantity_surveyor', { record: { status: 'Issued' } }))).toBe(true);
    expect(can('create', 'surveyRecord', as('Engineer', 'planner', { record: { status: 'Issued' } }))).toBe(false);
    expect(can('view', 'progressClaim', as('Engineer', 'quantity_surveyor'))).toBe(true);
    expect(can('view', 'billingStage', as('Engineer', 'quantity_surveyor'))).toBe(true);
    expect(can('view', 'progressClaim', as('Engineer', null))).toBe(false);
  });

  it('a claim step follows its owner, never the claim creator when another owner is named', () => {
    expect(can('transition', 'billingStage', as('Finance', null, { record: { owner_role: 'Engineer', claim_created_by: 'me' } }))).toBe(false);
    expect(can('transition', 'billingStage', as('Finance', null, { record: { owner_role: 'Engineer', claim_created_by: 'other' } }))).toBe(true);
    expect(can('transition', 'billingStage', as('Finance', null, { record: { owner_role: 'Finance', claim_created_by: 'me' } }))).toBe(true);
  });

  it('the Procurement Manager sets supply risk; the Quality Inspector raises an inspection purchase', () => {
    expect(can('set', 'supplyRisk', as('Project Manager', 'procurement_manager'))).toBe(true);
    expect(can('set', 'supplyRisk', as('Project Manager', 'quality_manager'))).toBe(false);
    expect(can('set', 'supplyRisk', as('Project Manager', null))).toBe(false);
    expect(can('raise_purchase', 'thirdPartyInspection', as('Engineer', 'quality_inspector', { record: { status: 'requested' } }))).toBe(true);
    expect(can('raise_purchase', 'thirdPartyInspection', as('Engineer', 'planner', { record: { status: 'requested' } }))).toBe(false);
  });

  it('the Planner edits sections but no plan figure; the Engineer plans consumables; the Project Administrator records head counts', () => {
    const open = { status: 'Issued' };
    expect(can('create', 'workOrderSection', as('Engineer', 'planner', { record: open }))).toBe(true);
    expect(can('set_plan', 'workOrderSection', as('Engineer', 'planner', { record: open }))).toBe(false);
    expect(can('create', 'workOrderSection', as('Engineer', 'quantity_surveyor', { record: open }))).toBe(false);
    expect(can('generate', 'consumablePlan', as('Engineer', 'engineer'))).toBe(true);
    expect(can('generate', 'consumablePlan', as('Engineer', 'quantity_surveyor'))).toBe(false);
    expect(can('create', 'headcount', as('Engineer', 'project_administrator'))).toBe(true);
    expect(can('approve', 'headcount', as('Engineer', 'project_administrator'))).toBe(false);
    expect(can('create', 'headcount', as('Engineer', null))).toBe(false);
  });
});

it('AC-SITE-017 supervisor adds issue tasks only when the database scope read permits it',()=>{
 const record={project_id:'project',status:'Open',mayTaskIssue:true};
 expect(can('act','incident',as('Engineer','site_supervisor',{record}))).toBe(true);
 expect(can('act','incident',as('Engineer','site_supervisor',{record:{...record,mayTaskIssue:false}}))).toBe(false);
 expect(can('act','incident',as('Engineer','quality_inspector',{record}))).toBe(false);
 expect(can('act','incident',as('Engineer','site_supervisor',{record:{...record,viewOnly:true}}))).toBe(false);
});

it('JOB-PC17 reporter follow-up composes with scoped supervisor actions and view-only limits',()=>{
 const record={project_id:'project',status:'Open',reporterMayFollowUp:true};
 expect(can('act','incident',as('Engineer',null,{record}))).toBe(true);
 expect(can('act','incident',as('Engineer',null,{record:{...record,reporterMayFollowUp:false}}))).toBe(false);
 expect(can('act','incident',as('Engineer',null,{record:{...record,status:'Closed'}}))).toBe(false);
 expect(can('act','incident',as('Admin',null,{record:{...record,viewOnly:true}}))).toBe(false);
});
