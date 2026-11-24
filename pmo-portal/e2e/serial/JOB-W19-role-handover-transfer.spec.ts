// @e2e-isolation: serial — enables the organisation-wide two-step stock transfer mode for the journey and restores one_step mode and removes all owned fixtures in finally.
/**
 * JOB-W19 — two-step transfer handover to a field receiver with guest signature and photos.
 * A storekeeper sends stock from the central store to a site store addressed to a field user;
 * the field user signs in on a phone, opens the delivery from /my, confirms receipt with a guest signer
 * and photos of the goods and recipient, and verifies the closed transfer carries the handover proof.
 */
import { test, expect } from '@playwright/test';
import { ok, runId, serviceClient, sqlAsOwner } from '../support/jobFixtures';
import { roleJobUser } from '../support/roleJobUser';
import { keeperOf, makeItem, makeWarehouse, postReceive, runSuffix, userClient } from '../support/stockFixture';

test.setTimeout(240_000);

const JPG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);
const photo = (name: string) => ({ name, mimeType: 'image/jpeg', buffer: JPG });

test('JOB-W19 storekeeper sends a transfer to a field user who confirms handover on a phone with guest signer and photos', async ({ page }) => {
  const svc = serviceClient('JOB-W19');
  const admin = await userClient('admin@acme.test');
  const sfx = runSuffix();
  const storekeeper = await roleJobUser(svc, 'storekeeper', runId('w19-sk'));
  const receiver = await roleJobUser(svc, 'field_user', runId('w19-fu'));
  let itemId = '';
  let unitId = '';
  let sourceId = '';
  let destId = '';
  let receiptId = '';
  let transferId = '';
  let modeChanged = false;
  try {
    const item = await makeItem(admin, sfx, 'W19');
    itemId = item.id;
    const itemRow = await svc.from('stock_items').select('unit_id').eq('id', itemId).single();
    unitId = (itemRow.data?.unit_id as string | undefined) ?? '';
    const source = await makeWarehouse(admin, sfx, 'SRC', 'central');
    sourceId = source.id;
    const dest = await makeWarehouse(admin, sfx, 'DST', 'site');
    destId = dest.id;
    await keeperOf(admin, source.id, storekeeper.id);
    receiptId = await postReceive(admin, source.id, item.id, '5', '20');

    const mode = await admin.rpc('set_stock_transfer_mode', { p_mode: 'two_step' });
    expect(mode.error).toBeNull();
    modeChanged = true;

    // 1. Storekeeper sends 1 unit addressed to the field user.
    await storekeeper.signIn(page);
    await page.goto('/stock/transfers/new');
    await page.getByRole('combobox', { name: /From warehouse/ }).selectOption({ label: `${source.code} - ${source.name}` });
    await page.getByRole('combobox', { name: /To warehouse/ }).selectOption({ label: `${dest.code} - ${dest.name}` });
    await page.getByRole('combobox', { name: /Receiver/ }).selectOption(receiver.id);
    await page.getByRole('combobox', { name: /^Item/ }).click();
    await page.getByRole('combobox', { name: /^(search|cari) /i }).fill(item.code);
    await page.getByRole('option', { name: new RegExp(item.code) }).click();
    await page.getByRole('textbox', { name: /^Quantity/ }).fill('1');
    await page.getByRole('button', { name: 'Send stock transfer' }).click();
    const confirm = page.getByRole('dialog', { name: 'Send this transfer?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Send transfer', exact: true }).click();
    await expect(page.getByText('In transit').first()).toBeVisible({ timeout: 20_000 });
    transferId = page.url().split('/').pop() ?? '';
    expect(transferId).toMatch(/^[0-9a-f-]{36}$/);

    // 2. Field user signs in on a phone, lands on /my, and opens the delivery addressed to them.
    await page.setViewportSize({ width: 390, height: 844 });
    await receiver.signIn(page);
    await expect(page).toHaveURL(/\/my$/, { timeout: 20_000 });
    const deliveryLink = page.locator(`#my-deliveries a[href="/stock/transfers/${transferId}"]`);
    await expect(deliveryLink).toBeVisible({ timeout: 20_000 });
    await deliveryLink.click();
    await expect(page).toHaveURL(new RegExp(`/stock/transfers/${transferId}$`), { timeout: 20_000 });

    // 3. Field user confirms handover in-app with a guest signer and both photos.
    await page.getByRole('checkbox', { name: 'Confirm the handover in PMO now' }).click();
    await page.getByRole('checkbox', { name: 'The person signing has no account' }).click();
    await page.getByLabel(/Name of the person signing/).fill('Site Receiver');
    await page.getByLabel('Photo of the goods').setInputFiles(photo('goods.jpg'));
    await page.getByLabel('Photo of the person receiving').setInputFiles(photo('person.jpg'));
    await page.getByRole('button', { name: 'Confirm receipt' }).click();

    // 4. Goal: transfer closes with guest signer and both handover photos visible.
    await expect(page.getByText('Closed', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Site Receiver \(no account\)/)).toBeVisible();
    const photos = page.getByTestId('handover-photos');
    await expect(photos.getByAltText('Photo of the goods')).toBeVisible({ timeout: 20_000 });
    await expect(photos.getByAltText('Photo of the person receiving')).toBeVisible({ timeout: 20_000 });
  } finally {
    if (transferId) {
      sqlAsOwner(`
        delete from stock_handover_confirmations where transfer_id = '${transferId}';
        delete from stock_transfer_lines where transfer_id = '${transferId}';
        delete from stock_transfers where id = '${transferId}';
      `);
    }
    if (itemId) {
      sqlAsOwner(`
        delete from stock_ledger where item_id = '${itemId}';
        delete from stock_balances where item_id = '${itemId}';
        delete from stock_document_lines where item_id = '${itemId}';
      `);
    }
    const whIds = [sourceId, destId].filter(Boolean);
    if (whIds.length) {
      const list = whIds.map((id) => `'${id}'`).join(',');
      sqlAsOwner(`
        delete from stock_documents where warehouse_id in (${list})${receiptId ? ` or id = '${receiptId}'` : ''};
        delete from stock_warehouse_keepers where warehouse_id in (${list});
      `);
      ok('warehouses cleanup', await svc.from('stock_warehouses').delete().in('id', whIds));
    }
    if (modeChanged) await admin.rpc('set_stock_transfer_mode', { p_mode: 'one_step' });
    if (itemId) ok('item cleanup', await svc.from('stock_items').delete().eq('id', itemId));
    if (unitId) ok('unit cleanup', await svc.from('stock_units').delete().eq('id', unitId));
    await storekeeper.cleanup();
    await receiver.cleanup();
  }
});
