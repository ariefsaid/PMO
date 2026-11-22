// @e2e-isolation: self-isolated — creates its own uniquely-named project, two work orders, two crews and one worker; cleanup ends the roster and placements (a crew's history is kept by design).
/**
 * AC-FOL-010 — a worker joined another crew for the day with no loan arranged. The roster keeper opens the receiving crew's
 * attendance, adds the person from another crew and saves.
 * Goal oracle: the person shows on the receiving crew's roster for the day, is gone from their home crew's roster that day,
 * and the day's record carries the receiving crew.
 */
import { test, expect } from '@playwright/test';
import { signIn, visibleToast } from './helpers';
import { inDays, need, ORG_ID, serviceClient } from './support/jobJourney';
import { endCrewRows, seedWorkOrder } from './support/crewJourney';

test.setTimeout(180_000);
const must = need('AC-FOL-010');
const db = serviceClient('AC-FOL-010');
const run = `E2E-FOL-${Date.now()}`;
let woHome = { projectId: '', workOrderId: '', title: '' }; let woRecv = woHome;
let crewHome = ''; let crewRecv = ''; let workerName = ''; let workerId = '';

test.beforeEach(async () => {
  woHome = await seedWorkOrder(db, 'AC-FOL-010', run, 'A'); woRecv = await seedWorkOrder(db, 'AC-FOL-010', run, 'B');
  crewHome = must('home crew', await db.from('crews').insert({ org_id: ORG_ID, code: `${run.slice(-12)}A`, name: `${run} home crew`, kind: 'own' }).select('id').single()).id;
  crewRecv = must('receiving crew', await db.from('crews').insert({ org_id: ORG_ID, code: `${run.slice(-12)}B`, name: `${run} receiving crew`, kind: 'own' }).select('id').single()).id;
  workerName = `${run} Dewi`;
  workerId = must('worker', await db.from('people').insert({ org_id: ORG_ID, kind: 'own', name: workerName }).select('id').single()).id;
  must('placement', await db.from('crew_members').insert({ org_id: ORG_ID, crew_id: crewHome, worker_id: workerId, valid_from: inDays(-7) }).select('id').single());
  for (const [wo, crew] of [[woHome, crewHome], [woRecv, crewRecv]] as const) {
    must('roster', await db.from('work_order_crews').insert({ org_id: ORG_ID, work_order_id: wo.workOrderId, crew_id: crew, valid_from: inDays(-7) }).select('id').single());
  }
});
test.afterEach(async () => { await endCrewRows(db, [crewHome, crewRecv]); });

test('AC-FOL-010 a person who followed another crew today is recorded there, with no loan', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  await page.goto(`/crews?view=attendance&wo=${woRecv.workOrderId}`);
  await page.getByRole('combobox', { name: 'Add someone from another crew' }).selectOption({ label: workerName });
  const row = page.getByRole('row', { name: new RegExp(workerName) });
  await expect(row.getByText('Followed this crew today')).toBeVisible();
  await page.getByRole('button', { name: 'Save attendance' }).click();
  await expect(visibleToast(page, 'Attendance saved')).toBeVisible({ timeout: 15_000 });

  await page.goto(`/crews?view=roster&wo=${woRecv.workOrderId}`);
  await expect(page.getByText(workerName)).toBeVisible({ timeout: 20_000 });
  await page.goto(`/crews?view=roster&wo=${woHome.workOrderId}`);
  await expect(page.getByText('Nobody is placed in this crew that day')).toBeVisible({ timeout: 20_000 });
  const day = must('day record', await db.from('attendance_days').select('crew_id, followed_crew_id').eq('worker_id', workerId).single());
  expect([day.crew_id, day.followed_crew_id]).toEqual([crewRecv, crewRecv]);
});
