// @e2e-isolation: self-isolated — creates its own disposable storekeeper login, project, work order, site warehouse, crew and hand-tool line without changing organisation-wide tool settings, and deletes all owned rows in finally.
/**
 * JOB-F22 — storekeeper reports a damaged crew hand tool with a mandatory photo.
 * For a crew rostered today at a site store the storekeeper keeps, the storekeeper opens Crews -> Tools,
 * sees Send report disabled until a photo is attached, submits a damage report with a photo, sees usable
 * drop from 2 to 1 and damaged rise to 1, opens the attached photo link on the open report, and verifies
 * the updated counts and open report persist across reload.
 */
import { test, expect } from '@playwright/test';
import { visibleToast } from './helpers';
import { ORG_ID, PM_ID, need, ok, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { orgToday } from './support/jobJourney';
import { roleJobUser } from './support/roleJobUser';
import { keeperOf, makeWarehouse, runSuffix, userClient } from './support/stockFixture';

test.setTimeout(180_000);

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('JOB-F22 storekeeper reports a damaged hand tool with a photo and usable count drops with the open report preserved', async ({ page }) => {
  const svc = serviceClient('JOB-F22');
  const admin = await userClient('admin@acme.test');
  const run = runId('f22');
  const sfx = runSuffix();
  const skRun = runId('f22-sk');
  const storekeeper = await roleJobUser(svc, 'storekeeper', skRun);
  const toolName = `${run} grinder`;
  let projectId = '';
  let workOrderId = '';
  let warehouseId = '';
  let crewId = '';
  try {
    const site = await makeWarehouse(admin, sfx, 'F22', 'site');
    warehouseId = site.id;
    await keeperOf(admin, site.id, storekeeper.id);

    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD', project_manager_id: PM_ID,
    }).select('id').single()).id;
    workOrderId = need('work order', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} site work`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
      currency: 'USD', site_warehouse_id: site.id,
    }).select('id').single()).id;
    crewId = need('crew', await svc.from('crews').insert({
      org_id: ORG_ID, code: `F22-${sfx.slice(-8)}`, name: `${run} crew`, kind: 'own',
    }).select('id').single()).id;
    ok('roster', await svc.from('work_order_crews').insert({
      org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewId, valid_from: orgToday(),
    }));
    ok('tool line', await svc.from('crew_tool_lines').insert({
      org_id: ORG_ID, crew_id: crewId, name: toolName, held_qty: 2,
    }));

    // 1. Storekeeper opens Crews -> Tools and starts a damage report.
    await storekeeper.signIn(page);
    await page.goto('/crews?view=tools');
    await page.getByRole('combobox', { name: 'Crew' }).selectOption(crewId);
    const toolRow = page.getByRole('row', { name: new RegExp(toolName) });
    await expect(toolRow).toBeVisible({ timeout: 20_000 });
    await expect(toolRow.getByRole('cell').nth(3)).toHaveText('2');

    await toolRow.getByRole('button', { name: 'Report a problem' }).click();
    const sheet = page.getByRole('dialog');
    // Damaged requires a photo before Send report enables.
    await expect(sheet.getByRole('button', { name: 'Send report' })).toBeDisabled();
    await sheet.getByLabel('Photo (required)').setInputFiles({
      name: 'damaged-tool.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(sheet.getByRole('button', { name: 'Send report' })).toBeEnabled();
    await sheet.getByRole('button', { name: 'Send report' }).click();
    await expect(visibleToast(page, 'Reported. The equipment coordinator has a task.')).toBeVisible({ timeout: 20_000 });

    // 2. Goal: usable falls to 1, damaged rises to 1, open report shows reporter + photo link, and persists on reload.
    await expect(toolRow.getByRole('cell').nth(1)).toHaveText('1', { timeout: 15_000 });
    await expect(toolRow.getByRole('cell').nth(3)).toHaveText('1');
    const reportRow = page.getByRole('row', { name: new RegExp(`${toolName} x1`) });
    await expect(reportRow).toBeVisible({ timeout: 15_000 });
    await expect(reportRow).toContainText('Damaged');
    await expect(reportRow).toContainText(skRun);
    await reportRow.getByRole('button', { name: 'Photos', exact: true }).click();
    await expect(reportRow.getByRole('link')).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await page.getByRole('combobox', { name: 'Crew' }).selectOption(crewId);
    const reloadedTool = page.getByRole('row', { name: new RegExp(toolName) });
    await expect(reloadedTool.getByRole('cell').nth(1)).toHaveText('1', { timeout: 20_000 });
    await expect(reloadedTool.getByRole('cell').nth(3)).toHaveText('1');
    await expect(page.getByRole('row', { name: new RegExp(`${toolName} x1`) })).toBeVisible();
  } finally {
    sqlAsOwner(`
      delete from notifications where title ilike '%${toolName}%';
      delete from tasks where name ilike '%${toolName}%';
    `);
    if (crewId) {
      sqlAsOwner(`
        delete from crew_tool_report_files where report_id in (select id from crew_tool_reports where line_id in (select id from crew_tool_lines where crew_id = '${crewId}'));
        delete from crew_tool_reports where line_id in (select id from crew_tool_lines where crew_id = '${crewId}');
        delete from crew_tool_lines where crew_id = '${crewId}';
        delete from work_order_crews where crew_id = '${crewId}';
        delete from crews where id = '${crewId}';
      `);
    }
    if (workOrderId) ok('work order cleanup', await svc.from('work_orders').delete().eq('id', workOrderId));
    if (projectId) ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    if (warehouseId) {
      sqlAsOwner(`delete from stock_warehouse_keepers where warehouse_id = '${warehouseId}';`);
      ok('warehouse cleanup', await svc.from('stock_warehouses').delete().eq('id', warehouseId));
    }
    await storekeeper.cleanup();
  }
});
