// @e2e-isolation: serial — enables shared receiving, grants buyer ordering, and assigns the seed Engineer storekeeper and buyer jobs; restores all settings and the job.
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { signIn } from '../helpers';
import { buyerTest as test } from '../support/buyerOrdering';
import { serviceClient, need as needFor, ORG_ID, ENGINEER_ID } from '../support/jobJourney';
import { keeperOf, makeItem, makeWarehouse, runSuffix, userClient } from '../support/stockFixture';

test('AC-RGO-012 storekeeper counts blind and buyer sees received and outstanding', async ({ page }) => {
  test.setTimeout(120_000);
  const db = serviceClient('AC-RGO-012');
  const need = needFor('AC-RGO-012');
  const org = need('org', await db.from('organizations').select('default_currency').eq('id', ORG_ID).single());
  const profile = need('profile', await db.from('profiles').select('built_in_role').eq('id', ENGINEER_ID).single());
  const setting = await db.from('order_receiving_settings').select('enabled').eq('org_id', ORG_ID).maybeSingle();
  if (setting.error) throw setting.error;
  const admin = await userClient('admin@acme.test');
  const suffix = runSuffix();
  const po = randomUUID();
  const procurement = randomUUID();
  const line = randomUUID();
  try {
    await db.from('profiles').update({ built_in_role: 'storekeeper' }).eq('id', ENGINEER_ID).throwOnError();
    await admin.rpc('set_order_receiving_enabled', { p_enabled: true }).throwOnError();
    const item = await makeItem(admin, suffix, 'RGO');
    const warehouse = await makeWarehouse(admin, suffix, 'RGO', 'central');
    await keeperOf(admin, warehouse.id);
    await db.from('procurements').insert({ id: procurement, org_id: ORG_ID, title: `Receiving ${suffix}`, status: 'Ordered', currency: org.default_currency, requested_by_id: ENGINEER_ID, total_value: 1000, approved_total_value: 1000 }).throwOnError();
    await db.from('procurement_items').insert({ id: line, org_id: ORG_ID, procurement_id: procurement, name: item.name, quantity: 40, rate: 25 }).throwOnError();
    await db.from('purchase_orders').insert({ id: po, org_id: ORG_ID, procurement_id: procurement, po_number: `RGO-${suffix}`, status: 'Issued', currency: org.default_currency }).throwOnError();
    await admin.rpc('map_order_stock', { p_item: line, p_stock_item: item.id }).throwOnError();

    await signIn(page, 'engineer@acme.test');
    await page.goto(`/stock/new/receive?order=${po}`);
    await page.getByLabel(/^Warehouse/).selectOption(warehouse.id);
    await expect(page.getByText(/Ordered 40/)).toHaveCount(0);
    await expect(page.getByText(/Outstanding/)).toHaveCount(0);
    await page.getByLabel(/^Counted quantity/).fill('37');
    await page.getByRole('button', { name: 'Record receipt', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Record receipt', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: /^Receipt posted$/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Ordered 40/)).toHaveCount(0);

    await db.from('profiles').update({ built_in_role: 'buyer' }).eq('id', ENGINEER_ID).throwOnError();
    await signIn(page, 'engineer@acme.test');
    await page.goto(`/stock/new/receive?order=${po}`);
    await expect(page.getByText('Ordered 40 · Received 37 · Outstanding 3')).toBeVisible({ timeout: 20_000 });
  } finally {
    await db.from('profiles').update({ built_in_role: profile.built_in_role }).eq('id', ENGINEER_ID).throwOnError();
    await admin.rpc('set_order_receiving_enabled', { p_enabled: setting.data?.enabled ?? false }).throwOnError();
    if (!setting.data) await db.from('order_receiving_settings').delete().eq('org_id', ORG_ID).throwOnError();
    // Posted stock is append-only; unique fixture codes permit reruns without editing that history.
  }
});
