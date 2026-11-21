// @e2e-isolation: self-isolated — creates its own uniquely-named projects, work orders, crews and workers; approved attendance is immutable by design, so this run's rows stay, scoped to its own names; cleanup ends the roster and placements.
/**
 * JOB-H8 — HR approves, seeing the work order (#2528). Two crews' days on two work orders are sent for approval by the field
 * controller. HR (the Admin) opens the weeks waiting for approval.
 * Goal oracle: each waiting line shows the work order its hours belong to.
 * Partly built: the approval list names the worker, week and hours only; the work order per line is not shown yet, so this
 * journey is expected red on its last step until it is.
 */
import { test, expect } from '@playwright/test';
import { signIn, visibleToast } from './helpers';
import { ENGINEER_ID, inDays, need, ORG_ID, serviceClient } from './support/jobJourney';
import { endCrewRows, seedWorkOrder } from './support/crewJourney';

test.setTimeout(240_000);
const must = need('JOB-H8');
const db = serviceClient('JOB-H8');
const run = `E2E-H8-${Date.now()}`;
const jobs: Array<{ label: string; worker: string; wo: { workOrderId: string; title: string }; crew: string }> = [];

test.beforeEach(async () => {
  for (const label of ['A', 'B']) {
    const wo = await seedWorkOrder(db, 'JOB-H8', run, label);
    const crew = must('crew', await db.from('crews').insert({ org_id: ORG_ID, code: `${run.slice(-12)}${label}`, name: `${run} crew ${label}`, kind: 'own', field_controller_id: ENGINEER_ID }).select('id').single()).id;
    const worker = `${run} Worker ${label}`;
    const id = must('worker', await db.from('people').insert({ org_id: ORG_ID, kind: 'own', name: worker }).select('id').single()).id;
    must('placement', await db.from('crew_members').insert({ org_id: ORG_ID, crew_id: crew, worker_id: id, valid_from: inDays(-7) }).select('id').single());
    must('roster', await db.from('work_order_crews').insert({ org_id: ORG_ID, work_order_id: wo.workOrderId, crew_id: crew, valid_from: inDays(-7) }).select('id').single());
    jobs.push({ label, worker, wo, crew });
  }
});
test.afterEach(async () => { await endCrewRows(db, jobs.map((j) => j.crew)); jobs.length = 0; });

test('JOB-H8 HR sees which work order each waiting line of hours belongs to', async ({ page }) => {
  await signIn(page, 'engineer@acme.test');
  for (const j of jobs) {
    await page.goto(`/crews?view=attendance&wo=${j.wo.workOrderId}`);
    await expect(page.getByRole('row', { name: j.worker })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('textbox', { name: 'Hours for the crew' }).fill('8');
    await page.getByRole('button', { name: 'Save attendance' }).click();
    await expect(visibleToast(page, 'Attendance saved')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Send the week for approval' }).click();
    await expect(visibleToast(page, 'Week sent for approval')).toBeVisible({ timeout: 15_000 });
  }

  await signIn(page, 'admin@acme.test');
  await page.goto('/crews?view=attendance');
  for (const j of jobs) {
    const row = page.getByRole('row', { name: j.worker });
    await expect(row.getByText('8 hours')).toBeVisible({ timeout: 20_000 });
    await expect(row.getByText(j.wo.title), `${j.worker}'s line names its work order`).toBeVisible();
  }
});
