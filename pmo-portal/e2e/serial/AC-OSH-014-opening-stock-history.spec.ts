// @e2e-isolation: serial - an opening load sets the organisation's one go-live date and cannot be undone once stock moves; the append-only ledger cannot be cleaned, so every code carries a per-run suffix.
import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { signIn } from '../helpers';
import { inDays } from '../support/jobJourney';
import { makeWarehouse, runSuffix, userClient } from '../support/stockFixture';
import { onHandCell } from '../support/stockUi';

test.setTimeout(120_000);

const isoDay = (back: number) => inDays(-back); // opening history is dated by the organisation's calendar

async function sheet(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Template');
  ws.addRow(['Date', 'Location', 'Item', 'Direction', 'Quantity', 'Unit cost', 'Reference']);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('AC-OSH-014: an Admin previews a movement file, sees the refused row blocked, fixes it, confirms, and the on-hand balance equals the sum of the movements', async ({ page }) => {
  // Given: an empty location, a bought item, and a client-supplied item (zero-cost tag) created for this run
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const wh = await makeWarehouse(admin, sfx, 'OPN', 'central');
  const unit = (await admin.from('stock_units').select('id').limit(1).single()).data;
  const tag = (await admin.from('stock_tags').insert({ name: `Client supplied ${sfx}`, zero_cost: true }).select('id').single()).data;
  const bought = (await admin.from('stock_items').insert({ code: `E2E-B${sfx}`, name: `Bought ${sfx}`, unit_id: unit?.id }).select('code').single()).data;
  const supplied = (await admin.from('stock_items').insert({ code: `E2E-C${sfx}`, name: `Supplied ${sfx}`, unit_id: unit?.id, tag_id: tag?.id }).select('code').single()).data;
  if (!bought || !supplied) throw new Error('fixture items were not created');

  // When: the Admin opens Opening stock from Stock set-up and sees the template columns
  await signIn(page, 'admin@acme.test');
  await page.goto('/stock/setup');
  await page.getByRole('link', { name: 'Opening stock' }).click();
  await expect(page).toHaveURL(/\/stock\/opening$/);
  for (const column of ['Date', 'Location', 'Item', 'Direction', 'Quantity', 'Unit cost', 'Reference']) await expect(page.getByText(column, { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('opening-confirm')).toBeDisabled();

  // And: a file whose out row is larger than what came in is previewed
  await page.getByLabel(/Go-live date/).fill(isoDay(1));
  await page.getByLabel(/Go-live date/).press('Enter');
  const bad = await sheet([
    [isoDay(30), wh.code, bought.code, 'in', '10', '5', 'DN-1'],
    [isoDay(20), wh.code, bought.code, 'out', '99', '', ''],
  ]);
  await page.getByTestId('opening-file').setInputFiles({ name: 'opening.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bad });
  await expect(page.getByText(/This out row is larger than what is on hand/).first()).toBeVisible();
  await expect(page.getByTestId('opening-confirm'), 'a refused row blocks the confirm').toBeDisabled();

  // Then: the corrected file confirms, client-supplied stock stays at zero cost
  const good = await sheet([
    [isoDay(30), wh.code, bought.code, 'in', '10', '5', 'DN-1'],
    [isoDay(20), wh.code, bought.code, 'out', '4', '', ''],
    [isoDay(30), wh.code, supplied.code, 'in', '10', '', 'DN-2'],
    [isoDay(20), wh.code, supplied.code, 'out', '4', '', ''],
  ]);
  await page.getByTestId('opening-file').setInputFiles({ name: 'opening.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: good });
  await expect(page.getByText('Client-supplied').first()).toBeVisible();
  await expect(page.getByTestId('opening-confirm')).toBeEnabled();
  await page.getByTestId('opening-confirm').click();
  await expect(page.getByText('Opening stock loaded')).toBeVisible({ timeout: 20_000 });

  // And: the location holds 6 of the bought item and 6 of the client-supplied one, each the sum of its movements
  await page.goto('/stock');
  await page.getByRole('combobox', { name: 'Warehouse', exact: true }).selectOption({ label: `${wh.code} - ${wh.name}` });
  await expect(await onHandCell(page, bought.code)).toHaveText(/^6\s+\S+$/);
  await expect(await onHandCell(page, supplied.code)).toHaveText(/^6\s+\S+$/);
});
