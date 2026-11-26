// @e2e-isolation: serial — the Admin changes an organisation-wide setting and restores it after the journey.
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { pinEnglishLocale, signIn } from '../helpers';
import { createProcurementFixture } from '../procurement-fixture';
import { ok, runId, serviceClient, sqlAsOwner } from '../support/jobFixtures';
import { roleJobUser } from '../support/roleJobUser';
import { makeItem, makeWarehouse, postReceive, runSuffix, userClient } from '../support/stockFixture';

const reason = 'Harga disembunyikan dari pemohon.';
const stockPrice = /(?:75[.,]432|150[.,]864)/;
const requestPrice = /12[.,]000/;
const requestLine = 'Bahan pengikat';

async function capture(page: Page, screen: string) {
  const dir = process.env.PRICE_SCREENSHOTS_DIR;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `${dir}/${screen}-${page.viewportSize()?.width}.png`,
    animations: 'disabled',
    maskColor: '#e5e7eb',
    mask: [
      page.getByRole('banner'),
      page.getByRole('button', { name: /^(menu akun|account menu)$/i }),
      page.getByText(/price-requester-/i),
      page.locator('div:has(> dt)').filter({ has: page.locator('dt').filter({ hasText: /^(Dibuat oleh|Pembuat|Author|Created by)$/ }) }),
    ],
  });
}

test('Admin hides purchase and stock prices from a requester while a procurement manager still sees them', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await userClient('admin@acme.test');
  const service = serviceClient('hide-prices-screens');
  const previous = await admin.rpc('get_hide_prices_enabled');
  ok('read price setting', previous);
  const previousRolesSwitch = await admin.rpc('get_built_in_roles_enabled');
  ok('read built-in roles setting', previousRolesSwitch);
  const title = 'Permintaan material';
  const suffix = runSuffix();
  const adminPage = await browser.newPage();
  const requesterPage = await browser.newPage();
  const purchaserPage = await browser.newPage();
  let requester: Awaited<ReturnType<typeof roleJobUser>> | undefined;
  let purchaser: Awaited<ReturnType<typeof roleJobUser>> | undefined;
  let purchase: Awaited<ReturnType<typeof createProcurementFixture>> | undefined;
  let projectId: string | undefined;
  let item: Awaited<ReturnType<typeof makeItem>> | undefined;
  let warehouse: Awaited<ReturnType<typeof makeWarehouse>> | undefined;
  let receipt: string | undefined;

  try {
    ok('start with setting off', await admin.rpc('set_hide_prices_enabled', { p_enabled: false }));
    ok('enable built-in roles', await admin.rpc('set_built_in_roles_enabled', { p_enabled: true }));
    requester = await roleJobUser(service, 'site_supervisor', runId('price-requester'));
    purchaser = await roleJobUser(service, 'procurement_manager', runId('price-purchaser'));
    const project = await admin.from('projects').insert({ name: `Proyek material ${suffix}`, status: 'Internal Project', project_manager_id: purchaser.id }).select('id').single();
    ok('create the project', project);
    projectId = project.data?.id as string;
    purchase = await createProcurementFixture({ status: 'Approved', title: `${title} ${suffix}`, requestedBy: requester.id, projectId, lineName: requestLine });
    item = await makeItem(admin, suffix);
    warehouse = await makeWarehouse(admin, suffix, 'C', 'central');
    receipt = await postReceive(admin, warehouse.id, item.id, '2', '75432');

    await pinEnglishLocale(adminPage);
    await signIn(adminPage, 'admin@acme.test');
    await adminPage.goto('/administration/clearance#org-hide-prices');
    const card = adminPage.locator('#org-hide-prices');
    await card.getByRole('button', { name: 'Hide prices from requesters', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Show prices to requesters again' })).toBeVisible();

    await requester.signIn(requesterPage);
    ok('set the disposable requester locale', await service.from('profiles').update({ locale: 'id', number_locale: 'id-ID' }).eq('id', requester.id));
    const stockUrl = `/stock?q=${item.code}`;
    const receiptUrl = `/stock/documents/${receipt}`;

    for (const width of [1440, 390]) {
      await requesterPage.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await requesterPage.goto(`/procurement/${purchase.id}/items`);
      await expect(requesterPage.getByRole('heading', { name: new RegExp(`${title} ${suffix}`) }).first()).toBeVisible();
      await expect(requesterPage.getByText(reason, { exact: true }).first()).toBeVisible();
      await expect(requesterPage.getByText(requestLine, { exact: true }).first()).toBeVisible();
      await expect(requesterPage.getByText(requestPrice)).toHaveCount(0);
      await capture(requesterPage, 'purchase-request');

      await requesterPage.goto(stockUrl);
      await expect(requesterPage.getByText(item.code, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
      await expect(requesterPage.getByText(reason, { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(requesterPage.getByText(stockPrice)).toHaveCount(0);
      await capture(requesterPage, 'stock-home');

      await requesterPage.goto(receiptUrl);
      await expect(requesterPage.getByText(item.code, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
      await expect(requesterPage.getByText(reason, { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(requesterPage.getByText(stockPrice)).toHaveCount(0);
      await capture(requesterPage, 'receipt');
    }

    await purchaser.signIn(purchaserPage);
    await purchaserPage.goto(`/procurement/${purchase.id}/items`);
    await expect(purchaserPage.getByText(requestPrice).first()).toBeVisible({ timeout: 20_000 });
    await purchaserPage.goto(stockUrl);
    await expect(purchaserPage.getByText(stockPrice).first()).toBeVisible({ timeout: 20_000 });
    await purchaserPage.goto(receiptUrl);
    await expect(purchaserPage.getByText(stockPrice).first()).toBeVisible({ timeout: 20_000 });
  } finally {
    ok('turn price hiding off for restoration', await admin.rpc('set_hide_prices_enabled', { p_enabled: false }));
    ok('restore built-in roles setting', await admin.rpc('set_built_in_roles_enabled', { p_enabled: previousRolesSwitch.data === true }));
    ok('restore price setting', await admin.rpc('set_hide_prices_enabled', { p_enabled: previous.data === true }));
    await Promise.all([adminPage.close(), requesterPage.close(), purchaserPage.close()]);
    if (receipt) sqlAsOwner(`delete from stock_ledger where document_id = '${receipt}'; delete from stock_document_lines where document_id = '${receipt}'; delete from stock_documents where id = '${receipt}';`);
    if (warehouse) {
      sqlAsOwner(`delete from stock_balances where warehouse_id = '${warehouse.id}';`);
      ok('remove the warehouse', await service.from('stock_warehouses').delete().eq('id', warehouse.id));
    }
    if (item) ok('remove the stock item', await service.from('stock_items').delete().eq('id', item.id));
    ok('remove the unit', await service.from('stock_units').delete().eq('code', `E2E-U${suffix}`));
    await purchase?.cleanup();
    if (projectId) ok('remove the project', await service.from('projects').delete().eq('id', projectId));
    await requester?.cleanup();
    await purchaser?.cleanup();
  }
});
