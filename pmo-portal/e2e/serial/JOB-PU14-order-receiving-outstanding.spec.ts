// @e2e-isolation: serial — turns the org-wide "receive goods against orders" switch on and off (Admin); project, warehouse, item and purchase are this run's own, and the ledger codes carry a per-run suffix.
/**
 * JOB-PU14 — receive at the yard or site: the storekeeper receives 37 of an order for 40 against the site store; the site's stock
 * rises by 37 and the order reads "Ordered 40 · Received 37 · Outstanding 3".
 */
import { expect, test } from '@playwright/test';
import { createProcurementFixture, type ProcurementFixture } from '../procurement-fixture';
import { roleJobUser } from '../support/roleJobUser';
import { ORG_ID, need, ok, ownProject, runId, serviceClient } from '../support/jobFixtures';
import { orgToday } from '../support/jobJourney';
import { keeperOf, makeItem, makeWarehouse, runSuffix, userClient } from '../support/stockFixture';
import { label } from '../support/jobStock';

test.setTimeout(180_000);

let storekeeper: Awaited<ReturnType<typeof roleJobUser>>;
let purchase: ProcurementFixture;
let site: { id: string; code: string; name: string };
let item: { id: string; code: string; name: string };
let poNumber = '';
let projectId = '';
let receivingWasOn = false;

test.beforeAll(async () => {
  const svc = serviceClient('JOB-PU14');
  const admin = await userClient('admin@acme.test');
  const sfx = runSuffix();

  const flag = await svc.from('order_receiving_settings').select('enabled').eq('org_id', ORG_ID).maybeSingle();
  ok('receiving switch read', flag);
  receivingWasOn = flag.data?.enabled === true;
  ok('receiving on', await admin.rpc('set_order_receiving_enabled', { p_enabled: true }));

  storekeeper = await roleJobUser(svc, 'storekeeper', runId('pu14-sk'));
  projectId = await ownProject(svc, `${runId('pu14')} project`);
  site = await makeWarehouse(admin, sfx, 'SITE', 'site', projectId);
  await keeperOf(admin, site.id, storekeeper.id);
  item = await makeItem(admin, sfx, 'DEL');

  purchase = await createProcurementFixture({ status: 'Approved', title: 'JOB-PU14 forty', withSupplier: true, projectId, quantity: 40, rate: 25 });
  ok('currency', await svc.from('procurements').update({ currency: 'USD' }).eq('id', purchase.id));
  const line = need('purchase line', await svc.from('procurement_items').select('id').eq('procurement_id', purchase.id).limit(1).single());
  ok('stock mapping', await svc.from('order_stock_mappings').insert({ item_id: line.id, stock_item_id: item.id, org_id: ORG_ID }));
  poNumber = `PO-14-${Date.now()}`;
  ok('order', await svc.from('purchase_orders').insert({
    org_id: ORG_ID, procurement_id: purchase.id, po_number: poNumber, status: 'Issued',
    date: orgToday(), amount: 1000, currency: 'USD',
  }));
  ok('ordered', await svc.from('procurements').update({ status: 'Ordered' }).eq('id', purchase.id));
});

test.afterAll(async () => {
  // The posted receipt is a stock document: an append-only ledger row that points at this purchase, so the
  // purchase stays (per-run codes, unique names) and only the org switch and the login are restored here.
  await storekeeper?.cleanup();
  const admin = await userClient('admin@acme.test');
  if (!receivingWasOn) ok('receiving restore', await admin.rpc('set_order_receiving_enabled', { p_enabled: false }));
});

test('JOB-PU14 the storekeeper receives 37 of 40 at the site and the order reads 3 outstanding', async ({ page }) => {
  await storekeeper.signIn(page);
  await page.goto('/stock/new/receive');
  await page.getByLabel(/^Purchase order/).selectOption({ label: poNumber });

  // The order's own count of what has arrived: nothing yet, 40 outstanding.
  const progress = page.getByText(/Ordered 40 · Received 0 · Outstanding 40/);
  await expect(progress).toBeVisible({ timeout: 20_000 });

  await page.getByLabel(/^Warehouse/).selectOption({ label: label(site) });
  await page.getByLabel(/^Counted quantity/).fill('37');
  await page.getByRole('button', { name: 'Record receipt' }).click();
  await page.getByRole('dialog', { name: 'Record this counted quantity?' }).getByRole('button', { name: 'Record receipt' }).click();
  await expect(page.getByText('Receipt posted')).toBeVisible({ timeout: 20_000 });

  // The goal: the site's stock rose by 37 and the order shows 3 still to come.
  await expect(page.getByText(/Ordered 40 · Received 37 · Outstanding 3/)).toBeVisible({ timeout: 20_000 });
  await page.goto('/stock');
  await page.getByPlaceholder('Search items').fill(item.code);
  const row = page.getByRole('row').filter({ hasText: site.name });
  await expect(row).toContainText('37', { timeout: 20_000 });
});
