// @e2e-isolation: self-isolated — unique item and locations per run; the posted stock ledger is append-only, so every code carries a per-run suffix.
/**
 * JOB-F10 — proof of handover photos (#2523). The material person moves stock to a site location and attaches a photo of the
 * handover before posting.
 * Goal oracle: after reload the posted transfer shows the photo among its attachments.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { makeItem, makeWarehouse, postReceive, runSuffix, userClient } from './support/stockFixture';
import { chooseItem, whLabel } from './support/stockUi';

test.setTimeout(180_000);
const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('JOB-F10 a handover photo attached to a transfer stays on the posted record', async ({ page }) => {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const item = await makeItem(admin, sfx, 'PIPE');
  const central = await makeWarehouse(admin, sfx, 'CEN', 'central');
  const site = await makeWarehouse(admin, sfx, 'SITE', 'site');
  await postReceive(admin, central.id, item.id, '10');

  await signIn(page, 'admin@acme.test');
  await page.goto('/stock/new/transfer');
  await page.getByLabel('From warehouse').selectOption({ label: whLabel(central) });
  await page.getByLabel('To warehouse').selectOption({ label: whLabel(site) });
  await chooseItem(page, item.code);
  await page.getByLabel(/^Quantity/).fill('10');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  await page.getByRole('button', { name: 'Attachments', exact: true }).click();
  await page.getByLabel('Choose file').setInputFiles({ name: 'handover.png', mimeType: 'image/png', buffer: photo });
  await page.getByLabel(/Label \(optional\)/).fill('Unloading photo');
  await page.getByRole('button', { name: 'Upload attachment' }).click();
  await expect(page.getByRole('button', { name: 'Unloading photo', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByText('Posted', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  await page.reload();
  await page.getByRole('button', { name: 'Attachments', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unloading photo', exact: true })).toBeVisible({ timeout: 20_000 });
});
