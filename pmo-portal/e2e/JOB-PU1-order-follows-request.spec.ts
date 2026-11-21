// @e2e-isolation: self-isolated — creates its own namespaced Approved procurement and a Draft one (service role) and removes them afterwards.
/** JOB-PU1 — no order without a request: from an approved request the buyer records the order and it carries a PO number on that request; a draft that was never requested offers no "Record order" button.
 *  Note: a draft's Files tab also offers "Record the first document" with Order as a choice (a deliberate start-at-order capture, AC-PFE-001); this journey asserts the header action only. */
import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { createProcurementFixture, type ProcurementFixture } from './procurement-fixture';

test.setTimeout(120_000);

let approved: ProcurementFixture;
let draft: ProcurementFixture;
test.beforeAll(async () => {
  approved = await createProcurementFixture({ status: 'Approved', title: 'JOB-PU1 approved' });
  draft = await createProcurementFixture({ status: 'Draft', title: 'JOB-PU1 draft' });
});
test.afterAll(async () => { await approved?.cleanup(); await draft?.cleanup(); });

test('JOB-PU1 an order is raised from the approved request and carries its number; a draft offers no order action', async ({ page }) => {
  await login(page, 'finance@acme.test');

  await page.goto(draft.url);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Draft');
  await expect(page.getByRole('button', { name: 'Record order' })).toHaveCount(0);

  await page.goto(approved.url);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Record order' }).click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Ordered', { timeout: 15_000 });
  await expect(page.getByText(/^PO-\d{10}$/).first()).toBeVisible({ timeout: 10_000 });
});
