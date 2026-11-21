// @e2e-isolation: self-isolated — creates its own project, adds one uniquely named location and uniquely coded catalogue items, then deletes them; reads the seeded Admin only.
/**
 * AC-IMT-014 — the unit-rate template, filled and imported through the real screen (#2530).
 * Goal oracle: a bad row is not imported and comes back in a downloadable file with its reason; fixing it in that file and
 * importing it again adds the rate to the catalogue.
 */
import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { signIn } from './helpers';
import { ORG_ID, serviceClient } from './support/jobJourney';

test.setTimeout(180_000);
const db = serviceClient('AC-IMT-014');
const run = `IMT14-${Date.now().toString(36)}`;
const variant = `Loc ${run}`;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
let projectId = '';

test.afterEach(async () => {
  if (!projectId) return;
  const items = await db.from('rate_catalogue_items').select('id').eq('project_id', projectId).like('item_code', `${run}%`);
  const itemIds = (items.data ?? []).map((i) => i.id as string);
  if (itemIds.length) {
    await db.from('rate_catalogue_stage_weights').delete().in('item_id', itemIds);
    await db.from('rate_catalogue_rates').delete().in('item_id', itemIds);
    await db.from('rate_catalogue_items').delete().in('id', itemIds);
  }
  await db.from('rate_catalogue_variants').delete().eq('project_id', projectId);
  await db.from('projects').delete().eq('id', projectId);
  projectId = '';
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
  const project = await db.from('projects').insert({
    org_id: ORG_ID,
    name: `AC-IMT-014 ${run}`,
    status: 'Ongoing Project',
    currency: 'USD',
  }).select('id').single();
  expect(project.error).toBeNull();
  expect(project.data?.id).toBeTruthy();
  projectId = project.data!.id;
  await signIn(page, 'admin@acme.test');
  await page.goto(`/projects/${projectId}/billing`);
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
  await wizard.getByRole('button', { name: /^next$/i }).click();
  const summary = wizard.getByTestId('import-summary');
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
  await again.getByRole('button', { name: /^next$/i }).click();
  await expect(again.getByTestId('import-summary')).toContainText('1 valid', { timeout: 20_000 });
  await again.getByRole('button', { name: /import 1 /i }).click();
  await expect(again.getByTestId('import-result-summary')).toContainText('1 created', { timeout: 30_000 });
  await again.getByRole('button', { name: /^done$/i }).click();

  const saved = await db.from('rate_catalogue_items').select('item_code').like('item_code', `${run}%`);
  expect((saved.data ?? []).map((i) => i.item_code).sort()).toEqual([`${run}-A`, `${run}-B`]);
});
