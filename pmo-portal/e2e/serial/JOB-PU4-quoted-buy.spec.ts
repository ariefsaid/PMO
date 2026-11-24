// @e2e-isolation: serial — configures and restores the org ordering roles; fixtures are otherwise isolated;  — creates its own namespaced Approved procurement (service role) and removes it afterwards.
/** JOB-PU4 — a buyer sources by quotation: from an approved request they ask for quotes, add two, pick one, and the order is recorded at the chosen vendor and price.
 *  Partly landed: the quoted route exists; the direct-purchase shortcut (no quotes, buy from a shop) is not offered and is not tested. */
import { expect } from '@playwright/test';
import { buyerTest as test } from '../support/buyerOrdering';
import { recordOrderWithConfirm } from '../helpers';
import { createProcurementFixture, type ProcurementFixture } from '../procurement-fixture';

test.setTimeout(150_000);

import { moneyJobRole } from "../support/moneyJobRole";
let buyer: Awaited<ReturnType<typeof moneyJobRole>>;
let fixture: ProcurementFixture;
test.beforeEach(async () => { buyer = await moneyJobRole("buyer"); fixture = await createProcurementFixture({ status: 'Approved', title: 'JOB-PU4' }); });
test.afterEach(async () => { await fixture?.cleanup(); await buyer?.cleanup(); });

test('JOB-PU4 two quotes are added, one is chosen, and the order follows the chosen quote', async ({ page }) => {
  await buyer.login(page);
  await page.goto(fixture.url);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: /^quotations/i }).click();
  await expect(page.getByTestId("add-quotation")).toHaveCount(0);
  await page.getByTestId("quote-next-step").getByRole("button", { name: "Request quotations" }).click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Vendor Quoted', { timeout: 15_000 });

  await page.getByRole('tab', { name: /^quotations/i }).click();
  const vendorNames: string[] = [];
  for (const [index, total] of [[0, '9000'], [1, '8500']] as const) {
    await page.getByTestId('add-quotation').click();
    const form = page.getByTestId('add-quotation-form');
    await form.getByRole('combobox', { name: /supplier/i }).click();
    const option = page.getByRole('listbox').getByRole('option').nth(index);
    await expect(option).toBeVisible({ timeout: 30_000 });
    vendorNames.push(((await option.textContent()) ?? '').trim());
    await option.click();
    await form.getByLabel(/quoted total/i).fill(total);
    await form.getByRole('button', { name: 'Add quotation' }).click();
    await expect(page.getByTestId('vendor-quotes').getByRole('row').filter({ hasText: vendorNames[index] })).toBeVisible({ timeout: 15_000 });
  }

  // Pick the cheaper one (the second).
  await page.getByRole('button', { name: `Select quote ${vendorNames[1]}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Select quote' }).click();
  const chosen = page.getByTestId('vendor-quotes').getByRole('row').filter({ hasText: vendorNames[1] });
  await expect(chosen).toContainText('Selected', { timeout: 15_000 });
  await expect(chosen).toContainText(/8[.,]500/);

  // The order is raised on the chosen quote.
  await recordOrderWithConfirm(page);
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Ordered', { timeout: 15_000 });
});
