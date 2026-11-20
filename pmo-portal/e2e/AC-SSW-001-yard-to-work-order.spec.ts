// @e2e-isolation: self-isolated - unique item, locations, tag, work item and work order; posted ledger is append-only so fixture codes are unique per run.
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { requireServiceRoleKey, signIn } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';
import { makeItem, makeWarehouse, makeWorkItem, postReceive, runSuffix, SEED_PROJECT_ID, SEED_PROJECT_NAME, userClient } from './support/stockFixture';

test.setTimeout(240_000);
const note = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function captures(page: Page, name: string, focus?: Locator) {
  const dir = process.env.SSW_CAPTURE_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (focus) await focus.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(dir, `${name}-${width}.png`), animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function chooseItem(page: Page, code: string) {
  await page.getByRole('combobox', { name: /^Item/ }).click();
  await page.getByRole('combobox', { name: /^(search|cari) /i }).fill(code);
  await page.getByRole('option', { name: new RegExp(code) }).click();
}
async function chooseWorkOrder(page: Page, number: string) {
  const picker = page.getByRole('combobox', { name: 'Work order' });
  await expect(picker).toBeEnabled();
  await picker.click();
  await page.getByRole('combobox', { name: /search work orders/i }).fill(number);
  await page.getByRole('option', { name: new RegExp(number) }).click();
}
async function attachAndPost(page: Page, label: string) {
  await page.getByRole('button', { name: 'Attachments', exact: true }).click();
  await page.getByLabel('Choose file').setInputFiles({ name: 'delivery-note.png', mimeType: 'image/png', buffer: note });
  await page.getByLabel(/Label \(optional\)/).fill(label);
  await page.getByRole('button', { name: 'Upload attachment' }).click();
  await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await confirm.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByText('Posted', { exact: true }).first()).toBeVisible();
}

