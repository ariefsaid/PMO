// @e2e-isolation: serial — names the Buyer as an ordering role (org-wide purchase rule) for the read; the recorded purchase, order, receipt and payment are this run's own.
/**
 * JOB-PU11 — a checklist per request: the Buyer opens a request whose order, receipt and payment are all recorded and reads the
 * three stages as its checklist — one order, one receipt, one payment — with the purchase's own money beside them.
 */
import { expect } from '@playwright/test';
import { buyerTest as test } from '../support/buyerOrdering';
import { createProcurementFixture, type ProcurementFixture } from '../procurement-fixture';
import { roleJobUser } from '../support/roleJobUser';
import { ORG_ID, need, ok, runId, serviceClient } from '../support/jobFixtures';
import { orgToday } from '../support/jobJourney';

test.setTimeout(120_000);

let buyer: Awaited<ReturnType<typeof roleJobUser>>;
let purchase: ProcurementFixture;
let paymentId = '';

test.beforeAll(async () => {
  const svc = serviceClient('JOB-PU11');
  buyer = await roleJobUser(svc, 'buyer', runId('pu11-buyer'));
  purchase = await createProcurementFixture({ status: 'Received', title: 'JOB-PU11 checklist', withSupplier: true });
  const po = need('order', await svc.from('purchase_orders').insert({
    org_id: ORG_ID, procurement_id: purchase.id, po_number: `PO-11-${Date.now()}`,
    status: 'Issued', date: orgToday(), amount: 12000, currency: 'USD',
  }).select('id').single());
  ok('receipt', await svc.from('procurement_receipts').insert({
    org_id: ORG_ID, procurement_id: purchase.id, po_id: po.id, gr_number: `GR-11-${Date.now()}`,
    receipt_date: orgToday(), status: 'Complete',
  }));
  // A payment recorded on the purchase. No bill in this fixture, so the pay stage names the payment alone rather than
  // "bill + payment" (on a purchase that holds a bill the stage counts both).
  paymentId = need('payment', await svc.from('payments').insert({
    org_id: ORG_ID, procurement_id: purchase.id, pay_number: `PAY-11-${Date.now()}`,
    status: 'Cleared', date: orgToday(), amount: 12000, currency: 'USD',
  }).select('id').single()).id as string;
  ok('status', await svc.from('procurements').update({ status: 'Paid' }).eq('id', purchase.id));
});

test.afterAll(async () => {
  const svc = serviceClient('JOB-PU11');
  if (paymentId) ok('payment cleanup', await svc.from('payments').delete().eq('id', paymentId));
  await purchase?.cleanup();
  await buyer?.cleanup();
});

test('JOB-PU11 the request reads its order, receipt and payment as one checklist', async ({ page }) => {
  await buyer.signIn(page);
  await page.goto(purchase.url);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  const tracker = page.getByTestId('procurement-stage-tracker');
  const stage = (name: string) => tracker.locator('li').filter({ has: page.getByText(name, { exact: true }) });
  await expect(stage('Order')).toContainText('1 order', { timeout: 20_000 });
  await expect(stage('Receive')).toContainText('1 receipt');
  await expect(stage('Pay')).toContainText('1 payment');
  // Each stage carries the purchase's money, so the checklist is a checklist and not a set of ticks.
  await expect(stage('Order')).toContainText(/12[.,]000/);
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Paid');
});
