// @e2e-isolation: self-isolated — own organisation, role logins and cost/progress records; deletes the organisation and users.
import { test, expect } from '@playwright/test';
import { serviceClient, need } from './support/jobJourney';
import { createJobRoleUser, removeJobOrganization } from './support/jobRoleUser';
import { openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(120000);
test('JOB-PC26 project control sees cost and schedule indices after approved labour is posted', async ({ page }) => {
  const db = serviceClient('JOB-PC26');
  const must = need('JOB-PC26');
  const org = must('organisation', await db.from('organizations').insert({ name: `Performance ${crypto.randomUUID()}`, default_currency: 'IDR', built_in_roles_enabled: true, performance_indices_enabled: true }).select('id').single());
  const pcm = await createJobRoleUser(db, org.id, 'project_control_manager');
  const engineer = await createJobRoleUser(db, org.id, 'engineer');
  const administrator = await createJobRoleUser(db, org.id, 'administrator');
  const monday = new Date();
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const week = monday.toISOString().slice(0, 10);
  const day = new Date().toISOString().slice(0, 10);
  try {
    const project = must('project', await db.from('projects').insert({ org_id: org.id, name: 'Measured work', status: 'Ongoing Project', currency: 'IDR' }).select('id').single());
    const wo = must('work order', await db.from('work_orders').insert({ org_id: org.id, project_id: project.id, title: 'Site work', status: 'Issued', order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'IDR', start_date: day, end_date: day }).select('id').single());
    const boq = must('contract line', await db.from('boq_items').insert({ org_id: org.id, project_id: project.id, item_code: 'A', description: 'Measured work', unit: 'm', quantity: 100, rate: 10 }).select('id').single());
    const line = must('allocation', await db.from('work_order_lines').insert({ org_id: org.id, work_order_id: wo.id, boq_item_id: boq.id, quantity: 100 }).select('id').single());
    const cls = must('labour class', await db.from('labour_cost_classes').insert({ org_id: org.id, code: 'crew', name: 'Crew' }).select('id').single());
    must('labour switch', await db.from('labour_cost_settings').upsert({ org_id: org.id, enabled: true }).select('org_id'));
    must('rate', await db.from('labour_cost_rates').insert({ org_id: org.id, subject_kind: 'person', person_id: engineer.id, class_id: cls.id, basis: 'hourly', amount: 100, effective_from: day }).select('id'));
    const sheet = must('timesheet', await db.from('timesheets').insert({ org_id: org.id, user_id: engineer.id, week_start_date: week, status: 'Draft' }).select('id').single());
    must('hours', await db.from('timesheet_entries').insert({ org_id: org.id, timesheet_id: sheet.id, project_id: project.id, work_order_id: wo.id, entry_date: day, hours: 4 }).select('id'));
    must('approve hours', await db.from('timesheets').update({ status: 'Approved', approved_by: administrator.id, approved_at: new Date().toISOString() }).eq('id', sheet.id).select('id'));
    const report = must('validated report', await db.from('daily_site_reports').insert({ org_id: org.id, project_id: project.id, work_order_id: wo.id, work_date: day, author_id: engineer.id, validated_by: administrator.id, validated_at: new Date().toISOString(), status: 'validated' }).select('id').single());
    must('earned work', await db.from('dsr_progress_lines').insert({ org_id: org.id, report_id: report.id, position: 1, work_order_line_id: line.id, quantity: 50, unit: 'm', frozen_amount: 500 }).select('id'));
    await pcm.signIn(page);
    await page.goto(`/work-orders/${wo.id}`);
    await openWorkOrderArea(page, 'cost');
    await page.getByRole('navigation', { name: 'Sections of this Work order' }).getByRole('link', { name: 'Cost and plan', exact: true }).click();
    await expect(page.getByTestId('wo-page-performance-cpi-value')).toContainText('1.25');
    await expect(page.getByTestId('wo-page-performance-spi-value')).toContainText('0.50');
  } finally {
    removeJobOrganization(org.id);
    await administrator.remove();
    await engineer.remove();
    await pcm.remove();
  }
});
