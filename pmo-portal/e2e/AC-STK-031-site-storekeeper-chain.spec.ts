// @e2e-isolation: self-isolated - creates its own uniquely-named item, central and site warehouses, work item and stock; the append-only ledger cannot be cleaned (PQ-10), so every code carries a per-run suffix.
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { keeperOf, makeItem, makeWarehouse, makeWorkItem, runSuffix, SEED_PROJECT_ID, SEED_PROJECT_NAME, userClient } from './support/stockFixture';

test.setTimeout(180_000);

test('AC-STK-031: an Engineer keeping only the site is refused at central; the chain receipt, transfer, issue is visible to the PM', async ({ page }) => {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const item = await makeItem(admin, sfx, 'C');
  const central = await makeWarehouse(admin, sfx, 'CEN', 'central');
  const site = await makeWarehouse(admin, sfx, 'SITE', 'site');
  const work = await makeWorkItem(admin, sfx);
  await keeperOf(admin, site.id);
  const label = (w: { code: string; name: string }) => `${w.code} - ${w.name}`;

  // The Engineer is refused at central: the form never lists it, and the server refuses a forced call.
  await signIn(page, 'engineer@acme.test');
  await page.goto('/stock/new/receive');
  await page.getByLabel(/^Warehouse/).locator('option', { hasText: site.code }).waitFor({ state: 'attached' });
  const options = await page.getByLabel(/^Warehouse/).locator('option').allTextContents();
  expect(options, 'central is not offered to a site storekeeper').not.toContain(label(central));
  expect(options).toContain(label(site));
  const engineer = await userClient('engineer@acme.test');
  const forced = await engineer.rpc('create_stock_document', {
    p_header: { kind: 'receive', warehouse_id: central.id }, p_lines: [{ item_id: item.id, quantity: '1', unit_cost: '1' }], p_post: true,
  });
  expect(forced.error?.message, 'a forced receipt at central is refused by the server').toMatch(/STK_NOT_KEEPER/);

  // Admin receives 50 at central, then transfers 20 to the site, through the screens.
  await signIn(page, 'admin@acme.test');
  await page.goto('/stock/new/receive');
  await page.getByLabel(/^Warehouse/).selectOption({ label: label(central) });
  await page.getByRole('combobox', { name: /^Item/ }).click();
  await page.getByRole('searchbox').fill(item.code);
  await page.getByRole('option', { name: new RegExp(item.code) }).click();
  await page.getByLabel(/^Quantity/).fill('50');
  await page.getByLabel(/^Unit cost/).fill('25');
  await page.getByRole('button', { name: 'Post receipt' }).click();
  await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  await page.goto('/stock/new/transfer');
  await page.getByLabel('From warehouse').selectOption({ label: label(central) });
  await page.getByLabel('To warehouse').selectOption({ label: label(site) });
  await page.getByRole('combobox', { name: /^Item/ }).click();
  await page.getByRole('searchbox').fill(item.code);
  await page.getByRole('option', { name: new RegExp(item.code) }).click();
  await page.getByLabel(/^Quantity/).fill('20');
  await page.getByRole('button', { name: 'Post transfer' }).click();
  await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  // The Engineer issues 8 from the site to the work item.
  await signIn(page, 'engineer@acme.test');
  await page.goto('/stock/new/issue');
  await page.getByLabel(/^Warehouse/).selectOption({ label: label(site) });
  await page.getByLabel(/^Project/).selectOption({ label: SEED_PROJECT_NAME });
  await page.getByLabel(/^Work item/).selectOption({ label: `${work.item_code} - ${work.description}` });
  await page.getByRole('combobox', { name: /^Item/ }).click();
  await page.getByRole('searchbox').fill(item.code);
  await page.getByRole('option', { name: new RegExp(item.code) }).click();
  await page.getByLabel(/^Quantity/).fill('8');
  await page.getByRole('button', { name: 'Post issue' }).click();
  await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  // The PM sees the whole chain on the item's trace, and the issue on the project's Materials tab.
  await signIn(page, 'pm@acme.test');
  await page.goto(`/stock/ledger?item=${item.id}`);
  for (const kind of ['Receive', 'Transfer', 'Issue to project']) {
    await expect(page.getByRole('row').filter({ hasText: kind }).first(), `the PM sees the ${kind} on the trace`).toBeVisible();
  }
  await page.goto(`/projects/${SEED_PROJECT_ID}/materials`);
  await expect(page.getByRole('region', { name: 'Movements' }).getByRole('row').filter({ hasText: item.code }).filter({ hasText: work.item_code }), 'the project Materials tab lists the issue').toBeVisible();

  // An Engineer who keeps no warehouse is offered no movement.
  await signIn(page, 'ts-colocated-eng@acme.test');
  await page.goto('/stock');
  await expect(page.getByRole('heading', { name: 'Stock on hand' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Issue to project' })).toHaveCount(0);
  await page.goto('/stock/new/issue');
  await expect(page.getByText('You keep no warehouse')).toBeVisible();
});
