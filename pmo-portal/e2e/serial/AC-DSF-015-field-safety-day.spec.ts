// @e2e-isolation: serial - switches the seed org's safety_records_enabled setting on (an org-wide switch that adds a section to every work-order page) and restores it; owns and cleans every other row.
/**
 * AC-DSF-015 — daily safety records (#2596): the one field journey. On a 390px phone the Engineer opens a work order,
 * records today's safety day (a fitness check for each person present, a toolbox talk with its attendance photo and
 * the pre-work checklist), submits it, and the work-order page then shows the day complete.
 * Goal oracle: the work-order page reads the day as Complete, and before the record it read "Worked without a safety record".
 * The photo ROW is written by the service role: CI runs with Storage disabled, so the upload is proven at the unit layer
 * and storage access at pgTAP (safety_days.test.sql).
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey, pinEnglishLocale } from '../helpers';
import { orgToday } from '../support/jobJourney';
import { requireMatchingLocalSupabaseUrls } from '../../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(150_000);
test.use({ viewport: { width: 390, height: 844 } });

let admin: SupabaseClient | undefined;
let projectId = '';
let woId = '';
let crewId = '';
let personIds: string[] = [];
let listIds: string[] = [];
let flagBefore = false;
let tag = '';
const today = orgToday; // the organisation's day: the screen reads it, not the runner's
const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`AC-DSF-015 fixture ${step}: ${e.message}`); };

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-DSF-015 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  tag = `DSF-015 ${Date.now()}`;
  const org = await admin.from('organizations').select('safety_records_enabled').eq('id', ORG_ID).single();
  fail('org', org.error);
  flagBefore = org.data!.safety_records_enabled;
  fail('switch', (await admin.from('organizations').update({ safety_records_enabled: true }).eq('id', ORG_ID)).error);
  const project = await admin.from('projects').insert({ org_id: ORG_ID, name: tag, status: 'Ongoing Project' }).select('id').single();
  fail('project', project.error); projectId = project.data!.id;
  const wo = await admin.from('work_orders').insert({ org_id: ORG_ID, project_id: projectId, title: `${tag} pipe run`, status: 'Issued', order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0 }).select('id').single();
  fail('work order', wo.error); woId = wo.data!.id;
  const crew = await admin.from('crews').insert({ org_id: ORG_ID, code: `S${Date.now() % 100000}`, name: `${tag} crew` }).select('id').single();
  fail('crew', crew.error); crewId = crew.data!.id;
  const people = await admin.from('people').insert([
    { org_id: ORG_ID, kind: 'vendor', name: `${tag} Worker A` }, { org_id: ORG_ID, kind: 'vendor', name: `${tag} Worker B` },
  ]).select('id, name');
  fail('people', people.error); personIds = people.data!.map((p: { id: string }) => p.id);
  const start = '2020-01-01';
  fail('members', (await admin.from('crew_members').insert(personIds.map((worker_id) => ({ org_id: ORG_ID, crew_id: crewId, worker_id, valid_from: start })))).error);
  fail('roster', (await admin.from('work_order_crews').insert({ org_id: ORG_ID, work_order_id: woId, crew_id: crewId, valid_from: start })).error);
  fail('attendance', (await admin.from('attendance_days').insert(personIds.map((worker_id) => ({
    org_id: ORG_ID, worker_id, work_order_id: woId, project_id: projectId, work_date: today(), status: 'present', hours: 8, source: 'manual_correction',
  })))).error);
  const items = await admin.from('safety_list_items').insert([
    { org_id: ORG_ID, kind: 'checklist_item', label: `${tag} Area barricaded`, position: 1 },
    { org_id: ORG_ID, kind: 'checklist_item', label: `${tag} Tools inspected`, position: 2 },
  ]).select('id');
  fail('list', items.error); listIds = items.data!.map((i: { id: string }) => i.id);
});

test.afterEach(async () => {
  if (!admin) return;
  await admin.from('safety_days').delete().eq('work_order_id', woId).then(() => undefined);
  await admin.from('attendance_days').delete().eq('work_order_id', woId);
  await admin.from('work_order_crews').delete().eq('work_order_id', woId);
  await admin.from('crew_members').delete().eq('crew_id', crewId);
  await admin.from('crews').delete().eq('id', crewId);
  if (personIds.length) await admin.from('people').delete().in('id', personIds);
  if (listIds.length) await admin.from('safety_list_items').delete().in('id', listIds);
  await admin.from('work_orders').delete().eq('id', woId);
  await admin.from('projects').delete().eq('id', projectId);
  await admin.from('organizations').update({ safety_records_enabled: flagBefore }).eq('id', ORG_ID);
  projectId = ''; woId = ''; crewId = ''; personIds = []; listIds = [];
});

test('AC-DSF-015 a field Engineer records and submits today\'s safety day on a phone and the work order shows it complete', async ({ page }) => {
  await pinEnglishLocale(page);
  await signIn(page, 'engineer@acme.test');
  await page.goto(`/work-orders/${woId}`);
  const section = page.getByTestId('safety-section');
  await expect(section).toBeVisible({ timeout: 20_000 });
  // Before any record: workers were present and nothing is recorded.
  const row = section.getByTestId('safety-day-row').first();
  await expect(row).toContainText('Worked without a safety record');

  await section.getByTestId('safety-new-day').click();
  await expect(page).toHaveURL(/\/safety-days\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  const dayId = page.url().split('/').pop()!;

  // Fitness check for each rostered person.
  for (const [i] of personIds.entries()) {
    await page.getByLabel('Worker on the roster').selectOption({ index: 1 });
    await page.getByTestId('safety-fitness-add').click();
    await expect(page.getByTestId('safety-fitness-row')).toHaveCount(i + 1);
  }

  // Toolbox talk with both attendees.
  await page.getByLabel('Topic').fill('Working at height');
  await page.getByLabel('Presenter').fill('Site foreman');
  for (const w of ['Worker A', 'Worker B']) await page.getByRole('checkbox', { name: `${tag} ${w}` }).click();
  await page.getByTestId('safety-talk-save').click();
  await expect(page.getByTestId('safety-talk')).toHaveCount(1);
  const talk = await admin!.from('safety_toolbox_talks').select('id').eq('day_id', dayId).single();
  const photoId = '00000000-0000-4000-8000-0000000000d5';
  const photo = await admin!.from('safety_toolbox_photos').insert({ id: photoId, org_id: ORG_ID, day_id: dayId, talk_id: talk.data!.id, file_path: `${ORG_ID}/${dayId}/${photoId}/talk.jpg` });
  if (photo.error) throw new Error(`AC-DSF-015 photo row: ${photo.error.message}`);
  await page.reload();

  // Pre-work checklist.
  for (const item of ['Area barricaded', 'Tools inspected']) {
    await page.getByLabel(`Answer for ${tag} ${item}`).selectOption({ label: 'Yes' });
  }
  await expect(page.getByTestId('safety-missing')).toHaveCount(0, { timeout: 10_000 });

  await page.getByTestId('safety-submit').click();
  // Locking is a deliberate confirm: the header button only opens the guard; the Engineer confirms it.
  const lock = page.getByRole('dialog', { name: 'Lock this safety day?' });
  await expect(lock).toBeVisible();
  await lock.getByRole('button', { name: 'Submit and lock' }).click();
  await expect(page.getByTestId('safety-day-status')).toHaveAttribute('data-status', 'locked', { timeout: 15_000 });

  await page.goto(`/work-orders/${woId}`);
  const today1 = page.getByTestId('safety-day-row').filter({ has: page.locator(`[data-date="${today()}"]`) }).or(page.locator(`[data-testid="safety-day-row"][data-date="${today()}"]`)).first();
  await expect(today1).toHaveAttribute('data-complete', 'yes', { timeout: 15_000 });
  await expect(today1).toContainText('Complete');
});
