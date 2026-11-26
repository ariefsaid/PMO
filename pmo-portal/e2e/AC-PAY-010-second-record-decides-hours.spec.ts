// @e2e-isolation: self-isolated — creates its own uniquely-named project, work order, crew, two vendor people, placements, roster and site report each run; reads the seed org and its seeded users only.
/**
 * AC-PAY-010 — two records of a worker's day, one figure paid (pay-time). The field controller ticks the crew at 8 hours and sends
 * the week; a Project Manager (who recorded none of the tick) adds a second record of 5 hours on the site report; an Admin decides
 * the second record stands; an Executive, who recorded neither figure, approves the week.
 * Goal oracle: the approved day carries 5 hours and the work-order cost read counts that day once, at 5, with the 8 kept as evidence.
 *
 * Cleanup: approved attendance is immutable by design (AC-CRW-011), so this run's records stay; every row is scoped to this run's
 * uniquely-named project and crew, which nothing else reads. The roster and placements are ended and the site report removed.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey, visibleToast } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';
import { markEveryonePresent } from './support/crewJourney';

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
let projectId = '';
let reportId = '';
let people: Array<{ id: string; name: string }> = [];

const need = <D>(step: string, r: { data: D; error: { message: string } | null }): NonNullable<D> => {
  if (r.error) throw new Error(`AC-PAY-010 ${step}: ${r.error.message}`);
  if (r.data === null || r.data === undefined) throw new Error(`AC-PAY-010 ${step}: no row returned`);
  return r.data as NonNullable<D>;
};

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-PAY-010 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  run = `E2E-PAY-${Date.now()}`;
  const from = new Date(); from.setDate(from.getDate() - 7);

  projectId = need('project', await admin.from('projects')
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
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`AC-PAY-010 cleanup ${step}: ${e.message}`); };
  fail('roster', (await admin.from('work_order_crews').update({ valid_to: today }).eq('crew_id', crewId)).error);
  fail('placements', (await admin.from('crew_members').update({ valid_to: today }).eq('crew_id', crewId)).error);
  if (reportId) await admin.from('daily_site_reports').delete().eq('id', reportId);
  reportId = '';
  crewId = '';
});

test('AC-PAY-010 a second record of 5 hours against the foreman\'s 8 is decided by a named manager, and cost counts the day once at 5', async ({ page }) => {
  const [ana] = people;
  if (!admin) throw new Error('AC-PAY-010: no admin client');

  // 1. The field controller ticks the crew at 8 hours and sends the week.
  await signIn(page, 'engineer@acme.test');
  await page.goto(`/crews?view=attendance&wo=${workOrderId}`);
  await expect(page.getByRole('row', { name: ana.name })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('textbox', { name: 'Hours for the crew' }).fill('8');
  await markEveryonePresent(page);
  await page.getByRole('button', { name: 'Save attendance' }).click();
  await expect(visibleToast(page, 'Attendance saved')).toBeVisible({ timeout: 15_000 });
  const day = need('attendance day', await admin.from('attendance_days').select('work_date').eq('work_order_id', workOrderId).eq('worker_id', ana.id).single());
  reportId = need('site report', await admin.from('daily_site_reports')
    .insert({ org_id: ORG_ID, project_id: projectId, work_order_id: workOrderId, work_date: day.work_date, author_id: ENGINEER_ID }).select('id').single()).id;

  // 2. A Project Manager who recorded none of the tick adds the second record on the site report.
  await signIn(page, 'pm@acme.test');
  await page.goto(`/site-reports/${reportId}`);
  const row = page.getByTestId(`dsr-people-row-${ana.id}`);
  await expect(row).toContainText('Stands: 8 h', { timeout: 20_000 });
  await row.getByRole('button', { name: 'Add second record' }).click();
  await page.getByRole('dialog').getByRole('textbox').first().fill('5');
  await page.getByRole('button', { name: 'Save second record' }).click();
  await expect(visibleToast(page, 'Second record saved')).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText('The two records differ');

  // 3. An Admin, who recorded neither, decides the second record stands.
  await signIn(page, 'admin@acme.test');
  await page.goto(`/site-reports/${reportId}`);
  await page.getByTestId(`dsr-people-row-${ana.id}`).getByRole('button', { name: 'Decide' }).click();
  await page.getByRole('combobox', { name: /Which figure stands/ }).selectOption('second');
  await page.getByRole('dialog').getByRole('textbox', { name: /Why this figure stands/ }).fill('Survey sheet is signed');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(visibleToast(page, 'Decision saved')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(`dsr-people-row-${ana.id}`)).toContainText('Stands: 5 h');

  // 4. The field controller sends the week; an Executive (not the Project Manager who entered the second record, who is refused by the separation rule) approves it.
  await signIn(page, 'engineer@acme.test');
  await page.goto(`/crews?view=attendance&wo=${workOrderId}`);
  await page.getByRole('button', { name: 'Send the week for approval' }).click();
  await expect(visibleToast(page, 'Week sent for approval')).toBeVisible({ timeout: 15_000 });
  await signIn(page, 'exec@acme.test');
  await page.goto('/crews?view=attendance');
  const approve = page.getByRole('row', { name: ana.name });
  // The week's hours sit in the waiting table's Hours column.
  await expect(approve.getByRole('cell', { name: '5', exact: true })).toBeVisible({ timeout: 20_000 });
  await approve.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('row', { name: ana.name })).toHaveCount(0, { timeout: 15_000 });

  // Goal: one figure is paid and costed, the other stays on file as evidence.
  const days = need('approved day', await admin.from('attendance_days').select('hours, tick_hours, approved_at').eq('work_order_id', workOrderId).eq('worker_id', ana.id));
  expect(days.map((d) => [Number(d.hours), Number(d.tick_hours), Boolean(d.approved_at)])).toEqual([[5, 8, true]]);
  const lines = need('cost lines', await admin.from('work_order_cost_lines').select('quantity').eq('work_order_id', workOrderId).eq('source', 'attendance_day'));
  expect(lines.reduce((sum, l) => sum + Number(l.quantity), 0)).toBe(5);
});
