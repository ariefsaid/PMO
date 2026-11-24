// @e2e-isolation: serial — exercises the org-wide price-aware reader with prices hidden, restoring the prior setting.
import { test, expect } from '@playwright/test';
import { moneyJobRole } from '../support/moneyJobRole';
import { serviceClient, need, ok, ORG_ID } from '../support/jobFixtures';
import { createProcurementFixture } from '../procurement-fixture';

test('JOB-PU5 Buyer extends a rental with requester prices hidden and sees the separate linked order', async ({ page }) => {
  const admin = serviceClient('rental journey');
  const before = need('settings', await admin.from('organizations').select('hide_prices_from_requesters').eq('id', ORG_ID).single());
  const buyer = await moneyJobRole('buyer');
  let fixture: Awaited<ReturnType<typeof createProcurementFixture>> | undefined;
  let extension = '';
  try {
    ok('hide prices', await admin.from('organizations').update({ hide_prices_from_requesters: true }).eq('id', ORG_ID));
    const rental = need('rental type', await admin.from('purchase_types').select('id').eq('org_id', ORG_ID).eq('is_rental', true).eq('active', true).limit(1).single());
    fixture = await createProcurementFixture({ status: 'Draft', title: 'Rental journey' });
    ok('rental period', await admin.from('procurements').update({ purchase_type_id: rental.id, rental_from: '2026-01-01', rental_to: '2026-01-31', status: 'Ordered', approved_by_id: '00000000-0000-0000-0000-0000000000a1' }).eq('id', fixture.id));
    await buyer.login(page);
    await page.goto(fixture.url);
    await page.getByTestId('rental-panel').getByRole('button', { name: 'Extend rental' }).click();
    await page.getByRole('dialog').getByLabel(/^To/).fill('2026-02-28');
    await page.getByRole('dialog').getByRole('button', { name: 'Create extension order' }).click();
    await expect(page.getByTestId('rental-extends')).toContainText('Rental journey');
    extension = page.url().match(/procurement\/([0-9a-f-]+)/)?.[1] ?? '';
    expect(extension).not.toBe(fixture.id);
    await page.goto(fixture.url);
    await expect(page.getByTestId('rental-extensions')).toContainText('Rental journey');
  } finally {
    if (extension) {
      ok('extension items', await admin.from('procurement_items').delete().eq('procurement_id', extension));
      ok('extension', await admin.from('procurements').delete().eq('id', extension));
    }
    await fixture?.cleanup();
    await buyer.cleanup();
    ok('restore settings', await admin.from('organizations').update({ hide_prices_from_requesters: before.hide_prices_from_requesters }).eq('id', ORG_ID));
  }
});
