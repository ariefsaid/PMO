// @e2e-isolation: self-isolated — creates unique assets, statuses and evidence, and removes them after the journey.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { requireServiceRoleKey, signIn } from './helpers';
import { inDays } from './support/jobJourney';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

test.setTimeout(180_000);

const org = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const env = loadEnv('development', process.cwd(), 'VITE_');
const url = requireMatchingLocalSupabaseUrls(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL);
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
let db: SupabaseClient; let ids: string[] = []; let codes: string[] = [];
const need = <T>(step: string, result: { data: T; error: { message: string } | null }): NonNullable<T> => {
  if (result.error || result.data == null) throw new Error(`${step}: ${result.error?.message ?? 'no data'}`);
  return result.data as NonNullable<T>;
};
test.beforeEach(async () => {
  const key = requireServiceRoleKey(); if (!key) throw new Error('AC-EAV-013 requires the local service role via e2e-local.sh');
  db = createClient(url, key, { auth: { persistSession: false } });
  const suffix = Date.now().toString(36); codes = Array.from({ length: 8 }, (_, i) => `000-EAV13-${suffix}-${i}`);
  const assets = need('create assets', await db.from('equipment_assets').insert(codes.map((code, i) => ({ org_id: org, code, name: ['Excavator', 'Generator', 'Crane', 'Pump', 'Loader', 'Truck', 'Compressor', 'Lift'][i], default_unit: 'hours' }))).select('id,code'));
  ids = codes.map((code) => { const row = assets.find((a) => a.code === code); if (!row) throw new Error(`missing ${code}`); return row.id as string; });
  const statuses = ['ready', 'standby', 'broken', 'at_vendor', 'waiting_parts', 'ready', 'ready', 'ready'];
  const rows = ids.flatMap((asset_id, i) => Array.from({ length: 12 }, (_, day) => ({
    org_id: org, asset_id, status_date: inDays(-(day + 1)),
    status: day < 3 ? statuses[i] : 'ready',
  })));
  need('seed statuses', await db.from('equipment_status_days').insert(rows).select('id'));
  const project = need('read project', await db.from('projects').select('id').eq('org_id', org).limit(1).single());
  const people = need('read roles', await db.from('profiles').select('id,role').eq('org_id', org).eq('status', 'active').in('role', ['Engineer', 'Project Manager']));
  const engineer = people.find((p) => p.role === 'Engineer'); const manager = people.find((p) => p.role === 'Project Manager');
  if (!engineer || !manager) throw new Error('rich seed needs an active engineer and project manager');
  const yesterday = inDays(-1);
  need('seed approved usage', await db.from('equipment_usage_entries').insert(ids.map((asset_id, i) => ({ org_id: org, asset_id, project_id: project.id, work_date: yesterday, quantity: i + 1, unit: 'hours', kind: 'work', status: 'Approved', author_id: engineer.id, approver_id: manager.id, approved_at: new Date().toISOString() }))).select('id'));
});
test.afterEach(async () => {
  if (!db || !ids.length) return;
  const proofs = need('proof cleanup', await db.from('equipment_downtime_proofs').select('file_path').in('asset_id', ids));
  if (proofs.length) { const removed = await db.storage.from('equipment-proof').remove(proofs.map((p) => p.file_path)); if (removed.error) throw removed.error; }
  for (const table of ['equipment_downtime_proofs', 'equipment_status_days', 'equipment_status_history', 'equipment_usage_entries']) { const { error } = await db.from(table).delete().in('asset_id', ids); if (error) throw error; }
  const { error } = await db.from('equipment_assets').delete().in('id', ids); if (error) throw error; ids = [];
});
test('AC-EAV-013 a field controller saves several statuses and a photo remains proven after reopening', async ({ page }) => {
  await signIn(page, 'engineer@acme.test'); await page.goto('/equipment/availability');
  await expect(page.getByRole('heading', { name: 'Equipment status' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel(`Status of ${codes[0]}`)).toBeVisible({ timeout: 20_000 });
  const selectedDate = await page.getByLabel('Status date').inputValue();
  await page.getByLabel(`Status of ${codes[0]}`).selectOption('broken');
  await page.getByLabel(`Status of ${codes[1]}`).selectOption('ready');
  await page.getByRole('button', { name: 'Save statuses' }).click();
  await expect(page.getByRole('button', { name: `Upload file for ${codes[0]}` })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(`Attach proof for ${codes[0]}`).setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: pixel });
  const broken = page.getByRole('row').filter({ hasText: codes[0] });
  await expect(broken.getByText('Proven', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.getByLabel(`Status of ${codes[0]}`)).toHaveValue('broken');
  await expect(page.getByLabel(`Status of ${codes[1]}`)).toHaveValue('ready');
  await expect(broken.getByText('Proven', { exact: true })).toBeVisible({ timeout: 20_000 });
  const saved = need('read statuses', await db.from('equipment_status_days').select('asset_id,status,status_date').in('asset_id', ids.slice(0, 2)).eq('status_date', selectedDate));
  expect(saved.map((r) => r.status).sort()).toEqual(['broken', 'ready']);
  const dir = process.env.EAV_CAPTURE_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true }); await signIn(page, 'admin@acme.test'); await page.goto('/equipment/availability');
    await expect(page.getByRole('heading', { name: 'Equipment status' })).toBeVisible({ timeout: 20_000 });
    await page.getByLabel('Metric period from').fill(inDays(-12));
    await expect(page.locator('tbody tr').filter({ hasText: codes[0] }).first()).toBeVisible({ timeout: 20_000 });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 }); await page.evaluate(() => document.fonts.ready);
      await page.getByRole('heading', { name: 'Equipment status' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(dir, `availability-${width}.png`) });
      await page.getByRole('heading', { name: 'This month' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(dir, `availability-metrics-${width}.png`) });
    }
  }
});
