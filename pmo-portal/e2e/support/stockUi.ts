import { tableCell } from './tableCell';
import { expect, type Page } from '@playwright/test';

export const whLabel = (w: { code: string; name: string }) => `${w.code} - ${w.name}`;

export async function chooseItem(page: Page, code: string) {
  await page.getByRole('combobox', { name: /^Item/ }).click();
  await page.getByRole('combobox', { name: /^(search|cari) /i }).fill(code);
  await page.getByRole('option', { name: new RegExp(code) }).click();
}

export async function postTransfer(page: Page, from: { code: string; name: string }, to: { code: string; name: string }, itemCode: string, qty: string) {
  await page.goto('/stock/new/transfer');
  await page.getByLabel('From warehouse').selectOption({ label: whLabel(from) });
  await page.getByLabel('To warehouse').selectOption({ label: whLabel(to) });
  await chooseItem(page, itemCode);
  await page.getByLabel(/^Quantity/).fill(qty);
  await page.getByRole('button', { name: 'Post stock transfer' }).click();
  await page.getByRole('dialog', { name: 'Post this stock transfer?' }).getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });
}

/** The on-hand figure of one item in one warehouse, read from the stock page's own cell. */
export async function expectOnHand(page: Page, wh: { code: string; name: string }, itemCode: string, qty: string) {
  await page.goto('/stock');
  await page.getByRole('combobox', { name: 'Warehouse', exact: true }).selectOption({ label: whLabel(wh) });
  await expect(page.getByRole('row', { name: new RegExp(itemCode) }).first()).toBeVisible({ timeout: 20_000 });
  // The On hand column (the stock page also shows Free and Reserved while reservations are on).
  await expect(await tableCell(page, itemCode, 'On hand', page.getByRole('table', { name: 'Stock', exact: true }))).toHaveText(new RegExp(`^${qty}\\s+\\S+$`), { timeout: 20_000 });
}
