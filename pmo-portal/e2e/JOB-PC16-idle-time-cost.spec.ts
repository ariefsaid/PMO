// @e2e-isolation: self-isolated — its own organisation, role logins, project, work order, labour switch, rate, approved hours and idle-period report; deletes the organisation and its users in finally.
// JOB-PC16 (idle time becomes cost): a validated site report records four idle hours under a named cause on a work order whose hourly cost is known.
// Goal: the work order's idle cost rises by four hours at that rate, read by the project control manager on the work order.
import { test, expect } from '@playwright/test';
import { formatTableMoney } from '../src/lib/format';
import { inDays, orgToday, serviceClient, need } from './support/jobJourney';
import { createJobRoleUser, removeJobOrganization } from './support/jobRoleUser';
import { openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(180_000);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');



test('JOB-PC16 idle time recorded on a validated report becomes cost at the work order\'s hourly rate', async ({ page }) => {
  const db = serviceClient('JOB-PC16');
  const must = need('JOB-PC16');
  const org = must('organisation', await db.from('organizations').insert({
    name: `Idle cost ${crypto.randomUUID()}`, default_currency: 'USD', built_in_roles_enabled: true,
  }).select('id').single());
  const pcm = await createJobRoleUser(db, org.id, 'project_control_manager');
  const engineer = await createJobRoleUser(db, org.id, 'engineer');
  const day = orgToday();
  const week = inDays(-(((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7)));

  let photoPath = '';
  try {
    const project = must('project', await db.from('projects').insert({
      org_id: org.id, name: 'Weather stoppage job', status: 'Ongoing Project', currency: 'USD', project_manager_id: pcm.id,
    }).select('id').single());
    const wo = must('work order', await db.from('work_orders').insert({
      org_id: org.id, project_id: project.id, title: 'Harbour wall', status: 'Issued', order_value: 50_000,
      tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD', start_date: day, end_date: day,
    }).select('id').single());
    const cls = must('labour class', await db.from('labour_cost_classes').insert({ org_id: org.id, code: 'site', name: 'Site crew' }).select('id').single());
    must('labour switch', await db.from('labour_cost_settings').upsert({ org_id: org.id, enabled: true }).select('org_id'));
    must('idle switch', await db.from('idle_cost_settings').upsert({ org_id: org.id, enabled: true, scope: 'labour_average' }).select('org_id'));
    must('rate', await db.from('labour_cost_rates').insert({
      org_id: org.id, subject_kind: 'person', person_id: engineer.id, class_id: cls.id, basis: 'hourly', amount: 100_000,
      overtime_multiplier: 1.5, day_hours: 8, month_hours: 173, effective_from: inDays(-30),
    }).select('id'));
    // Eight approved hours at 100,000 an hour: the work order's hourly cost is 100,000, so four idle hours cost 400,000.
    const sheet = must('timesheet', await db.from('timesheets').insert({ org_id: org.id, user_id: engineer.id, week_start_date: week, status: 'Draft' }).select('id').single());
    must('hours', await db.from('timesheet_entries').insert({ org_id: org.id, timesheet_id: sheet.id, project_id: project.id, work_order_id: wo.id, entry_date: day, hours: 8 }).select('id'));
    must('approve hours', await db.from('timesheets').update({ status: 'Approved', approved_by: pcm.id, approved_at: new Date().toISOString() }).eq('id', sheet.id).select('id'));
    // The new org is seeded with the neutral idle-reason list, so use its own 'Weather' cause.
    const why = must('idle reason', await db.from('dsr_idle_reasons').select('id').eq('org_id', org.id).eq('label', 'Weather').single());
    // The crew's report is submitted and waits for the project control manager, who validates it on screen.
    const report = must('report', await db.from('daily_site_reports').insert({
      org_id: org.id, project_id: project.id, work_order_id: wo.id, work_date: day, author_id: engineer.id,
      status: 'submitted', submitted_at: new Date().toISOString(),
    }).select('id').single());
    must('idle period', await db.from('dsr_idle_periods').insert({ org_id: org.id, report_id: report.id, position: 1, minutes: 240, reason_id: why.id }).select('id'));

    // The crew submitted it with the paper form's photo (needed to validate).
    photoPath = `${org.id}/${report.id}/paper-form.png`;
    const sent = await db.storage.from('site-report-photos').upload(photoPath, PNG, { contentType: 'image/png' });
    if (sent.error) throw new Error(`paper form upload: ${sent.error.message}`);
    must('paper form', await db.from('dsr_photos').insert({ org_id: org.id, report_id: report.id, kind: 'paper_form', file_path: photoPath }).select('id'));

    // Before validation the work order shows no idle cost for that cause.
    await pcm.signIn(page);
    await page.goto(`/work-orders/${wo.id}`);
    await openWorkOrderArea(page, 'cost');
    await expect(page.getByTestId('wo-page-pva-plan-direct').or(page.getByRole('heading', { level: 1 })).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`wo-page-pva-idle-${why.id}`)).toHaveCount(0);

    // The project control manager opens the daily report and validates it.
    await page.goto(`/site-reports/${report.id}`);
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'submitted', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Validate' }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'validated', { timeout: 20_000 });

    // The work order's idle cost now shows four hours at that rate, by cause.
    await page.goto(`/work-orders/${wo.id}`);
    await openWorkOrderArea(page, 'cost');
    const row = page.getByTestId(`wo-page-pva-idle-${why.id}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText('Weather');
    await expect(row.locator('td').first()).toHaveText('4');
    await expect(row).toContainText(formatTableMoney('400000', 'USD') ?? 'unformattable');
  } finally {
    if (photoPath) await db.storage.from('site-report-photos').remove([photoPath]);
    removeJobOrganization(org.id);
    await engineer.remove();
    await pcm.remove();
  }
});
