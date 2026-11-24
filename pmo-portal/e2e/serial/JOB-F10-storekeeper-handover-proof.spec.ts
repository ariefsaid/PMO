// @e2e-isolation: serial — enables the organisation-wide two-step stock transfer mode for the run and restores one_step mode and removes all owned rows in finally.
/**
 * JOB-F10 — storekeeper confirms handover proof with goods and recipient photos that persist across reload.
 * A sending storekeeper dispatches a two-step stock transfer from central store to site store; the receiving
 * storekeeper confirms receipt in-app with photos of the goods and recipient; after reload the closed transfer
 * still displays the recorded confirmation and both photos.
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

test('JOB-F10 storekeeper confirms a two-step handover with goods and recipient photos that stay after reload', async ({ page }) => {
  const svc = serviceClient('JOB-F10');
  const admin = await userClient('admin@acme.test');
  const sfx = runSuffix();
  const sender = await roleJobUser(svc, 'storekeeper', runId('f10-send'));
  const receiverRun = runId('f10-recv');
  const receiver = await roleJobUser(svc, 'storekeeper', receiverRun);
  let itemId = '';
  let unitId = '';
  let sourceId = '';
  let destId = '';
  let receiptId = '';
  let transferId = '';
  let modeChanged = false;
  try {
    const item = await makeItem(admin, sfx, 'F10');
    itemId = item.id;
    const itemRow = await svc.from('stock_items').select('unit_id').eq('id', itemId).single();
    unitId = (itemRow.data?.unit_id as string | undefined) ?? '';
    const source = await makeWarehouse(admin, sfx, 'CEN', 'central');
    sourceId = source.id;
    const dest = await makeWarehouse(admin, sfx, 'SITE', 'site');
    destId = dest.id;
    await keeperOf(admin, source.id, sender.id);
    await keeperOf(admin, dest.id, receiver.id);
    receiptId = await postReceive(admin, source.id, item.id, '5', '20');

    const mode = await admin.rpc('set_stock_transfer_mode', { p_mode: 'two_step' });
    expect(mode.error).toBeNull();
    modeChanged = true;

    // 1. Sending storekeeper dispatches 2 units to the site storekeeper.
    await sender.signIn(page);
    await page.goto('/stock/transfers/new');
    await page.getByRole('combobox', { name: /From warehouse/ }).selectOption({ label: `${source.code} - ${source.name}` });
    await page.getByRole('combobox', { name: /To warehouse/ }).selectOption({ label: `${dest.code} - ${dest.name}` });
    await page.getByRole('combobox', { name: /Receiver/ }).selectOption(receiver.id);
    await page.getByRole('combobox', { name: /^Item/ }).click();
    await page.getByRole('combobox', { name: /^(search|cari) /i }).fill(item.code);
    await page.getByRole('option', { name: new RegExp(item.code) }).click();
    await page.getByRole('textbox', { name: /^Quantity/ }).fill('2');
    await page.getByRole('button', { name: 'Send stock transfer' }).click();
    const confirm = page.getByRole('dialog', { name: 'Send this transfer?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Send transfer', exact: true }).click();
    await expect(page.getByText('In transit').first()).toBeVisible({ timeout: 20_000 });
    transferId = page.url().split('/').pop() ?? '';
    expect(transferId).toMatch(/^[0-9a-f-]{36}$/);

    // 2. Receiving storekeeper confirms receipt with both handover proof photos.
    await receiver.signIn(page);
    await page.goto(`/stock/transfers/${transferId}`);
    await page.getByRole('checkbox', { name: 'Confirm the handover in PMO now' }).click();
    await page.getByLabel('Photo of the goods').setInputFiles(photo('goods.jpg'));
    await page.getByLabel('Photo of the person receiving').setInputFiles(photo('person.jpg'));
    await page.getByRole('button', { name: 'Confirm receipt' }).click();
    await expect(page.getByRole('region', { name: 'Summary' })).toContainText('Closed', { timeout: 20_000 });

    // 3. Goal: after reload, handover confirmation and both proof photos remain visible on the closed transfer.
    await page.reload();
    await expect(page.getByRole('region', { name: 'Summary' })).toContainText('Closed', { timeout: 20_000 });
    const recorded = page.getByRole('region', { name: 'Handover confirmations' });
    await expect(recorded).toContainText(receiverRun);
    const photos = recorded.getByTestId('handover-photos');
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
        delete from stock_documents where warehouse_id in (${list}) or to_warehouse_id in (${list})${receiptId ? ` or id = '${receiptId}'` : ''};
        delete from stock_warehouse_keepers where warehouse_id in (${list});
      `);
      ok('warehouses cleanup', await svc.from('stock_warehouses').delete().in('id', whIds));
    }
    if (modeChanged) await admin.rpc('set_stock_transfer_mode', { p_mode: 'one_step' });
    if (itemId) ok('item cleanup', await svc.from('stock_items').delete().eq('id', itemId));
    if (unitId) ok('unit cleanup', await svc.from('stock_units').delete().eq('id', unitId));
    await sender.cleanup();
    await receiver.cleanup();
  }
});
