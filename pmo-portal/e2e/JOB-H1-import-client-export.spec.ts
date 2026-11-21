// @e2e-isolation: self-isolated — imports uniquely-coded equipment rows from its own workbook and deletes them afterwards; reads the seeded Admin only.
/**
 * JOB-H1 — import the client-system export (#2530). HR fills the equipment import template with five rows, one invalid, and
 * imports it.
 * Goal oracle: four assets are created and the invalid row is reported with its reason, and is not created.
 * Partly built: the people import has a template and rules but no screen entry yet, so only the equipment half of the job
 * ("the same for equipment") is asserted.
 */
import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { signIn } from './helpers';
import { ORG_ID, serviceClient } from './support/jobJourney';

test.setTimeout(180_000);
const db = serviceClient('JOB-H1');
const run = `000-H1-${Date.now().toString(36)}`;

test.afterEach(async () => {
  const assets = await db.from('equipment_assets').select('id').eq('org_id', ORG_ID).like('code', `${run}%`);
  const ids = (assets.data ?? []).map((a) => a.id as string);
  if (ids.length) {
    for (const table of ['equipment_rental_terms', 'equipment_status_days', 'equipment_status_history']) await db.from(table).delete().in('asset_id', ids);
    await db.from('equipment_assets').delete().in('id', ids);
  }
});

test('JOB-H1 a five-row equipment export with one invalid row adds four assets and reports the invalid one', async ({ page }) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Equipment');
  ws.addRow(['Asset code', 'Name', 'Default unit', 'Ownership']);
  for (let i = 1; i <= 4; i++) ws.addRow([`${run}-${i}`, `Imported unit ${i}`, 'hours', 'owned']);
  ws.addRow([`${run}-5`, 'Imported unit 5', 'hours', 'leased']);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);

  await signIn(page, 'admin@acme.test');
  await page.goto('/equipment/assets');
  await page.getByRole('button', { name: /^import$/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/choose an \.xlsx file/i).setInputFiles({ name: 'equipment.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
  await dialog.getByRole('button', { name: /^next$/i }).click();
  const summary = dialog.getByTestId('import-summary');
  await expect(summary).toContainText('4 valid', { timeout: 20_000 });
  await expect(summary).toContainText('1 invalid');
  await expect(dialog.getByText('Ownership must be owned or rented.').first()).toBeVisible();
  await dialog.getByRole('button', { name: /import 4 /i }).click();
  await expect(dialog.getByTestId('import-result-summary')).toContainText('4 created', { timeout: 30_000 });
  await dialog.getByRole('button', { name: /^done$/i }).click();

  const created = await db.from('equipment_assets').select('code').eq('org_id', ORG_ID).like('code', `${run}%`);
  expect((created.data ?? []).map((a) => a.code).sort()).toEqual([1, 2, 3, 4].map((i) => `${run}-${i}`));
});
