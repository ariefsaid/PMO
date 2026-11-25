// @e2e-isolation: self-isolated — owns its project-administrator login, project, work order, equipment asset, stock item, warehouse
// (where an Admin names the same person keeper) and timesheet week; the stock chain is removed through the owner connection because
// the ledger is append-only by design, and every row this run created carries its unique suffix.
// JOB-PC1 (project control): everything coded to its work order. The project administrator logs a timesheet line, an equipment use
// and a stock issue, each naming the work order, and the work order's actual cost shows all three.
import { test, expect } from '@playwright/test';
import { pickComboboxOption } from './helpers';
import { need, ok, ORG_ID, projectWithWorkOrders, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { keeperOf, makeItem, makeWarehouse, postReceive, runSuffix, userClient } from './support/stockFixture';

test.setTimeout(180_000);

const pad = (n: number) => String(n).padStart(2, '0');
// e2e-org-day: allow — the equipment grid is asked for the browser's (UTC-pinned) week; day and weekday stay a self-consistent pair.
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

test('JOB-PC1 a project administrator logs a timesheet line, an equipment use and a stock issue against one work order, and all three reach its actual cost', async ({ page }) => {
  const svc = serviceClient('JOB-PC1');
  const run = runId('JOBPC1');
  const sfx = runSuffix().toLowerCase();
  const admin = await userClient('admin@acme.test');
  const pa = await roleJobUser(svc, 'project_administrator', `${run}-pa`);

  let projectId = '';
  let woId = '';
  let assetId = '';
  const wh: { id: string } = { id: '' };
  let itemId = '';

  try {
    const fx = await projectWithWorkOrders(svc, run, ['Piling']);
    projectId = fx.projectId;
    woId = fx.workOrders[0].id;
    const wo = fx.workOrders[0];
    // The contract work item the issue is taken to (a stock issue names one of the project's work items).
    const work = need('work item', await svc.from('boq_items').insert({
      org_id: ORG_ID, project_id: projectId, item_code: `PC1-${sfx}`, description: `${run} piling works`, unit: 'm', quantity: 100, rate: 10,
    }).select('id, item_code, description').single());

    // Admin registers the crane and names the same person keeper of the site store (the case's one person; the store is theirs).
    assetId = need('asset', await svc.from('equipment_assets').insert({ org_id: ORG_ID, code: `CR-${sfx.toUpperCase()}`, name: `${run} crane`, default_unit: 'hours' }).select('id').single()).id as string;
    const item = await makeItem(admin, sfx, 'PC1');
    itemId = item.id;
    const warehouse = await makeWarehouse(admin, sfx, 'PC1W', 'site', projectId);
    wh.id = warehouse.id;
    await keeperOf(admin, wh.id, pa.id);
    await postReceive(admin, wh.id, itemId, '10', '25');

    await pa.signIn(page);

    // 1. A timesheet line naming the work order.
    await page.goto('/timesheets');
    await expect(page.getByTestId('timesheets-loading')).not.toBeVisible({ timeout: 30_000 });
    const projectPicker = page.getByLabel('Add a project');
    await expect(projectPicker).toBeVisible({ timeout: 30_000 });
    const projectValue = await projectPicker.locator('option', { hasText: `${run} project` }).first().getAttribute('value');
    expect(projectValue, 'the work order project is offered on the timesheet').toBeTruthy();
    await projectPicker.selectOption(projectValue!);
    const monday = page.getByRole('textbox', { name: new RegExp(`${run} project, Mon hours`, 'i') });
    await expect(monday).toBeVisible({ timeout: 15_000 });
    await monday.fill('4');
    // The project's only issued work order is already chosen on the row: the chip names it, nothing to pick.
    await expect(page.getByTestId('timesheets-row-attribution').getByRole('combobox', { name: /^work order$/i })).toContainText(new RegExp(wo.number), { timeout: 20_000 });
    await page.getByRole('button', { name: /save draft/i }).first().click();
    await expect(page.getByTestId('timesheets-save-status')).toHaveText('All changes saved', { timeout: 20_000 });

    // 2. An equipment use naming the work order.
    const day = iso(new Date()); // e2e-org-day: allow — UTC-pinned grid week, see the helper above
    await page.goto(`/equipment?week=${day}&asset=${assetId}`);
    await page.getByRole('button', { name: 'Add row', exact: true }).click();
    await pickComboboxOption(page, page, /^equipment/i, new RegExp(`CR-${sfx.toUpperCase()}`));
    await pickComboboxOption(page, page, /^project/i, new RegExp(`${run} project`));
    await pickComboboxOption(page, page, /^work order/i, new RegExp(wo.number));
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const usageRow = page.getByRole('row').filter({ hasText: wo.number });
    await expect(usageRow).toHaveCount(1, { timeout: 20_000 });
    const dayIndex = (new Date().getDay() + 6) % 7; // e2e-org-day: allow — the grid's today column is the browser's UTC weekday
    const hoursCell = usageRow.getByRole('textbox').nth(dayIndex);
    await hoursCell.fill('3');
    await hoursCell.press('Enter');
    await expect(usageRow.getByText('3 hours', { exact: true })).toBeVisible({ timeout: 20_000 });

    // 3. A stock issue naming the work order.
    await page.goto('/stock/new/issue');
    await page.getByLabel(/^Warehouse/).selectOption({ label: `${warehouse.code} - ${warehouse.name}` });
    await page.getByLabel(/^Project/).selectOption({ label: `${run} project` });
    await page.getByLabel(/^Work item/).selectOption({ label: `${work.item_code} - ${work.description}` });
    await page.getByRole('combobox', { name: /^Item/ }).click();
    await page.getByRole('combobox', { name: /^(search|cari) /i }).fill(item.code);
    await page.getByRole('option', { name: new RegExp(item.code) }).click();
    await page.getByLabel(/^Quantity/).fill('2');
    await pickComboboxOption(page, page, /^work order$/i, new RegExp(wo.number));
    await page.getByRole('button', { name: /^post issue$/i }).click();
    await page.getByRole('dialog', { name: /post this issue/i }).getByRole('button', { name: /^post$/i }).click();
    await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    // 4. All three appear in that work order's actual cost.
    await page.goto(`/work-orders/${woId}`);
    const timesheetGroup = page.getByTestId('cost-group-timesheet_entry');
    const equipmentGroup = page.getByTestId('cost-group-equipment_usage');
    const stockGroup = page.getByTestId('cost-group-stock_document');
    await expect(timesheetGroup).toBeVisible({ timeout: 30_000 });
    await expect(timesheetGroup).toContainText(`${run}-pa`, { timeout: 20_000 });
    await expect(equipmentGroup).toBeVisible();
    await expect(equipmentGroup).toContainText(`CR-${sfx.toUpperCase()}`);
    await expect(equipmentGroup).toContainText('3 hours');
    await expect(stockGroup).toBeVisible();
    await expect(stockGroup.getByTestId(/^cost-line-/)).toHaveCount(1);
  } finally {
    sqlAsOwner(`delete from public.stock_ledger where org_id = '${ORG_ID}' and document_id in (select id from public.stock_documents where org_id = '${ORG_ID}' and (project_id = '${projectId || '00000000-0000-0000-0000-000000000000'}' or warehouse_id = '${wh.id || '00000000-0000-0000-0000-000000000000'}'));
      delete from public.stock_document_lines where org_id = '${ORG_ID}' and document_id in (select id from public.stock_documents where org_id = '${ORG_ID}' and (project_id = '${projectId || '00000000-0000-0000-0000-000000000000'}' or warehouse_id = '${wh.id || '00000000-0000-0000-0000-000000000000'}'));
      delete from public.stock_documents where org_id = '${ORG_ID}' and (project_id = '${projectId || '00000000-0000-0000-0000-000000000000'}' or warehouse_id = '${wh.id || '00000000-0000-0000-0000-000000000000'}');
      delete from public.stock_warehouse_keepers where warehouse_id = '${wh.id || '00000000-0000-0000-0000-000000000000'}';
      delete from public.stock_warehouses where id = '${wh.id || '00000000-0000-0000-0000-000000000000'}';
      delete from public.stock_items where id = '${itemId || '00000000-0000-0000-0000-000000000000'}';
      delete from public.stock_units where code = 'E2E-U${sfx}';
      delete from public.equipment_usage_entries where asset_id = '${assetId || '00000000-0000-0000-0000-000000000000'}';
      delete from public.equipment_assets where id = '${assetId || '00000000-0000-0000-0000-000000000000'}';
      delete from public.timesheets where user_id = '${pa.id}';
      delete from public.boq_items where project_id = '${projectId || '00000000-0000-0000-0000-000000000000'}';
      delete from public.work_orders where id = '${woId || '00000000-0000-0000-0000-000000000000'}';
      delete from public.projects where id = '${projectId || '00000000-0000-0000-0000-000000000000'}';`);
    ok('login cleanup', await svc.from('profiles').delete().eq('id', pa.id));
    await pa.cleanup();
  }
});
