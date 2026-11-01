// @e2e-isolation: self-isolated - creates its own uniquely-named item, warehouse, project work item and stock; the append-only ledger cannot be cleaned (PQ-10), so every code carries a per-run suffix.
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { keeperOf, makeItem, makeWarehouse, makeWorkItem, postReceive, runSuffix, SEED_PROJECT_ID, SEED_PROJECT_NAME, userClient } from './support/stockFixture';

test.setTimeout(120_000);

test('AC-STK-001: a storekeeper issues 30 of 100 bags to a project work item and sees 70 left, who did it, the project trace, and 30 used against an allowance of 100', async ({ page }) => {
  // Given: stock in a warehouse the Engineer keeps, and a work item on an ongoing project
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const item = await makeItem(admin, sfx);
  const wh = await makeWarehouse(admin, sfx, 'WH', 'site');
  const work = await makeWorkItem(admin, sfx);
  await keeperOf(admin, wh.id);
  await postReceive(admin, wh.id, item.id, '100');
  const allowance = await admin.from('boq_material_allowances').insert({ boq_item_id: work.id, item_id: item.id, planned_quantity: 100 }).select('id');
  if (allowance.error || !allowance.data?.length) throw new Error(`allowance: ${allowance.error?.message ?? 'no row'}`);

  // When: the Engineer issues 30 through the form
  await signIn(page, 'engineer@acme.test');
  await page.goto('/stock/new/issue');
  await page.getByLabel(/^Warehouse/).selectOption({ label: `${wh.code} - ${wh.name}` });
  await page.getByLabel(/^Project/).selectOption({ label: SEED_PROJECT_NAME });
  await page.getByLabel(/^Work item/).selectOption({ label: `${work.item_code} - ${work.description}` });
  await page.getByRole('combobox', { name: /^Item/ }).click();
  await page.getByRole('searchbox').fill(item.code);
  await page.getByRole('option', { name: new RegExp(item.code) }).click();
  await page.getByLabel(/^Quantity/).fill('30');
  await page.getByRole('button', { name: 'Post issue' }).click();
  await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  // Then 1: the warehouse shows 70
  await page.goto('/stock');
  await page.getByRole('combobox', { name: 'Warehouse', exact: true }).selectOption({ label: `${wh.code} - ${wh.name}` });
  const balance = page.getByRole('row', { name: new RegExp(item.code) });
  await expect(balance.getByRole('cell', { name: /^70\s+\S+$/ }), 'the warehouse shows exactly 70 of that item').toBeVisible();

  // Then 2: the trace names the actor, the project and the work item
  await page.goto(`/stock/ledger?item=${item.id}`);
  const issue = page.getByRole('row').filter({ hasText: 'Tomas Beck' }).filter({ hasText: SEED_PROJECT_NAME });
  await expect(issue, 'the trace shows who issued it, to which project').toBeVisible();
  await expect(issue).toContainText(work.item_code);

  // Then 3: the project's Materials tab shows the same issue
  await page.goto(`/projects/${SEED_PROJECT_ID}/materials`);
  const movements = page.getByRole('region', { name: 'Movements' });
  await expect(movements.getByRole('row').filter({ hasText: item.code }).filter({ hasText: work.item_code }), 'the project Materials tab lists the issue').toBeVisible();

  // Then 4: the consumption report shows 30 used this month on that work item, against its allowance of 100
  const byMonth = page.getByRole('table', { name: 'By month' }).getByRole('row').filter({ hasText: item.code }).filter({ hasText: work.item_code });
  // By month columns: 0 Month, 1 Work item, 2 Item, 3 Issued, 4 Returned, 5 Net used. Each figure is checked in its own cell, exactly.
  await expect(byMonth.getByRole('cell').nth(3), 'this month: 30 issued').toHaveText(/^30$/);
  await expect(byMonth.getByRole('cell').nth(4), 'nothing returned').toHaveText(/^0$/);
  await expect(byMonth.getByRole('cell').nth(5), '30 net used').toHaveText(/^30\s+\S+$/);
  await expect(byMonth).toContainText('Tomas Beck');
  const against = page.getByRole('table', { name: 'Against allowance' }).getByRole('row').filter({ hasText: item.code }).filter({ hasText: work.item_code });
  await expect(against.getByRole('cell').nth(2), 'the allowance is 100').toHaveText(/^100\s+\S+$/);
  await expect(against.getByRole('cell').nth(3), '30 used to date').toHaveText(/^30\s+\S+$/);
  await expect(against, 'within allowance: no flag').not.toContainText('Over allowance');
});
