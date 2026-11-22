// @e2e-isolation: self-isolated — unique item and two site warehouses per run; the posted ledger is append-only so codes carry a per-run suffix.
/** JOB-W4 — leftover material goes from one site to another: site B reads 4, site C reads 6, and the all-locations view shows both. */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { makeItem, makeWarehouse, postReceive, runSuffix, userClient } from './support/stockFixture';
import { chooseItem, label } from './support/jobStock';

test.setTimeout(150_000);

test('JOB-W4 a transfer between two sites leaves 4 at the sender and 6 at the receiver, both visible in one view', async ({ page }) => {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const item = await makeItem(admin, sfx, 'T');
  const siteB = await makeWarehouse(admin, sfx, 'SB', 'site');
  const siteC = await makeWarehouse(admin, sfx, 'SC', 'site');
  await postReceive(admin, siteB.id, item.id, '10', '25');

  await signIn(page, 'admin@acme.test');
  await page.goto('/stock/new/transfer');
  await page.getByLabel('From warehouse').selectOption({ label: label(siteB) });
  await page.getByLabel('To warehouse').selectOption({ label: label(siteC) });
  await chooseItem(page, item.code);
  await page.getByLabel(/^Quantity/).fill('6');
  await page.getByRole('button', { name: 'Post stock transfer' }).click();
  await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  // One view, every location: filter by the item, no warehouse chosen.
  await page.goto('/stock');
  await page.getByPlaceholder('Search items').fill(item.code);
  const rowB = page.getByRole('row').filter({ hasText: siteB.name });
  const rowC = page.getByRole('row').filter({ hasText: siteC.name });
  await expect(rowB).toContainText('4');
  await expect(rowC).toContainText('6');
});
