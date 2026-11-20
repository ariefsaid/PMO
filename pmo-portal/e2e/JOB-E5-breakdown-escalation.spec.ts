// @e2e-isolation: self-isolated — creates its own uniquely-coded unit broken for the last three days, runs the escalation job and deletes the unit, its notices and its notifications afterwards; reads the seeded Admin and Project Manager only.
/**
 * JOB-E5 — breakdown escalation (#2526). A unit has been marked broken for three days.
 * Goal oracle: the equipment status screen flags it as down more than 2 days, and the escalation reaches the Project Manager.
 * Partly built: the vendor's arrival and response time are not recorded, so only the days-down escalation is asserted.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { inDays, need, ORG_ID, serviceClient, sql } from './support/jobJourney';

test.setTimeout(120_000);
const must = need('JOB-E5');
const db = serviceClient('JOB-E5');
const code = `000-E5-${Date.now().toString(36)}`;
let assetId = '';

test.beforeEach(async () => {
  assetId = must('asset', await db.from('equipment_assets').insert({ org_id: ORG_ID, code, name: 'Loader', default_unit: 'hours' }).select('id').single()).id;
  must('statuses', await db.from('equipment_status_days').insert([-3, -2, -1].map((d) => ({ org_id: ORG_ID, asset_id: assetId, status_date: inDays(d), status: 'broken' }))).select('id'));
});
test.afterEach(async () => {
  await db.from('notifications').delete().eq('metadata->entity->>id', assetId);
  await db.from('equipment_escalation_log').delete().eq('asset_id', assetId);
  await db.from('equipment_status_days').delete().eq('asset_id', assetId);
  await db.from('equipment_status_history').delete().eq('asset_id', assetId);
  await db.from('equipment_assets').delete().eq('id', assetId);
});

test('JOB-E5 a unit broken for three days is flagged on screen and escalated to the Project Manager', async ({ page }) => {
  await signIn(page, 'engineer@acme.test');
  await page.goto('/equipment/availability');
  const unit = page.getByRole('listitem').filter({ hasText: code });
  await expect(unit).toBeVisible({ timeout: 20_000 });
  await expect(unit.getByText('Down more than 2 days')).toBeVisible();

  expect(Number(sql('select public.run_equipment_downtime_escalations();'))).toBeGreaterThanOrEqual(1);
  await signIn(page, 'pm@acme.test');
  await page.goto('/');
  await page.getByRole('button', { name: /^notifications/i }).click();
  await expect(page.getByRole('list', { name: 'Notifications' }).getByText(new RegExp(`${code}.*Loader|Equipment down more than 2 days`)).first()).toBeVisible({ timeout: 20_000 });
});
