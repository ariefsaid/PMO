// @e2e-isolation: self-isolated — creates its own uniquely-named project, work order, crew, person and leave type each run; leave requests are on for every organisation (#2746), so the run leaves them on; reads the seeded users only.
/**
 * AC-LV-015 — a leave request is approved by the line manager and shows on the roster (#2708). The seeded Engineer
 * requests leave from /leave; the seeded Project Manager (made the Engineer's line manager for the run) approves it from
 * the same page; the work-order roster for that day then shows the person as on leave.
 * Goal oracle: the approved day is marked on the roster, and the request the Engineer made could not be approved by the Engineer.
 * With LEAVE_SHOTS=<dir> it also writes the phone (390) and desktop (1440) screenshots of the new screens.
 */
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signIn, visibleToast } from './helpers';
import { serviceClient, need, ORG_ID, PM_ID, ENGINEER_ID, inDays } from './support/jobJourney';
import { seedWorkOrder } from './support/crewJourney';

test.setTimeout(240_000);

let db: SupabaseClient;
let run = '';
let workOrderId = '';
let crewId = '';
let personId = '';
let createdPerson = false;
let typeId = '';
let previousManager: string | null = null;
const day = inDays(3);

test.beforeEach(async () => {
  db = serviceClient('AC-LV-015');
  const must = need('AC-LV-015');
  run = `E2E-LV-${Date.now()}`;
  ({ workOrderId } = await seedWorkOrder(db, 'AC-LV-015', run, 'site'));
  must('leave on', { data: true, error: (await db.from('organizations').update({ leave_requests_enabled: true, leave_approver_role: null }).eq('id', ORG_ID)).error });
  typeId = must('type', await db.from('leave_types').insert({ org_id: ORG_ID, name: `${run} Type` }).select('id').single()).id;
  previousManager = (must('profile', await db.from('profiles').select('manager_id').eq('id', ENGINEER_ID).single()) as { manager_id: string | null }).manager_id;
  must('manager', { data: true, error: (await db.from('profiles').update({ manager_id: PM_ID }).eq('id', ENGINEER_ID)).error });
  const existing = await db.from('people').select('id').eq('profile_id', ENGINEER_ID).is('archived_at', null).maybeSingle();
  if (existing.data) personId = existing.data.id as string;
  else { personId = must('person', await db.from('people').insert({ org_id: ORG_ID, kind: 'own', name: `${run} Engineer`, profile_id: ENGINEER_ID }).select('id').single()).id; createdPerson = true; }
  crewId = must('crew', await db.from('crews').insert({ org_id: ORG_ID, code: run.slice(-18), name: `${run} crew`, kind: 'own', field_controller_id: ENGINEER_ID }).select('id').single()).id;
  must('placement', await db.from('crew_members').insert({ org_id: ORG_ID, crew_id: crewId, worker_id: personId, valid_from: inDays(-1) }).select('id').single());
  must('roster', await db.from('work_order_crews').insert({ org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewId, valid_from: inDays(-1) }).select('id').single());
});

test.afterEach(async () => {
  if (!db) return;
  await db.from('leave_requests').delete().eq('leave_type_id', typeId);
  await db.from('leave_types').update({ archived_at: new Date().toISOString() }).eq('id', typeId);
  await db.from('work_order_crews').update({ valid_to: inDays(-1) }).eq('crew_id', crewId);
  await db.from('crew_members').update({ valid_to: inDays(-1) }).eq('crew_id', crewId);
  if (createdPerson) await db.from('crew_members').delete().eq('worker_id', personId);
  if (createdPerson) await db.from('people').update({ archived_at: new Date().toISOString() }).eq('id', personId); // a live person left on the Engineer login blocks every journey that gives that login its own
  await db.from('profiles').update({ manager_id: previousManager }).eq('id', ENGINEER_ID);
  await db.from('organizations').update({ leave_requests_enabled: true, leave_approver_role: null }).eq('id', ORG_ID);
});

const shot = async (page: import('@playwright/test').Page, name: string) => {
  const dir = process.env.LEAVE_SHOTS;
  if (!dir) return;
  for (const [label, size] of [['phone-390', { width: 390, height: 844 }], ['desktop-1440', { width: 1440, height: 900 }]] as const) {
    await page.setViewportSize(size);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/${name}-${label}.png`, fullPage: true });
  }
};

test('AC-LV-015 a person requests leave, their line manager approves it, and the roster marks the day', async ({ page }) => {
  // 1. The Engineer requests leave for the day.
  await signIn(page, 'engineer@acme.test');
  await page.goto('/leave');
  await page.getByRole('button', { name: 'Request leave' }).click();
  await page.getByLabel(/^Type/).selectOption({ label: `${run} Type` });
  await page.getByLabel(/^From/).fill(day);
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(visibleToast(page, 'Request sent')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Pending').first()).toBeVisible();
  // The Engineer is offered no Approve on their own request.
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await shot(page, 'leave-my-requests');

  // 2. The line manager approves it.
  await signIn(page, 'pm@acme.test');
  await page.goto('/leave');
  await expect(page.getByText(/Waiting for your decision/)).toBeVisible({ timeout: 20_000 });
  await shot(page, 'leave-waiting-decision');
  await page.getByRole('listitem', { name: new RegExp(`${run}|Engineer`) }).first().getByRole('button', { name: 'Approve' }).click();
  await expect(visibleToast(page, 'Leave approved')).toBeVisible({ timeout: 15_000 });

  // 3. Goal: the roster for that day marks the person as on leave.
  await page.goto(`/crews?view=roster&wo=${workOrderId}&date=${day}`);
  await expect(page.getByText('On leave')).toBeVisible({ timeout: 20_000 });
  await shot(page, 'roster-on-leave');

  // 4. Admin settings screen.
  await signIn(page, 'admin@acme.test');
  await page.goto('/leave?view=settings');
  await expect(page.getByRole('heading', { name: 'Leave settings' })).toBeVisible({ timeout: 20_000 });
  await shot(page, 'leave-settings');
});
