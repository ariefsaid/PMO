// @e2e-isolation: self-isolated — creates its own uniquely-named project, work order, crew and person each run; makes the seeded PM the person's direct manager for the run and restores it; removes its own release.
/**
 * AC-MR-009 — a worker returning from sickness is released by their direct manager before they can be rostered (medical release).
 * The seeded Admin (the people team) opens a release for a person on /approvals; the person is shown as release pending on the
 * attendance tick and the database refuses to record them; the person's direct manager (the seeded Project Manager) approves;
 * the pill goes and the day can be recorded.
 * Goal oracle: attendance for the person is refused until the direct manager approves, and allowed after.
 */
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signIn, visibleToast } from './helpers';
import { serviceClient, need, ORG_ID, PM_ID, inDays } from './support/jobJourney';
import { seedWorkOrder } from './support/crewJourney';

test.setTimeout(240_000);

let db: SupabaseClient;
let run = '';
let workOrderId = '';
let crewId = '';
let personId = '';
const today = inDays(0);

test.beforeEach(async () => {
  db = serviceClient('AC-MR-009');
  const must = need('AC-MR-009');
  run = `E2E-MR-${Date.now()}`;
  ({ workOrderId } = await seedWorkOrder(db, 'AC-MR-009', run, 'site'));
  personId = must('person', await db.from('people').insert({ org_id: ORG_ID, kind: 'vendor', name: `${run} Worker`, manager_id: PM_ID }).select('id').single()).id;
  crewId = must('crew', await db.from('crews').insert({ org_id: ORG_ID, code: run.slice(-18), name: `${run} crew`, kind: 'own', field_controller_id: PM_ID }).select('id').single()).id;
  must('placement', await db.from('crew_members').insert({ org_id: ORG_ID, crew_id: crewId, worker_id: personId, valid_from: inDays(-1) }).select('id').single());
  must('roster', await db.from('work_order_crews').insert({ org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewId, valid_from: inDays(-1) }).select('id').single());
});

test.afterEach(async () => {
  if (!db) return;
  await db.from('attendance_days').delete().eq('worker_id', personId);
  await db.from('medical_releases').delete().eq('person_id', personId);
  await db.from('work_order_crews').update({ valid_to: inDays(-1) }).eq('crew_id', crewId);
  await db.from('crew_members').delete().eq('worker_id', personId);
});

test('AC-MR-009 the people team opens a release, the direct manager approves it, and only then can the person be recorded', async ({ page }) => {
  // 1. The people team opens the release.
  await signIn(page, 'admin@acme.test');
  await page.goto('/approvals');
  await page.getByRole('button', { name: 'Open a release' }).click();
  await page.getByLabel(/^Person/).selectOption({ label: `${run} Worker` });
  await page.getByLabel(/^Return date/).fill(today);
  await page.getByRole('button', { name: 'Open release' }).click();
  await expect(visibleToast(page, 'Release opened')).toBeVisible({ timeout: 15_000 });
  // The opener cannot decide their own release.
  const section = page.getByRole('region', { name: 'Medical releases' });
  await expect(section.getByRole('listitem', { name: new RegExp(`${run} Worker`) })).toBeVisible({ timeout: 15_000 });
  await expect(section.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  // 2. The person is held on the attendance tick.
  await signIn(page, 'pm@acme.test');
  await page.goto(`/crews?view=attendance&wo=${workOrderId}&date=${today}`);
  const row = page.getByRole('row', { name: new RegExp(`${run} Worker`) });
  await expect(row.getByText('Release pending')).toBeVisible({ timeout: 20_000 });
  await expect(row.getByRole('combobox')).toBeDisabled();

  // 3. The direct manager approves.
  await page.goto('/approvals');
  await page.getByRole('listitem', { name: new RegExp(`${run} Worker`) }).getByRole('button', { name: 'Approve' }).click();
  await expect(visibleToast(page, 'Release approved')).toBeVisible({ timeout: 15_000 });

  // 4. Goal: the person can now be recorded for the day.
  await page.goto(`/crews?view=attendance&wo=${workOrderId}&date=${today}`);
  const after = page.getByRole('row', { name: new RegExp(`${run} Worker`) });
  await expect(after.getByRole('combobox')).toBeEnabled({ timeout: 20_000 });
  await after.getByRole('combobox').selectOption('present');
  await page.getByRole('button', { name: 'Save attendance' }).click();
  await expect(visibleToast(page, 'Attendance saved')).toBeVisible({ timeout: 15_000 });
});
