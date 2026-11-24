// @e2e-isolation: serial — changes organization-wide warning days; cleanup restores them after the journey.
/**
 * AC-PPL-010 — the People register (#2542) and document expiry admin journey (#2614).
 * Goal oracle: an Admin creates a person document type and warning days in the UI, adds an expiring
 * document to a person, and sees that document in the expiry list with its days left.
 */
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signIn } from '../helpers';
import { inDays, need, ORG_ID, serviceClient } from '../support/jobJourney';

test.setTimeout(120_000);

const must = need('AC-PPL-010');
let admin: SupabaseClient | undefined;
let run = '';
let typeName = '';
let personName = '';
let originalWarningDays: number[] = [];

test.beforeEach(async () => {
  const client = serviceClient('AC-PPL-010 cleanup');
  admin = client;
  run = `E2E-PPL-${Date.now()}`;
  typeName = `${run} permit`;
  personName = `${run} person`;
  const org = must('warning days baseline', await client.from('organizations')
    .select('document_warning_days').eq('id', ORG_ID).single());
  originalWarningDays = (org as { document_warning_days: number[] }).document_warning_days;
});

test.afterEach(async () => {
  if (!admin) return;
  const failures: string[] = [];
  const { data: people, error: peopleError } = await admin.from('people')
    .select('id').eq('org_id', ORG_ID).like('name', `${run}%`);
  if (peopleError) failures.push(`cleanup people: ${peopleError.message}`);
  const ids = (people ?? []).map((p) => p.id as string);
  if (ids.length && !peopleError) {
    const { error } = await admin.from('expiry_documents').delete().in('person_id', ids);
    if (error) failures.push(`cleanup documents: ${error.message}`);
  }
  const { error: deletePeopleError } = await admin.from('people').delete().eq('org_id', ORG_ID).like('name', `${run}%`);
  if (deletePeopleError) failures.push(`cleanup people: ${deletePeopleError.message}`);
  const { error: deleteTypeError } = await admin.from('document_types').delete().eq('org_id', ORG_ID).eq('name', typeName);
  if (deleteTypeError) failures.push(`cleanup document type: ${deleteTypeError.message}`);
  if (originalWarningDays.length) {
    const { error } = await admin.from('organizations').update({ document_warning_days: originalWarningDays }).eq('id', ORG_ID);
    if (error) failures.push(`restore warning days: ${error.message}`);
  }
  if (failures.length) throw new Error(`AC-PPL-010 ${failures.join('; ')}`);
});

test('AC-PPL-010: an Admin creates a person document type and warning days, then sees its expiring document', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  await page.goto('/administration/document-types');

  const warningDays = page.getByRole('textbox', { name: 'Warn this many days before expiry' });
  await warningDays.fill('10, 3');
  await page.getByRole('button', { name: 'Save warning days' }).click();
  await expect(warningDays).toHaveValue('10, 3');

  await page.getByRole('button', { name: 'Add document type' }).first().click();
  const typeForm = page.getByRole('dialog');
  await typeForm.getByLabel(/^Name/).fill(typeName);
  await typeForm.getByLabel('Applies to').selectOption('person');
  await typeForm.getByRole('button', { name: 'Save document type' }).click();
  await expect(typeForm).toHaveCount(0);
  await expect(page.getByRole('row', { name: new RegExp(typeName) })).toBeVisible();

  await page.getByRole('button', { name: 'Add person' }).first().click();
  const personForm = page.getByRole('dialog');
  await personForm.getByLabel(/^Name/).fill(personName);
  await personForm.getByRole('button', { name: 'Save person' }).click();
  await expect(personForm).toHaveCount(0);

  const row = page.getByRole('row', { name: new RegExp(personName) });
  await expect(row.locator('.record-id')).toHaveText(/^P-\d{4,}$/);
  await row.getByRole('link', { name: personName }).click();
  await expect(page).toHaveURL(/\/equipment\/people\//);

  await page.getByRole('button', { name: 'Add document' }).click();
  const documentForm = page.getByRole('dialog');
  await documentForm.getByLabel(/Document type/).selectOption({ label: typeName });
  await documentForm.getByLabel(/^Number/).fill(`${run}-1`);
  await documentForm.getByRole('textbox', { name: /Expiry date/ }).fill(inDays(6));
  await page.keyboard.press('Tab');
  await documentForm.getByRole('button', { name: 'Save document' }).click();
  await expect(documentForm).toHaveCount(0);

  await page.goto('/equipment/expiring');
  const expiryRow = page.getByRole('row', { name: new RegExp(personName) });
  await expect(expiryRow).toBeVisible();
  await expect(expiryRow.getByText(typeName)).toBeVisible();
  await expect(expiryRow.getByText(`${run}-1`)).toBeVisible();
  await expect(expiryRow.getByRole('cell', { name: /^[56]$/ })).toBeVisible();
});
