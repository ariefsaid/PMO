// @e2e-isolation: serial — Admin enables the organisation's job-role catalogue, then restores its previous setting.
import { test, expect } from '@playwright/test';
import { moneyJobRole } from '../support/moneyJobRole';
import { serviceClient, projectWithWorkOrders, runId, need, ok, ORG_ID } from '../support/jobFixtures';
import { userClient } from '../support/stockFixture';
import { pickComboboxOption } from '../helpers';

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

test('AC-EQU-SPLIT Equipment Officer logs a crane on two work orders in one day and each shows its own hours', async ({ page }) => {
  const service = serviceClient('equipment setup');
  const role = await moneyJobRole('equipment_officer');
  const run = runId('split');
  const setup = await projectWithWorkOrders(service, run, ['First', 'Second']);
  const asset = need('Admin registers crane', await service.from('equipment_assets').insert({ org_id: ORG_ID, code: run, name: `${run} crane`, default_unit: 'hours' }).select('id').single());
  const date = new Date(); date.setDate(date.getDate() - 7);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const dayIndex = (date.getDay() + 6) % 7;
  try {
    await role.login(page);
    await page.goto(`/equipment?week=${day}&asset=${asset.id}`);
    for (const [index, hours] of ['5', '3'].entries()) {
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
    await page.reload();
    for (const [index, hours] of ['5', '3'].entries()) {
      const row = page.getByRole('row').filter({ hasText: setup.workOrders[index].number });
      await expect(row.getByRole('textbox').nth(dayIndex)).toHaveValue(hours);
      await expect(row.getByText(`${hours} hours`, { exact: true })).toBeVisible();
    }
  } finally {
    ok('remove own usage', await service.from('equipment_usage_entries').delete().eq('asset_id', asset.id));
    ok('remove own asset', await service.from('equipment_assets').delete().eq('id', asset.id));
    ok('remove own work orders', await service.from('work_orders').delete().eq('project_id', setup.projectId));
    ok('remove own project', await service.from('projects').delete().eq('id', setup.projectId));
    await role.cleanup();
  }
});

