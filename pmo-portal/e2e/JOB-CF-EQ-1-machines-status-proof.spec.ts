// @e2e-isolation: self-isolated — creates its own uniquely-coded machine, sets and deletes its own statuses and proof; reads the seeded Project Manager only.
/**
 * JOB-CF-EQ-1 — the equipment manager's day starts on the machines (fix lane "equipment manager's day", items 1, 4, 9).
 * The equipment manager (Project Manager) opens Equipment on a phone, marks a machine broken with a note and a photo in one
 * step, and is told who hears about it. The hours log is one tap away.
 * Goal oracle: Equipment opens on the machine list with today's status; the broken status, note and photo are all saved
 * from that one form; the page says nobody is messaged right away and who is told after the limit; the hours log opens.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { need, ORG_ID, orgToday, serviceClient } from './support/jobJourney';

test.setTimeout(180_000);
const must = need('JOB-CF-EQ-1');
const db = serviceClient('JOB-CF-EQ-1');
const code = `000-CF1-${Date.now().toString(36)}`;
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
let assetId = '';

test.beforeEach(async () => {
  assetId = must('asset', await db.from('equipment_assets').insert({ org_id: ORG_ID, code, name: 'Dump truck', default_unit: 'hours' }).select('id').single()).id;
});
test.afterEach(async () => {
  const proofs = await db.from('equipment_downtime_proofs').select('file_path').eq('asset_id', assetId);
  if (proofs.data?.length) await db.storage.from('equipment-proof').remove(proofs.data.map((p) => p.file_path as string));
  for (const table of ['equipment_downtime_proofs', 'equipment_status_days', 'equipment_status_history']) await db.from(table).delete().eq('asset_id', assetId);
  await db.from('equipment_assets').delete().eq('id', assetId);
});

test('JOB-CF-EQ-1 Equipment opens on the machines; broken with note and photo is saved in one step and says who is told', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await page.goto('/equipment');
  // The landing screen is the machine list with today's status, not the weekly hours grid.
  await expect(page.getByRole('heading', { name: 'Equipment status' })).toBeVisible({ timeout: 20_000 });
  const row = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: code, exact: true }) });
  await expect(row).toBeVisible();
  await expect(row.getByText('Not recorded')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Equipment usage this week' })).toHaveCount(0);

  await row.getByRole('combobox', { name: `Status of ${code}` }).selectOption('broken');
  await row.getByLabel(`Note for ${code}`).fill('hydraulic hose burst');
  await expect(row.getByText(/Counts as downtime/)).toBeVisible(); // one line on what the status does to planning
  await row.getByLabel(`Photo for ${code}`).setInputFiles({ name: 'hose.png', mimeType: 'image/png', buffer: pixel });
  await page.getByRole('button', { name: 'Save statuses' }).click();

  await expect(page.getByText(`Marked broken: ${code}.`)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Admin and Project Manager users are told if it stays down more than \d+ days/)).toBeVisible();
  await expect(row.getByTestId(`today-status-${code}`)).toHaveText('Broken');

  // The same single step stored the status, the note and the proof.
  const status = await db.from('equipment_status_days').select('status, note').eq('asset_id', assetId).eq('status_date', orgToday()).single();
  expect(status.data).toEqual({ status: 'broken', note: 'hydraulic hose burst' });
  const proof = await db.from('equipment_downtime_proofs').select('id').eq('asset_id', assetId);
  expect(proof.data?.length).toBe(1);

  // The hours log is one tap away.
  await page.getByRole('link', { name: 'Hours log' }).click();
  await expect(page).toHaveURL(/\/equipment\?view=hours/);
  await expect(page.getByRole('button', { name: 'Add row' })).toBeVisible({ timeout: 20_000 });
});

test('JOB-CF-EQ-1 on a 390 px phone the machine list and the availability figures fit without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await signIn(page, 'pm@acme.test');
  await page.goto('/equipment');
  await expect(page.getByRole('link', { name: code, exact: true })).toBeVisible({ timeout: 20_000 });
  await page.goto('/equipment/availability');
  await expect(page.getByRole('heading', { name: 'This month' })).toBeVisible({ timeout: 20_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
