// @e2e-isolation: self-isolated — unique item and site warehouse per run with its own reorder level; the request is raised as a draft, never saved.
/** JOB-W11 — stock below its minimum is flagged; the material person raises a purchase request from it that carries the item and the suggested quantity. */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { makeItem, makeWarehouse, postReceive, runSuffix, userClient } from './support/stockFixture';

test.setTimeout(120_000);

test('JOB-W11 an item below its minimum becomes a purchase request with the suggested quantity', async ({ page }) => {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const item = await makeItem(admin, sfx, 'R');
  const site = await makeWarehouse(admin, sfx, 'RO', 'site');
  await postReceive(admin, site.id, item.id, '5', '25');
  const set = await admin.rpc('set_stock_reorder_level', { p_warehouse_id: site.id, p_item_id: item.id, p_level: 20, p_quantity: null });
  if (set.error) throw new Error(set.error.message);

  await signIn(page, 'pm@acme.test');
  await page.goto('/stock/reorder');
  await expect(page.getByRole('row').filter({ hasText: item.code })).toBeVisible({ timeout: 20_000 });
  await page.goto('/stock');
  await page.getByRole('checkbox', { name: /below reorder level/i }).click();
  await page.getByRole('button', { name: `Request purchase for ${item.code}` }).click();
  await expect(page).toHaveURL(/\/procurement\/new\?/);
  await expect(page.getByLabel(/^title/i)).toHaveValue(new RegExp(item.code));
  // 20 minimum − 5 on hand = 15 suggested.
  await expect(page.getByTestId('line-items-section').getByText('15').first()).toBeVisible();
});
