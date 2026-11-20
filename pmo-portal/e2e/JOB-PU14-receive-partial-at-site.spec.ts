// @e2e-isolation: self-isolated — unique item and site warehouse per run, with the Engineer made its keeper; the posted ledger is append-only so codes carry a per-run suffix.
/** JOB-PU14 — goods ordered for 40 arrive at a site as 37; the site's keeper receives 37 and stock at that site rises by 37.
 *  Partly landed: the receipt at a site posts; the order showing "3 outstanding" is not linked to a stock receipt and is not tested. */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { keeperOf, makeItem, makeWarehouse, runSuffix, userClient } from './support/stockFixture';
import { chooseItem, label } from './support/jobStock';

test.setTimeout(120_000);

test('JOB-PU14 the site keeper receives 37 and the site stock rises by 37', async ({ page }) => {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const item = await makeItem(admin, sfx, 'DEL');
  const site = await makeWarehouse(admin, sfx, 'SITE', 'site');
  await keeperOf(admin, site.id);

  await signIn(page, 'engineer@acme.test');
  await page.goto('/stock/new/receive');
  await page.getByLabel(/^Warehouse/).selectOption({ label: label(site) });
  await chooseItem(page, item.code);
  await page.getByLabel(/^Quantity/).fill('37');
  await page.getByLabel(/^Unit cost/).fill('25');
  await page.getByRole('button', { name: 'Post receipt' }).click();
  await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  await page.goto('/stock');
  await page.getByPlaceholder('Search items').fill(item.code);
  await expect(page.getByRole('row').filter({ hasText: site.code })).toContainText('37');
});
