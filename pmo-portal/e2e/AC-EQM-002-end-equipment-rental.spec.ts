// @e2e-isolation: self-isolated — owns its equipment manager login, vendor, asset and rental period.
import { expect, test } from '@playwright/test';
import { need, ok, ORG_ID, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(120_000);

test('AC-EQM-002 equipment manager ends an open rental and the invoice check stops billing after the last day', async ({ page }) => {
  const db = serviceClient('AC-EQM-002');
  const run = runId('EQM002');
  const manager = await roleJobUser(db, 'equipment_manager', run);
  const code = `000-${run}`;
  let vendorId = '';
  let assetId = '';
  try {
    vendorId = need('vendor', await db.from('companies').insert({
      org_id: ORG_ID, name: `Hire vendor ${run}`, type: 'Vendor',
    }).select('id').single()).id;
    assetId = need('asset', await db.from('equipment_assets').insert({
      org_id: ORG_ID, code, name: `Crane ${run}`, default_unit: 'hours', ownership: 'rented',
    }).select('id').single()).id;
    ok('open rental', await db.from('equipment_rental_terms').insert({
      org_id: ORG_ID, asset_id: assetId, vendor_id: vendorId, rate: 100, basis: 'day', currency: 'IDR',
      rented_from: '2026-09-01',
    }));

    ok('ready days', await db.from('equipment_status_days').insert(
      ['01', '02', '03', '04', '05'].map(day => ({
        org_id: ORG_ID, asset_id: assetId, status_date: `2026-09-${day}`, status: 'ready',
      })),
    ));

    await manager.signIn(page);
    await page.goto(`/equipment/assets/${assetId}`);
    const terms = page.getByRole('region', { name: 'Rental terms' });
    await terms.getByRole('button', { name: 'End rental period' }).click();
    await page.getByRole('dialog').getByLabel('Last rental day').fill('2026-09-03');
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm end date' }).click();
    await expect(terms.getByText(/3 Sep 2026/)).toBeVisible();
    await expect(terms.getByRole('button', { name: 'End rental period' })).toHaveCount(0);

    await page.goto('/equipment/availability');
    await page.getByLabel('Metric period from').fill('2026-09-01');
    await page.getByLabel('Metric period to').fill('2026-09-05');
    const metric = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: code, exact: true }) });
    await expect(metric.getByText('3 of 3 days', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Rental invoice check', exact: true }).click();
    await page.getByLabel('Rented machine').selectOption(assetId);
    await page.getByLabel('Invoice period from').fill('2026-09-01');
    await page.getByLabel('Invoice period to').fill('2026-09-05');
    await page.getByRole('button', { name: 'Check invoice' }).click();
    const result = page.getByRole('region', { name: 'Check result' });
    await expect(result.getByText('IDR 300', { exact: true })).toHaveCount(2);
  } finally {
    if (assetId) {
      ok('status cleanup', await db.from('equipment_status_days').delete().eq('asset_id', assetId));
      ok('status history cleanup', await db.from('equipment_status_history').delete().eq('asset_id', assetId));
      ok('rental cleanup', await db.from('equipment_rental_terms').delete().eq('asset_id', assetId));
      ok('asset cleanup', await db.from('equipment_assets').delete().eq('id', assetId));
    }
    if (vendorId) ok('vendor cleanup', await db.from('companies').delete().eq('id', vendorId));
    await manager.cleanup();
  }
});
