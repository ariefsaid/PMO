// @e2e-isolation: self-isolated — creates its own namespaced Approved procurement and a Draft one (service role) and removes them afterwards.
/** JOB-PU1 — no order without a request: from an approved request the buyer records the order and it carries a PO number on that request; a draft that was never requested offers no "Record order" button.
 *  Note: a draft's Files tab also offers "Record the first document" with Order as a choice (a deliberate start-at-order capture, AC-PFE-001); this journey asserts the header action only. */
import { test, expect } from '@playwright/test';
import { login, recordOrderWithConfirm } from './helpers';
import { createProcurementFixture, SEED_SUPPLIER_NAME, type ProcurementFixture } from './procurement-fixture';

test.setTimeout(120_000);

let approved: ProcurementFixture;
let draft: ProcurementFixture;
let unsupplied: ProcurementFixture;
test.beforeAll(async () => {
  approved = await createProcurementFixture({ status: 'Approved', title: 'JOB-PU1 approved', withSupplier: true });
  unsupplied = await createProcurementFixture({ status: 'Approved', title: 'JOB-PU1 no supplier' });
  draft = await createProcurementFixture({ status: 'Draft', title: 'JOB-PU1 draft' });
});
test.afterAll(async () => { await approved?.cleanup(); await draft?.cleanup(); await unsupplied?.cleanup(); });

test('JOB-PU1 AC-WAIT-075 an order is raised from the approved request and carries its number; a draft offers no order action', async ({ page }) => {
  await login(page, 'finance@acme.test');

  await page.goto(draft.url);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Draft');
  await expect(page.getByRole('button', { name: 'Record order' })).toHaveCount(0);

  await page.goto(approved.url);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  // Not by accident: the order is recorded only after a confirmation that names the supplier and the amount.
  await page.getByRole('button', { name: 'Record order' }).first().click();
  const confirm = page.getByRole('dialog').filter({ hasText: 'Record this order?' });
  await expect(confirm).toContainText(SEED_SUPPLIER_NAME);
  await expect(confirm).toContainText(/12[.,]000/);
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Approved');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Approved');
  await recordOrderWithConfirm(page, SEED_SUPPLIER_NAME);
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Ordered', { timeout: 15_000 });
  await expect(page.getByText(/^PO-\d{10}$/).first()).toBeVisible({ timeout: 10_000 });

  // AC-WAIT-075: the Finance viewer recording the order is told the exact person the receipt is assigned to, with
  // their role — the requester who also manages this purchase's project, not a generic "Waiting" label.
  await expect(page.getByTestId('procurement-waiting')).toContainText('Diego Salvatierra', { timeout: 20_000 });
  await expect(page.getByTestId('procurement-waiting')).toContainText('Project Manager');
  expect(await page.getByTestId('procurement-waiting').textContent()).toMatch(/^Waiting for /);
});

test('JOB-PU1 an order is not recorded without a supplier: the supplier is asked for first and nothing is ordered', async ({ page }) => {
  await login(page, 'finance@acme.test');
  await page.goto(unsupplied.url);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Record order' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Set supplier' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Approved');
  await expect(page.getByText(/^PO-\d{10}$/)).toHaveCount(0);
});
