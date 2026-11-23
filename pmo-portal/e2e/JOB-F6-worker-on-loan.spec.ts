// @e2e-isolation: self-isolated — creates its own uniquely-named project, two work orders, two crews and one worker; cleanup ends the roster and placements (a crew's history is kept by design).
/**
 * JOB-F6 — a worker on loan follows the host crew (#2528). A worker placed in crew A moves to crew B for the day: the
 * supervisor ends the placement in A and places the worker in B.
 * Goal oracle: today the worker shows on crew B's work order roster and in B's attendance tick, and no longer on A's roster.
 * Partly built: the host-crew time rule and the supervisor's separate approval of the change are not built, so the
 * timesheet carrying B's hours is not asserted.
 */
import { test, expect } from '@playwright/test';
import { signIn, visibleToast } from './helpers';
import { inDays, iso, need, ORG_ID, serviceClient } from './support/jobJourney';
import { endCrewRows, seedWorkOrder } from './support/crewJourney';

test.setTimeout(180_000);
const must = need('JOB-F6');
const db = serviceClient('JOB-F6');
const run = `E2E-F6-${Date.now()}`;
let woA = { projectId: '', workOrderId: '', title: '' }; let woB = woA;
let crewA = ''; let crewB = ''; let workerName = '';

test.beforeEach(async () => {
  woA = await seedWorkOrder(db, 'JOB-F6', run, 'A'); woB = await seedWorkOrder(db, 'JOB-F6', run, 'B');
  crewA = must('crew A', await db.from('crews').insert({ org_id: ORG_ID, code: `${run.slice(-12)}A`, name: `${run} crew A`, kind: 'own' }).select('id').single()).id;
  crewB = must('crew B', await db.from('crews').insert({ org_id: ORG_ID, code: `${run.slice(-12)}B`, name: `${run} crew B`, kind: 'own' }).select('id').single()).id;
  workerName = `${run} Citra`;
  const worker = must('worker', await db.from('people').insert({ org_id: ORG_ID, kind: 'own', name: workerName }).select('id').single()).id;
  must('placement A', await db.from('crew_members').insert({ org_id: ORG_ID, crew_id: crewA, worker_id: worker, valid_from: inDays(-7) }).select('id').single());
  for (const [wo, crew] of [[woA, crewA], [woB, crewB]] as const) {
    must('roster', await db.from('work_order_crews').insert({ org_id: ORG_ID, work_order_id: wo.workOrderId, crew_id: crew, valid_from: inDays(-7) }).select('id').single());
  }
});
test.afterEach(async () => { await endCrewRows(db, [crewA, crewB]); });

test('JOB-F6 a worker moved to the host crew serves its work order today and leaves the first crew\'s roster', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  await page.goto('/crews');
  await page.getByRole('button', { name: `Show the people in ${run} crew A` }).click();
  await page.getByRole('row', { name: new RegExp(workerName) }).getByRole('button', { name: /actions|more/i }).click();
  await page.getByRole('menuitem', { name: 'End placement' }).click();
  await page.getByRole('dialog', { name: 'End this placement?' }).getByRole('button', { name: 'End placement' }).click();
  await expect(visibleToast(page, 'Placement ended')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: `Show the people in ${run} crew B` }).click();
  await page.getByRole('button', { name: 'Add person' }).first().click();
  const place = page.getByRole('dialog');
  await place.getByRole('combobox', { name: /^Person/ }).click();
  await page.getByRole('combobox', { name: /^(search|cari) /i }).fill(workerName);
  await page.getByRole('listbox').getByRole('option', { name: new RegExp(workerName) }).click();
  await place.getByLabel(/^From/).fill(iso(new Date()));
  await place.getByRole('button', { name: 'Add person' }).click();
  await expect(visibleToast(page, 'Person placed')).toBeVisible({ timeout: 15_000 });

  await page.goto(`/crews?view=roster&wo=${woB.workOrderId}`);
  await expect(page.getByText(workerName)).toBeVisible({ timeout: 20_000 });
  await page.goto(`/crews?view=roster&wo=${woA.workOrderId}`);
  await expect(page.getByText('Nobody is placed in this crew that day')).toBeVisible({ timeout: 20_000 });
  await page.goto(`/crews?view=attendance&wo=${woB.workOrderId}`);
  await expect(page.getByRole('row', { name: new RegExp(workerName) })).toBeVisible({ timeout: 20_000 });
});
