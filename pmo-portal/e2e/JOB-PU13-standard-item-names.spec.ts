// @e2e-isolation: self-isolated — owns its Site Supervisor login, stock unit and item.
// JOB-PU13 (acceptance 06-procurement-finance-equipment, TC-PFE-13): standard item names. A master item list holds an item;
// the requester (Site Supervisor) types a near-duplicate name on a new purchase request, and the form offers the existing item.
import { test, expect } from '@playwright/test';
import { cleanupAll, need, ORG_ID, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(120_000);

test('JOB-PU13 a near-duplicate item name on a new request offers the existing standard item', async ({ page }) => {
  const admin = serviceClient('JOB-PU13');
  const run = runId('JOBPU13');
  const requester = await roleJobUser(admin, 'site_supervisor', run);
  let unitId = ''; let itemId = '';
  try {
    unitId = need('unit', await admin.from('stock_units').insert({ org_id: ORG_ID, code: `U${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`, name: run }).select('id').single()).id as string;
    itemId = need('item', await admin.from('stock_items').insert({ org_id: ORG_ID, code: run, name: `Portland cement ${run}`, unit_id: unitId }).select('id').single()).id as string;

    await requester.signIn(page);
    await page.goto('/procurement/new?have=need');
    await page.getByLabel(/^title/i).fill(`${run} request`);
    // A near-duplicate: one word misspelt, the rest as in the master list.
    await page.getByLabel('New item description').fill(`Portlnd cement ${run}`);
    const offer = page.getByRole('listbox', { name: 'Standard item suggestions' }).getByRole('option', { name: new RegExp(`Portland cement ${run}`) });
    await expect(offer).toBeVisible({ timeout: 30_000 });
    await offer.click();
    // Choosing it ties the line to the existing item (its code shows, the typed name is replaced).
    await expect(page.getByLabel('New item description')).toHaveValue(`Portland cement ${run}`);
    await expect(page.getByRole('button', { name: 'Clear standard item link' })).toBeVisible();
  } finally {
    await cleanupAll(admin, [['stock_items', 'id', itemId ? [itemId] : []], ['stock_units', 'id', unitId ? [unitId] : []]]);
    await requester.cleanup();
  }
});
