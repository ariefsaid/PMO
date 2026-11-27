// @e2e-isolation: self-isolated — creates its own client, project, contract line, work order, stage list and claim; deletes them in afterEach.
/**
 * AC-BIS-006 (#3022, billing lane): the billing officer raises a claim's invoice at its own step when the step list goes on after
 * it. The project's list (set up as an Admin would) is Measure > Input invoice (the invoice step) > Tax invoice > Submit to client.
 * Goal: with only Measure done, the invoice is created; afterwards the invoice step and the later steps are still open and the
 * officer completes them on the claim.
 */
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_ID, need, runId, serviceClient } from './support/jobFixtures';
import { createJobRoleUser } from './support/jobRoleUser';
import { cleanupBilling, createBillingFixture, setStageTemplate, type BillingFixture } from './support/billingFixture';

test.setTimeout(180_000);

let admin: SupabaseClient;
let fx: BillingFixture | undefined;
let billing: Awaited<ReturnType<typeof createJobRoleUser>> | undefined;
// The login is removed after the fixture rows it wrote: those rows reference the user.
test.afterEach(async () => {
  if (admin && fx) {
    const { error } = await admin.from('sales_invoices').delete().eq('project_id', fx.projectId);
    if (error) throw new Error(`AC-BIS-006 cleanup invoices: ${error.message}`);
    await cleanupBilling(admin, fx);
    fx = undefined;
  }
  await billing?.remove();
  billing = undefined;
});

test('AC-BIS-006 the billing officer raises the invoice at its own step and completes the later steps afterwards', async ({ page }) => {
  admin = serviceClient('AC-BIS-006');
  fx = await createBillingFixture(admin, runId('bis006'));
  await setStageTemplate(admin, fx.projectId, [{ name: 'Measure' }, { name: 'Input invoice' }, { name: 'Tax invoice' }, { name: 'Submit to client' }]);
  await admin.from('billing_stage_templates').update({ invoice_step: true }).eq('project_id', fx.projectId).eq('position', 2).throwOnError();
  billing = await createJobRoleUser(admin, ORG_ID, 'billing_officer');

  // The billing officer makes the claim and attaches its evidence.
  await billing.signIn(page);
  await page.goto(`/projects/${fx.projectId}/contract`);
  await page.getByRole('button', { name: /new claim|tagihan baru/i }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel(/^(Bills|Menagih)$/i).selectOption(fx.workOrderId);
  await form.getByLabel(/SURVEY/).fill('4');
  await form.getByRole('button', { name: /create claim|buat tagihan/i }).click();
  const evidence = page.getByRole('dialog');
  await evidence.getByLabel(/evidence document|dokumen bukti/i).selectOption(fx.documentId);
  await evidence.getByRole('button', { name: /^(attach|lampirkan)$/i }).click();
  await expect(evidence).toBeHidden({ timeout: 15_000 });
  const claim = need('claim', await admin.from('progress_claims').select('id').eq('project_id', fx.projectId).single());

  // Only the step before the invoice step is done.
  await page.goto(`/projects/${fx.projectId}/contract?open=${claim.id}&openType=billingClaim`);
  const drawer = page.getByRole('dialog');
  const stages = drawer.getByRole('list', { name: /billing stages/i });
  await expect(stages.getByRole('listitem', { name: 'Measure' })).toContainText('Current', { timeout: 30_000 });
  await drawer.getByRole('button', { name: 'Complete Measure' }).click();
  await expect(stages.getByRole('listitem', { name: 'Measure' })).toContainText('Completed');
  await expect(stages.getByRole('listitem', { name: 'Input invoice' })).toContainText('Current');

  // The invoice is raised at its own step.
  await drawer.getByRole('button', { name: /^(raise invoice|terbitkan invoice)$/i }).click();
  const confirm = page.getByRole('dialog', { name: /(create this claim's invoice\?|buat invoice tagihan ini\?)/i });
  await confirm.getByRole('button', { name: /^(create invoice|buat invoice)$/i }).click();
  await expect(confirm).toBeHidden({ timeout: 15_000 });
  await expect.poll(async () => (await admin.from('sales_invoices').select('id').eq('id', claim.id)).data?.length ?? 0, { timeout: 15_000 }).toBe(1);

  // The invoice step and the steps after it are still open, and the officer completes them on the claim.
  await page.goto(`/projects/${fx.projectId}/contract?open=${claim.id}&openType=billingClaim`);
  await expect(stages.getByRole('listitem', { name: 'Input invoice' })).toContainText('Current', { timeout: 30_000 });
  await expect(drawer).toContainText('1 of 4 complete');
  for (const step of ['Input invoice', 'Tax invoice', 'Submit to client']) {
    await drawer.getByRole('button', { name: `Complete ${step}` }).click();
    await expect(stages.getByRole('listitem', { name: step })).toContainText('Completed');
  }
  await expect(drawer).toContainText('4 of 4 complete');
});
