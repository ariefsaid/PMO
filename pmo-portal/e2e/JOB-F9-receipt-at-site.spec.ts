// @e2e-isolation: self-isolated — unique item and site warehouse per run; the posted stock ledger is append-only, so every code carries a per-run suffix.
/**
 * JOB-F9 — recount on receipt in the field (#2523). The site keeper recounts a delivery of 10 and confirms what arrived: 9.
 * Goal oracle: site stock rises by 9, by the keeper's own receipt.
 * Partly built: a transfer in transit with a recorded shortfall of 1 is not built, so the shortfall is not asserted.
 */
import { test } from '@playwright/test';
import { signIn } from './helpers';
import { keeperOf, makeItem, makeWarehouse, runSuffix, userClient } from './support/stockFixture';
import { chooseItem, expectOnHand, whLabel } from './support/stockUi';

test.setTimeout(180_000);

test('JOB-F9 the site keeper confirms 9 of a delivery of 10 and site stock rises by 9', async ({ page }) => {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const item = await makeItem(admin, sfx, 'PIPE');
  const site = await makeWarehouse(admin, sfx, 'SITE', 'site');
  await keeperOf(admin, site.id);

  await signIn(page, 'engineer@acme.test');
  await page.goto('/stock/new/receive');
  await page.getByLabel(/^Warehouse/).selectOption({ label: whLabel(site) });
  await chooseItem(page, item.code);
  await page.getByLabel(/^Quantity/).fill('9');
  await page.getByLabel(/^Unit cost/).fill('25');
  await page.getByRole('button', { name: 'Post receipt' }).click();
  await page.waitForURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await expectOnHand(page, site, item.code, '9');
});
