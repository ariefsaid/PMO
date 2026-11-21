// @e2e-isolation: serial - switches the seed org's safety_records_enabled setting on (an org-wide switch) and restores it; owns and cleans every other row.
/**
 * AC-DSF-016 — daily safety records (#2596): the monthly safety summary. A project with locked attendance on two days and
 * no safety record on either shows "2" days without a safety record; opening that count lists exactly two days; the worked
 * hours equal the locked attendance; and a project with no locked attendance hides its hours with a reason instead of 0.
 * Goal oracle: every count opens the rows behind it and the two agree.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey, pinEnglishLocale } from '../helpers';
import { requireMatchingLocalSupabaseUrls } from '../../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(120_000);

let admin: SupabaseClient | undefined;
const projectIds: string[] = [];
const woIds: string[] = [];
let personId = '';
let flagBefore = false;
let tag = '';
const now = new Date();
const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`AC-DSF-016 fixture ${step}: ${e.message}`); };

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-DSF-016 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  tag = `DSF-016 ${Date.now()}`;
  const org = await admin.from('organizations').select('safety_records_enabled').eq('id', ORG_ID).single();
  fail('org', org.error); flagBefore = org.data!.safety_records_enabled;
  fail('switch', (await admin.from('organizations').update({ safety_records_enabled: true }).eq('id', ORG_ID)).error);
  for (const suffix of ['worked', 'quiet']) {
    const p = await admin.from('projects').insert({ org_id: ORG_ID, name: `${tag} ${suffix}`, status: 'Ongoing Project' }).select('id').single();
    fail('project', p.error); projectIds.push(p.data!.id);
    const w = await admin.from('work_orders').insert({ org_id: ORG_ID, project_id: p.data!.id, title: `${tag} ${suffix} WO`, status: 'Issued', order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0 }).select('id').single();
    fail('work order', w.error); woIds.push(w.data!.id);
  }
  const person = await admin.from('people').insert({ org_id: ORG_ID, kind: 'vendor', name: `${tag} Worker` }).select('id').single();
  fail('person', person.error); personId = person.data!.id;
  fail('attendance', (await admin.from('attendance_days').insert([`${month}-02`, `${month}-03`].map((work_date) => ({
    org_id: ORG_ID, worker_id: personId, work_order_id: woIds[0], project_id: projectIds[0], work_date, status: 'present', hours: 8, overtime_hours: 1, source: 'manual_correction', locked_at: new Date().toISOString(),
  })))).error);
});

test.afterEach(async () => {
  if (!admin) return;
  await admin.from('attendance_days').delete().eq('worker_id', personId);
  if (personId) await admin.from('people').delete().eq('id', personId);
  if (woIds.length) await admin.from('work_orders').delete().in('id', woIds);
  if (projectIds.length) await admin.from('projects').delete().in('id', projectIds);
  await admin.from('organizations').update({ safety_records_enabled: flagBefore }).eq('id', ORG_ID);
  projectIds.length = 0; woIds.length = 0; personId = '';
});

test('AC-DSF-016 a count on the monthly safety summary opens exactly the rows behind it, and hours with nothing to count are hidden, not 0', async ({ page }) => {
  await pinEnglishLocale(page);
  await signIn(page, 'finance@acme.test');
  await page.goto('/safety');
  await page.getByLabel('Month').fill(month);

  await page.getByLabel('Project').selectOption({ label: `${tag} worked` });
  const without = page.getByTestId('safety-figure-daysWithoutRecord');
  await expect(without).toHaveText('2', { timeout: 20_000 });
  await expect(page.getByTestId('safety-figure-workedMinutes')).toHaveText('18 h 0 min');
  await page.getByTestId('safety-drill-daysWithoutRecord').click();
  await expect(page.getByTestId('safety-detail-row')).toHaveCount(2);

  await page.getByLabel('Project').selectOption({ label: `${tag} quiet` });
  await expect(page.getByTestId('safety-figure-workedMinutes')).toHaveText('—', { timeout: 20_000 });
  await expect(page.getByTestId('safety-hidden')).toContainText('no locked or approved attendance');
});
