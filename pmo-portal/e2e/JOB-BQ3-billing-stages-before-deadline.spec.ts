// @e2e-isolation: self-isolated — creates its own client, project, contract line, work order, stage list and claim; deletes them in afterEach.
// JOB-BQ3 (billing lane): each billing stage tracked (internal measurement, joint survey in the client's system, client approval) with a warning before
// the monthly invoice deadline. Goal: the claim shows its current stage and a deadline warning; completing the remaining stages clears the open work.
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_ID, runId, serviceClient } from './support/jobFixtures';
import { createJobRoleUser } from './support/jobRoleUser';
import { orgToday } from './support/jobJourney';
import { cleanupBilling, createBillingFixture, raiseClaimAndOpen, setStageTemplate, type BillingFixture } from './support/billingFixture';

test.setTimeout(180_000);

let admin: SupabaseClient;
let fx: BillingFixture | undefined;
let billing: Awaited<ReturnType<typeof createJobRoleUser>> | undefined;
// The login is removed after the fixture rows it wrote: those rows reference the user.
test.afterEach(async () => { if (admin) { await cleanupBilling(admin, fx); fx = undefined; } await billing?.remove(); billing = undefined; });

test('JOB-BQ3 a claim shows its current stage and the deadline warning, and finishing the stages clears the open work', async ({ page }) => {
  admin = serviceClient('JOB-BQ3');
  fx = await createBillingFixture(admin, runId('JOBBQ3'));
  await setStageTemplate(admin, fx.projectId, [
    { name: 'Internal measurement' },
    { name: 'Joint survey', clientSide: true },
    { name: 'Client approval', clientSide: true },
  ]);
  // The invoice deadline falls three days from today (or today, late in the month), with the default five-day warning window.
  const today = Number(orgToday().slice(8));
  const day = today + 3 <= 28 ? today + 3 : today;
  const daysLeft = day - today;
  await admin.from('projects').update({ invoice_deadline_day: day, invoice_deadline_warn_days: 5 }).eq('id', fx.projectId).throwOnError();
  billing = await createJobRoleUser(admin, ORG_ID, 'billing_officer');

  {
    await billing.signIn(page);
    await raiseClaimAndOpen(page, fx, '4');
    const drawer = page.getByRole('dialog');
    const stages = drawer.getByRole('list', { name: /billing stages/i });
    await expect(stages.getByRole('listitem', { name: 'Internal measurement' })).toContainText('Current');
    await expect(drawer).toContainText(new RegExp(`Invoice deadline .* ${daysLeft} days left`));

    // Internal measurement, then the joint survey with the client's document number.
    await drawer.getByRole('button', { name: 'Complete Internal measurement' }).click();
    await expect(stages.getByRole('listitem', { name: 'Internal measurement' })).toContainText('Completed');
    await drawer.getByLabel(/client's document number/i).fill('JS-001');
    await drawer.getByRole('button', { name: 'Complete Joint survey' }).click();
    await expect(stages.getByRole('listitem', { name: 'Joint survey' })).toContainText('Completed');
    await expect(stages.getByRole('listitem', { name: 'Client approval' })).toContainText('Current');
    await expect(drawer).toContainText('2 of 3 complete');
    await expect(drawer).toContainText(/Invoice deadline/);

    // The last stage done: nothing is left open and the deadline warning is gone.
    await drawer.getByLabel(/client's document number/i).fill('CA-001');
    await drawer.getByRole('button', { name: 'Complete Client approval' }).click();
    await expect(drawer).toContainText('3 of 3 complete');
    await expect(drawer.getByText(/Invoice deadline/)).toHaveCount(0);
  }
});
