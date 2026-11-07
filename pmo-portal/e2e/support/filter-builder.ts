import type { Page } from '@playwright/test';

/** Projects filter builder (#1983): Add filter, field, condition, then the value the field takes. */
export async function addBuilderFilter(
  page: Page, field: string, opts: { operator?: string; option?: string; text?: string } = {},
) {
  await page.getByRole('button', { name: 'Add filter', exact: true }).click();
  await page.getByRole('option', { name: field, exact: true }).click();
  await page.getByRole('option', { name: opts.operator ?? 'is', exact: true }).click();
  if (opts.option !== undefined) await page.getByRole('option', { name: opts.option, exact: true }).click();
  if (opts.text !== undefined) {
    await page.getByRole('button', { name: 'Value', exact: true }).click();
    await page.getByRole('dialog').getByRole('textbox').fill(opts.text);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
  }
}

export const builderChip = (page: Page, field: string) =>
  page.getByRole('toolbar', { name: 'Active filters' }).getByRole('button', { name: `${field} filter options`, exact: true });
