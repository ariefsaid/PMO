// @e2e-isolation: serial — temporarily disconnects accounting and removes organization-wide account mappings, restoring them and the job-role catalogue afterward.
import { test, expect } from '@playwright/test';
import { moneyJobRole } from '../support/moneyJobRole';
import { serviceClient, projectWithWorkOrders, runId, need, ok, ORG_ID } from '../support/jobFixtures';
import { userClient } from '../support/stockFixture';
import { signIn, pickComboboxOption } from '../helpers';

test.setTimeout(180_000);
let previouslyEnabled: boolean;
test.beforeEach(async () => {
  const service = serviceClient('job-role setup');
  previouslyEnabled = need('role setting', await service.from('organizations').select('built_in_roles_enabled').eq('id', ORG_ID).single()).built_in_roles_enabled;
  if (!previouslyEnabled) ok('Admin enables catalogue', await (await userClient('admin@acme.test')).rpc('set_built_in_roles_enabled', { p_enabled: true }));
});
test.afterEach(async () => {
  if (!previouslyEnabled) ok('Admin restores catalogue', await (await userClient('admin@acme.test')).rpc('set_built_in_roles_enabled', { p_enabled: false }));
});

test('AC-NATIVE-EQU project control records crane hours and sees their native cost', async ({ page }) => {
  const service = serviceClient('equipment setup');
  const role = await moneyJobRole('project_control_manager');
  const run = runId('split');
  const setup = await projectWithWorkOrders(service, run, ['First']);
  const asset = need('Admin registers crane', await service.from('equipment_assets').insert({ org_id: ORG_ID, code: run, name: `${run} crane`, default_unit: 'hours' }).select('id').single());
  const date = new Date(); date.setDate(date.getDate() - 7);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const dayIndex = (date.getDay() + 6) % 7;
  const bindings = need('bindings', await service.from('external_org_bindings').select('id,status').eq('org_id', ORG_ID));
  const mappings = need('mappings', await service.from('budget_category_account_map').select('*').eq('org_id', ORG_ID));
  try {
    ok('disconnect accounting for fixture', await service.from('external_org_bindings').update({ status: 'disconnected' }).eq('org_id', ORG_ID));
    ok('native categories need no maps', await service.from('budget_category_account_map').delete().eq('org_id', ORG_ID));
    ok('Admin sets commercial rate', await (await userClient('admin@acme.test')).rpc('save_equipment_costing', { p_setting: { asset_id: asset.id, basis: 'hire_rate', work_rate: 50, rate_unit: 'hours', effective_from: day } }));
    await role.login(page);
    await page.goto(`/equipment?week=${day}&asset=${asset.id}`);
    for (const [index, hours] of ['3'].entries()) {
      await page.getByRole('button', { name: 'Add row', exact: true }).click();
      await pickComboboxOption(page, page, /^Equipment/, new RegExp(run));
      await pickComboboxOption(page, page, /^Project/, new RegExp(run));
      await pickComboboxOption(page, page, /^Work order/, new RegExp(setup.workOrders[index].title));
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      const row = page.getByRole('row').filter({ hasText: setup.workOrders[index].number });
      await expect(row).toHaveCount(1);
      const input = row.getByRole('textbox').nth(dayIndex);
      await input.fill(hours);
      await input.press('Enter');
      await expect(row.getByText('Draft', { exact: true })).toBeVisible();
      await expect(row.getByText(`${hours} hours`, { exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Submit week' }).click();
    await signIn(page, 'pm@acme.test');
    await page.goto(`/equipment?week=${day}`);
    await page.getByRole('tab', { name: 'Approvals' }).click();
    await page.getByRole('button', { name: 'Approve week' }).click();
    await page.getByRole('dialog', { name: 'Approve equipment usage week?' }).getByRole('button', { name: 'Approve week' }).click();
    await role.login(page);
    await page.goto(`/work-orders/${setup.workOrders[0].id}`);
    await expect(page.getByTestId('cost-group-equipment_usage').getByText('$150', { exact: true }).first()).toBeVisible();
  } finally {
    // Restore valid rate/category state before reconnecting: connection validates every saved hire category.
    ok('remove own rates', await service.from('equipment_costing_settings').delete().eq('asset_id', asset.id));
    if (mappings.length) ok('restore maps', await service.from('budget_category_account_map').insert(mappings));
    for (const binding of bindings) ok('restore accounting status', await service.from('external_org_bindings').update({ status: binding.status }).eq('id', binding.id));
    ok('remove own usage', await service.from('equipment_usage_entries').delete().eq('asset_id', asset.id));
    ok('remove own asset', await service.from('equipment_assets').delete().eq('id', asset.id));
    ok('remove own work orders', await service.from('work_orders').delete().eq('project_id', setup.projectId));
    ok('remove own project', await service.from('projects').delete().eq('id', setup.projectId));
    await role.cleanup();
  }
});
