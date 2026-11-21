// @e2e-isolation: self-isolated — creates its own uniquely-named projects, work orders and crane; cleanup removes the usage, the crane and the projects.
/**
 * JOB-E6 — split mobile equipment across work orders (#2517). The field admin logs a crane used on two work orders in one
 * day: 5 hours on one and 3 on the other, and the Project Manager approves the week.
 * Goal oracle: each work order's cost lines carry its own hours (5 and 3).
 * Partly built: there is no split helper (one entry per work order is typed by hand), and the cost shown follows the
 * machine's costing setting, so the hours on the work-order cost lines are the asserted figure.
 */
import { test, expect } from '@playwright/test';
import { signIn, pickComboboxOption } from './helpers';
import { iso, need, ORG_ID, PM_ID, serviceClient } from './support/jobJourney';
import { seedWorkOrder } from './support/crewJourney';

test.setTimeout(240_000);
const must = need('JOB-E6');
const db = serviceClient('JOB-E6');
const run = `E2E-E6-${Date.now()}`;
let a = { projectId: '', workOrderId: '', title: '' }; let b = a; let assetId = '';
const workDay = new Date(); workDay.setDate(workDay.getDate() - 7);
const weekdayIndex = (workDay.getDay() + 6) % 7;

test.beforeEach(async () => {
  a = await seedWorkOrder(db, 'JOB-E6', run, 'A'); b = await seedWorkOrder(db, 'JOB-E6', run, 'B');
  assetId = must('asset', await db.from('equipment_assets').insert({ org_id: ORG_ID, code: run, name: `${run} crane`, default_unit: 'hours' }).select('id').single()).id;
});
test.afterEach(async () => {
  await db.from('equipment_usage_entries').delete().eq('asset_id', assetId);
  await db.from('equipment_assets').delete().eq('id', assetId);
  for (const x of [a, b]) { await db.from('work_orders').delete().eq('id', x.workOrderId); await db.from('projects').delete().eq('id', x.projectId); }
  void PM_ID;
});

test('JOB-E6 a crane used on two work orders in a day carries 5 hours on one and 3 on the other', async ({ page }) => {
  await signIn(page, 'engineer@acme.test');
  for (const [x, hours] of [[a, '5'], [b, '3']] as const) {
    await page.goto(`/equipment?week=${iso(workDay)}`);
    await page.getByRole('button', { name: 'Add row' }).click();
    const dialog = page.getByRole('dialog');
    await pickComboboxOption(page, page, /^Equipment/, new RegExp(run));
    await pickComboboxOption(page, page, /^Project/, new RegExp(`${run} ${x === a ? 'A' : 'B'}$`));
    await pickComboboxOption(page, page, /^Work order/, new RegExp(x.title));
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const row = page.getByRole('row', { name: new RegExp(`${run}.*${run} ${x === a ? 'A' : 'B'}`) }).first();
    const cell = row.getByRole('textbox').nth(weekdayIndex);
    await cell.fill(hours);
    await cell.press('Enter');
    await expect(row.getByText('Draft')).toBeVisible({ timeout: 15_000 });
    void dialog;
  }
  await page.getByRole('button', { name: 'Submit week' }).click();
  await expect(page.getByText('Submitted', { exact: true })).toHaveCount(2, { timeout: 15_000 });

  await signIn(page, 'pm@acme.test');
  await page.goto(`/equipment?week=${iso(workDay)}`);
  await page.getByRole('tab', { name: 'Approvals' }).click();
  await page.getByRole('button', { name: 'Approve week' }).click();
  await page.getByRole('dialog', { name: 'Approve equipment usage week?' }).getByRole('button', { name: 'Approve week' }).click();
  await expect(page.getByText('Nothing is waiting for approval this week')).toBeVisible({ timeout: 15_000 });

  for (const [x, hours] of [[a, 5], [b, 3]] as const) {
    const lines = must('cost lines', await db.from('work_order_cost_lines').select('quantity').eq('work_order_id', x.workOrderId).eq('source', 'equipment_usage'));
    expect(lines.reduce((sum: number, l: { quantity: string }) => sum + Number(l.quantity), 0)).toBe(hours);
  }
});
