// @e2e-isolation: self-isolated — creates its own disposable storekeeper login, project, work order, site warehouse, crew and roster per run, and deletes all owned rows in finally.
/**
 * JOB-W14 — storekeeper registers a crew's standard hand-tool kit.
 * For a crew rostered today on a work order whose site store the storekeeper keeps, the storekeeper opens
 * Crews -> Tools, adds a kit line with code and held quantity, and verifies the held and usable counts persist.
 */
import { test, expect } from '@playwright/test';
import { ORG_ID, PM_ID, need, ok, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { orgToday } from './support/jobJourney';
import { roleJobUser } from './support/roleJobUser';
import { keeperOf, makeWarehouse, runSuffix, userClient } from './support/stockFixture';

test.setTimeout(180_000);

test('JOB-W14 storekeeper registers a crew hand-tool kit line and sees its held and usable counts', async ({ page }) => {
  const svc = serviceClient('JOB-W14');
  const admin = await userClient('admin@acme.test');
  const run = runId('w14');
  const sfx = runSuffix();
  const storekeeper = await roleJobUser(svc, 'storekeeper', runId('w14-sk'));
  let projectId = '';
  let workOrderId = '';
  let warehouseId = '';
  let crewId = '';
  try {
    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD', project_manager_id: PM_ID,
    }).select('id').single()).id;
    const site = await makeWarehouse(admin, sfx, 'KIT', 'site', projectId);
    warehouseId = site.id;
    await keeperOf(admin, site.id, storekeeper.id);

    workOrderId = need('work order', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} site work`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
      currency: 'USD', site_warehouse_id: site.id,
    }).select('id').single()).id;
    crewId = need('crew', await svc.from('crews').insert({
      org_id: ORG_ID, code: `K-${sfx.slice(-10)}`, name: `${run} crew`, kind: 'own',
    }).select('id').single()).id;
    ok('roster', await svc.from('work_order_crews').insert({
      org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewId, valid_from: orgToday(),
    }));

    // 1. Storekeeper opens Crews -> Tools and picks the crew working at their site store today.
    await storekeeper.signIn(page);
    await page.goto('/crews?view=tools');
    await page.getByRole('combobox', { name: 'Crew' }).selectOption(crewId);

    // 2. Storekeeper adds a standard tool kit line.
    const toolName = `${run} torque wrench`;
    const toolCode = `KIT-${sfx.slice(-4)}`;
    await page.getByRole('button', { name: 'Add tool' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add a tool' });
    await dialog.getByLabel(/^Tool/).fill(toolName);
    await dialog.getByLabel(/^Code/).fill(toolCode);
    await dialog.getByLabel(/^Held/).fill('2');
    await dialog.getByRole('button', { name: 'Add tool', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // 3. Goal: the crew's tools table lists the tool with held 2 and usable 2, and it survives reload.
    const row = page.getByRole('row', { name: new RegExp(toolName) });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText(toolCode);
    const cells = row.getByRole('cell');
    await expect(cells.nth(0)).toHaveText('2');
    await expect(cells.nth(3)).toHaveText('2');

    await page.reload();
    await page.getByRole('combobox', { name: 'Crew' }).selectOption(crewId);
    await expect(page.getByRole('row', { name: new RegExp(toolName) })).toBeVisible({ timeout: 20_000 });
  } finally {
    if (crewId) {
      sqlAsOwner(`delete from crew_tool_lines where crew_id = '${crewId}'; delete from work_order_crews where crew_id = '${crewId}'; delete from crews where id = '${crewId}';`);
    }
    if (workOrderId) ok('work order cleanup', await svc.from('work_orders').delete().eq('id', workOrderId));
    if (warehouseId) {
      sqlAsOwner(`delete from stock_warehouse_keepers where warehouse_id = '${warehouseId}';`);
      ok('warehouse cleanup', await svc.from('stock_warehouses').delete().eq('id', warehouseId));
    }
    if (projectId) ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    await storekeeper.cleanup();
  }
});
