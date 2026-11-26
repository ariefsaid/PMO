// @e2e-isolation: self-isolated — creates its own disposable field-user login, workforce person, project, work order, crew and roster, and removes every row by its exact id.
/**
 * JOB-A8 / TC-PA-15 — a Field user (a light account) signs in on a phone and sees one home screen: their tasks, clock-in,
 * deliveries and issues. No project, price or budget is offered, and a typed project link returns to the home screen.
 * The person is a real `field_user` job role with its own login, never a shared access-level seed login.
 */
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { serviceClient, need, ok, ORG_ID, PM_ID, runId, sqlAsOwner } from './support/jobFixtures';
import { inDays } from './support/jobJourney';
import { roleJobUser } from './support/roleJobUser';
import { makeItem, makeWarehouse, runSuffix } from './support/stockFixture';

test.setTimeout(150_000);
// The case is a phone: sign in and read the home screen at a phone's width.
test.use({ viewport: { width: 390, height: 844 } });

const admin = serviceClient('JOB-A8');
let projectId = '';
let workOrderId = '';
let crewId = '';
let personId = '';
let transferId = '';
let stockIds: { warehouses: string[]; item: string; unit: string } | null = null;
let worker: Awaited<ReturnType<typeof roleJobUser>>;

test.afterEach(async () => {
  if (transferId) {
    sqlAsOwner(`delete from stock_transfer_lines where transfer_id = '${transferId}'; delete from stock_transfers where id = '${transferId}';`);
  }
  if (stockIds) {
    sqlAsOwner(`delete from stock_warehouses where id in (${stockIds.warehouses.map((w) => `'${w}'`).join(',')});`);
    await admin.from('stock_items').delete().eq('id', stockIds.item);
    await admin.from('stock_units').delete().eq('id', stockIds.unit);
  }
  transferId = ''; stockIds = null;
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
  const from = inDays(-1); // rostered from yesterday by the organisation's clock, which is what today's roster reads
  ok('roster', await admin.from('work_order_crews').insert({
    org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewId, valid_from: from,
  }));
  ok('crew member', await admin.from('crew_members').insert({ org_id: ORG_ID, crew_id: crewId, worker_id: personId, valid_from: from }));
  const taskName = `Lay cable ${sfx}`;
  ok('task', await admin.from('tasks').insert({
    org_id: ORG_ID, project_id: projectId, work_order_id: workOrderId, name: taskName, status: 'To Do', assignee_id: worker.id,
  }));

  // A delivery sent to the worker by someone else, waiting for their count.
  const sfx2 = runSuffix();
  const item = await makeItem(admin, sfx2, 'A8');
  const [source, dest] = [await makeWarehouse(admin, sfx2, 'A8F', 'central'), await makeWarehouse(admin, sfx2, 'A8T', 'site')];
  // A transit location is only ever made by a transfer (the app refuses one by hand), so the local owner writes it, as a send would have.
  const transit = randomUUID();
  sqlAsOwner(`insert into stock_warehouses (id, org_id, code, name, kind) values ('${transit}', '${ORG_ID}', 'E2E-A8X${sfx2}', 'E2E in transit ${sfx2}', 'transit');`);
  const unitId = need('unit', await admin.from('stock_items').select('unit_id').eq('id', item.id).single()).unit_id as string;
  stockIds = { warehouses: [source.id, dest.id, transit], item: item.id, unit: unitId };
  const deliveryNumber = `E2E-A8-${sfx2}`;
  transferId = randomUUID();
  sqlAsOwner(`insert into stock_transfers (id, org_id, number, from_warehouse_id, to_warehouse_id, transit_warehouse_id, to_user_id, sent_by, status, note)
    values ('${transferId}', '${ORG_ID}', '${deliveryNumber}', '${source.id}', '${dest.id}', '${transit}', '${worker.id}', '${PM_ID}', 'Sent', 'Cable drum ${sfx2}');
    insert into stock_transfer_lines (org_id, transfer_id, line_no, item_id, qty_sent) values ('${ORG_ID}', '${transferId}', 1, '${item.id}', 3);`);

  await worker.signIn(page);
  await expect(page).toHaveURL(/\/my$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'My tasks' })).toBeVisible();
  await expect(page.getByText(taskName, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Clock in' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A delivery for you' })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(deliveryNumber) })).toContainText('Count and confirm');
  await expect(page.getByRole('heading', { name: 'Issues I reported' })).toBeVisible();

  // A light account has no shell navigation and no money surface: no budget, no price, no project page.
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByText(/budget/i)).toHaveCount(0);
  await expect(page.getByText(/USD|Rp\s?\d|\$\d/)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /project/i })).toHaveCount(0);
  await page.goto(`/projects/${projectId}`);
  await expect(page).toHaveURL(/\/my$/);
});
