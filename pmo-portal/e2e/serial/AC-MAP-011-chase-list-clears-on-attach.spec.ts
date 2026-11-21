// @e2e-isolation: serial — flips the organisation-wide proof timing setting for the run and restores it; unique item, tag and warehouses per run.
/** AC-MAP-011 — with proof allowed to follow, a transfer posts without its signed paper and appears on the stock home's "Waiting for proof" list;
 *  the keeper follows the row, attaches the paper, and the movement leaves the list. */
import { test, expect } from '@playwright/test';
import { signIn } from '../helpers';
import { makeItem, makeWarehouse, postReceive, runSuffix, userClient } from '../support/stockFixture';
import { chooseItem, label } from '../support/jobStock';

test.setTimeout(150_000);
const paper = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('AC-MAP-011 a transfer posted without its paper is listed, and leaves the list once the paper is attached', async ({ page }) => {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const timing = await admin.rpc('set_stock_proof_timing', { p_timing: 'may_follow' });
  if (timing.error) throw timing.error;
  try {
    const tag = await admin.from('stock_tags').insert({ name: `E2E paper ${sfx}`, zero_cost: true, paper_required: true }).select('id').single();
    if (tag.error) throw tag.error;
    const item = await makeItem(admin, sfx, 'P');
    const tagged = await admin.from('stock_items').update({ tag_id: tag.data.id }).eq('id', item.id);
    if (tagged.error) throw tagged.error;
    const from = await makeWarehouse(admin, sfx, 'PF', 'site');
    const to = await makeWarehouse(admin, sfx, 'PT', 'site');
    await postReceive(admin, from.id, item.id, '10', '0');

    await signIn(page, 'admin@acme.test');
    await page.goto('/stock/new/transfer');
    await page.getByLabel('From warehouse').selectOption({ label: label(from) });
    await page.getByLabel('To warehouse').selectOption({ label: label(to) });
    await chooseItem(page, item.code);
    await page.getByLabel(/^Quantity/).fill('4');
    await page.getByRole('button', { name: 'Post transfer' }).click();
    await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const documentPath = new URL(page.url()).pathname;

    await page.goto('/stock');
    const card = page.getByRole('region', { name: /^Waiting for proof/ });
    await expect(card).toBeVisible();
    const link = card.locator(`a[href="${documentPath}"]`);
    await expect(link).toContainText('Signed paper');
    await link.click();
    await expect(page).toHaveURL(documentPath);

    await page.getByRole('button', { name: 'Attachments', exact: true }).click();
    await page.getByLabel('Choose file').setInputFiles({ name: 'signed-paper.png', mimeType: 'image/png', buffer: paper });
    await page.getByRole('button', { name: 'Upload attachment' }).click();
    await expect(page.getByRole('button', { name: 'signed-paper.png', exact: true })).toBeVisible();

    await page.goto('/stock');
    await expect(page.getByRole('heading', { name: 'On hand' }).first()).toBeVisible();
    await expect(page.locator(`a[href="${documentPath}"]`)).toHaveCount(0);
  } finally {
    await admin.rpc('set_stock_proof_timing', { p_timing: 'before_posting' });
  }
});