test('AC-SSW-001 a keeper moves client stock through a yard and staging to a work order with its paper', async ({ page }) => {
  const sfx = runSuffix();
  const tagName = `Client material ${sfx}`;
  const number = `WO-SSW-${sfx}`;
  const workOrderId = randomUUID();
  const admin = await userClient('admin@acme.test');
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-SSW-001 needs the local service-role fixture client');
  const service = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), key, { auth: { persistSession: false } });
  const project = await service.from('projects').select('org_id,currency').eq('id', SEED_PROJECT_ID).single();
  if (project.error) throw project.error;
  const order = await service.from('work_orders').insert({ id: workOrderId, org_id: project.data.org_id, project_id: SEED_PROJECT_ID,
    title: `Site work ${sfx}`, wo_number: number, status: 'Issued', issued_at: new Date().toISOString(),
    order_value: 10000, tax_treatment: 'exclusive', tax_amount: 0, currency: project.data.currency });
  if (order.error) throw order.error;
  const item = await makeItem(admin, sfx, 'FREE');
  const central = await makeWarehouse(admin, sfx, 'CEN', 'central');
  const work = await makeWorkItem(admin, sfx);
  async function location(code: string, kind: 'yard' | 'staging') {
    const res = await admin.from('stock_warehouses').insert({ code: `E2E-${code}${sfx}`, name: `${code} ${sfx}`, kind, project_id: SEED_PROJECT_ID }).select('id,code,name').single();
    if (res.error) throw res.error;
    return res.data;
  }
  const yard = await location('YARD', 'yard');
  const staging = await location('STAGING', 'staging');
  const label = (w: { code: string; name: string }) => `${w.code} - ${w.name}`;

  await signIn(page, 'admin@acme.test');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/stock/setup');
  await page.getByRole('button', { name: 'Manage stock tags' }).click();
  await page.getByLabel(/Tag name/).fill(tagName);
  await page.getByLabel('Zero cost').check();
  await page.getByLabel('Paper required').check();
  await page.getByRole('button', { name: 'Add tag' }).click();
  await expect(page.getByText(tagName, { exact: true })).toBeVisible();
  await page.getByRole('listitem').filter({ hasText: tagName }).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Zero cost')).toBeChecked();
  await expect(page.getByLabel('Paper required')).toBeChecked();
  await captures(page, 'tag-paper-required');
  await page.getByRole('button', { name: 'Manage stock tags' }).click();
  const tag = await admin.from('stock_tags').select('id,zero_cost,paper_required').eq('name', tagName).single();
  if (tag.error) throw tag.error;
  expect(tag.data).toMatchObject({ zero_cost: true, paper_required: true });
  const tagged = await admin.from('stock_items').update({ tag_id: tag.data.id }).eq('id', item.id);
  if (tagged.error) throw tagged.error;
  await postReceive(admin, central.id, item.id, '10', '0');
  // A costed item gives the same report a second, contrasting stock position.
  const purchased = await makeItem(admin, runSuffix(), 'BUY');
  await postReceive(admin, central.id, purchased.id, '8', '4');
  const purchaseTransfer = await admin.rpc('create_stock_document', { p_header: { kind: 'transfer', warehouse_id: central.id, to_warehouse_id: yard.id }, p_lines: [{ item_id: purchased.id, quantity: '4' }], p_post: true });
  if (purchaseTransfer.error) throw purchaseTransfer.error;
  const purchaseAttribution = await admin.rpc('set_cost_attribution', { p_source: 'stock_document', p_ids: [purchaseTransfer.data], p_work_order_id: workOrderId, p_discipline_id: null });
  if (purchaseAttribution.error) throw purchaseAttribution.error;
  const purchaseIssue = await admin.rpc('create_stock_document', { p_header: { kind: 'issue', warehouse_id: yard.id, project_id: SEED_PROJECT_ID }, p_lines: [{ item_id: purchased.id, quantity: '1', boq_item_id: work.id }], p_post: true });
  if (purchaseIssue.error) throw purchaseIssue.error;
  const issueAttribution = await admin.rpc('set_cost_attribution', { p_source: 'stock_document', p_ids: [purchaseIssue.data], p_work_order_id: workOrderId, p_discipline_id: null });
  if (issueAttribution.error) throw issueAttribution.error;


  await page.getByRole('tab', { name: 'Warehouses' }).click();
  await expect(page.getByText(yard.code, { exact: true })).toBeVisible();
  await expect(page.getByText(staging.code, { exact: true })).toBeVisible();
  await captures(page, 'yard-location', page.getByText(yard.code, { exact: true }));
  await captures(page, 'staging-location', page.getByText(staging.code, { exact: true }));

  await page.goto('/stock/new/transfer');
  await page.getByLabel('From warehouse').selectOption({ label: label(central) });
  await page.getByLabel('To warehouse').selectOption({ label: label(yard) });
  await chooseWorkOrder(page, number);
  await chooseItem(page, item.code);
  await page.getByLabel(/^Quantity/).fill('6');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByText('Attach the required paper before posting this transfer.', { exact: true })).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
  await attachAndPost(page, 'Delivery note');
  await page.reload();
  await expect(page.getByText('Posted', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Attachments', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delivery note', exact: true })).toBeVisible();
  await captures(page, 'posted-transfer-paper', page.getByRole('button', { name: 'Delivery note', exact: true }));

  await page.goto('/stock/new/transfer');
  await page.getByLabel('From warehouse').selectOption({ label: label(yard) });
  await page.getByLabel('To warehouse').selectOption({ label: label(staging) });
  await chooseWorkOrder(page, number);
  await chooseItem(page, item.code);
  await page.getByLabel(/^Quantity/).fill('4');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await attachAndPost(page, 'Staging handover');

  await page.goto('/stock/new/issue');
  await page.getByLabel(/^Warehouse/).selectOption({ label: label(staging) });
  await page.getByLabel(/^Project/).selectOption({ label: SEED_PROJECT_NAME });
  await page.getByLabel(/^Work item/).selectOption({ label: `${work.item_code} - ${work.description}` });
  await chooseWorkOrder(page, number);
  await chooseItem(page, item.code);
  await page.getByLabel(/^Quantity/).fill('3');
  await page.getByRole('button', { name: 'Post issue' }).click();
  await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  const balance = await admin.rpc('get_work_order_stock_balance', { p_work_order_id: workOrderId });
  if (balance.error) throw balance.error;
  const rows = balance.data as Array<{ item_code: string; warehouse_code: string; on_site_qty: string; issued_qty: string; issued_value: string }>;
  expect(rows.find((r) => r.item_code === item.code && r.warehouse_code === yard.code)?.on_site_qty).toBe('2');
  expect(rows.find((r) => r.item_code === item.code && r.warehouse_code === staging.code)).toMatchObject({ on_site_qty: '1', issued_qty: '3', issued_value: '0.00' });

  await page.goto(`/projects/${SEED_PROJECT_ID}/contract?wo=${workOrderId}`);
  const card = page.getByTestId(`customer-order-${workOrderId}`);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Stock for this work order' }).click();
  const row = card.getByRole('row').filter({ hasText: staging.code });
  await expect(row).toContainText(tagName);
  await expect(row.getByRole('cell').nth(4)).toContainText('3');
  await expect(row.getByRole('cell').nth(5)).toContainText('1');
  await captures(page, 'work-order-stock-balance', row);
  await captures(page, 'work-order-stock-values', row.getByRole('cell').nth(5));
});
