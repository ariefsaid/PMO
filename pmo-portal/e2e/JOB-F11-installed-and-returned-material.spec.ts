// @e2e-isolation: self-isolated — unique item, site warehouse and work item per run; the posted stock ledger is append-only, so every code carries a per-run suffix.
/**
 * JOB-F11 — installed and returned material (#2523, #1522). 50 units are issued to a work item, 40 are installed and the
 * unused 10 are returned to the site warehouse.
 * Goal oracle: the warehouse shows 10 and the project's consumption shows 50 issued, 10 returned, 40 net used.
 * Partly built: no per-item "installed" and "received" entry (site-report branch); the net used is derived from issue minus return.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { keeperOf, makeItem, makeWarehouse, makeWorkItem, postReceive, runSuffix, SEED_PROJECT_ID, SEED_PROJECT_NAME, userClient } from './support/stockFixture';
import { chooseItem, expectOnHand, whLabel } from './support/stockUi';

test.setTimeout(180_000);

test('JOB-F11 50 issued and 10 returned leaves 10 in the warehouse and 40 used', async ({ page }) => {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const item = await makeItem(admin, sfx, 'PIPE');
  const site = await makeWarehouse(admin, sfx, 'SITE', 'site');
  const work = await makeWorkItem(admin, sfx);
  await keeperOf(admin, site.id);
  await postReceive(admin, site.id, item.id, '50');

  await signIn(page, 'engineer@acme.test');
  await page.goto('/stock/new/issue');
  await page.getByLabel(/^Warehouse/).selectOption({ label: whLabel(site) });
  await page.getByLabel(/^Project/).selectOption({ label: SEED_PROJECT_NAME });
  await page.getByLabel(/^Work item/).selectOption({ label: `${work.item_code} - ${work.description}` });
  await chooseItem(page, item.code);
  await page.getByLabel(/^Quantity/).fill('50');
  await page.getByRole('button', { name: 'Post issue' }).click();
  await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  await page.goto('/stock/new/return');
  await page.getByLabel(/^Warehouse/).selectOption({ label: whLabel(site) });
  await page.getByLabel(/^Project/).selectOption({ label: SEED_PROJECT_NAME });
  await page.getByLabel(/^Issue to return/).selectOption({ index: 1 });
  await page.getByLabel(/^Quantity/).fill('10');
  await page.getByRole('button', { name: 'Post return' }).click();
  await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  await expectOnHand(page, site, item.code, '10');
  await page.goto(`/projects/${SEED_PROJECT_ID}/materials`);
  const byMonth = page.getByRole('table', { name: 'By month' }).getByRole('row').filter({ hasText: item.code }).filter({ hasText: work.item_code });
  await expect(byMonth.getByRole('cell').nth(3)).toHaveText(/^50$/, { timeout: 20_000 });
  await expect(byMonth.getByRole('cell').nth(4)).toHaveText(/^10$/);
  await expect(byMonth.getByRole('cell').nth(5)).toHaveText(/^40\s+\S+$/);
});
