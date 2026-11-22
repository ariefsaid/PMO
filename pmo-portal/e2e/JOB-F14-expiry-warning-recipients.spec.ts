// @e2e-isolation: self-isolated — creates its own uniquely-named person, document type and badge, runs the warning job for that data and deletes the rows and their notices afterwards; reads the seeded Project Manager and Engineer only.
/**
 * JOB-F14 — expiry warnings go to the right people (#2527). A worker's badge expires in 14 days; the person's manager is
 * the construction-manager role holder, and the document type names no extra roles.
 * Goal oracle: after the scheduled warning runs, the manager has the warning in their notifications and the worker does not.
 * Partly built: recipients are the person's manager plus roles named per document type, not an arbitrary rule.
 * Second journey (expiry-to-manager): the manager records the renewal from the warning's list and the worker is told.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { ENGINEER_ID, inDays, need, ORG_ID, PM_ID, serviceClient, sql } from './support/jobJourney';

test.setTimeout(120_000);
const must = need('JOB-F14');
const db = serviceClient('JOB-F14');
const run = `E2E-F14-${Date.now()}`;
let personId = ''; let typeId = ''; let docId = '';

test.beforeEach(async () => {
  typeId = must('type', await db.from('document_types').insert({ org_id: ORG_ID, name: `${run} badge`, applies_to: 'person', notify_roles: [] }).select('id').single()).id;
  personId = must('person', await db.from('people').insert({ org_id: ORG_ID, code: run, name: `${run} Worker`, manager_id: PM_ID, profile_id: ENGINEER_ID }).select('id').single()).id;
  docId = must('badge', await db.from('expiry_documents').insert({ org_id: ORG_ID, subject_kind: 'person', person_id: personId, type_id: typeId, expires_on: inDays(14) }).select('id').single()).id;
});
test.afterEach(async () => {
  await db.from('notifications').delete().eq('metadata->entity->>id', docId);
  await db.from('document_expiry_notices').delete().eq('document_id', docId);
  await db.from('expiry_documents').delete().eq('id', docId);
  await db.from('people').delete().eq('id', personId);
  await db.from('document_types').delete().eq('id', typeId);
});

test('JOB-F14 a badge 14 days from expiry warns the manager and not the worker', async ({ page }) => {
  expect(Number(sql('select public.run_document_expiry_warnings();'))).toBeGreaterThanOrEqual(1);

  await signIn(page, 'pm@acme.test');
  await page.goto('/');
  await page.getByRole('button', { name: /^notifications/i }).click();
  await expect(page.getByRole('list', { name: 'Notifications' }).getByText(new RegExp(`${run} badge expires in 14 days`))).toBeVisible({ timeout: 20_000 });

  await signIn(page, 'engineer@acme.test');
  await page.goto('/');
  await page.getByRole('button', { name: /^notifications/i }).click();
  await expect(page.getByRole('heading', { name: 'Notifications inbox' })).toBeVisible();
  await expect(page.getByText(new RegExp(`${run} badge expires`))).toHaveCount(0);
});

test('JOB-F14 the manager records the renewal and the worker is told the new date', async ({ page }) => {
  const newDate = inDays(400);
  await signIn(page, 'pm@acme.test');
  await page.goto('/equipment/expiring');
  await page.getByRole('button', { name: `Record renewal for ${run} Worker` }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: /New expiry date/ }).fill(newDate);
  await dialog.getByRole('button', { name: 'Record renewal' }).click();
  await expect(page.getByText(new RegExp(`${run} Worker has been told`))).toBeVisible({ timeout: 20_000 });

  await signIn(page, 'engineer@acme.test');
  await page.goto('/');
  await page.getByRole('button', { name: /^notifications/i }).click();
  await expect(page.getByRole('list', { name: 'Notifications' }).getByText(new RegExp(`${run} badge renewed`))).toBeVisible({ timeout: 20_000 });
});
