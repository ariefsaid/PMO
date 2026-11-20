// @e2e-isolation: self-isolated — creates its own uniquely-coded crane and a past month of daily statuses each run and deletes them afterwards; reads the seeded Admin only.
/**
 * JOB-E3 — availability and use (#2526). The equipment manager opens a crane's availability for a month in which it worked
 * 20 days and was broken 5.
 * Goal oracle: physical availability reads 80% (20 of 25 recorded days), and the 5 unrecorded days are counted apart.
 * Partly built: no target (85%) comparison is shown, so no pass/fail against a target is asserted.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { need, ORG_ID, serviceClient } from './support/jobJourney';

test.setTimeout(120_000);
const must = need('JOB-E3');
const db = serviceClient('JOB-E3');
const code = `000-E3-${Date.now().toString(36)}`;
let assetId = '';

test.beforeEach(async () => {
  assetId = must('asset', await db.from('equipment_assets').insert({ org_id: ORG_ID, code, name: 'Crane', default_unit: 'hours' }).select('id').single()).id;
  const days = Array.from({ length: 25 }, (_, i) => ({ org_id: ORG_ID, asset_id: assetId, status_date: `2026-09-${String(i + 1).padStart(2, '0')}`, status: i < 20 ? 'ready' : 'broken' }));
  must('statuses', await db.from('equipment_status_days').insert(days).select('id'));
});
test.afterEach(async () => {
  await db.from('equipment_status_days').delete().eq('asset_id', assetId);
  await db.from('equipment_status_history').delete().eq('asset_id', assetId);
  await db.from('equipment_assets').delete().eq('id', assetId);
});

test('JOB-E3 a crane worked 20 days and broken 5 reads 80% physical availability for the month', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  await page.goto('/equipment/availability');
  await expect(page.getByRole('heading', { name: 'This month' })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Metric interval').selectOption('month');
  await page.getByLabel('Metric period from').fill('2026-09-01');
  await page.getByLabel('Metric period to').fill('2026-09-30');
  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: code }) });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.getByRole('cell', { name: /^80(\.0)?%$/ })).toBeVisible();
  await expect(row.getByRole('cell', { name: '5', exact: true })).toBeVisible();
});
