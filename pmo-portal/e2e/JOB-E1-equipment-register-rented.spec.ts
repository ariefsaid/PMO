// @e2e-isolation: self-isolated — creates its own uniquely-coded asset and hire vendor; cleanup deletes the rental terms, the asset and the vendor.
/**
 * JOB-E1 — equipment register, owned and rented (#2526). The equipment manager registers a crane and records it as rented
 * from a hire vendor with a daily rate.
 * Goal oracle: the crane is in the asset register, its rental terms name the vendor and rate, and it is offered as a rented
 * machine for the rental invoice check.
 * The Equipment Officer's journey registers a rented crane and puts it on a work order (hours logged against it, approved by the project manager);
 * the work order's cost section then lists the crane from that date.
 */
import { test, expect } from '@playwright/test';
import { signIn, visibleToast, pickComboboxOption } from './helpers';
import { need, inDays, ORG_ID, serviceClient } from './support/jobJourney';
import { seedWorkOrder } from './support/crewJourney';
import { roleJobUser } from './support/roleJobUser';
import { runId } from './support/jobFixtures';
import { openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(180_000);
const must = need('JOB-E1');
const db = serviceClient('JOB-E1');
const code = `000-E1-${Date.now().toString(36)}`;
let vendorId = ''; let vendorName = '';
let manager: Awaited<ReturnType<typeof roleJobUser>>;
let officer: Awaited<ReturnType<typeof roleJobUser>>;
let wo = { projectId: '', workOrderId: '', title: '' };
const workDay = inDays(-7); // a week back by the organisation's clock, which is the week the equipment grid is asked for
const weekdayIndex = (new Date(`${workDay}T00:00:00Z`).getUTCDay() + 6) % 7;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const workDayLabel = `${Number(workDay.slice(8, 10))} ${MONTHS[Number(workDay.slice(5, 7)) - 1]}`;

test.beforeEach(async () => {
  manager = await roleJobUser(db, 'equipment_manager', runId('e1-em'));
  officer = await roleJobUser(db, 'equipment_officer', runId('e1-eo'));
  vendorName = `Hire vendor ${code}`;
  vendorId = must('vendor', await db.from('companies').insert({ org_id: ORG_ID, name: vendorName, type: 'Vendor' }).select('id').single()).id;
});
const pmCode = `${code}-PM`;
test.afterEach(async () => {
  for (const c of [code, pmCode]) {
    const asset = await db.from('equipment_assets').select('id').eq('code', c).maybeSingle();
    if (asset.data) {
      await db.from('equipment_usage_entries').delete().eq('asset_id', asset.data.id);
      for (const table of ['equipment_rental_terms', 'equipment_status_days', 'equipment_status_history']) await db.from(table).delete().eq('asset_id', asset.data.id);
      await db.from('equipment_assets').delete().eq('id', asset.data.id);
    }
  }
  if (wo.workOrderId) { await db.from('work_orders').delete().eq('id', wo.workOrderId); await db.from('projects').delete().eq('id', wo.projectId); wo = { projectId: '', workOrderId: '', title: '' }; }
  await db.from('companies').delete().eq('id', vendorId);
  await manager.cleanup();
  await officer.cleanup();
});

test('JOB-E1 a crane registered as rented from a vendor shows its terms and is offered for the rental check', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  await page.goto('/equipment/assets');
  await page.getByRole('button', { name: 'New asset' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel(/^Code/).fill(code);
  await form.getByLabel(/^Name/).fill('Mobile crane');
  await form.getByRole('button', { name: 'Create asset' }).click();
  await expect(visibleToast(page, 'Asset created')).toBeVisible({ timeout: 15_000 });

  await page.goto(`/equipment/assets?q=${code}`);
  await page.getByRole('link', { name: 'Open Mobile crane' }).first().click();
  await expect(page).toHaveURL(/\/equipment\/assets\/[0-9a-f-]{36}$/);
  // The terms are entered in their own dialog from the Rental terms section.
  await page.getByRole('button', { name: 'Add rental terms' }).click();
  const terms = page.getByRole('dialog');
  await terms.getByLabel('Vendor', { exact: true }).selectOption({ label: vendorName });
  await terms.getByLabel('Rate', { exact: true }).fill('1500000');
  await terms.getByLabel('Rental start').fill('2026-09-01');
  await terms.getByRole('button', { name: 'Save rental terms' }).click();
  await expect(visibleToast(page, 'Rental terms saved')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(new RegExp(`${vendorName}`)).first()).toBeVisible();

  await page.goto('/equipment/availability');
  await page.getByRole('button', { name: 'Rental invoice check' }).click();
  await expect(page.getByLabel('Rented machine').locator('option', { hasText: `${code} Mobile crane` })).toHaveCount(1, { timeout: 20_000 });
});

test('JOB-E1 the equipment officer registers a rented crane with vendor and rate, puts it on a work order, and the work order lists it from that date', async ({ page }) => {
  wo = await seedWorkOrder(db, 'JOB-E1', code, 'rented crane');
  await officer.signIn(page);
  await page.goto('/equipment');
  await page.getByRole('button', { name: 'New equipment' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel(/^Code/).fill(pmCode);
  await form.getByLabel(/^Name/).fill('Rented crane');
  await form.getByLabel('Owned or rented').selectOption('rented');
  await form.getByLabel(/^Vendor/).selectOption({ label: vendorName });
  await form.getByRole('textbox', { name: /^Rate/ }).fill('900000');
  await form.getByLabel('Rental start').fill('2026-09-01');
  await form.getByRole('button', { name: 'Create asset' }).click();
  await expect(visibleToast(page, 'Rented equipment added')).toBeVisible({ timeout: 15_000 });

  // The machine is in the register, rented, and its rental terms name the vendor.
  await page.goto(`/equipment/assets?q=${pmCode}`);
  await page.getByRole('link', { name: 'Open Rented crane' }).first().click();
  await expect(page.getByText(new RegExp(vendorName)).first()).toBeVisible({ timeout: 20_000 });

  // Deploy it to the work order: the officer logs 8 hours of it there; the project manager approves the week.
  await page.goto(`/equipment?week=${workDay}`);
  await page.getByRole('button', { name: 'Add row' }).click();
  await pickComboboxOption(page, page, /^Equipment/, new RegExp(pmCode));
  await pickComboboxOption(page, page, /^Project/, new RegExp(`${code} rented crane$`));
  await pickComboboxOption(page, page, /^Work order/, new RegExp(wo.title));
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const row = page.getByRole('row', { name: new RegExp(`Rented crane.*${code} rented crane`) }).first();
  const cell = row.getByRole('textbox').nth(weekdayIndex);
  await cell.fill('8');
  await cell.press('Enter');
  await expect(row.getByText('Draft')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Submit week' }).click();
  await expect(page.getByText('Submitted', { exact: true })).toHaveCount(1, { timeout: 15_000 });
  await signIn(page, 'pm@acme.test');
  await page.goto(`/equipment?week=${workDay}`);
  await page.getByRole('tab', { name: 'Approvals' }).click();
  await page.getByRole('button', { name: 'Approve week' }).click();
  await page.getByRole('dialog', { name: 'Approve equipment usage week?' }).getByRole('button', { name: 'Approve week' }).click();
  await expect(page.getByText('Nothing is waiting for approval this week')).toBeVisible({ timeout: 15_000 });

  // Goal: the work order lists the crane, with the day it was used and its hours.
  await officer.signIn(page);
  await page.goto(`/work-orders/${wo.workOrderId}`);
  await openWorkOrderArea(page, 'cost');
  const equipment = page.getByTestId('cost-group-equipment_usage');
  await expect(equipment).toContainText(pmCode, { timeout: 20_000 });
  const crane = equipment.locator('tr', { hasText: pmCode });
  await expect(crane).toContainText(new RegExp(`(?<!\\d)${workDayLabel}( \\d{4})?`));
  await expect(crane).toContainText('8 hours');
});
