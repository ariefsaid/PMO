// @e2e-isolation: self-isolated - creates its own uniquely-named item and site warehouse with a per-run suffix (the ledger is append-only); the request it raises is its own.
/** AC-STK-035 — goal: an Engineer who sees a low item in Stock can ask for it from there, and cancelling lands back on Stock. */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { makeItem, makeWarehouse, postReceive, runSuffix, userClient } from './support/stockFixture';

test.setTimeout(120_000);

async function lowItem() {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const item = await makeItem(admin, sfx, 'L');
  const site = await makeWarehouse(admin, sfx, 'LOW', 'site');
  await postReceive(admin, site.id, item.id, '5', '25');
  const set = await admin.rpc('set_stock_reorder_level', { p_warehouse_id: site.id, p_item_id: item.id, p_level: 20, p_quantity: null });
  if (set.error) throw new Error(set.error.message);
  return item;
}

async function openRequest(page: import('@playwright/test').Page, code: string) {
  await signIn(page, 'engineer@acme.test');
  await page.goto('/stock');
  await page.getByRole('checkbox', { name: /below reorder level/i }).click();
  await page.getByRole('button', { name: `Request purchase for ${code}` }).click();
  await expect(page).toHaveURL(/\/procurement\/new\?/);
}

test('AC-STK-035: an Engineer requests a purchase for a low item from Stock and it reaches its approver naming item and quantity', async ({ page }) => {
  const item = await lowItem();
  await openRequest(page, item.code);
  await expect(page.getByLabel(/^title/i)).toHaveValue(new RegExp(item.code));
  await expect(page.getByRole('button', { name: /^back to stock$/i })).toBeVisible();
  // The price is not known to an Engineer: it stays empty for them to estimate (never 0).
  const price = page.getByLabel('New item unit price');
  await expect(price).toHaveValue('');
  await price.fill('30');
  await price.press('Enter');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/\/procurement\/[0-9a-f-]{36}/, { timeout: 20_000 });
  // The record opens on Timeline: check the record itself, on its Line items tab.
  await expect(page.getByRole('heading', { level: 1 })).toContainText(item.code);
  await page.getByRole('tab', { name: /^line items/i }).click();
  const lines = page.getByTestId('procurement-tabpanel-items');
  await expect(lines.getByText(item.name).first()).toBeVisible();
  await expect(lines.getByText('15').first()).toBeVisible();
});

test('AC-STK-035: cancelling the request returns to Stock', async ({ page }) => {
  const item = await lowItem();
  await openRequest(page, item.code);
  await page.getByRole('button', { name: /^cancel$/i }).click();
  await expect(page).toHaveURL(/\/stock/, { timeout: 10_000 });
});
