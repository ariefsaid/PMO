// @e2e-isolation: self-isolated — unique item, site warehouse and work item per run; the posted ledger is append-only so codes carry a per-run suffix.
/** JOB-W10 — a closing job's leftover material is returned to the warehouse and the warehouse reads the full quantity again.
 *  Partly landed: the return from a project posts; the rule that a closing work order's balance must reach zero is held (not tested). */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { makeItem, makeWarehouse, makeWorkItem, postReceive, runSuffix, userClient, SEED_PROJECT_ID, SEED_PROJECT_NAME } from './support/stockFixture';
import { label } from './support/jobStock';

test.setTimeout(180_000);

test('JOB-W10 returning 4 leftover units puts them back in the warehouse', async ({ page }) => {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const item = await makeItem(admin, sfx, 'RET');
  const site = await makeWarehouse(admin, sfx, 'SITE', 'site');
  const work = await makeWorkItem(admin, sfx);
  await postReceive(admin, site.id, item.id, '10', '25');
  const issued = await admin.rpc('create_stock_document', { p_header: { kind: 'issue', warehouse_id: site.id, project_id: SEED_PROJECT_ID }, p_lines: [{ item_id: item.id, quantity: '4', boq_item_id: work.id }], p_post: true });
  if (issued.error) throw issued.error;

  await signIn(page, 'admin@acme.test');
  await page.goto('/stock/new/return');
  await page.getByLabel(/^Warehouse/).selectOption({ label: label(site) });
  await page.getByLabel(/^Project/).selectOption({ label: SEED_PROJECT_NAME });
  // The picker lists every posted issue on the shared seed project; cite this run's own issue, never a position.
  const source = page.getByLabel(/^Issue to return/);
  const own = source.locator('option', { hasText: item.code });
  await expect(own).toHaveCount(1, { timeout: 15_000 });
  await source.selectOption(await own.getAttribute('value') ?? '');
  await page.getByLabel(/^Quantity/).fill('4');
  await page.getByRole('button', { name: 'Post stock return' }).click();
  await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  await page.goto(`/stock/ledger?item=${item.id}`);
  await expect(page.getByRole('row').filter({ hasText: 'Return' }).first(), 'the return is on the ledger').toBeVisible({ timeout: 15_000 });

  await page.goto('/stock');
  await page.getByPlaceholder('Search items').fill(item.code);
  await expect(page.getByRole('row').filter({ hasText: item.code }).filter({ hasText: site.name })).toContainText('10');
});
