// @e2e-isolation: self-isolated — creates its own client, project, contract line, work order and a claim whose steps carry targets; deletes them in afterEach.
/**
 * JOB-BQ3 (billing lane): billing steps with target days. A step that passes its target shows overdue on the claim, and an
 * optional step that is due can be marked not needed with a reason — kept on the claim, for the billing officer.
 */
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_ID, need, runId, serviceClient } from './support/jobFixtures';
import { createJobRoleUser } from './support/jobRoleUser';
import { inDays } from './support/jobJourney';
import { cleanupBilling, createBillingFixture, type BillingFixture } from './support/billingFixture';

test.setTimeout(180_000);

let admin: SupabaseClient;
let fx: BillingFixture | undefined;
test.afterEach(async () => { if (admin) { await cleanupBilling(admin, fx); fx = undefined; } });

test('JOB-BQ3 a claim shows an overdue step and lets an optional step be marked not needed with a reason', async ({ page }) => {
  admin = serviceClient('JOB-BQ3-TARGETS');
  const db = admin;
  const run = runId('bq3t');
  fx = await createBillingFixture(db, run);
  const billing = await createJobRoleUser(db, ORG_ID, 'billing_officer');
  try {
    const finance = need('finance profile', await db.from('profiles').select('id').eq('org_id', ORG_ID).eq('email', 'finance@acme.test').single());
    const claim = need('claim', await db.from('progress_claims').insert({
      org_id: ORG_ID, project_id: fx.projectId, kind: 'progress', currency: 'IDR', gross_amount: 1000, created_by: finance.id,
    }).select('id').single());
    // Step 1 is optional and three days past its two-day target; step 2 waits behind it.
    need('steps', await db.from('claim_billing_stages').insert([
      { org_id: ORG_ID, claim_id: claim.id, project_id: fx.projectId, position: 1, name: `${run} joint survey`, client_side: false, started_on: inDays(-4), target_days: 2, optional: true },
      { org_id: ORG_ID, claim_id: claim.id, project_id: fx.projectId, position: 2, name: `${run} client approval`, client_side: true },
    ]).select('id').limit(1));

    // 1–3. The billing officer opens the claim: the step past its target reads overdue.
    await billing.signIn(page);
    await page.goto(`/projects/${fx.projectId}/contract?open=${claim.id}&openType=billingClaim`);
    const drawer = page.getByRole('dialog');
    const stages = drawer.getByRole('list', { name: 'Billing stages' });
    const step = stages.getByRole('listitem', { name: `${run} joint survey` });
    await expect(step).toContainText(/Overdue/);
    await expect(step).toContainText(/4 days, target 2/);

    // 4. The optional step is marked not needed with a reason, and the claim keeps it.
    await step.getByRole('button', { name: `Mark ${run} joint survey as not needed` }).click();
    const reason = page.getByRole('dialog', { name: `Mark ${run} joint survey as not needed` });
    await reason.getByLabel('Reason').fill('The client joined the final survey instead.');
    await reason.getByRole('button', { name: 'Mark not needed' }).click();
    await expect(step).toContainText(/Not needed/);
    await expect(step).toContainText(/Reason: The client joined the final survey instead\./);
    await expect(stages.getByRole('listitem', { name: `${run} client approval` })).toContainText('Current');
    await expect(drawer).toBeVisible();
  } finally {
    await billing.remove();
  }
});
