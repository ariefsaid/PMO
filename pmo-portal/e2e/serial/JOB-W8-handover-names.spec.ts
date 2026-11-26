// @e2e-isolation: serial — turns the organisation-wide two-step stock transfer mode on for the journey and restores one_step mode and removes all owned fixtures in finally.
/** JOB-W8 — someone accountable at each handover: a storekeeper sends stock, a second storekeeper counts and receives it, and the material
 *  coordinator opens the record and reads both names with their times. */
import { test, expect } from '@playwright/test';
import { ok, runId, serviceClient, sqlAsOwner } from '../support/jobFixtures';
import { visibleToast } from '../helpers';
import { roleJobUser } from '../support/roleJobUser';
import { keeperOf, makeItem, makeWarehouse, postReceive, runSuffix, userClient } from '../support/stockFixture';
import { chooseItem } from '../support/jobStock';

test.setTimeout(240_000);

test('JOB-W8 the material coordinator reads the sender and the receiver, each with a time, on one transfer', async ({ page }) => {
  const svc = serviceClient('JOB-W8');
  const admin = await userClient('admin@acme.test');
  const sfx = runSuffix();
  const senderName = runId('w8-send');
  const receiverName = runId('w8-recv');
  const sender = await roleJobUser(svc, 'storekeeper', senderName);
  const receiver = await roleJobUser(svc, 'storekeeper', receiverName);
  const coordinator = await roleJobUser(svc, 'material_coordinator', runId('w8-mc'));
  let itemId = '';
  let unitId = '';
  const whIds: string[] = [];
  let receiptId = '';
  let transferId = '';
  let modeChanged = false;
  try {
    const item = await makeItem(admin, sfx, 'W8');
    itemId = item.id;
    unitId = (await svc.from('stock_items').select('unit_id').eq('id', item.id).single()).data?.unit_id as string;
    const source = await makeWarehouse(admin, sfx, 'SRC', 'central');
    whIds.push(source.id);
    const dest = await makeWarehouse(admin, sfx, 'DST', 'site');
    whIds.push(dest.id);
    await keeperOf(admin, source.id, sender.id);
    await keeperOf(admin, dest.id, receiver.id);
    receiptId = await postReceive(admin, source.id, item.id, '3', '20');

    expect((await admin.rpc('set_stock_transfer_mode', { p_mode: 'two_step' })).error).toBeNull();
    modeChanged = true;

    // 1. The first storekeeper sends 3 units, addressed to the second.
    await sender.signIn(page);
    await page.goto('/stock/transfers/new');
    await page.getByRole('combobox', { name: /From warehouse/ }).selectOption({ label: `${source.code} - ${source.name}` });
    await page.getByRole('combobox', { name: /To warehouse/ }).selectOption({ label: `${dest.code} - ${dest.name}` });
    await page.getByRole('combobox', { name: /Receiver/ }).selectOption(receiver.id);
    await chooseItem(page, item.code);
    await page.getByLabel(/^Quantity/).fill('3');
    await page.getByRole('button', { name: 'Send stock transfer' }).click();
    const sent = page.getByRole('dialog', { name: 'Send this transfer?' });
    await expect(sent).toBeVisible();
    await sent.getByRole('button', { name: 'Send transfer', exact: true }).click();
    await expect(page.getByText('In transit').first()).toBeVisible({ timeout: 20_000 });
    transferId = page.url().split('/').pop() ?? '';

    // 2. The second storekeeper counts what arrived and receives it.
    await receiver.signIn(page);
    await page.goto(`/stock/transfers/${transferId}`);
    await page.getByLabel('Counted').fill('3');
    await page.getByRole('button', { name: 'Confirm receipt' }).click();
    await expect(visibleToast(page, 'Receipt recorded')).toBeVisible({ timeout: 20_000 });

    // 3. Goal: the material coordinator opens the record and reads both names with their times.
    await coordinator.signIn(page);
    await page.goto(`/stock/transfers/${transferId}`);
    const summary = page.getByRole('region', { name: 'Summary' });
    // The Sent and Received facts each name the person with the day and the time.
    await expect(summary).toContainText(new RegExp(`Sent${senderName} · \\d{1,2} \\p{L}+( \\d{4})? \\d{1,2}[:.]\\d{2}`, 'u'));
    await expect(summary).toContainText(new RegExp(`Received${receiverName} · \\d{1,2} \\p{L}+( \\d{4})? \\d{1,2}[:.]\\d{2}`, 'u'));
  } finally {
    if (transferId) {
      sqlAsOwner(`delete from stock_handover_confirmations where transfer_id = '${transferId}'; delete from stock_transfer_lines where transfer_id = '${transferId}'; delete from stock_transfers where id = '${transferId}';`);
    }
    if (itemId) sqlAsOwner(`delete from stock_ledger where item_id = '${itemId}'; delete from stock_balances where item_id = '${itemId}'; delete from stock_document_lines where item_id = '${itemId}';`);
    if (whIds.length) {
      const list = whIds.map((id) => `'${id}'`).join(',');
      sqlAsOwner(`delete from stock_documents where warehouse_id in (${list}) or to_warehouse_id in (${list})${receiptId ? ` or id = '${receiptId}'` : ''}; delete from stock_warehouse_keepers where warehouse_id in (${list});`);
      ok('locations cleanup', await svc.from('stock_warehouses').delete().in('id', whIds));
    }
    if (modeChanged) await admin.rpc('set_stock_transfer_mode', { p_mode: 'one_step' });
    if (itemId) ok('item cleanup', await svc.from('stock_items').delete().eq('id', itemId));
    if (unitId) ok('unit cleanup', await svc.from('stock_units').delete().eq('id', unitId));
    await sender.cleanup();
    await receiver.cleanup();
    await coordinator.cleanup();
  }
});
