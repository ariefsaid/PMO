// @e2e-isolation: serial — turns the organisation-wide two-step stock transfer mode on for the journey and restores one_step mode and removes all owned fixtures in finally.
/** JOB-W18 — sent, then received with a count: a storekeeper sends 10, the receiving storekeeper counts 8, accepts 6 and rejects 2 with a reason,
 *  and the transfer shows the sent, counted and rejected quantities. */
import { test, expect } from '@playwright/test';
import { ok, runId, serviceClient, sqlAsOwner } from '../support/jobFixtures';
import { visibleToast } from '../helpers';
import { roleJobUser } from '../support/roleJobUser';
import { keeperOf, makeItem, makeWarehouse, postReceive, runSuffix, userClient } from '../support/stockFixture';
import { chooseItem } from '../support/jobStock';

test.setTimeout(240_000);

test('JOB-W18 the receiver counts less and rejects part, and the transfer shows sent, counted and rejected', async ({ page }) => {
  const svc = serviceClient('JOB-W18');
  const admin = await userClient('admin@acme.test');
  const sfx = runSuffix();
  const sender = await roleJobUser(svc, 'storekeeper', runId('w18-send'));
  const receiver = await roleJobUser(svc, 'storekeeper', runId('w18-recv'));
  let itemId = '';
  let unitId = '';
  const whIds: string[] = [];
  let receiptId = '';
  let transferId = '';
  let modeChanged = false;
  try {
    const item = await makeItem(admin, sfx, 'W18');
    itemId = item.id;
    unitId = (await svc.from('stock_items').select('unit_id').eq('id', item.id).single()).data?.unit_id as string;
    const source = await makeWarehouse(admin, sfx, 'SRC', 'central');
    whIds.push(source.id);
    const dest = await makeWarehouse(admin, sfx, 'DST', 'site');
    whIds.push(dest.id);
    await keeperOf(admin, source.id, sender.id);
    await keeperOf(admin, dest.id, receiver.id);
    receiptId = await postReceive(admin, source.id, item.id, '10', '20');

    expect((await admin.rpc('set_stock_transfer_mode', { p_mode: 'two_step' })).error).toBeNull();
    modeChanged = true;

    // 1. Storekeeper sends 10 to the site, addressed to the receiving storekeeper.
    await sender.signIn(page);
    await page.goto('/stock/transfers/new');
    await page.getByRole('combobox', { name: /From warehouse/ }).selectOption({ label: `${source.code} - ${source.name}` });
    await page.getByRole('combobox', { name: /To warehouse/ }).selectOption({ label: `${dest.code} - ${dest.name}` });
    await page.getByRole('combobox', { name: /Receiver/ }).selectOption(receiver.id);
    await chooseItem(page, item.code);
    await page.getByLabel(/^Quantity/).fill('10');
    await page.getByRole('button', { name: 'Send stock transfer' }).click();
    const sent = page.getByRole('dialog', { name: 'Send this transfer?' });
    await expect(sent).toBeVisible();
    await sent.getByRole('button', { name: 'Send transfer', exact: true }).click();
    await expect(page.getByText('In transit').first()).toBeVisible({ timeout: 20_000 });
    transferId = page.url().split('/').pop() ?? '';

    // 2. The receiver counts 8, accepts 6 and rejects 2 with a reason.
    await receiver.signIn(page);
    await page.goto(`/stock/transfers/${transferId}`);
    await page.getByRole('textbox', { name: 'Counted' }).fill('8');
    await page.getByRole('textbox', { name: 'Accepted' }).fill('6');
    await page.getByLabel('Why is some rejected?').fill('Two were crushed in the truck');
    await page.getByRole('button', { name: 'Confirm receipt' }).click();
    await expect(visibleToast(page, 'Receipt recorded')).toBeVisible({ timeout: 20_000 });

    // 3. Goal: the transfer shows the sent, counted and rejected quantities.
    // The lines are one table: Sent, Counted, Accepted, Rejected and Note each in their own cell.
    const cells = page.getByRole('region', { name: 'Lines' }).getByRole('row').filter({ hasText: item.code }).getByRole('cell');
    await expect(cells.nth(0)).toHaveText(/^10\b/);
    await expect(cells.nth(1)).toHaveText(/^8\b/);
    await expect(cells.nth(3)).toHaveText(/^2\b/);
    await expect(cells.nth(4)).toHaveText('Two were crushed in the truck');
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
  }
});
