// @e2e-isolation: self-isolated — unique tag, item, central warehouse and work order per run; the posted ledger is append-only so codes carry a per-run suffix.
/** JOB-W1 — client-supplied material arrives with its picking slip: it is received into the warehouse against a work order with the slip attached, stock rises at zero cost, tagged to that work order. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { serviceClient } from './support/jobFixtures';
import { makeItem, makeWarehouse, runSuffix, userClient, SEED_PROJECT_ID } from './support/stockFixture';
import { chooseItem, chooseWorkOrder, confirmPost, label } from './support/jobStock';

test.setTimeout(240_000);
const slip = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('JOB-W1 client material received against a work order with its slip lands at zero cost under the tag', async ({ page }) => {
  const sfx = runSuffix();
  const tagName = `Client material ${sfx}`;
  const number = `WO-W1-${sfx}`;
  const workOrderId = randomUUID();
  const admin = await userClient('admin@acme.test');
  const service = serviceClient();
  const project = await service.from('projects').select('org_id,currency').eq('id', SEED_PROJECT_ID).single();
  if (project.error) throw project.error;
  const wo = await service.from('work_orders').insert({ id: workOrderId, org_id: project.data.org_id, project_id: SEED_PROJECT_ID,
    title: `Client supplied work ${sfx}`, wo_number: number, status: 'Issued', issued_at: new Date().toISOString(),
    order_value: 10000, tax_treatment: 'exclusive', tax_amount: 0, currency: project.data.currency });
  if (wo.error) throw wo.error;
  const item = await makeItem(admin, sfx, 'CLI');
  const central = await makeWarehouse(admin, sfx, 'CEN', 'central');

  // The org's "client material" tag: zero cost, paper required.
  await signIn(page, 'admin@acme.test');
  await page.goto('/stock/setup');
  await page.getByRole('button', { name: 'Manage stock tags' }).click();
  await page.getByLabel(/Tag name/).fill(tagName);
  await page.getByLabel('Zero cost').check();
  await page.getByLabel('Paper required').check();
  await page.getByRole('button', { name: 'Add tag' }).click();
  await expect(page.getByText(tagName, { exact: true })).toBeVisible();
  const tag = await admin.from('stock_tags').select('id').eq('name', tagName).single();
  if (tag.error) throw tag.error;
  const tagged = await admin.from('stock_items').update({ tag_id: tag.data.id }).eq('id', item.id);
  if (tagged.error) throw tagged.error;

  // Receive 8 against the work order, attach the slip, post.
  await page.goto('/stock/new/receive');
  await page.getByLabel(/^Warehouse/).selectOption({ label: label(central) });
  await chooseWorkOrder(page, number);
  await chooseItem(page, item.code);
  await page.getByLabel(/^Quantity/).fill('8');
  const cost = page.getByLabel(/^Unit cost/);
  if (await cost.isVisible().catch(() => false) && !(await cost.inputValue())) await cost.fill('0');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await page.getByRole('button', { name: 'Attachments', exact: true }).click();
  await page.getByLabel('Choose file').setInputFiles({ name: 'picking-slip.png', mimeType: 'image/png', buffer: slip });
  await page.getByLabel(/Label \(optional\)/).fill('Picking slip');
  await page.getByRole('button', { name: 'Upload attachment' }).click();
  await expect(page.getByRole('button', { name: 'Picking slip', exact: true })).toBeVisible();
  await confirmPost(page);

  // The work order shows 8 on site at zero value, under the tag.
  await page.goto(`/projects/${SEED_PROJECT_ID}/contract?wo=${workOrderId}`);
  const card = page.getByTestId(`customer-order-${workOrderId}`);
  await card.getByRole('button', { name: 'Stock for this work order' }).click();
  const row = card.getByRole('row').filter({ hasText: central.code });
  await expect(row).toContainText(tagName);
  await expect(row).toContainText('8');
  await expect(row).not.toContainText(/[1-9]\d*[.,]\d{2}\s*$/);
});
