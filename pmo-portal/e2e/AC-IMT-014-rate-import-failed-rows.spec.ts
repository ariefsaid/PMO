// @e2e-isolation: self-isolated — adds one uniquely named location and uniquely coded catalogue items to the seeded delivery project and deletes them afterwards; reads the seeded Admin only.
/**
 * AC-IMT-014 — the unit-rate template, filled and imported through the real screen (#2530).
 * Goal oracle: a bad row is not imported and comes back in a downloadable file with its reason; fixing it in that file and
 * importing it again adds the rate to the catalogue.
 */
import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { signIn } from './helpers';
import { ORG_ID, serviceClient } from './support/jobJourney';
import { SEED_PROJECT_ID } from './support/stockFixture';

test.setTimeout(180_000);
const db = serviceClient('AC-IMT-014');
const run = `IMT14-${Date.now().toString(36)}`;
const variant = `Loc ${run}`;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test.afterEach(async () => {
  const projects = await db.from('projects').select('id').eq('org_id', ORG_ID);
  const ids = (projects.data ?? []).map((p) => p.id as string);
  const items = await db.from('rate_catalogue_items').select('id').in('project_id', ids).like('item_code', `${run}%`);
  const itemIds = (items.data ?? []).map((i) => i.id as string);
  if (itemIds.length) {
    await db.from('rate_catalogue_stage_weights').delete().in('item_id', itemIds);
    await db.from('rate_catalogue_rates').delete().in('item_id', itemIds);
    await db.from('rate_catalogue_items').delete().in('id', itemIds);
  }
  await db.from('rate_catalogue_variants').delete().eq('name', variant);
});

const sheetOf = async (path: string) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  return ws.getSheetValues().slice(1).map((r) => (r as unknown[]).slice(1).map((c) => (c == null ? '' : String(c))));
};
const fileOf = async (rows: string[][]) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Rates');
  rows.forEach((r) => ws.addRow(r));
  return { name: 'rates.xlsx', mimeType: XLSX, buffer: Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer) };
};

test('AC-IMT-014 a rate file with one bad row imports the good row, returns the bad one with its reason, and imports once fixed', async ({ page }) => {
  // The seeded delivery project: seed rows share one created_at, so "the oldest project" could be a pipeline deal with no billing.
  await signIn(page, 'admin@acme.test');
  await page.goto(`/projects/${SEED_PROJECT_ID}/billing`);
  await page.getByRole('button', { name: /^rate catalogue$/i }).click();
  const drawer = page.getByRole('dialog', { name: /rate catalogue/i });
  await drawer.getByLabel(/new location/i).fill(variant);
  await drawer.getByRole('button', { name: /add location/i }).click();
  await expect(drawer.getByRole('button', { name: /^import$/i })).toBeEnabled({ timeout: 20_000 });
  await drawer.getByRole('button', { name: /^import$/i }).click();
  const wizard = page.getByRole('dialog').last();

  const templateDownload = page.waitForEvent('download');
  await wizard.getByRole('button', { name: /download template/i }).click();
  const templatePath = await (await templateDownload).path();
  const template = await sheetOf(templatePath);
  expect(template[0]).toEqual(expect.arrayContaining(['Item code', 'Effective from', variant]));

  const header = template[0];
  const row = (code: string, date: string) => header.map((h) => ({ 'Item code': code, Description: `Imported ${code}`, Unit: 'm', 'Effective from': date, [variant]: '120' } as Record<string, string>)[h] ?? '');
  await wizard.getByLabel(/choose an \.xlsx file/i).setInputFiles(await fileOf([header, row(`${run}-A`, '2026-01-01'), row(`${run}-B`, 'not a date')]));
  // Under ADR-0027, an uploaded sheet matching the downloaded template opens preview directly; any other sheet requires mapping -> Next
  const nextBtn = wizard.getByRole('button', { name: /^next$/i });
  const summary = wizard.getByTestId('import-summary');
  await expect(nextBtn.or(summary)).toBeVisible({ timeout: 20_000 });
  if (await nextBtn.isVisible()) {
    await expect(nextBtn).toBeEnabled();
    await nextBtn.click();
  }
  await expect(summary).toContainText('1 valid', { timeout: 20_000 });
  await expect(summary).toContainText('1 invalid');
  await wizard.getByRole('button', { name: /import 1 /i }).click();
  await expect(wizard.getByTestId('import-result-summary')).toContainText('1 created', { timeout: 30_000 });

  const failedDownload = page.waitForEvent('download');
  await wizard.getByRole('button', { name: /download rows not imported/i }).click();
  const failed = await sheetOf(await (await failedDownload).path());
  expect(failed).toHaveLength(2);
  expect(failed[0]).toEqual(expect.arrayContaining(['Item code', 'Row in your file', 'Why not imported']));
  const codeAt = failed[0].indexOf('Item code');
  expect(failed[1][codeAt]).toBe(`${run}-B`);
  expect(failed[1][failed[0].indexOf('Why not imported')]).toMatch(/date/i);
  await wizard.getByRole('button', { name: /^done$/i }).click();

  // fix the date in the returned file and import it again: the two added columns are ignored
  const dateAt = failed[0].indexOf('Effective from');
  failed[1][dateAt] = '2026-01-01';
  await drawer.getByRole('button', { name: /^import$/i }).click();
  const again = page.getByRole('dialog').last();
  await again.getByLabel(/choose an \.xlsx file/i).setInputFiles(await fileOf(failed));
  const againNextBtn = again.getByRole('button', { name: /^next$/i });
  const againSummary = again.getByTestId('import-summary');
  await expect(againNextBtn.or(againSummary)).toBeVisible({ timeout: 20_000 });
  if (await againNextBtn.isVisible()) {
    await expect(againNextBtn).toBeEnabled();
    await againNextBtn.click();
  }
  await expect(againSummary).toContainText('1 valid', { timeout: 20_000 });
  await again.getByRole('button', { name: /import 1 /i }).click();
  await expect(again.getByTestId('import-result-summary')).toContainText('1 created', { timeout: 30_000 });
  await again.getByRole('button', { name: /^done$/i }).click();

  const saved = await db.from('rate_catalogue_items').select('item_code').like('item_code', `${run}%`);
  expect((saved.data ?? []).map((i) => i.item_code).sort()).toEqual([`${run}-A`, `${run}-B`]);
});
