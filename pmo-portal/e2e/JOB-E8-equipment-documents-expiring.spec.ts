// @e2e-isolation: self-isolated — creates its own uniquely-named asset, document type and expiring permit each run and deletes them afterwards; reads the seeded Admin only.
/**
 * JOB-E8 — equipment documents expiring (#2527). The equipment manager opens expiring documents.
 * Goal oracle: a unit whose permit expires in 7 days is listed with its days left.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { inDays, need, ORG_ID, serviceClient } from './support/jobJourney';

test.setTimeout(120_000);
const must = need('JOB-E8');
const db = serviceClient('JOB-E8');
const run = `E2E-E8-${Date.now()}`;
let assetId = ''; let typeId = '';

test.beforeEach(async () => {
  assetId = must('asset', await db.from('equipment_assets').insert({ org_id: ORG_ID, code: run, name: `${run} crane`, default_unit: 'hours' }).select('id').single()).id;
  typeId = must('type', await db.from('document_types').insert({ org_id: ORG_ID, name: `${run} permit`, applies_to: 'equipment' }).select('id').single()).id;
  must('permit', await db.from('expiry_documents').insert({ org_id: ORG_ID, subject_kind: 'equipment', asset_id: assetId, type_id: typeId, number: 'PRM-7', expires_on: inDays(7) }).select('id').single());
});
test.afterEach(async () => {
  await db.from('expiry_documents').delete().eq('asset_id', assetId);
  await db.from('document_types').delete().eq('id', typeId);
  await db.from('equipment_assets').delete().eq('id', assetId);
});

test('JOB-E8 an equipment manager sees a unit whose permit expires in 7 days, with its days left', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  await page.goto('/equipment/expiring');
  const row = page.getByRole('row', { name: new RegExp(`${run} crane`) });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.getByText(`${run} permit`)).toBeVisible();
  await expect(row.getByRole('cell', { name: /^[67]$/ })).toBeVisible();
});
