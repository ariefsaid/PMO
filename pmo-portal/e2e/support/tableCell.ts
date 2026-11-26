import type { Locator, Page } from '@playwright/test';

/** The cell a person reads under `column` in the first row of `table` that mentions `row`. */
export async function tableCell(page: Page, row: string, column: string, table: Locator = page.getByRole('table').first()): Promise<Locator> {
  const headers = (await table.getByRole('columnheader').allInnerTexts()).map((h) => h.trim());
  const index = headers.indexOf(column);
  if (index < 0) throw new Error(`no column "${column}" in ${headers.join(' | ')}`);
  return table.getByRole('row').filter({ hasText: row }).first().locator('th, td').nth(index);
}
