// @e2e-isolation: self-isolated — creates its own uniquely-coded unit broken for the last three days, runs the escalation job and deletes the unit, its notices and its notifications afterwards; reads the seeded Admin and Project Manager only.
/**
 * JOB-E5 — breakdown escalation (#2526). A unit has been marked broken for three days.
 * Goal oracle: the equipment status screen flags it as down more than 2 days, the vendor's response time is recorded on the
 * unit, and the escalation reaches the Project Manager.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { inDays, need, ORG_ID, serviceClient, sql } from './support/jobJourney';
import { roleJobUser } from './support/roleJobUser';
import { runId } from './support/jobFixtures';

test.setTimeout(120_000);
const must = need('JOB-E5');
const db = serviceClient('JOB-E5');
const code = `000-E5-${Date.now().toString(36)}`;
let assetId = '';
let manager: Awaited<ReturnType<typeof roleJobUser>>;

test.beforeEach(async () => {
  manager = await roleJobUser(db, 'equipment_officer', runId('e5-eo'));
  // The unit is rented from a vendor, so its breakdown has a vendor to answer within the limit.
  const vendorId = must('vendor', await db.from('companies').insert({ org_id: ORG_ID, name: `${code} hire`, type: 'Vendor' }).select('id').single()).id;
  assetId = must('asset', await db.from('equipment_assets').insert({ org_id: ORG_ID, code, name: 'Loader', default_unit: 'hours', ownership: 'rented' }).select('id').single()).id;
  must('terms', await db.from('equipment_rental_terms').insert({ org_id: ORG_ID, asset_id: assetId, vendor_id: vendorId, rate: 1_000_000, basis: 'day', currency: 'IDR', rented_from: inDays(-30) }).select('id'));
  must('statuses', await db.from('equipment_status_days').insert([-3, -2, -1].map((d) => ({ org_id: ORG_ID, asset_id: assetId, status_date: inDays(d), status: 'broken' }))).select('id'));
});
test.afterEach(async () => {
  await db.from('notifications').delete().eq('metadata->entity->>id', assetId);
  await db.from('equipment_escalation_log').delete().eq('asset_id', assetId);
  await db.from('equipment_status_days').delete().eq('asset_id', assetId);
  await db.from('equipment_status_history').delete().eq('asset_id', assetId);
  await db.from('equipment_vendor_responses').delete().eq('asset_id', assetId);
  await db.from('equipment_rental_terms').delete().eq('asset_id', assetId);
  await db.from('equipment_assets').delete().eq('id', assetId);
  await db.from('companies').delete().eq('name', `${code} hire`);
  await manager.cleanup();
});

test('JOB-E5 a unit broken for three days is flagged on screen and escalated to the Project Manager', async ({ page }) => {
  await manager.signIn(page);
  await page.goto('/equipment/availability');
  const unit = page.getByRole('listitem').filter({ hasText: code });
  await expect(unit).toBeVisible({ timeout: 20_000 });
  await expect(unit.getByText('Down more than 2 days')).toBeVisible();

  // The vendor's response time is recorded on the unit's own page.
  await page.goto(`/equipment/assets/${assetId}`);
  await expect(page.getByText('Vendor response to breakdowns')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Record response' }).click();
  const response = page.getByRole('dialog');
  const responded = new Date(Date.now() - 60 * 60 * 1000); // the browser runs on UTC (playwright.config timezoneId), so read the clock in UTC
  const pad = (n: number) => String(n).padStart(2, '0');
  const when = response.getByRole('group', { name: /Vendor responded/ });
  await when.getByLabel('Day').fill(`${responded.getUTCFullYear()}-${pad(responded.getUTCMonth() + 1)}-${pad(responded.getUTCDate())}`);
  await when.getByLabel('Hour (00–23)').selectOption(pad(responded.getUTCHours()));
  await when.getByLabel('Minute', { exact: true }).selectOption(pad(responded.getUTCMinutes()));
  await response.getByRole('button', { name: 'Save response' }).click();
  await expect(page.getByText('Awaiting response')).toHaveCount(0, { timeout: 20_000 });

  expect(Number(sql('select public.run_equipment_downtime_escalations();'))).toBeGreaterThanOrEqual(1);
  await signIn(page, 'pm@acme.test');
  await page.goto('/');
  await page.getByRole('button', { name: /^notifications/i }).click();
  await expect(page.getByRole('list', { name: 'Notifications' }).getByText(new RegExp(`${code}.*Loader|Equipment down more than 2 days`)).first()).toBeVisible({ timeout: 20_000 });
});
