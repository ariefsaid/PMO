// @e2e-isolation: self-isolated — creates its own client, project, contract line, work order, confirmed BAST and claim; deletes them in afterEach, then its login.
// JOB-BQ5 (billing lane): the Billing Officer raises a claim of 90 against an accepted 80 (confirmed BAST). The claim form warns that it is
// more than the accepted quantity still claimable, the claim is kept at 90, and the item's accepted quantity stays 80.
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_ID, need, ok, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { createJobRoleUser } from './support/jobRoleUser';
import { cleanupBilling, createBillingFixture, type BillingFixture } from './support/billingFixture';

test.setTimeout(180_000);

let admin: SupabaseClient | undefined;
let fx: BillingFixture | undefined;
let acceptanceId = '';
let officer: Awaited<ReturnType<typeof createJobRoleUser>> | undefined;

test.afterEach(async () => {
  try {
    if (!admin) return;
    if (acceptanceId) {
      // Acceptances are managed by their RPC (a delete is refused for every client): this run's rows go as the database owner.
      sqlAsOwner(`delete from public.work_order_acceptance_lines where acceptance_id = '${acceptanceId}'; delete from public.work_order_acceptances where id = '${acceptanceId}';`);
      acceptanceId = '';
    }
    await cleanupBilling(admin, fx);
    fx = undefined;
  } finally {
    // The login owns rows the cleanup deletes, so it goes last.
    await officer?.remove();
    officer = undefined;
  }
});

test('JOB-BQ5 a claim of 90 against an accepted 80 warns, is kept at 90, and accepted stays 80', async ({ page }) => {
  const db = serviceClient('JOB-BQ5');
  admin = db;
  fx = await createBillingFixture(db, runId('JOBBQ5'), { workOrderValue: 9_000_000, lineQuantity: 100 } /* the order must be worth the 90 km claimed (4,500,000) */);
  officer = await createJobRoleUser(db, ORG_ID, 'billing_officer');
  // The contract line and its work-order allocation are created large enough to hold the client's accepted 80 (a line with progress cannot be resized).
  const finance = need('finance profile', await db.from('profiles').select('id').eq('org_id', ORG_ID).eq('email', 'finance@acme.test').single());
  acceptanceId = need('acceptance', await db.from('work_order_acceptances').insert({
    org_id: ORG_ID, project_id: fx.projectId, work_order_id: fx.workOrderId, acceptance_date: new Date().toISOString().slice(0, 10),
    is_final: false, status: 'Confirmed', prepared_by: finance.id, confirmed_by: finance.id, confirmed_at: new Date().toISOString(), confirm_basis: 'standard',
  }).select('id').single()).id as string;
  ok('acceptance line', await db.from('work_order_acceptance_lines').insert({ acceptance_id: acceptanceId, boq_item_id: fx.boqId, quantity: 80 }));

  // The order's contract-quantities table carries the item's accepted (confirmed BAST) quantity in its Delivered column (the only figure with the unit beside it).
  const acceptedOf = (item: string) => page.getByRole('table', { name: /^Contract quantities for/ }).getByRole('row').filter({ hasText: item });
  await officer.signIn(page);
  await page.goto(`/projects/${fx.projectId}/contract`);
  await expect(acceptedOf('Route survey')).toContainText(/80 km/, { timeout: 15_000 });

  await page.getByRole('button', { name: /new claim/i }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel(/^Bills$/i).selectOption(fx.workOrderId);
  await form.getByLabel(/SURVEY/).fill('90');
  await expect(form.getByTestId(`claim-overclaim-${fx.boqId}`)).toContainText(/accepted 80/);
  await expect(form.getByTestId(`claim-overclaim-${fx.boqId}`)).toContainText('You can still raise the claim');
  await form.getByRole('button', { name: /create claim/i }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^(close|cancel|skip)/i }).first().click();

  // The claim is kept at 90; the accepted quantity stays 80.
  const reconciliation = page.getByRole('region', { name: /billing reconciliation/i });
  const cells = reconciliation.getByRole('row').filter({ hasText: 'Route survey' }).getByRole('cell');
  await expect(cells.nth(2)).toHaveText('90');
  await expect(acceptedOf('Route survey')).toContainText(/80 km/);
});
