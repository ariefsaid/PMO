// @e2e-isolation: self-isolated — creates its own Received purchase naming a supplier (service role) and removes it afterwards; records no bill.
/**
 * JOB-PU23 — Finance starts a vendor bill from the payables list: "New vendor bill", picks the purchase, and lands on that
 * purchase with the supplier-bill form open.
 */
import { test, expect } from '@playwright/test';
import { signIn, pickComboboxOption } from './helpers';
import { createProcurementFixture, type ProcurementFixture } from './procurement-fixture';

test.setTimeout(120_000);

let fixture: ProcurementFixture;
test.beforeAll(async () => { fixture = await createProcurementFixture({ status: 'Received', title: 'JOB-PU23 bill me', withSupplier: true }); });
test.afterAll(async () => { await fixture?.cleanup(); });

test('JOB-PU23 a vendor bill starts from the payables list and opens its form on the chosen purchase', async ({ page }) => {
  await signIn(page, 'finance@acme.test');
  await page.goto('/finance/payables');
  await page.getByTestId('new-vendor-bill').click();
  const dialog = page.getByRole('dialog', { name: 'New vendor bill' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await pickComboboxOption(dialog, page, /Purchase/, new RegExp(fixture.code));
  await dialog.getByRole('button', { name: 'Continue to the bill' }).click();
  await expect(page).toHaveURL(new RegExp(`/procurement/${fixture.id}`), { timeout: 20_000 });
  await expect(page.getByTestId('vi-inline-capture')).toBeVisible({ timeout: 20_000 });
});
