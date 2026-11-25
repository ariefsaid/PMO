// @e2e-isolation: self-isolated — its own organisation, role logins, project, work order, labour switch and person rate; deletes the organisation and its users in finally.
// JOB-PC28 (labour cost in money): a week with eight normal and two overtime hours is approved by the project control manager, and the
// work order's labour cost rises by the right amount (overtime beyond the day's hours at the rate's multiplier).
import { test, expect } from '@playwright/test';
import { formatExactMoney } from '../src/lib/format';
import { inDays, orgToday, serviceClient, need } from './support/jobJourney';
import { createJobRoleUser, removeJobOrganization } from './support/jobRoleUser';

test.setTimeout(180_000);

test('JOB-PC28 approving eight normal and two overtime hours raises the work order labour cost by the right amount', async ({ page }) => {
  const db = serviceClient('JOB-PC28');
  const must = need('JOB-PC28');
  const org = must('organisation', await db.from('organizations').insert({
    name: `Labour money ${crypto.randomUUID()}`, default_currency: 'USD', built_in_roles_enabled: true,
  }).select('id').single());
  const pcm = await createJobRoleUser(db, org.id, 'project_control_manager');
  const engineer = await createJobRoleUser(db, org.id, 'engineer');
  const day = orgToday();
  const week = inDays(-(((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7)));

  try {
    const project = must('project', await db.from('projects').insert({
      org_id: org.id, name: 'Piling job', status: 'Ongoing Project', currency: 'USD', project_manager_id: pcm.id,
    }).select('id').single());
    const wo = must('work order', await db.from('work_orders').insert({
      org_id: org.id, project_id: project.id, title: 'Pile cap', status: 'Issued', order_value: 90_000,
      tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }).select('id').single());
    const cls = must('labour class', await db.from('labour_cost_classes').insert({ org_id: org.id, code: 'site', name: 'Site crew' }).select('id').single());
    must('labour switch', await db.from('labour_cost_settings').upsert({ org_id: org.id, enabled: true }).select('org_id'));
    // 100,000 an hour, a day is 8 hours, overtime at 1.5: 8 x 100,000 + 2 x 150,000 = 1,100,000 for the ten hours.
    must('rate', await db.from('labour_cost_rates').insert({
      org_id: org.id, subject_kind: 'person', person_id: engineer.id, class_id: cls.id, basis: 'hourly', amount: 100_000,
      overtime_multiplier: 1.5, day_hours: 8, month_hours: 173, effective_from: inDays(-30),
    }).select('id'));
    // The approvals queue lists a week for the owner's line manager, so the engineer reports to the project control manager.
    must('line manager', await db.from('profiles').update({ manager_id: pcm.id }).eq('id', engineer.id).select('id'));
    const sheet = must('timesheet', await db.from('timesheets').insert({ org_id: org.id, user_id: engineer.id, week_start_date: week, status: 'Draft' }).select('id').single());
    must('ten hours', await db.from('timesheet_entries').insert({ org_id: org.id, timesheet_id: sheet.id, project_id: project.id, work_order_id: wo.id, entry_date: day, hours: 10 }).select('id'));
    must('submit', await db.from('timesheets').update({ status: 'Submitted', submitted_at: new Date().toISOString() }).eq('id', sheet.id).select('id'));

    // Before approval nothing is costed.
    await pcm.signIn(page);
    await page.goto(`/work-orders/${wo.id}`);
    await expect(page.getByTestId('cost-total-timesheet_entry')).toHaveCount(0, { timeout: 30_000 });

    // The project control manager approves the week in the timesheet approvals list.
    await page.goto('/approvals?scope=timesheets');
    const queue = page.getByRole('region', { name: 'Approvals queue' });
    const item = queue.getByRole('button').filter({ hasText: 'Journey engineer' }).filter({ hasText: 'Piling job' });
    await expect(item).toBeVisible({ timeout: 20_000 });
    await item.click();
    const preview = page.getByRole('region', { name: 'Approval preview' });
    await expect(preview.getByRole('heading', { name: 'Journey engineer' })).toBeVisible();
    await preview.getByRole('button', { name: /^approve$/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /^approve$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 20_000 });

    // The work order's labour cost is 1,100,000 for those ten hours.
    await page.goto(`/work-orders/${wo.id}`);
    // A project control manager reads labour as a cost by class (the Costs list shows hours only for this role).
    const total = page.getByRole('table', { name: 'Labour cost by class' });
    await expect(total).toContainText(formatExactMoney('1100000', 'USD', 'en-US') ?? 'unformattable', { timeout: 30_000 });
  } finally {
    removeJobOrganization(org.id);
    await engineer.remove();
    await pcm.remove();
  }
});
