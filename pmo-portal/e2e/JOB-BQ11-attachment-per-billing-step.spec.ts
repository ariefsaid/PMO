// @e2e-isolation: self-isolated — creates its own client, project, contract line, work order, stage list, document and claim; deletes them in afterEach.
// JOB-BQ11 (billing lane): attachments per billing step. A step with a required file cannot be ticked without it; once the file is attached
// the step shows it and ticks, and the next step's owner finds it waiting in their needs-you list.
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_ID, need, runId, serviceClient } from './support/jobFixtures';
import { createJobRoleUser } from './support/jobRoleUser';
import { cleanupBilling, createBillingFixture, raiseClaimAndOpen, setStageTemplate, type BillingFixture } from './support/billingFixture';

test.setTimeout(180_000);

let admin: SupabaseClient;
let fx: BillingFixture | undefined;
test.afterEach(async () => { if (admin) { await cleanupBilling(admin, fx); fx = undefined; } });

test('JOB-BQ11 a step with a required file is refused without it, ticks once attached, and hands over to the next owner', async ({ page }) => {
  admin = serviceClient('JOB-BQ11');
  const db = admin;
  const run = runId('JOBBQ11');
  fx = await createBillingFixture(db, run);
  await setStageTemplate(db, fx.projectId, [
    { name: 'Joint survey report', documents: [{ name: 'Survey report', required: true }] },
    { name: 'Client approval', clientSide: true },
  ]);
  const billing = await createJobRoleUser(db, ORG_ID, 'billing_officer');
  const pm = await createJobRoleUser(db, ORG_ID, 'project_manager');
  // The next step belongs to the project's manager, so the hand-over names a different person's role.
  await db.from('projects').update({ project_manager_id: pm.id }).eq('id', fx.projectId).throwOnError();
  try {
    await billing.signIn(page);
    await raiseClaimAndOpen(page, fx, '4');
    const claimId = need('claim', await db.from('progress_claims').select('id').eq('project_id', fx.projectId).single()).id as string;
    // The step list belongs to the claim; its second step is the manager's.
    await db.from('claim_billing_stages').update({ owner_role: 'Project Manager' })
      .eq('claim_id', claimId).eq('project_id', fx.projectId).eq('position', 2).throwOnError();
    await page.goto(`/projects/${fx.projectId}/contract?open=${claimId}&openType=billingClaim`);
    const drawer = page.getByRole('dialog');
    const step = drawer.getByRole('listitem', { name: 'Joint survey report' });
    await expect(step.getByRole('link')).toHaveCount(0); // no file on the step yet

    // Ticked without the required file: refused, still not complete.
    await drawer.getByRole('button', { name: 'Complete Joint survey report' }).click();
    await expect(drawer.getByRole('alert')).toContainText(/attach every required document/i);
    await expect(step).not.toContainText(/Completed \d/);

    // Attach the file, then the step ticks and shows the file.
    await step.getByLabel('Document for Survey report').selectOption({ label: fx.documentTitle });
    await step.getByRole('button', { name: 'Attach to Survey report' }).click();
    await expect(step.getByRole('link', { name: fx.documentTitle })).toBeVisible({ timeout: 15_000 });
    await drawer.getByRole('button', { name: 'Complete Joint survey report' }).click();
    await expect(step).toContainText(/Completed \d/);
    await expect(step.getByRole('link', { name: fx.documentTitle })).toBeVisible();
    await expect(drawer.getByRole('listitem', { name: 'Client approval' })).toContainText('Current');

    // The next owner is told: the manager's needs-you list points at the claim's open step.
    await page.context().clearCookies();
    await pm.signIn(page);
    await page.goto('/');
    const pointer = page.getByRole('link', { name: /billing step waiting on your role/i });
    await expect(pointer).toBeVisible({ timeout: 15_000 });
    await page.goto(`/projects/${fx.projectId}/contract?open=${claimId}&openType=billingClaim`);
    const claim = page.getByRole('dialog');
    await expect(claim).toContainText('1 of 2 complete');
    await expect(claim.getByRole('listitem', { name: 'Client approval' })).toContainText('Current');
  } finally {
    await billing.remove();
    await pm.remove();
  }
});
