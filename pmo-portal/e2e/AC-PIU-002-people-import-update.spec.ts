// @e2e-isolation: self-isolated — creates its own uniquely-coded people through the register and the import, and deletes them afterwards; never touches a seed person.
import { test, expect, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { signIn } from './helpers';
import { ORG_ID, serviceClient } from './support/jobJourney';

/**
 * AC-PIU-002/003/005/008 — the people team uploads today's export. Existing people are matched by their code and
 * updated, new ones added, and the preview names every change before the confirm. A person absent from the file stays.
 * Goal oracle: after the confirm the register shows the new name and the added person; the person not in the file is
 * unchanged; uploading the same file again shows every row as No change.
 */
test.setTimeout(180_000);
const db = serviceClient('AC-PIU-002');
const run = `PIU${Date.now()}`;
const codes = { changed: `${run}-A`, added: `${run}-B`, absent: `${run}-C` };

test.beforeEach(async () => {
  await db.from('people').insert([
    { org_id: ORG_ID, code: codes.changed, name: `${run} Ana` },
    { org_id: ORG_ID, code: codes.absent, name: `${run} Absent` },
  ]);
});
test.afterEach(async () => { await db.from('people').delete().eq('org_id', ORG_ID).like('code', `${run}-%`); });

async function sheet(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('People');
  ws.addRow(['Employee code', 'Display name', 'Job title']);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
async function upload(page: Page, rows: string[][]) {
  await page.getByRole('button', { name: 'Import people' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/choose an \.xlsx file/i).setInputFiles({ name: 'people.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await sheet(rows) });
  await dialog.getByRole('button', { name: 'Next' }).click();
  return dialog;
}

test('AC-PIU-002 an upload updates the matched person, adds the new one, leaves the absent one, and a repeat changes nothing', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  await page.goto('/administration/people');
  const rows = [[codes.changed, `${run} Ana Putri`, 'Foreman'], [codes.added, `${run} Budi`, '']];

  let dialog = await upload(page, rows);
  await expect(dialog.getByText('Will update')).toBeVisible();
  await expect(dialog.getByText('New')).toBeVisible();
  await expect(dialog.getByText(`Display name: ${run} Ana → ${run} Ana Putri`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Add 1 and update 1' }).click();
  await expect(dialog.getByTestId('import-result-summary')).toContainText('1 created, 1 updated', { timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByRole('row', { name: new RegExp(`${run} Ana Putri`) })).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(`${run} Budi`) })).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(`${run} Absent`) })).toBeVisible();

  dialog = await upload(page, rows);
  await expect(dialog.getByText('No change').first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add 0 and update 0' })).toBeDisabled();
});
