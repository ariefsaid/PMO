// @e2e-isolation: self-isolated — the item code carries a per-run suffix and nothing else is changed.
/** JOB-1122-10 — an item is saved from the Stock setup form as a consumable, and the flag is stored with it. */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { runSuffix, userClient } from './support/stockFixture';

test.setTimeout(90_000);

test('JOB-1122-10 saving a new item as a consumable stores the flag', async ({ page }) => {
  const sfx = runSuffix();
  const code = `ROD-${sfx}`;
  await signIn(page, 'admin@acme.test');
  await page.goto('/stock/setup');
  await page.getByRole('tab', { name: 'Items' }).click();
  await page.getByRole('button', { name: 'New item' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Code/).fill(code);
  await dialog.getByLabel(/^Name/).fill(`Welding rod ${sfx}`);
  await dialog.getByRole('combobox', { name: 'Unit' }).selectOption({ index: 1 });
  await dialog.getByRole('checkbox', { name: /Consumable/ }).check();
  await dialog.getByRole('button', { name: 'Create item' }).click();
  await expect(page.getByText(code).first()).toBeVisible({ timeout: 20_000 });

  const admin = await userClient('admin@acme.test');
  const { data, error } = await admin.from('stock_items').select('consumable').eq('code', code).single();
  expect(error).toBeNull();
  expect((data as { consumable: boolean }).consumable).toBe(true);
});
