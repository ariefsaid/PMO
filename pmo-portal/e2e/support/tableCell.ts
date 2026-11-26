import { expect, type Locator, type Page } from '@playwright/test';

/** The cell a person reads under `column` in the first row of `table` that mentions `row`. Waits for the column to
 *  render (a table can be replaced by its loading state while it refetches). */
export async function tableCell(page: Page, row: string, column: string, table: Locator = page.getByRole('table').first()): Promise<Locator> {
  let index = -1;
  await expect(async () => {
    const headers = (await table.getByRole('columnheader').allInnerTexts()).map((h) => h.trim());
    index = headers.indexOf(column);
    expect(index, `no column "${column}" in ${headers.join(' | ')}`).toBeGreaterThanOrEqual(0);
  }).toPass({ timeout: 20_000 });
  return table.getByRole('row').filter({ hasText: row }).first().locator('th, td').nth(index);
}
