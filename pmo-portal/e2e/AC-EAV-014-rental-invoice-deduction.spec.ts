// @e2e-isolation: self-isolated — creates a unique vendor, assets, terms, status and evidence and removes them afterwards.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireServiceRoleKey, signIn } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

test.setTimeout(180_000);

const org = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const env = loadEnv('development', process.cwd(), 'VITE_');
const url = requireMatchingLocalSupabaseUrls(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL);
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
let db: SupabaseClient; let ids: string[] = []; let codes: string[] = []; let vendor = ''; let proofPath = '';
const need = <T>(step: string, result: { data: T; error: { message: string } | null }): NonNullable<T> => {
  if (result.error || result.data == null) throw new Error(`${step}: ${result.error?.message ?? 'no data'}`);
  return result.data as NonNullable<T>;
};
test.beforeEach(async () => {
  const key = requireServiceRoleKey(); if (!key) throw new Error('AC-EAV-014 requires the local service role via e2e-local.sh');
  db = createClient(url, key, { auth: { persistSession: false } });
  const suffix = Date.now().toString(36); codes = Array.from({ length: 8 }, (_, i) => `000-EAV14-${suffix}-${i}`);
  vendor = need('create vendor', await db.from('companies').insert({ org_id: org, name: `Rental supplier ${suffix}`, type: 'Vendor' }).select('id').single()).id;
  const assets = need('create assets', await db.from('equipment_assets').insert(codes.map((code, i) => ({ org_id: org, code, name: ['Crane', 'Generator', 'Pump', 'Loader', 'Truck', 'Lift', 'Compressor', 'Excavator'][i], default_unit: 'hours', ownership: i < 2 ? 'rented' : 'owned' }))).select('id,code'));
  ids = codes.map((code) => { const row = assets.find((a) => a.code === code); if (!row) throw new Error(`missing ${code}`); return row.id as string; });
  need('create terms', await db.from('equipment_rental_terms').insert(ids.slice(0, 2).map((asset_id) => ({ org_id: org, asset_id, vendor_id: vendor, rate: 30000, basis: 'month', currency: 'IDR', rented_from: '2026-09-01', rented_to: '2026-09-30' }))).select('id'));
  const statusRows = ids.flatMap((asset_id, assetIndex) => Array.from({ length: assetIndex === 0 ? 30 : 12 }, (_, i) => ({
    org_id: org, asset_id, status_date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    status: assetIndex === 0 && i >= 20 && i <= 22 ? 'broken' : assetIndex > 0 && i >= 8 ? ['standby', 'at_vendor', 'waiting_parts', 'ready'][assetIndex % 4] : 'ready',
  })));
  need('create statuses', await db.from('equipment_status_days').insert(statusRows).select('id'));
  const proofId = randomUUID(); proofPath = `${org}/${ids[0]}/${proofId}/ticket.png`;
  need('register proof', await db.from('equipment_downtime_proofs').insert({ id: proofId, org_id: org, asset_id: ids[0], proof_date: '2026-09-21', file_name: 'ticket.png', file_path: proofPath }).select('id').single());
  const upload = await db.storage.from('equipment-proof').upload(proofPath, pixel, { contentType: 'image/png' }); if (upload.error) throw upload.error;
});
test.afterEach(async () => {
  if (!db || !ids.length) return;
  if (proofPath) { const removed = await db.storage.from('equipment-proof').remove([proofPath]); if (removed.error) throw removed.error; }
  for (const table of ['equipment_downtime_proofs', 'equipment_status_days', 'equipment_status_history', 'equipment_rental_terms']) { const { error } = await db.from(table).delete().in('asset_id', ids); if (error) throw error; }
  const a = await db.from('equipment_assets').delete().in('id', ids); if (a.error) throw a.error;
  const v = await db.from('companies').delete().eq('id', vendor); if (v.error) throw v.error;
  ids = []; proofPath = ''; vendor = '';
});
test('AC-EAV-014 Finance checks the test month and opens evidence for the exact deduction', async ({ page }) => {
  await signIn(page, 'finance@acme.test'); await page.goto('/equipment/availability');
  await page.getByLabel('Rented machine').selectOption(ids[0]);
  await page.getByLabel('Invoice period from').fill('2026-09-01');
  await page.getByLabel('Invoice period to').fill('2026-09-30');
  await page.getByLabel('Vendor invoice amount').fill('27500.00');
  await page.getByRole('button', { name: 'Check invoice' }).click();
  const result = page.getByRole('region', { name: 'Check result' });
  await expect(result.getByText('3000.00', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(result.getByText('27000.00', { exact: true })).toBeVisible();
  await expect(result.getByText('500.00', { exact: true })).toBeVisible();
  await expect(result.getByText('2026-09-21', { exact: false })).toBeVisible();
  await result.getByRole('button', { name: 'Open ticket.png' }).first().click();
  const evidenceLink = result.getByRole('link', { name: 'ticket.png' }).first();
  await expect(evidenceLink).toHaveAttribute('href', /token=/);
  const evidenceUrl = await evidenceLink.getAttribute('href');
  if (!evidenceUrl) throw new Error('proof link missing');
  expect((await page.request.get(evidenceUrl)).ok()).toBe(true);
  const dir = process.env.EAV_CAPTURE_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 }); await page.evaluate(() => document.fonts.ready);
      await page.getByRole('heading', { name: 'Rental invoice check' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(dir, `rental-check-${width}.png`) });
      await result.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(dir, `rental-result-${width}.png`) });
    }
  }
});
