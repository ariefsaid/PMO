// @e2e-isolation: self-isolated — creates its own disposable HR officer login and uniquely-coded people per run, and deletes all owned rows in finally.
/**
 * JOB-H1 — HR officer imports people from a spreadsheet.
 * The HR officer uploads an .xlsx workbook with 3 new valid people, 1 invalid row (blank name), and 1 existing
 * unchanged person; previews the valid/invalid/unchanged split; confirms the import of 3; and verifies the
 * register shows the 3 new people plus the unchanged existing person while excluding the invalid row.
 */
import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { ORG_ID, ok, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(180_000);

async function makeWorkbook(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('People');
  ws.addRow(['Employee code', 'Display name', 'Job title']);
  for (const row of rows) ws.addRow(row);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

test('JOB-H1 HR officer imports new people from a spreadsheet while skipping invalid and unchanged rows', async ({ page }) => {
  const svc = serviceClient('JOB-H1');
  const run = runId('h1');
  const hrOfficer = await roleJobUser(svc, 'hr_officer', runId('h1-hro'));
  const codes = {
    existing: `${run}-EX`,
    first: `${run}-1`,
    second: `${run}-2`,
    third: `${run}-3`,
    invalid: `${run}-BAD`,
  };
  try {
    ok('existing person', await svc.from('people').insert({
      org_id: ORG_ID, code: codes.existing, name: `${run} Existing`, job_title: 'Rigger',
    }));

    const file = await makeWorkbook([
      [codes.first, `${run} Worker One`, 'Welder'],
      [codes.second, `${run} Worker Two`, 'Fitter'],
      [codes.third, `${run} Worker Three`, 'Helper'],
      [codes.invalid, '', 'Helper'],
      [codes.existing, `${run} Existing`, 'Rigger'],
    ]);

    // 1. HR officer opens People and uploads the mixed workbook.
    await hrOfficer.signIn(page);
    await page.goto('/administration/people');
    await page.getByRole('button', { name: 'Import people' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/choose an \.xlsx file/i).setInputFiles({
      name: 'people-import.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: file,
    });
    await dialog.getByRole('button', { name: 'Next' }).click();

    // 2. Preview shows new, unchanged and invalid rows clearly, offers the rows not imported as a file, and adds only the 3 valid new rows.
    await expect(dialog.getByText('New').first()).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText('No change').first()).toBeVisible();
    await expect(dialog.getByText('1 invalid')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Download rows not imported' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Add 3' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Add 3' }).click();

    await expect(dialog.getByTestId('import-result-summary')).toContainText('3 created', { timeout: 20_000 });
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();

    // 3. Goal: the 3 new people and the existing unchanged person are in the register; the invalid row was not created.
    for (const label of [`${run} Worker One`, `${run} Worker Two`, `${run} Worker Three`, `${run} Existing`]) {
      await expect(page.getByRole('row', { name: new RegExp(label) })).toBeVisible({ timeout: 15_000 });
    }
    await expect(page.getByRole('row', { name: new RegExp(codes.invalid) })).toHaveCount(0);
  } finally {
    ok('people cleanup', await svc.from('people').delete().eq('org_id', ORG_ID).like('code', `${run}-%`));
    await hrOfficer.cleanup();
  }
});
