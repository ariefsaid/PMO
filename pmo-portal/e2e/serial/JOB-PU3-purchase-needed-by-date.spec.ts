// @e2e-isolation: serial — turns the org-wide needed-by rule on and off again (Admin); the purchase and the two logins are this run's own.
/**
 * JOB-PU3 — needed-by date on every line, on the purchasing side the case names: with the rule on, an order cannot be sent to the
 * supplier without a needed-by date; the requester sets it on the request, it fills every line, the buyer sees it, and the order then goes.
 */
import { expect } from '@playwright/test';
import { buyerTest as test } from '../support/buyerOrdering';
import { recordOrderWithConfirm } from '../helpers';
import { createProcurementFixture, type ProcurementFixture } from '../procurement-fixture';
import { roleJobUser } from '../support/roleJobUser';
import { ok, runId, serviceClient } from '../support/jobFixtures';
import { inDays } from '../support/jobJourney';
import { userClient } from '../support/stockFixture';

test.setTimeout(180_000);

let requester: Awaited<ReturnType<typeof roleJobUser>>;
let buyer: Awaited<ReturnType<typeof roleJobUser>>;
let purchase: ProcurementFixture;
let ruleWasOn = false;

test.beforeAll(async () => {
  const svc = serviceClient('JOB-PU3');
  const admin = await userClient('admin@acme.test');
  const org = await svc.from('organizations').select('po_needed_by_required_from').eq('id', '00000000-0000-0000-0000-000000000001').single();
  ok('needed-by rule read', org);
  ruleWasOn = Boolean((org.data as { po_needed_by_required_from: string | null }).po_needed_by_required_from);
  ok('rule on', await admin.rpc('set_po_needed_by_required', { p_on: true }));

  requester = await roleJobUser(svc, 'site_supervisor', runId('pu3-requester'));
  buyer = await roleJobUser(svc, 'buyer', runId('pu3-buyer'));
  // Raised while the rule is on, so the rule covers it; two lines, so "every line" is real.
  purchase = await createProcurementFixture({ status: 'Approved', title: 'JOB-PU3 needed by', withSupplier: true, requestedBy: requester.id, quantity: 2 });
});

test.afterAll(async () => {
  await purchase?.cleanup();
  await requester?.cleanup();
  await buyer?.cleanup();
  if (!ruleWasOn) {
    const admin = await userClient('admin@acme.test');
    const r = await admin.rpc('set_po_needed_by_required', { p_on: false });
    if (r.error) throw new Error(`JOB-PU3 restore rule: ${r.error.message}`);
  }
});

test('JOB-PU3 an order without a needed-by date is refused; the requester sets it, the buyer sees it, the order goes', async ({ page }) => {
  // 1-3. The buyer tries to send the order with no date: it is refused and nothing is ordered.
  await buyer.signIn(page);
  await page.goto(purchase.url);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await recordOrderWithConfirm(page);
  await expect(page.getByText(/Set the needed-by date before sending the order to the supplier/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Approved');

  // The requester sets the date on the request; it fills every line.
  const needed = inDays(5);
  await requester.signIn(page);
  await page.goto(purchase.url);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await page.getByRole('tab', { name: /^Line items/ }).click();
  const panel = page.getByTestId('order-needed-by-panel');
  await expect(panel).toContainText('Required before the order is sent to the supplier', { timeout: 20_000 });
  await panel.getByLabel('Order needed by').fill(needed);
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('Saved', { timeout: 20_000 });

  // The buyer reads the date on the request and the order now goes.
  await buyer.signIn(page);
  await page.goto(purchase.url);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await page.getByRole('tab', { name: /^Line items/ }).click();
  await expect(page.getByTestId('order-needed-by-value')).toHaveText(needed, { timeout: 20_000 });
  await recordOrderWithConfirm(page);
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Ordered', { timeout: 20_000 });
  await expect(page.getByText(/^PO-\d{10}$/).first()).toBeVisible({ timeout: 10_000 });
});
