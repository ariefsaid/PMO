// @e2e-isolation: self-isolated — creates its own uniquely-coded asset and hire vendor; cleanup deletes the rental terms, the asset and the vendor.
/**
 * JOB-E1 — equipment register, owned and rented (#2526). The equipment manager registers a crane and records it as rented
 * from a hire vendor with a daily rate.
 * Goal oracle: the crane is in the asset register, its rental terms name the vendor and rate, and it is offered as a rented
 * machine for the rental invoice check.
 * Deployment to a work order is JOB-E6's journey (hours logged against a work order).
 */
import { test, expect } from '@playwright/test';
import { signIn, visibleToast } from './helpers';
import { need, ORG_ID, serviceClient } from './support/jobJourney';
import { roleJobUser } from './support/roleJobUser';
import { runId } from './support/jobFixtures';

test.setTimeout(180_000);
const must = need('JOB-E1');
const db = serviceClient('JOB-E1');
const code = `000-E1-${Date.now().toString(36)}`;
let vendorId = ''; let vendorName = '';
let manager: Awaited<ReturnType<typeof roleJobUser>>;

test.beforeEach(async () => {
  manager = await roleJobUser(db, 'equipment_manager', runId('e1-em'));
  vendorName = `Hire vendor ${code}`;
  vendorId = must('vendor', await db.from('companies').insert({ org_id: ORG_ID, name: vendorName, type: 'Vendor' }).select('id').single()).id;
});
const pmCode = `${code}-PM`;
test.afterEach(async () => {
  for (const c of [code, pmCode]) {
    const asset = await db.from('equipment_assets').select('id').eq('code', c).maybeSingle();
    if (asset.data) {
      for (const table of ['equipment_rental_terms', 'equipment_status_days', 'equipment_status_history']) await db.from(table).delete().eq('asset_id', asset.data.id);
      await db.from('equipment_assets').delete().eq('id', asset.data.id);
    }
  }
  await db.from('companies').delete().eq('id', vendorId);
  await manager.cleanup();
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
  await page.getByLabel('Vendor', { exact: true }).selectOption({ label: vendorName });
  await page.getByLabel('Rate', { exact: true }).fill('1500000');
  await page.getByLabel('Rental start').fill('2026-09-01');
  await page.getByRole('button', { name: 'Save rental terms' }).click();
  await expect(visibleToast(page, 'Saved')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(new RegExp(`${vendorName}`)).first()).toBeVisible();

  await page.goto('/equipment/availability');
  await page.getByRole('button', { name: 'Rental invoice check' }).click();
  await expect(page.getByLabel('Rented machine').locator('option', { hasText: code })).toHaveCount(1, { timeout: 20_000 });
});

test('JOB-E1 the equipment manager adds a rented machine from the Equipment screen, vendor and rate on the same form', async ({ page }) => {
  await manager.signIn(page);
  await page.goto('/equipment');
  await page.getByRole('button', { name: 'New equipment' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel(/^Code/).fill(pmCode);
  await form.getByLabel(/^Name/).fill('Rented grader');
  await form.getByLabel('Owned or rented').selectOption('rented');
  await form.getByLabel(/^Vendor/).selectOption({ label: vendorName });
  await form.getByRole('textbox', { name: /^Rate/ }).fill('900000');
  await form.getByLabel('Rental start').fill('2026-09-01');
  await form.getByRole('button', { name: 'Create asset' }).click();
  await expect(visibleToast(page, 'Rented equipment added')).toBeVisible({ timeout: 15_000 });

  // The goal: the machine is in the register, rented, and its rental terms name the vendor, editable by the same role.
  await page.goto(`/equipment/assets?q=${pmCode}`);
  await page.getByRole('link', { name: 'Open Rented grader' }).first().click();
  await expect(page.getByText(new RegExp(vendorName)).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Save rental terms' })).toBeVisible();
});
