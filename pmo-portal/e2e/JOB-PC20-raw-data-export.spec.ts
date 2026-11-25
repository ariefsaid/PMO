// @e2e-isolation: self-isolated — its own project and three work orders; deletes them afterwards. The export is re-serialized from rows the reader may already see.
// JOB-PC20 (raw data to Excel): the project control manager exports the work-order list and the file holds one row per work order.
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { cleanupAll, projectWithWorkOrders, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(180_000);

test('JOB-PC20 a project control manager exports the work-order list and the file holds one row per work order', async ({ page }) => {
  const admin = serviceClient('JOB-PC20');
  const run = runId('JOBPC20');
  const pcm = await roleJobUser(admin, 'project_control_manager', `${run}-pcm`);
  let projectId = '';
  let woIds: string[] = [];

  try {
    const fx = await projectWithWorkOrders(admin, run, ['Excavation', 'Formwork', 'Reinforcement']);
    projectId = fx.projectId; woIds = fx.workOrders.map((w) => w.id);

    await pcm.signIn(page);
    await page.goto('/work-orders');
    for (const wo of fx.workOrders) await expect(page.getByText(wo.number)).toBeVisible({ timeout: 30_000 });

    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const download = await downloading;
    const file = await readFile(await download.path());
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(file);
    const sheet = book.worksheets[0];
    const header = (sheet.getRow(1).values as (string | null)[]).map((v) => (v ?? '').toString());
    const column = header.findIndex((h) => /work order/i.test(h));
    expect(column, 'the export has a work-order column').toBeGreaterThan(0);
    const numbers: string[] = [];
    sheet.eachRow((row, index) => { if (index > 1) numbers.push((row.getCell(column).text ?? '').trim()); });
    for (const wo of fx.workOrders) expect(numbers.filter((n) => n === wo.number)).toHaveLength(1);
    expect(new Set(numbers).size).toBe(numbers.length);
  } finally {
    await cleanupAll(admin, [['work_orders', 'id', woIds], ['projects', 'id', projectId ? [projectId] : []]]);
    await pcm.cleanup();
  }
});
