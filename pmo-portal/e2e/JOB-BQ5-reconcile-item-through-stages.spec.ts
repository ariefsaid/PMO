// @e2e-isolation: self-isolated — creates its own client, project, contract line, work order, assessment and claim; deletes them in afterEach.
// JOB-BQ5 (billing lane): reconcile each item. The app reconciles scope, progress to date and measured (claimed) per item; a claim
// may exceed assessed progress and the visible over-claim label shows when it also exceeds the BoQ scope. The claim is kept.
// GAP (class a, docs/private/walk-1124c/lane-hes.md): the reconciliation panel is money-gated, so the quantity surveyor — this case's
// tester — sees no reconciliation and cannot raise a claim (revenue write is Admin/Finance); the rule is asserted on the screen by
// Finance, and the surveyor's access to the same claim is asserted here too.
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_ID, need, runId, serviceClient } from './support/jobFixtures';
import { createJobRoleUser } from './support/jobRoleUser';
import { cleanupBilling, createBillingFixture, type BillingFixture } from './support/billingFixture';

test.setTimeout(180_000);

let admin: SupabaseClient;
let fx: BillingFixture | undefined;
test.afterEach(async () => { if (admin) { await cleanupBilling(admin, fx); fx = undefined; } });

test('JOB-BQ5 an item reconciles scope, progress and claimed quantity, with visible excess above scope', async ({ page }) => {
  admin = serviceClient('JOB-BQ5');
  const db = admin;
  // A 12 km claim is above both the 6 km assessment and 10 km scope; the issued work-order value is set at creation.
  fx = await createBillingFixture(db, runId('JOBBQ5'), { workOrderValue: 1_000_000 });
  const finance = await createJobRoleUser(db, ORG_ID, 'finance_officer');
  const qs = await createJobRoleUser(db, ORG_ID, 'quantity_surveyor');
  try {
    await finance.signIn(page);
    await page.goto(`/projects/${fx.projectId}/contract`);

    await page.getByRole('button', { name: /new claim/i }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel(/^Bills$/i).selectOption(fx.workOrderId);
    await form.getByLabel(/SURVEY/).fill('12');
    await form.getByRole('button', { name: /create claim/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^(close|cancel|skip)/i }).first().click();
    const reconciliation = page.getByRole('region', { name: /billing reconciliation/i });
    const cells = reconciliation.getByRole('row').filter({ hasText: 'Route survey' }).getByRole('cell');
    // Row headers are not role=cell, so the first data cell is Scope.
    await expect(cells.nth(0)).toHaveText('10');
    await expect(cells.nth(1)).toHaveText('6');
    await expect(cells.nth(2)).toHaveText('12');
    await page.getByRole('button', { name: /edit lines|edit contract lines/i }).click();
    await expect(page.getByTestId(`boq-remaining-${fx.boqId}`)).toContainText('Over-claimed');

    // The quantity surveyor reads the same claim: it is kept, and opening it lands on the claim's own screen.
    const claimId = need('claim', await db.from('progress_claims').select('id').eq('project_id', fx.projectId).single()).id as string;
    await page.context().clearCookies();
    await qs.signIn(page);
    await page.goto(`/projects/${fx.projectId}/contract?open=${claimId}&openType=billingClaim`);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /new claim/i })).toHaveCount(0);
  } finally {
    await finance.remove();
    await qs.remove();
  }
});
