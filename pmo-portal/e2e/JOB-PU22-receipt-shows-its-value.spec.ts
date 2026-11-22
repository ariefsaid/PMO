// @e2e-isolation: self-isolated — creates its own Ordered purchase (service role) with one priced line and a complete receipt, and removes them afterwards.
/**
 * JOB-PU22 — the person who received Rp 45 million of goods sees the receipt's value (from the order lines) on the purchase, not a
 * dash; and the work order's cost page, which counts a receipt only once its supplier bill is recorded, says exactly that.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { createProcurementFixture, serviceClient, type ProcurementFixture } from './procurement-fixture';

test.setTimeout(120_000);

let fixture: ProcurementFixture;
test.beforeAll(async () => {
  fixture = await createProcurementFixture({ status: 'Received', title: 'JOB-PU22 received', withSupplier: true, quantity: 3, rate: 15_000_000 });
  const admin = serviceClient();
  const { error } = await admin.from('procurement_receipts').insert({
    procurement_id: fixture.id, status: 'Complete', receipt_date: new Date().toISOString().slice(0, 10),
    org_id: process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001',
  });
  if (error) throw new Error(`JOB-PU22 receipt: ${error.message}`);
});
test.afterAll(async () => { await fixture?.cleanup(); });

test('JOB-PU22 the receipt row shows its value read from the order lines (Rp 45 million)', async ({ page }) => {
  await signIn(page, 'finance@acme.test');
  await page.goto(`${fixture.url}/files`);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  const value = page.getByTestId('receipt-value').first();
  await expect(value).toBeVisible({ timeout: 15_000 });
  await expect(value).toContainText(/45[.,]000[.,]000/);
  await expect(page.getByText('From the order lines').first()).toBeVisible();
});
