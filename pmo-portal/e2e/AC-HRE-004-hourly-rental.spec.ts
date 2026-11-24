// @e2e-isolation: self-isolated — disposable job login, asset, supplier, rental term and proofs.
import { test, expect } from '@playwright/test';
import { roleJobUser } from './support/roleJobUser';
import { need, ORG_ID, serviceClient } from './support/jobJourney';

test('AC-HRE-004 Equipment Officer checks the supplier quantity against contracted hours and proven breakdowns', async ({ page }) => {
  const db = serviceClient('AC-HRE-004'); const must = need('AC-HRE-004');
  const run = crypto.randomUUID(); const code = `000-HRE-${run.slice(0,8)}`;
  const officer = await roleJobUser(db, 'equipment_officer', `hre-${run}`);
  let asset = ''; let vendor = ''; const paths: string[] = [];
  try {
    vendor = must('vendor', await db.from('companies').insert({ org_id: ORG_ID, name: `Hourly supplier ${run}`, type: 'Vendor' }).select('id').single()).id;
    asset = must('asset', await db.from('equipment_assets').insert({ org_id: ORG_ID, code, name: 'Hourly crane', ownership: 'rented', default_unit: 'hours' }).select('id').single()).id;
    must('term', await db.from('equipment_rental_terms').insert({ org_id: ORG_ID, asset_id: asset, vendor_id: vendor, rate: 100, basis: 'hour', currency: 'IDR', rented_from: '2026-09-01' }).select('id'));
    for (const date of ['2026-09-01','2026-09-02']) {
      const path = `${ORG_ID}/${asset}/${crypto.randomUUID()}/repair.txt`; paths.push(path);
      const upload = await db.storage.from('equipment-proof').upload(path, Buffer.from('Repair report'), { contentType: 'text/plain' });
      if (upload.error) throw upload.error;
      must('proof', await db.from('equipment_downtime_proofs').insert({ org_id: ORG_ID, asset_id: asset, proof_date: date, file_name: 'repair.txt', file_path: path }).select('id'));
    }
    await officer.signIn(page);
    await page.goto('/equipment/availability');
    await page.getByRole('button', { name: 'Rental invoice check', exact: true }).click();
    await page.getByLabel('Rented machine').selectOption(asset);
    await page.getByLabel('Invoice period from').fill('2026-09-01');
    await page.getByLabel('Invoice period to').fill('2026-09-30');
    await page.getByLabel('Hourly rental', { exact: true }).check();
    await page.getByLabel('Contracted hours').fill('200');
    await page.getByLabel('Invoice hours').fill('170');
    for (const [i, hours] of ['24','16'].entries()) {
      await page.getByRole('button', { name: 'Add broken hours' }).click();
      await page.getByLabel('Breakdown date').nth(i).fill(`2026-09-0${i+1}`);
      await page.getByLabel('Broken hours', { exact: true }).nth(i).fill(hours);
    }
    await page.getByRole('button', { name: 'Mark disputed' }).click();
    await expect(page.getByRole('status')).toHaveText('Disputed');
    const panel = page.getByRole('region', { name: 'Hourly rental' });
    await expect(panel.getByText('160.00', { exact: true })).toBeVisible();
    await expect(panel.getByText('IDR 4,000', { exact: true })).toBeVisible();
    await expect(panel.getByText('IDR 16,000', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Open repair.txt' })).toHaveCount(2);
    const saved = must('saved check', await db.from('hourly_rental_checks').select('result,created_by').eq('asset_id',asset).single());
    expect(saved.result.state).toBe('disputed'); expect(saved.created_by).toBe(officer.id);
  } finally {
    if (asset) {
      await db.from('hourly_rental_checks').delete().eq('asset_id',asset);
      await db.from('equipment_downtime_proofs').delete().eq('asset_id',asset);
      if (paths.length) await db.storage.from('equipment-proof').remove(paths);
      await db.from('equipment_rental_terms').delete().eq('asset_id',asset);
      await db.from('equipment_assets').delete().eq('id',asset);
    }
    if (vendor) await db.from('companies').delete().eq('id',vendor);
    await officer.cleanup();
  }
});
