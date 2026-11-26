// @e2e-isolation: self-isolated — unique item and site warehouse per run, with a Storekeeper (job role) made its keeper; the posted ledger is append-only so codes carry a per-run suffix.
/** JOB-PU14 — goods ordered for 40 arrive at a site as 37; the site's keeper receives 37 and stock at that site rises by 37.
 *  Partly landed: the receipt at a site posts; the order showing "3 outstanding" is not linked to a stock receipt and is not tested. */
import { test, expect } from '@playwright/test';
import { roleJobUser } from './support/roleJobUser';
import { runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { keeperOf, makeItem, makeWarehouse, runSuffix, userClient } from './support/stockFixture';
import { chooseItem, label } from './support/jobStock';

test.setTimeout(120_000);

test('JOB-PU14 the site keeper receives 37 and the site stock rises by 37', async ({ page }) => {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const item = await makeItem(admin, sfx, 'DEL');
  const site = await makeWarehouse(admin, sfx, 'SITE', 'site');
  // The storekeeper does the step; an Admin names them keeper of the site.
  const keeper = await roleJobUser(serviceClient('JOB-PU14'), 'storekeeper', runId('pu14-sk'));
  try {
  await keeperOf(admin, site.id, keeper.id);

  await keeper.signIn(page);
  await page.goto('/stock/new/receive');
  await page.getByLabel(/^Warehouse/).selectOption({ label: label(site) });
  await chooseItem(page, item.code);
  await page.getByLabel(/^Quantity/).fill('37');
  await page.getByLabel(/^Unit cost/).fill('25');
  await page.getByRole('button', { name: 'Post receipt' }).click();
  await page.getByRole('dialog', { name: 'Post this receipt?' }).getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  await page.goto('/stock');
  await page.getByPlaceholder('Search items').fill(item.code);
  await expect(page.getByRole('row').filter({ hasText: site.name })).toContainText('37');
  } finally {
    const own = `select id from stock_documents where created_by = '${keeper.id}'`;
    sqlAsOwner(`delete from stock_ledger where document_id in (${own}); delete from stock_document_lines where document_id in (${own}); delete from stock_documents where created_by = '${keeper.id}'; delete from stock_warehouse_keepers where user_id = '${keeper.id}';`);
    await keeper.cleanup();
  }
});
