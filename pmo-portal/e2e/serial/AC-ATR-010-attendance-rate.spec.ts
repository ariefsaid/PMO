// @e2e-isolation: serial - it sets the seed organisation's attendance target (an org-global singleton) and restores it in afterEach; it owns its project, crew, people and attendance rows and deletes them.
/**
 * AC-ATR-010 — a reviewer reads a crew's attendance rate against the organisation's target (#2706).
 *
 * Journey: with a 90 % target set, a crew of three on one rostered day (one present, one absent, one with no record)
 * is opened by the Project Manager under Crews › Rate. The crew reads expected 3, present 1, absent 1, no record 1,
 * rate 50 % against a 90 % target, marked below target. Goal oracle: the rate, the target and the mark agree with the
 * records the database holds — no separate number anyone typed.
 *
 * Isolation: unique project, crew, people and work order per run; the organisation's previous target is restored in
 * afterEach, which is why this spec is serial. Attendance is recorded for today, so the default month period always
 * contains it.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey } from './../helpers';
import { requireMatchingLocalSupabaseUrls } from '../../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const PM_ID = '00000000-0000-0000-0000-0000000000a2';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(180_000);

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

let admin: SupabaseClient | undefined;
let run = '';
let crewCode = '';
let crewId = '';
let workOrderId = '';
let people: Array<{ id: string; name: string }> = [];
let previousTarget: number | null = null;
let targetTouched = false;

const need = <D>(step: string, r: { data: D; error: { message: string } | null }): NonNullable<D> => {
  if (r.error) throw new Error(`AC-ATR-010 ${step}: ${r.error.message}`);
  if (r.data === null || r.data === undefined) throw new Error(`AC-ATR-010 ${step}: no row returned`);
  return r.data as NonNullable<D>;
};

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-ATR-010 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  run = `E2E-ATR-${Date.now()}`;
  crewCode = `ATR-${String(Date.now()).slice(-10)}`;
  const from = new Date(); // placed and rostered from today: the default month period then holds exactly the one rostered day below

  const org = need('target read', await admin.from('organizations').select('attendance_target_rate').eq('id', ORG_ID).single());
  previousTarget = org.attendance_target_rate === null ? null : Number(org.attendance_target_rate);
  need('target set', await admin.from('organizations').update({ attendance_target_rate: 90 }).eq('id', ORG_ID).select('id').single());
  targetTouched = true;

  const projectId = need('project', await admin.from('projects')
    .insert({ org_id: ORG_ID, name: run, status: 'Ongoing Project', project_manager_id: PM_ID }).select('id').single()).id;
  workOrderId = need('work order', await admin.from('work_orders').insert({
    org_id: ORG_ID, project_id: projectId, title: `${run} pipe rack`, status: 'Issued', order_value: 1000,
    tax_treatment: 'exclusive', tax_amount: 0,
  }).select('id').single()).id;
  crewId = need('crew', await admin.from('crews').insert({
    org_id: ORG_ID, code: crewCode, name: `${run} crew`, kind: 'own', field_controller_id: PM_ID,
  }).select('id').single()).id;
  people = [];
  for (const name of [`${run} Ana`, `${run} Budi`, `${run} Citra`]) {
    const id = need(name, await admin.from('people').insert({ org_id: ORG_ID, kind: 'own', name }).select('id').single()).id;
    need(`${name} placement`, await admin.from('crew_members')
      .insert({ org_id: ORG_ID, crew_id: crewId, worker_id: id, valid_from: iso(from) }).select('id').single());
    people.push({ id, name });
  }
  need('roster', await admin.from('work_order_crews')
    .insert({ org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewId, valid_from: iso(from) }).select('id').single());

  const [ana, budi] = people;
  const today = iso(new Date());
  need('present', await admin.from('attendance_days').insert({
    org_id: ORG_ID, worker_id: ana.id, work_order_id: workOrderId, crew_id: crewId, work_date: today,
    status: 'present', hours: 8, source: 'roster_tick',
  }).select('id').single());
  need('absent', await admin.from('attendance_days').insert({
    org_id: ORG_ID, worker_id: budi.id, work_order_id: workOrderId, crew_id: crewId, work_date: today,
    status: 'absent', source: 'roster_tick',
  }).select('id').single());
  // Citra is placed and the crew is rostered, but nobody recorded her day: the no-record column must show it.
});

test.afterEach(async () => {
  if (!admin) return;
  const fail = (step: string, error: { message: string } | null) => { if (error) throw new Error(`AC-ATR-010 cleanup ${step}: ${error.message}`); };
  if (targetTouched) {
    fail('target restore', (await admin.from('organizations').update({ attendance_target_rate: previousTarget }).eq('id', ORG_ID)).error);
    targetTouched = false;
  }
  if (crewId) {
    fail('attendance', (await admin.from('attendance_days').delete().eq('crew_id', crewId)).error);
    fail('roster', (await admin.from('work_order_crews').delete().eq('crew_id', crewId)).error);
    fail('placements', (await admin.from('crew_members').delete().eq('crew_id', crewId)).error);
    fail('crew', (await admin.from('crews').delete().eq('id', crewId)).error);
  }
  if (workOrderId) fail('work order', (await admin.from('work_orders').delete().eq('id', workOrderId)).error);
  for (const person of people) fail('person', (await admin.from('people').delete().eq('id', person.id)).error);
  people = [];
  crewId = '';
  workOrderId = '';
});

test('AC-ATR-010 a crew\'s rate, target and below-target mark agree with the recorded member-days', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await page.goto('/crews?view=rate');

  const row = page.getByRole('row', { name: new RegExp(crewCode) });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText('50%');
  await expect(row).toContainText('90%');
  await expect(row.getByText('Below target')).toBeVisible();

  // The counts the rate is made of, read from the row's cells in order: expected, present, absent, leave, off, no record.
  const cells = row.getByRole('cell');
  await expect(cells.nth(0)).toHaveText('3');
  await expect(cells.nth(1)).toHaveText('1');
  await expect(cells.nth(2)).toHaveText('1');
  await expect(cells.nth(3)).toHaveText('0');
  await expect(cells.nth(4)).toHaveText('0');
  await expect(cells.nth(5)).toHaveText('1');
});
