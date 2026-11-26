// @e2e-isolation: self-isolated — unique item, vendor company and locations per run; the posted stock ledger is append-only, so every code carries a per-run suffix.
/**
 * AC-SVL-012 — a vendor location in Stock setup, material sent out to it and back (#2683).
 * Goal oracle: while the pipe is out, the on-hand screen shows it AT the vendor (named); after the return the vendor holds none and the warehouse is whole again.
 */
import { tableCell } from './support/tableCell';
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { makeItem, makeWarehouse, postReceive, runSuffix, userClient } from './support/stockFixture';
import { expectOnHand, postTransfer, whLabel } from './support/stockUi';

test.setTimeout(180_000);

test('AC-SVL-012 pipe sent to a vendor location shows at the vendor, and comes back', async ({ page }) => {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const item = await makeItem(admin, sfx, 'PIPE');
  const warehouse = await makeWarehouse(admin, sfx, 'WH', 'central');
  const company = await admin.from('companies').insert({ name: `E2E Coater ${sfx}`, type: 'Vendor' }).select('id, name').single();
  expect(company.error).toBeNull();
  await postReceive(admin, warehouse.id, item.id, '20');

  await signIn(page, 'admin@acme.test');
  await page.goto('/stock/setup?tab=warehouses');
  await page.getByRole('button', { name: 'New warehouse' }).first().click();
  await page.getByRole('textbox', { name: /^Code/ }).fill(`E2E-VND${sfx}`);
  await page.getByRole('textbox', { name: /^Name/ }).fill(`E2E coater ${sfx}`);
  await page.getByRole('combobox', { name: /^Kind/ }).selectOption('Vendor');
  await expect(page.getByRole('combobox', { name: /Site project/ })).toHaveCount(0);
  await page.getByRole('combobox', { name: /Vendor company/ }).selectOption({ label: company.data!.name });
  await page.getByRole('button', { name: 'Create warehouse' }).click();
  await expect(page.getByText(`E2E-VND${sfx}`)).toBeVisible({ timeout: 20_000 });
  const vendor = { code: `E2E-VND${sfx}`, name: `E2E coater ${sfx}` };

  await postTransfer(page, warehouse, vendor, item.code, '20');
  await page.goto('/stock');
  await page.getByRole('combobox', { name: 'Warehouse', exact: true }).selectOption({ label: whLabel(vendor) });
  const row = page.getByRole('row', { name: new RegExp(item.code) });
  // The On hand column reads 20 (the page also shows Free while reservations are on).
  await expect(row.first()).toBeVisible({ timeout: 20_000 });
  await expect(await tableCell(page, item.code, 'On hand', page.getByRole('table', { name: 'Stock', exact: true }))).toHaveText(/^20\s+\S+$/);
  await expect(row).toContainText(`At ${company.data!.name}`);

  await postTransfer(page, vendor, warehouse, item.code, '20');
  await expectOnHand(page, warehouse, item.code, '20');
  await page.goto('/stock');
  await page.getByRole('combobox', { name: 'Warehouse', exact: true }).selectOption({ label: whLabel(vendor) });
  await expect(page.getByRole('row', { name: new RegExp(item.code) })).toHaveCount(0);
});
