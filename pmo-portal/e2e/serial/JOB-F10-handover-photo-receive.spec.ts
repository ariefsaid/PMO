// @e2e-isolation: serial — a receipt with a handover photo runs on the organisation's two-step transfer mode (one setting for the whole org); the spec reads it, turns it on, and puts it back in finally.
/**
 * JOB-F10 — proof of handover (#2690). Material is sent to the site; the storekeeper confirms receipt and attaches a photo of
 * the handover, like a courier's proof of delivery.
 * Goal oracle: the transfer record keeps that handover photo — after a reload it is still shown on the received transfer.
 */
import { test, expect } from '@playwright/test';
import { visibleToast } from '../helpers';
import { serviceClient } from '../support/jobFixtures';
import { roleJobUser } from '../support/roleJobUser';
import { sendTransfer, setTransferMode, transferMode } from '../support/transferJourney';

test.setTimeout(240_000);

const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const keeperName = `f10-keeper-${Date.now()}`;

test('JOB-F10 the storekeeper confirms receipt with a handover photo and the transfer keeps it', async ({ page }) => {
  const svc = serviceClient('JOB-F10');
  const previous = await transferMode(svc);
  const keeper = await roleJobUser(svc, 'storekeeper', keeperName);
  try {
    await setTransferMode('two_step');
    const fx = await sendTransfer(svc, keeper.id, '10');

    // 1. Storekeeper: Stock → Transfers, opens the transfer addressed to them.
    await keeper.signIn(page);
    await page.goto('/stock/transfers');
    await page.locator(`a[href="/stock/transfers/${fx.transferId}"]`).click();
    await expect(page.getByRole('heading', { name: new RegExp(fx.number) })).toBeVisible({ timeout: 20_000 });

    // 2. Confirm receipt and attach the handover photos on the spot.
    await page.getByLabel('Confirm the handover in PMO now').check();
    await page.getByLabel('Photo of the goods').setInputFiles({ name: 'goods.png', mimeType: 'image/png', buffer: photo });
    await page.getByLabel('Photo of the person receiving').setInputFiles({ name: 'person.png', mimeType: 'image/png', buffer: photo });
    await page.getByRole('button', { name: 'Confirm receipt' }).click();
    await expect(visibleToast(page, 'Receipt recorded')).toBeVisible({ timeout: 30_000 });

    // Goal: the transfer record shows the photo of that handover, and still does after a reload.
    const recorded = page.getByRole('region', { name: 'Handover confirmations' });
    await expect(recorded).toContainText(keeperName, { timeout: 20_000 });
    await expect(recorded).toContainText('Receiving');
    await expect(recorded.getByTestId('handover-photos')).toBeVisible({ timeout: 20_000 });
    await expect(recorded.getByAltText('Photo of the goods')).toBeVisible();
    await page.reload();
    const afterReload = page.getByRole('region', { name: 'Handover confirmations' });
    await expect(afterReload.getByAltText('Photo of the goods')).toBeVisible({ timeout: 20_000 });
  } finally {
    if (previous !== 'two_step') await setTransferMode(previous);
    await keeper.cleanup();
  }
});
