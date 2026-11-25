// @e2e-isolation: self-isolated — its own uniquely named tag and item codes, and stock received for them; the append-only ledger and item rows stay (unique per run, so a rerun never trips on them).
// JOB-PC25 (billable material): stock carries a "Billable" tag on some items. Goal: the storekeeper filters the stock list by that
// tag and sees only the tagged items.
import { test, expect } from '@playwright/test';
import { ORG_ID, need, ok, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { makeItem, runSuffix, userClient } from './support/stockFixture';

test.setTimeout(180_000);

test('JOB-PC25 a storekeeper filters stock by the billable tag and only the tagged items show', async ({ page }) => {
  const admin = serviceClient('JOB-PC25');
  const run = runId('JOBPC25');
  const sfx = runSuffix();
  const storekeeper = await roleJobUser(admin, 'storekeeper', `${run}-sk`);
  const tagName = `Billable ${run}`;

  try {
    const shop = await userClient('admin@acme.test');
    const central = need('central warehouse', await admin.from('stock_warehouses').select('id').eq('org_id', ORG_ID).eq('kind', 'central').eq('code', 'CENTRAL').single());
    const tagged = need('tag', await admin.from('stock_tags').insert({ org_id: ORG_ID, name: tagName }).select('id').single());
    const items = [];
    for (const [i, tagId] of [[1, tagged.id], [2, tagged.id], [3, null]] as const) {
      const item = await makeItem(admin, `${sfx}-${i}`, `B${i}`);
      if (tagId) ok('tagged item', await admin.from('stock_items').update({ tag_id: tagId }).eq('id', item.id));
      ok('receive', await shop.rpc('create_stock_document', {
        p_header: { kind: 'receive', warehouse_id: central.id },
        p_lines: [{ item_id: item.id, quantity: '5', unit_cost: '25' }],
        p_post: true, p_client_request_id: crypto.randomUUID(),
      }));
      items.push(item);
    }

    // The storekeeper opens the stock list and filters it by the billable tag.
    await storekeeper.signIn(page);
    await page.goto('/stock');
    for (const item of items) await expect(page.getByText(item.code)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('combobox', { name: 'Tag' }).selectOption({ label: tagName });

    await expect(page.getByText(items[0].code)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(items[1].code)).toBeVisible();
    await expect(page.getByText(items[2].code)).toHaveCount(0);
  } finally {
    await admin.from('stock_tags').update({ archived_at: new Date().toISOString() }).eq('org_id', ORG_ID).eq('name', tagName);
    await storekeeper.cleanup();
  }
});
