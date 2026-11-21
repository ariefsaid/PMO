// @e2e-isolation: serial - evidence capture only (not committed).
import { test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import path from 'node:path';
import { signIn, requireServiceRoleKey, pinEnglishLocale } from '../helpers';
import { requireMatchingLocalSupabaseUrls } from '../../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const URL_ = requireMatchingLocalSupabaseUrls(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL);
const OUT = path.join(process.cwd(), '..', 'docs', 'evidence', '1215', '2596');
test.setTimeout(240_000);

test('capture safety screens', async ({ browser }) => {
  const admin = createClient(URL_, requireServiceRoleKey()!, { auth: { persistSession: false } });
  const ok = (s: string, e: { message: string } | null) => { if (e) throw new Error(`${s}: ${e.message}`); };
  const tag = `Evidence ${Date.now()}`;
  ok('flag', (await admin.from('organizations').update({ safety_records_enabled: true }).eq('id', ORG_ID)).error);
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const day = (n: number) => `${ym}-${String(n).padStart(2, '0')}`;
  const p = (await admin.from('projects').insert({ org_id: ORG_ID, name: `${tag} Pipeline`, status: 'Ongoing Project' }).select('id').single()).data!;
  const w = (await admin.from('work_orders').insert({ org_id: ORG_ID, project_id: p.id, title: `${tag} Pipe run`, status: 'Issued', order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0 }).select('id').single()).data!;
  const crew = (await admin.from('crews').insert({ org_id: ORG_ID, code: `E${Date.now() % 100000}`, name: `${tag} crew` }).select('id').single()).data!;
  const people = (await admin.from('people').insert(['Sari Wijaya', 'Budi Santoso', 'Dewi Lestari'].map((name) => ({ org_id: ORG_ID, kind: 'vendor', name }))).select('id')).data!;
  ok('members', (await admin.from('crew_members').insert(people.map((x: { id: string }) => ({ org_id: ORG_ID, crew_id: crew.id, worker_id: x.id, valid_from: '2020-01-01' })))).error);
  ok('roster', (await admin.from('work_order_crews').insert({ org_id: ORG_ID, work_order_id: w.id, crew_id: crew.id, valid_from: '2020-01-01' })).error);
  const items = (await admin.from('safety_list_items').insert([
    { org_id: ORG_ID, kind: 'check_type', label: 'Fit for work', position: 1 }, { org_id: ORG_ID, kind: 'check_type', label: 'Fatigue', position: 2 },
    { org_id: ORG_ID, kind: 'permit_type', label: 'Hot work', position: 1 }, { org_id: ORG_ID, kind: 'permit_type', label: 'Work at height', position: 2 },
    { org_id: ORG_ID, kind: 'checklist_item', label: 'Area barricaded', position: 1 }, { org_id: ORG_ID, kind: 'checklist_item', label: 'Tools inspected', position: 2 },
    { org_id: ORG_ID, kind: 'checklist_item', label: 'Permit displayed at the work face', position: 3 },
  ]).select('id, label')).data!;
  const dayIso = (n: number) => day(n);
  ok('att', (await admin.from('attendance_days').insert([1, 2, 3, 4].flatMap((n) => people.map((x: { id: string }) => ({
    org_id: ORG_ID, worker_id: x.id, work_order_id: w.id, project_id: p.id, work_date: dayIso(n), status: 'present', hours: 8, overtime_hours: n === 2 ? 2 : 0, source: 'manual_correction', locked_at: new Date().toISOString(),
  }))))).error);
  // two complete days (author: admin via service role is not an auth user; use the engineer's profile id as author)
  const eng = (await admin.from('profiles').select('id').eq('email', 'engineer@acme.test').single()).data!;
  const mkDay = async (n: number, complete: boolean) => {
    const d = (await admin.from('safety_days').insert({ org_id: ORG_ID, project_id: p.id, work_order_id: w.id, work_date: dayIso(n), status: 'draft', author_id: eng.id }).select('id').single());
    ok('day', d.error);
    const id = d.data!.id;
    const talk = (await admin.from('safety_toolbox_talks').insert({ org_id: ORG_ID, day_id: id, topic: 'Working at height', presenter: 'Site foreman', held_at: `${dayIso(n)}T07:00:00Z` }).select('id').single()).data!;
    await admin.from('safety_toolbox_attendees').insert(people.map((x: { id: string }) => ({ org_id: ORG_ID, day_id: id, talk_id: talk.id, worker_id: x.id })));
    if (complete) await admin.from('safety_toolbox_photos').insert({ org_id: ORG_ID, day_id: id, talk_id: talk.id, file_path: `${ORG_ID}/${id}/${crypto.randomUUID()}/talk.jpg` });
    await admin.from('safety_fitness_checks').insert(people.map((x: { id: string }, i: number) => ({ org_id: ORG_ID, day_id: id, worker_id: x.id, result: i === 2 && !complete ? 'not_checked' : 'fit', check_type_id: items[0].id })));
    await admin.from('safety_checklist_answers').update({ answer: 'yes' }).eq('day_id', id);
    await admin.from('safety_permits').insert({ org_id: ORG_ID, day_id: id, permit_number: 'HW-0412', type_id: items[2].id, valid_from: `${dayIso(n)}T08:00:00Z`, valid_to: `${dayIso(n)}T16:00:00Z`, issued_by: 'Site supervisor' });
    await admin.from('safety_officer_entries').insert({ org_id: ORG_ID, day_id: id, body: 'Housekeeping reminder given at the laydown area. One near miss with a swinging load, no injury.', near_misses: 1, observations: 3, author_id: eng.id });
    if (complete) await admin.from('safety_days').update({ status: 'locked', submitted_at: new Date().toISOString() }).eq('id', id);
    return id;
  };
  const d1 = await mkDay(1, true);
  const d2 = await mkDay(2, false);
  await admin.from('incident_reports').insert({ org_id: ORG_ID, incident_date: dayIso(1), type: 'Injury', severity: 'Medium', project_id: p.id, lost_time: true });

  const shots: Array<[string, string, string]> = [];
  for (const [vw, vh, label] of [[390, 844, 'phone-390'], [1440, 900, 'desktop-1440']] as const) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
    const page = await ctx.newPage();
    await pinEnglishLocale(page);
    await signIn(page, 'admin@acme.test');
    await page.goto('/administration/projects');
    await page.waitForSelector('#safety-records', { timeout: 30_000 });
    await page.locator('#safety-records').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    await page.locator('#safety-records').screenshot({ path: path.join(OUT, `admin-safety-lists-${label}.png`) });
    await page.goto(`/work-orders/${w.id}`);
    await page.getByTestId('safety-section').waitFor({ timeout: 30_000 });
    await page.getByTestId('safety-day-row').first().waitFor();
    await page.waitForTimeout(800);
    await page.getByTestId('safety-section').screenshot({ path: path.join(OUT, `work-order-safety-section-${label}.png`) });
    await page.goto(`/safety-days/${d2}`);
    await page.getByTestId('safety-fitness').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `safety-day-form-${label}.png`), fullPage: true });
    await page.goto(`/safety-days/${d1}`);
    await page.getByTestId('safety-day-status').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT, `safety-day-locked-${label}.png`), fullPage: true });
    await page.goto('/safety');
    await page.getByLabel('Project').selectOption({ label: `${tag} Pipeline` });
    await page.getByTestId('safety-figure-workedMinutes').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1000);
    await page.getByTestId('safety-drill-daysWithoutRecord').click().catch(() => undefined);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `safety-summary-${label}.png`), fullPage: true });
    shots.push([label, '', '']);
    await ctx.close();
  }
  await admin.from('incident_reports').delete().eq('project_id', p.id);
  await admin.from('safety_days').delete().eq('work_order_id', w.id);
  await admin.from('attendance_days').delete().eq('work_order_id', w.id);
  await admin.from('work_order_crews').delete().eq('work_order_id', w.id);
  await admin.from('crew_members').delete().eq('crew_id', crew.id);
  await admin.from('crews').delete().eq('id', crew.id);
  await admin.from('people').delete().in('id', people.map((x: { id: string }) => x.id));
  await admin.from('safety_list_items').delete().in('id', items.map((x: { id: string }) => x.id));
  await admin.from('work_orders').delete().eq('id', w.id);
  await admin.from('projects').delete().eq('id', p.id);
  await admin.from('organizations').update({ safety_records_enabled: false }).eq('id', ORG_ID);
});
