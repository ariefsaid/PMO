// @e2e-isolation: self-isolated — a disposable organisation, its Administrator login, one project and the imported work orders; the organisation and users are removed in finally.
/**
 * JOB-A3 — a new project's work orders arrive from the import template (FR-WOI-001..005).
 * The Administrator opts the organisation into the setup workflows, opens the project's work orders area, imports a
 * filled template with one work order, and the project shows it.
 * Goal oracle: the imported work order's title appears on the project's work orders area.
 */
import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { createJobRoleUser, removeJobOrganization } from './support/jobRoleUser';
import { need, ok, runId, serviceClient } from './support/jobFixtures';

test.setTimeout(240_000);

const HEAD = ['Title', 'Client reference', 'Start date', 'End date', 'Order value', 'Tax treatment', 'Tax amount', 'Currency'];

async function workbookWith(title: string, reference: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Template');
  ws.addRow(HEAD);
  ws.addRow([title, reference, '', '', '1000', 'exclusive', '', 'USD']);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

test('JOB-A3 an administrator imports a project\'s work orders from the template and the project shows them', async ({ page }) => {
  const svc = serviceClient('JOB-A3');
  const run = runId('a3');
  const org = need('organisation', await svc.from('organizations').insert({
    name: `${run} org`, default_currency: 'USD', built_in_roles_enabled: true,
  }).select('id').single());
  const admin = await createJobRoleUser(svc, org.id, 'administrator');
  let projectId = '';
  try {
    // The Administrator's setting: the setup workflows (import and opening balances) are on for the organisation.
    ok('setup workflows', await svc.from('org_setup_workflow_settings').upsert({ org_id: org.id, enabled: true }));
    projectId = need('project', await svc.from('projects').insert({
      org_id: org.id, name: `${run} project`, status: 'Ongoing Project', currency: 'USD', project_manager_id: admin.id,
    }).select('id').single()).id;

    const title = `${run} Yard pipe rack`;
    const file = await workbookWith(title, `PO-${run}`);

    // 1. Administrator opens the project's work orders area and chooses the import.
    await admin.signIn(page);
    await page.goto(`/projects/${projectId}/contract`);
    await page.getByRole('button', { name: 'Import work orders' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/choose an \.xlsx file/i).setInputFiles({
      name: 'work-orders.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: file,
    });
    // 2. The sheet matches the template's own columns, so it goes straight to the preview: one valid row, one all-or-nothing confirm.
    const confirm = dialog.getByRole('button', { name: 'Import 1 work order' });
    await expect(confirm).toBeEnabled({ timeout: 20_000 });
    await confirm.click();
    await expect(dialog.getByTestId('import-result-summary')).toContainText('1 created', { timeout: 20_000 });
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();

    // 3. Goal: the project shows the imported work order.
    await expect(page.locator('article[data-testid^="customer-order-"]').getByText(title)).toBeVisible({ timeout: 20_000 });
  } finally {
    if (projectId) {
      ok('work order cleanup', await svc.from('work_orders').delete().eq('project_id', projectId));
      ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    }
    await admin.remove();
    removeJobOrganization(org.id);
  }
});
