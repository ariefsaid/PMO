// @e2e-isolation: self-isolated — creates its own client, project, contract line, work order, assessment and claim; deletes them in afterEach.
// JOB-BQ5 (billing lead): reconcile each item. The app reconciles scope, progress to date, measured (claimed) and billed per item;
// a claim may exceed assessed progress and the visible over-claim label shows when it also exceeds the BoQ scope. Later job stages remain listed as missing.
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signIn } from './helpers';
import { runId, serviceClient } from './support/jobFixtures';
import { cleanupBilling, createBillingFixture, type BillingFixture } from './support/billingFixture';

test.setTimeout(180_000);

let admin: SupabaseClient;
let fx: BillingFixture | undefined;
test.afterEach(async () => { if (admin) { await cleanupBilling(admin, fx); fx = undefined; } });

test('JOB-BQ5 an item reconciles scope, progress and claimed quantity, with visible excess above scope', async ({ page }) => {
  admin = serviceClient('JOB-BQ5');
  // A 12 km claim is above both the 6 km assessment and 10 km scope; the issued work-order value is set at creation.
  fx = await createBillingFixture(admin, runId('JOBBQ5'), { workOrderValue: 1_000_000 });
  await signIn(page, 'finance@acme.test');
  await page.goto(`/projects/${fx.projectId}/contract`);

  await page.getByRole('button', { name: /new claim/i }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel(/^Bills$/i).selectOption(fx.workOrderId);
  await form.getByLabel(/SURVEY/).fill('12');
  await form.getByRole('button', { name: /create claim/i }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^(close|cancel|skip)/i }).first().click();
  const reconciliation = page.getByRole('region', { name: /billing reconciliation/i });
  const cells = reconciliation.getByRole('row').filter({ hasText: 'Route survey' }).getByRole('cell');
  await expect(cells.nth(1)).toHaveText('10');
  await expect(cells.nth(2)).toHaveText('6');
  await expect(cells.nth(3)).toHaveText('12');
  await expect(page.getByText('Over-claimed')).toBeVisible();
});
