// @e2e-isolation: self-isolated — creates its own uniquely-coded rented unit, hire vendor, rental terms, a past month of statuses and one proof photo each run and deletes them afterwards; reads the seeded Finance user only.
/**
 * JOB-E4 — cut the rental invoice for downtime (#2526b). A rented unit rented for a month at 30,000 was broken 3 days, with a
 * photo of the breakdown ticket attached. Finance checks the vendor's invoice of 27,500 for that month.
 * Goal oracle: the deduction is 3 days at the daily rate (3,000), the expected invoice is 27,000, the invoice is 500 over,
 * and the proof photo opens from the result.
 */
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signIn } from './helpers';
import { need, ORG_ID, serviceClient } from './support/jobJourney';
import { roleJobUser } from './support/roleJobUser';
import { runId } from './support/jobFixtures';

test.setTimeout(180_000);
const must = need('JOB-E4');
const db = serviceClient('JOB-E4');
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
let code = ''; // one per test, so two tests running at once never share an asset code
let assetId = ''; let vendorId = ''; let proofPath = ''; let hourlyId = ''; const hourlyPaths: string[] = [];

test.beforeEach(async () => {
  code = `000-${runId('E4')}`;
  vendorId = must('vendor', await db.from('companies').insert({ org_id: ORG_ID, name: `Hire vendor ${code}`, type: 'Vendor' }).select('id').single()).id;
  assetId = must('asset', await db.from('equipment_assets').insert({ org_id: ORG_ID, code, name: 'Crane', default_unit: 'hours', ownership: 'rented' }).select('id').single()).id;
  must('terms', await db.from('equipment_rental_terms').insert({ org_id: ORG_ID, asset_id: assetId, vendor_id: vendorId, rate: 30000, basis: 'month', currency: 'IDR', rented_from: '2026-09-01', rented_to: '2026-09-30' }).select('id'));
  must('statuses', await db.from('equipment_status_days').insert(Array.from({ length: 30 }, (_, i) => ({
    org_id: ORG_ID, asset_id: assetId, status_date: `2026-09-${String(i + 1).padStart(2, '0')}`, status: i >= 20 && i <= 22 ? 'broken' : 'ready' }))).select('id'));
  const proofId = randomUUID(); proofPath = `${ORG_ID}/${assetId}/${proofId}/ticket.png`;
  must('proof', await db.from('equipment_downtime_proofs').insert({ id: proofId, org_id: ORG_ID, asset_id: assetId, proof_date: '2026-09-21', file_name: 'ticket.png', file_path: proofPath }).select('id').single());
  const up = await db.storage.from('equipment-proof').upload(proofPath, pixel, { contentType: 'image/png' }); if (up.error) throw up.error;
});
test.afterEach(async () => {
  if (hourlyId) {
    if (hourlyPaths.length) await db.storage.from('equipment-proof').remove(hourlyPaths);
    for (const table of ['hourly_rental_checks', 'equipment_downtime_proofs', 'equipment_rental_terms', 'equipment_status_history']) await db.from(table).delete().eq('asset_id', hourlyId);
    await db.from('equipment_assets').delete().eq('id', hourlyId);
    hourlyId = ''; hourlyPaths.length = 0;
  }
  if (proofPath) await db.storage.from('equipment-proof').remove([proofPath]);
  for (const table of ['equipment_downtime_proofs', 'equipment_status_days', 'equipment_status_history', 'equipment_rental_terms']) await db.from(table).delete().eq('asset_id', assetId);
  await db.from('equipment_assets').delete().eq('id', assetId);
  await db.from('companies').delete().eq('id', vendorId);
});

