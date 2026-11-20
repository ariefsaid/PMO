// @e2e-isolation: self-isolated — creates its own client, project, contract line, work order, stage list, document and claim; deletes them in afterEach.
// JOB-BQ11 (quantity surveyor): attachments per billing step. A step with a required file cannot be ticked without it; once the file is attached the
// step shows it and ticks. PARTLY LANDED: no push to the next step's owner (no task is raised) — not asserted here, listed as missing.
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signIn } from './helpers';
import { runId, serviceClient } from './support/jobFixtures';
import { cleanupBilling, createBillingFixture, raiseClaimAndOpen, setStageTemplate, type BillingFixture } from './support/billingFixture';

test.setTimeout(180_000);

let admin: SupabaseClient;
let fx: BillingFixture | undefined;
test.afterEach(async () => { if (admin) { await cleanupBilling(admin, fx); fx = undefined; } });

test('JOB-BQ11 a step with a required file is refused without it, and ticks once the file is attached', async ({ page }) => {
  admin = serviceClient('JOB-BQ11');
  fx = await createBillingFixture(admin, runId('JOBBQ11'));
  await setStageTemplate(admin, fx.projectId, [
    { name: 'Joint survey report', documents: [{ name: 'Survey report', required: true }] },
    { name: 'Client approval', clientSide: true },
  ]);

  await signIn(page, 'finance@acme.test');
  await raiseClaimAndOpen(page, fx, '4');
  const drawer = page.getByRole('dialog');
  const step = drawer.getByRole('listitem', { name: 'Joint survey report' });
  await expect(step).toContainText('Not attached');

  // Ticked without the required file: refused, still not complete.
  await drawer.getByRole('button', { name: 'Complete Joint survey report' }).click();
  await expect(drawer.getByRole('alert')).toContainText(/attach every required document/i);
  await expect(step).not.toContainText('Completed');

  // Attach the file, then the step ticks and shows the file.
  await step.getByLabel('Document for Survey report').selectOption({ label: fx.documentTitle });
  await step.getByRole('button', { name: 'Attach to Survey report' }).click();
  await expect(step.getByRole('link', { name: fx.documentTitle })).toBeVisible({ timeout: 15_000 });
  await drawer.getByRole('button', { name: 'Complete Joint survey report' }).click();
  await expect(step).toContainText('Completed');
  await expect(step.getByRole('link', { name: fx.documentTitle })).toBeVisible();
  await expect(drawer.getByRole('listitem', { name: 'Client approval' })).toContainText('Current');
});
