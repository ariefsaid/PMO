// @e2e-isolation: serial — the Admin changes an organisation-wide setting and restores it after the journey.
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../helpers';
import { createProcurementFixture } from '../procurement-fixture';
import { ORG_ID, ok, runId, serviceClient, sqlAsOwner } from '../support/jobFixtures';
import { roleJobUser } from '../support/roleJobUser';
import { makeItem, makeWarehouse, postReceive, runSuffix, userClient } from '../support/stockFixture';

const reason = 'Harga disembunyikan dari pemohon.';
const stockPrice = /(?:75[.,]432|150[.,]864)/;
const requestPrice = /12[.,]000/;
const requestLine = 'Bahan pengikat';

type Locale = 'en' | 'id';
test.use({ actionTimeout: 20_000 });

async function expectNoPriceFigures(page: Page) {
  await expect(page.getByRole('main').getByText(/(?:Rp|US\$|\$|IDR|USD)\s*[\d.,]+/)).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: /Unit price|Line total/i })).toHaveCount(0);
}

async function pinLocale(page: Page, getLocale: () => Locale) {
  await page.route('**/rest/v1/profiles?*', async (route) => {
    const url = route.request().url();
    if (route.request().method() !== 'GET' || !/[?&]id=eq\./.test(url)) return route.fallback();
    const response = await route.fetch({ maxRetries: 2 });
    let body: unknown;
    try { body = await response.json(); }
    catch { return route.fulfill({ response }); }
    if (body && !Array.isArray(body) && typeof body === 'object' && 'locale' in body) {
      const locale = getLocale();
      return route.fulfill({ response, json: { ...body, locale, number_locale: locale === 'id' ? 'id-ID' : 'en-US' } });
    }
    return route.fulfill({ response, json: body });
  });
}

