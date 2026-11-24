// @e2e-isolation: self-isolated — owns its requester, stock unit, item and draft.
import { test, expect } from '@playwright/test';
import { cleanupAll, need, ORG_ID, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test('AC-PSI-001 requester chooses a standard item and saves its identity on a draft line', async ({ page }) => {
  const admin = serviceClient('JOB-standard-item');
  const run = runId('standard');
  const requester = await roleJobUser(admin, 'engineer', run);
  let unitId = '';
  let itemId = '';
  let requestId = '';
  try {
    unitId = need('unit', await admin.from('stock_units').insert({ org_id: ORG_ID, code: run, name: run }).select('id').single()).id;
    itemId = need('item', await admin.from('stock_items').insert({ org_id: ORG_ID, code: run, name: `${run} bolts`, unit_id: unitId }).select('id').single()).id;
    await requester.signIn(page);
    await page.goto('/procurement/new?have=need');
    await page.getByLabel(/^title/i).fill(run);
    await page.getByLabel('New item description').fill(run);
    await page.getByRole('option', { name: new RegExp(`${run} bolts`) }).click();
    await page.getByLabel('New item quantity').fill('2');
    await page.getByLabel('New item unit price').fill('10');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page).toHaveURL(/\/procurement\/[0-9a-f-]{36}/, { timeout: 30000 });
    requestId = page.url().match(/\/procurement\/([0-9a-f-]{36})/)?.[1] ?? '';
    const line = need('saved line', await admin.from('procurement_items').select('stock_item_id,name').eq('procurement_id', requestId).single());
    expect(line.stock_item_id).toBe(itemId);
    expect(line.name).toBe(`${run} bolts`);
  } finally {
    if (requestId) sqlAsOwner(`delete from procurement_create_intents where procurement_id = '${requestId}';`);
    await cleanupAll(admin, [['procurement_items', 'procurement_id', requestId ? [requestId] : []], ['procurements', 'id', requestId ? [requestId] : []], ['stock_items', 'id', itemId ? [itemId] : []], ['stock_units', 'id', unitId ? [unitId] : []]]);
    await requester.cleanup();
  }
});
