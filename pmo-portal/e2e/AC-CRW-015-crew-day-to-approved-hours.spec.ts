// @e2e-isolation: self-isolated — creates its own uniquely-named project, work order, crew, two vendor people, placements and roster each run; reads the seed org and its seeded users only.
/**
 * AC-CRW-015 — a crew's day becomes approved hours with no re-entry (#2528). The field controller (the seeded Engineer)
 * ticks the crew present on the work order (8 hours, one person overridden to 6) and sends the week; the Project Manager,
 * who recorded none of it, approves each person's week on the same page.
 * Goal oracle: approved hours per person and work order exist — on the attendance and in the work-order cost read seam —
 * and nobody typed them a second time.
 *
 * Cleanup: approved attendance is immutable by design (AC-CRW-011), so this run's records stay; every row it creates is
 * scoped to its own uniquely-named project and crew, which nothing else reads. The roster and placements are ended.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey, visibleToast } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const PM_ID = '00000000-0000-0000-0000-0000000000a2';
const ENGINEER_ID = '00000000-0000-0000-0000-0000000000a4';
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
let workOrderId = '';
let crewId = '';
let people: Array<{ id: string; name: string }> = [];

const need = <D>(step: string, r: { data: D; error: { message: string } | null }): NonNullable<D> => {
  if (r.error) throw new Error(`AC-CRW-015 ${step}: ${r.error.message}`);
  if (r.data === null || r.data === undefined) throw new Error(`AC-CRW-015 ${step}: no row returned`);
  return r.data as NonNullable<D>;
};

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-CRW-015 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  run = `E2E-CRW-${Date.now()}`;
  const from = new Date(); from.setDate(from.getDate() - 7);

  const projectId = need('project', await admin.from('projects')
    .insert({ org_id: ORG_ID, name: run, status: 'Ongoing Project', project_manager_id: PM_ID }).select('id').single()).id;
  workOrderId = need('work order', await admin.from('work_orders').insert({
    org_id: ORG_ID, project_id: projectId, title: `${run} pipe rack`, status: 'Issued', order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
  }).select('id').single()).id;
  crewId = need('crew', await admin.from('crews').insert({
    org_id: ORG_ID, code: run.slice(-18), name: `${run} crew`, kind: 'own', field_controller_id: ENGINEER_ID,
  }).select('id').single()).id;
  people = [];
  for (const name of [`${run} Ana`, `${run} Budi`]) {
    const id = need(name, await admin.from('people').insert({ org_id: ORG_ID, kind: 'own', name }).select('id').single()).id;
    need(`${name} placement`, await admin.from('crew_members')
      .insert({ org_id: ORG_ID, crew_id: crewId, worker_id: id, valid_from: iso(from) }).select('id').single());
    people.push({ id, name });
  }
  need('roster', await admin.from('work_order_crews')
    .insert({ org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewId, valid_from: iso(from) }).select('id').single());
});

test.afterEach(async () => {
  if (!admin || !crewId) return;
  // Ends yesterday: valid_to is inclusive, so ending today would leave the crew rostered for the rest of today (the Engineer's phone home would list this work order).
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const today = iso(yesterday);
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`AC-CRW-015 cleanup ${step}: ${e.message}`); };
  fail('roster', (await admin.from('work_order_crews').update({ valid_to: today }).eq('crew_id', crewId)).error);
  fail('placements', (await admin.from('crew_members').update({ valid_to: today }).eq('crew_id', crewId)).error);
  crewId = '';
});

test('AC-CRW-015 a crew\'s day is ticked, the week sent, a supervisor approves, and approved hours per person and work order exist', async ({ page }) => {
  const [ana, budi] = people;

  // 1. The field controller ticks the crew present for 8 hours, overrides Budi to 6, saves and sends the week.
  await signIn(page, 'engineer@acme.test');
  await page.goto(`/crews?view=attendance&wo=${workOrderId}`);
  await expect(page.getByRole('row', { name: ana.name })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('textbox', { name: 'Hours for the crew' }).fill('8');
  await page.getByRole('textbox', { name: `Hours for ${budi.name}` }).fill('6');
  await page.getByRole('button', { name: 'Save attendance' }).click();
  await expect(visibleToast(page, 'Attendance saved')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Send the week for approval' }).click();
  await expect(visibleToast(page, 'Week sent for approval')).toBeVisible({ timeout: 15_000 });

  // 2. The Project Manager, who recorded none of it, approves each person's week from the same page.
  await signIn(page, 'pm@acme.test');
  await page.goto('/crews?view=attendance');
  for (const [person, hours] of [[ana, '8 hours'], [budi, '6 hours']] as const) {
    const row = page.getByRole('row', { name: person.name });
    await expect(row.getByText(hours)).toBeVisible({ timeout: 20_000 });
    await row.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('row', { name: person.name })).toHaveCount(0, { timeout: 15_000 });
  }

  // 3. Goal: approved hours per person on this work order exist, and the work-order cost read seam carries them.
  if (!admin) throw new Error('AC-CRW-015: no admin client');
  const days = need('attendance', await admin.from('attendance_days')
    .select('worker_id, hours, approved_at, locked_at').eq('work_order_id', workOrderId));
  expect(days.map((d) => [d.worker_id, Number(d.hours), Boolean(d.approved_at && d.locked_at)]).sort())
    .toEqual([[ana.id, 8, true], [budi.id, 6, true]].sort());
  const lines = need('cost lines', await admin.from('work_order_cost_lines')
    .select('source, quantity').eq('work_order_id', workOrderId).eq('source', 'attendance_day'));
  expect(lines.reduce((sum, l) => sum + Number(l.quantity), 0)).toBe(14);
});
