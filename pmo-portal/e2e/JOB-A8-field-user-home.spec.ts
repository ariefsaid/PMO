// @e2e-isolation: self-isolated — creates its own disposable field-user login, workforce person, project, work order, crew and roster, and removes every row by its exact id.
/**
 * JOB-A8 / TC-PA-15 — a Field user (a light account) signs in on a phone and sees one home screen: their tasks, clock-in,
 * deliveries and issues. No project, price or budget is offered, and a typed project link returns to the home screen.
 * The person is a real `field_user` job role with its own login, never a shared access-level seed login.
 */
import { test, expect } from '@playwright/test';
import { serviceClient, need, ok, ORG_ID, PM_ID, runId } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(150_000);

const admin = serviceClient('JOB-A8');
let projectId = '';
let workOrderId = '';
let crewId = '';
let personId = '';
let worker: Awaited<ReturnType<typeof roleJobUser>>;

test.afterEach(async () => {
  if (workOrderId) {
    await admin.from('phone_check_ins').delete().eq('work_order_id', workOrderId);
    await admin.from('attendance_days').delete().eq('work_order_id', workOrderId);
    await admin.from('work_order_crews').delete().eq('work_order_id', workOrderId);
    await admin.from('tasks').delete().eq('work_order_id', workOrderId);
  }
  if (crewId) {
    await admin.from('crew_members').delete().eq('crew_id', crewId);
    await admin.from('crews').delete().eq('id', crewId);
  }
  if (personId) await admin.from('people').delete().eq('id', personId);
  if (workOrderId) await admin.from('work_orders').delete().eq('id', workOrderId);
  if (projectId) await admin.from('projects').delete().eq('id', projectId);
  await worker?.cleanup();
  projectId = workOrderId = crewId = personId = '';
});

test('JOB-A8 a field user sees only their tasks, clock-in, deliveries and issues — no project, price or budget', async ({ page }) => {
  const sfx = runId('a8');
  worker = await roleJobUser(admin, 'field_user', sfx);
  projectId = need('project', await admin.from('projects').insert({
    org_id: ORG_ID, name: `Field work ${sfx}`, status: 'Ongoing Project', project_manager_id: PM_ID, contract_value: 500_000,
    tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
  }).select('id').single()).id as string;
  workOrderId = need('work order', await admin.from('work_orders').insert({
    org_id: ORG_ID, project_id: projectId, title: `Field order ${sfx}`, status: 'Issued',
    order_value: 25_000, tax_treatment: 'exclusive', tax_amount: 0,
  }).select('id').single()).id as string;
  crewId = need('crew', await admin.from('crews').insert({
    org_id: ORG_ID, code: `A8-${sfx.slice(-8)}`, name: `Field crew ${sfx}`, kind: 'own',
  }).select('id').single()).id as string;
  personId = need('person', await admin.from('people').insert({
    org_id: ORG_ID, kind: 'own', code: `A8-${sfx.slice(-8)}`, name: `Field person ${sfx}`, profile_id: worker.id,
  }).select('id').single()).id as string;
  const from = new Date(); from.setDate(from.getDate() - 1);
  ok('roster', await admin.from('work_order_crews').insert({
    org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewId, valid_from: from.toISOString().slice(0, 10),
  }));
  ok('crew member', await admin.from('crew_members').insert({ org_id: ORG_ID, crew_id: crewId, worker_id: personId, valid_from: from.toISOString().slice(0, 10) }));
  const taskName = `Lay cable ${sfx}`;
  ok('task', await admin.from('tasks').insert({
    org_id: ORG_ID, project_id: projectId, work_order_id: workOrderId, name: taskName, status: 'To Do', assignee_id: worker.id,
  }));

  await worker.signIn(page);
  await expect(page).toHaveURL(/\/my$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'My tasks' })).toBeVisible();
  await expect(page.getByText(taskName, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Clock in' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Issues I reported' })).toBeVisible();

  // A light account has no shell navigation and no money surface: no budget, no price, no project page.
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByText(/budget/i)).toHaveCount(0);
  await expect(page.getByText(/USD|Rp\s?\d|\$\d/)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /project/i })).toHaveCount(0);
  await page.goto(`/projects/${projectId}`);
  await expect(page).toHaveURL(/\/my$/);
});
