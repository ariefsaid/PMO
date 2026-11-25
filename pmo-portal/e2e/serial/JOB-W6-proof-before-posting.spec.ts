// @e2e-isolation: serial — sets the organisation-wide two-step transfer mode and proof timing, which every stock journey reads; both are restored to one_step / before_posting in finally.
/** JOB-W6 — proof before posting, and a list of what is missing: under "before posting" the receiver cannot confirm a paper-tagged delivery
 *  without the signed paper; once proof may follow, the delivery confirmed without it waits on the stock home's "Waiting for proof" list and
 *  the one confirmed with the paper does not. */
import { test, expect } from '@playwright/test';
import { need, ok, runId, serviceClient, sqlAsOwner } from '../support/jobFixtures';
import { roleJobUser } from '../support/roleJobUser';
import { keeperOf, makeWarehouse, postReceive, runSuffix, userClient } from '../support/stockFixture';
import { chooseItem } from '../support/jobStock';

test.setTimeout(300_000);

const JPG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);
const photo = (name: string) => ({ name, mimeType: 'image/jpeg', buffer: JPG });

test('JOB-W6 the receiver is refused without the signed paper, and later the one without it is the one on the waiting list', async ({ page }) => {
  const svc = serviceClient('JOB-W6');
  const admin = await userClient('admin@acme.test');
  const sfx = runSuffix();
  const sender = await roleJobUser(svc, 'storekeeper', runId('w6-send'));
  const receiver = await roleJobUser(svc, 'storekeeper', runId('w6-recv'));
  let itemId = '';
  let unitId = '';
  let tagId = '';
  const whIds: string[] = [];
  let receiptId = '';
  const transferIds: string[] = [];
  let modeChanged = false;
  let timingChanged = false;
  try {
    const unit = need('unit', await admin.from('stock_units').insert({ code: `W6U${sfx}`, name: `Unit ${sfx}`, whole_only: true }).select('id').single());
    unitId = unit.id;
    // A stock tag that requires the signed paper.
    tagId = need('tag', await admin.from('stock_tags').insert({ name: `Signed paper ${sfx}`, proof_required: 'paper', zero_cost: true }).select('id').single()).id;
    const item = need('item', await admin.from('stock_items').insert({ code: `E2E-W6${sfx}`, name: `E2E item ${sfx}`, unit_id: unit.id, tag_id: tagId }).select('id, code').single());
    itemId = item.id;
    const source = await makeWarehouse(admin, sfx, 'SRC', 'central');
    whIds.push(source.id);
    const dest = await makeWarehouse(admin, sfx, 'DST', 'site');
    whIds.push(dest.id);
    await keeperOf(admin, source.id, sender.id);
    await keeperOf(admin, dest.id, receiver.id);
    receiptId = await postReceive(admin, source.id, item.id, '10', '0');

    expect((await admin.rpc('set_stock_transfer_mode', { p_mode: 'two_step' })).error).toBeNull();
    modeChanged = true;
    expect((await admin.rpc('set_stock_proof_timing', { p_timing: 'before_posting' })).error).toBeNull();
    timingChanged = true;

    const send = async () => {
      await sender.signIn(page);
      await page.goto('/stock/transfers/new');
      await page.getByRole('combobox', { name: /From warehouse/ }).selectOption({ label: `${source.code} - ${source.name}` });
      await page.getByRole('combobox', { name: /To warehouse/ }).selectOption({ label: `${dest.code} - ${dest.name}` });
      await page.getByRole('combobox', { name: /Receiver/ }).selectOption(receiver.id);
      await chooseItem(page, item.code);
      await page.getByLabel(/^Quantity/).fill('2');
      await page.getByRole('button', { name: 'Send stock transfer' }).click();
      const dialog = page.getByRole('dialog', { name: 'Send this transfer?' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Send transfer', exact: true }).click();
      await expect(page.getByText('In transit').first()).toBeVisible({ timeout: 20_000 });
      return page.url().split('/').pop() ?? '';
    };

    // 1. Before posting: the receiver tries to confirm receipt without the signed paper — it is refused.
    transferIds.push(await send());
    await receiver.signIn(page);
    await page.goto(`/stock/transfers/${transferIds[0]}`);
    await expect(page.getByText('Proof needed before receiving: Signed paper.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Confirm receipt' })).toBeDisabled();

    // 2. Once proof may follow, that delivery is received without the paper and waits for it…
    expect((await admin.rpc('set_stock_proof_timing', { p_timing: 'may_follow' })).error).toBeNull();
    await page.reload();
    await page.getByLabel('Counted').fill('2');
    await page.getByRole('button', { name: 'Confirm receipt' }).click();
    await expect(page.getByText('Receipt recorded')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('region', { name: 'Summary' })).toContainText('Proof outstanding');

    // 3. …and a second delivery, confirmed with the paper, is complete.
    await sender.signIn(page);
    transferIds.push(await send());
    await receiver.signIn(page);
    await page.goto(`/stock/transfers/${transferIds[1]}`);
    await page.getByLabel('Counted').fill('2');
    await page.getByRole('checkbox', { name: 'Confirm the handover in PMO now' }).click();
    await page.getByLabel('Kind of proof').selectOption({ label: 'Photo of the signed paper' });
    await page.getByLabel('Photo of the signed paper').setInputFiles(photo('signed.jpg'));
    await page.getByRole('button', { name: 'Confirm receipt' }).click();
    await expect(page.getByText('Receipt recorded')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('region', { name: 'Summary' })).toContainText('Proof complete');

    // 4. Goal: the stock home lists exactly the movement awaiting paper, never the complete one.
    const numbers = new Map<string, string>();
    for (const id of transferIds) numbers.set(id, need('number', await svc.from('stock_transfers').select('number').eq('id', id).single()).number);
    await page.goto('/stock');
    const chase = page.getByRole('region', { name: /Waiting for proof/ });
    await expect(chase).toContainText(numbers.get(transferIds[0])!, { timeout: 20_000 });
    await expect(chase).not.toContainText(numbers.get(transferIds[1])!);
  } finally {
    if (transferIds.length) {
      const list = transferIds.map((id) => `'${id}'`).join(',');
      sqlAsOwner(`delete from stock_handover_confirmations where transfer_id in (${list}); delete from stock_transfer_lines where transfer_id in (${list}); delete from stock_transfers where id in (${list});`);
    }
    if (itemId) sqlAsOwner(`delete from stock_ledger where item_id = '${itemId}'; delete from stock_balances where item_id = '${itemId}'; delete from stock_document_lines where item_id = '${itemId}';`);
    if (whIds.length) {
      const list = whIds.map((id) => `'${id}'`).join(',');
      sqlAsOwner(`delete from stock_documents where warehouse_id in (${list}) or to_warehouse_id in (${list})${receiptId ? ` or id = '${receiptId}'` : ''}; delete from stock_warehouse_keepers where warehouse_id in (${list});`);
      ok('locations cleanup', await svc.from('stock_warehouses').delete().in('id', whIds));
    }
    if (timingChanged) await admin.rpc('set_stock_proof_timing', { p_timing: 'before_posting' });
    if (modeChanged) await admin.rpc('set_stock_transfer_mode', { p_mode: 'one_step' });
    if (itemId) ok('item cleanup', await svc.from('stock_items').delete().eq('id', itemId));
    if (tagId) ok('tag cleanup', await svc.from('stock_tags').delete().eq('id', tagId));
    if (unitId) ok('unit cleanup', await svc.from('stock_units').delete().eq('id', unitId));
    await sender.cleanup();
    await receiver.cleanup();
  }
});
