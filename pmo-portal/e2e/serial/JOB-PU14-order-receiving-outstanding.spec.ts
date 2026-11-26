// @e2e-isolation: serial — turns the org-wide "receive goods against orders" switch on and off (Admin); project, warehouse, item and purchase are this run's own, and the ledger codes carry a per-run suffix.
/**
 * JOB-PU14 — receive at the yard or site: the storekeeper receives 37 of an order for 40 against the site store; the site's stock
 * rises by 37, and a purchasing user reads "Ordered 40 · Received 37 · Outstanding 3" on the purchase's items tab.
 * Ruled: the storekeeper receives blind and is never shown ordered or outstanding quantities, so the order's count is read by purchasing.
 */
import { expect, test } from '@playwright/test';
import { signIn } from '../helpers';
import { createProcurementFixture, type ProcurementFixture } from '../procurement-fixture';
import { roleJobUser } from '../support/roleJobUser';
import { ORG_ID, need, ok, ownProject, runId, serviceClient, sqlAsOwner } from '../support/jobFixtures';
import { orgToday } from '../support/jobJourney';
import { keeperOf, makeItem, makeWarehouse, runSuffix, userClient } from '../support/stockFixture';

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
  const admin = await userClient('admin@acme.test');
  // The keeper assignment points at the login, so the Admin releases it before the login goes.
  if (site && storekeeper) ok('keeper release', await admin.rpc('set_stock_warehouse_keeper', { p_warehouse_id: site.id, p_user_id: storekeeper.id, p_assigned: false }));
  // The storekeeper's posted receipt (stock document, its ledger rows, the receiving request and the order receipt) and the
  // purchase's status events name the login; this run's own rows go as the local owner before the login does.
  if (storekeeper && site) {
    const docs = `select id from public.stock_documents where created_by = '${storekeeper.id}' and warehouse_id = '${site.id}'`;
    sqlAsOwner(`delete from public.stock_ledger where document_id in (${docs});
      delete from public.order_receiving_requests where stock_document_id in (${docs});
      delete from public.stock_document_lines where document_id in (${docs});
      delete from public.stock_documents where id in (${docs});
      delete from public.stock_balances where warehouse_id = '${site.id}';
      delete from public.procurement_receipt_lines where receipt_id in (select id from public.procurement_receipts where procurement_id = '${purchase.id}');
      delete from public.procurement_receipts where procurement_id = '${purchase.id}';
      delete from public.procurement_status_events where actor_id = '${storekeeper.id}';`);
  }
  await storekeeper?.cleanup();
  if (!receivingWasOn) ok('receiving restore', await admin.rpc('set_order_receiving_enabled', { p_enabled: false }));
});

test('JOB-PU14 the storekeeper receives 37 of 40 at the site and a purchasing user reads 3 outstanding on the order', async ({ page }) => {
  await storekeeper.signIn(page);
  await page.goto('/stock/new/receive');
  await page.getByLabel(/^Purchase order/).selectOption({ label: poNumber });

  // Blind receipt: the storekeeper is not shown what was ordered or what is outstanding.
  await expect(page.getByLabel(/^Counted quantity/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Ordered 40/)).toHaveCount(0);
  await expect(page.getByText(/Outstanding \d/)).toHaveCount(0);

  await page.getByLabel(/^Warehouse/).selectOption({ label: site.name });
  await page.getByLabel(/^Counted quantity/).fill('37');
  await page.getByRole('button', { name: 'Record receipt' }).click();
  await page.getByRole('dialog', { name: 'Record this counted quantity?' }).getByRole('button', { name: 'Record receipt' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Receipt posted' })).toBeVisible({ timeout: 20_000 });

  // The goal, first half: the site's stock rose by 37.
  await page.goto('/stock');
  await page.getByPlaceholder('Search items').fill(item.code);
  const row = page.getByRole('row').filter({ hasText: site.name });
  await expect(row).toContainText('37', { timeout: 20_000 });

  // Second half: a purchasing user reads the order's count on the purchase's items tab: 3 still to come.
  await signIn(page, 'finance@acme.test');
  await page.goto(`/procurement/${purchase.id}`);
  await page.getByRole('tab', { name: 'Items' }).click();
  // The order's line reads, column by column: Ordered 40 · Received 37 · Outstanding 3.
  // The purchase has one line (the fixture's); its row is the table's only row with a row header.
  const orderLine = page.getByRole('table', { name: 'Goods received' }).getByRole('row').filter({ has: page.getByRole('rowheader') });
  await expect(orderLine.getByRole('cell').nth(0)).toHaveText(/^40\b/, { timeout: 20_000 });
  await expect(orderLine.getByRole('cell').nth(1)).toHaveText(/^37\b/);
  await expect(orderLine.getByRole('cell').nth(2)).toHaveText(/^3\b/);
});
