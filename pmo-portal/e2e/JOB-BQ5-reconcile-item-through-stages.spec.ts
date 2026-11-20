// @e2e-isolation: self-isolated — creates its own client, project, contract line, work order, assessment and claim; deletes them in afterEach.
// JOB-BQ5 (billing lead): reconcile each item. PARTLY LANDED: the app reconciles scope, progress to date, measured (claimed) and billed per item,
// with progress as the ceiling for a claim; the sales / joint-survey / survey-report / accrual stages of the job do not exist yet (listed as missing).
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signIn } from './helpers';
import { runId, serviceClient } from './support/jobFixtures';
import { cleanupBilling, createBillingFixture, type BillingFixture } from './support/billingFixture';

test.setTimeout(180_000);

let admin: SupabaseClient;
let fx: BillingFixture | undefined;
test.afterEach(async () => { if (admin) { await cleanupBilling(admin, fx); fx = undefined; } });

test('JOB-BQ5 an item reconciles scope, progress and claimed quantity, and a claim above the progress is refused', async ({ page }) => {
  admin = serviceClient('JOB-BQ5');
  fx = await createBillingFixture(admin, runId('JOBBQ5')); // scope 10 km, progress to date 6 km
  await signIn(page, 'finance@acme.test');
  await page.goto(`/projects/${fx.projectId}/contract`);

  // A claim above the progress to date (8 of 6) is refused: no claim is made.
  await page.getByRole('button', { name: /new claim/i }).click();
  let form = page.getByRole('dialog');
  await form.getByLabel(/^Bills$/i).selectOption(fx.workOrderId);
  await form.getByLabel(/SURVEY/).fill('8');
  await form.getByRole('button', { name: /create claim/i }).click();
  await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 15_000 });
  expect((await admin.from('progress_claims').select('id').eq('project_id', fx.projectId)).data ?? []).toHaveLength(0);
  await page.keyboard.press('Escape');

  // A claim within the progress (4 of 6) is made; the reconciliation reads scope 10, progress 6, claimed 4.
  await page.goto(`/projects/${fx.projectId}/contract`);
  await page.getByRole('button', { name: /new claim/i }).click();
  form = page.getByRole('dialog');
  await form.getByLabel(/^Bills$/i).selectOption(fx.workOrderId);
  await form.getByLabel(/SURVEY/).fill('4');
  await form.getByRole('button', { name: /create claim/i }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^(close|cancel|skip)/i }).first().click();
  const reconciliation = page.getByRole('region', { name: /billing reconciliation/i });
  const cells = reconciliation.getByRole('row').filter({ hasText: 'Route survey' }).getByRole('cell');
  await expect(cells.nth(1)).toHaveText('10');
  await expect(cells.nth(2)).toHaveText('6');
  await expect(cells.nth(3)).toHaveText('4');
});
