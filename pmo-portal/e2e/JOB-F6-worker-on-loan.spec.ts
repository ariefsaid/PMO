// @e2e-isolation: self-isolated — creates its own uniquely-named project, two work orders, two crews, one worker and a disposable Site Supervisor login; cleanup ends the roster and placements (a crew's history is kept by design).
/**
 * JOB-F6 — a worker on loan follows the host crew (#2528). The worker's own crew (A) keeps its roster to work order A, and the
 * worker is placed in the host crew (B) for today only.
 * Goal oracle: today the worker shows on the host crew's work order roster and in its attendance tick, no longer on A's roster,
 * and the hours the supervisor records land on the host crew's work order — not on the worker's own crew's.
 * Partly built: the supervisor's separate approval of the change is not built.
 */
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { visibleToast } from './helpers';
import { inDays, need, ORG_ID, serviceClient } from './support/jobJourney';
import { endCrewRows, seedWorkOrder, markEveryonePresent } from './support/crewJourney';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(180_000);
// The placement dates come from the org's Jakarta calendar day (inDays); the roster and attendance read the browser's day, which the config pins to UTC. Read both on the same day.
test.use({ timezoneId: 'Asia/Jakarta' });
const must = need('JOB-F6');
let db: SupabaseClient;
// Built per test so a `--list` run needs no environment.
const run = `E2E-F6-${Date.now()}`;
let woA = { projectId: '', workOrderId: '', title: '' }; let woB = woA;
let crewA = ''; let crewB = ''; let workerId = ''; let workerName = '';
let supervisor: Awaited<ReturnType<typeof roleJobUser>> | undefined;

test.beforeEach(async () => {
  db = serviceClient('JOB-F6');
  woA = await seedWorkOrder(db, 'JOB-F6', run, 'A'); woB = await seedWorkOrder(db, 'JOB-F6', run, 'B');
  supervisor = await roleJobUser(db, 'site_supervisor', `f6-ss-${Date.now()}`);
  // Crew B is the crew this supervisor controls, so its day is theirs to record.
  crewA = must('crew A', await db.from('crews').insert({ org_id: ORG_ID, code: `${run.slice(-12)}A`, name: `${run} crew A`, kind: 'own' }).select('id').single()).id;
  crewB = must('crew B', await db.from('crews').insert({ org_id: ORG_ID, code: `${run.slice(-12)}B`, name: `${run} crew B`, kind: 'own', field_controller_id: supervisor.id }).select('id').single()).id;
  workerName = `${run} Citra`;
  workerId = must('worker', await db.from('people').insert({ org_id: ORG_ID, kind: 'own', name: workerName }).select('id').single()).id;
  // Own crew: the placement ends yesterday. Host crew: the placement is today's only.
  must('placement A', await db.from('crew_members').insert({ org_id: ORG_ID, crew_id: crewA, worker_id: workerId, valid_from: inDays(-7), valid_to: inDays(-1) }).select('id').single());
  must('placement B', await db.from('crew_members').insert({ org_id: ORG_ID, crew_id: crewB, worker_id: workerId, valid_from: inDays(0) }).select('id').single());
  for (const [wo, crew] of [[woA, crewA], [woB, crewB]] as const) {
    must('roster', await db.from('work_order_crews').insert({ org_id: ORG_ID, work_order_id: wo.workOrderId, crew_id: crew, valid_from: inDays(-7) }).select('id').single());
  }
});
test.afterEach(async () => {
  // The supervisor is the crew's field controller: release that link and this run's attendance before the login can go.
  if (woB.workOrderId) await db.from('attendance_days').delete().eq('work_order_id', woB.workOrderId);
  await db.from('crews').update({ field_controller_id: null }).in('id', [crewA, crewB].filter(Boolean));
  await endCrewRows(db, [crewA, crewB]);
  await supervisor?.cleanup();
  supervisor = undefined;
});

test('JOB-F6 a worker on loan today serves the host crew\'s work order and its hours are recorded there', async ({ page }) => {
  if (!supervisor) throw new Error('JOB-F6: site supervisor login missing');
  await supervisor.signIn(page);

  // 1. Crews → Roster → today's day placement: the host crew carries the worker; the own crew carries nobody today.
  await page.goto(`/crews?view=roster&wo=${woB.workOrderId}`);
  await expect(page.getByText(workerName)).toBeVisible({ timeout: 20_000 });
  await page.goto(`/crews?view=roster&wo=${woA.workOrderId}`);
  await expect(page.getByText('Nobody is placed in this crew that day')).toBeVisible({ timeout: 20_000 });

  // 2. Crews → Attendance on the host crew's work order: the worker is on the tick, and the day's time is recorded there.
  await page.goto(`/crews?view=attendance&wo=${woB.workOrderId}`);
  const row = page.getByRole('row', { name: new RegExp(workerName) });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await page.getByRole('textbox', { name: 'Hours for the crew' }).fill('8');
  await markEveryonePresent(page);
  await page.getByRole('button', { name: 'Save attendance' }).click();
  await expect(visibleToast(page, 'Attendance saved')).toBeVisible({ timeout: 15_000 });

  // Goal: the hours are recorded against the host crew's work order, and the own crew's work order has none of them.
  const host = must('host attendance', await db.from('attendance_days').select('worker_id, hours').eq('work_order_id', woB.workOrderId).eq('worker_id', workerId));
  expect(host).toHaveLength(1);
  expect(Number(host[0].hours)).toBe(8);
  const own = must('own attendance', await db.from('attendance_days').select('worker_id').eq('work_order_id', woA.workOrderId).eq('worker_id', workerId));
  expect(own).toHaveLength(0);
});