test('JOB-E4 the month\'s rental bill carries a 3-day deduction with its proof photo', async ({ page }) => {
  await signIn(page, 'finance@acme.test');
  await page.goto('/equipment/availability');
  await page.getByRole('button', { name: 'Rental invoice check' }).click();
  await page.getByLabel('Rented machine').selectOption(assetId);
  await page.getByLabel('Invoice period from').fill('2026-09-01');
  await page.getByLabel('Invoice period to').fill('2026-09-30');
  await page.getByLabel('Vendor invoice amount').fill('27500.00');
  await page.getByRole('button', { name: 'Check invoice' }).click();
  const result = page.getByRole('region', { name: 'Check result' });
  await expect(result.getByText('IDR 3,000', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(result.getByText('IDR 27,000', { exact: true })).toBeVisible();
  await expect(result.getByText('Over-billed by IDR 500', { exact: true })).toBeVisible(); // said in words, not invoice-minus-expected
  await expect(result.getByText(/Days with no status recorded are counted as rented/)).toBeVisible();
  await result.getByRole('button', { name: 'Open ticket.png' }).first().click();
  const link = result.getByRole('link', { name: 'ticket.png' }).first();
  await expect(link).toHaveAttribute('href', /token=/);
  expect((await page.request.get((await link.getAttribute('href')) ?? '')).ok()).toBe(true);
});

test('JOB-E4 the equipment manager (Project Manager) reads the same check result but cannot include unproven days', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await page.goto('/equipment/availability');
  await page.getByRole('button', { name: 'Rental invoice check' }).click();
  await page.getByLabel('Rented machine').selectOption(assetId);
  await page.getByLabel('Invoice period from').fill('2026-09-01');
  await page.getByLabel('Invoice period to').fill('2026-09-30');
  await page.getByLabel('Vendor invoice amount').fill('27500.00');
  await page.getByRole('button', { name: 'Check invoice' }).click();
  const result = page.getByRole('region', { name: 'Check result' });
  await expect(result.getByText('IDR 3,000', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(result.getByText('Over-billed by IDR 500', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Reason to include unproven days')).toHaveCount(0);
});

test('JOB-E4 an hourly rented crane with 40 broken hours and proof: the equipment officer and the finance officer both read a deduction of 40 hours at the rate, proof attached', async ({ page }) => {
  hourlyId = must('hourly asset', await db.from('equipment_assets').insert({ org_id: ORG_ID, code: `${code}-H`, name: 'Hourly crane', default_unit: 'hours', ownership: 'rented' }).select('id').single()).id;
  must('hourly term', await db.from('equipment_rental_terms').insert({ org_id: ORG_ID, asset_id: hourlyId, vendor_id: vendorId, rate: 100, basis: 'hour', currency: 'IDR', rented_from: '2026-09-01' }).select('id'));
  for (const date of ['2026-09-01', '2026-09-02']) {
    const path = `${ORG_ID}/${hourlyId}/${randomUUID()}/repair.pdf`; hourlyPaths.push(path);
    const up = await db.storage.from('equipment-proof').upload(path, Buffer.from('%PDF-1.4\n% Repair report\n%%EOF'), { contentType: 'application/pdf' }); if (up.error) throw up.error;
    must('hourly proof', await db.from('equipment_downtime_proofs').insert({ org_id: ORG_ID, asset_id: hourlyId, proof_date: date, file_name: 'repair.pdf', file_path: path }).select('id'));
  }
  const officer = await roleJobUser(db, 'equipment_officer', runId('e4-eo'));
  const finance = await roleJobUser(db, 'finance_officer', runId('e4-fo'));
  try {
    for (const who of [officer, finance]) {
      await who.signIn(page);
      await page.goto('/equipment/availability');
      await page.getByRole('button', { name: 'Rental invoice check', exact: true }).click();
      await page.getByLabel('Rented machine').selectOption(hourlyId);
      await page.getByLabel('Invoice period from').fill('2026-09-01');
      await page.getByLabel('Invoice period to').fill('2026-09-30');
      await page.getByLabel('Hourly rental', { exact: true }).check();
      await page.getByLabel('Contracted hours').fill('200');
      await page.getByLabel('Invoice hours').fill('170');
      for (const [i, hours] of ['24', '16'].entries()) {
        await page.getByRole('button', { name: 'Add broken hours' }).click();
        await page.getByLabel('Breakdown date').nth(i).fill(`2026-09-0${i + 1}`);
        await page.getByLabel('Broken hours', { exact: true }).nth(i).fill(hours);
      }
      await page.getByRole('button', { name: 'Compare hours' }).click();
      const panel = page.getByRole('region', { name: 'Hourly rental' });
      await expect(panel.getByText('40.00', { exact: true })).toBeVisible({ timeout: 20_000 }); // 24 + 16 proven broken hours
      await expect(panel.getByText('IDR 4,000', { exact: true })).toBeVisible();             // 40 hours at 100 an hour
      await expect(panel.getByRole('button', { name: 'Open repair.pdf' })).toHaveCount(2);
    }
  } finally {
    await officer.cleanup();
    await finance.cleanup();
  }
});
