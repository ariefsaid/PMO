import { expect, type Locator, type Page } from '@playwright/test';

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
  await expect(await onHandCell(page, itemCode)).toHaveText(new RegExp(`^${qty}\\s+\\S+$`), { timeout: 20_000 });
}

/**
 * The On hand cell of an item's row on the stock page, found by its column header: with reservations on, the Free and
 * Reserved columns beside it can read the very same figure, so a figure alone does not say which column it is in.
 */
export async function onHandCell(page: Page, itemCode: string): Promise<Locator> {
  const table = page.getByRole('table', { name: 'Stock' });
  // A filter change re-renders the table (it is briefly replaced while the filtered list loads), so the header list is
  // read until it holds the column, never once: a one-off read in that gap finds no header at all.
  let index = -1;
  await expect.poll(async () => {
    index = (await table.getByRole('columnheader').allInnerTexts()).map((h) => h.trim()).indexOf('On hand');
    return index;
  }, { timeout: 20_000 }).toBeGreaterThanOrEqual(0);
  return table.getByRole('row', { name: new RegExp(itemCode) }).first().locator('th, td').nth(index);
}