async function capture(page: Page, screen: string, locale: Locale) {
  const dir = process.env.PRICE_SCREENSHOTS_DIR;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `${dir}/${screen}-${locale}-${page.viewportSize()?.width}.png`,
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
  test.setTimeout(600_000);
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
  let requesterDraft: Awaited<ReturnType<typeof createProcurementFixture>> | undefined;
  let purchaseRequestId: string | undefined;
  let authoredRequestId: string | undefined;
  let projectId: string | undefined;
  let item: Awaited<ReturnType<typeof makeItem>> | undefined;
  let warehouse: Awaited<ReturnType<typeof makeWarehouse>> | undefined;
  let receipt: string | undefined;
  let adminLocale: Locale = 'en';
  let requesterLocale: Locale = 'en';
  let neededByRuleWasOn = false;

  try {
    ok('start with setting off', await admin.rpc('set_hide_prices_enabled', { p_enabled: false }));
    ok('enable built-in roles', await admin.rpc('set_built_in_roles_enabled', { p_enabled: true }));
    const org = await service.from('organizations').select('po_needed_by_required_from').eq('id', ORG_ID).single();
    ok('read needed-by rule', org);
    neededByRuleWasOn = Boolean(org.data?.po_needed_by_required_from);
    ok('enable needed-by rule', await admin.rpc('set_po_needed_by_required', { p_on: true }));
    requester = await roleJobUser(service, 'site_supervisor', runId('price-requester'));
    purchaser = await roleJobUser(service, 'procurement_manager', runId('price-purchaser'));
    const project = await admin.from('projects').insert({ name: `Proyek material ${suffix}`, status: 'Internal Project', project_manager_id: purchaser.id }).select('id').single();
    ok('create the project', project);
    projectId = project.data?.id as string;
    purchase = await createProcurementFixture({ status: 'Approved', title: `${title} ${suffix}`, requestedBy: requester.id, projectId, lineName: requestLine });
    requesterDraft = await createProcurementFixture({ status: 'Draft', title: `Permintaan item ${suffix}`, requestedBy: requester.id, projectId, lineName: `Fixture item ${suffix}` });
    ok('set the request needed-by date through its write function', await admin.rpc('set_procurement_needed_by', {
      p_id: requesterDraft.id,
      p_needed_by: '2026-12-31',
    }));
    const purchaseRequest = await service.from('purchase_requests').insert({ procurement_id: requesterDraft.id, pr_number: `PR-${suffix}`, status: 'Draft', date: '2026-11-26' }).select('id').single();
    ok('create the request attachment target', purchaseRequest);
    purchaseRequestId = purchaseRequest.data?.id as string;
    item = await makeItem(admin, suffix);
    warehouse = await makeWarehouse(admin, suffix, 'C', 'central');
    receipt = await postReceive(admin, warehouse.id, item.id, '2', '75432');

    await pinLocale(adminPage, () => adminLocale);
    await signIn(adminPage, 'admin@acme.test');
    await adminPage.goto('/administration/accounting#org-hide-prices');
    const card = adminPage.locator('#org-hide-prices');
    await card.getByRole('button', { name: 'Hide prices from requesters', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Show prices to requesters again' })).toBeVisible();

    await pinLocale(requesterPage, () => requesterLocale);
    await requester.signIn(requesterPage);
    const stockUrl = `/stock?q=${item.code}`;
    const receiptUrl = `/stock/documents/${receipt}`;
    for (const locale of ['en', 'id'] as const) {
      requesterLocale = locale;
      await requesterPage.reload();
      const translatedReason = locale === 'id' ? reason : 'Prices are hidden from requesters.';
      for (const width of [1440, 1024, 390]) {
        await requesterPage.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await requesterPage.goto(`/procurement/${requesterDraft.id}/items`);
        await expect(requesterPage.getByRole('heading', { name: new RegExp(`Permintaan item ${suffix}`) }).first()).toBeVisible({ timeout: 20_000 });
        const itemDescriptionLabel = locale === 'id' ? 'Deskripsi item baru' : 'New item description';
        const itemDescription = requesterPage.getByLabel(itemDescriptionLabel);
        await expect(itemDescription).toBeVisible();
        await expect(requesterPage.getByRole('alert').filter({ hasText: /load this order|memuat tanggal kebutuhan/i })).not.toBeVisible({ timeout: 20_000 });
        if (width === 390) await itemDescription.scrollIntoViewIfNeeded();
        if (locale === 'en') {
          const orderDate = requesterPage.getByLabel('Order needed by');
          const shownDate = requesterPage.getByTestId('order-needed-by-value');
          await expect(orderDate.or(shownDate)).toBeVisible({ timeout: 20_000 });
          if (await orderDate.count()) {
            const expectedDate = await orderDate.getAttribute('type') === 'date' ? '2026-12-31' : '31 Dec 2026';
            await expect(orderDate).toHaveValue(expectedDate);
          } else {
            await expect(shownDate).toHaveText('31 Dec 2026');
          }
        }
        await expect(requesterPage.getByLabel(/new item unit price|unit price|harga satuan/i)).toHaveCount(0, { timeout: 10_000 });
        await capture(requesterPage, 'add-line-form', locale);

        await requesterPage.goto(`/procurement/${purchase.id}/items`);
        await expect(requesterPage.getByRole('heading', { name: new RegExp(`${title} ${suffix}`) }).first()).toBeVisible();
        await expect(requesterPage.getByText(translatedReason, { exact: true })).toHaveCount(1);
        await expect(requesterPage.getByText(requestLine, { exact: true }).first()).toBeVisible();
        await expect(requesterPage.getByText(requestPrice)).toHaveCount(0);
        await capture(requesterPage, 'purchase-record', locale);

        await requesterPage.goto(stockUrl);
        await expect(requesterPage.getByText(item.code, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
        await expect(requesterPage.getByText(translatedReason, { exact: true })).toHaveCount(1, { timeout: 20_000 });
        await expect(requesterPage.getByText(stockPrice)).toHaveCount(0);
        await capture(requesterPage, 'stock-home', locale);

        await requesterPage.goto(receiptUrl);
        await expect(requesterPage.getByText(item.code, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
        await expect(requesterPage.getByText(translatedReason, { exact: true })).toHaveCount(1, { timeout: 20_000 });
        await expect(requesterPage.getByText(stockPrice)).toHaveCount(0);
        await capture(requesterPage, 'stock-receipt', locale);
      }
    }

    // Exercise the requester's own authoring job once after the screenshot matrix is captured.
    requesterLocale = 'en';
    await requesterPage.reload();
    await requesterPage.goto('/procurement/new');
    await requesterPage.getByLabel(/title/i).fill(`Request evidence ${suffix}`);
    await requesterPage.getByLabel('New item description').fill('Sarung tangan kerja');
    await requesterPage.getByLabel('New item quantity').fill('2');
    await requesterPage.getByRole('button', { name: /add line item/i }).click();
    await expect(requesterPage.getByLabel(/new item unit price/i)).toHaveCount(0);
    await expectNoPriceFigures(requesterPage);
    await requesterPage.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(requesterPage).toHaveURL(/\/procurement\/[0-9a-f-]{36}/);
    authoredRequestId = requesterPage.url().match(/\/procurement\/([0-9a-f-]{36})/)?.[1];
    if (!authoredRequestId) throw new Error('The request was not created');
    await requesterPage.getByRole('tab', { name: /^Line items/ }).click();
    await expect(requesterPage.getByTestId('line-items-section').getByText('Sarung tangan kerja', { exact: true })).toBeVisible({ timeout: 20_000 });
    await requesterPage.getByLabel('New item description').fill('Additional material');
    await requesterPage.getByLabel('New item quantity').fill('3');
    await requesterPage.getByRole('button', { name: /add line item/i }).click();
    await expect(requesterPage.getByTestId('line-items-section').getByText('Additional material', { exact: true })).toBeVisible();
    await expectNoPriceFigures(requesterPage);
    await requesterPage.getByRole('button', { name: 'Submit for approval', exact: true }).click();
    await expect(requesterPage.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Requested');
    await requesterPage.goto(`/procurement/${authoredRequestId}/timeline`);
    const attachInput = requesterPage.getByLabel('Attach a file', { exact: true });
    await requesterPage.getByTestId('procurement-timeline-row').filter({ has: attachInput }).locator('summary').click();
    await attachInput.setInputFiles({ name: 'requester-proof.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 requester proof') });
    await expect(requesterPage.getByTestId('procurement-timeline').getByText('requester-proof.pdf', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expectNoPriceFigures(requesterPage);
    await expect(requesterPage.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Requested');
    await expectNoPriceFigures(requesterPage);
    for (const locale of ['en', 'id'] as const) {
      adminLocale = locale;
      await adminPage.reload();
      await adminPage.goto('/administration/accounting#org-hide-prices');
      const card = adminPage.locator('#org-hide-prices');
      await expect(card.getByRole('button')).toHaveCount(1);
      for (const width of [1440, 1024, 390]) {
        await adminPage.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await card.evaluate((element) => element.scrollIntoView({ block: 'center' }));
        await capture(adminPage, 'administration-settings', locale);
      }
    }
    await signIn(purchaserPage, 'finance@acme.test');
    await purchaserPage.goto(`/procurement/${authoredRequestId}`);
    await expect(purchaserPage.getByRole('heading', { name: new RegExp(`Request evidence ${suffix}`) }).first()).toBeVisible({ timeout: 20_000 });
    await expect(purchaserPage.getByText('Requested', { exact: true })).toBeVisible();
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
    if (!neededByRuleWasOn) ok('restore needed-by rule', await admin.rpc('set_po_needed_by_required', { p_on: false }));
    await Promise.all([adminPage.close(), requesterPage.close(), purchaserPage.close()]);
    if (receipt) sqlAsOwner(`delete from stock_ledger where document_id = '${receipt}'; delete from stock_document_lines where document_id = '${receipt}'; delete from stock_documents where id = '${receipt}';`);
    if (warehouse) {
      sqlAsOwner(`delete from stock_balances where warehouse_id = '${warehouse.id}';`);
      ok('remove the warehouse', await service.from('stock_warehouses').delete().eq('id', warehouse.id));
    }
    if (item) ok('remove the stock item', await service.from('stock_items').delete().eq('id', item.id));
    ok('remove the unit', await service.from('stock_units').delete().eq('code', `E2E-U${suffix}`));
    await purchase?.cleanup();
    if (purchaseRequestId) {
      const files = await service.from('purchase_request_files').select('file_path').eq('purchase_request_id', purchaseRequestId);
      if (files.data?.length) await service.storage.from('procurement-files').remove(files.data.flatMap((file) => file.file_path ? [file.file_path] : []));
    }
    await requesterDraft?.cleanup();
    if (authoredRequestId) {
      const records = await service.from('purchase_requests').select('id').eq('procurement_id', authoredRequestId);
      for (const record of records.data ?? []) {
        const files = await service.from('purchase_request_files').select('file_path').eq('purchase_request_id', record.id);
        const paths = (files.data ?? []).flatMap((file) => file.file_path ? [file.file_path] : []);
        if (paths.length) ok('remove authored evidence', await service.storage.from('procurement-files').remove(paths));
      }
      ok('remove authored request', await service.from('procurements').delete().eq('id', authoredRequestId));
    }
    if (projectId) ok('remove the project', await service.from('projects').delete().eq('id', projectId));
    await requester?.cleanup();
    await purchaser?.cleanup();
  }
});
