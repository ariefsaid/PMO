import { expect, type Page } from '@playwright/test';

export const label = (w: { code: string; name: string }) => `${w.code} - ${w.name}`;

export async function chooseItem(page: Page, code: string) {
  await page.getByRole('combobox', { name: /^Item/ }).click();
  await page.getByRole('combobox', { name: /^(search|cari) /i }).fill(code);
  await page.getByRole('option', { name: new RegExp(code) }).click();
}

export async function chooseWorkOrder(page: Page, number: string) {
  const picker = page.getByRole('combobox', { name: 'Work order' });
  await expect(picker).toBeEnabled();
  await picker.click();
  await page.getByRole('combobox', { name: /search work orders/i }).fill(number);
  await page.getByRole('option', { name: new RegExp(number) }).click();
}

export async function confirmPost(page: Page) {
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByText('Posted', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
}
